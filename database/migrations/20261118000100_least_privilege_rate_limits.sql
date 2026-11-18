-- migrate:up
-- =====================================================================
-- Security hardening, part 2 (security/AUDIT.md F-04, F-06).
--
-- 1. auth_rate_limits: Better Auth's sign-in / password-reset limits survive restarts and deploys (F-06).
--    One row per (client address, auth path); checked and counted in a single atomic upsert (lib/auth-rate-limit.ts).
-- 2. campushub_app: the role the API connects as in production. Data access only: no DDL, no TRUNCATE, and no
--    UPDATE/DELETE on the audit log. Created NOLOGIN here; the operator gives it a password once per Neon branch
--    (docs/DEPLOYMENT.md, "Database roles"). Migrations keep running as the owner from CI.
-- 3. audit_logs is append-only for every role, the owner included. The one change allowed is the foreign key's
--    own `on delete set null` (actor_id -> null when an account is deleted), and nothing else in the row may change.
--    TRUNCATE stays possible for the owner (test resets, deliberate maintenance) but not for campushub_app.
--
-- New tables get campushub_app's grants automatically (default privileges, for tables the owner creates).
-- =====================================================================

-- ----------------------------- 1. rate limits -----------------------------
create table public.auth_rate_limits (
  key           text        primary key check (length(key) <= 300),
  count         integer     not null check (count >= 0),
  window_start  timestamptz not null default now()
);
create index auth_rate_limits_window_idx on public.auth_rate_limits (window_start);

-- ----------------------------- 2. app role -----------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'campushub_app') then
    create role campushub_app nologin;
  end if;
end $$;

grant usage on schema public to campushub_app;
grant select, insert, update, delete on all tables in schema public to campushub_app;
grant usage, select on all sequences in schema public to campushub_app;
grant execute on all functions in schema public to campushub_app;
alter default privileges in schema public grant select, insert, update, delete on tables to campushub_app;
alter default privileges in schema public grant usage, select on sequences to campushub_app;
alter default privileges in schema public grant execute on functions to campushub_app;

revoke update, delete, truncate on public.audit_logs from campushub_app;
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'revoke all on public.schema_migrations from campushub_app';
  end if;
end $$;

-- ----------------------------- 3. append-only audit log -----------------------------
create function public.audit_logs_append_only() returns trigger language plpgsql as $$
begin
  -- The actor_id foreign key's ON DELETE SET NULL (account deletion): only actor_id may change, and only to null.
  if tg_op = 'UPDATE' and old.actor_id is not null and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'audit_logs is append-only (% refused)', tg_op using errcode = 'CA001';
end $$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

-- migrate:down
drop trigger if exists audit_logs_append_only on public.audit_logs;
drop function if exists public.audit_logs_append_only();
drop table if exists public.auth_rate_limits;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'campushub_app') then
    execute 'reassign owned by campushub_app to current_user';
    execute 'drop owned by campushub_app';
    execute 'drop role campushub_app';
  end if;
end $$;
