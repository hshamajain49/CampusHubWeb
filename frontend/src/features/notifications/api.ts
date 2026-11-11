import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationItem } from '@campushub/shared';
import { apiFetch, apiFetchList } from '@/lib/api-client';
import { usePollingInterval } from '@/providers/realtime-provider';

export function useUnreadCount(enabled = true) {
  const interval = usePollingInterval(60_000);
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => apiFetch<{ count: number }>('/notifications/unread-count'),
    staleTime: 30_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
    enabled,
  });
}

export function useNotifications(params: { unreadOnly?: boolean; page?: number; pageSize?: number }, enabled = true) {
  return useQuery({
    queryKey: ['notifications', params],
    queryFn: () => apiFetchList<NotificationItem, { unreadCount: number }>('/notifications', { query: params }),
    staleTime: 15_000,
    enabled,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
