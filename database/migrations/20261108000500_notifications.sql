-- migrate:up
-- =====================================================================
-- notifications: one row per notification per recipient (in-app list),
-- with email and push delivery status (§10.18)
-- =====================================================================
create table public.notifications (
  id                  uuid        primary key default gen_random_uuid(),
  recipient_id        uuid        not null references public.profiles (id) on delete cascade,
  type                text        not null,
  title               text        not null,
  body                text        not null,
  booking_id          uuid        references public.bookings (id) on delete cascade,
  link_path           text,
  read_at             timestamptz,
  email_status        text        not null default 'none',
  email_attempts      smallint    not null default 0,
  push_status         text        not null default 'none',
  push_attempts       smallint    not null default 0,
  channel_updated_at  timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint notifications_type_check check (type in (
    'booking_approved', 'booking_rejected', 'booking_cancelled', 'booking_expired', 'booking_reminder',
    'admin_new_request', 'admin_request_modified', 'admin_booking_cancelled')),
  constraint notifications_title_length       check (char_length(title) between 1 and 120),
  constraint notifications_body_length        check (char_length(body) between 1 and 500),
  constraint notifications_link_path_check    check (link_path is null or link_path ~ '^/[A-Za-z0-9/_-]*$'),
  constraint notifications_email_status_check check (email_status in ('none', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  constraint notifications_push_status_check  check (push_status  in ('none', 'pending', 'sending', 'sent', 'skipped', 'failed'))
);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_delivery_idx on public.notifications (created_at)
  where email_status in ('pending', 'sending') or push_status in ('pending', 'sending');
create index notifications_created_idx on public.notifications (created_at);

-- =====================================================================
-- push_subscriptions: Web Push endpoints per user and device
-- =====================================================================
create table public.push_subscriptions (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.profiles (id) on delete cascade,
  endpoint         text        not null,
  p256dh           text        not null,
  auth_secret      text        not null,
  user_agent       text,
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  constraint push_subscriptions_endpoint_key   unique (endpoint),
  constraint push_subscriptions_endpoint_https check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  constraint push_subscriptions_key_lengths    check (char_length(p256dh) <= 200 and char_length(auth_secret) <= 100),
  constraint push_subscriptions_user_agent_len check (user_agent is null or char_length(user_agent) <= 300)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- =====================================================================
-- email_log: every email attempt (no addresses, no bodies)
-- =====================================================================
create table public.email_log (
  id                   bigint      generated always as identity primary key,
  kind                 text        not null,
  template             text        not null,
  recipient_id         uuid        references public.profiles (id) on delete set null,
  notification_id      uuid        references public.notifications (id) on delete set null,
  status               text        not null,
  provider_message_id  text,
  error                text,
  created_at           timestamptz not null default now(),
  constraint email_log_kind_check   check (kind in ('auth', 'notification')),
  constraint email_log_status_check check (status in ('sent', 'failed', 'skipped_quota', 'skipped_disabled')),
  constraint email_log_error_length check (error is null or char_length(error) <= 500)
);
create index email_log_created_idx on public.email_log (created_at desc);

-- =====================================================================
-- booking_reminders: reminder already sent for this booking
-- =====================================================================
create table public.booking_reminders (
  booking_id  uuid        primary key references public.bookings (id) on delete cascade,
  sent_at     timestamptz not null default now()
);

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
