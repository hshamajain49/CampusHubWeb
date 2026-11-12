// Department staff workspace (§8.3): CS01 dashboard, CS02 department queue, CS03 complaint details.
import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlarmClock, CircleCheck, Hourglass, Inbox, Search, ThumbsUp, Wrench, X } from 'lucide-react';
import type { ComplaintSummary } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { isApiError } from '@/lib/api-client';
import { patchParams } from '@/lib/search-params';
import { useDebouncedValue, useDocumentTitle } from '@/hooks/misc';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/controls';
import { PageHeader, SectionCard, StatCard, ViewAllLink } from '@/components/common/layout-bits';
import { EmptyState, ErrorState, SectionError } from '@/components/common/states';
import { Pagination, Segmented } from '@/components/common/small';
import { ComplaintCard } from '@/features/complaints/components/complaint-visuals';
import { ComplaintsTable } from '@/features/complaints/components/complaints-table';
import { ComplaintDetailView } from '@/features/complaints/components/complaint-detail-view';
import { StartWorkDialog } from '@/features/complaints/components/complaint-dialogs';
import { ComplaintDetailLoader } from '@/features/complaints/complaint-pages';
import { useComplaintCategories, useStaffDashboard, useStaffQueue } from '@/features/complaints/api';

function DepartmentInactive({ message }: { message: string }) {
  return (
    <div className="card">
      <EmptyState tone="danger" title="Your department is unavailable" message={message} />
    </div>
  );
}

