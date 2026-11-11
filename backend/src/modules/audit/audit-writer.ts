// Audit rows are written in the same transaction as the change they describe (§21.16).
import type { AuditEntityType } from '@campushub/shared';
import type { DbClient } from '../../db/pool.js';
import type { Actor } from '../../middleware/authenticate.js';

export async function audit(
  db: DbClient,
  actor: Actor | null,
  entry: { action: string; entityType: AuditEntityType; entityId: string | null; summary: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, metadata, ip_address, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7::inet, $8)`,
    [
      actor?.id ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.summary,
      JSON.stringify(entry.metadata ?? {}),
      actor?.ip && /^[0-9a-fA-F.:]+$/.test(actor.ip) ? actor.ip.replace(/^::ffff:/, '') : null,
      actor?.userAgent ?? null,
    ],
  );
}
