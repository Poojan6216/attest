// @vitest-environment happy-dom
import 'fake-indexeddb/auto';

/**
 * The options page's exports (sprint_4 4.5; entrypoints/options/export-ledger.ts): the page builds the ledger's JSON
 * file and the receipts' CSV file from its own connection to the ledger, never asking the service worker, and hands the
 * browser one file named for the export's own date: the JSON is the bytes of the single-message export. An export
 * that cannot be built or saved is said on the page and logged, never saved (Hard Rule 6). The E2E suite saves real
 * files (tests/e2e/options-export.spec.ts).
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { ExportSection } from '../../../entrypoints/options/components/ExportSection';
import {
  exportFile,
  exportFileName,
  type SaveFile,
  saveFile,
} from '../../../entrypoints/options/export-ledger';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { clearKeyring, setKeyring } from '../../../src/crypto/keyring';
import { exportLedger } from '../../../src/ledger/export';
import { receiptsCsvBlob } from '../../../src/ledger/export-csv';
import { closeLedger, getLedger, upsertObservation } from '../../../src/ledger/repo';
import { captureLogs } from '../bus/harness';
import { makeObservation, pinClock, releaseClock } from '../ledger/fixtures';

/** Late evening west of UTC: the export's own date is the 5th, UTC's is already the 6th. */
const EXPORTED_AT = '2026-10-05T23:30:00-04:00';
const LEDGER_FILE = 'attest-ledger-2026-10-05.json';
const RECEIPTS_FILE = 'attest-receipts-2026-10-05.csv';
const clock = () => EXPORTED_AT;

const records = captureLogs();
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
  vi.restoreAllMocks();
  await closeLedger();
});

async function seedOneSend(): Promise<void> {
  pinClock('2026-10-01T10:30:00-04:00');
  try {
    await upsertObservation(await getLedger(), makeObservation(), DEFAULT_POLICY);
  } finally {
    releaseClock();
  }
}

function collect(): { readonly save: SaveFile; readonly saved: (readonly [string, Blob])[] } {
  const saved: (readonly [string, Blob])[] = [];
  return { save: (fileName, file) => saved.push([fileName, file]), saved };
}

const failures = () =>
  records.filter((record) => record.event === 'options.export_failed').map(({ level }) => level);

describe('exportFile', () => {
  it('hands the browser the ledger as the bytes of the single-message export, named for its own date', async () => {
    await seedOneSend();
    const { save, saved } = collect();
    expect(await exportFile('ledger', save, clock)).toEqual({ fileName: LEDGER_FILE });
    expect(saved.map(([name, file]) => [name, file.type])).toEqual([[LEDGER_FILE, 'application/json']]);
    const single = await exportLedger(await getLedger(), { exportedAt: EXPORTED_AT });
    expect(await saved[0]?.[1].text()).toBe(`${JSON.stringify(single, null, 2)}\n`);
    expect(single.tables.observations).toHaveLength(1);
    expect(failures()).toEqual([]);
  });

  it('hands the browser the receipts as one CSV file', async () => {
    const { save, saved } = collect();
    expect(await exportFile('receipts', save, clock)).toEqual({ fileName: RECEIPTS_FILE });
    expect(saved.map(([name, file]) => [name, file.type])).toEqual([[RECEIPTS_FILE, 'text/csv']]);
    expect(await saved[0]?.[1].text()).toBe(await (await receiptsCsvBlob(await getLedger())).text());
  });

  it('resolves null, never rejects, when the file cannot be built or the browser cannot take it', async () => {
    const { save, saved } = collect();
    expect(await exportFile('ledger', save, () => '2026-10-05T23:30:00')).toBeNull();
    expect(saved).toEqual([]);
    const refused = await exportFile('receipts', () => {
      throw new Error('quota');
    });
    expect(refused).toBeNull();
    expect(failures()).toEqual(['error', 'error']);
  });
});

