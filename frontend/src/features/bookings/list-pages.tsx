import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CalendarDays, CalendarPlus, ChevronDown, Eye, History, MoreHorizontal, Repeat, X } from 'lucide-react';
import type { BookingStatus, BookingSummary } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatTimeRange, monthKey, timeAgo } from '@/lib/format';
import { useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { useCampusNow } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Checkbox, Skeleton } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { BookingCard } from '@/components/common/booking-visuals';
import { StatusBadge } from '@/components/common/badges';
import { Pagination, Segmented } from '@/components/common/small';
import { DatePicker } from '@/components/common/pickers';
import { useMyBookings } from './api';
import { patchParams } from '@/lib/search-params';

function SubNav({ active }: { active: 'upcoming' | 'history' }) {
  const items = [
    { to: '/bookings', label: 'Upcoming', key: 'upcoming', icon: CalendarDays },
    { to: '/bookings/history', label: 'History', key: 'history', icon: History },
  ];
  return (
    <nav aria-label="Bookings" className="mb-5 flex gap-1 border-b border-border">
      {items.map((i) => (
        <Link
          key={i.key}
          to={i.to}
          aria-current={active === i.key ? 'page' : undefined}
          className={cn(
            'relative -mb-px flex h-10 items-center gap-2 px-3 text-sm font-semibold transition-colors duration-150',
            active === i.key ? 'text-primary' : 'text-muted hover:text-ink',
          )}
        >
          <i.icon className="size-4" />
          {i.label}
          {active === i.key && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
        </Link>
      ))}
    </nav>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[112px] rounded-[14px]" />
      ))}
    </div>
  );
}

export function MyBookingsPage() {
  useDocumentTitle('My bookings');
  const [params, setParams] = useSearchParams();
  const now = useCampusNow();
  const status = (params.get('status') as 'pending' | 'approved' | null) ?? 'all';
  const page = Number(params.get('page') || 1);
  const q = useMyBookings({ scope: 'upcoming', sort: 'start:asc', status: status === 'all' ? undefined : [status], page, pageSize: 20 });

  const groups = React.useMemo(() => {
    const out: { month: string; items: BookingSummary[] }[] = [];
    for (const b of q.data?.data ?? []) {
      const m = monthKey(b.date);
      const last = out[out.length - 1];
      if (last?.month === m) last.items.push(b);
      else out.push({ month: m, items: [b] });
    }
    return out;
  }, [q.data]);

  return (
    <div>
      <PageHeader
        title="My bookings"
        description="Requests waiting for a decision and confirmed bookings that haven't ended yet."
        actions={
          <Button asChild>
            <Link to="/venues">
              <CalendarPlus /> Book a venue
            </Link>
          </Button>
        }
      />
      <SubNav active="upcoming" />
      <Segmented
        aria-label="Filter by status"
        className="mb-5"
        value={status}
        onChange={(v) => setParams(v === 'all' ? {} : { status: v }, { replace: true })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
        ]}
      />
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <div className="card">
          <ErrorState onRetry={() => q.refetch()} />
        </div>
      ) : !q.data!.data.length ? (
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title={status === 'all' ? 'No bookings yet' : `No ${status} bookings`}
            message="Reserve a venue and it will show up here."
            action={
              <Button asChild>
                <Link to="/venues">Browse venues</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-6">
          {groups.map((g) => (
            <section key={g.month} aria-labelledby={`m-${g.month}`}>
              <h2 id={`m-${g.month}`} className="eyebrow mb-2.5">
                {g.month}
              </h2>
              <div className="stagger grid gap-3 md:grid-cols-2">
                {g.items.map((b) => (
                  <BookingCard key={b.id} booking={b} to={`/bookings/${b.id}`} today={now?.date} />
                ))}
              </div>
            </section>
          ))}
          <Pagination page={page} pageSize={20} total={q.data!.meta.total} onPage={(p) => setParams({ ...(status !== 'all' ? { status } : {}), page: String(p) })} />
        </div>
      )}
    </div>
  );
}

