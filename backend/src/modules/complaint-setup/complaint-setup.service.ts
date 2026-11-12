// Departments & categories management (COMPLAINT_REGISTRATION_SPEC.md CW-06 step 4, §10.4 CA-7, C23–C28).
// Changing a category's department affects new complaints only (CEC-20).
import type {
  AdminComplaintCategory,
  CategoryCreateBody,
  CategoryUpdateBody,
  DepartmentCreateBody,
  DepartmentUpdateBody,
  ServiceDepartment,
} from '@campushub/shared';
import { pool, type DbClient } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { AppError, appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { audit } from '../audit/audit-writer.js';
import { toCategory } from '../complaints/complaints.service.js';

const iso = (d: Date) => new Date(d).toISOString();
const departmentInactive = () => new AppError(422, 'DEPARTMENT_INACTIVE', 'Choose an active department.', { field: 'departmentId' });

// ─────────────────────────── departments ───────────────────────────
const DEPARTMENT_SELECT = `
  select d.*,
         (select count(*) from public.complaint_categories c where c.department_id = d.id and c.is_active) as active_categories,
         (select count(*) from public.complaints x where x.department_id = d.id
            and x.status in ('pending_review','in_progress','awaiting_confirmation')) as open_complaints,
         (select count(*) from public.profiles p where p.service_department_id = d.id and p.is_active) as active_staff
    from public.service_departments d`;

function toDepartment(r: any): ServiceDepartment {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    counts: { activeCategories: r.active_categories, openComplaints: r.open_complaints, activeStaff: r.active_staff },
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

async function loadDepartment(db: DbClient, id: string): Promise<ServiceDepartment> {
  const { rows } = await db.query(`${DEPARTMENT_SELECT} where d.id = $1`, [id]);
  if (!rows[0]) throw appError('DEPARTMENT_NOT_FOUND');
  return toDepartment(rows[0]);
}

export async function listDepartments(): Promise<ServiceDepartment[]> {
  const { rows } = await pool.query(`${DEPARTMENT_SELECT} order by d.is_active desc, lower(d.name)`);
  return rows.map(toDepartment);
}

export async function createDepartment(actor: Actor, body: DepartmentCreateBody): Promise<ServiceDepartment> {
  const id = await withTransaction({ actorId: actor.id }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>('insert into public.service_departments (name, description) values ($1, $2) returning id', [
      body.name,
      body.description,
    ]);
    await audit(tx, actor, { action: 'service_department.created', entityType: 'service_department', entityId: rows[0]!.id, summary: `Created department ${body.name}` });
    return rows[0]!.id;
  });
  return loadDepartment(pool, id);
}

export async function updateDepartment(actor: Actor, id: string, body: DepartmentUpdateBody): Promise<ServiceDepartment> {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const cur = (await tx.query('select * from public.service_departments where id = $1 for update', [id])).rows[0];
    if (!cur) throw appError('DEPARTMENT_NOT_FOUND');
    if (body.isActive === false && cur.is_active) {
      const d = await loadDepartment(tx, id);
      if (d.counts.activeCategories || d.counts.openComplaints || d.counts.activeStaff) {
        throw appError('DEPARTMENT_IN_USE', undefined, d.counts);
      }
    }
    const next = {
      name: body.name ?? cur.name,
      description: body.description !== undefined ? body.description : cur.description,
      is_active: body.isActive ?? cur.is_active,
    };
    const changed = Object.entries(next).filter(([k, v]) => cur[k] !== v);
    if (!changed.length) return;
    await tx.query('update public.service_departments set name = $2, description = $3, is_active = $4 where id = $1', [
      id,
      next.name,
      next.description,
      next.is_active,
    ]);
    const action =
      next.is_active !== cur.is_active ? (next.is_active ? 'service_department.activated' : 'service_department.deactivated') : 'service_department.updated';
    await audit(tx, actor, {
      action,
      entityType: 'service_department',
      entityId: id,
      summary: `${action.split('.')[1]![0]!.toUpperCase()}${action.split('.')[1]!.slice(1)} department ${next.name}`,
      metadata: { before: Object.fromEntries(changed.map(([k]) => [k, cur[k]])), after: Object.fromEntries(changed) },
    });
  });
  return loadDepartment(pool, id);
}

// ─────────────────────────── categories ───────────────────────────
const CATEGORY_SELECT = `
  select c.*, d.name as department_name, d.is_active as department_active,
         (select count(*) from public.complaints x where x.category_id = c.id
            and x.status in ('pending_review','in_progress','awaiting_confirmation')) as open_complaints,
         (select count(*) from public.complaints x where x.category_id = c.id) as total_complaints
    from public.complaint_categories c
    join public.service_departments d on d.id = c.department_id`;

