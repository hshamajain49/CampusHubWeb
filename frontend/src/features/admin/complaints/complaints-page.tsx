// CA01 All complaints (§8.3): status tabs with counts, quick flags, filters in the URL, table, CSV export.
import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Download, Megaphone, Search, SlidersHorizontal, X } from 'lucide-react';
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES, ROLE_LABELS, ROLES, type ComplaintStatus } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/download';
import { patchParams } from '@/lib/search-params';
import { useDebouncedValue, useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { useCampusNow } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pagination, Segmented } from '@/components/common/small';
import { DatePicker } from '@/components/common/pickers';
import { ComplaintsTable } from '@/features/complaints/components/complaints-table';
import { useAdminComplaints, useComplaintCategories, useServiceDepartments, type AdminComplaintsParams } from '@/features/complaints/api';
import { useAllVenueOptions } from '../api';

const FLAGS = [
  { value: 'reassignment', label: 'Needs reassignment' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'rejected', label: 'Rejected by reporter' },
  { value: 'mine', label: 'Reported by me' },
] as const;

export default function AdminComplaintsPage() {
  useDocumentTitle('All complaints');
  const [params, setParams] = useSearchParams();
  const mdUp = useIsMdUp();
  const now = useCampusNow();
  const depts = useServiceDepartments();
  const cats = useComplaintCategories();
  const venues = useAllVenueOptions();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const status = (params.get('status') ?? 'all') as 'all' | ComplaintStatus;
  const filters: AdminComplaintsParams = {
    status: status === 'all' ? undefined : [status],
    departmentId: params.get('departmentId') || undefined,
    categoryId: params.get('categoryId') || undefined,
    venueId: params.get('venueId') || undefined,
    reporterRole: params.get('reporterRole') || undefined,
    flag: params.get('flag') || undefined,
    dateFrom: params.get('dateFrom') || undefined,
    dateTo: params.get('dateTo') || undefined,
    q: params.get('q') || undefined,
  };
  const sort = params.get('sort') ?? 'createdAt:desc';
  const page = Number(params.get('page') || 1);
  const pageSize = Number(params.get('pageSize') || 20);
  const list = useAdminComplaints({ ...filters, sort, page, pageSize });
  const set = (patch: Record<string, string | null>, resetPage = true) => setParams(patchParams(params, patch, resetPage), { replace: true });
  React.useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const counts = list.data?.meta.statusCounts;
  const anyFilter = ['departmentId', 'categoryId', 'venueId', 'reporterRole', 'flag', 'dateFrom', 'dateTo', 'q'].some((k) => params.get(k));

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/admin/complaints/export.csv', `complaints-${now?.date ?? 'export'}.csv`, filters);
    } catch {
      /* toast shown by downloadFile */
    } finally {
      setExporting(false);
    }
  };

  const filterControls = (
    <div className="grid gap-3 md:grid-cols-4">
      <div className="relative md:col-span-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" aria-label="Search complaints" placeholder="Reference, title, reporter, location" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      <Select
        aria-label="Department"
        value={filters.departmentId ?? 'all'}
        onValueChange={(v) => set({ departmentId: v === 'all' ? null : v })}
        options={[{ value: 'all', label: 'All departments' }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
      />
      <Select
        aria-label="Category"
        value={filters.categoryId ?? 'all'}
        onValueChange={(v) => set({ categoryId: v === 'all' ? null : v })}
        options={[{ value: 'all', label: 'All categories' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
      />
      <Select
        aria-label="Venue"
        value={filters.venueId ?? 'all'}
        onValueChange={(v) => set({ venueId: v === 'all' ? null : v })}
        options={[{ value: 'all', label: 'All venues' }, ...(venues.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))]}
      />
      <Select
        aria-label="Reporter role"
        value={filters.reporterRole ?? 'all'}
        onValueChange={(v) => set({ reporterRole: v === 'all' ? null : v })}
        options={[{ value: 'all', label: 'All reporter roles' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]}
      />
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <div className="w-[150px]">
          <DatePicker value={filters.dateFrom ?? null} onChange={(v) => set({ dateFrom: v })} placeholder="From" max={filters.dateTo} />
        </div>
        <div className="w-[150px]">
          <DatePicker value={filters.dateTo ?? null} onChange={(v) => set({ dateTo: v })} placeholder="To" min={filters.dateFrom} />
        </div>
        {anyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setParams(status === 'all' ? {} : { status }, { replace: true });
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="All complaints"
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} loading={exporting}>
              <Download /> Export CSV
            </Button>
            <Button asChild>
              <Link to="/admin/complaints/new">
                <Megaphone /> New complaint
              </Link>
            </Button>
          </>
        }
      />
      <Segmented
        aria-label="Filter by status"
        className="mb-3"
        value={status}
        onChange={(v) => set({ status: v === 'all' ? null : v })}
        options={[
          { value: 'all' as const, label: 'All', count: counts?.all },
          ...COMPLAINT_STATUSES.map((s) => ({ value: s, label: COMPLAINT_STATUS_LABELS[s], count: counts?.[s] })),
        ]}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Quick filters">
        {FLAGS.map((f) => {
          const on = filters.flag === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => set({ flag: on ? null : f.value })}
              className={cn(
                'chip press h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors duration-150',
                on ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink hover:bg-surface-muted',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
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
        <div className="grid gap-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : list.data!.data.length === 0 ? (
        <div className="card">
          <EmptyState title="No complaints found." message={anyFilter || status !== 'all' ? 'Try adjusting filters.' : 'Complaints filed by anyone on campus will appear here.'} />
        </div>
      ) : (
        <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
          <ComplaintsTable rows={list.data!.data} viewer="admin" linkTo={(c) => `/admin/complaints/${c.id}`} />
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
    </div>
  );
}