const HISTORY_STATUSES: { value: BookingStatus; label: string }[] = [
  { value: 'approved', label: 'Approved (past)' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

function reasonOf(b: BookingSummary) {
  return b.status === 'rejected' ? b.rejectionReason : b.status === 'cancelled' ? b.cancellationReason : null;
}

function RowMenu({ b }: { b: BookingSummary }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${b.reference}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => navigate(`/bookings/${b.id}`)}>
          <Eye /> View details
        </DropdownMenuItem>
        {b.permissions.canRebook && (
          <DropdownMenuItem onSelect={() => navigate(`/bookings/new?venueId=${b.venue.id}&purpose=${encodeURIComponent(b.purpose)}`)}>
            <Repeat /> Book again
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BookingHistoryPage() {
  useDocumentTitle('Booking history');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mdUp = useIsMdUp();
  const statuses = (params.get('status')?.split(',').filter(Boolean) ?? []) as BookingStatus[];
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') || 1);
  const q = useMyBookings({ scope: 'history', sort: 'start:desc', status: statuses.length ? statuses : undefined, from: from || undefined, to: to || undefined, page, pageSize: 20 });
  const filtered = statuses.length > 0 || !!from || !!to;

  const set = (patch: Record<string, string | null>) => {
    setParams(patchParams(params, patch), { replace: true });
  };

  return (
    <div>
      <PageHeader title="My bookings" description="Completed, cancelled, declined and expired bookings." />
      <SubNav active="history" />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              Status{statuses.length ? ` (${statuses.length})` : ''} <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1.5">
            {HISTORY_STATUSES.map((s) => (
              <label key={s.value} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-sm hover:bg-surface-muted">
                <Checkbox
                  checked={statuses.includes(s.value)}
                  onCheckedChange={(c) => set({ status: (c ? [...statuses, s.value] : statuses.filter((x) => x !== s.value)).join(',') || null })}
                />
                {s.label}
              </label>
            ))}
          </PopoverContent>
        </Popover>
        <div className="w-[170px]">
          <DatePicker value={from || null} onChange={(v) => set({ from: v })} placeholder="From date" max={to || undefined} />
        </div>
        <div className="w-[170px]">
          <DatePicker value={to || null} onChange={(v) => set({ to: v })} placeholder="To date" min={from || undefined} />
        </div>
        {filtered && (
          <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
            <X /> Clear
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <div className="card">
          <ErrorState onRetry={() => q.refetch()} />
        </div>
      ) : !q.data!.data.length ? (
        <div className="card">
          {filtered ? (
            <EmptyState icon={History} title="No bookings match these filters." action={<Button variant="outline" onClick={() => setParams({})}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={History} title="No past bookings yet." message="Bookings you've completed, cancelled or that were declined will appear here." />
          )}
        </div>
      ) : mdUp ? (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>Reference</TH>
                <TH>Venue</TH>
                <TH>Date</TH>
                <TH>Time</TH>
                <TH>Status</TH>
                <TH>Last update</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {q.data!.data.map((b) => (
                <TR key={b.id} onClick={() => navigate(`/bookings/${b.id}`)}>
                  <TD className="font-mono text-[13px]">{b.reference}</TD>
                  <TD className="max-w-[220px]">
                    <span className="block truncate font-semibold text-ink">{b.venue.name}</span>
                  </TD>
                  <TD className="tabular whitespace-nowrap">{formatDate(b.date)}</TD>
                  <TD className="tabular whitespace-nowrap">{formatTimeRange(b.startTime, b.endTime)}</TD>
                  <TD className="max-w-[260px]">
                    <StatusBadge status={b.status} size="sm" />
                    {reasonOf(b) && <span className="mt-1 block truncate text-[12px] text-muted">Reason: {reasonOf(b)}</span>}
                    {b.status === 'approved' && <span className="mt-1 block text-[12px] text-muted">Completed</span>}
                  </TD>
                  <TD className="whitespace-nowrap text-[13px] text-muted">{timeAgo(b.updatedAt)}</TD>
                  <TD>
                    <RowMenu b={b} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableShell>
      ) : (
        <div className="stagger grid gap-3">
          {q.data!.data.map((b) => (
            <div key={b.id}>
              <BookingCard booking={b} to={`/bookings/${b.id}`} />
              {reasonOf(b) && <p className="mt-1.5 px-1 text-[12px] text-muted">Reason: {reasonOf(b)}</p>}
            </div>
          ))}
        </div>
      )}
      {q.data && q.data.data.length > 0 && (
        <Pagination page={page} pageSize={20} total={q.data.meta.total} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />
      )}
    </div>
  );
}
