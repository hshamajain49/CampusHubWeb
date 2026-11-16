-- migrate:up
-- =====================================================================
-- Client change batch (docs/BOOKINGS.md, docs/ACCOUNTS.md):
--   1. Multi-day bookings: a start date and an end date, the same time window on every day.
--   2. Notification types for "venue booked" / "venue available again" (sent to every member).
--   3. Suggestion box.
--   4. Permanent account deletion: references to a deleted person become NULL ("Deleted user").
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Multi-day bookings
-- ---------------------------------------------------------------------
-- The booked time of a booking: one [start, end) range per day from p_start to p_end.
create or replace function public.booking_slot(p_start date, p_end date, p_from time, p_to time)
returns tsmultirange
language sql
immutable
parallel safe
set search_path = ''
as $$
  select range_agg(tsrange(g.d::date + p_from, g.d::date + p_to, '[)'))
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as g(d)
$$;

-- Backfill without the row triggers (the guard refuses final rows).
alter table public.bookings disable trigger user;

alter table public.bookings add column end_date date;
update public.bookings set end_date = booking_date;
alter table public.bookings alter column end_date set not null;
comment on column public.bookings.end_date is 'Last day of the booking (= booking_date for a single day).';

alter table public.bookings
  add constraint bookings_date_order check (end_date >= booking_date),
  add constraint bookings_max_days   check (end_date - booking_date < 14);

-- slot becomes the set of daily ranges. Overlap (&&) works the same against a range or another multirange,
-- so the exclusion constraint, the queue and every conflict query keep their meaning across all days.
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings drop column slot;
alter table public.bookings
  add column slot tsmultirange generated always as (public.booking_slot(booking_date, end_date, start_time, end_time)) stored;
comment on column public.bookings.slot is 'Campus-local [date+start, date+end) for every day from booking_date to end_date.';
alter table public.bookings
  add constraint bookings_no_overlap exclude using gist (venue_id with =, slot with &&) where (status = 'confirmed');

drop index public.bookings_confirmed_end_idx;
create index bookings_confirmed_end_idx on public.bookings (end_date, end_time) where status = 'confirmed';

alter table public.bookings enable trigger user;

-- Single-day inserts that don't name end_date (seeds, older callers) get end_date = booking_date. NOT NULL is checked
-- after BEFORE triggers, so this runs first.
create or replace function public.bookings_stamp_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.end_date is null then
    new.end_date := new.booking_date;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    new.confirmed_at := now();
  end if;
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from 'queued') then
    new.queued_at := coalesce(new.queued_at, clock_timestamp());
  end if;
  return new;
end;
$$;

-- Venue active + no block overlap on any of the days.
create or replace function public.bookings_check_venue_availability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_active boolean;
  v_slot   tsmultirange;
begin
  if new.status not in ('confirmed', 'queued') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.booking_date = old.booking_date
     and new.end_date     = old.end_date
     and new.start_time   = old.start_time
     and new.end_time     = old.end_time then
    return new;
  end if;

  select v.is_active into v_active
    from public.venues v
   where v.id = new.venue_id
   for update;

  if not coalesce(v_active, false) then
    raise exception using errcode = 'CB005', message = 'venue_inactive';
  end if;

  v_slot := public.booking_slot(new.booking_date, new.end_date, new.start_time, new.end_time);

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

-- History also records end-date changes.
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
  if new.end_date is distinct from old.end_date then
    v_changes := v_changes || jsonb_build_object('endDate',
      jsonb_build_object('from', old.end_date, 'to', new.end_date));
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

-- A queued request expires when its first day starts; a confirmed booking completes after its last day ends.
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
       and b.end_date <= v_now::date
       and (b.end_date + b.end_time) <= v_now
    returning b.id
  loop
    booking_id := v_id;
    new_status := 'completed';
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Notifications: venue booked / available again (every member, in-app only)
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'booking_confirmed', 'booking_queued', 'booking_promoted', 'booking_cancelled', 'booking_expired',
  'booking_reminder', 'admin_new_booking', 'admin_request_modified', 'admin_booking_cancelled',
  'venue_booked', 'venue_available',
  -- written before approvals were retired (kept for the 180-day notification history)
  'booking_approved', 'booking_rejected', 'admin_new_request'));

-- ---------------------------------------------------------------------
-- 3. Suggestion box
-- ---------------------------------------------------------------------
create table public.suggestions (
  id              uuid        primary key default gen_random_uuid(),
  author_id       uuid        not null references public.profiles (id) on delete cascade,
  subject         text        not null,
  message         text        not null,
  status          text        not null default 'new',
  admin_response  text,
  reviewed_by     uuid        references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint suggestions_subject_length  check (char_length(btrim(subject)) between 3 and 120),
  constraint suggestions_message_length  check (char_length(btrim(message)) between 10 and 2000),
  constraint suggestions_status_check    check (status in ('new', 'reviewed')),
  constraint suggestions_response_length check (admin_response is null or char_length(btrim(admin_response)) between 1 and 1000),
  constraint suggestions_review_recorded check (status <> 'reviewed' or reviewed_at is not null)
);
create index suggestions_author_idx on public.suggestions (author_id, created_at desc);
create index suggestions_status_idx on public.suggestions (status, created_at desc);
create trigger suggestions_set_updated_at before update on public.suggestions
  for each row execute function public.set_updated_at();
