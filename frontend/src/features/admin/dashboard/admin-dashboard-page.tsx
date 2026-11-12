import * as React from 'react';
import { Link } from 'react-router';
import {
  AlarmClock,
  Building2,
  CalendarCheck,
  CalendarRange,
  Check,
  ChartColumn,
  CircleSlash,
  Construction,
  Flag,
  Hourglass,
  Inbox,
  Megaphone,
  PartyPopper,
  ThumbsUp,
  Timer,
  Users,
  X,
} from 'lucide-react';
import { BLOCK_TYPE_LABELS, type AdminBookingListItem, type HistoryEvent } from '@campushub/shared';
import { formatDate, formatLongDate, formatPercent, formatShortDay, formatTimeRange, timeAgo } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/menus';
import { PageHeader, SectionCard, StatCard, ViewAllLink } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { BookingDateBlock } from '@/components/common/booking-visuals';
import { UserAvatar } from '@/components/common/small';
import { useAdminDashboard } from '@/layouts/admin-layout';
import { DecisionDialog, StartsInChip, type DecisionMode } from '../bookings/decision-dialogs';
import { CategoryTile } from '@/features/complaints/components/complaint-visuals';

const VERB: Record<HistoryEvent, string> = {
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
  modified: 'changed',
  expired: 'expired',
};

const BLOCK_ICON = { maintenance: Construction, special_event: PartyPopper, other: CircleSlash } as const;

