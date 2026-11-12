-- migrate:up
-- Complaint Registration module (COMPLAINT_REGISTRATION_SPEC.md §10.1), adapted to this stack:
--   * Better Auth + API-only database access: no RLS, no Supabase storage.buckets row (the private bucket
--     'complaint-photos' is declared in neon.ts), no pg_cron (jobs run through POST /internal/jobs/run).

-- =====================================================================
-- Service departments
-- =====================================================================
create table public.service_departments (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint service_departments_name_length        check (char_length(btrim(name)) between 2 and 100),
  constraint service_departments_description_length check (description is null or char_length(description) <= 300)
);
create unique index service_departments_name_lower_key on public.service_departments (lower(btrim(name)));
create trigger service_departments_set_updated_at before update on public.service_departments
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Department staff role
-- =====================================================================
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'faculty_staff', 'department_staff', 'super_admin'));
alter table public.profiles add column service_department_id uuid references public.service_departments (id);
alter table public.profiles add constraint profiles_staff_department
  check ((role = 'department_staff') = (service_department_id is not null));
create index profiles_service_department_idx on public.profiles (service_department_id)
  where service_department_id is not null;
comment on column public.profiles.service_department_id is
  'Service department (Electrical, Plumbing, …) of a department_staff account; unrelated to the free-text academic department.';

-- =====================================================================
-- Complaint categories
-- =====================================================================
create table public.complaint_categories (
  id             uuid        primary key default gen_random_uuid(),
  slug           text        not null,
  name           text        not null,
  description    text,
  icon           text        not null default 'circle-help',
  color          text        not null default '#64748B',
  department_id  uuid        not null references public.service_departments (id),
  sort_order     smallint    not null default 100,
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint complaint_categories_slug_key           unique (slug),
  constraint complaint_categories_slug_format        check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(slug) <= 50),
  constraint complaint_categories_name_length        check (char_length(btrim(name)) between 2 and 60),
  constraint complaint_categories_description_length check (description is null or char_length(description) <= 200),
  constraint complaint_categories_icon_check         check (icon in (
    'zap', 'droplets', 'wifi', 'armchair', 'spray-can', 'brick-wall', 'ellipsis', 'wrench',
    'lightbulb', 'fan', 'air-vent', 'trash-2', 'shield-alert', 'bus', 'trees', 'utensils',
    'monitor', 'printer', 'lock', 'circle-help')),
  constraint complaint_categories_color_format       check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint complaint_categories_sort_order_range   check (sort_order between 0 and 999)
);
create unique index complaint_categories_name_lower_key on public.complaint_categories (lower(btrim(name)));
create index complaint_categories_department_idx on public.complaint_categories (department_id);
create trigger complaint_categories_set_updated_at before update on public.complaint_categories
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Complaints
-- =====================================================================
create sequence public.complaint_reference_seq as bigint start with 1;

create or replace function public.next_complaint_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  n bigint := nextval('public.complaint_reference_seq');
begin
  return 'CMP-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, greatest(6, length(n::text)), '0');
end;
$$;
revoke all on function public.next_complaint_reference() from public;

create table public.complaints (
  id                                  uuid        primary key default gen_random_uuid(),
  reference                           text        not null default public.next_complaint_reference(),
  reporter_id                         uuid        not null references public.profiles (id) on delete restrict,
  category_id                         uuid        not null references public.complaint_categories (id),
  department_id                       uuid        not null references public.service_departments (id),
  venue_id                            uuid        references public.venues (id) on delete set null,
  location_details                    text,
  title                               text        not null,
  description                         text,
  status                              text        not null default 'pending_review',
  handled_by                          uuid        references public.profiles (id),
  resolution_note                     text,
  rejection_reason                    text,
  closure_type                        text,
  closure_reason                      text,
  reassignment_requested              boolean     not null default false,
  reassignment_note                   text,
  reassignment_suggested_category_id  uuid        references public.complaint_categories (id),
  work_started_at                     timestamptz,
  work_completed_at                   timestamptz,
  resolved_at                         timestamptz,
  closed_at                           timestamptz,
  idempotency_key                     uuid,
  version                             integer     not null default 1,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  constraint complaints_reference_key               unique (reference),
  constraint complaints_status_check                check (status in ('pending_review', 'in_progress', 'awaiting_confirmation',
                                                                     'resolved', 'withdrawn', 'closed')),
  constraint complaints_title_length                check (char_length(btrim(title)) between 3 and 120),
  constraint complaints_description_length          check (description is null or char_length(description) <= 2000),
  constraint complaints_location_length             check (location_details is null or char_length(location_details) <= 200),
  constraint complaints_resolution_note_length      check (resolution_note is null or char_length(resolution_note) <= 1000),
  constraint complaints_rejection_reason_length     check (rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 300),
  constraint complaints_closure_type_check          check (closure_type is null or closure_type in ('duplicate', 'invalid', 'out_of_scope', 'other')),
  constraint complaints_closure_reason_length       check (closure_reason is null or char_length(btrim(closure_reason)) between 3 and 500),
  constraint complaints_reassignment_note_length    check (reassignment_note is null or char_length(btrim(reassignment_note)) between 3 and 500),
  constraint complaints_closed_has_reason           check (status <> 'closed' or (closure_type is not null and closure_reason is not null)),
  constraint complaints_reassignment_has_note       check (not reassignment_requested or reassignment_note is not null)
);
create unique index complaints_reporter_idempotency_key
  on public.complaints (reporter_id, idempotency_key) where idempotency_key is not null;
