import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock, Info, MapPin } from 'lucide-react';
import {
  ACTION_LABELS,
  DIMENSION_LABELS,
  SCORE_DIMENSIONS,
  SITE_VISIT_LABELS,
  STAGE_LABELS,
  TIMELINE_LABELS,
  UNIT_LABELS,
  formatBudget,
  formatDuration,
  type CallDetail,
} from '@call-intel/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreBadge, ScoreBar } from '@/components/ui/score';
import { Skeleton } from '@/components/ui/skeleton';
import { TranscriptView } from '@/components/calls/transcript-view';
import { useCall } from '@/hooks/use-api';

/**
 * Single call view, addressable at /calls/:id.
 *
 * Shows the analysis next to the transcript that produced it, including the
 * per-dimension rationale and the provenance of the analysis, so a manager can
 * check the model's reasoning rather than take a score on faith.
 */
export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const call = useCall(id);

  return (
    <div className="space-y-4">
      {/* A link, not a button wrapping a link: nesting an anchor inside a
          button is invalid HTML and breaks keyboard activation. */}
      <Link
        to="/calls"
        className="-ml-2 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to calls
      </Link>

      {call.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      )}

      {call.isError && (
        <Card className="p-10 text-center">
          <AlertTriangle className="mx-auto size-6 text-critical" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Could not load this call</p>
          <p className="mt-1 text-xs text-muted-foreground">{call.error.message}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void call.refetch()}>
            Try again
          </Button>
        </Card>
      )}

      {call.data && <CallDetailBody call={call.data} />}
    </div>
  );
}

function CallDetailBody({ call }: { call: CallDetail }) {
  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{call.leadName}</h1>
              {call.source === 'upload' && <Badge variant="outline">Uploaded</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {call.telecallerName} · {call.callId} ·{' '}
              {new Date(call.occurredAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed">{call.summary}</p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <ScoreBadge score={call.overallScore} className="text-sm" />
            <span className="tabular flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              {formatDuration(call.durationSec)}
            </span>
          </div>
        </div>

        {call.validationStatus === 'repaired' && call.analysis.repairNotes.length > 0 && (
          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-warning">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              This analysis was repaired at import
            </p>
            <ul className="mt-2 space-y-1">
              {call.analysis.repairNotes.map((note, index) => (
                <li key={index} className="text-xs text-secondary-foreground">
                  <code className="font-mono text-[11px]">{note.field}</code>: “{note.from}” → “
                  {note.to}” — {note.rule}
                </li>
              ))}
            </ul>
          </div>
        )}

        {call.analysis.warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-accent p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-secondary-foreground">
              <Info className="size-3.5" aria-hidden="true" />
              Soft-rule warnings
            </p>
            <ul className="mt-1.5 space-y-1">
              {call.analysis.warnings.map((warning, index) => (
                <li key={index} className="text-xs text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Extracted lead data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Configuration" value={UNIT_LABELS[call.unitConfiguration]} />
              <Field label="Budget" value={formatBudget(call.budget)} />
              <Field label="Timeline" value={TIMELINE_LABELS[call.timeline]} />
              <Field label="Site visit" value={SITE_VISIT_LABELS[call.siteVisitOutcome]} />
              <Field label="Stage reached" value={STAGE_LABELS[call.lastStageReached]} />
              <div>
                <p className="text-xs font-medium text-secondary-foreground">Preferred locations</p>
                {call.preferredLocations.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">None stated</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {call.preferredLocations.map((location) => (
                      <Badge key={location} variant="outline">
                        <MapPin className="size-3" aria-hidden="true" />
                        {location}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quality scores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {SCORE_DIMENSIONS.map((dimension) => (
                <ScoreBar
                  key={dimension}
                  label={DIMENSION_LABELS[dimension]}
                  score={call.qualityScores[dimension].score}
                  reason={call.qualityScores[dimension].reason}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recommended next action</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="good" className="text-sm">
                {ACTION_LABELS[call.recommendedNextAction]}
              </Badge>

              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                <Provenance label="Model" value={call.analysis.model} />
                <Provenance label="Prompt" value={call.analysis.promptVersion} />
                <Provenance
                  label="Tokens"
                  value={
                    call.analysis.promptTokens + call.analysis.completionTokens === 0
                      ? 'not recorded'
                      : `${call.analysis.promptTokens + call.analysis.completionTokens}`
                  }
                />
                <Provenance
                  label="Latency"
                  value={
                    call.analysis.latencyMs === 0 ? 'not recorded' : `${call.analysis.latencyMs} ms`
                  }
                />
              </dl>
            </CardContent>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <TranscriptView transcript={call.transcript} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs font-medium text-secondary-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function Provenance({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
