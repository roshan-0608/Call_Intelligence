import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck, Coins, PhoneCall, Star, Users, Wrench } from 'lucide-react';
import { formatUsd } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatTile, StatTileSkeleton } from '@/components/dashboard/stat-tile';
import {
  DimensionAveragesChart,
  ScoreDistributionChart,
  StageFunnelChart,
  TopLocationsChart,
} from '@/components/dashboard/charts';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalytics } from '@/hooks/use-api';

/**
 * Overview: the headline numbers first, then the four distributions behind
 * them. Managers open this to answer "where do I coach next", which is why the
 * weakest dimension is called out in the tiles rather than buried in a chart.
 */
export function OverviewPage() {
  const analytics = useAnalytics();

  if (analytics.isError) {
    return (
      <Card className="p-10 text-center">
        <AlertTriangle className="mx-auto size-6 text-critical" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium">Could not load the dashboard</p>
        <p className="mt-1 text-xs text-muted-foreground">{analytics.error.message}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void analytics.refetch()}
        >
          Try again
        </Button>
      </Card>
    );
  }

  const data = analytics.data;
  const weakest = data ? [...data.dimensionAverages].sort((a, b) => a.avg - b.avg)[0] : undefined;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Aggregate performance across every analyzed call.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {!data ? (
          Array.from({ length: 6 }, (_, index) => <StatTileSkeleton key={index} />)
        ) : (
          <>
            <StatTile
              label="Calls analyzed"
              value={String(data.totals.calls)}
              icon={PhoneCall}
              hint={`${data.totals.telecallers} telecallers`}
            />
            <StatTile
              label="Average score"
              value={data.totals.avgOverall.toFixed(2)}
              icon={Star}
              hint="out of 5"
            />
            <StatTile
              label="Visit commit rate"
              value={`${data.totals.siteVisitCommitRate}%`}
              icon={CalendarCheck}
              hint="leads who agreed to visit"
            />
            <StatTile
              label="Weakest dimension"
              value={weakest ? weakest.avg.toFixed(2) : '—'}
              icon={Users}
              hint={weakest?.label ?? ''}
            />
            <StatTile
              label="Rows repaired"
              value={String(data.totals.flaggedForReprocessing)}
              icon={Wrench}
              hint="invalid at import"
              valueClassName={data.totals.flaggedForReprocessing > 0 ? 'text-warning' : undefined}
            />
            <StatTile
              label="Analysis spend"
              value={formatUsd(data.totals.totalCostUsd)}
              icon={Coins}
              hint={
                data.totals.totalTokens === 0
                  ? 'tokens not recorded for seed data'
                  : `${data.totals.totalTokens.toLocaleString()} tokens`
              }
            />
          </>
        )}
      </div>

      {data && data.totals.flaggedForReprocessing > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">
                {data.totals.flaggedForReprocessing} analyses were repaired at import
              </p>
              <p className="mt-0.5 text-xs text-secondary-foreground">
                These rows came from the dataset produced before the pipeline validated model
                output. Their values were coerced deterministically and flagged for re-analysis.
              </p>
            </div>
          </div>
          <Link
            to="/calls?flagged=true"
            className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Review them
          </Link>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {!data ? (
          <>
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </>
        ) : (
          <>
            <ScoreDistributionChart data={data.scoreDistribution} />
            <DimensionAveragesChart data={data.dimensionAverages} />
            <StageFunnelChart data={data.stageFunnel} />
            <TopLocationsChart data={data.topLocations} />
          </>
        )}
      </div>
    </div>
  );
}