describe('an encrypted ledger, locked (sprint_6 6.5)', () => {
  it('exports nothing, resolves `locked`, logs no failure, and the page says to unlock first', async () => {
    await seedOneSend();
    setKeyring({ sealing: true, guarded: true });
    try {
      const { save, saved } = collect();
      expect(await exportFile('ledger', save, clock)).toBe('locked');
      expect(await exportFile('receipts', save, clock)).toBe('locked');
      expect(saved).toEqual([]);
      expect(failures()).toEqual([]);
      await act(() => {
        render(h(ExportSection, { save, clock }), root);
      });
      const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Export ledger');
      await act(async () => {
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await vi.waitFor(() => {
        expect(root.querySelector('[role="status"]')?.textContent).toBe(
          'Your records are encrypted and locked. Unlock them under Encryption, then export.',
        );
      });
    } finally {
      clearKeyring();
    }
  });
});

describe('exportFileName', () => {
  it("uses the export time's own calendar date, never UTC's", () => {
    expect(exportFileName('ledger', EXPORTED_AT)).toBe(LEDGER_FILE);
    expect(exportFileName('receipts', EXPORTED_AT)).toBe(RECEIPTS_FILE);
    expect(exportFileName('ledger', '2026-01-02T00:10:00+09:00')).toBe('attest-ledger-2026-01-02.json');
  });
});

describe('saveFile', () => {
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

  it('clicks one download link named for the file on its blob, then releases the URL', () => {
    const { blobs, revoked } = stubObjectUrls();
    const clicks: { readonly download: string; readonly href: string; readonly released: number }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href, released: revoked.length });
    });
    const file = new Blob(['{}\n'], { type: 'application/json' });
    saveFile(LEDGER_FILE, file);
    expect(clicks).toEqual([{ download: LEDGER_FILE, href: 'blob:attest/1', released: 0 }]);
    expect(revoked).toEqual(['blob:attest/1']);
    expect(blobs).toEqual([file]);
  });

  it('releases the URL even when the click throws', () => {
    const { revoked } = stubObjectUrls();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      saveFile(LEDGER_FILE, new Blob(['{}']));
    }).toThrow('blocked');
    expect(revoked).toEqual(['blob:attest/1']);
  });
});

/** Lets an export run to its end: fake-indexeddb under a loaded machine takes a few event-loop turns (at most 10 s). */
async function settle(): Promise<void> {
  const deadline = Date.now() + 10_000;
  do {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  } while (status() === 'Exporting…' && Date.now() < deadline);
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === name);
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

function status(): string {
  return root.querySelector('[role="status"]')?.textContent.trim() ?? '';
}

describe('ExportSection', () => {
  it('says which file it handed the browser, for the ledger and for the receipts', async () => {
    const { save, saved } = collect();
    await act(() => {
      render(h(ExportSection, { save, clock }), root);
    });
    expect(status()).toBe('');
    await act(() => {
      button('Export ledger').click();
    });
    expect(status()).toBe('Exporting…');
    await settle();
    expect(status()).toBe(`Exported ${LEDGER_FILE}.`);
    await act(() => {
      button('Export receipts').click();
    });
    await settle();
    expect(status()).toBe(`Exported ${RECEIPTS_FILE}.`);
    expect(saved.map(([name]) => name)).toEqual([LEDGER_FILE, RECEIPTS_FILE]);
  });

  it('says so when an export failed (Hard Rule 6), and a second click tries again', async () => {
    let refuse = true;
    const { save, saved } = collect();
    const flaky: SaveFile = (name, file) => {
      if (refuse) throw new Error('quota');
      save(name, file);
    };
    await act(() => {
      render(h(ExportSection, { save: flaky, clock }), root);
    });
    await act(() => {
      button('Export receipts').click();
    });
    await settle();
    expect(status()).toBe('Could not export the receipts. Try again.');
    refuse = false;
    await act(() => {
      button('Export receipts').click();
    });
    await settle();
    expect(status()).toBe(`Exported ${RECEIPTS_FILE}.`);
    expect(saved).toHaveLength(1);
  });

  it('runs one export at a time: a second click while exporting does nothing', async () => {
    const { save, saved } = collect();
    await act(() => {
      render(h(ExportSection, { save, clock }), root);
    });
    await act(() => {
      button('Export ledger').click();
      button('Export receipts').click();
    });
    await settle();
    expect(saved.map(([name]) => name)).toEqual([LEDGER_FILE]);
  });
});
