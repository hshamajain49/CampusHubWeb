// Audit rows are written in the same transaction as the change they describe (§21.16).
import type { AuditEntityType } from '@campushub/shared';
import type { DbClient } from '../../db/pool.js';
import type { Actor } from '../../middleware/authenticate.js';
import { cleanIp, sentinel, type SecurityEvent } from '../../lib/sentinel.js';
import { logger } from '../../lib/logger.js';

/**
 * The Sentinel event for an audited admin action. Role changes and settings changes get their own categories (they
 * drive the privilege- and configuration-change rules); everything else is an informational admin.action.
 * Only field names and roles leave CampusHub, never names, emails or other values.
 */
export function auditEvent(actor: Actor | null, entry: { action: string; entityType: string; entityId: string | null; summary: string; metadata?: Record<string, unknown> }): SecurityEvent {
  const base = { sourceIp: cleanIp(actor?.ip), userRef: actor?.id ?? null, actorRole: actor?.role ?? null, simulated: !!actor?.simulated };
  const after = (entry.metadata?.after ?? null) as Record<string, unknown> | null;
  const before = (entry.metadata?.before ?? null) as Record<string, unknown> | null;
  const changed = after ? Object.keys(after) : [];
  if (entry.action === 'user.updated' && after && 'role' in after) {
    return {
      ...base,
      category: 'privilege.changed',
      severity: after.role === 'super_admin' ? 'critical' : 'high',
      description: `An account's role was changed from ${String(before?.role ?? '?')} to ${String(after.role)}.`,
      details: { action: entry.action, targetRef: entry.entityId, fromRole: before?.role ?? null, toRole: after.role },
    };
  }
  if (entry.action === 'settings.updated') {
    return { ...base, category: 'config.changed', severity: 'medium', description: `Booking settings changed: ${changed.join(', ') || 'unknown fields'}.`, details: { action: entry.action, fields: changed } };
  }
  return {
    ...base,
    category: 'admin.action',
    severity: entry.action.endsWith('.deleted') ? 'low' : 'info',
    description: `Admin action: ${entry.action}.`,
    details: { action: entry.action, entityType: entry.entityType, targetRef: entry.entityId, ...(changed.length ? { fields: changed } : {}) },
  };
}

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
  if (!sentinel.enabled) return;
  // Reported only once the change is committed (a rolled-back action never happened).
  const send = () => {
    try {
      sentinel.report(auditEvent(actor, entry));
    } catch (err) {
      logger.warn({ err }, 'sentinel audit report failed');
    }
  };
  const tx = db as { afterCommit?: (cb: () => unknown) => void };
  if (typeof tx.afterCommit === 'function') tx.afterCommit(send);
  else send();
}
