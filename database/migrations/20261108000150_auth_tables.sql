-- migrate:up
-- Better Auth tables (mapped in backend/src/lib/auth.ts, §10.16).
-- Prefixed auth_ to keep them apart from application tables and to avoid the reserved word "user".
create table public.auth_users (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  email           text        not null,
  email_verified  boolean     not null default false,
  image           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index auth_users_email_lower_key on public.auth_users (lower(email));

create table public.auth_sessions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.auth_users (id) on delete cascade,
  token       text        not null,
  expires_at  timestamptz not null,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint auth_sessions_token_key unique (token)
);
create index auth_sessions_user_idx    on public.auth_sessions (user_id);
create index auth_sessions_expires_idx on public.auth_sessions (expires_at);

create table public.auth_accounts (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null references public.auth_users (id) on delete cascade,
  account_id                text        not null,
  provider_id               text        not null,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint auth_accounts_provider_account_key unique (provider_id, account_id)
);
create index auth_accounts_user_idx on public.auth_accounts (user_id);

create table public.auth_verifications (
  id          uuid        primary key default gen_random_uuid(),
  identifier  text        not null,
  value       text        not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index auth_verifications_identifier_idx on public.auth_verifications (identifier);

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
