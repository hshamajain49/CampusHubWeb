// Admin data hooks (E17–E47, E55, E56) with the §9.6 invalidation table.
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AdminBooking,
  AdminBookingListItem,
  AdminVenue,
  AuditLogEntry,
  CalendarEvent,
  ReportSummary,
  Settings,
  UserDetail,
  UserListItem,
  VenueBlock,
  BlockConflict,
} from '@campushub/shared';
import { apiFetch, apiFetchList } from '@/lib/api-client';
import { usePollingInterval } from '@/providers/realtime-provider';

export type StatusCounts = { all: number; pending: number; approved: number; rejected: number; cancelled: number; expired: number };

export interface AdminBookingsParams {
  status?: string[];
  venueId?: string;
  requesterId?: string;
  role?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useAdminBookings(params: AdminBookingsParams, opts: { poll?: boolean } = {}) {
  const interval = usePollingInterval(30_000);
  return useQuery({
    queryKey: ['admin', 'bookings', params],
    queryFn: () => apiFetchList<AdminBookingListItem, { statusCounts: StatusCounts }>('/admin/bookings', { query: params }),
    staleTime: 10_000,
    refetchInterval: opts.poll ? interval : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

export function useAdminBooking(id: string | undefined) {
  return useQuery({ queryKey: ['admin', 'booking', id], queryFn: () => apiFetch<AdminBooking>(`/admin/bookings/${id}`), enabled: !!id, staleTime: 10_000 });
}

export function invalidateBookingViews(qc: QueryClient, b?: { id: string; requester?: { id: string } }) {
  qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
  qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  qc.invalidateQueries({ queryKey: ['admin', 'calendar'] });
  qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
  qc.invalidateQueries({ queryKey: ['admin', 'venue'] });
  if (b) {
    qc.invalidateQueries({ queryKey: ['admin', 'booking', b.id] });
    if (b.requester) qc.invalidateQueries({ queryKey: ['admin', 'user', b.requester.id] });
  }
}

export function useDecision() {
  const qc = useQueryClient();
  const run = (path: string) => (args: { id: string; body: Record<string, unknown> }) =>
    apiFetch<AdminBooking>(`/admin/bookings/${args.id}/${path}`, { method: 'POST', body: args.body });
  const onSuccess = (b: AdminBooking) => {
    qc.setQueryData(['admin', 'booking', b.id], b);
    invalidateBookingViews(qc, b);
  };
  return {
    approve: useMutation({ mutationFn: run('approve'), onSuccess }),
    reject: useMutation({ mutationFn: run('reject'), onSuccess }),
    cancel: useMutation({ mutationFn: run('cancel'), onSuccess }),
  };
}

export function useCalendar(params: { from?: string; to?: string; venueId?: string; statuses: string[]; includeBlocks: boolean }) {
  return useQuery({
    queryKey: ['admin', 'calendar', params],
    queryFn: () =>
      apiFetch<{ from: string; to: string; timezone: string; events: CalendarEvent[] }>('/admin/calendar', {
        query: { ...params, statuses: params.statuses.length ? params.statuses : undefined },
      }),
    enabled: !!params.from && !!params.to && (params.statuses.length > 0 || params.includeBlocks),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

// ─────────────── Venues ───────────────
export function useAdminVenues(params: { q?: string; type?: string; isActive?: boolean; sort?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['admin', 'venues', params],
    queryFn: () => apiFetchList<AdminVenue>('/admin/venues', { query: params }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useAdminVenue(id: string | undefined) {
  return useQuery({ queryKey: ['admin', 'venue', id], queryFn: () => apiFetch<AdminVenue>(`/admin/venues/${id}`), enabled: !!id, staleTime: 30_000 });
}

function invalidateVenues(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ['admin', 'venues'] });
  qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  qc.invalidateQueries({ queryKey: ['admin', 'calendar'] });
  qc.invalidateQueries({ queryKey: ['venues'] });
  if (id) {
    qc.invalidateQueries({ queryKey: ['admin', 'venue', id] });
    qc.invalidateQueries({ queryKey: ['venue', id] });
  }
}

export function useVenueMutations() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => apiFetch<AdminVenue>('/admin/venues', { method: 'POST', body }),
      onSuccess: (v) => invalidateVenues(qc, v.id),
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiFetch<AdminVenue>(`/admin/venues/${id}`, { method: 'PATCH', body }),
      onSuccess: (v) => invalidateVenues(qc, v.id),
    }),
    deactivate: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
        apiFetch<{ venue: AdminVenue; affected: { rejected: number; cancelled: number; keptUpcoming: number } }>(`/admin/venues/${id}/deactivate`, { method: 'POST', body }),
      onSuccess: (r) => {
        invalidateVenues(qc, r.venue.id);
        qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      },
    }),
    activate: useMutation({
      mutationFn: (id: string) => apiFetch<{ venue: AdminVenue }>(`/admin/venues/${id}/activate`, { method: 'POST' }),
      onSuccess: (r) => invalidateVenues(qc, r.venue.id),
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/admin/venues/${id}`, { method: 'DELETE' }),
      onSuccess: (_r, id) => invalidateVenues(qc, id),
    }),
    uploadImage: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => {
        const fd = new FormData();
        fd.append('image', file);
        return apiFetch<AdminVenue>(`/admin/venues/${id}/image`, { method: 'PUT', formData: fd });
      },
      onSuccess: (v) => invalidateVenues(qc, v.id),
    }),
    removeImage: useMutation({
      mutationFn: (id: string) => apiFetch<AdminVenue>(`/admin/venues/${id}/image`, { method: 'DELETE' }),
      onSuccess: (v) => invalidateVenues(qc, v.id),
    }),
  };
}

// ─────────────── Blocks ───────────────
export function useBlocks(params: { venueId?: string; includePast?: boolean; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['admin', 'blocks', params],
    queryFn: () => apiFetchList<VenueBlock>('/admin/venue-blocks', { query: params }),
    staleTime: 30_000,
  });
}

export type BlockSaveResult = { block: VenueBlock; affectedBookings: { rejected: number; cancelled: number; references: string[] } };
export type { BlockConflict };

export function useBlockMutations() {
  const qc = useQueryClient();
  const after = (venueId?: string) => {
    qc.invalidateQueries({ queryKey: ['admin', 'blocks'] });
    qc.invalidateQueries({ queryKey: ['admin', 'calendar'] });
    qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    if (venueId) qc.invalidateQueries({ queryKey: ['admin', 'venue', venueId] });
  };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => apiFetch<BlockSaveResult>('/admin/venue-blocks', { method: 'POST', body }),
      onSuccess: (r) => after(r.block.venue.id),
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiFetch<BlockSaveResult>(`/admin/venue-blocks/${id}`, { method: 'PATCH', body }),
      onSuccess: (r) => after(r.block.venue.id),
    }),
    remove: useMutation({
      mutationFn: (b: VenueBlock) => apiFetch<void>(`/admin/venue-blocks/${b.id}`, { method: 'DELETE' }),
      onSuccess: (_r, b) => after(b.venue.id),
    }),
  };
}

// ─────────────── Users ───────────────
export function useUsers(params: {
  q?: string;
  role?: string;
  serviceDepartmentId?: string;
  isActive?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => apiFetchList<UserListItem>('/admin/users', { query: params }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({ queryKey: ['admin', 'user', id], queryFn: () => apiFetch<UserDetail>(`/admin/users/${id}`), enabled: !!id, staleTime: 30_000 });
}

export function useUserMutations() {
  const qc = useQueryClient();
  const after = (id: string) => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
  };
  return {
    create: useMutation({ mutationFn: (body: Record<string, unknown>) => apiFetch<UserDetail>('/admin/users', { method: 'POST', body }), onSuccess: (u) => after(u.id) }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiFetch<UserDetail>(`/admin/users/${id}`, { method: 'PATCH', body }),
      onSuccess: (u) => {
        qc.setQueryData(['admin', 'user', u.id], u);
        after(u.id);
      },
    }),
    deactivate: useMutation({
      mutationFn: ({ id, cancelUpcomingBookings }: { id: string; cancelUpcomingBookings: boolean }) =>
        apiFetch<{ user: UserDetail; affected: { cancelled: number } }>(`/admin/users/${id}/deactivate`, { method: 'POST', body: { cancelUpcomingBookings } }),
      onSuccess: (r) => {
        after(r.user.id);
        qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      },
    }),
    activate: useMutation({
      mutationFn: (id: string) => apiFetch<{ user: UserDetail }>(`/admin/users/${id}/activate`, { method: 'POST' }),
      onSuccess: (r) => after(r.user.id),
    }),
    passwordReset: useMutation({ mutationFn: (id: string) => apiFetch<{ sent: boolean }>(`/admin/users/${id}/password-reset`, { method: 'POST' }) }),
  };
}

// ─────────────── Reports, settings, audit ───────────────
export function useReports(params: { from: string; to: string; venueId?: string }) {
  return useQuery({
    queryKey: ['admin', 'reports', params],
    queryFn: () => apiFetch<ReportSummary>('/admin/reports/summary', { query: params }),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useAdminSettings() {
  return useQuery({ queryKey: ['admin', 'settings'], queryFn: () => apiFetch<Settings>('/admin/settings'), staleTime: 5 * 60_000 });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<Settings>('/admin/settings', { method: 'PATCH', body }),
    onSuccess: (s) => {
      qc.setQueryData(['admin', 'settings'], s);
      qc.invalidateQueries({ queryKey: ['settings', 'public'] });
    },
  });
}

export function useAuditLogs(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => apiFetchList<AuditLogEntry>('/admin/audit-logs', { query: params }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useAllVenueOptions() {
  return useQuery({
    queryKey: ['admin', 'venues', { pageSize: 100, sort: 'name:asc' }],
    queryFn: () => apiFetchList<AdminVenue>('/admin/venues', { query: { pageSize: 100, sort: 'name:asc' } }),
    staleTime: 60_000,
  });
}

export function usePollingDashboard() {
  return usePollingInterval(60_000);
}
