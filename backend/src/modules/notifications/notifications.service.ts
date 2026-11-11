// Own notifications (E48–E51). Delivery statuses are never exposed.
import type { NotificationItem } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { listMeta, offsetOf } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';

function toItem(r: any): NotificationItem {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    bookingId: r.booking_id,
    linkPath: r.link_path,
    isRead: !!r.read_at,
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listNotifications(userId: string, q: { unreadOnly: boolean; page: number; pageSize: number }) {
  const filter = q.unreadOnly ? 'and read_at is null' : '';
  const [count, unread, rows] = await Promise.all([
    pool.query<{ n: number }>(`select count(*) as n from public.notifications where recipient_id = $1 ${filter}`, [userId]),
    pool.query<{ n: number }>('select count(*) as n from public.notifications where recipient_id = $1 and read_at is null', [userId]),
    pool.query(
      `select * from public.notifications where recipient_id = $1 ${filter} order by created_at desc, id limit $2 offset $3`,
      [userId, q.pageSize, offsetOf(q.page, q.pageSize)],
    ),
  ]);
  return { data: rows.rows.map(toItem), meta: { ...listMeta(q.page, q.pageSize, count.rows[0]!.n), unreadCount: unread.rows[0]!.n } };
}

export async function unreadCount(userId: string) {
  const { rows } = await pool.query<{ n: number }>(
    'select count(*) as n from public.notifications where recipient_id = $1 and read_at is null',
    [userId],
  );
  return { count: rows[0]!.n };
}

export async function markRead(userId: string, id: string) {
  const res = await pool.query(
    'update public.notifications set read_at = coalesce(read_at, now()) where id = $1 and recipient_id = $2',
    [id, userId],
  );
  if (!res.rowCount) throw appError('NOTIFICATION_NOT_FOUND');
}

export async function markAllRead(userId: string) {
  const res = await pool.query('update public.notifications set read_at = now() where recipient_id = $1 and read_at is null', [userId]);
  return { updated: res.rowCount ?? 0 };
}
