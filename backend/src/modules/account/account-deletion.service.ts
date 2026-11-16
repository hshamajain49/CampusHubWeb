// Permanent account deletion (docs/ACCOUNTS.md). The member's own data goes; what other people's records say about them
// becomes "Deleted user" (foreign keys ON DELETE SET NULL). One anonymous audit entry is kept as the retention record.
import { ROLE_LABELS } from '@campushub/shared';
import { withTransaction } from '../../db/transaction.js';
import { appError } from '../../errors/app-error.js';
import { verifyPassword } from '../../lib/auth-accounts.js';
import { logger } from '../../lib/logger.js';
import { privateStore } from '../../lib/storage.js';
import { loadCampus } from '../../domain/settings.js';
import type { ProfileRow } from '../../types/express.js';
import { audit } from '../audit/audit-writer.js';
import { UPCOMING_SQL } from '../bookings/booking.queries.js';
import { promoteAndNotify } from '../bookings/bookings.service.js';

export interface DeletionSummary {
  bookingsDeleted: number;
  complaintsDeleted: number;
  suggestionsDeleted: number;
}

/**
 * Deletes the signed-in member's account after checking their password:
 *  - upcoming bookings are cancelled first, so anyone queued for that time gets it (FIFO, notified as usual);
 *  - their bookings, complaints (with photos), suggestions, notifications, push devices and sessions are deleted;
 *  - history and audit entries they wrote on other people's records stay, with the person shown as "Deleted user";
 *  - the last active Super Admin can't delete their account (LAST_SUPER_ADMIN).
 */
export async function deleteOwnAccount(profile: ProfileRow, body: { password: string }): Promise<DeletionSummary> {
  if (!(await verifyPassword(profile.id, body.password))) {
    throw appError('INVALID_CURRENT_PASSWORD', 'Your password is incorrect.', { field: 'password' });
  }

  let photoKeys: string[] = [];
  const summary = await withTransaction({ actorId: null }, async (tx) => {
    // Venues of the member's upcoming bookings first, in a fixed order (like every booking writer), then the profile.
    const { localNow } = await loadCampus(tx);
    const now = localNow.replace('T', ' ');
    const venues = (
      await tx.query<{ id: string }>(
        `select v.id from public.venues v
          where v.id in (select b.venue_id from public.bookings b where b.requester_id = $1 and ${UPCOMING_SQL('$2::timestamp')})
          order by v.id for update`,
        [profile.id, now],
      )
    ).rows.map((r) => r.id);
    const me = (await tx.query('select * from public.profiles where id = $1 for update', [profile.id])).rows[0];
    if (!me) throw appError('USER_NOT_FOUND');
    if (me.role === 'super_admin') {
      const others = (
        await tx.query<{ n: number }>(
          "select count(*) as n from public.profiles where role = 'super_admin' and is_active and id <> $1",
          [profile.id],
        )
      ).rows[0]!.n;
      if (others === 0) throw appError('LAST_SUPER_ADMIN');
    }

    // 1. Free the member's upcoming slots for the queue.
    await tx.query(
      `update public.bookings b set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Account deleted'
        where b.requester_id = $1 and ${UPCOMING_SQL('$2::timestamp')}`,
      [profile.id, now],
    );
    for (const venueId of venues) await promoteAndNotify(tx, venueId, null);

    // 2. The member's complaints and their photos (objects are removed after commit).
    photoKeys = (
      await tx.query<{ storage_path: string; thumb_path: string }>(
        `select a.storage_path, a.thumb_path from public.complaint_attachments a
           join public.complaints c on c.id = a.complaint_id where c.reporter_id = $1`,
        [profile.id],
      )
    ).rows.flatMap((r) => [r.storage_path, r.thumb_path]);
    const complaints = await tx.query('delete from public.complaints where reporter_id = $1', [profile.id]);

    // 3. Bookings (history, reminders and their notifications cascade) and suggestions.
    const bookings = await tx.query('delete from public.bookings where requester_id = $1', [profile.id]);
    const suggestions = await tx.query('delete from public.suggestions where author_id = $1', [profile.id]);

    const result: DeletionSummary = {
      bookingsDeleted: bookings.rowCount ?? 0,
      complaintsDeleted: complaints.rowCount ?? 0,
      suggestionsDeleted: suggestions.rowCount ?? 0,
    };
    // Retention record: anonymous (no name, email, IP or device), so it outlives the account without personal data.
    await audit(tx, null, {
      action: 'user.deleted',
      entityType: 'user',
      entityId: profile.id,
      summary: `A ${ROLE_LABELS[me.role as keyof typeof ROLE_LABELS].toLowerCase()} deleted their account`,
      metadata: { role: me.role, ...result },
    });

    // 4. The login itself: profile, sessions, credentials, notifications and push devices cascade from auth_users.
    await tx.query('delete from public.auth_users where id = $1', [profile.id]);
    return result;
  });

  if (photoKeys.length) {
    await privateStore.remove(photoKeys).catch((err) => logger.error({ err, keys: photoKeys }, 'deleted-account photo clean-up failed'));
  }
  return summary;
}
