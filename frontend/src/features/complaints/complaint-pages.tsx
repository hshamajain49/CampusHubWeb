// Reporter screens (§8.3): CU01 My complaints, CU02 New complaint, CU03 Complaint details.
import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CircleCheck, Megaphone, PartyPopper, Search, X } from 'lucide-react';
import type { Complaint } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { isApiError } from '@/lib/api-client';
import { patchParams } from '@/lib/search-params';
import { useDebouncedValue, useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, Skeleton } from '@/components/ui/controls';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pagination, Segmented } from '@/components/common/small';
import { ComplaintCard } from './components/complaint-visuals';
import { ComplaintDetailView } from './components/complaint-detail-view';
import { ComplaintForm } from './components/complaint-form';
import { useComplaint, useComplaintCategories, useMyComplaints, type ComplaintScope } from './api';

// ─────────────────────────── CU01 ───────────────────────────
export function MyComplaintsPage() {
  useDocumentTitle('My complaints');
  const [params, setParams] = useSearchParams();
  const cats = useComplaintCategories();
  const tab = (params.get('tab') === 'closed' ? 'closed' : 'open') as 'open' | 'closed';
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const page = Number(params.get('page') || 1);
  const categoryId = params.get('categoryId') || undefined;
  const list = useMyComplaints({ tab, q: params.get('q') || undefined, categoryId, page, pageSize: 20 });
  const set = (patch: Record<string, string | null>, resetPage = true) => setParams(patchParams(params, patch, resetPage), { replace: true });
  React.useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const counts = list.data?.meta.counts;
  const filtered = !!(params.get('q') || categoryId);

  return (
    <div>
      <PageHeader
        title="My complaints"
        description="Track the issues you've reported and approve fixes."
        actions={
          <Button asChild>
            <Link to="/complaints/new">
              <Megaphone /> Report an issue
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segmented
          aria-label="Complaint status"
          value={tab}
          onChange={(v) => set({ tab: v === 'open' ? null : v })}
          options={[
            { value: 'open', label: 'Open', count: counts?.open },
            { value: 'closed', label: 'Closed', count: counts?.closed },
          ]}
        />
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 md:w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" aria-label="Search complaints" placeholder="Title or reference" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
          </div>
          <Select
            aria-label="Category"
            className="w-[150px] md:w-[180px]"
            value={categoryId ?? 'all'}
            onValueChange={(v) => set({ categoryId: v === 'all' ? null : v })}
            options={[{ value: 'all', label: 'All categories' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          />
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-[14px]" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : list.data!.data.length === 0 ? (
        <div className="card">
          {filtered ? (
            <EmptyState
              title="No complaints match."
              message="Try a different search or category."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ('');
                    setParams(tab === 'open' ? {} : { tab }, { replace: true });
                  }}
                >
                  <X /> Clear filters
                </Button>
              }
            />
          ) : tab === 'open' ? (
            <EmptyState
              icon={PartyPopper}
              tone="teal"
              title="All clear!"
              message="You haven't raised any complaints yet. That's a good sign."
              action={
                <Button asChild>
                  <Link to="/complaints/new">
                    <Megaphone /> Report an issue
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={CircleCheck} title="No closed complaints yet." />
          )}
        </div>
      ) : (
        <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
          <ul className="stagger grid gap-3 md:grid-cols-2">
            {list.data!.data.map((c) => (
              <li key={c.id}>
                <ComplaintCard c={c} to={`/complaints/${c.id}`} viewer="reporter" />
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={20} total={list.data!.meta.total} onPage={(p) => set({ page: String(p) }, false)} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── CU02 ───────────────────────────
export function NewComplaintPage() {
  useDocumentTitle('Report an issue');
  const [params] = useSearchParams();
  return (
    <div>
      <PageHeader title="Report an issue" breadcrumb={[{ label: 'My complaints', to: '/complaints' }, { label: 'New complaint' }]} className="mx-auto max-w-[760px]" />
      <ComplaintForm initialVenueId={params.get('venueId')} detailPath={(id) => `/complaints/${id}`} cancelTo="/complaints" />
    </div>
  );
}

// ─────────────────────────── shared detail loader ───────────────────────────
export function ComplaintDetailLoader({
  scope,
  backTo,
  backLabel,
  notFound,
  render,
}: {
  scope: ComplaintScope;
  backTo: string;
  backLabel: string;
  notFound: string;
  render: (c: Complaint, refetch: () => void) => React.ReactNode;
}) {
  const { complaintId } = useParams();
  const q = useComplaint(scope, complaintId);
  useDocumentTitle(q.data ? `Complaint ${q.data.reference}` : 'Complaint');
  if (q.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid gap-4 lg:col-span-8">
          <Skeleton className="h-48 rounded-[14px]" />
          <Skeleton className="h-64 rounded-[14px]" />
        </div>
        <Skeleton className="h-56 rounded-[14px] lg:col-span-4" />
      </div>
    );
  }
  if (q.isError) {
    return isApiError(q.error) && q.error.status === 404 ? (
      <div className="card">
        <EmptyState
          title="Complaint not found"
          message={notFound}
          action={
            <Button asChild>
              <Link to={backTo}>{backLabel}</Link>
            </Button>
          }
        />
      </div>
    ) : (
      <ErrorState onRetry={() => q.refetch()} />
    );
  }
  return <>{render(q.data!, () => void q.refetch())}</>;
}

// ─────────────────────────── CU03 ───────────────────────────
export function ComplaintDetailPage() {
  const [params, setParams] = useSearchParams();
  const submitted = params.get('submitted') === '1';
  return (
    <ComplaintDetailLoader
      scope="reporter"
      backTo="/complaints"
      backLabel="My complaints"
      notFound="It may have been removed, or you may not have access."
      render={(c, refetch) => (
        <ComplaintDetailView
          c={c}
          scope="reporter"
          refetch={refetch}
          breadcrumb={[{ label: 'My complaints', to: '/complaints' }, { label: c.reference }]}
          banner={
            submitted ? (
              <Alert
                variant="success"
                title="Complaint submitted!"
                action={
                  <button type="button" className="text-[13px] font-semibold underline" onClick={() => setParams({}, { replace: true })}>
                    Dismiss
                  </button>
                }
              >
                You can follow its progress here. Reference <span className="font-mono font-semibold">{c.reference}</span>.
              </Alert>
            ) : undefined
          }
        />
      )}
    />
  );
}
