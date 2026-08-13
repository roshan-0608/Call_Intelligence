import { MAX_SCORE, scoreAsPercent, scoreBand, type ScoreBand } from '@call-intel/shared';
import { cn } from '@/lib/utils';
import { Badge } from './badge';

/**
 * Score presentation.
 *
 * Colour comes from the reserved status palette and is always accompanied by
 * the number and the band word, so the meaning survives colour-blindness,
 * greyscale printing and forced-colors mode.
 */

const BAND_LABELS: Record<ScoreBand, string> = {
  strong: 'Strong',
  developing: 'Developing',
  weak: 'Weak',
};

const BAND_BADGE: Record<ScoreBand, 'good' | 'warning' | 'critical'> = {
  strong: 'good',
  developing: 'warning',
  weak: 'critical',
};

const BAND_FILL: Record<ScoreBand, string> = {
  strong: 'var(--status-good)',
  developing: 'var(--status-warning)',
  weak: 'var(--status-critical)',
};

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const band = scoreBand(score);
  return (
    <Badge variant={BAND_BADGE[band]} className={cn('tabular', className)}>
      {score.toFixed(2)} · {BAND_LABELS[band]}
    </Badge>
  );
}

export interface ScoreBarProps {
  label: string;
  score: number;
  /** Optional rationale shown under the bar. */
  reason?: string;
  className?: string;
}

/** Thin bar with a 4px rounded data end, anchored to a baseline track. */
export function ScoreBar({ label, score, reason, className }: ScoreBarProps) {
  const band = scoreBand(score);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-secondary-foreground">{label}</span>
        <span className="tabular text-xs font-semibold">
          {score}
          <span className="text-muted-foreground">/{MAX_SCORE}</span>
        </span>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-accent"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={MAX_SCORE}
        aria-label={`${label}: ${score} out of ${MAX_SCORE}, ${BAND_LABELS[band]}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${scoreAsPercent(score)}%`, backgroundColor: BAND_FILL[band] }}
        />
      </div>

      {reason && <p className="text-xs leading-relaxed text-muted-foreground">{reason}</p>}
    </div>
  );
}
