import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api-client';

const toastOnError = (err: unknown, meta?: Record<string, unknown>) => {
  if (meta?.toastOnError) toast.error(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err, query) => toastOnError(err, query.meta) }),
  mutationCache: new MutationCache({ onError: (err, _v, _c, m) => toastOnError(err, m.meta) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        const status = err instanceof ApiError ? err.status : 500;
        return status === 0 || status >= 500 ? count < 2 : false;
      },
      retryDelay: (attempt) => (attempt === 0 ? 1000 : 2000),
    },
    mutations: { retry: false },
  },
});
