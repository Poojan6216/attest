/**
 * The receipt surfaces' words (sprint_4 4.1; src/ui/receipt-labels.ts, src/ui/format.ts): grade names, the coverage
 * header's lines (checked, not checked since, not checked yet, activity added), the degraded line and its report link
 * (the adapter's id and version and the Chrome major version, nothing else), and each piece of evidence in one line
 * and field by field. Times are on the clock of the zone the test runs in; every assertion holds in any zone.
 */
import { describe, expect, it } from 'vitest';

import { COVERAGE_FRESH_MINUTES, ISSUES_URL } from '../../../src/config';
import { idFromHash } from '../../../src/core/hash';
import { contentHashOf } from '../../../src/core/redact';
import { AdapterHealth, CoveragePing, Grade, IsoTs, Observation } from '../../../src/ledger/types';
import { clockTime, formatMoney } from '../../../src/ui/format';
import {
  adapterName,
  chromeMajor,
  coverageLines,
  degradedLine,
  evidenceFields,
  evidenceSummary,
  gradeLabel,
  reportUrl,
} from '../../../src/ui/receipt-labels';

const MINUTE = 60_000;
/** A local noon, so a time a few hours either side is still today in every zone. */
const NOW = new Date(2026, 9, 9, 12, 0).getTime();
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

function ping(source: 'gmail.sent' | 'gmail.receipt' | 'gcal.event', syncMs: number) {
  return CoveragePing.parse({
    observerId: source,
    source,
    userActive: true,
    lastSyncAt: iso(syncMs),
    windowStart: iso(syncMs - 60 * MINUTE),
    windowEnd: iso(syncMs),
  });
}

function observation(content: Readonly<Record<string, unknown>>) {
  const contentHash = contentHashOf(content);
  return Observation.parse({ ...content, contentHash, id: idFromHash(contentHash) });
}

describe('names and times', () => {
  it('names every grade as a noun, and every adapter, an unknown one by its id', () => {
    expect(Grade.options.map(gradeLabel)).toEqual([
      'Verified',
      'Partial',
      'Not found',
      'Unasked',
      'Over scope',
      'Unverifiable',
    ]);
    expect(adapterName('gmail.sent')).toBe('Gmail Sent reader');
    expect(adapterName('gcal.event')).toBe('Calendar reader');
    expect(adapterName('toString')).toBe('toString');
    expect(adapterName('someone.else')).toBe('someone.else');
  });

  it('writes a time today as HH:MM, another day with its day, another year with its year', () => {
    expect(clockTime(iso(new Date(2026, 9, 9, 9, 5).getTime()), NOW)).toBe('09:05');
    expect(clockTime(iso(new Date(2026, 9, 8, 23, 59).getTime()), NOW)).toBe('8 Oct, 23:59');
    expect(clockTime(iso(new Date(2025, 11, 31, 7, 30).getTime()), NOW)).toBe('31 Dec 2025, 07:30');
    expect(clockTime('not a time', NOW)).toBe('not a time');
  });

  it('writes an amount in its currency and minor units', () => {
    expect(formatMoney(1250, 'USD')).toBe('$12.50');
    expect(formatMoney(1200, 'JPY')).toBe('¥1,200');
  });
});

