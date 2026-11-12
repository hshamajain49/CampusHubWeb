-- migrate:up
-- Auto-resolve (COMPLAINT_REGISTRATION_SPEC.md §10.3, CW-07). Instead of pg_cron, the API's scheduled job runner calls
-- this from POST /internal/jobs/run (cron-job.org, every 30 minutes) and opportunistically, like expire_stale_bookings().
-- The spec's RLS policies are not applicable: this app has no client-side database access (the API is the only client).
create or replace function public.auto_resolve_complaints()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_days  smallint;
  v_count integer;
begin
  select s.complaint_auto_resolve_days into v_days from public.app_settings s where s.id = 1;
  if v_days is null then
    return 0;
  end if;

  perform set_config('app.actor_id', '', true);
  perform set_config('app.change_note',
    format('Automatically resolved: no response from the reporter within %s days.', v_days), true);

  update public.complaints
     set status = 'resolved'
   where status = 'awaiting_confirmation'
     and work_completed_at <= now() - make_interval(days => v_days);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.auto_resolve_complaints() from public;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
