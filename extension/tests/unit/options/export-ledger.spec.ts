// @vitest-environment happy-dom
import 'fake-indexeddb/auto';

/**
 * The options page's "Export ledger" (Sprint 2 close, pulled forward from 4.5 for the live smoke, MANUAL.md step 8).
 * The page asks the service worker for the ledger over the real bus (createHandlers + listen), checks the answer
 * against the export schema, and hands the browser one JSON file. A refused, malformed or unsaveable export is said
 * on the page and logged, never saved (Hard Rule 6). The E2E suite saves a real file (tests/e2e/options-export.spec.ts).
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { ExportSection } from '../../../entrypoints/options/components/ExportSection';
import {
  exportFileName,
  exportLedgerFile,
  type SaveFile,
  saveJsonFile,
} from '../../../entrypoints/options/export-ledger';
import { createHandlers } from '../../../src/background/router';
import { listen } from '../../../src/bus/listen';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { exportLedger, LedgerExport } from '../../../src/ledger/export';
import { closeLedger, getLedger, upsertObservation } from '../../../src/ledger/repo';
import { captureLogs, connectAs, extensionPage } from '../bus/harness';
import { makeObservation, pinClock, releaseClock } from '../ledger/fixtures';

/** Late evening west of UTC: the export's own date is the 5th, UTC's is already the 6th. */
const EXPORTED_AT = '2026-10-05T23:30:00-04:00';
const FILE_NAME = 'attest-ledger-2026-10-05.json';

const records = captureLogs();
let stopListening: () => void = () => undefined;
let root: HTMLElement;

