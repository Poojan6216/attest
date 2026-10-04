/**
 * The labels agree with the page they describe (sprint 2 tasks 2.1, 2.4; tests/fixtures/pages/README.md). The
 * observers' field accuracy (2.2, 2.3, 2.5) is measured against these labels, so a label that drifts from its page
 * would make a measured number false (Hard Rule 12). Each fact is re-read from the page with the reference readers
 * in fixture-page-read.ts, times in the page's own IANA zone (DST and midnight rows included):
 *  - Gmail Sent: every row is labelled (recipients, subject, minute), or it is a row that cannot be timed to the
 *    minute and the pass is DEGRADED; the visible time text agrees with the title; the window ends at lastSyncAt
 *    exactly at the head of the list (Hard Rule 5);
 *  - receipts: the message's id, subject, date, an amount it shows on a total line, and the merchant the rule names;
 *  - Calendar: each event's start, guests and calendar; coverage is the visible days minus a day hiding events
 *    behind "N more"; allCalendars only when every calendar is checked; each diff lists exactly the changes;
 *  - every listed seed is drawn on screen, not only held in screen-reader text.
 */
import { readFileSync } from 'node:fs';

import type { Document } from 'happy-dom';
import { afterAll, describe, expect, it } from 'vitest';

import { clampSubjectHint } from '../../../src/core/redact';
import { closeWindow, createInertWindow } from '../../tools/capture-dom';
import {
  type EventFact,
  labelFolders,
  type LabelledFixture,
  loadLabels,
  type ObservationFact,
} from './fixture-labels';
import {
  accountPaths,
  calendarList,
  chipGuests,
  chips,
  chipStart,
  dayWindows,
  gridDays,
  isShown,
  newerDisabled,
  openedMessage,
  selectedFolder,
  sentRows,
  timeOf,
} from './fixture-page-read';

const window = createInertWindow();
afterAll(() => {
  closeWindow(window);
});
const docs = new Map<string, Document>();
function docOf(fixture: LabelledFixture): Document {
  const cached = docs.get(fixture.htmlPath);
  if (cached) return cached;
  const doc = new window.DOMParser().parseFromString(readFileSync(fixture.htmlPath, 'utf8'), 'text/html');
  docs.set(fixture.htmlPath, doc);
  return doc;
}

const fixtures = labelFolders().flatMap(({ vendor, date }) => loadLabels(vendor, date));
const gmail = fixtures.filter((f) => f.vendor === 'gmail');
const gcal = fixtures.filter((f) => f.vendor === 'gcal');
const at = (f: LabelledFixture, text: string) => timeOf(text, f.page.readAt, f.page.timeZone);
const subjectHintOf = (subject: string) =>
  subject === '(no subject)' ? undefined : clampSubjectHint(subject);

/** Receipt merchants (Decisions [fixtures]): a platform parser's canonical name, else what the message names. */
const PLATFORM_MERCHANTS: Readonly<Record<string, string>> = {
  amazon: 'Amazon',
  uber: 'Uber',
  instacart: 'Instacart',
  marketplace: 'Facebook Marketplace',
};
const TOTAL_LINE = /\b(?:total|amount paid|amount charged|charged)\b/iu;

describe('seeded secrets are drawn on screen (2.1: visible text)', () => {
  it('each listed seed is distinct and has a marked copy no ancestor hides or clips', () => {
    for (const f of fixtures) {
      expect(new Set(f.label.seededSecrets).size, f.file).toBe(f.label.seededSecrets.length);
      for (const id of f.label.seededSecrets) {
        const marked = Array.from(docOf(f).querySelectorAll(`[data-attest-seeded="${id}"]`));
        expect(
          marked.some((el) => isShown(el, docOf(f))),
          `${f.file}: ${id}`,
        ).toBe(true);
      }
    }
  });
});

