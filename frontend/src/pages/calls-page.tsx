import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, PhoneOff } from 'lucide-react';
import { callListQuerySchema, type CallListQuery } from '@call-intel/shared';
import { Card } from '@/components/ui/card';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { CallFilters } from '@/components/calls/call-filters';
import { CallRow } from '@/components/calls/call-row';
import { Pagination } from '@/components/calls/pagination';
import { useCalls, useLeaderboard } from '@/hooks/use-api';

/**
 * Call list page.
 *
 * Filter state lives in the URL, so a filtered view is shareable, survives a
 * refresh, and works with the browser's back button.
 */
export function CallsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo((): Partial<CallListQuery> => {
    const raw = Object.fromEntries(searchParams.entries());
    const parsed = callListQuerySchema.safeParse(raw);
    // A hand-edited bad URL falls back to defaults instead of erroring.
    return parsed.success ? parsed.data : { page: 1, pageSize: 20 };
  }, [searchParams]);

  const calls = useCalls(query);
  const leaderboard = useLeaderboard();
  const telecallers = useMemo(
    () => (leaderboard.data ?? []).map((entry) => entry.telecallerName).sort(),
    [leaderboard.data],
  );

  function update(next: Partial<CallListQuery>) {
    const merged = { ...query, ...next };
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([key, value]) => {
      if (value === undefined || value === '' || value === null) return;
      // Defaults stay out of the URL to keep it short and readable.
      if (key === 'page' && value === 1) return;
      if (key === 'pageSize' && value === 20) return;
      if (key === 'sort' && value === 'occurredAt') return;
      if (key === 'order' && value === 'desc') return;
      params.set(key, String(value));
    });
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Calls</h1>
        <p className="text-sm text-muted-foreground">
          Every analyzed call, searchable and filterable. Select one to see its transcript and
          scoring rationale.
        </p>
      </header>

      <CallFilters
        value={query}
        onChange={update}
        telecallers={telecallers}
        total={calls.data?.pagination.total ?? 0}
      />

      <Card className="overflow-hidden">
        {calls.isPending && <SkeletonRows rows={6} className="p-4" />}

        {calls.isError && (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-6 text-critical" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Could not load calls</p>
              <p className="mt-1 text-xs text-muted-foreground">{calls.error.message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void calls.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {calls.data && calls.data.data.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <PhoneOff className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No calls match these filters</p>
            <p className="text-xs text-muted-foreground">
              Clear a filter or widen the search to see results.
            </p>
          </div>
        )}

        {calls.data && calls.data.data.length > 0 && (
          <>
            <div
              className={
                // Dim, do not unmount, while the next page loads.
                calls.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'
              }
            >
              {calls.data.data.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </div>
            <Pagination
              meta={calls.data.pagination}
              onPageChange={(page) => update({ page })}
              onPageSizeChange={(pageSize) => update({ pageSize, page: 1 })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
