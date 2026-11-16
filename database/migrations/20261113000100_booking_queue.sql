-- migrate:up
-- =====================================================================
-- Venue bookings without approval (docs/BOOKINGS.md).
--   * The first valid request for a slot is confirmed immediately.
--   * Overlapping requests join a queue (status 'queued') in arrival order.
--   * When a confirmed booking is cancelled (or moved), queued requests are
--     promoted first-in, first-out: promote_queued_bookings().
--   * Confirmed bookings become 'completed' after they end; queued requests
--     whose start passes without a free slot become 'expired': settle_bookings().
-- Statuses: confirmed | queued | completed | cancelled | expired.
-- =====================================================================

-- Existing rows are converted with the row triggers off: the old guard refuses
-- to touch final rows, and the history trigger would log every conversion.
alter table public.bookings disable trigger user;

-- ---------------------------------------------------------------------
-- 1. Drop the approval-workflow constraints
-- ---------------------------------------------------------------------
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings drop constraint bookings_rejected_has_reason;
alter table public.bookings drop constraint bookings_decision_recorded;
alter table public.bookings drop constraint bookings_rejection_reason_length;

alter table public.booking_history drop constraint booking_history_event_check;
alter table public.booking_history add constraint booking_history_event_check check (event_type in (
  -- current
  'confirmed', 'queued', 'promoted', 'modified', 'cancelled', 'expired', 'completed',
  -- history written before approvals were retired
  'submitted', 'approved', 'rejected'));

-- ---------------------------------------------------------------------
-- 2. New columns
-- ---------------------------------------------------------------------
alter table public.bookings
  add column confirmed_at timestamptz,
  add column queued_at    timestamptz,
  add column id_number    text;

comment on column public.bookings.confirmed_at is 'When the booking got the slot (on creation, or when promoted from the queue).';
comment on column public.bookings.queued_at    is 'Queue order (FIFO): when the request joined the queue for its current time.';
comment on column public.bookings.id_number    is 'USN or faculty/staff ID entered on the booking form (upper case).';

-- ---------------------------------------------------------------------
-- 3. Convert existing rows
-- ---------------------------------------------------------------------
-- Approved bookings keep their slot.
update public.bookings
   set status = 'confirmed', confirmed_at = coalesce(decided_at, created_at)
 where status = 'approved';

-- Pending requests never overlapped each other or an approved booking (the old
-- exclusion constraint covered both), so every one still ahead can be confirmed.
insert into public.booking_history (booking_id, event_type, from_status, to_status, actor_id, note)
select b.id, 'confirmed', 'pending', 'confirmed', null, 'Confirmed automatically: bookings no longer need approval.'
  from public.bookings b, public.app_settings s
 where s.id = 1 and b.status = 'pending'
   and (b.booking_date + b.start_time) > (now() at time zone s.campus_timezone);

update public.bookings b
   set status = 'confirmed', confirmed_at = now()
  from public.app_settings s
 where s.id = 1 and b.status = 'pending'
   and (b.booking_date + b.start_time) > (now() at time zone s.campus_timezone);

-- Pending requests whose start already passed would have expired anyway.
update public.bookings set status = 'expired' where status = 'pending';

-- Rejected requests become cancelled; the reason and who decided are kept.
update public.bookings
   set status              = 'cancelled',
       cancelled_by        = decided_by,
       cancelled_at        = coalesce(decided_at, updated_at),
       cancellation_reason = left('Request rejected: ' || coalesce(rejection_reason, 'no reason given'), 500)
 where status = 'rejected';

-- Confirmed bookings that already ended are completed.
update public.bookings b
   set status = 'completed'
  from public.app_settings s
 where s.id = 1 and b.status = 'confirmed'
   and (b.booking_date + b.end_time) <= (now() at time zone s.campus_timezone);

alter table public.bookings
  drop column rejection_reason,
  drop column decided_by,
  drop column decided_at;