create index complaints_reporter_created_idx   on public.complaints (reporter_id, created_at desc);
create index complaints_department_status_idx  on public.complaints (department_id, status, created_at);
create index complaints_status_created_idx     on public.complaints (status, created_at);
create index complaints_created_idx            on public.complaints (created_at desc);
create index complaints_category_idx           on public.complaints (category_id);
create index complaints_venue_idx              on public.complaints (venue_id) where venue_id is not null;
create index complaints_handled_by_idx         on public.complaints (handled_by) where handled_by is not null;
create index complaints_awaiting_idx           on public.complaints (work_completed_at) where status = 'awaiting_confirmation';
create index complaints_reassignment_idx       on public.complaints (created_at) where reassignment_requested;

-- =====================================================================
-- Attachments (metadata; files live in the private object-storage bucket 'complaint-photos')
-- =====================================================================
create table public.complaint_attachments (
  id            uuid        primary key default gen_random_uuid(),
  complaint_id  uuid        not null references public.complaints (id) on delete cascade,
  kind          text        not null,
  storage_path  text        not null,
  thumb_path    text        not null,
  content_type  text        not null default 'image/webp',
  size_bytes    integer     not null,
  width         integer     not null,
  height        integer     not null,
  uploaded_by   uuid        not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  constraint complaint_attachments_kind_check  check (kind in ('report', 'resolution')),
  constraint complaint_attachments_size_range  check (size_bytes between 1 and 5242880),
  constraint complaint_attachments_dimensions  check (width between 1 and 4096 and height between 1 and 4096),
  constraint complaint_attachments_path_key    unique (storage_path)
);
create index complaint_attachments_complaint_idx on public.complaint_attachments (complaint_id, kind, created_at);

-- =====================================================================
-- History (append-only, written by trigger)
-- =====================================================================
create table public.complaint_history (
  id            bigint      generated always as identity primary key,
  complaint_id  uuid        not null references public.complaints (id) on delete cascade,
  event_type    text        not null,
  from_status   text,
  to_status     text        not null,
  actor_id      uuid        references public.profiles (id),
  note          text,
  changes       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint complaint_history_event_check check (event_type in (
    'submitted', 'work_started', 'work_completed', 'approved', 'rejected', 'auto_resolved', 'reopened',
    'reassigned', 'reassignment_requested', 'reassignment_dismissed', 'withdrawn', 'closed'))
);
create index complaint_history_complaint_idx on public.complaint_history (complaint_id, created_at);
create index complaint_history_created_idx   on public.complaint_history (created_at desc);

-- =====================================================================
-- Settings and audit additions
-- =====================================================================
alter table public.app_settings
  add column complaint_auto_resolve_days  smallint default 7,
  add column complaint_reopen_window_days smallint not null default 7,
  add column complaint_max_open_per_user  smallint not null default 10;
alter table public.app_settings
  add constraint app_settings_complaint_auto_resolve check (complaint_auto_resolve_days is null
                                                            or complaint_auto_resolve_days between 1 and 60),
  add constraint app_settings_complaint_reopen_window check (complaint_reopen_window_days between 0 and 60),
  add constraint app_settings_complaint_max_open     check (complaint_max_open_per_user between 1 and 100);

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('booking', 'venue', 'venue_block', 'user', 'settings', 'system',
                         'complaint', 'service_department', 'complaint_category'));

-- =====================================================================
-- Seed: departments and categories from the Flutter app (configuration, not sample data)
-- =====================================================================
insert into public.service_departments (name) values
  ('Electrical Department'),
  ('Plumbing Department'),
  ('IT Department'),
  ('Furniture/Carpentry Department'),
  ('Housekeeping Department'),
  ('Civil/Maintenance Department'),
  ('General Administration');

insert into public.complaint_categories (slug, name, icon, color, department_id, sort_order)
select v.slug, v.name, v.icon, v.color, d.id, v.sort_order
  from (values
    ('electrical',           'Electrical',           'zap',        '#E09B10', 'Electrical Department',          10),
    ('plumbing',             'Plumbing',             'droplets',   '#2F7BD8', 'Plumbing Department',            20),
    ('it_network',           'IT/Network',           'wifi',       '#5B5BD6', 'IT Department',                  30),
    ('furniture',            'Furniture',            'armchair',   '#B0703A', 'Furniture/Carpentry Department', 40),
    ('cleanliness',          'Cleanliness',          'spray-can',  '#1F9D63', 'Housekeeping Department',        50),
    ('civil_infrastructure', 'Civil/Infrastructure', 'brick-wall', '#64748B', 'Civil/Maintenance Department',   60),
    ('other',                'Other',                'ellipsis',   '#E5654B', 'General Administration',         70)
  ) as v(slug, name, icon, color, department_name, sort_order)
  join public.service_departments d on d.name = v.department_name;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
