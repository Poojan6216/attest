/**
 * The Calendar observer on its labelled fixtures (sprint_2 2.5; tests/fixtures/pages/gcal/<date>/): health, every
 * visible event (start, all-day flag, subject hint, guests, calendar), the coverage windows, allCalendars and the
 * account, compared with the labels. Class names are random per file, so passing every fixture of a view means
 * nothing is anchored on a class (sprint_2 🔥). Seeds sit in event locations and an open event dialog: none may
 * reach a snapshot or a row (Hard Rule 2).
 */
import { describe, expect, it } from 'vitest';

import seededJson from '../../../fixtures/secrets/seeded.json';
import { asciiLower } from '../../../../src/core/normalize';
import { hashRowKey, hashText } from '../../../../src/core/redact';
import { accountOf } from '../../../../src/observers/gcal/page';
import { readCalendar } from '../../../../src/observers/gcal/read';
import { GCAL_VERSION } from '../../../../src/observers/gcal/selectors';
import { ctxOf, docOf, GCAL_FIXTURES, observerFor, projectRows, snapshotOfFixture } from './gcal-fixtures';

const SEEDS = new Map(seededJson.seeds.map((seed) => [seed.id, seed.value]));

function sortedFolded(addresses: readonly string[]): string[] {
  return [...addresses].sort((a, b) => (asciiLower(a) < asciiLower(b) ? -1 : 1));
}

describe('gcal.event on the labelled fixtures', () => {
  it('has at least the four week/month fixtures 2.4 asks for', () => {
    expect(GCAL_FIXTURES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))('%s: health is the labelled one', (_, f) => {
    const health = observerFor(f).health(docOf(f));
    for (const fact of f.health) {
      expect(health.status).toBe(fact.status);
      if (health.status === 'DEGRADED') expect([...health.reasons]).toEqual(fact.reasons);
    }
  });

  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    '%s: every labelled event, and no other',
    (_, f) => {
      const snapshot = snapshotOfFixture(f);
      expect(snapshot.version).toBe(GCAL_VERSION);
      const expected = f.events.map((e) => ({
        key: hashRowKey(e.rowKey),
        calendar: hashText(e.calendar),
        subjectHint: e.subjectHint,
        occurredAt: e.occurredAt,
        allDay: e.allDay,
        guests: sortedFolded(e.attendees),
      }));
      const read = snapshot.events.map((e) => ({
        key: e.key,
        calendar: e.calendar,
        subjectHint: e.subjectHint,
        occurredAt: e.occurredAt,
        allDay: e.allDay,
        guests: [...e.guests],
      }));
      const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : 1);
      expect(read.sort(byKey)).toEqual(expected.sort(byKey));
    },
  );
});

describe('gcal.event coverage and account on the labelled fixtures', () => {
  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    '%s: coverage is the labelled windows, allCalendars as labelled',
    (_, f) => {
      const observer = observerFor(f);
      const doc = docOf(f);
      const windows = observer.visibleWindows(doc, ctxOf(f));
      expect(windows).toEqual(f.coverage.map(({ windowStart, windowEnd }) => ({ windowStart, windowEnd })));
      for (const fact of f.coverage) expect(observer.allCalendars(doc)).toBe(fact.allCalendars);
    },
  );

  it('the month view reports both runs the "2 more" day splits it into, in order', () => {
    const month = GCAL_FIXTURES.find((f) => f.page.view === 'gcal.month');
    expect(month).toBeDefined();
    if (!month) return;
    expect(observerFor(month).visibleWindows(docOf(month), ctxOf(month))).toEqual([
      { windowStart: '2026-11-01T00:00:00-04:00', windowEnd: '2026-11-12T00:00:00-05:00' },
      { windowStart: '2026-11-13T00:00:00-05:00', windowEnd: '2026-12-06T00:00:00-05:00' },
    ]);
  });

  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    "%s: the account is the switcher's address",
    (_, f) => {
      expect(accountOf(docOf(f))).toBe(f.page.account);
    },
  );
});

describe('gcal.event keeps page content off the bus', () => {
  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    '%s: no seed, event id, calendar name or account address in a snapshot or a row',
    (_, f) => {
      const snapshot = snapshotOfFixture(f);
      const rows = observerFor(f).extract(docOf(f), ctxOf(f));
      const observations = projectRows(rows, f.page.readAt);
      const text = JSON.stringify([snapshot, rows, observations]).toLowerCase();
      const seeds = f.label.seededSecrets.map((id) => SEEDS.get(id) ?? id);
      const secrets = [
        ...seeds,
        ...f.events.map((e) => e.rowKey),
        ...f.events.map((e) => e.calendar),
        f.page.account,
      ];
      for (const secret of secrets) expect(text, secret).not.toContain(secret.toLowerCase());
    },
  );

  it('the event dialog over the month grid is not a chip and is never read', () => {
    const month = GCAL_FIXTURES.find((f) => f.page.view === 'gcal.month');
    if (!month) throw new Error('no month fixture');
    const doc = docOf(month);
    expect(doc.querySelector('[role="dialog"]')).not.toBeNull();
    const read = readCalendar(doc, ctxOf(month).offsetAt);
    expect(read.ok && read.facts.events.length).toBe(month.events.length);
  });
});