comment on table public.suggestions is 'Suggestion box: members send ideas, admins reply and mark them reviewed.';

-- ---------------------------------------------------------------------
-- 4. Account deletion: what other people's records say about a deleted person becomes NULL
--    (shown as "Deleted user"). The person's own bookings, complaints and suggestions are removed by the API.
-- ---------------------------------------------------------------------
alter table public.app_settings drop constraint app_settings_updated_by_fkey,
  add constraint app_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.audit_logs drop constraint audit_logs_actor_id_fkey,
  add constraint audit_logs_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null;
alter table public.booking_history drop constraint booking_history_actor_id_fkey,
  add constraint booking_history_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null;
alter table public.bookings drop constraint bookings_cancelled_by_fkey,
  add constraint bookings_cancelled_by_fkey foreign key (cancelled_by) references public.profiles (id) on delete set null;
alter table public.bookings drop constraint bookings_cancellation_recorded,
  add constraint bookings_cancellation_recorded check (status <> 'cancelled' or cancelled_at is not null);
alter table public.complaint_attachments alter column uploaded_by drop not null;
alter table public.complaint_attachments drop constraint complaint_attachments_uploaded_by_fkey,
  add constraint complaint_attachments_uploaded_by_fkey foreign key (uploaded_by) references public.profiles (id) on delete set null;
alter table public.complaint_history drop constraint complaint_history_actor_id_fkey,
  add constraint complaint_history_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null;
alter table public.complaints drop constraint complaints_handled_by_fkey,
  add constraint complaints_handled_by_fkey foreign key (handled_by) references public.profiles (id) on delete set null;
alter table public.venue_blocks alter column created_by drop not null;
alter table public.venue_blocks drop constraint venue_blocks_created_by_fkey,
  add constraint venue_blocks_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

-- The guards must let ON DELETE SET NULL clear a deleted person's reference, even on final rows.
create or replace function public.bookings_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Account deletion: ON DELETE SET NULL clears the deleted person's reference, on any row (final ones included).
  if new.cancelled_by is null and old.cancelled_by is not null
     and (to_jsonb(new) - 'cancelled_by' - 'slot') = (to_jsonb(old) - 'cancelled_by' - 'slot') then
    return new;
  end if;

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

create or replace function public.complaints_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reassigned boolean := new.category_id is distinct from old.category_id
                       or new.department_id is distinct from old.department_id;
begin
  -- Account deletion: ON DELETE SET NULL clears a deleted staff member as handler, on any row (final ones included).
  if new.handled_by is null and old.handled_by is not null
     and (to_jsonb(new) - 'handled_by') = (to_jsonb(old) - 'handled_by') then
    return new;
  end if;

  if old.status in ('withdrawn', 'closed') then
    raise exception using errcode = 'CC001', message = 'complaint_is_final',
      detail = format('Complaint %s is %s and cannot be changed.', old.reference, old.status);
  end if;

  if new.reporter_id     is distinct from old.reporter_id
  or new.reference       is distinct from old.reference
  or new.created_at      is distinct from old.created_at
  or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = 'CC003', message = 'immutable_column_changed';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_review'        and new.status in ('in_progress', 'withdrawn', 'closed'))
    or (old.status = 'in_progress'           and new.status in ('awaiting_confirmation', 'closed'))
    or (old.status = 'in_progress'           and new.status = 'pending_review' and v_reassigned)
    or (old.status = 'awaiting_confirmation' and new.status in ('resolved', 'in_progress', 'closed'))
    or (old.status = 'resolved'              and new.status = 'in_progress')
  ) then
    raise exception using errcode = 'CC001', message = 'invalid_status_transition',
      detail = format('%s -> %s', old.status, new.status);
  end if;

  if v_reassigned and old.status not in ('pending_review', 'in_progress') then
    raise exception using errcode = 'CC001', message = 'reassignment_not_allowed',
      detail = format('Complaints that are %s cannot be reassigned.', old.status);
  end if;

  if v_reassigned then
    new.reassignment_requested             := false;
    new.reassignment_note                  := null;
    new.reassignment_suggested_category_id := null;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'in_progress' and old.status = 'pending_review' then
      new.work_started_at := now();
    end if;
    if new.status = 'pending_review' then          -- back in the queue after reassignment
      new.work_started_at := null;
      new.handled_by      := null;
    end if;
    if new.status = 'awaiting_confirmation' then
      new.work_completed_at := now();
    end if;
    if new.status = 'resolved' then
      new.resolved_at      := now();
      new.rejection_reason := null;
    end if;
    if old.status = 'resolved' and new.status = 'in_progress' then
      new.resolved_at := null;
    end if;
    if new.status in ('withdrawn', 'closed') then
      new.closed_at := now();
      new.reassignment_requested             := false;
      new.reassignment_note                  := null;
      new.reassignment_suggested_category_id := null;
    end if;
  elsif v_reassigned and old.status = 'pending_review' then
    new.handled_by := null;                        -- reassigned while still pending: nobody handles it yet
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
