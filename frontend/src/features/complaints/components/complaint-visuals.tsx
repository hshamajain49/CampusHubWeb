// Complaint display pieces (COMPLAINT_REGISTRATION_SPEC.md §16): status badge, flags, category tile, the 4-step
// progress tracker, the list card and the activity timeline.
import * as React from 'react';
import { Link } from 'react-router';
import {
  Archive,
  ArrowRightLeft,
  Check,
  CheckCheck,
  CircleCheck,
  Flag,
  FlagOff,
  Hourglass,
  Image as ImageIcon,
  MapPin,
  RotateCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Timer,
  Undo2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  CLOSURE_TYPE_LABELS,
  COMPLAINT_STATUS_LABELS,
  type ClosureType,
  type ComplaintEvent,
  type ComplaintHistoryEntry,
  type ComplaintStatus,
  type ComplaintSummary,
} from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatTimestamp, timeAgo } from '@/lib/format';
import { Pill, RoleBadge } from '@/components/common/badges';
import { categoryIcon, onTint, tint } from '../lib/category-icons';

// ─────────────────────────── status badge (§16.1) ───────────────────────────
const STATUS: Record<ComplaintStatus, { cls: string; icon: LucideIcon }> = {
  pending_review: { cls: 'bg-[#FDF4DC] text-[#7A5A00]', icon: Hourglass },
  in_progress: { cls: 'bg-[#FDEEDD] text-[#9A5410]', icon: Wrench },
  awaiting_confirmation: { cls: 'bg-[#E8EDFA] text-[#1E3A8A]', icon: ThumbsUp },
  resolved: { cls: 'bg-[#E3F5EC] text-[#146C43]', icon: CircleCheck },
  withdrawn: { cls: 'bg-[#EEF0F4] text-[#4A5468]', icon: Undo2 },
  closed: { cls: 'bg-[#EEF0F4] text-[#4A5468]', icon: Archive },
};

/** Icon + label, never colour alone. */
export function ComplaintStatusBadge({ status, size = 'md', className }: { status: ComplaintStatus; size?: 'sm' | 'md'; className?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'chip inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-[11px] [&_svg]:size-3' : 'px-2.5 py-[3px] text-[12px] [&_svg]:size-3.5',
        s.cls,
        className,
      )}
    >
      <Icon aria-hidden strokeWidth={2.4} />
      {COMPLAINT_STATUS_LABELS[status]}
    </span>
  );
}

/** "Your review needed", "Rejected by reporter", "Reassignment requested", "Overdue" (§16.1 flags). */
export function ComplaintFlags({ c, viewer }: { c: ComplaintSummary; viewer: 'reporter' | 'staff' | 'admin' }) {
  const flags: React.ReactNode[] = [];
  if (viewer === 'reporter' && c.awaitingReporter) flags.push(<Pill key="review" tone="warning">Your review needed</Pill>);
  if (c.rejectedByReporter)
    flags.push(
      viewer === 'reporter' ? (
        <Pill key="rej">Sent back by you</Pill>
      ) : (
        <Pill key="rej" className="bg-[#FCE8E8] text-[#A52A2A]">
          Rejected by reporter
        </Pill>
      ),
    );
  if (viewer !== 'reporter' && c.reassignmentRequested)
    flags.push(
      <Pill key="re" className="bg-[#F1EBFE] text-[#5B21B6]">
        Reassignment requested
      </Pill>,
    );
  if (viewer !== 'reporter' && c.isOverdue) flags.push(<Pill key="od" tone="warning">Overdue</Pill>);
  return flags.length ? <span className="flex flex-wrap gap-1">{flags}</span> : null;
}

