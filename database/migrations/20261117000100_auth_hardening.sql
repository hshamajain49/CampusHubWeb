-- migrate:up
-- =====================================================================
-- Sign-in hardening (security/AUDIT.md F-02):
--   1. auth_login_throttle: failed sign-ins per account and per account+IP, with exponential back-off. Keys are
--      HMACs of the normalised email (keyed by BETTER_AUTH_SECRET), so no email address is stored here, and an
--      unknown email is throttled exactly like a real one (no account-existence oracle).
--   2. user_mfa: TOTP two-step verification (required for Super Admins in production). The secret is encrypted
--      by the API; recovery codes are stored as SHA-256 hashes.
--   3. auth_session_mfa: which sessions have passed the second step. Deleting the session (sign-out, expiry,
--      password change) deletes the row.
-- =====================================================================

create table public.auth_login_throttle (
  key                text        primary key,
  -- The per-account key this row belongs to: a password reset clears every row of the account.
  account_key        text        not null,
  failures           integer     not null default 0 check (failures >= 0),
  window_started_at  timestamptz not null default now(),
  locked_until       timestamptz,
  updated_at         timestamptz not null default now()
);
create index auth_login_throttle_account_idx on public.auth_login_throttle (account_key);
create index auth_login_throttle_updated_idx on public.auth_login_throttle (updated_at);

create table public.user_mfa (
  user_id             uuid        primary key references public.profiles (id) on delete cascade,
  totp_secret         text,        -- encrypted; null until enabled
  pending_secret      text,        -- encrypted; set by setup, moved to totp_secret by enable
  pending_created_at  timestamptz,
  enabled_at          timestamptz,
  -- Highest TOTP time step accepted so far: a code can't be used twice (RFC 6238 §5.2).
  last_used_step      bigint      not null default 0,
  recovery_codes      text[]      not null default '{}',
  failed_attempts     integer     not null default 0 check (failed_attempts >= 0),
  locked_until        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint user_mfa_enabled_has_secret check (enabled_at is null or totp_secret is not null)
);
create trigger user_mfa_set_updated_at before update on public.user_mfa
  for each row execute function public.set_updated_at();

create table public.auth_session_mfa (
  session_id   uuid        primary key references public.auth_sessions (id) on delete cascade,
  verified_at  timestamptz not null default now()
);

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