-- ---------------------------------------------------------------------
-- 4. New constraints
-- ---------------------------------------------------------------------
alter table public.bookings alter column status drop default;
alter table public.bookings
  add constraint bookings_status_check        check (status in ('confirmed', 'queued', 'completed', 'cancelled', 'expired')),
  add constraint bookings_confirmed_recorded  check (status not in ('confirmed', 'completed') or confirmed_at is not null),
  add constraint bookings_queued_recorded     check (status <> 'queued' or queued_at is not null),
  add constraint bookings_id_number_format    check (id_number is null or id_number ~ '^[A-Z0-9][A-Z0-9./-]{2,29}$'),
  -- THE double-booking guard: no two confirmed bookings of one venue may overlap.
  -- Queued requests may overlap anything; they hold no time.
  add constraint bookings_no_overlap exclude using gist (venue_id with =, slot with &&)
    where (status = 'confirmed');

drop index public.bookings_pending_start_idx;
create index bookings_queue_idx         on public.bookings (venue_id, queued_at, id) where status = 'queued';
create index bookings_queued_start_idx  on public.bookings (booking_date, start_time) where status = 'queued';
create index bookings_confirmed_end_idx on public.bookings (booking_date, end_time)   where status = 'confirmed';

-- ---------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------
-- Stamp confirmed_at / queued_at whenever a row enters that status. queued_at uses clock_timestamp(),
-- not now() (transaction start): writers hold the venue lock, so the time of the write is the order in
-- which requests were processed, which is what FIFO must follow.
create or replace function public.bookings_stamp_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    new.confirmed_at := now();
  end if;
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from 'queued') then
    new.queued_at := coalesce(new.queued_at, clock_timestamp());
  end if;
  return new;
end;
$$;

create trigger bookings_05_stamp_status
  before insert or update on public.bookings
  for each row execute function public.bookings_stamp_status();

