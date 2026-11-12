-- migrate:up
-- Complaint triggers (COMPLAINT_REGISTRATION_SPEC.md §10.2). The spec's replacement of handle_new_auth_user() is not
-- needed here: Better Auth's trigger always creates a 'student' profile and the API raises the role (and sets
-- service_department_id) in the same transaction, exactly as it already does for faculty_staff accounts.

-- ---------------------------------------------------------------------
-- complaints: transition guard, immutable columns, timestamps, version
-- Allowed: pending_review        -> in_progress | withdrawn | closed
--          in_progress           -> awaiting_confirmation | closed | pending_review (only with reassignment)
--          awaiting_confirmation -> resolved | in_progress | closed
--          resolved              -> in_progress (reopen)
-- Final:   withdrawn, closed
-- ---------------------------------------------------------------------
create or replace function public.complaints_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reassigned boolean := new.category_id is distinct from old.category_id
                       or new.department_id is distinct from old.department_id;
begin
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

create trigger complaints_10_guard_update
  before update on public.complaints
  for each row execute function public.complaints_guard_update();

-- ---------------------------------------------------------------------
-- complaints: history. Actor/note come from set_config('app.actor_id'/'app.change_note', ..., true),
-- set by withTransaction(); the auto-resolve job leaves the actor empty.
-- ---------------------------------------------------------------------
create or replace function public.complaints_write_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor   uuid  := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_note    text  := nullif(current_setting('app.change_note', true), '');
  v_event   text;
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.complaint_history (complaint_id, event_type, from_status, to_status, actor_id, note, changes)
    values (new.id, 'submitted', null, new.status, coalesce(v_actor, new.reporter_id), null,
            jsonb_build_object('categoryId', new.category_id, 'departmentId', new.department_id));
    return null;
  end if;

  if new.category_id is distinct from old.category_id or new.department_id is distinct from old.department_id then
    v_event := 'reassigned';
    v_changes := jsonb_build_object(
      'categoryId',   jsonb_build_object('from', old.category_id,   'to', new.category_id),
      'departmentId', jsonb_build_object('from', old.department_id, 'to', new.department_id));
  elsif new.status is distinct from old.status then
    v_event := case
      when old.status = 'pending_review'        and new.status = 'in_progress' then 'work_started'
      when new.status = 'awaiting_confirmation'                                then 'work_completed'
      when new.status = 'resolved' and v_actor is null                         then 'auto_resolved'
      when new.status = 'resolved'                                             then 'approved'
      when old.status = 'awaiting_confirmation' and new.status = 'in_progress' then 'rejected'
      when old.status = 'resolved'              and new.status = 'in_progress' then 'reopened'
      when new.status = 'withdrawn'                                            then 'withdrawn'
      when new.status = 'closed'                                               then 'closed'
      else null
    end;
    if new.status = 'closed' then
      v_changes := jsonb_build_object('closureType', new.closure_type);
    end if;
  elsif new.reassignment_requested and not old.reassignment_requested then
    v_event := 'reassignment_requested';
    v_changes := jsonb_build_object('suggestedCategoryId', new.reassignment_suggested_category_id);
  elsif old.reassignment_requested and not new.reassignment_requested then
    v_event := 'reassignment_dismissed';
  end if;

  if v_event is not null then
    insert into public.complaint_history (complaint_id, event_type, from_status, to_status, actor_id, note, changes)
    values (new.id, v_event, old.status, new.status, v_actor, v_note, v_changes);
  end if;
  return null;
end;
$$;

create trigger complaints_90_write_history
  after insert or update on public.complaints
  for each row execute function public.complaints_write_history();

-- ---------------------------------------------------------------------
-- complaint_attachments: at most 3 per complaint and kind (row lock serialises concurrent inserts)
-- ---------------------------------------------------------------------
create or replace function public.complaint_attachments_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.complaints c where c.id = new.complaint_id for update;
  if (select count(*) from public.complaint_attachments a
       where a.complaint_id = new.complaint_id and a.kind = new.kind) >= 3 then
    raise exception using errcode = 'CC002', message = 'too_many_attachments';
  end if;
  return new;
end;
$$;

create trigger complaint_attachments_10_enforce_limit
  before insert on public.complaint_attachments
  for each row execute function public.complaint_attachments_enforce_limit();

-- migrate:down
-- Forward-only (§11.6): intentionally empty. dbmate 2.37 requires the marker.
