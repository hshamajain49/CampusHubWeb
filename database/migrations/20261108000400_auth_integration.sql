-- migrate:up
-- ---------------------------------------------------------------------
-- Every new auth user gets a profile. The role is always 'student' here:
-- the API raises it to faculty_staff inside the same transaction (E38),
-- and only provision_super_admin() can grant super_admin.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(nullif(btrim(new.name), ''), 'New user'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_users_10_create_profile
  after insert on public.auth_users
  for each row execute function public.handle_new_auth_user();

-- Keep profiles.email in sync if an auth user's email changes.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger auth_users_20_sync_email
  after update of email on public.auth_users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

-- profiles.full_name is the source of truth; mirror it into auth_users.name.
create or replace function public.sync_profile_name_to_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.auth_users
     set name = new.full_name, updated_at = now()
   where id = new.id
     and name is distinct from new.full_name;
  return new;
end;
$$;

create trigger profiles_20_sync_auth_name
  after update of full_name on public.profiles
  for each row
  when (old.full_name is distinct from new.full_name)
  execute function public.sync_profile_name_to_auth_user();

-- ---------------------------------------------------------------------
-- Super Admin provisioning via SQL (see §14.9). Run only by the deployer
-- in the Neon SQL editor or psql. No API endpoint calls it.
-- ---------------------------------------------------------------------
create or replace function public.provision_super_admin(p_email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.profiles p
     set role = 'super_admin',
         is_active = true
   where lower(p.email) = lower(btrim(p_email))
  returning p.id into v_id;

  if v_id is null then
    raise exception 'No account exists with email %. Create it first (§14.9).', p_email;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary)
  values (null, 'user.super_admin_provisioned', 'user', v_id::text,
          format('Super Admin role granted to %s via SQL provisioning', lower(btrim(p_email))));

  return v_id;
end;
$$;

revoke all on function public.provision_super_admin(text) from public;
revoke all on function public.next_booking_reference() from public;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
