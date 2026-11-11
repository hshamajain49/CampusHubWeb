import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Check, ChevronRight, Search, TriangleAlert, X } from 'lucide-react';
import { addDays, type AdminBookingListItem } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatDuration, formatTimeRange, timeAgo, formatNumber } from '@/lib/format';
import { useDebouncedValue, useDocumentTitle } from '@/hooks/misc';
import { useCampusNow } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/menus';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { BookingDateBlock } from '@/components/common/booking-visuals';
import { RoleBadge } from '@/components/common/badges';
import { Pagination, UserAvatar } from '@/components/common/small';
import { useAdminBookings, useAllVenueOptions } from '../api';
import { DecisionDialog, StartsInChip, type DecisionMode } from '../bookings/decision-dialogs';
import { patchParams } from '@/lib/search-params';

export function PendingRequestCard({ b, today, onDecide, leaving }: { b: AdminBookingListItem; today?: string; onDecide: (m: DecisionMode) => void; leaving: boolean }) {
  const ratio = b.expectedAttendees ? b.expectedAttendees / b.venue.capacity : 0;
  return (
    // Leaving cards collapse: opacity with a grid-row height collapse (200 ms) before the refetch removes them.
    <div className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out', leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}>
      <div className="min-h-0 overflow-hidden">
        <article className="card mb-3 flex flex-col gap-4 p-4 md:flex-row md:items-start md:p-5">
          <div className="flex gap-4 md:w-[120px] md:flex-col md:gap-2">
            <BookingDateBlock date={b.date} />
            <div className="md:mt-1">
              <p className="tabular text-sm font-semibold text-ink">{formatTimeRange(b.startTime, b.endTime)}</p>
              <p className="tabular text-[12px] text-muted">{formatDuration(b.durationMinutes)}</p>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-[16px] font-semibold text-ink">{b.venue.name}</h3>
              <span className="font-mono text-[12px] text-subtle">{b.reference}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-[13.5px] leading-5 text-ink">{b.purpose}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={b.requester.fullName} role={b.requester.role} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{b.requester.fullName}</span>
                  <span className="block truncate text-[12px] text-muted">{b.requester.email}</span>
                </span>
                <RoleBadge role={b.requester.role} />
              </span>
              <span className={cn('tabular inline-flex items-center gap-1 text-[12.5px]', ratio > 0.9 ? 'font-semibold text-warning-text' : 'text-muted')}>
                {ratio > 0.9 && <TriangleAlert className="size-3.5" aria-hidden />}
                {b.expectedAttendees ? `${formatNumber(b.expectedAttendees)} of ${formatNumber(b.venue.capacity)} capacity` : `Capacity ${formatNumber(b.venue.capacity)}`}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 md:w-[210px] md:flex-col md:items-end md:border-0 md:pt-0">
            <StartsInChip date={b.date} today={today} />
            <span className="text-[12px] text-muted">Submitted {timeAgo(b.createdAt)}</span>
            <div className="flex w-full gap-2 md:mt-2 md:justify-end">
              <Tooltip content={!b.permissions.canApprove ? (!b.venue.isActive ? 'Venue inactive' : !b.requester.isActive ? 'Requester deactivated' : 'Start time has passed') : null}>
                <span className="flex-1 md:flex-none">
                  <Button className="w-full" onClick={() => onDecide('approve')} disabled={!b.permissions.canApprove}>
                    <Check /> Approve
                  </Button>
                </span>
              </Tooltip>
              <Button variant="destructive-outline" className="flex-1 md:flex-none" onClick={() => onDecide('reject')}>
                <X /> Reject
              </Button>
            </div>
            <Link to={`/admin/bookings/${b.id}`} className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-primary hover:underline">
              Details <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}

const WITHIN = [
  { value: 'any', label: 'Starts any time' },
  { value: '1', label: 'Starts within 24 h' },
  { value: '7', label: 'Starts within 7 days' },
  { value: '30', label: 'Starts within 30 days' },
];

export default function ApprovalsPage() {
  useDocumentTitle('Approvals');
  const [params, setParams] = useSearchParams();
  const now = useCampusNow();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const venueId = params.get('venueId') ?? '';
  const within = params.get('within') ?? 'any';
  const page = Number(params.get('page') || 1);
  const venues = useAllVenueOptions();
  const [decision, setDecision] = React.useState<{ b: AdminBookingListItem; mode: DecisionMode } | null>(null);
  const [leaving, setLeaving] = React.useState<Set<string>>(new Set());

  const list = useAdminBookings(
    {
      status: ['pending'],
      sort: 'start:asc',
      q: dq || undefined,
      venueId: venueId || undefined,
      dateTo: within !== 'any' && now ? addDays(now.date, Number(within)) : undefined,
      page,
      pageSize: 20,
    },
    { poll: true },
  );

  const set = (patch: Record<string, string | null>) => {
    setParams(patchParams(params, patch), { replace: true });
  };
  React.useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  React.useEffect(() => setLeaving(new Set()), [list.dataUpdatedAt]);

  const total = list.data?.meta.total ?? 0;
  return (
    <div>
      <PageHeader title="Approvals" description={list.data ? `${total} ${total === 1 ? 'request' : 'requests'} waiting` : 'Loading requests…'} />
      <div className="mb-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search requests" placeholder="Search reference, purpose or requester" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select
          aria-label="Venue"
          value={venueId || 'all'}
          onValueChange={(v) => set({ venueId: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All venues' }, ...(venues.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))]}
        />
        <Select aria-label="Starts within" value={within} onValueChange={(v) => set({ within: v === 'any' ? null : v })} options={WITHIN} />
      </div>

      {list.isLoading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[150px] rounded-[14px]" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : total === 0 ? (
        <div className="card">
          <EmptyState icon={Check} tone="teal" title="You're all caught up" message="No pending requests right now." />
        </div>
      ) : (
        <>
          <div className="stagger">
            {list.data!.data.map((b) => (
              <PendingRequestCard key={b.id} b={b} today={now?.date} leaving={leaving.has(b.id)} onDecide={(mode) => setDecision({ b, mode })} />
            ))}
          </div>
          <Pagination page={page} pageSize={20} total={total} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />
        </>
      )}
      <DecisionDialog
        booking={decision?.b ?? null}
        mode={decision?.mode ?? null}
        onClose={() => setDecision(null)}
        onDone={() => decision && setLeaving((s) => new Set(s).add(decision.b.id))}
      />
    </div>
  );
}
