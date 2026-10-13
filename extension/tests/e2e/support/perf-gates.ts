/**
 * The sprint's performance gates (sprint_6 6.4) in one place (Sprint 6 close, tech review TECH-14): the end-to-end specs
 * gate on them and `pnpm bench` records against them, so CI's gate and RESULTS.md's cannot drift apart.
 */

/** Rows of the generated Gmail Sent list one pass reads, and its gate in ms, the median of PERF_GMAIL_PASS_RUNS. */
export const PERF_GMAIL_ROWS = 10_000;
export const PERF_GMAIL_PASS_GATE_MS = 2_000;
export const PERF_GMAIL_PASS_RUNS = 3;
/** The 30-day ledger's storage gate, in bytes: 50 MB, counted in thousands, the stricter count. */
export const PERF_STORAGE_GATE_BYTES = 50_000_000;
/** The popup's first paint gate (sprint_4 4.2), in ms, the median of PERF_POPUP_RUNS. */
export const PERF_POPUP_GATE_MS = 100;
export const PERF_POPUP_RUNS = 5;

/** The median of `values`: the middle one of an odd count, as each gate takes it; Infinity for none. */
export function medianMs(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}
