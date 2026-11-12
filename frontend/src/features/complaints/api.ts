// Complaint data hooks (COMPLAINT_REGISTRATION_SPEC.md §18 "query keys and invalidation").
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AdminComplaintCategory,
  Complaint,
  ComplaintCategory,
  ComplaintCounts,
  ComplaintReport,
  ComplaintStatusCounts,
  ComplaintSummary,
  ServiceDepartment,
  StaffDashboard,
  StaffQueueCounts,
} from '@campushub/shared';
import { isFinalComplaintStatus } from '@campushub/shared';
import { apiFetch, apiFetchList, apiUpload } from '@/lib/api-client';
import { usePollingInterval } from '@/providers/realtime-provider';

// Signed photo URLs live 10 minutes; detail data is never older than 5 (§12.2 step 7).
const DETAIL_STALE = 60_000;
const DETAIL_GC = 5 * 60_000;

// ─────────────────────────── categories ───────────────────────────
export function useComplaintCategories() {
  return useQuery({
    queryKey: ['complaint-categories'],
    queryFn: () => apiFetch<ComplaintCategory[]>('/complaint-categories'),
    staleTime: 5 * 60_000,
  });
}

// ─────────────────────────── reporter ───────────────────────────
export interface MyComplaintsParams {
  tab: 'open' | 'closed' | 'all';
  categoryId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function useMyComplaints(params: MyComplaintsParams) {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['complaints', 'mine', params],
    queryFn: () => apiFetchList<ComplaintSummary, { counts: ComplaintCounts }>('/complaints', { query: params }),
    staleTime: 15_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

/** Counts for the nav badge ("waiting for your review"). */
export function useMyComplaintCounts(enabled = true) {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['complaints', 'mine', { tab: 'open', pageSize: 1 }],
    queryFn: () => apiFetchList<ComplaintSummary, { counts: ComplaintCounts }>('/complaints', { query: { tab: 'open', pageSize: 1 } }),
    select: (r) => r.meta.counts,
    staleTime: 30_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
    enabled,
  });
}

export type ComplaintScope = 'reporter' | 'staff' | 'admin';

const detailPath = (scope: ComplaintScope, id: string) =>
  scope === 'reporter' ? `/complaints/${id}` : scope === 'staff' ? `/staff/complaints/${id}` : `/admin/complaints/${id}`;
export const detailKey = (scope: ComplaintScope, id: string | undefined) =>
  scope === 'reporter' ? ['complaint', id] : scope === 'staff' ? ['staff', 'complaint', id] : ['admin', 'complaint', id];

export function useComplaint(scope: ComplaintScope, id: string | undefined) {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: detailKey(scope, id),
    queryFn: () => apiFetch<Complaint>(detailPath(scope, id!)),
    enabled: !!id,
    staleTime: DETAIL_STALE,
    gcTime: DETAIL_GC,
    refetchInterval: (q) => (scope !== 'admin' && q.state.data && !isFinalComplaintStatus(q.state.data.status) ? interval : false),
    refetchIntervalInBackground: false,
  });
}

/** Every complaint mutation refreshes all complaint views and both dashboards (§18). */
export function invalidateComplaintViews(qc: QueryClient, c?: { id: string; venue?: { id: string } | null }) {
  qc.invalidateQueries({ queryKey: ['complaints'] });
  qc.invalidateQueries({ queryKey: ['staff'] });
  qc.invalidateQueries({ queryKey: ['admin', 'complaints'] });
  qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  qc.invalidateQueries({ queryKey: ['admin', 'reports', 'complaints'] });
  qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
  if (c) {
    qc.invalidateQueries({ queryKey: ['complaint', c.id] });
    qc.invalidateQueries({ queryKey: ['admin', 'complaint', c.id] });
    if (c.venue) qc.invalidateQueries({ queryKey: ['admin', 'venue', c.venue.id] });
  }
}

export interface ComplaintFormInput {
  categoryId: string;
  title: string;
  venueId: string | null;
  locationDetails: string | null;
  description: string | null;
}

