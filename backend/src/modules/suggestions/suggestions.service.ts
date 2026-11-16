// Suggestion box: members send ideas; the Super Admin reads them, replies and marks them reviewed.
import type { AdminSuggestion, Suggestion, SuggestionCreateBody, SuggestionReviewBody } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

const FROM = 'from public.suggestions s left join public.profiles a on a.id = s.author_id';

const SELECT = `
  select s.*, a.full_name as author_name, a.email as author_email, a.role as author_role, r.full_name as reviewer_name
    from public.suggestions s
    left join public.profiles a on a.id = s.author_id
    left join public.profiles r on r.id = s.reviewed_by`;

function toSuggestion(r: any): Suggestion {
  return {
    id: r.id,
    subject: r.subject,
    message: r.message,
    status: r.status,
    adminResponse: r.admin_response,
    reviewedBy: r.reviewed_by ? { id: r.reviewed_by, fullName: r.reviewer_name } : null,
    reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function toAdminSuggestion(r: any): AdminSuggestion {
  return {
    ...toSuggestion(r),
    author: r.author_id ? { id: r.author_id, fullName: r.author_name, email: r.author_email, role: r.author_role } : null,
  };
}

export async function createSuggestion(actor: Actor, body: SuggestionCreateBody): Promise<Suggestion> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into public.suggestions (author_id, subject, message) values ($1, $2, $3) returning id',
    [actor.id, body.subject, body.message],
  );
  const created = await pool.query(`${SELECT} where s.id = $1`, [rows[0]!.id]);
  return toSuggestion(created.rows[0]);
}

export async function listMySuggestions(authorId: string, q: { page: number; pageSize: number }) {
  const total = (await pool.query<{ n: number }>('select count(*) as n from public.suggestions where author_id = $1', [authorId])).rows[0]!.n;
  const { rows } = await pool.query(`${SELECT} where s.author_id = $1 order by s.created_at desc limit $2 offset $3`, [
    authorId,
    q.pageSize,
    offsetOf(q.page, q.pageSize),
  ]);
  return { data: rows.map(toSuggestion), meta: listMeta(q.page, q.pageSize, total) };
}

export async function listAdminSuggestions(q: { status?: string; q?: string; page: number; pageSize: number }) {
  const w = new Where();
  if (q.status) w.add('s.status = $?', q.status);
  if (q.q) {
    const like = w.param(likePattern(q.q));
    w.add(`(s.subject ilike ${like} or s.message ilike ${like} or a.full_name ilike ${like} or a.email ilike ${like})`);
  }
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n ${FROM} ${where}`, w.params)).rows[0]!.n;
  const counts = (
    await pool.query(`select count(*) as all, count(*) filter (where status = 'new') as new, count(*) filter (where status = 'reviewed') as reviewed from public.suggestions`)
  ).rows[0];
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(`${SELECT} ${where} order by (s.status = 'new') desc, s.created_at desc limit ${limit} offset ${offset}`, w.params);
  return { data: rows.map(toAdminSuggestion), meta: { ...listMeta(q.page, q.pageSize, total), statusCounts: counts } };
}

export async function reviewSuggestion(actor: Actor, id: string, body: SuggestionReviewBody): Promise<AdminSuggestion> {
  const reviewed = body.status === 'reviewed';
  const { rowCount } = await pool.query(
    `update public.suggestions
        set status = $2,
            admin_response = case when $3::boolean then $4 else admin_response end,
            reviewed_by = case when $2 = 'reviewed' then $5::uuid else null end,
            reviewed_at = case when $2 = 'reviewed' then coalesce(reviewed_at, now()) else null end
      where id = $1`,
    [id, body.status, body.response !== undefined, body.response ?? null, reviewed ? actor.id : null],
  );
  if (!rowCount) throw appError('SUGGESTION_NOT_FOUND');
  const { rows } = await pool.query(`${SELECT} where s.id = $1`, [id]);
  return toAdminSuggestion(rows[0]);
}

export async function newSuggestionCount(): Promise<number> {
  return (await pool.query<{ n: number }>("select count(*) as n from public.suggestions where status = 'new'")).rows[0]!.n;
}
