import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Renders a timestamped transcript as speaker turns.
 *
 * Lines that match `[mm:ss-mm:ss] Speaker: text` are split so the agent and the
 * lead are visually distinguishable; anything that does not match is shown
 * verbatim rather than silently dropped.
 */
const LINE_PATTERN = /^\[(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\]\s*([^:]{1,40}):\s*(.*)$/;

interface Turn {
  start: string;
  speaker: string;
  text: string;
  isAgent: boolean;
}

function parseTranscript(transcript: string): Array<Turn | { raw: string }> {
  return transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = LINE_PATTERN.exec(line);
      if (!match) return { raw: line };

      const speaker = (match[3] ?? '').trim();
      return {
        start: match[1] ?? '',
        speaker,
        // Transcripts in the dataset wrap utterances in quotes; strip them.
        text: (match[4] ?? '').replace(/^"|"$/g, ''),
        isAgent: /agent|telecaller/i.test(speaker),
      };
    });
}

export function TranscriptView({ transcript }: { transcript: string }) {
  const turns = useMemo(() => parseTranscript(transcript), [transcript]);

  return (
    <ol className="space-y-2">
      {turns.map((turn, index) => {
        if ('raw' in turn) {
          return (
            <li key={index} className="text-xs text-muted-foreground">
              {turn.raw}
            </li>
          );
        }

        return (
          <li key={index} className="flex gap-3">
            <span className="tabular w-11 shrink-0 pt-0.5 text-xs text-muted-foreground">
              {turn.start}
            </span>
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  'text-xs font-semibold',
                  turn.isAgent ? 'text-chart-1' : 'text-secondary-foreground',
                )}
              >
                {turn.speaker}
              </span>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground">{turn.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
