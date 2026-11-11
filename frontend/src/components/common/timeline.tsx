import { Ban, CircleCheck, CircleX, PencilLine, Send, TimerOff } from 'lucide-react';
import type { HistoryEntry } from '@campushub/shared';
import { STATUS_LABELS } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatShortDay, formatTimestamp } from '@/lib/format';

const EVENT = {
  submitted: { icon: Send, cls: 'bg-primary-soft text-primary', title: 'Request submitted' },
  approved: { icon: CircleCheck, cls: 'bg-success-soft text-success-text', title: 'Approved' },
  rejected: { icon: CircleX, cls: 'bg-destructive-soft text-destructive-text', title: 'Rejected' },
  cancelled: { icon: Ban, cls: 'bg-surface-muted text-[#4A5468]', title: 'Cancelled' },
  modified: { icon: PencilLine, cls: 'bg-secondary-soft text-secondary-text', title: 'Changed' },
  expired: { icon: TimerOff, cls: 'bg-[#FDEEDD] text-[#9A5410]', title: 'Expired' },
} as const;

const FIELD_LABELS: Record<string, string> = {
  date: 'Date',
  startTime: 'Start',
  endTime: 'End',
  purpose: 'Purpose',
  expectedAttendees: 'Attendees',
};

function changeValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'date' && typeof v === 'string') return formatShortDay(v);
  if (field === 'purpose' && typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  return String(v);
}

/** Vertical activity timeline, oldest first (U14, A05). */
export function Timeline({ history, timeZone, meId }: { history: HistoryEntry[]; timeZone: string; meId?: string }) {
  return (
    <ol className="relative grid gap-5">
      <span aria-hidden className="absolute bottom-3 left-[15px] top-3 w-px bg-border" />
      {history.map((h) => {
        const e = EVENT[h.eventType];
        const Icon = e.icon;
        const by = h.actor ? (h.actor.id === meId ? 'you' : h.actor.fullName) : 'the system';
        const title =
          h.eventType === 'modified'
            ? `Changed by ${by}`
            : h.eventType === 'expired'
              ? 'Expired without a decision'
              : `${e.title} by ${by}`;
        const changes = Object.entries(h.changes ?? {});
        return (
          <li key={h.id} className="relative flex gap-3">
            <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-surface', e.cls)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="tabular text-[12px] text-muted">{formatTimestamp(h.createdAt, timeZone)}</p>
              {changes.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {changes.map(([field, c]) => (
                    <li key={field} className="tabular rounded-[8px] bg-surface-muted px-2 py-1 text-[12px] text-ink">
                      <span className="text-muted">{FIELD_LABELS[field] ?? field}:</span> {changeValue(field, c.from)} → {changeValue(field, c.to)}
                    </li>
                  ))}
                </ul>
              )}
              {h.eventType === 'modified' && h.fromStatus === 'approved' && h.toStatus === 'pending' && (
                <p className="mt-1.5 text-[12px] font-medium text-warning-text">Returned to {STATUS_LABELS.pending.toLowerCase()}</p>
              )}
              {h.note && <p className="mt-2 whitespace-pre-line rounded-[10px] bg-surface-muted px-3 py-2 text-[13px] text-ink">{h.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