function toAdminCategory(r: any): AdminComplaintCategory {
  return {
    ...toCategory(r),
    counts: { openComplaints: r.open_complaints, totalComplaints: r.total_complaints },
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

async function loadCategory(db: DbClient, id: string): Promise<AdminComplaintCategory> {
  const { rows } = await db.query(`${CATEGORY_SELECT} where c.id = $1`, [id]);
  if (!rows[0]) throw appError('CATEGORY_NOT_FOUND');
  return toAdminCategory(rows[0]);
}

export async function listAdminCategories(): Promise<AdminComplaintCategory[]> {
  const { rows } = await pool.query(`${CATEGORY_SELECT} order by c.sort_order, lower(c.name)`);
  return rows.map(toAdminCategory);
}

/** Lowercase ASCII, non-alphanumerics → "_", trimmed, ≤ 50 (§11.3 C27). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/g, '');
  return s || 'category';
}

/** The first free slug of base, base_2, base_3 … (still ≤ 50 characters). */
async function uniqueSlug(db: DbClient, name: string): Promise<string> {
  const base = slugify(name);
  const { rows } = await db.query<{ slug: string }>(`select slug from public.complaint_categories where slug = $1 or slug like $2`, [
    base,
    `${base.slice(0, 44)}\\_%`,
  ]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 50 - `_${n}`.length).replace(/_+$/, '')}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function assertActiveDepartment(db: DbClient, id: string) {
  const { rows } = await db.query<{ is_active: boolean }>('select is_active from public.service_departments where id = $1', [id]);
  if (!rows[0]) throw appError('DEPARTMENT_NOT_FOUND', undefined, { field: 'departmentId' });
  if (!rows[0].is_active) throw departmentInactive();
}

export async function createCategory(actor: Actor, body: CategoryCreateBody): Promise<AdminComplaintCategory> {
  for (let attempt = 0; ; attempt++) {
    try {
      const id = await withTransaction({ actorId: actor.id }, async (tx) => {
        await assertActiveDepartment(tx, body.departmentId);
        const slug = await uniqueSlug(tx, body.name);
        const { rows } = await tx.query<{ id: string }>(
          `insert into public.complaint_categories (slug, name, description, icon, color, department_id, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [slug, body.name, body.description, body.icon, body.color, body.departmentId, body.sortOrder],
        );
        await audit(tx, actor, {
          action: 'complaint_category.created',
          entityType: 'complaint_category',
          entityId: rows[0]!.id,
          summary: `Created complaint category ${body.name}`,
          metadata: { slug, departmentId: body.departmentId },
        });
        return rows[0]!.id;
      });
      return loadCategory(pool, id);
    } catch (err: any) {
      // A concurrent create took the same slug: pick the next suffix (§14 "retry with a suffix").
      if (err?.code === '23505' && err?.constraint === 'complaint_categories_slug_key' && attempt < 3) continue;
      throw err;
    }
  }
}

const CATEGORY_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  icon: 'icon',
  color: 'color',
  departmentId: 'department_id',
  sortOrder: 'sort_order',
  isActive: 'is_active',
};

export async function updateCategory(actor: Actor, id: string, body: CategoryUpdateBody): Promise<AdminComplaintCategory> {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const cur = (await tx.query('select * from public.complaint_categories where id = $1 for update', [id])).rows[0];
    if (!cur) throw appError('CATEGORY_NOT_FOUND');
    const departmentId = body.departmentId ?? cur.department_id;
    const willBeActive = body.isActive ?? cur.is_active;
    if ((body.departmentId && body.departmentId !== cur.department_id) || (willBeActive && !cur.is_active)) {
      await assertActiveDepartment(tx, departmentId);
    }
    const sets: string[] = [];
    const params: unknown[] = [id];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      const column = CATEGORY_COLUMNS[key];
      if (value === undefined || !column || cur[column] === value) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
      before[key] = cur[column];
      after[key] = value;
    }
    if (!sets.length) return;
    await tx.query(`update public.complaint_categories set ${sets.join(', ')} where id = $1`, params);
    const action =
      'isActive' in after ? (after.isActive ? 'complaint_category.activated' : 'complaint_category.deactivated') : 'complaint_category.updated';
    await audit(tx, actor, {
      action,
      entityType: 'complaint_category',
      entityId: id,
      summary: `${action === 'complaint_category.updated' ? 'Updated' : after.isActive ? 'Activated' : 'Deactivated'} complaint category ${body.name ?? cur.name}`,
      metadata: { before, after },
    });
  });
  return loadCategory(pool, id);
}
