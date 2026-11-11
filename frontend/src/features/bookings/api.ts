import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, BookingSummary, MemberDashboard } from '@campushub/shared';
import { apiFetch, apiFetchList, apiFetchWithResponse } from '@/lib/api-client';
import { usePollingInterval } from '@/providers/realtime-provider';

export interface MyBookingsParams {
  scope: 'upcoming' | 'history' | 'all';
  status?: string[];
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useMyBookings(params: MyBookingsParams) {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['bookings', 'mine', params],
    queryFn: () => apiFetchList<BookingSummary>('/bookings', { query: params }),
    staleTime: 15_000,
    refetchInterval: params.scope === 'upcoming' ? interval : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

export function useBooking(id: string | undefined) {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['booking', id],
    queryFn: () => apiFetch<Booking>(`/bookings/${id}`),
    enabled: !!id,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? interval : false),
    refetchIntervalInBackground: false,
  });
}

export function useMemberDashboard() {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['dashboard', 'me'],
    queryFn: () => apiFetch<MemberDashboard>('/me/dashboard'),
    staleTime: 30_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
  });
}

function useInvalidateBookings() {
  const qc = useQueryClient();
  return (b?: { id: string; venue: { id: string } }) => {
    qc.invalidateQueries({ queryKey: ['bookings', 'mine'] });
    qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    qc.invalidateQueries({ queryKey: ['venues'] });
    if (b) {
      qc.invalidateQueries({ queryKey: ['booking', b.id] });
      qc.invalidateQueries({ queryKey: ['venue', b.venue.id, 'availability'] });
      qc.invalidateQueries({ queryKey: ['venue', b.venue.id, 'check'] });
    }
  };
}

export interface CreateBookingInput {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  expectedAttendees: number | null;
}

export function useCreateBooking() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: CreateBookingInput; idempotencyKey: string }) => {
      const { data } = await apiFetchWithResponse<Booking>('/bookings', {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      return data;
    },
    onSuccess: (b) => invalidate(b),
  });
}

export function useUpdateBooking(id: string) {
  const invalidate = useInvalidateBookings();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<Booking>(`/bookings/${id}`, { method: 'PATCH', body }),
    onSuccess: (b) => {
      qc.setQueryData(['booking', id], b);
      invalidate(b);
    },
  });
}

export function useCancelBooking(id: string) {
  const invalidate = useInvalidateBookings();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason?: string; version?: number }) => apiFetch<Booking>(`/bookings/${id}/cancel`, { method: 'POST', body }),
    onSuccess: (b) => {
      qc.setQueryData(['booking', id], b);
      invalidate(b);
    },
  });
}
