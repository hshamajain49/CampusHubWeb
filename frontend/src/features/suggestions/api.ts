// Suggestion box data hooks: members send and track their ideas; the Super Admin reads, replies and marks them reviewed.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSuggestion, Suggestion, SuggestionCreateBody, SuggestionReviewBody, SuggestionStatus } from '@campushub/shared';
import { apiFetch, apiFetchList } from '@/lib/api-client';

export function useMySuggestions(page: number) {
  return useQuery({
    queryKey: ['suggestions', 'mine', page],
    queryFn: () => apiFetchList<Suggestion>('/suggestions', { query: { page, pageSize: 20 } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SuggestionCreateBody) => apiFetch<Suggestion>('/suggestions', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suggestions', 'mine'] }),
  });
}

export interface AdminSuggestionsParams {
  status?: SuggestionStatus;
  q?: string;
  page: number;
  pageSize: number;
}

export type SuggestionStatusCounts = { all: number } & Record<SuggestionStatus, number>;

export function useAdminSuggestions(params: AdminSuggestionsParams) {
  return useQuery({
    queryKey: ['admin', 'suggestions', params],
    queryFn: () => apiFetchList<AdminSuggestion, { statusCounts: SuggestionStatusCounts }>('/admin/suggestions', { query: params }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useReviewSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SuggestionReviewBody & { id: string }) =>
      apiFetch<AdminSuggestion>(`/admin/suggestions/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'suggestions'] });
      // The nav badge reads kpis.newSuggestions from the dashboard summary.
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}
