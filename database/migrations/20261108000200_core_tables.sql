-- migrate:up
-- =====================================================================
-- profiles: application data for each auth user (Better Auth: auth_users)
-- =====================================================================
create table public.profiles (
  id                    uuid        primary key references public.auth_users (id) on delete cascade,
  email                 text        not null,
  full_name             text        not null,
  role                  text        not null default 'student',
  department            text,
  is_active             boolean     not null default true,
  must_change_password  boolean     not null default false,
  email_notifications   boolean     not null default true,
  last_sign_in_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_role_check        check (role in ('student', 'faculty_staff', 'super_admin')),
  constraint profiles_full_name_length  check (char_length(btrim(full_name)) between 2 and 100),
  constraint profiles_department_length check (department is null or char_length(btrim(department)) between 2 and 100),
  constraint profiles_email_format      check (position('@' in email) > 1)
);
create unique index profiles_email_lower_key on public.profiles (lower(email));
create index profiles_role_active_idx on public.profiles (role, is_active);
comment on table public.profiles is 'One row per auth_users row: name, role, activation, password-change and notification flags.';

-- =====================================================================
-- venues: bookable spaces (admin-managed)
-- =====================================================================
create table public.venues (
  id                uuid        primary key default gen_random_uuid(),
  name              text        not null,
  venue_type        text        not null default 'other',
  building          text        not null,
  location_details  text,
  capacity          integer     not null,
  description       text        not null,
  amenities         text[]      not null default '{}',
  image_url         text,
  image_public_id   text,
  is_active         boolean     not null default true,
  created_by        uuid        references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint venues_name_length        check (char_length(btrim(name)) between 2 and 120),
  constraint venues_type_check         check (venue_type in ('auditorium', 'seminar_hall', 'conference_room',
                                                             'classroom', 'laboratory', 'sports_facility',
                                                             'outdoor_space', 'other')),
  constraint venues_building_length    check (char_length(btrim(building)) between 1 and 120),
  constraint venues_location_length    check (location_details is null or char_length(location_details) <= 200),
  constraint venues_capacity_range     check (capacity between 1 and 100000),
  constraint venues_description_length check (char_length(btrim(description)) between 1 and 2000),
  constraint venues_amenities_count    check (cardinality(amenities) <= 20),
  constraint venues_image_url_https    check (image_url is null or image_url like 'https://%'),
  constraint venues_image_pair         check ((image_url is null) = (image_public_id is null))
);
create unique index venues_name_lower_key on public.venues (lower(btrim(name)));
create index venues_active_type_idx on public.venues (is_active, venue_type);
comment on column public.venues.image_url is 'Cloudinary secure_url of the venue photo; image_public_id is used to delete it.';

-- =====================================================================
-- venue_blocks: maintenance / special-event unavailability (campus local time)
-- =====================================================================
create table public.venue_blocks (
  id          uuid         primary key default gen_random_uuid(),
  venue_id    uuid         not null references public.venues (id) on delete cascade,
  block_type  text         not null default 'maintenance',
  reason      text         not null,
  starts_at   timestamp(0) not null,
  ends_at     timestamp(0) not null,
  period      tsrange      generated always as (tsrange(starts_at, ends_at, '[)')) stored,
  created_by  uuid         not null references public.profiles (id),
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  constraint venue_blocks_type_check    check (block_type in ('maintenance', 'special_event', 'other')),
  constraint venue_blocks_reason_length check (char_length(btrim(reason)) between 3 and 200),
  constraint venue_blocks_valid_period  check (ends_at > starts_at),
  constraint venue_blocks_no_overlap    exclude using gist (venue_id with =, period with &&)
);
create index venue_blocks_venue_starts_idx on public.venue_blocks (venue_id, starts_at);
comment on column public.venue_blocks.starts_at is 'Campus wall-clock time (app_settings.campus_timezone), no offset.';

-- =====================================================================
-- bookings
-- =====================================================================
create sequence public.booking_reference_seq as bigint start with 1;

create or replace function public.next_booking_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  n bigint := nextval('public.booking_reference_seq');
begin
  return 'BK-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, greatest(6, length(n::text)), '0');
end;
$$;

create table public.bookings (
  id                   uuid        primary key default gen_random_uuid(),
  reference            text        not null default public.next_booking_reference(),
  venue_id             uuid        not null references public.venues (id) on delete restrict,
  requester_id         uuid        not null references public.profiles (id) on delete restrict,
  booking_date         date        not null,
  start_time           time(0)     not null,
  end_time             time(0)     not null,
  slot                 tsrange     generated always as
                         (tsrange(booking_date + start_time, booking_date + end_time, '[)')) stored,
  purpose              text        not null,
  expected_attendees   integer,
  status               text        not null default 'pending',
  rejection_reason     text,
  cancellation_reason  text,
  decided_by           uuid        references public.profiles (id),
  decided_at           timestamptz,
  cancelled_by         uuid        references public.profiles (id),
  cancelled_at         timestamptz,
  idempotency_key      uuid,
  version              integer     not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint bookings_reference_key              unique (reference),
  constraint bookings_status_check               check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  constraint bookings_time_order                 check (end_time > start_time),
  constraint bookings_end_before_midnight        check (end_time <= time '23:59'),
  constraint bookings_whole_minutes              check (extract(second from start_time) = 0
                                                        and extract(second from end_time) = 0),
  constraint bookings_purpose_length             check (char_length(btrim(purpose)) between 3 and 500),
  constraint bookings_attendees_range            check (expected_attendees is null or expected_attendees between 1 and 100000),
  constraint bookings_rejection_reason_length    check (rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 500),
  constraint bookings_cancellation_reason_length check (cancellation_reason is null or char_length(cancellation_reason) <= 500),
  constraint bookings_rejected_has_reason        check (status <> 'rejected' or rejection_reason is not null),
  constraint bookings_decision_recorded          check (status not in ('approved', 'rejected')
                                                        or (decided_by is not null and decided_at is not null)),
  constraint bookings_cancellation_recorded      check (status <> 'cancelled'
                                                        or (cancelled_by is not null and cancelled_at is not null)),
  -- THE double-booking guard: no two active bookings of one venue may overlap.
  constraint bookings_no_overlap exclude using gist (venue_id with =, slot with &&)
    where (status in ('pending', 'approved'))
);
create unique index bookings_requester_idempotency_key
  on public.bookings (requester_id, idempotency_key) where idempotency_key is not null;
