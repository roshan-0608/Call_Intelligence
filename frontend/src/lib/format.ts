/**
 * Browser-side formatting helpers.
 *
 * Kept out of `@call-intel/shared` when they are purely presentational, and out of
 * components so the same number never renders two ways in two places.
 */

/** Small spends must not collapse to `$0.00`; large ones do not need 6 decimals. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}
