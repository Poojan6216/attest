/**
 * The Calendar observer through the 2.0 skeleton (src/observers/base.ts `runPass`): health → extract → project →
 * bus, on the labelled fixtures. On a page whose account is known a pass posts its health, one coverage ping per
 * labelled window (the source, allCalendars and only the account's hash) and the range's snapshot last, and no rows
 * of its own: the service worker derives them from the snapshot (src/background/calendar-step.ts; Decisions [2.7]).
 * A page that names no account posts a first sighting of every event and no snapshot. Nothing the page holds beyond
 * the allowlist (seeds, event ids, calendar names, the account address) crosses the bus (Hard Rules 2, 5, 6, 10).
 */
import { describe, expect, it } from 'vitest';

import seededJson from '../../../fixtures/secrets/seeded.json';
import type { BusMessage } from '../../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { HEALTH_REASON } from '../../../../src/core/schema-text';
import { accountHashOf } from '../../../../src/observers/account';
import { assertObserver, type PassDeps, runPass } from '../../../../src/observers/base';
import { createGcalObserver } from '../../../../src/observers/gcal/observer';
import { GCAL_REASONS } from '../../../../src/observers/gcal/read';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { recordingPost } from '../helpers';
import {
  accountlessHtmlOf,
  ctxOf,
  docOf,
  fixture,
  GCAL_FIXTURES,
  observerFor,
  parseDocument,
} from './gcal-fixtures';

const SEEDS = seededJson.seeds.map((seed) => seed.value);
/** Fields `project()` computes itself on every observation (docs/grading.md §10). */
const ALWAYS = ['id', 'source', 'type', 'observedAt', 'rowKeyHash', 'contentHash'];

function deps(f: LabelledFixture, doc: Document = docOf(f)): PassDeps & { messages: BusMessage[] } {
  const recording = recordingPost();
  return {
    doc,
    post: recording.post,
    now: () => f.page.readAt,
    offsetAt: zoneOffset(f.page.timeZone),
    policy: DEFAULT_POLICY,
    userActive: () => true,
    messages: recording.messages,
  };
}

async function pass(f: LabelledFixture, doc?: Document) {
  const d = deps(f, doc);
  const result = await runPass(observerFor(f), d);
  return { result, messages: d.messages };
}

function observationsIn(messages: readonly BusMessage[]) {
  return messages.flatMap((m) => (m.type === 'observer.observations' ? m.observations : []));
}

describe('gcal.event through runPass', () => {
  it('reports health only with reason codes (never page text)', () => {
    for (const reason of GCAL_REASONS) expect(reason).toMatch(HEALTH_REASON);
  });

  it('is a valid observer of calendar.google.com only', () => {
    const observer = createGcalObserver({ offsetAt: zoneOffset('America/New_York') });
    expect(() => {
      assertObserver(observer);
    }).not.toThrow();
    expect(observer.hosts).toEqual(['https://calendar.google.com/*']);
    expect(observer.source).toBe('gcal.event');
  });

  it('a page whose account is known: its health, its coverage, then its snapshot, and no row of its own', async () => {
    const f = fixture('synthetic-gcal-week-after-create.html');
    const { result, messages } = await pass(f);
    expect(result).toMatchObject({ status: 'OK', complete: true });
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'coverage.ping', 'calendar.snapshot']);
    const ping = messages.find((m) => m.type === 'coverage.ping');
    const [coverage] = f.coverage;
    expect(ping?.type === 'coverage.ping' && ping.ping).toEqual({
      observerId: 'gcal.event',
      source: 'gcal.event',
      lastSyncAt: f.page.readAt,
      windowStart: coverage?.windowStart,
      windowEnd: coverage?.windowEnd,
      accountHash: accountHashOf(f.page.account),
      allCalendars: false,
      userActive: true,
    });
    const snapshot = observerFor(f).snapshot(docOf(f), ctxOf(f));
    expect(messages.at(-1)).toEqual({ type: 'calendar.snapshot', observerId: 'gcal.event', snapshot });
    // The observer holds no stored snapshot: each one starts its own chain, the service worker carries a chain on.
    expect([snapshot?.readAt, snapshot?.baselineAt]).toEqual([f.page.readAt, f.page.readAt]);
    expect(snapshot?.events).toHaveLength(f.events.length);
  });

  it('an unchanged page posts its health, its coverage and its snapshot, and no observation', async () => {
    const { messages } = await pass(fixture('synthetic-gcal-week-unchanged.html'));
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'coverage.ping', 'calendar.snapshot']);
  });

  it('a page that names no account: a first sighting of every event, coverage without an account, no snapshot', async () => {
    const f = fixture('synthetic-gcal-week-before.html');
    const { messages } = await pass(f, parseDocument(accountlessHtmlOf(f)));
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    const observations = observationsIn(messages);
    expect(observations).toHaveLength(f.events.length);
    expect(new Set(observations.map((o) => o.type))).toEqual(new Set(['calendar.created']));
    const ping = messages.find((m) => m.type === 'coverage.ping');
    expect(ping?.type === 'coverage.ping' && ping.ping.accountHash).toBeUndefined();
  });
});

describe('gcal.event through runPass: coverage and the allowlist', () => {
  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    '%s: one ping per labelled window, each with the source, allCalendars and the account hash',
    async (_, f) => {
      const { messages } = await pass(f);
      const pings = messages.flatMap((m) => (m.type === 'coverage.ping' ? [m.ping] : []));
      expect(pings).toEqual(
        f.coverage.map((c) => ({
          observerId: 'gcal.event',
          source: 'gcal.event',
          lastSyncAt: f.page.readAt,
          windowStart: c.windowStart,
          windowEnd: c.windowEnd,
          accountHash: accountHashOf(c.account),
          allCalendars: c.allCalendars,
          userActive: true,
        })),
      );
    },
  );

  it('the month view pings both runs the "2 more" day splits it into', async () => {
    const { messages } = await pass(fixture('synthetic-gcal-month-november.html'));
    const spans = messages.flatMap((m) =>
      m.type === 'coverage.ping' ? [[m.ping.windowStart, m.ping.windowEnd]] : [],
    );
    expect(spans).toEqual([
      ['2026-11-01T00:00:00-04:00', '2026-11-12T00:00:00-05:00'],
      ['2026-11-13T00:00:00-05:00', '2026-12-06T00:00:00-05:00'],
    ]);
  });

  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    '%s: nothing beyond the allowlist crosses the bus, with or without an account',
    async (_, f) => {
      const known = await pass(f);
      const accountless = await pass(f, parseDocument(accountlessHtmlOf(f)));
      const messages = [...known.messages, ...accountless.messages];
      expect(observationsIn(accountless.messages)).toHaveLength(f.events.length);
      const text = JSON.stringify(messages).toLowerCase();
      const secrets = [
        ...SEEDS,
        f.page.account,
        'Avery Founder',
        ...f.events.map((e) => e.rowKey),
        'Location',
        'Accepted',
      ];
      for (const secret of secrets) expect(text, secret).not.toContain(secret.toLowerCase());
      const allowed = new Set([...ALWAYS, ...DEFAULT_POLICY.allowlistedFields['gcal.event']]);
      for (const o of observationsIn(messages))
        expect(Object.keys(o).filter((key) => !allowed.has(key))).toEqual([]);
    },
  );
});
