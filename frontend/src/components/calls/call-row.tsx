import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Clock } from 'lucide-react';
import {
  ACTION_LABELS,
  SITE_VISIT_LABELS,
  STAGE_LABELS,
  UNIT_LABELS,
  formatBudget,
  formatDuration,
  type CallSummary,
} from '@call-intel/shared';
import { Badge } from '@/components/ui/badge';
import { ScoreBadge } from '@/components/ui/score';

/**
 * One row in the call list.
 *
 * The whole row is a single link to `/calls/:id`, so a call is shareable by URL
 * and keyboard-reachable. The original list expanded detail inline inside the
 * clicked div, which meant no deep links and a row that grew to 400px tall.
 */
export function CallRow({ call }: { call: CallSummary }) {
  return (
    <Link
      to={`/calls/${call.callId}`}
      className="group flex items-center gap-4 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{call.leadName}</span>
          {call.validationStatus === 'repaired' && (
            <Badge variant="warning" title="This analysis was repaired at import">
              <AlertTriangle className="size-3" aria-hidden="true" />
              Repaired
            </Badge>
          )}
          {call.source === 'upload' && <Badge variant="outline">Uploaded</Badge>}
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {call.telecallerName} · {call.callId} ·{' '}
          {new Date(call.occurredAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="neutral">{UNIT_LABELS[call.unitConfiguration]}</Badge>
          <Badge variant="outline">{formatBudget(call.budget)}</Badge>
          <Badge variant="outline">{STAGE_LABELS[call.lastStageReached]}</Badge>
          <Badge
            variant={
              call.siteVisitOutcome.startsWith('committed')
                ? 'good'
                : call.siteVisitOutcome === 'declined'
                  ? 'critical'
                  : 'neutral'
            }
          >
            {SITE_VISIT_LABELS[call.siteVisitOutcome]}
          </Badge>
        </div>
      </div>

      <div className="hidden w-44 shrink-0 sm:block">
        <p className="text-xs font-medium text-secondary-foreground">Next action</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ACTION_LABELS[call.recommendedNextAction]}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <ScoreBadge score={call.overallScore} />
        <span className="tabular flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" aria-hidden="true" />
          {formatDuration(call.durationSec)}
        </span>
      </div>

      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
