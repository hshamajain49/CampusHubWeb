-- migrate:up
-- ---------------------------------------------------------------------
-- Generic updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger venues_set_updated_at before update on public.venues
  for each row execute function public.set_updated_at();
create trigger venue_blocks_20_set_updated_at before update on public.venue_blocks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- bookings: status-transition guard, immutable columns, version bump
-- Allowed: pending  -> approved | rejected | cancelled | expired
--          approved -> cancelled | pending (member edited it)
-- Final:   rejected, cancelled, expired (no further updates at all)
-- ---------------------------------------------------------------------
create or replace function public.bookings_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('rejected', 'cancelled', 'expired') then
    raise exception using
      errcode = 'CB003',
      message = 'booking_is_final',
      detail  = format('Booking %s is %s and cannot be changed.', old.reference, old.status);
  end if;

  if new.venue_id        is distinct from old.venue_id
  or new.requester_id    is distinct from old.requester_id
  or new.reference       is distinct from old.reference
  or new.created_at      is distinct from old.created_at
  or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = 'CB004', message = 'immutable_column_changed';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending'  and new.status in ('approved', 'rejected', 'cancelled', 'expired'))
    or (old.status = 'approved' and new.status in ('pending', 'cancelled'))
  ) then
    raise exception using
      errcode = 'CB003',
      message = 'invalid_status_transition',
      detail  = format('%s -> %s', old.status, new.status);
  end if;

  -- An approved booking sent back for re-approval loses its previous decision.
  if old.status = 'approved' and new.status = 'pending' then
    new.decided_by := null;
    new.decided_at := null;
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_10_guard_update
  before update on public.bookings
  for each row execute function public.bookings_guard_update();

-- ---------------------------------------------------------------------
-- bookings: venue must be active and the slot must not overlap a block.
-- Takes the venue row lock so it serialises with block writers (§18.4).
-- Generated column NEW.slot is not available in BEFORE triggers, so the
-- range is rebuilt from the base columns.
-- ---------------------------------------------------------------------
create or replace function public.bookings_check_venue_availability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_active boolean;
  v_slot   tsrange;
begin
  if new.status not in ('pending', 'approved') then
    return new;                       -- cancelling / rejecting / expiring frees time: nothing to check
  end if;

  if tg_op = 'UPDATE'
     and new.booking_date = old.booking_date
     and new.start_time   = old.start_time
     and new.end_time     = old.end_time then
    return new;                       -- occupied time unchanged (e.g. pending -> approved)
  end if;

  select v.is_active into v_active
    from public.venues v
   where v.id = new.venue_id
   for update;

  if not coalesce(v_active, false) then
    raise exception using errcode = 'CB005', message = 'venue_inactive';
  end if;

  v_slot := tsrange(new.booking_date + new.start_time, new.booking_date + new.end_time, '[)');

  if exists (
    select 1
      from public.venue_blocks b
     where b.venue_id = new.venue_id
       and b.period && v_slot
  ) then
    raise exception using errcode = 'CB001', message = 'venue_blocked';
  end if;

  return new;
end;
$$;

create trigger bookings_20_check_venue_availability
  before insert or update on public.bookings
  for each row execute function public.bookings_check_venue_availability();

-- ---------------------------------------------------------------------
-- venue_blocks: must not overlap active bookings of the venue
-- ---------------------------------------------------------------------
create or replace function public.venue_blocks_check_bookings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.venues v where v.id = new.venue_id for update;

  if exists (
    select 1
      from public.bookings bk
     where bk.venue_id = new.venue_id
       and bk.status in ('pending', 'approved')
       and bk.slot && tsrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception using errcode = 'CB002', message = 'block_overlaps_bookings';
  end if;

  return new;
end;
$$;

create trigger venue_blocks_10_check_bookings
  before insert or update of venue_id, starts_at, ends_at on public.venue_blocks
  for each row execute function public.venue_blocks_check_bookings();

-- ---------------------------------------------------------------------
-- bookings: append-only history. Actor and note come from transaction-local
-- settings set by the API: set_config('app.actor_id', ..., true),
-- set_config('app.change_note', ..., true). The expiry job leaves them unset.
-- ---------------------------------------------------------------------
create or replace function public.bookings_write_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor   uuid  := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_note    text  := nullif(current_setting('app.change_note', true), '');
  v_changes jsonb := '{}'::jsonb;
  v_event   text;
begin
  if tg_op = 'INSERT' then
    insert into public.booking_history (booking_id, event_type, from_status, to_status, actor_id, note)
    values (new.id, 'submitted', null, new.status, coalesce(v_actor, new.requester_id), null);
    return null;
  end if;

  if new.booking_date is distinct from old.booking_date then
    v_changes := v_changes || jsonb_build_object('date',
      jsonb_build_object('from', old.booking_date, 'to', new.booking_date));
  end if;
  if new.start_time is distinct from old.start_time then
    v_changes := v_changes || jsonb_build_object('startTime',
      jsonb_build_object('from', left(old.start_time::text, 5), 'to', left(new.start_time::text, 5)));
  end if;
  if new.end_time is distinct from old.end_time then
    v_changes := v_changes || jsonb_build_object('endTime',
      jsonb_build_object('from', left(old.end_time::text, 5), 'to', left(new.end_time::text, 5)));
  end if;
  if new.purpose is distinct from old.purpose then
    v_changes := v_changes || jsonb_build_object('purpose',
      jsonb_build_object('from', old.purpose, 'to', new.purpose));
  end if;
  if new.expected_attendees is distinct from old.expected_attendees then
    v_changes := v_changes || jsonb_build_object('expectedAttendees',
      jsonb_build_object('from', old.expected_attendees, 'to', new.expected_attendees));
  end if;

  v_event := case
    when new.status is distinct from old.status and new.status <> 'pending' then new.status
    when new.status is distinct from old.status or v_changes <> '{}'::jsonb then 'modified'
    else null
  end;

  if v_event is not null then
    insert into public.booking_history (booking_id, event_type, from_status, to_status, actor_id, note, changes)
    values (new.id, v_event, old.status, new.status, v_actor, v_note, v_changes);
  end if;

  return null;
end;
$$;

create trigger bookings_90_write_history
  after insert or update on public.bookings
  for each row execute function public.bookings_write_history();

-- ---------------------------------------------------------------------
-- app_settings: validate timezone, normalise domains, touch updated_at
-- ---------------------------------------------------------------------
create or replace function public.app_settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.campus_timezone) then
    raise exception using errcode = '22023', message = 'invalid_campus_timezone', detail = new.campus_timezone;
  end if;

  new.allowed_email_domains := coalesce(
    (select array_agg(distinct lower(btrim(d)) order by lower(btrim(d)))
       from unnest(new.allowed_email_domains) as d
      where btrim(d) <> ''),
    '{}'::text[]);

  new.updated_at := now();
  return new;
end;
$$;

create trigger app_settings_validate
  before insert or update on public.app_settings
  for each row execute function public.app_settings_validate();

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
