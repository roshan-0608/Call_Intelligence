import { useEffect, useState } from 'react';

/**
 * Resolves the theme tokens to concrete colour values for SVG charts.
 *
 * Recharts writes its colours as SVG *presentation attributes*
 * (`fill="…"`, `stroke="…"`), and `var(--token)` is not resolved in that
 * position — the bars silently fall back to black. Reading the computed values
 * off the document root keeps one source of truth (index.css) while handing
 * Recharts something it can actually paint.
 *
 * The MutationObserver re-reads on theme change, so charts recolour with the
 * rest of the UI instead of keeping the previous theme's palette.
 */

const TOKENS = {
  series: '--chart-1',
  seriesSoft: '--chart-1-soft',
  good: '--status-good',
  warning: '--status-warning',
  critical: '--status-critical',
  grid: '--grid',
  axis: '--axis',
  muted: '--muted-foreground',
  secondary: '--secondary-foreground',
  accent: '--accent',
} as const;

export type ChartColors = Record<keyof typeof TOKENS, string>;

/** Fallbacks match the light theme in index.css, for SSR or a missing token. */
const FALLBACKS: ChartColors = {
  series: '#2a78d6',
  seriesSoft: '#cde2fb',
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  secondary: '#52514e',
  accent: '#eef4fd',
};

function readColors(): ChartColors {
  if (typeof window === 'undefined') return FALLBACKS;

  const styles = getComputedStyle(document.documentElement);
  const entries = Object.entries(TOKENS).map(([key, token]) => {
    const value = styles.getPropertyValue(token).trim();
    return [key, value || FALLBACKS[key as keyof ChartColors]];
  });

  return Object.fromEntries(entries) as ChartColors;
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(readColors);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}