describe('page facts match the page', () => {
  it('the live URL is on the vendor host, and a Gmail page shows its folder, account path and view', () => {
    for (const f of fixtures) {
      const url = new URL(f.page.liveUrl);
      expect(url.hostname, f.file).toBe(f.vendor === 'gmail' ? 'mail.google.com' : 'calendar.google.com');
      if (f.vendor !== 'gmail') continue;
      const doc = docOf(f);
      expect(selectedFolder(doc), f.file).toBe(f.page.folder);
      expect(accountPaths(doc), f.file).toEqual([/^\/mail\/u\/\d+\//u.exec(url.pathname)?.[0]]);
      expect(url.hash.startsWith(`#${f.page.folder ?? ''}`), f.file).toBe(true);
      const isMessage = openedMessage(doc, f.page.defaultDollar) !== null;
      expect(isMessage, f.file).toBe(f.page.view === 'gmail.message');
      expect(sentRows(doc).length > 0, f.file).toBe(f.page.view.startsWith('gmail.list.'));
      if (!isMessage) expect(f.page.view, f.file).toBe(`gmail.list.${f.page.folder ?? ''}`);
    }
  });
});

describe('Gmail Sent facts match their rows (2.2 truth)', () => {
  const lists = gmail.filter((f) => f.page.view === 'gmail.list.sent');

  it('every row is labelled with its recipients, subject and minute, or cannot be timed and degrades the pass', () => {
    for (const f of lists) {
      const rows = sentRows(docOf(f));
      const degraded = f.health.find((h) => h.observer === 'gmail.sent')?.reasons ?? [];
      for (const row of rows) {
        const facts = f.observations.filter((o) => o.rowKey === row.key);
        const time = at(f, row.timeTitle ?? row.timeText);
        if (facts.length === 0) {
          expect(time?.precision, `${f.file}: unlabelled row ${row.key}`).not.toBe('minute');
          expect(degraded, `${f.file}: unlabelled row ${row.key}`).toContain('redact.missing_occurred_at');
          continue;
        }
        const counterparties = facts.map((o) => o.counterparty ?? '').sort();
        expect(counterparties, `${f.file}: ${row.key}`).toEqual([...row.recipients].sort());
        for (const o of facts) {
          expect(o.subjectHint, `${f.file}: ${row.key}`).toBe(subjectHintOf(row.subject));
          expect(time?.precision, `${f.file}: ${row.key}`).toBe('minute');
          expect(o.occurredAt, `${f.file}: ${row.key} ${row.timeTitle ?? row.timeText}`).toBe(time?.start);
        }
      }
      const keys = new Set(rows.map((r) => r.key));
      for (const o of f.observations)
        expect(keys.has(o.rowKey ?? ''), `${f.file}: ${o.rowKey ?? ''}`).toBe(true);
    }
  });

  it("a row's visible time agrees with its title: a clock for a send today, a date before today", () => {
    for (const f of lists) {
      for (const row of sentRows(docOf(f)).filter((r) => r.timeTitle !== null)) {
        const title = at(f, row.timeTitle ?? '');
        const shown = at(f, row.timeText);
        const instant = Date.parse(title?.start ?? '');
        expect(Date.parse(shown?.start ?? ''), `${f.file}: ${row.timeText}`).toBeLessThanOrEqual(instant);
        expect(Date.parse(shown?.end ?? ''), `${f.file}: ${row.timeText}`).toBeGreaterThan(instant);
        const today = at(f, 'Today');
        const sentToday = instant >= Date.parse(today?.start ?? '');
        expect(shown?.precision === 'minute', `${f.file}: ${row.timeText}`).toBe(sentToday);
      }
    }
  });

  it('a Sent window ends at lastSyncAt exactly when Newer is disabled (the head of the list)', () => {
    for (const f of lists) {
      for (const c of f.coverage) {
        expect(c.windowEnd === 'lastSyncAt', f.file).toBe(newerDisabled(docOf(f)));
      }
    }
  });
});

function receiptMatches(f: LabelledFixture, o: ObservationFact): void {
  const message = openedMessage(docOf(f), f.page.defaultDollar);
  expect(message, f.file).not.toBeNull();
  if (!message) return;
  expect(o.rowKey, f.file).toBe(message.key);
  expect(o.subjectHint, f.file).toBe(clampSubjectHint(message.subject));
  const date = at(f, message.dateTitle);
  expect([o.occurredAt, 'minute'], f.file).toEqual([date?.start, date?.precision]);
  const lines = message.lines.filter((line) =>
    line.amounts.some((m) => m.minor === o.amountCents && m.currency === o.currency),
  );
  expect(lines.length, `${f.file}: amount shown`).toBeGreaterThan(0);
  if (o.type !== 'listing.posted')
    expect(
      lines.some((line) => TOTAL_LINE.test(line.text)),
      `${f.file}: amount on a total line`,
    ).toBe(true);
  const platform = PLATFORM_MERCHANTS[o.parser ?? ''];
  if (platform !== undefined) expect(o.merchant, f.file).toBe(platform);
  else if (o.parser === 'opentable') expect(message.subject, f.file).toContain(o.merchant ?? '\u0000');
  else expect(o.merchant, f.file).toBe(message.senderName);
}

describe('receipt facts match their message (2.3 truth)', () => {
  it('id, subject, message date, the charged amount on a total line, and the merchant the rule names', () => {
    const receipts = gmail.flatMap((f) =>
      f.observations.filter((o) => o.source === 'gmail.receipt').map((o) => ({ f, o })),
    );
    expect(receipts.length).toBeGreaterThanOrEqual(8);
    for (const { f, o } of receipts) receiptMatches(f, o);
  });
});

describe('Calendar facts match the grid (2.5 truth)', () => {
  it("each event has its chip's start (all day: local midnight), guests and a checked calendar", () => {
    for (const f of gcal) {
      const shown = calendarList(docOf(f)).filter((c) => c.checked);
      const byKey = new Map(chips(docOf(f)).map((chip) => [chip.key, chip.label]));
      for (const e of f.events) {
        const label = byKey.get(e.rowKey) ?? '';
        expect(chipStart(label, f.page.readAt, f.page.timeZone), `${f.file}: ${label}`).toEqual({
          start: e.occurredAt,
          allDay: e.allDay,
        });
        expect(e.attendees, `${f.file}: ${label}`).toEqual(chipGuests(label));
        expect(label, f.file).toContain(`, ${e.subjectHint}, ${e.calendar}`);
        expect(
          shown.map((c) => c.name),
          f.file,
        ).toContain(e.calendar);
      }
    }
  });

  it('coverage is the visible days minus any day hiding events behind "N more"; allCalendars iff all checked', () => {
    for (const f of gcal) {
      const days = gridDays(docOf(f));
      const windows = f.coverage.map(({ windowStart, windowEnd }) => ({ windowStart, windowEnd }));
      expect(windows, f.file).toEqual(dayWindows(days, f.page.readAt, f.page.timeZone));
      const all = calendarList(docOf(f)).every((c) => c.checked);
      for (const c of f.coverage) expect(c.allCalendars, f.file).toBe(all);
    }
  });
});

/**
 * The reference diff: by event id, within calendars checked in both snapshots, one observation per event, naming its
 * first guest in ASCII-lowercase order or none (Decisions [2.5]).
 */
function referenceDiff(before: LabelledFixture, after: LabelledFixture): string[] {
  const shownIn = (f: LabelledFixture) => calendarList(docOf(f)).flatMap((c) => (c.checked ? [c.name] : []));
  const both = shownIn(after).filter((name) => shownIn(before).includes(name));
  const was = before.events.filter((e) => both.includes(e.calendar));
  const now = after.events.filter((e) => both.includes(e.calendar));
  const firstGuest = (e: EventFact) =>
    [...e.attendees].sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    })[0] ?? '';
  const rows = (type: string, e: EventFact) => [
    `${type} ${e.rowKey} ${firstGuest(e)} ${e.occurredAt} ${e.subjectHint}`,
  ];
  const same = (a: EventFact, b: EventFact) =>
    a.occurredAt === b.occurredAt &&
    a.subjectHint === b.subjectHint &&
    a.attendees.join() === b.attendees.join();
  return [
    ...now.flatMap((e) => {
      const old = was.find((w) => w.rowKey === e.rowKey);
      if (!old) return rows('calendar.created', e);
      return same(old, e) ? [] : rows('calendar.updated', e);
    }),
    ...was.filter((w) => !now.some((e) => e.rowKey === w.rowKey)).flatMap((w) => rows('calendar.deleted', w)),
  ].sort();
}

describe('Calendar diffs are complete (2.5 truth)', () => {
  it('each diff lists exactly the changes between its two snapshots', () => {
    const diffs = gcal.flatMap((f) => f.diffs.map((d) => ({ f, d })));
    expect(diffs.length).toBeGreaterThanOrEqual(4);
    for (const { f, d } of diffs) {
      const before = gcal.find((g) => g.dir === f.dir && g.file === d.from);
      expect(before, `${f.file} ← ${d.from}`).toBeDefined();
      if (!before) continue;
      const labelled = d.observations
        .map(
          (o) => `${o.type} ${o.rowKey ?? ''} ${o.counterparty ?? ''} ${o.occurredAt} ${o.subjectHint ?? ''}`,
        )
        .sort();
      expect(labelled, `${f.file} ← ${d.from}`).toEqual(referenceDiff(before, f));
    }
  });
});