create index bookings_requester_date_idx on public.bookings (requester_id, booking_date desc, start_time desc);
create index bookings_status_date_idx    on public.bookings (status, booking_date, start_time);
create index bookings_venue_date_idx     on public.bookings (venue_id, booking_date);
create index bookings_created_at_idx     on public.bookings (created_at desc);
create index bookings_pending_start_idx  on public.bookings (booking_date, start_time) where status = 'pending';
comment on column public.bookings.slot is 'Half-open campus-local interval [date+start, date+end).';

-- =====================================================================
-- booking_history: append-only timeline (written only by trigger)
-- =====================================================================
create table public.booking_history (
  id           bigint      generated always as identity primary key,
  booking_id   uuid        not null references public.bookings (id) on delete cascade,
  event_type   text        not null,
  from_status  text,
  to_status    text        not null,
  actor_id     uuid        references public.profiles (id),
  note         text,
  changes      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint booking_history_event_check check (event_type in ('submitted', 'modified', 'approved',
                                                                 'rejected', 'cancelled', 'expired'))
);
create index booking_history_booking_idx on public.booking_history (booking_id, created_at);
create index booking_history_created_idx on public.booking_history (created_at desc);

-- =====================================================================
-- audit_logs: admin and security-relevant actions
-- =====================================================================
create table public.audit_logs (
  id           bigint      generated always as identity primary key,
  actor_id     uuid        references public.profiles (id),
  action       text        not null,
  entity_type  text        not null,
  entity_id    text,
  summary      text        not null,
  metadata     jsonb       not null default '{}'::jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  constraint audit_logs_entity_type_check check (entity_type in ('booking', 'venue', 'venue_block',
                                                                  'user', 'settings', 'system'))
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx  on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx   on public.audit_logs (actor_id, created_at desc);

-- =====================================================================
-- app_settings: exactly one row
-- =====================================================================
create table public.app_settings (
  id                           smallint    primary key default 1,
  institution_name             text        not null default 'Your Institution',
  support_email                text,
  campus_timezone              text        not null default 'UTC',
  operating_hours_start        time(0)     not null default '08:00',
  operating_hours_end          time(0)     not null default '20:00',
  time_step_minutes            smallint    not null default 15,
  min_duration_minutes         smallint    not null default 30,
  max_duration_minutes         smallint    not null default 720,
  max_advance_days             smallint    not null default 365,
  min_lead_time_minutes        integer     not null default 0,
  cancellation_cutoff_minutes  integer     not null default 0,
  modification_cutoff_minutes  integer     not null default 0,
  max_pending_per_user         smallint    not null default 5,
  self_registration_enabled    boolean     not null default true,
  allowed_email_domains        text[]      not null default '{}',
  email_notifications_enabled  boolean     not null default true,
  email_daily_limit            smallint    not null default 250,
  reminder_lead_minutes        smallint    not null default 60,
  updated_by                   uuid        references public.profiles (id),
  updated_at                   timestamptz not null default now(),
  constraint app_settings_singleton          check (id = 1),
  constraint app_settings_name_length        check (char_length(btrim(institution_name)) between 2 and 150),
  constraint app_settings_support_email      check (support_email is null or support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint app_settings_hours_order        check (operating_hours_end > operating_hours_start
                                                    and operating_hours_end <= time '23:59'),
  constraint app_settings_time_step          check (time_step_minutes in (5, 10, 15, 20, 30, 60)),
  constraint app_settings_min_duration       check (min_duration_minutes between 5 and 1440),
  constraint app_settings_max_duration       check (max_duration_minutes between 5 and 1440
                                                    and max_duration_minutes >= min_duration_minutes),
  constraint app_settings_max_advance        check (max_advance_days between 1 and 730),
  constraint app_settings_lead_time          check (min_lead_time_minutes between 0 and 20160),
  constraint app_settings_cancel_cutoff      check (cancellation_cutoff_minutes between 0 and 20160),
  constraint app_settings_modify_cutoff      check (modification_cutoff_minutes between 0 and 20160),
  constraint app_settings_max_pending        check (max_pending_per_user between 1 and 100),
  constraint app_settings_email_limit        check (email_daily_limit between 0 and 300),
  constraint app_settings_reminder_lead      check (reminder_lead_minutes between 0 and 1440)
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
