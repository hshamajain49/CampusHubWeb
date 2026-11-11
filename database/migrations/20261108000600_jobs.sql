-- migrate:up
-- Pending requests that reach their start time without a decision become 'expired'.
-- Returns the expired booking IDs so the job can notify the requesters (§10.15 K).
-- Called by POST /internal/jobs/run (cron-job.org) and opportunistically by the API.
create or replace function public.expire_stale_bookings()
returns table (booking_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamp;
  v_id  uuid;
begin
  select (now() at time zone s.campus_timezone)
    into v_now
    from public.app_settings s
   where s.id = 1;

  for v_id in
    update public.bookings b
       set status = 'expired'
     where b.status = 'pending'
       and b.booking_date <= v_now::date
       and (b.booking_date + b.start_time) <= v_now
    returning b.id
  loop
    booking_id := v_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.expire_stale_bookings() from public;

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
