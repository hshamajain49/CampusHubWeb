import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Ban, Check, Download, Eye, FileDown, MoreHorizontal, Search, SlidersHorizontal, X } from 'lucide-react';
import { addDays, type AdminBookingListItem, type BookingStatus } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatTimeRange, formatTimestamp, timeAgo } from '@/lib/format';
import { downloadFile } from '@/lib/download';
import { useDebouncedValue, useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui/menus';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { RoleBadge, StatusBadge } from '@/components/common/badges';
import { Pagination, Segmented } from '@/components/common/small';
import { DatePicker } from '@/components/common/pickers';
import { BookingDateBlock } from '@/components/common/booking-visuals';
import { useAdminBookings, useAllVenueOptions, type AdminBookingsParams } from '../api';
import { DecisionDialog, type DecisionMode } from './decision-dialogs';
import { patchParams } from '@/lib/search-params';

const TABS: { value: 'all' | BookingStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

export function RowActions({ b, onDecide }: { b: AdminBookingListItem; onDecide: (m: DecisionMode) => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${b.reference}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => navigate(`/admin/bookings/${b.id}`)}>
          <Eye /> View
        </DropdownMenuItem>
        {b.permissions.canReject && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!b.permissions.canApprove} onSelect={() => onDecide('approve')}>
              <Check /> Approve
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => onDecide('reject')}>
              <X /> Reject
            </DropdownMenuItem>
          </>
        )}
        {b.permissions.canCancel && (
          <DropdownMenuItem destructive onSelect={() => onDecide('cancel')}>
            <Ban /> Cancel
          </DropdownMenuItem>
        )}
        {b.permissions.canDownloadConfirmation && (
          <DropdownMenuItem onSelect={() => void downloadFile(`/admin/bookings/${b.id}/confirmation.pdf`, `booking-confirmation-${b.reference}.pdf`)}>
            <FileDown /> Download PDF
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Table on ≥ md, stacked cards on < md (§20.3). Shared with the venue detail "Bookings" tab. */
export function BookingsTable({
  rows,
  sort,
  onSort,
  onDecide,
  hideVenue = false,
}: {
  rows: AdminBookingListItem[];
  sort: string;
  onSort: (s: string) => void;
  onDecide: (b: AdminBookingListItem, m: DecisionMode) => void;
  hideVenue?: boolean;
}) {
  const navigate = useNavigate();
  const mdUp = useIsMdUp();
  const { data: settings } = usePublicSettings();
  const tz = settings?.campusTimezone ?? 'UTC';
  const dir = (key: 'start' | 'createdAt') => (sort.startsWith(key) ? (sort.endsWith('asc') ? 'asc' : 'desc') : false);
  const toggle = (key: 'start' | 'createdAt') => onSort(`${key}:${dir(key) === 'desc' ? 'asc' : 'desc'}`);

  if (!mdUp) {
    return (
      <div className="stagger grid gap-3">
        {rows.map((b) => (
          <div key={b.id} className="card press relative flex gap-3 p-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <BookingDateBlock date={b.date} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/admin/bookings/${b.id}`} className="truncate text-sm font-semibold text-ink outline-none after:absolute after:inset-0 after:content-['']">
                  {hideVenue ? b.requester.fullName : b.venue.name}
                </Link>
                <div className="relative z-10">
                  <RowActions b={b} onDecide={(m) => onDecide(b, m)} />
                </div>
              </div>
              <p className="tabular text-[12.5px] text-muted">
                <span className="whitespace-nowrap">{formatTimeRange(b.startTime, b.endTime)}</span> · <span className="whitespace-nowrap font-mono">{b.reference}</span>
              </p>
              {!hideVenue && <p className="truncate text-[12.5px] text-muted">{b.requester.fullName}</p>}
              <div className="mt-2">
                <StatusBadge status={b.status} size="sm" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <TableShell>
      <Table>
        <THead>
          <tr>
            <TH>Reference</TH>
            {!hideVenue && <TH>Venue</TH>}
            <TH sort={dir('start')} onSort={() => toggle('start')}>
              Date &amp; time
            </TH>
            <TH>Requester</TH>
            <TH>Purpose</TH>
            <TH>Status</TH>
            <TH sort={dir('createdAt')} onSort={() => toggle('createdAt')}>
              Submitted
            </TH>
            <TH className="w-12">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((b) => (
            <TR key={b.id} onClick={() => navigate(`/admin/bookings/${b.id}`)}>
              <TD className="whitespace-nowrap font-mono text-[12.5px]">
                <Link to={`/admin/bookings/${b.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                  {b.reference}
                </Link>
              </TD>
              {!hideVenue && (
                <TD className="max-w-[180px]">
                  <span className="block truncate font-semibold text-ink" title={b.venue.name}>{b.venue.name}</span>
                </TD>
              )}
              <TD className="tabular whitespace-nowrap">
                <span className="block text-ink">{formatDate(b.date)}</span>
                <span className="block text-[12.5px] text-muted">{formatTimeRange(b.startTime, b.endTime)}</span>
              </TD>
              <TD className="max-w-[180px]">
                <span className="block truncate font-medium text-ink" title={b.requester.fullName}>{b.requester.fullName}</span>
                <RoleBadge role={b.requester.role} className="mt-0.5" />
              </TD>
              <TD className="max-w-[180px]">
                <Tooltip content={b.purpose}>
                  <span className="block truncate text-muted">{b.purpose}</span>
                </Tooltip>
              </TD>
              <TD>
                <StatusBadge status={b.status} size="sm" />
              </TD>
              <TD className="whitespace-nowrap text-[13px] text-muted">
                <Tooltip content={formatTimestamp(b.createdAt, tz)}>
                  <span>{timeAgo(b.createdAt)}</span>
                </Tooltip>
              </TD>
              <TD>
                <RowActions b={b} onDecide={(m) => onDecide(b, m)} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </TableShell>
  );
}

export default function BookingsPage() {
  useDocumentTitle('All bookings');
  const [params, setParams] = useSearchParams();
  const now = useCampusNow();
  const mdUp = useIsMdUp();
  const venues = useAllVenueOptions();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const [decision, setDecision] = React.useState<{ b: AdminBookingListItem; mode: DecisionMode } | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const status = (params.get('status') ?? 'all') as 'all' | BookingStatus;
  const filters: AdminBookingsParams = {
    status: status === 'all' ? undefined : [status],
    venueId: params.get('venueId') || undefined,
    requesterId: params.get('requesterId') || undefined,
    role: params.get('role') || undefined,
    dateFrom: params.get('dateFrom') || undefined,
    dateTo: params.get('dateTo') || undefined,
    q: params.get('q') || undefined,
  };
  const sort = params.get('sort') ?? 'createdAt:desc';
  const page = Number(params.get('page') || 1);
  const pageSize = Number(params.get('pageSize') || 20);
  const list = useAdminBookings({ ...filters, sort, page, pageSize });

  const set = (patch: Record<string, string | null>, resetPage = true) => {
    setParams(patchParams(params, patch, resetPage), { replace: true });
  };
  React.useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const today = now?.date ?? '';
  const presets = [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'week', label: 'This week', from: today, to: today && addDays(today, 6) },
    { key: 'next30', label: 'Next 30 days', from: today, to: today && addDays(today, 30) },
    { key: 'past30', label: 'Past 30 days', from: today && addDays(today, -30), to: today },
  ];
  const activePreset = presets.find((p) => p.from === filters.dateFrom && p.to === filters.dateTo)?.key;
  const anyFilter = !!(filters.venueId || filters.role || filters.dateFrom || filters.dateTo || filters.q || filters.requesterId);
  const counts = list.data?.meta.statusCounts;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/admin/bookings/export.csv', `bookings-${today}.csv`, { ...filters, status: filters.status });
    } catch {
      /* toast shown by downloadFile */
    } finally {
      setExporting(false);
    }
  };

  const filterControls = (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" aria-label="Search bookings" placeholder="Reference, purpose, requester name or email" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      <Select
        aria-label="Venue"
        value={filters.venueId ?? 'all'}
        onValueChange={(v) => set({ venueId: v === 'all' ? null : v })}
        options={[{ value: 'all', label: 'All venues' }, ...(venues.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))]}
      />
      <Select
        aria-label="Requester role"
        value={filters.role ?? 'all'}
        onValueChange={(v) => set({ role: v === 'all' ? null : v })}
        options={[
          { value: 'all', label: 'All roles' },
          { value: 'student', label: 'Student' },
          { value: 'faculty_staff', label: 'Faculty / Staff' },
          { value: 'department_staff', label: 'Department Staff' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 md:col-span-3">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => set(activePreset === p.key ? { dateFrom: null, dateTo: null } : { dateFrom: p.from, dateTo: p.to })}
            className={cn(
              'chip press h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors duration-150',
              activePreset === p.key ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink hover:bg-surface-muted',
            )}
          >
            {p.label}
          </button>
        ))}
        <div className="w-[160px]">
          <DatePicker value={filters.dateFrom ?? null} onChange={(v) => set({ dateFrom: v })} placeholder="From" max={filters.dateTo} />
        </div>
        <div className="w-[160px]">
          <DatePicker value={filters.dateTo ?? null} onChange={(v) => set({ dateTo: v })} placeholder="To" min={filters.dateFrom} />
        </div>
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => {
            setQ('');
            setParams(status === 'all' ? {} : { status }, { replace: true });
          }}>
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="All bookings"
        actions={
          <Button variant="outline" onClick={exportCsv} loading={exporting}>
            <Download /> Export CSV
          </Button>
        }
      />
      <Segmented
        aria-label="Filter by status"
        className="mb-4"
        value={status}
        onChange={(v) => set({ status: v === 'all' ? null : v })}
        options={TABS.map((t) => ({ value: t.value, label: t.label, count: counts ? counts[t.value] : undefined }))}
      />
      {mdUp ? (
        <div className="card mb-5 p-4">{filterControls}</div>
      ) : (
        <>
          <Button variant="outline" className="mb-4 w-full" size="lg" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal /> Filters{anyFilter ? ' (on)' : ''}
          </Button>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="bottom" title="Filters">
              <div className="grid gap-4 px-5 pb-4">
                {filterControls}
                <Button onClick={() => setFiltersOpen(false)}>Show results</Button>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

      {list.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : list.data!.data.length === 0 ? (
        <div className="card">
          <EmptyState title="No bookings found." message="Try adjusting filters." />
        </div>
      ) : (
        <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
          <BookingsTable rows={list.data!.data} sort={sort} onSort={(s) => set({ sort: s })} onDecide={(b, mode) => setDecision({ b, mode })} />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data!.meta.total}
            onPage={(p) => set({ page: String(p) }, false)}
            onPageSize={(n) => set({ pageSize: String(n) })}
            pageSizes={[20, 50, 100]}
          />
        </div>
      )}
      <DecisionDialog booking={decision?.b ?? null} mode={decision?.mode ?? null} onClose={() => setDecision(null)} />
    </div>
  );
}
