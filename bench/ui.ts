/**
 * The UI's ledger reads (sprint_4 4.0 done-when: "popup query on a seeded ledger of 5,000 receipts returns in < 50 ms
 * (measured, committed)"): the popup's reads (src/ledger/views.ts `popupView`), the side panel's first timeline page,
 * the same page filtered to the two rarest problem grades, and a receipt's detail, each run RUNS times over the ledger
 * of extension/tests/perf/ui-ledger.ts (5,000 receipts; fake IndexedDB in Node, measured 50 to 165 times slower than
 * Chrome's, Decisions [2.close]). Each gate passes on the median CPU time of the runs, the statistic
 * tests/perf/ui-reads.perf.spec.ts gates on (bench/timing.ts); wall times are reported beside it. Also counted: the
 * receipts the popup's reads took from IndexedDB, which no machine changes.
 */
import {
  buildUiLedger,
  DETAIL_ID,
  FILTERED_QUERY,
  POPUP_QUERY,
  TIMELINE_QUERY,
  UI_RECEIPTS,
} from '../extension/tests/perf/ui-ledger';
import { receiptDetail } from '../extension/src/ledger/detail';
import { popupView, receiptPage } from '../extension/src/ledger/views';
import { fullScans, recordReads, resetRecorder } from '../extension/tests/unit/ledger/read-recorder';
import type { MetricValue } from './results';
import { summarize, timed, type Timed } from './timing';

/** The budget of each UI read, in median CPU ms (sprint_4 4.0). */
export const UI_READ_GATE_MS = 50;
const RUNS = 5;

async function runs(act: () => Promise<unknown>): Promise<Timed<unknown>[]> {
  const out: Timed<unknown>[] = [];
  for (let i = 0; i < RUNS; i += 1) out.push(await timed(act));
  return out;
}

export async function runUiBench(): Promise<Readonly<Record<string, MetricValue>>> {
  const db = await buildUiLedger(`attest-bench-ui-${String(Date.now())}`);
  try {
    const recorder = await recordReads(db);
    const popup = summarize(await runs(() => popupView(db, POPUP_QUERY)), UI_READ_GATE_MS);
    const timeline = summarize(await runs(() => receiptPage(db, TIMELINE_QUERY)), UI_READ_GATE_MS);
    const filtered = summarize(await runs(() => receiptPage(db, FILTERED_QUERY)), UI_READ_GATE_MS);
    const detail = summarize(await runs(() => receiptDetail(db, DETAIL_ID)), UI_READ_GATE_MS);
    resetRecorder(recorder);
    const view = await popupView(db, POPUP_QUERY);
    return {
      uiReceipts: UI_RECEIPTS,
      uiRuns: RUNS,
      uiPopupItems: view.today.items.length,
      uiPopupReceiptRowsRead: recorder.rows.get('receipts') ?? 0,
      uiPopupFullScans: fullScans(recorder.reads).length,
      uiPopupMedianMs: popup.medianMs,
      uiPopupMinMs: popup.minMs,
      uiPopupMaxMs: popup.maxMs,
      uiPopupCpuMedianMs: popup.cpuMedianMs,
      uiTimelineCpuMedianMs: timeline.cpuMedianMs,
      uiFilteredCpuMedianMs: filtered.cpuMedianMs,
      uiDetailCpuMedianMs: detail.cpuMedianMs,
      uiGateMs: UI_READ_GATE_MS,
      uiGateMetric: 'uiPopupCpuMedianMs',
      uiGatePassed: popup.passed,
      uiTimelineGatePassed: timeline.passed && filtered.passed && detail.passed,
    };
  } finally {
    db.close();
  }
}
