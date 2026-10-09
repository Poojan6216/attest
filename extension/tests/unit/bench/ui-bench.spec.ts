/**
 * The UI reads bench (bench/ui.ts; sprint_4 4.0 done-when, "measured, committed"; Hard Rule 12): `pnpm bench` puts the
 * popup's read time over 5,000 receipts in RESULTS.md, gated at 50 ms of median CPU, with the receipts it read and the
 * full scans it made beside it. Here: the bench is registered, measures what it says, and takes each gate from
 * summarize() over its runs. The CPU numbers themselves are gated where nothing else runs (tests/perf, `pnpm bench`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BENCHES } from '../../../../bench/run_bench';
import { POPUP_PAINT_GATE_MS, POPUP_TRACE } from '../../../../bench/popup';
import { runUiBench, UI_READ_GATE_MS } from '../../../../bench/ui';
import { POPUP_RECEIPT_LIMIT } from '../../../src/config';
import { AgentId } from '../../../src/core/schema';

describe('the UI reads bench', () => {
  it('is registered, and reads the popup over 5,000 receipts through the indexes, a bounded number of rows', async () => {
    expect(BENCHES.map((bench) => bench.name)).toContain('ui');
    const metrics = await runUiBench();
    expect(metrics.uiReceipts).toBe(5_000);
    expect(metrics.uiPopupItems).toBe(POPUP_RECEIPT_LIMIT);
    expect(metrics.uiPopupFullScans).toBe(0);
    expect(metrics.uiPopupReceiptRowsRead).toBeLessThanOrEqual(
      AgentId.options.length * (POPUP_RECEIPT_LIMIT + 1),
    );
    expect(metrics.uiGateMs).toBe(UI_READ_GATE_MS);
    expect(metrics.uiGateMetric).toBe('uiPopupCpuMedianMs');
    for (const name of [
      'uiPopupCpuMedianMs',
      'uiTimelineCpuMedianMs',
      'uiFilteredCpuMedianMs',
      'uiDetailCpuMedianMs',
    ]) {
      expect(typeof metrics[name], name).toBe('number');
    }
  });

  it('takes each gate from summarize() over its runs, never a number compared in place', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../../../bench/ui.ts'), 'utf8');
    const gates = [...source.matchAll(/^\s*(\w*GatePassed):\s*([^,\n]+),/gm)].map((match) => [
      match[1],
      match[2],
    ]);
    expect(gates).toEqual([
      ['uiGatePassed', 'popup.passed'],
      ['uiTimelineGatePassed', 'timeline.passed && filtered.passed && detail.passed'],
    ]);
    expect(source).toContain('summarize(await runs(() => popupView(db, POPUP_QUERY)), UI_READ_GATE_MS)');
  });
});

describe('the popup paint bench', () => {
  it('is registered, records both paints and the trace, and gates the median first paint at 100 ms', () => {
    expect(BENCHES.map((bench) => bench.name)).toContain('popup');
    // Running it here would launch Chromium; its source is read instead (as bench-gates.spec.ts reads bench/core.ts).
    const source = readFileSync(path.resolve(import.meta.dirname, '../../../../bench/popup.ts'), 'utf8');
    const gates = [...source.matchAll(/^\s*(\w*GatePassed):\s*(.+),$/gm)].map((match) => [
      match[1],
      match[2],
    ]);
    expect(gates).toEqual([['popupPaintGatePassed', "medianOf(runs, 'firstPaintMs') < POPUP_PAINT_GATE_MS"]]);
    expect(POPUP_PAINT_GATE_MS).toBe(100);
    expect(source).toContain('popupTrace: POPUP_TRACE,');
    expect(POPUP_TRACE).toBe('bench/traces/popup-paint.zip');
  });
});
