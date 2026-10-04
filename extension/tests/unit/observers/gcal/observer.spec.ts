/**
 * The Calendar observer through the 2.0 skeleton (src/observers/base.ts `runPass`): health → extract → project →
 * bus, on the labelled fixtures. The created event arrives as exactly one observation with the label's contentHash,
 * the coverage ping carries the labelled window and only the account's hash, an unchanged page posts no
 * observation, and nothing the page holds beyond the allowlist (seeds, event ids, calendar names, the account
 * address) crosses the bus (Hard Rules 2, 5, 6, 10).
 */
import { describe, expect, it } from 'vitest';

import seededJson from '../../../fixtures/secrets/seeded.json';
import type { BusMessage } from '../../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { accountHashOf } from '../../../../src/observers/account';
import { assertObserver, type PassDeps, runPass } from '../../../../src/observers/base';
import { HEALTH_REASON } from '../../../../src/core/schema-text';
import { createGcalObserver } from '../../../../src/observers/gcal/observer';
import { GCAL_REASONS } from '../../../../src/observers/gcal/read';
import type { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import { planPass } from '../../../../src/observers/plan';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { recordingPost } from '../helpers';
import {
  ctxOf,
  docOf,
  expectedObservation,
  fixture,
  GCAL_FIXTURES,
  observerFor,
  snapshotOfFixture,
} from './gcal-fixtures';

const SEEDS = seededJson.seeds.map((seed) => seed.value);
/** Fields `project()` computes itself on every observation (docs/grading.md §10). */
const ALWAYS = ['id', 'source', 'type', 'observedAt', 'rowKeyHash', 'contentHash'];

function deps(f: LabelledFixture): PassDeps & { messages: BusMessage[] } {
  const recording = recordingPost();
  return {
    doc: docOf(f),
    post: recording.post,
    now: () => f.page.readAt,
    offsetAt: zoneOffset(f.page.timeZone),
    policy: DEFAULT_POLICY,
    userActive: () => true,
    messages: recording.messages,
  };
}

async function pass(f: LabelledFixture, previous: CalendarSnapshot | null) {
  const d = deps(f);
  const result = await runPass(observerFor(f, previous), d);
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
    const observer = createGcalObserver({ offsetAt: zoneOffset('America/New_York'), previous: () => null });
    expect(() => {
      assertObserver(observer);
    }).not.toThrow();
    expect(observer.hosts).toEqual(['https://calendar.google.com/*']);
    expect(observer.source).toBe('gcal.event');
  });

  it('after the event was created: one calendar.created with the label contentHash, then coverage', async () => {
    const f = fixture('synthetic-gcal-week-after-create.html');
    const { result, messages } = await pass(f, snapshotOfFixture(fixture('synthetic-gcal-week-before.html')));
    expect(result).toMatchObject({ status: 'OK', complete: true });
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    const [diff] = f.diffs;
    const want = (diff?.observations ?? []).map((o) => expectedObservation(o, f.page.readAt));
    expect(observationsIn(messages)).toEqual(want);
    const ping = messages.find((m) => m.type === 'coverage.ping');
    const [coverage] = f.coverage;
    expect(ping?.type === 'coverage.ping' && ping.ping).toEqual({
      observerId: 'gcal.event',
      lastSyncAt: f.page.readAt,
      windowStart: coverage?.windowStart,
      windowEnd: coverage?.windowEnd,
      accountHash: accountHashOf(f.page.account),
      userActive: true,
    });
  });
});

describe('gcal.event through runPass: changes and first sightings', () => {
  it('an unchanged page posts its health and its coverage, and no observation', async () => {
    const f = fixture('synthetic-gcal-week-unchanged.html');
    const { messages } = await pass(f, snapshotOfFixture(fixture('synthetic-gcal-week-after-create.html')));
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'coverage.ping']);
  });

  it('asks the store for the snapshot of its range and its account (the hash, never the address)', () => {
    const f = fixture('synthetic-gcal-week-before.html');
    const asked: unknown[][] = [];
    const observer = createGcalObserver({
      offsetAt: zoneOffset(f.page.timeZone),
      previous: (...args) => {
        asked.push(args);
        return null;
      },
    });
    observer.extract(docOf(f), ctxOf(f));
    expect(asked).toEqual([['2026-10-04/2026-10-10', accountHashOf(f.page.account)]]);
    expect(observer.range(docOf(f))).toBe('2026-10-04/2026-10-10');
  });

  it('a snapshot continues the stored chain of its range: it keeps the baseline, a first one starts its own', () => {
    const first = snapshotOfFixture(fixture('synthetic-gcal-week-before.html'));
    expect(first.baselineAt).toBe(first.readAt);
    const f = fixture('synthetic-gcal-week-after-create.html');
    const next = observerFor(f, first).snapshot(docOf(f), ctxOf(f));
    expect(next?.baselineAt).toBe(first.readAt);
    expect(next?.readAt).toBe(f.page.readAt);
    const reread = observerFor(f, { ...first, version: '0.9.0' }).snapshot(docOf(f), ctxOf(f));
    expect(reread?.baselineAt).toBe(f.page.readAt);
  });

  it('the first pass over a range posts a first sighting of every event', async () => {
    const f = fixture('synthetic-gcal-week-before.html');
    const { messages } = await pass(f, null);
    const observations = observationsIn(messages);
    expect(observations).toHaveLength(f.events.length);
    expect(new Set(observations.map((o) => o.type))).toEqual(new Set(['calendar.created']));
  });

  it('a stored snapshot that fails its schema counts as none (first sightings, never a change)', () => {
    const f = fixture('synthetic-gcal-week-after-create.html');
    const observer = createGcalObserver({
      offsetAt: zoneOffset(f.page.timeZone),
      previous: () => ({ events: 'not a snapshot' }),
    });
    const rows = observer.extract(docOf(f), ctxOf(f));
    expect(rows).toHaveLength(f.events.length);
  });

  it("a stored snapshot of another range fails the pass loud (extract.threw), it is the store's bug", () => {
    const f = fixture('synthetic-gcal-week-after-create.html');
    const other = snapshotOfFixture(fixture('synthetic-gcal-month-november.html'));
    const observer = createGcalObserver({ offsetAt: zoneOffset(f.page.timeZone), previous: () => other });
    const plan = planPass({ observer, doc: docOf(f), ctx: ctxOf(f), policy: DEFAULT_POLICY });
    expect(plan).toEqual({ status: 'DEGRADED', reasons: ['extract.threw'], observations: [] });
  });
});

describe('gcal.event through runPass: coverage and the allowlist', () => {
  it('the month view pings its widest whole window', async () => {
    const f = fixture('synthetic-gcal-month-november.html');
    const { messages } = await pass(f, null);
    const ping = messages.find((m) => m.type === 'coverage.ping');
    expect(ping?.type === 'coverage.ping' && [ping.ping.windowStart, ping.ping.windowEnd]).toEqual([
      '2026-11-13T00:00:00-05:00',
      '2026-12-06T00:00:00-05:00',
    ]);
  });

  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))(
    '%s: nothing beyond the allowlist crosses the bus',
    async (_, f) => {
      const { messages } = await pass(f, null);
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
