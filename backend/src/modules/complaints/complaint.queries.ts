// Shared complaint SQL (COMPLAINT_REGISTRATION_SPEC.md §11): the joined select, history and attachments.
import type { DbClient } from '../../db/pool.js';

/** Every list and detail reads this shape; lists wrap it as `select * from (COMPLAINT_SELECT) c where …`. */
export const COMPLAINT_SELECT = `
  select c.*,
         cat.name as category_name, cat.icon as category_icon, cat.color as category_color,
         d.name as department_name,
         v.name as venue_name, v.is_active as venue_active,
         r.full_name as reporter_name, r.email as reporter_email, r.role as reporter_role,
         r.department as reporter_department,
         h.full_name as handler_name,
         sc.name as suggested_category_name, sd.id as suggested_department_id, sd.name as suggested_department_name,
         (select count(*) from public.complaint_attachments a where a.complaint_id = c.id and a.kind = 'report') as photo_count,
         greatest(0, floor(extract(epoch from (now() - c.created_at)) / 86400))::int as age_days
    from public.complaints c
    join public.complaint_categories cat on cat.id = c.category_id
    join public.service_departments d on d.id = c.department_id
    join public.profiles r on r.id = c.reporter_id
    left join public.venues v on v.id = c.venue_id
    left join public.profiles h on h.id = c.handled_by
    left join public.complaint_categories sc on sc.id = c.reassignment_suggested_category_id
    left join public.service_departments sd on sd.id = sc.department_id`;

export async function loadComplaintRow(db: DbClient, id: string): Promise<any | null> {
  const { rows } = await db.query(`select * from (${COMPLAINT_SELECT}) c where c.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function loadComplaintHistory(db: DbClient, complaintId: string): Promise<any[]> {
  const { rows } = await db.query(
    `select h.id, h.event_type, h.from_status, h.to_status, h.note, h.changes, h.created_at,
            a.id as actor_id, a.full_name as actor_name, a.role as actor_role
       from public.complaint_history h
       left join public.profiles a on a.id = h.actor_id
      where h.complaint_id = $1
      order by h.created_at, h.id`,
    [complaintId],
  );
  return rows;
}

export async function loadAttachments(db: DbClient, complaintId: string): Promise<any[]> {
  const { rows } = await db.query(
    `select id, kind, storage_path, thumb_path, size_bytes, width, height, created_at
       from public.complaint_attachments where complaint_id = $1 order by created_at, id`,
    [complaintId],
  );
  return rows;
}

/** Names for the category/department IDs recorded in history `changes` (the API resolves them, §16.3). */
export async function namesFor(db: DbClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; name: string }>(
    `select id, name from public.complaint_categories where id = any($1::uuid[])
     union all
     select id, name from public.service_departments where id = any($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Whether the latest event that set 'resolved' was the auto-resolve job (CB-21). */
export async function wasAutoResolved(db: DbClient, complaintId: string): Promise<boolean> {
  const { rows } = await db.query<{ event_type: string }>(
    `select event_type from public.complaint_history
      where complaint_id = $1 and to_status = 'resolved' and event_type in ('approved', 'auto_resolved')
      order by created_at desc, id desc limit 1`,
    [complaintId],
  );
  return rows[0]?.event_type === 'auto_resolved';
}
