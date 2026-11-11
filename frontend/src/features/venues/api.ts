import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AvailabilityCheck, Venue, VenueAvailability, VenueSummary } from '@campushub/shared';
import { apiFetch, apiFetchList } from '@/lib/api-client';

export interface VenueListParams {
  q?: string;
  type?: string;
  minCapacity?: number;
  amenities?: string[];
  availableDate?: string;
  availableStart?: string;
  availableEnd?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useVenues(params: VenueListParams) {
  return useQuery({
    queryKey: ['venues', params],
    queryFn: () => apiFetchList<VenueSummary, { amenityOptions: string[] }>('/venues', { query: params }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useVenue(id: string | undefined) {
  return useQuery({
    queryKey: ['venue', id],
    queryFn: () => apiFetch<Venue>(`/venues/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useAvailability(id: string | undefined, from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: ['venue', id, 'availability', from, to],
    queryFn: () => apiFetch<VenueAvailability>(`/venues/${id}/availability`, { query: { from, to } }),
    enabled: !!id && !!from && !!to,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/** Debounced, non-binding live check (E10); superseded requests are aborted by TanStack's signal. */
export function useAvailabilityCheck(
  id: string | undefined,
  slot: { date: string; startTime: string; endTime: string; excludeBookingId?: string } | null,
) {
  return useQuery({
    queryKey: ['venue', id, 'check', slot],
    queryFn: ({ signal }) => apiFetch<AvailabilityCheck>(`/venues/${id}/availability/check`, { query: slot!, signal }),
    enabled: !!id && !!slot,
    staleTime: 5_000,
    retry: false,
  });
}