describe('coverageLines', () => {
  it('says checked within the fresh window, not checked since after it, and not checked yet with none', () => {
    const fresh = NOW - COVERAGE_FRESH_MINUTES * MINUTE;
    const lines = coverageLines(
      { coverage: [ping('gcal.event', NOW - 3 * 60 * MINUTE), ping('gmail.sent', fresh)], imports: {} },
      NOW,
    );
    expect(lines).toEqual([
      { key: 'gmail.sent', text: `Gmail Sent checked ${clockTime(iso(fresh), NOW)}`, current: true },
      { key: 'gmail.receipt', text: 'Gmail receipts not checked yet', current: false },
      { key: 'gcal.event', text: 'Calendar not checked since 09:00', current: false },
    ]);
    const stale = coverageLines({ coverage: [ping('gmail.sent', fresh - 1)], imports: {} }, NOW);
    expect(stale[0]?.current).toBe(false);
    expect(stale[0]?.text).toMatch(/^Gmail Sent not checked since /u);
  });

  it("reads each source's latest ping, and adds each agent's activity in the agents' order", () => {
    const lines = coverageLines(
      {
        coverage: [ping('gmail.sent', NOW - MINUTE), ping('gmail.sent', NOW - 5 * 60 * MINUTE)],
        imports: { claude: iso(NOW - 2 * 60 * MINUTE), muse: iso(NOW - 30 * MINUTE) },
      },
      NOW,
    );
    expect(lines.map(({ text }) => text)).toEqual([
      'Gmail Sent checked 11:59',
      'Gmail receipts not checked yet',
      'Calendar not checked yet',
      'Muse activity added 11:30',
      'Claude activity added 10:00',
    ]);
  });
});

describe('the degraded line and its report link', () => {
  const degraded = AdapterHealth.parse({
    adapterId: 'gmail.sent',
    version: '1.5.0',
    status: 'DEGRADED',
    reasons: ['not_sent_folder'],
    checkedAt: iso(NOW),
  });

  it('names the reader and version and says what it means', () => {
    expect(degradedLine(degraded)).toBe(
      'Gmail Sent reader 1.5.0 is not reading its page as expected. Receipts that need it may be Unverifiable.',
    );
  });

  it('fills a new issue with the id, the version and the Chrome major version, and nothing else', () => {
    const url = new URL(reportUrl(degraded, UA));
    expect(`${url.origin}${url.pathname}`).toBe(ISSUES_URL);
    expect([...url.searchParams.keys()]).toEqual(['title', 'body']);
    expect(url.searchParams.get('title')).toBe('Degraded: gmail.sent 1.5.0');
    expect(url.searchParams.get('body')).toBe('Adapter: gmail.sent\nVersion: 1.5.0\nChrome: 153\n');
    expect(url.toString()).not.toContain('not_sent_folder');
    expect(chromeMajor('Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0')).toBeNull();
    expect(new URL(reportUrl(degraded, 'unknown agent')).searchParams.get('body')).toContain(
      'Chrome: unknown',
    );
  });
});

describe('evidence', () => {
  it('says what each piece is in one line, and lists every stored field, first seen and stored apart', () => {
    const sent = observation({
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'priya@example.com',
      subjectHint: 'Q3 deck',
      occurredAt: iso(new Date(2026, 9, 9, 10, 2).getTime()),
      observedAt: iso(new Date(2026, 9, 9, 10, 4).getTime()),
      sightedAt: iso(new Date(2026, 9, 9, 10, 3).getTime()),
      rowKeyHash: 'ab'.repeat(32),
    });
    expect(evidenceSummary(sent, NOW)).toBe('Sent email, 10:02, to priya@example.com, “Q3 deck”');
    expect(evidenceFields(sent, NOW)).toEqual([
      ['Source', 'Gmail Sent'],
      ['What', 'Email sent'],
      ['When', '10:02'],
      ['To', 'priya@example.com'],
      ['Subject', 'Q3 deck'],
      ['Attest saw it', '10:03'],
      ['Saved', '10:04'],
    ]);
    const order = observation({
      source: 'gmail.receipt',
      type: 'purchase.made',
      merchant: 'Blue Bottle',
      amountCents: 1250,
      currency: 'USD',
      occurredAt: iso(new Date(2026, 9, 7, 8, 0).getTime()),
      observedAt: iso(new Date(2026, 9, 7, 8, 1).getTime()),
      rowKeyHash: 'cd'.repeat(32),
    });
    expect(evidenceSummary(order, NOW)).toBe('Order email, 7 Oct, 08:00, Blue Bottle, $12.50');
    expect(evidenceFields(order, NOW).map(([label]) => label)).toEqual([
      'Source',
      'What',
      'When',
      'Merchant',
      'Amount',
      'Attest saw it',
      'Saved',
    ]);
  });
});
