import 'fake-indexeddb/auto';
/**
 * Perf gate (sprint_4 4.0 done-when: "popup query on a seeded ledger of 5,000 receipts returns in < 50 ms"): the
 * popup's reads (src/ledger/views.ts `popupView`: today's newest receipts with their claims, the coverage summary, the
 * health reports, the last batch) over the ledger of tests/perf/ui-ledger.ts take under 50 ms of CPU, the median of
 * the runs. The side panel's first timeline page, a page filtered to the two rarest problem grades, and a receipt's
 * detail are held to the same budget. Fake IndexedDB in Node, measured 50 to 165 times slower than Chrome's
 * (Decisions [2.close]): the budget is the point, not Chrome's own numbers (4.2 measures the popup's paint in Chrome).
 *
 * And counted, so a read that grows with the ledger fails on any machine: the rows each read takes from IndexedDB
 * (tests/unit/ledger/read-recorder.ts), and no read of a whole table but the small ones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentId } from '../../src/core/schema';
import type { LedgerDb } from '../../src/ledger/db';
import { popupView, receiptDetail, receiptPage } from '../../src/ledger/views';
import { fullScans, type Recorder, recordReads, resetRecorder } from '../unit/ledger/read-recorder';
import { describeRuns, measure } from './measure';
import {
  buildUiLedger,
  DETAIL_ID,
  FILTERED_QUERY,
  POPUP_QUERY,
  TIMELINE_QUERY,
  UI_RECEIPTS,
} from './ui-ledger';

/** The budget of each UI read, in median CPU ms (sprint_4 4.0). */
const GATE_MS = 50;
const AGENTS = AgentId.options.length;

let db: LedgerDb;
let recorder: Recorder;

beforeAll(async () => {
  db = await buildUiLedger(`ui-reads-${String(Date.now())}`);
  recorder = await recordReads(db);
});

afterAll(() => {
  db.close();
});

describe(`the UI's reads over ${String(UI_RECEIPTS)} receipts`, () => {
  it('the popup reads today in under 50 ms of CPU, taking at most limit + 1 receipts of each agent', async () => {
    const measured = await measure(
      () => ({ ...POPUP_QUERY }),
      (query) => popupView(db, query),
      (_query, view) => view.today.items.length,
    );
    console.log(describeRuns(`popup reads at ${String(UI_RECEIPTS)} receipts`, measured));
    expect(measured.runs.map(({ result }) => result)).toEqual(measured.runs.map(() => POPUP_QUERY.limit));
    expect(measured.medianCpuMs).toBeLessThan(GATE_MS);
    resetRecorder(recorder);
    await popupView(db, POPUP_QUERY);
    expect(fullScans(recorder.reads)).toEqual([]);
    expect(recorder.rows.get('receipts')).toBeLessThanOrEqual(AGENTS * (POPUP_QUERY.limit + 1));
    expect(recorder.rows.get('claims')).toBeLessThanOrEqual(POPUP_QUERY.limit);
  });

  it('a timeline page, filtered or not, and a detail read take under 50 ms of CPU each', async () => {
    const reads: readonly (readonly [string, () => Promise<unknown>])[] = [
      ['timeline page', () => receiptPage(db, TIMELINE_QUERY)],
      ['filtered timeline page', () => receiptPage(db, FILTERED_QUERY)],
      ['receipt detail', () => receiptDetail(db, DETAIL_ID)],
    ];
    for (const [label, read] of reads) {
      const measured = await measure(
        () => null,
        () => read(),
        () => null,
      );
      console.log(describeRuns(`${label} at ${String(UI_RECEIPTS)} receipts`, measured));
      expect(measured.medianCpuMs, label).toBeLessThan(GATE_MS);
    }
    resetRecorder(recorder);
    const filtered = await receiptPage(db, FILTERED_QUERY);
    expect(filtered.items).toHaveLength(FILTERED_QUERY.limit);
    const pairs = AGENTS * (FILTERED_QUERY.grades?.length ?? 0);
    expect(recorder.rows.get('receipts')).toBeLessThanOrEqual(pairs * (FILTERED_QUERY.limit + 1));
    expect(fullScans(recorder.reads)).toEqual([]);
  });
});