// ─────────────────────────── category tile ───────────────────────────
export function CategoryTile({ icon, color, size = 40, className }: { icon: string; color: string; size?: 28 | 32 | 40 | 44; className?: string }) {
  const Icon = categoryIcon(icon);
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-[10px]', className)}
      style={{ width: size, height: size, background: tint(color), color: onTint(color) }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

// ─────────────────────────── progress tracker (§16.3) ───────────────────────────
const STEPS: ComplaintStatus[] = ['pending_review', 'in_progress', 'awaiting_confirmation', 'resolved'];

export function ComplaintProgress({ status, viewer = 'reporter', className }: { status: ComplaintStatus; viewer?: 'reporter' | 'staff' | 'admin'; className?: string }) {
  if (status === 'withdrawn' || status === 'closed') {
    return (
      <div className={cn('flex items-center gap-2 rounded-[10px] bg-surface-muted px-3 py-2.5 text-[13px] font-semibold text-[#4A5468]', className)}>
        {status === 'withdrawn' ? <Undo2 className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
        Stopped — {COMPLAINT_STATUS_LABELS[status].toLowerCase()}
      </div>
    );
  }
  const labels = ['Submitted', 'In progress', viewer === 'reporter' ? 'Your review' : 'Reporter review', 'Resolved'];
  const current = STEPS.indexOf(status);
  const resolved = status === 'resolved';
  return (
    <ol className={cn('flex items-start', className)} aria-label={`Progress: step ${current + 1} of 4, ${labels[current]}`}>
      {labels.map((label, i) => {
        const done = i < current || resolved;
        const active = i === current && !resolved;
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && (
              // Steps are equal width: this line runs from the previous dot's centre to this one (dots sit on top).
              <span
                aria-hidden
                className={cn('absolute right-1/2 top-[11.5px] h-[3px] w-full', i <= current ? (resolved ? 'bg-success' : 'bg-primary') : 'bg-border')}
              />
            )}
            <span
              aria-hidden
              className={cn(
                'relative z-10 grid size-[26px] place-items-center rounded-full border-2 transition-colors duration-200',
                done && (resolved ? 'border-success bg-success text-white' : 'border-primary bg-primary text-white'),
                active && 'border-primary bg-surface',
                !done && !active && 'border-border bg-surface',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : active ? <span className="size-2.5 rounded-full bg-primary" /> : null}
            </span>
            <span className={cn('mt-1.5 px-1 text-[11.5px] font-semibold leading-4', done || active ? 'text-ink' : 'text-subtle')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────── card (CU01 / CS02 mobile) ───────────────────────────
export function ComplaintCard({ c, to, viewer, action }: { c: ComplaintSummary; to: string; viewer: 'reporter' | 'staff' | 'admin'; action?: React.ReactNode }) {
  const place = c.venue?.name ?? c.locationDetails;
  // Stretched-link card: the title link covers the card, so actions can sit on top without nesting interactive content.
  return (
    <div
      className={cn(
        'card lift press relative flex gap-3 p-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
        viewer === 'reporter' && c.awaitingReporter && 'border-l-[3px] border-l-warning',
      )}
    >
      <CategoryTile icon={c.category.icon} color={c.category.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={to} className="line-clamp-2 text-[15px] font-semibold leading-5 text-ink outline-none after:absolute after:inset-0 after:content-['']">
            {c.title}
          </Link>
          <ComplaintStatusBadge status={c.status} size="sm" className="mt-0.5" />
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">
          {c.category.name} · <span className="font-mono">{c.reference}</span>
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[12.5px] text-muted">
          {place && (
            <>
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{place}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="shrink-0">{timeAgo(c.createdAt)}</span>
          {c.photoCount > 0 && (
            <span className="ml-1 inline-flex shrink-0 items-center gap-0.5" title={`${c.photoCount} photo(s)`}>
              <ImageIcon className="size-3.5" aria-hidden />
              <span className="sr-only">photos:</span>
              {c.photoCount}
            </span>
          )}
        </p>
        {viewer !== 'reporter' && c.reporter && (
          <p className="mt-1 flex items-center gap-1.5 truncate text-[12.5px] text-ink">
            {c.reporter.fullName} <RoleBadge role={c.reporter.role} />
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ComplaintFlags c={c} viewer={viewer} />
          {action && <span className="relative z-10">{action}</span>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── timeline (§16.3) ───────────────────────────
const EVENT: Record<ComplaintEvent, { icon: LucideIcon; cls: string }> = {
  submitted: { icon: Send, cls: 'bg-primary-soft text-primary' },
  work_started: { icon: Wrench, cls: 'bg-[#FDEEDD] text-[#9A5410]' },
  work_completed: { icon: CheckCheck, cls: 'bg-[#E8EDFA] text-[#1E3A8A]' },
  approved: { icon: ThumbsUp, cls: 'bg-success-soft text-success-text' },
  rejected: { icon: ThumbsDown, cls: 'bg-destructive-soft text-destructive-text' },
  auto_resolved: { icon: Timer, cls: 'bg-success-soft text-success-text' },
  reopened: { icon: RotateCcw, cls: 'bg-[#FDEEDD] text-[#9A5410]' },
  reassigned: { icon: ArrowRightLeft, cls: 'bg-[#F1EBFE] text-[#5B21B6]' },
  reassignment_requested: { icon: Flag, cls: 'bg-[#F1EBFE] text-[#5B21B6]' },
  reassignment_dismissed: { icon: FlagOff, cls: 'bg-surface-muted text-muted' },
  withdrawn: { icon: Undo2, cls: 'bg-surface-muted text-[#4A5468]' },
  closed: { icon: Archive, cls: 'bg-surface-muted text-[#4A5468]' },
};

function eventTitle(h: ComplaintHistoryEntry, meId?: string): string {
  const by = h.actor ? (h.actor.id === meId ? 'you' : h.actor.fullName) : 'the system';
  const ch = h.changes as Record<string, any>;
  switch (h.eventType) {
    case 'submitted':
      return 'Complaint submitted';
    case 'work_started':
      return `Work started by ${by}`;
    case 'work_completed':
      return `Marked as done by ${by}`;
    case 'approved':
      return `Approved by ${by}`;
    case 'rejected':
      return `Sent back by ${by}`;
    case 'auto_resolved':
      return 'Resolved automatically';
    case 'reopened':
      return `Reopened by ${by}`;
    case 'reassigned':
      return `Moved from ${ch.department?.fromName ?? 'another department'} to ${ch.department?.toName ?? 'another department'}`;
    case 'reassignment_requested':
      return `Reassignment requested by ${by}${ch.suggestedCategory ? ` (suggested: ${ch.suggestedCategory})` : ''}`;
    case 'reassignment_dismissed':
      return 'Reassignment request dismissed';
    case 'withdrawn':
      return `Withdrawn by ${by}`;
    case 'closed':
      return `Closed by the administrator — ${CLOSURE_TYPE_LABELS[ch.closureType as ClosureType] ?? 'closed'}`;
  }
}

/** Oldest first, like the booking timeline. Notes on actions are shown in a quote block. */
export function ComplaintTimeline({ history, timeZone, meId }: { history: ComplaintHistoryEntry[]; timeZone: string; meId?: string }) {
  return (
    <ol className="relative grid gap-5">
      <span aria-hidden className="absolute bottom-3 left-[15px] top-3 w-px bg-border" />
      {history.map((h) => {
        const e = EVENT[h.eventType];
        const Icon = e.icon;
        return (
          <li key={h.id} className="relative flex gap-3">
            <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-surface', e.cls)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm font-semibold text-ink">{eventTitle(h, meId)}</p>
              <p className="tabular text-[12px] text-muted">{formatTimestamp(h.createdAt, timeZone)}</p>
              {h.note && <p className="mt-2 whitespace-pre-line rounded-[10px] bg-surface-muted px-3 py-2 text-[13px] text-ink">{h.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
