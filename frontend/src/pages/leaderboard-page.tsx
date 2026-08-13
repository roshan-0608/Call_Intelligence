import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { DIMENSION_LABELS, SCORE_DIMENSIONS, scoreAsPercent, scoreBand } from '@call-intel/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScoreBadge } from '@/components/ui/score';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeaderboard } from '@/hooks/use-api';

/**
 * Telecaller ranking, with per-dimension averages so a manager can see *why*
 * someone ranks where they do. Every row links to that telecaller's calls.
 *
 * The bars are inline magnitude marks rather than a chart: twelve rows of four
 * measures is a table, and a grouped bar chart with 48 marks would be less
 * readable, not more.
 */
const BAND_FILL = {
  strong: 'var(--status-good)',
  developing: 'var(--status-warning)',
  weak: 'var(--status-critical)',
} as const;

export function LeaderboardPage() {
  const leaderboard = useLeaderboard();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Telecaller leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Ranked by average overall score across all their calls, computed server-side over the full
          dataset.
        </p>
      </header>

      {leaderboard.isPending && <Skeleton className="h-96 w-full" />}

      {leaderboard.isError && (
        <Card className="p-10 text-center">
          <AlertTriangle className="mx-auto size-6 text-critical" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Could not load the leaderboard</p>
          <p className="mt-1 text-xs text-muted-foreground">{leaderboard.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void leaderboard.refetch()}
          >
            Try again
          </Button>
        </Card>
      )}

      {leaderboard.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">
              Telecallers ranked by average call score, with per-dimension averages and site-visit
              commitment rate
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  #
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Telecaller
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Calls
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Overall
                </th>
                {SCORE_DIMENSIONS.map((dimension) => (
                  <th key={dimension} scope="col" className="px-4 py-2.5 font-medium">
                    {DIMENSION_LABELS[dimension]}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Visit commit
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.data.map((entry) => (
                <tr key={entry.telecallerName} className="border-b border-border last:border-b-0">
                  <td className="tabular px-4 py-3 text-muted-foreground">{entry.rank}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/calls?telecaller=${encodeURIComponent(entry.telecallerName)}`}
                      className="font-medium hover:underline"
                    >
                      {entry.telecallerName}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-3 text-right text-muted-foreground">
                    {entry.callCount}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ScoreBadge score={entry.avgOverall} />
                  </td>

                  {SCORE_DIMENSIONS.map((dimension) => {
                    const score = entry.dimensionAverages[dimension];
                    return (
                      <td key={dimension} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-accent"
                            role="img"
                            aria-label={`${DIMENSION_LABELS[dimension]}: ${score} out of 5`}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${scoreAsPercent(score)}%`,
                                backgroundColor: BAND_FILL[scoreBand(score)],
                              }}
                            />
                          </div>
                          <span className="tabular text-xs text-secondary-foreground">
                            {score.toFixed(2)}
                          </span>
                        </div>
                      </td>
                    );
                  })}

                  <td className="tabular px-4 py-3 text-right">{entry.commitRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
