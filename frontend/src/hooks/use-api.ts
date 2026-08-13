import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { CallListQuery, UploadRequest } from '@call-intel/shared';
import { ApiRequestError, api } from '@/services/api';

/**
 * Data-fetching hooks.
 *
 * TanStack Query supplies the caching, deduping, retry and background-refresh
 * behaviour the original app hand-rolled with a single `useEffect` that could
 * not retry, could not refetch, and raced with itself on fast filter changes.
 */

export const queryKeys = {
  calls: (query: Partial<CallListQuery>) => ['calls', query] as const,
  call: (id: string) => ['call', id] as const,
  leaderboard: ['leaderboard'] as const,
  analytics: ['analytics'] as const,
  readiness: ['readiness'] as const,
};

/**
 * Only transient failures are worth retrying; a 404 or 400 never is.
 *
 * The `error: Error` annotation matters: typing it as `unknown` makes TanStack
 * infer `TError = unknown`, and every `query.error.message` in the pages then
 * fails to compile.
 */
function retryPolicy(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && !error.retryable) return false;
  return failureCount < 2;
}

export function useCalls(query: Partial<CallListQuery>) {
  return useQuery({
    queryKey: queryKeys.calls(query),
    queryFn: ({ signal }) => api.listCalls(query, signal),
    // Keeps the current page on screen while the next one loads, instead of
    // flashing an empty table on every filter change.
    placeholderData: keepPreviousData,
    retry: retryPolicy,
  });
}

export function useCall(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.call(id ?? ''),
    queryFn: ({ signal }) => api.getCall(id as string, signal),
    enabled: Boolean(id),
    retry: retryPolicy,
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: ({ signal }) => api.getLeaderboard(signal),
    retry: retryPolicy,
  });
}

export function useAnalytics() {
  return useQuery({
    queryKey: queryKeys.analytics,
    queryFn: ({ signal }) => api.getAnalytics(signal),
    retry: retryPolicy,
  });
}

/** Wakes the API and reports whether the upload feature is available. */
export function useReadiness() {
  return useQuery({
    queryKey: queryKeys.readiness,
    queryFn: ({ signal }) => api.getReadiness(signal),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useUploadTranscript() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UploadRequest) => api.uploadTranscript(body),
    onSuccess: (result) => {
      // A persisted upload changes the list, the leaderboard and the totals.
      if (result.call.callId !== 'PREVIEW') {
        void queryClient.invalidateQueries({ queryKey: ['calls'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
        void queryClient.invalidateQueries({ queryKey: queryKeys.analytics });
      }
    },
  });
}