beforeEach(async () => {
  fakeBrowser.reset();
  const db = await getLedger();
  await Promise.all(db.tables.map((table) => table.clear()));
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(async () => {
  render(null, root);
  root.remove();
  stopListening();
  stopListening = () => undefined;
  vi.restoreAllMocks();
  await closeLedger();
});

/** The service worker, answering the options page as it does in the product. */
function serveLedger(): void {
  connectAs(extensionPage('/options.html'));
  stopListening = listen(createHandlers(() => EXPORTED_AT));
}

async function seedOneSend(): Promise<void> {
  pinClock('2026-10-01T10:30:00-04:00');
  try {
    await upsertObservation(await getLedger(), makeObservation(), DEFAULT_POLICY);
  } finally {
    releaseClock();
  }
}

function collect(): { readonly save: SaveFile; readonly saved: (readonly [string, string])[] } {
  const saved: (readonly [string, string])[] = [];
  return { save: (fileName, json) => saved.push([fileName, json]), saved };
}

function failures(): { readonly level: string; readonly reason: unknown }[] {
  return records
    .filter((record) => record.event === 'options.export_failed')
    .map((record) => ({ level: record.level, reason: record.fields.reason }));
}

describe('exportLedgerFile', () => {
  it("hands the browser the worker's whole export as one JSON file named for the export's own date", async () => {
    await seedOneSend();
    serveLedger();
    const { save, saved } = collect();
    expect(await exportLedgerFile(save)).toEqual({ fileName: FILE_NAME });
    expect(saved.map(([name]) => name)).toEqual([FILE_NAME]);
    const json = saved[0]?.[1] ?? '';
    const file = LedgerExport.parse(JSON.parse(json));
    expect(file).toEqual(await exportLedger(await getLedger(), { exportedAt: EXPORTED_AT }));
    expect(file.tables.observations).toHaveLength(1);
    expect(json.endsWith('}\n')).toBe(true);
    expect(failures()).toEqual([]);
  });

  it('saves nothing when no service worker answers, and says why in the log', async () => {
    const { save, saved } = collect();
    expect(await exportLedgerFile(save)).toBeNull();
    expect(saved).toEqual([]);
    expect(failures()).toEqual([{ level: 'warn', reason: 'unavailable' }]);
  });

  it('refuses an answer that is not a ledger export (schema checked at the boundary)', async () => {
    connectAs(extensionPage('/options.html'));
    stopListening = listen({
      'ui.query': () =>
        Promise.resolve({ type: 'ui.result', kind: 'ledger.export', ok: true, data: { format: 'other' } }),
    });
    const { save, saved } = collect();
    expect(await exportLedgerFile(save)).toBeNull();
    expect(saved).toEqual([]);
    expect(failures()).toEqual([{ level: 'error', reason: 'malformed' }]);
  });

  it('resolves null, never rejects, when the browser cannot take the file', async () => {
    serveLedger();
    const result = await exportLedgerFile(() => {
      throw new Error('quota');
    });
    expect(result).toBeNull();
    expect(failures()).toEqual([{ level: 'error', reason: undefined }]);
  });
});

describe('exportFileName', () => {
  it("uses the export time's own calendar date, never UTC's", () => {
    expect(exportFileName(EXPORTED_AT)).toBe(FILE_NAME);
    expect(exportFileName('2026-01-02T00:10:00+09:00')).toBe('attest-ledger-2026-01-02.json');
  });
});

describe('saveJsonFile', () => {
  function stubObjectUrls(): { readonly blobs: Blob[]; readonly revoked: string[] } {
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error('expected a Blob');
      blobs.push(blob);
      return `blob:attest/${String(blobs.length)}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url);
    });
    return { blobs, revoked };
  }

  it('clicks one download link named for the file on a JSON blob, then releases the URL', async () => {
    const { blobs, revoked } = stubObjectUrls();
    const clicks: { readonly download: string; readonly href: string; readonly released: number }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href, released: revoked.length });
    });
    saveJsonFile(FILE_NAME, '{"format":"attest-ledger"}\n');
    expect(clicks).toEqual([{ download: FILE_NAME, href: 'blob:attest/1', released: 0 }]);
    expect(revoked).toEqual(['blob:attest/1']);
    expect(blobs.map((blob) => blob.type)).toEqual(['application/json']);
    expect(await blobs[0]?.text()).toBe('{"format":"attest-ledger"}\n');
  });

  it('releases the URL even when the click throws', () => {
    const { revoked } = stubObjectUrls();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      saveJsonFile(FILE_NAME, '{}');
    }).toThrow('blocked');
    expect(revoked).toEqual(['blob:attest/1']);
  });
});

/**
 * Lets the export run to its end: the real handlers read the ledger from fake-indexeddb, which under a loaded
 * machine takes more than a few event-loop turns, so this waits for the status to leave "Exporting…" (at most 10 s).
 */
async function settle(): Promise<void> {
  const deadline = Date.now() + 10_000;
  do {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  } while (status() === 'Exporting…' && Date.now() < deadline);
}

function exportButton(): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === 'Export ledger',
  );
  if (!found) throw new Error('no Export ledger button');
  return found;
}

function status(): string {
  return root.querySelector('[role="status"]')?.textContent.trim() ?? '';
}

describe('ExportSection', () => {
  it('says which file it handed the browser', async () => {
    serveLedger();
    const { save, saved } = collect();
    await act(() => {
      render(h(ExportSection, { save }), root);
    });
    expect(status()).toBe('');
    await act(() => {
      exportButton().click();
    });
    expect(status()).toBe('Exporting…');
    await settle();
    expect(status()).toBe(`Exported ${FILE_NAME}.`);
    expect(saved.map(([name]) => name)).toEqual([FILE_NAME]);
  });

  it('says so when the export failed (Hard Rule 6), and a second click tries again', async () => {
    const { save, saved } = collect();
    await act(() => {
      render(h(ExportSection, { save }), root);
    });
    await act(() => {
      exportButton().click();
    });
    await settle();
    expect(status()).toBe('Could not export the ledger. Try again.');
    serveLedger();
    await act(() => {
      exportButton().click();
    });
    await settle();
    expect(status()).toBe(`Exported ${FILE_NAME}.`);
    expect(saved).toHaveLength(1);
  });

  it('runs one export at a time: a second click while exporting does nothing', async () => {
    serveLedger();
    const { save, saved } = collect();
    await act(() => {
      render(h(ExportSection, { save }), root);
    });
    await act(() => {
      exportButton().click();
      exportButton().click();
    });
    await settle();
    expect(saved).toHaveLength(1);
  });
});
