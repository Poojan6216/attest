/**
 * The labels agree with the page they describe (sprint 2 tasks 2.1, 2.4; tests/fixtures/pages/README.md). The
 * observers' field accuracy (2.2, 2.3, 2.5) is measured against these labels, so a label that drifts from its page
 * would make a measured number false (Hard Rule 12). Each fact is re-read from the page with the reference readers
 * in fixture-page-read.ts, times in the page's own IANA zone (DST and midnight rows included):
 *  - Gmail Sent: every row is labelled (recipients, subject, minute), or it is a conversation (no fact), or it is a
 *    row that cannot be timed to the minute and the pass is DEGRADED; the visible time text agrees with the title;
 *    the window starts at the oldest row (a minute later while the list may go on) and after the newest
 *    conversation, and ends at lastSyncAt exactly at the head of the list (Hard Rule 5);
 *  - receipts: the message's id, subject, date, an amount it shows on a total line, and the merchant the rule names;
 *  - Calendar: each event's start, guests and calendar; coverage is the visible days minus a day hiding events
 *    behind "N more"; allCalendars only when every calendar is checked; each diff lists exactly the changes;
 *  - every listed seed is drawn on screen, not only held in screen-reader text.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { clampSubjectHint } from '../../../src/core/redact';
import {
  type EventFact,
  labelFolders,
  type LabelledFixture,
  loadLabels,
  type ObservationFact,
} from './fixture-labels';
import { eachPage, fixtureDocs } from './fixture-docs';
import {
  accountPaths,
  calendarList,
  chipGuests,
  chips,
  chipStart,
  dayWindows,
  gridDays,
  isShown,
  longDate,
  newerDisabled,
  olderDisabled,
  ownMailbox,
  selectedFolder,
  sentRows,
  stillDrawing,
  timeOf,
} from './fixture-page-read';
import { openedMessages } from './fixture-message-read';

const { docOf, closeAll } = fixtureDocs();
afterAll(closeAll);

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
  it('each listed seed is distinct and has a marked copy no ancestor hides or clips', async () => {
    await eachPage(fixtures, (f) => {
      expect(new Set(f.label.seededSecrets).size, f.file).toBe(f.label.seededSecrets.length);
      for (const id of f.label.seededSecrets) {
        const marked = Array.from(docOf(f).querySelectorAll(`[data-attest-seeded="${id}"]`));
        expect(
          marked.some((el) => isShown(el, docOf(f))),
          `${f.file}: ${id}`,
        ).toBe(true);
      }
    });
  });
});

describe('page facts match the page', () => {
  it('the live URL is on the vendor host, and a Gmail page shows its folder, account path and view', async () => {
    await eachPage(fixtures, (f) => {
      const url = new URL(f.page.liveUrl);
      expect(url.hostname, f.file).toBe(f.vendor === 'gmail' ? 'mail.google.com' : 'calendar.google.com');
      if (f.vendor !== 'gmail') return;
      const doc = docOf(f);
      // A message opened from a search selects no folder (real capture, 2026-10-06).
      expect(selectedFolder(doc) ?? undefined, f.file).toBe(f.page.folder);
      expect(accountPaths(doc), f.file).toEqual([/^\/mail\/u\/\d+\//u.exec(url.pathname)?.[0]]);
      expect(url.hash.startsWith(`#${f.page.folder ?? ''}`), f.file).toBe(true);
      const isMessage = openedMessages(doc, f.page.defaultDollar).length > 0;
      expect(isMessage, f.file).toBe(f.page.view === 'gmail.message');
      // A message view shows no list row; a Sent list shows rows (a Drafts folder may be empty: real, 2026-10-06).
      if (isMessage) expect(sentRows(doc), f.file).toEqual([]);
      if (f.page.view === 'gmail.list.sent') expect(sentRows(doc).length, f.file).toBeGreaterThan(0);
      if (!isMessage) expect(f.page.view, f.file).toBe(`gmail.list.${f.page.folder ?? ''}`);
    });
  });
});

describe('Gmail Sent facts match their rows (2.2 truth)', () => {
  const lists = gmail.filter((f) => f.page.view === 'gmail.list.sent');

  it('every row is labelled with its recipients, subject and minute, or cannot be timed and degrades the pass', async () => {
    await eachPage(lists, (f) => {
      const rows = sentRows(docOf(f));
      const degraded = f.health.find((h) => h.observer === 'gmail.sent')?.reasons ?? [];
      for (const row of rows) {
        const facts = f.observations.filter((o) => o.rowKey === row.key);
        const time = at(f, row.timeTitle ?? row.timeText);
        if (row.conversation) {
          // A conversation's time is its newest message's, not a send's: no fact (grading contract v1.13).
          expect(facts, `${f.file}: conversation row ${row.key}`).toEqual([]);
          continue;
        }
        // The account's mailbox is never a counterparty; a timed row only to it gives no fact (privacy §6).
        const others = row.recipients.filter((r) => !ownMailbox(r, f.page.account));
        if (others.length === 0 && time?.precision === 'minute') {
          expect(facts, `${f.file}: row to the account ${row.key}`).toEqual([]);
          continue;
        }
        if (facts.length === 0) {
          expect(time?.precision, `${f.file}: unlabelled row ${row.key}`).not.toBe('minute');
          expect(degraded, `${f.file}: unlabelled row ${row.key}`).toContain('redact.missing_occurred_at');
          continue;
        }
        const counterparties = facts.map((o) => o.counterparty ?? '').sort();
        expect(counterparties, `${f.file}: ${row.key}`).toEqual([...others].sort());
        for (const o of facts) {
          expect(o.subjectHint, `${f.file}: ${row.key}`).toBe(subjectHintOf(row.subject));
          expect(time?.precision, `${f.file}: ${row.key}`).toBe('minute');
          expect(o.occurredAt, `${f.file}: ${row.key} ${row.timeTitle ?? row.timeText}`).toBe(time?.start);
        }
      }
      const keys = new Set(rows.map((r) => r.key));
      for (const o of f.observations)
        expect(keys.has(o.rowKey ?? ''), `${f.file}: ${o.rowKey ?? ''}`).toBe(true);
    });
  });

  it("a row's visible time agrees with its title: a clock for a send today, a date before today", async () => {
    await eachPage(lists, (f) => {
      for (const row of sentRows(docOf(f)).filter((r) => r.timeTitle !== null)) {
        const title = at(f, row.timeTitle ?? '');
        const shown = at(f, longDate(row.timeText));
        const instant = Date.parse(title?.start ?? '');
        expect(Date.parse(shown?.start ?? ''), `${f.file}: ${row.timeText}`).toBeLessThanOrEqual(instant);
        expect(Date.parse(shown?.end ?? ''), `${f.file}: ${row.timeText}`).toBeGreaterThan(instant);
        const today = at(f, 'Today');
        const sentToday = instant >= Date.parse(today?.start ?? '');
        expect(shown?.precision === 'minute', `${f.file}: ${row.timeText}`).toBe(sentToday);
      }
    });
  });
});

describe('Gmail Sent windows (2.2 truth; Hard Rule 5)', () => {
  const lists = gmail.filter((f) => f.page.view === 'gmail.list.sent');

  it('a Sent window starts at the oldest row (a minute later while the list may go on) and after the newest unmatched row', async () => {
    await eachPage(
      lists.filter((x) => x.coverage.some((c) => c.source === 'gmail.sent')),
      (f) => {
        const rows = sentRows(docOf(f));
        const minute = (row: (typeof rows)[number]) =>
          Date.parse(at(f, row.timeTitle ?? row.timeText)?.start ?? '');
        // Rows no claim can be matched to: conversations, and rows that name the account.
        const unmatched = rows
          .filter((row) => row.conversation || row.recipients.some((r) => ownMailbox(r, f.page.account)))
          .map(minute);
        const start = Math.max(
          Math.min(...rows.map(minute)) + (olderDisabled(docOf(f)) ? 0 : 60_000),
          unmatched.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...unmatched) + 60_000,
        );
        for (const c of f.coverage) expect(Date.parse(c.windowStart), f.file).toBe(start);
      },
    );
  });

  it('a Sent window ends at lastSyncAt exactly when Newer is disabled (the head of the list)', async () => {
    await eachPage(lists, (f) => {
      for (const c of f.coverage) {
        expect(c.windowEnd === 'lastSyncAt', f.file).toBe(newerDisabled(docOf(f)));
      }
    });
  });
});

function receiptMatches(f: LabelledFixture, o: ObservationFact): void {
  const message = openedMessages(docOf(f), f.page.defaultDollar).find((m) => m.key === o.rowKey);
  // `find` gives undefined, never null: a fact whose message the reference reader cannot find fails here (TECH-L5).
  expect(message, `${f.file}: ${o.rowKey ?? ''}`).toBeDefined();
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
  it('id, subject, message date, the charged amount on a total line, and the merchant the rule names', async () => {
    const receipts = gmail.flatMap((f) =>
      f.observations.filter((o) => o.source === 'gmail.receipt').map((o) => ({ f, o })),
    );
    expect(receipts.length).toBeGreaterThanOrEqual(8);
    await eachPage(receipts, ({ f, o }) => {
      receiptMatches(f, o);
    });
  });
});

describe('Calendar facts match the grid (2.5 truth)', () => {
  it("each event has its chip's start (all day: local midnight), guests and a checked calendar", async () => {
    await eachPage(gcal, (f) => {
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
    });
  });

  it('coverage is the visible days minus any day hiding events behind "N more"; allCalendars iff all checked', async () => {
    await eachPage(gcal, (f) => {
      const days = gridDays(docOf(f));
      const windows = f.coverage.map(({ windowStart, windowEnd }) => ({ windowStart, windowEnd }));
      // A DEGRADED pass and a page still drawing assert nothing (Hard Rules 5, 6).
      const read = f.health.every((h) => h.status === 'OK') && !stillDrawing(docOf(f));
      expect(windows, f.file).toEqual(read ? dayWindows(days, f.page.readAt, f.page.timeZone) : []);
      const all = calendarList(docOf(f)).every((c) => c.checked);
      for (const c of f.coverage) expect(c.allCalendars, f.file).toBe(all);
    });
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
  it('each diff lists exactly the changes between its two snapshots', async () => {
    const diffs = gcal.flatMap((f) => f.diffs.map((d) => ({ f, d })));
    expect(diffs.length).toBeGreaterThanOrEqual(4);
    await eachPage(diffs, ({ f, d }) => {
      const before = gcal.find((g) => g.dir === f.dir && g.file === d.from);
      expect(before, `${f.file} ← ${d.from}`).toBeDefined();
      if (!before) return;
      const labelled = d.observations
        .map(
          (o) => `${o.type} ${o.rowKey ?? ''} ${o.counterparty ?? ''} ${o.occurredAt} ${o.subjectHint ?? ''}`,
        )
        .sort();
      expect(labelled, `${f.file} ← ${d.from}`).toEqual(referenceDiff(before, f));
    });
  });
});