/** C02: multipart with photos (XHR progress), Idempotency-Key per form instance (CB-20). */
export function useCreateComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { input: ComplaintFormInput; photos: File[]; idempotencyKey: string; onProgress?: (r: number) => void }) => {
      const fd = new FormData();
      fd.append('data', JSON.stringify(args.input));
      for (const p of args.photos) fd.append('photos', p, p.name);
      const { data } = await apiUpload<Complaint>('/complaints', fd, {
        headers: { 'Idempotency-Key': args.idempotencyKey },
        onProgress: args.onProgress,
      });
      return data;
    },
    onSuccess: (c) => {
      qc.setQueryData(['complaint', c.id], c);
      invalidateComplaintViews(qc, c);
    },
  });
}

/** Any JSON complaint action (approve, reject, start, close, …) on one scope's endpoint. */
export function useComplaintAction(scope: ComplaintScope, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) =>
      apiFetch<Complaint>(`${detailPath(scope, id)}/${action}`, { method: 'POST', body }),
    onSuccess: (c) => {
      qc.setQueryData(detailKey(scope, id), c);
      invalidateComplaintViews(qc, c);
    },
  });
}

/** C12 / C19: "mark work done" with optional note and up to 3 photos. */
export function useCompleteWork(scope: 'staff' | 'admin', id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { version: number; note: string | null; photos: File[]; onProgress?: (r: number) => void }) => {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ version: args.version, note: args.note }));
      for (const p of args.photos) fd.append('photos', p, p.name);
      const { data } = await apiUpload<Complaint>(`${detailPath(scope, id)}/complete`, fd, { onProgress: args.onProgress });
      return data;
    },
    onSuccess: (c) => {
      qc.setQueryData(detailKey(scope, id), c);
      invalidateComplaintViews(qc, c);
    },
  });
}

// ─────────────────────────── staff ───────────────────────────
export function useStaffDashboard() {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['staff', 'dashboard'],
    queryFn: () => apiFetch<StaffDashboard>('/staff/dashboard'),
    staleTime: 15_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
  });
}

export interface StaffQueueParams {
  tab: string;
  categoryId?: string;
  q?: string;
  flag?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useStaffQueue(params: StaffQueueParams, enabled = true) {
  const interval = usePollingInterval(30_000);
  return useQuery({
    queryKey: ['staff', 'complaints', params],
    queryFn: () => apiFetchList<ComplaintSummary, { counts: StaffQueueCounts }>('/staff/complaints', { query: params }),
    staleTime: 10_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    enabled,
  });
}

// ─────────────────────────── admin ───────────────────────────
export interface AdminComplaintsParams {
  status?: string[];
  departmentId?: string;
  categoryId?: string;
  venueId?: string;
  reporterRole?: string;
  flag?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useAdminComplaints(params: AdminComplaintsParams, opts: { poll?: boolean } = {}) {
  const interval = usePollingInterval(30_000);
  return useQuery({
    queryKey: ['admin', 'complaints', params],
    queryFn: () => apiFetchList<ComplaintSummary, { statusCounts: ComplaintStatusCounts }>('/admin/complaints', { query: params }),
    staleTime: 10_000,
    refetchInterval: opts.poll === false ? false : interval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

export function useServiceDepartments() {
  return useQuery({ queryKey: ['admin', 'service-departments'], queryFn: () => apiFetch<ServiceDepartment[]>('/admin/service-departments'), staleTime: 30_000 });
}

export function useAdminCategories() {
  return useQuery({
    queryKey: ['admin', 'complaint-categories'],
    queryFn: () => apiFetch<AdminComplaintCategory[]>('/admin/complaint-categories'),
    staleTime: 30_000,
  });
}

export function useSetupMutation<T>(kind: 'service-departments' | 'complaint-categories') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      apiFetch<T>(id ? `/admin/${kind}/${id}` : `/admin/${kind}`, { method: id ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['complaint-categories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'service-departments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'complaint-categories'] });
    },
  });
}

export function useComplaintReport(params: { from?: string; to?: string; departmentId?: string }) {
  return useQuery({
    queryKey: ['admin', 'reports', 'complaints', params],
    queryFn: () => apiFetch<ComplaintReport>('/admin/reports/complaints', { query: params }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