-- Allowed: queued    -> confirmed (promoted) | cancelled | expired
--          confirmed -> completed | cancelled
-- Final:   completed, cancelled, expired
create or replace function public.bookings_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled', 'expired') then
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
       (old.status = 'queued'    and new.status in ('confirmed', 'cancelled', 'expired'))
    or (old.status = 'confirmed' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception using
      errcode = 'CB003',
      message = 'invalid_status_transition',
      detail  = format('%s -> %s', old.status, new.status);
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Venue active + no block overlap, for any row that is (or stays) confirmed or queued.
create or replace function public.bookings_check_venue_availability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_active boolean;
  v_slot   tsrange;
begin
  if new.status not in ('confirmed', 'queued') then
    return new;                       -- completing / cancelling / expiring frees time: nothing to check
  end if;

  if tg_op = 'UPDATE'
     and new.booking_date = old.booking_date
     and new.start_time   = old.start_time
     and new.end_time     = old.end_time then
    return new;                       -- time unchanged (e.g. queued -> confirmed)
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

-- A block must not overlap confirmed bookings or queued requests of the venue.
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
       and bk.status in ('confirmed', 'queued')
       and bk.slot && tsrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception using errcode = 'CB002', message = 'block_overlaps_bookings';
  end if;

  return new;
end;
$$;

-- Append-only history. Events: confirmed | queued (on insert), promoted (queued -> confirmed
-- without a time change), confirmed (queued -> confirmed by moving to a free time),
-- completed | cancelled | expired, modified (details or time changed, status kept).
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
    values (new.id, new.status, null, new.status, coalesce(v_actor, new.requester_id), null);
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
  if new.id_number is distinct from old.id_number then
    v_changes := v_changes || jsonb_build_object('idNumber',
      jsonb_build_object('from', old.id_number, 'to', new.id_number));
  end if;

  v_event := case
    when new.status is distinct from old.status then
      case when old.status = 'queued' and new.status = 'confirmed' and v_changes = '{}'::jsonb then 'promoted'
           else new.status end
    when v_changes <> '{}'::jsonb or new.queued_at is distinct from old.queued_at then 'modified'
    else null
  end;

  if v_event is not null then
    insert into public.booking_history (booking_id, event_type, from_status, to_status, actor_id, note, changes)
    values (new.id, v_event, old.status, new.status, v_actor, v_note, v_changes);
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Queue promotion (FIFO) and settling
-- ---------------------------------------------------------------------
-- Promotes queued requests of one venue, oldest first, whose time no longer overlaps a
-- confirmed booking or a block. Only requests that haven't started, of active members, on
-- an active venue. Callers hold (or this takes) the venue row lock, which serialises it with
-- booking creation. History rows for promotions are written as the system, so a promoted
-- member never sees who cancelled.
create or replace function public.promote_queued_bookings(p_venue_id uuid)
returns table (booking_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_now        timestamp;
  v_prev_actor text := current_setting('app.actor_id', true);
  v_prev_note  text := current_setting('app.change_note', true);
  r            record;
begin
  perform 1 from public.venues v where v.id = p_venue_id and v.is_active for update;
  if not found then
    return;                           -- unknown or inactive venue: nothing is promoted
  end if;

  select (now() at time zone s.campus_timezone) into v_now from public.app_settings s where s.id = 1;

  perform set_config('app.actor_id', '', true);
  perform set_config('app.change_note', 'The slot became free.', true);

  for r in
    select q.id, q.slot
      from public.bookings q
      join public.profiles p on p.id = q.requester_id
     where q.venue_id = p_venue_id
       and q.status = 'queued'
       and lower(q.slot) > v_now
       and p.is_active
     order by q.queued_at, q.id
       for update of q
  loop
    if not exists (
         select 1 from public.bookings c
          where c.venue_id = p_venue_id and c.status = 'confirmed' and c.slot && r.slot)
       and not exists (
         select 1 from public.venue_blocks vb
          where vb.venue_id = p_venue_id and vb.period && r.slot) then
      update public.bookings set status = 'confirmed' where id = r.id;
      booking_id := r.id;
      return next;
    end if;
  end loop;

  perform set_config('app.actor_id', coalesce(v_prev_actor, ''), true);
  perform set_config('app.change_note', coalesce(v_prev_note, ''), true);
end;
$$;

revoke all on function public.promote_queued_bookings(uuid) from public;

-- Queued requests whose start passed -> expired (the slot never freed up);
-- confirmed bookings that ended -> completed. Returns what changed so the job can notify.
create or replace function public.settle_bookings()
returns table (booking_id uuid, new_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamp;
  v_id  uuid;
begin
  select (now() at time zone s.campus_timezone) into v_now from public.app_settings s where s.id = 1;

  for v_id in
    update public.bookings b
       set status = 'expired'
     where b.status = 'queued'
       and b.booking_date <= v_now::date
       and (b.booking_date + b.start_time) <= v_now
    returning b.id
  loop
    booking_id := v_id;
    new_status := 'expired';
    return next;
  end loop;

  for v_id in
    update public.bookings b
       set status = 'completed'
     where b.status = 'confirmed'
       and b.booking_date <= v_now::date
       and (b.booking_date + b.end_time) <= v_now
    returning b.id
  loop
    booking_id := v_id;
    new_status := 'completed';
    return next;
  end loop;
end;
$$;

revoke all on function public.settle_bookings() from public;
drop function public.expire_stale_bookings();

alter table public.bookings enable trigger user;

-- ---------------------------------------------------------------------
-- 7. Notifications and settings
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'booking_confirmed', 'booking_queued', 'booking_promoted', 'booking_cancelled', 'booking_expired',
  'booking_reminder', 'admin_new_booking', 'admin_request_modified', 'admin_booking_cancelled',
  -- written before approvals were retired (kept for the 180-day notification history)
  'booking_approved', 'booking_rejected', 'admin_new_request'));

-- Members can cancel until a booking ends, so the cancellation cut-off goes.
alter table public.app_settings drop constraint app_settings_cancel_cutoff;
alter table public.app_settings drop column cancellation_cutoff_minutes;
-- The per-member limit now counts upcoming confirmed + queued bookings, not pending requests.
alter table public.app_settings rename column max_pending_per_user to max_active_per_user;
alter table public.app_settings rename constraint app_settings_max_pending to app_settings_max_active;
-- The limit now also counts confirmed bookings (it used to count pending requests only), so the old default of 5
-- would lock out members who already hold several approved bookings. Raise it to 10 unless an admin chose a value.
alter table public.app_settings alter column max_active_per_user set default 10;
update public.app_settings set max_active_per_user = 10 where id = 1 and max_active_per_user = 5;
comment on column public.app_settings.max_active_per_user is 'Most upcoming bookings (confirmed + queued) one member may hold.';

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
