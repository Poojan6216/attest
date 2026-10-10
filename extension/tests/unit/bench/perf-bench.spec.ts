/**
 * The performance and memory bench (sprint_6 6.4; bench/perf.ts) is registered with `pnpm bench`, and its gates are the
 * sprint's: one Gmail Sent pass over 10,000 rows under 2 s, the 30-day ledger under 50 MB, the popup's first paint over
 * it under 100 ms. The measures themselves run in a real Chromium (tests/e2e/perf-gmail.spec.ts, perf-ledger.spec.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  PERF_GMAIL_PASS_GATE_MS,
  PERF_GMAIL_ROWS,
  PERF_POPUP_GATE_MS,
  PERF_STORAGE_GATE_BYTES,
} from '../../../../bench/perf';
import { BENCHES } from '../../../../bench/run_bench';

describe('pnpm bench: perf (sprint_6 6.4)', () => {
  it('is registered, with the sprint’s gates', () => {
    expect(BENCHES.map((bench) => bench.name)).toContain('perf');
    expect({ PERF_GMAIL_ROWS, PERF_GMAIL_PASS_GATE_MS, PERF_STORAGE_GATE_BYTES, PERF_POPUP_GATE_MS }).toEqual(
      {
        PERF_GMAIL_ROWS: 10_000,
        PERF_GMAIL_PASS_GATE_MS: 2_000,
        PERF_STORAGE_GATE_BYTES: 50_000_000,
        PERF_POPUP_GATE_MS: 100,
      },
    );
  });
});