// ─────────────────────────── CS01 ───────────────────────────
export function StaffDashboardPage() {
  const me = useMe();
  const dash = useStaffDashboard();
  const [starting, setStarting] = React.useState<ComplaintSummary | null>(null);
  useDocumentTitle(me.serviceDepartment?.name ?? 'Department');
  if (isApiError(dash.error) && dash.error.code === 'DEPARTMENT_INACTIVE') return <DepartmentInactive message={dash.error.message} />;
  const d = dash.data;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={d?.department.name ?? me.serviceDepartment?.name ?? 'Department'}
        description="Department queue overview"
        actions={
          <Button asChild>
            <Link to="/staff/complaints">
              <Inbox /> Open the queue
            </Link>
          </Button>
        }
        className="mb-0"
      />
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        {dash.isLoading ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[138px] rounded-[14px]" />)
        ) : dash.isError ? (
          <div className="col-span-2 md:col-span-5">
            <SectionError onRetry={() => dash.refetch()} />
          </div>
        ) : (
          <>
            <StatCard icon={Hourglass} tone="pending" label="New" value={d!.counts.new} to="/staff/complaints?tab=new" />
            <StatCard icon={Wrench} tone="primary" label="In progress" value={d!.counts.inProgress} to="/staff/complaints?tab=in_progress" />
            <StatCard icon={ThumbsUp} tone="violet" label="Awaiting reporter" value={d!.counts.awaitingReporter} to="/staff/complaints?tab=awaiting" />
            <StatCard icon={AlarmClock} tone={d!.counts.overdue > 0 ? 'pending' : 'neutral'} label="Overdue (> 7 days)" value={d!.counts.overdue} />
            <div className="col-span-2 md:col-span-1">
              <StatCard icon={CircleCheck} tone="approved" label="Resolved this month" value={d!.counts.resolvedThisMonth} to="/staff/complaints?tab=resolved" />
            </div>
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <SectionCard title="Needs attention" action={<ViewAllLink to="/staff/complaints">View queue</ViewAllLink>} className="lg:col-span-7">
          {dash.isLoading ? (
            <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : dash.isError ? null : d!.needsAttention.length === 0 ? (
            <EmptyState compact icon={CircleCheck} tone="teal" title="Nice and quiet" message="There are no active complaints." />
          ) : (
            <ul className="grid gap-3">
              {d!.needsAttention.map((c) => (
                <li key={c.id}>
                  <ComplaintCard
                    c={c}
                    to={`/staff/complaints/${c.id}`}
                    viewer="staff"
                    action={
                      c.status === 'pending_review' ? (
                        <Button size="sm" onClick={() => setStarting(c)}>
                          <Wrench /> Start work
                        </Button>
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Recently resolved" className="lg:col-span-5">
          {dash.isLoading ? (
            <div className="grid gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : dash.isError ? null : d!.recentlyResolved.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing resolved yet.</p>
          ) : (
            <ul className="grid">
              {d!.recentlyResolved.map((c) => (
                <li key={c.id}>
                  <Link to={`/staff/complaints/${c.id}`} className="flex items-center justify-between gap-3 rounded-[10px] px-2 py-2.5 hover:bg-surface-muted">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{c.title}</span>
                      <span className="block truncate text-[12.5px] text-muted">
                        <span className="font-mono">{c.reference}</span> · {c.reporter?.fullName}
                      </span>
                    </span>
                    <CircleCheck className="size-4 shrink-0 text-success" aria-label="Resolved" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      {starting && (
        <StartWorkDialog c={starting} scope="staff" open onOpenChange={(o) => !o && setStarting(null)} onStale={() => void dash.refetch()} />
      )}
    </div>
  );
}

// ─────────────────────────── CS02 ───────────────────────────
const TABS = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting', label: 'Awaiting approval' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export function StaffQueuePage() {
  useDocumentTitle('Department queue');
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const cats = useComplaintCategories();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'new') as Tab;
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const page = Number(params.get('page') || 1);
  const openTab = tab === 'new' || tab === 'in_progress' || tab === 'awaiting';
  const sort = params.get('sort') ?? (openTab ? 'createdAt:asc' : 'createdAt:desc');
  const list = useStaffQueue({
    tab,
    q: params.get('q') || undefined,
    categoryId: params.get('categoryId') || undefined,
    flag: params.get('flag') || undefined,
    sort,
    page,
    pageSize: 20,
  });
  const set = (patch: Record<string, string | null>, resetPage = true) => setParams(patchParams(params, patch, resetPage), { replace: true });
  React.useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  if (isApiError(list.error) && list.error.code === 'DEPARTMENT_INACTIVE') return <DepartmentInactive message={list.error.message} />;
  const counts = list.data?.meta.counts;
  const filtered = !!(params.get('q') || params.get('categoryId') || params.get('flag'));

  return (
    <div>
      <PageHeader title="Department queue" description={me.serviceDepartment?.name} />
      <Segmented
        aria-label="Queue"
        className="mb-4"
        value={tab}
        onChange={(v) => set({ tab: v === 'new' ? null : v, sort: null })}
        options={TABS.map((t) => ({ value: t.value, label: t.label, count: counts?.[t.value] }))}
      />
      <div className="card mb-5 grid gap-3 p-4 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search the queue" placeholder="Reference, title, reporter, location" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select
          aria-label="Category"
          value={params.get('categoryId') ?? 'all'}
          onValueChange={(v) => set({ categoryId: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All categories' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        <Select
          aria-label="Flag"
          value={params.get('flag') ?? 'all'}
          onValueChange={(v) => set({ flag: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'All complaints' },
            { value: 'rejected', label: 'Rejected by reporter' },
            { value: 'reassignment', label: 'Reassignment requested' },
          ]}
        />
        <Select
          aria-label="Sort"
          value={sort}
          onValueChange={(v) => set({ sort: v })}
          options={[
            { value: 'createdAt:asc', label: 'Oldest first' },
            { value: 'createdAt:desc', label: 'Newest first' },
            { value: 'updatedAt:desc', label: 'Recently updated' },
          ]}
        />
      </div>
      {list.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : list.data!.data.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState
              title="No complaints match."
              message="Try adjusting the filters."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ('');
                    setParams(tab === 'new' ? {} : { tab }, { replace: true });
                  }}
                >
                  <X /> Clear filters
                </Button>
              }
            />
          ) : openTab ? (
            <EmptyState icon={CircleCheck} tone="teal" title="Nice and quiet" message="There are no active complaints here." />
          ) : (
            <EmptyState icon={Inbox} title={tab === 'resolved' ? 'Nothing resolved yet' : 'Nothing closed yet'} />
          )}
        </div>
      ) : (
        <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
          <ComplaintsTable rows={list.data!.data} viewer="staff" linkTo={(c) => `/staff/complaints/${c.id}`} />
          <Pagination page={page} pageSize={20} total={list.data!.meta.total} onPage={(p) => set({ page: String(p) }, false)} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── CS03 ───────────────────────────
export function StaffComplaintPage() {
  return (
    <ComplaintDetailLoader
      scope="staff"
      backTo="/staff/complaints"
      backLabel="Department queue"
      notFound="This complaint is no longer in your department's queue."
      render={(c, refetch) => (
        <ComplaintDetailView c={c} scope="staff" refetch={refetch} breadcrumb={[{ label: 'Department queue', to: '/staff/complaints' }, { label: c.reference }]} />
      )}
    />
  );
}