export default function AdminDashboardPage() {
  useDocumentTitle('Admin dashboard');
  const me = useMe();
  const now = useCampusNow();
  const { data: settings } = usePublicSettings();
  const dash = useAdminDashboard();
  const [decision, setDecision] = React.useState<{ b: AdminBookingListItem; mode: DecisionMode } | null>(null);
  const today = now?.date;

  if (dash.isError && !dash.data) return <ErrorState onRetry={() => dash.refetch()} />;
  const d = dash.data;
  const k = d?.kpis;

  return (
    <div className="grid gap-6">
      <PageHeader
        className="mb-0"
        title="Dashboard"
        description={today ? `${formatLongDate(today)}${settings ? ` · ${settings.institutionName}` : ''}` : undefined}
      />

      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {!k ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[138px] rounded-[14px]" />)
        ) : (
          <>
            <StatCard icon={Hourglass} tone="pending" label="Pending requests" value={k.pendingCount} detail={k.oldestPendingSubmittedAt ? `Oldest waiting ${timeAgo(k.oldestPendingSubmittedAt)}` : 'Nothing waiting'} to="/admin/approvals" />
            <StatCard icon={CalendarCheck} tone="approved" label="Today's bookings" value={k.todayApprovedCount} detail="Approved, today" to={`/admin/bookings?status=approved&dateFrom=${today}&dateTo=${today}`} />
            <StatCard icon={CalendarRange} tone="teal" label="Next 7 days" value={k.next7DaysApprovedCount} detail="Approved bookings" to={`/admin/bookings?status=approved&dateFrom=${today}`} />
            <StatCard icon={Building2} tone="primary" label="Active venues" value={k.activeVenues} detail={`${k.inactiveVenues} inactive`} to="/admin/venues" />
            <StatCard icon={Users} tone="violet" label="Active members" value={k.activeMembers} detail="Students, faculty/staff and department staff" to="/admin/users" />
            <StatCard icon={ChartColumn} tone="neutral" label="Approval rate (30 days)" value={formatPercent(k.approvalRate30d)} detail="Approved ÷ decided" to="/admin/reports" />
          </>
        )}
      </div>

      <section aria-labelledby="complaint-kpis">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 id="complaint-kpis" className="eyebrow">
            Complaints
          </h2>
          <ViewAllLink to="/admin/complaints">All complaints</ViewAllLink>
        </div>
        <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6 lg:gap-4">
          {!d ? (
            Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[138px] rounded-[14px]" />)
          ) : (
            <>
              <StatCard icon={Megaphone} tone="primary" label="Open" value={d.complaintKpis.open} to="/admin/complaints" />
              <StatCard icon={Inbox} tone="teal" label="New today" value={d.complaintKpis.newToday} to={`/admin/complaints?dateFrom=${today}&dateTo=${today}`} />
              <StatCard icon={ThumbsUp} tone="violet" label="Awaiting reporter" value={d.complaintKpis.awaitingReporter} to="/admin/complaints?status=awaiting_confirmation" />
              <StatCard icon={Flag} tone={d.complaintKpis.needsReassignment ? 'pending' : 'neutral'} label="Needs reassignment" value={d.complaintKpis.needsReassignment} to="/admin/complaints?flag=reassignment" />
              <StatCard icon={AlarmClock} tone={d.complaintKpis.overdue ? 'pending' : 'neutral'} label="Overdue (> 7 days)" value={d.complaintKpis.overdue} to="/admin/complaints?flag=overdue" />
              <StatCard
                icon={Timer}
                tone="approved"
                label="Avg. resolution (30 days)"
                value={d.complaintKpis.avgResolutionHours30d === null ? '—' : `${d.complaintKpis.avgResolutionHours30d} h`}
                to="/admin/reports?tab=complaints"
              />
            </>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          {d && d.complaintsNeedingReassignment.length > 0 && (
            <SectionCard title="Complaints needing reassignment" action={<ViewAllLink to="/admin/complaints?flag=reassignment" />} bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
              <ul className="grid">
                {d.complaintsNeedingReassignment.map((c) => (
                  <li key={c.id}>
                    <Link to={`/admin/complaints/${c.id}`} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-surface-muted">
                      <CategoryTile icon={c.category.icon} color={c.category.color} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{c.title}</span>
                        <span className="block truncate text-[12.5px] text-muted">
                          <span className="font-mono">{c.reference}</span> · {c.department.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] text-muted">{timeAgo(c.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
          <SectionCard title="Needs attention" action={<ViewAllLink to="/admin/approvals">View all requests</ViewAllLink>} bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
            {!d ? (
              <div className="grid gap-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : d.needsAttention.length === 0 ? (
              <EmptyState compact icon={Check} tone="teal" title="You're all caught up" message="No pending requests right now." />
            ) : (
              <ul className="grid">
                {d.needsAttention.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-surface-muted/70">
                    <BookingDateBlock date={b.date} className="w-12 [&>span:last-child]:text-[18px]" />
                    <Link to={`/admin/bookings/${b.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{b.venue.name}</span>
                      <span className="tabular block truncate text-[12.5px] text-muted">
                        {formatTimeRange(b.startTime, b.endTime)} · {b.requester.fullName}
                      </span>
                      <StartsInChip date={b.date} today={today} className="mt-1" />
                    </Link>
                    <div className="flex shrink-0 gap-1">
                      <Tooltip content="Approve">
                        <Button size="icon-sm" variant="outline" aria-label={`Approve ${b.reference}`} disabled={!b.permissions.canApprove} onClick={() => setDecision({ b, mode: 'approve' })}>
                          <Check className="size-4 text-success-text" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Reject">
                        <Button size="icon-sm" variant="outline" aria-label={`Reject ${b.reference}`} onClick={() => setDecision({ b, mode: 'reject' })}>
                          <X className="size-4 text-destructive-text" />
                        </Button>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Today's schedule" bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
            {!d ? (
              <Skeleton className="m-2 h-24" />
            ) : d.todaySchedule.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">No bookings today.</p>
            ) : (
              <ol className="grid">
                {d.todaySchedule.map((b) => (
                  <li key={b.id}>
                    <Link to={`/admin/bookings/${b.id}`} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 rounded-[10px] px-3 py-2.5 hover:bg-surface-muted">
                      <span className="tabular text-[13px] font-semibold text-ink">{formatTimeRange(b.startTime, b.endTime)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{b.venue.name}</span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {b.requester.fullName} · {b.purpose}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="grid content-start gap-6">
          <SectionCard title="Upcoming blocks" action={<ViewAllLink to="/admin/venues">Venues</ViewAllLink>} bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
            {!d ? (
              <Skeleton className="m-2 h-24" />
            ) : d.upcomingBlocks.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">No upcoming blocks.</p>
            ) : (
              <ul className="grid">
                {d.upcomingBlocks.map((bl) => {
                  const Icon = BLOCK_ICON[bl.blockType];
                  return (
                    <li key={bl.id}>
                      <Link to={`/admin/venues/${bl.venue.id}?tab=blocks`} className="flex items-start gap-3 rounded-[10px] px-3 py-2.5 hover:bg-surface-muted">
                        <span className="slot-blocked grid size-9 shrink-0 place-items-center rounded-[10px] text-[#334155]">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {bl.venue.name} · {BLOCK_TYPE_LABELS[bl.blockType]}
                          </span>
                          <span className="tabular block text-[12.5px] text-muted">
                            {formatShortDay(bl.start.slice(0, 10))} {bl.start.slice(11, 16)} → {formatShortDay(bl.end.slice(0, 10))} {bl.end.slice(11, 16)}
                          </span>
                          <span className="block truncate text-[12.5px] text-muted">{bl.reason}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Recent activity" bodyClassName="px-2 pb-2 md:px-3 md:pb-3">
            {!d ? (
              <Skeleton className="m-2 h-40" />
            ) : d.recentActivity.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">No activity yet.</p>
            ) : (
              <ul className="grid">
                {d.recentActivity.map((a) => {
                  const who = a.actor ? (a.actor.id === me.id ? 'You' : a.actor.fullName) : 'System';
                  return (
                    <li key={a.historyId}>
                      <Link to={`/admin/bookings/${a.bookingId}`} className="flex items-center gap-3 rounded-[10px] px-3 py-2 hover:bg-surface-muted">
                        <UserAvatar name={a.actor?.fullName ?? 'System'} role={a.actor?.role} size={28} />
                        <span className="min-w-0 flex-1 text-[13px] text-ink">
                          <span className="font-semibold">{who}</span> {a.eventType === 'expired' ? 'expired' : VERB[a.eventType]}{' '}
                          <span className="font-mono text-[12.5px]">{a.reference}</span>
                          <span className="block truncate text-[12px] text-muted">{a.venueName}</span>
                        </span>
                        <span className="shrink-0 text-[12px] text-subtle" title={formatDate(a.createdAt.slice(0, 10))}>
                          {timeAgo(a.createdAt)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <DecisionDialog booking={decision?.b ?? null} mode={decision?.mode ?? null} onClose={() => setDecision(null)} />
    </div>
  );
}
