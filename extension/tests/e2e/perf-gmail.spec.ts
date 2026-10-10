/**
 * The Gmail Sent reader at 10,000 rows (sprint_6 6.4 gate: "Gmail fixture with 10,000 sent rows (generated):
 * extraction < 2 s, observations deduped, ledger growth bounded"), on a generated Sent head of 10,000 sends, one a
 * minute back, each to an invented person (./support/big-sent.ts; the measures: ./support/perf-gmail.ts):
 *  - one pass of the shipped reader over it, in a Chromium without the extension, the page's own clock timing it: the
 *    median of three fresh loads is under 2 s;
 *  - the built extension reading the same page twice: 10,000 observations after the first pass and after the second,
 *    and one Gmail Sent window, so a page read again adds nothing to the ledger.
 */
import { expect, test } from '@playwright/test';

import { SENT_PASS_HARNESS_MARKER } from './support/observer-harness-marker';
import { readTwice, timeSentPasses } from './support/perf-gmail';

const ROWS = 10_000;
/** The sprint's bound on one pass, in milliseconds. */
const PASS_GATE_MS = 2_000;
const RUNS = 3;

test('one pass of the Gmail Sent reader over 10,000 rows takes under 2 s', async () => {
  test.setTimeout(5 * 60_000);
  const passes = await timeSentPasses(ROWS, RUNS);
  for (const pass of passes) {
    expect(pass).toMatchObject({ status: 'OK', observations: ROWS, marker: SENT_PASS_HARNESS_MARKER });
  }
  const times = passes.map((pass) => Math.round(pass.ms)).sort((a, b) => a - b);
  const median = times[Math.floor(RUNS / 2)] ?? Number.POSITIVE_INFINITY;
  console.log(
    `[perf-gmail] one pass over ${String(ROWS)} rows: median ${String(median)} ms (${times.join(', ')})`,
  );
  expect(median).toBeLessThan(PASS_GATE_MS);
});

test('the built extension reads the 10,000-row page twice and keeps each row once, in one window', async () => {
  test.setTimeout(10 * 60_000);
  const reads = await readTwice(ROWS);
  console.log(`[perf-gmail] the extension stored ${String(ROWS)} rows in ${String(reads.storeMs)} ms`);
  expect(reads).toMatchObject({ afterFirst: ROWS, afterSecond: ROWS, windows: 1 });
});
