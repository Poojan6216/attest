// @vitest-environment happy-dom
/**
 * src/observers/coverage.ts through ./plan.ts and ./base.ts (sprint_2 2.7; docs/grading.md §3, §6.1; Hard Rules 5,
 * 6): an observer may report several windows per pass, each checked as one window is, each posted as its own
 * coverage.ping naming the source (and `allCalendars` for gcal.event); an empty list is a clean pass with no
 * coverage, by design (OK, never DEGRADED); the Calendar snapshot follows the coverage of a clean pass whose
 * account is known, and nothing follows a DEGRADED pass or a post that failed.
 */
import { describe, expect, it, vi } from 'vitest';

import type { BusMessage } from '../../../src/bus/messages';
import { OBSERVER_HOSTS } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { IsoTs } from '../../../src/core/schema';
import { accountHashOf } from '../../../src/observers/account';
import { assertObserver, type PassDeps, passMessages, runPass } from '../../../src/observers/base';
import { type PassPlan, planPass } from '../../../src/observers/plan';
import type { ExtractContext, Observer, RawRow, VisibleWindow } from '../../../src/observers/types';
import { snapshot as builtSnapshot, event } from './gcal/snapshot-builders';
import { NOW, recordingPost, sentObserver, syntheticDocument } from './helpers';

const ctx: ExtractContext = { observedAt: IsoTs.parse(NOW), offsetAt: () => -240 };
const HASH = accountHashOf('priya.raman@example.com');
const MON = { windowStart: '2026-09-28T00:00:00-04:00', windowEnd: '2026-09-29T00:00:00-04:00' };
const WED = { windowStart: '2026-09-30T00:00:00-04:00', windowEnd: '2026-10-01T00:00:00-04:00' };
const SNAPSHOT = builtSnapshot([event('a')]);

function plan(observer: Observer): PassPlan {
  return planPass({ observer, doc: syntheticDocument(), ctx, policy: DEFAULT_POLICY });
}

const reasonsOf = (result: PassPlan): readonly string[] =>
  result.status === 'DEGRADED' ? result.reasons : [];

/** The synthetic Sent observer reading its windows with `visibleWindows`. */
function many(visibleWindows: Observer['visibleWindows'], overrides: Partial<Observer> = {}): Observer {
  return sentObserver({ visibleWindow: undefined, visibleWindows, ...overrides });
}

/** A window reader answering `value`, whatever it is (the skeleton must check it). */
function answering(value: unknown): Observer['visibleWindows'] {
  return () => value as readonly VisibleWindow[];
}

const calendarRow: RawRow = {
  type: 'calendar.created',
  rowKey: 'e1',
  fields: { subjectHint: 'Standup', occurredAt: '2026-10-02T09:00:00-04:00' },
};

/** A synthetic gcal.event observer over the synthetic page (its account switcher, one calendar row). */
function calendar(overrides: Partial<Observer> = {}): Observer {
  return many(() => [MON, WED], {
    source: 'gcal.event',
    hosts: OBSERVER_HOSTS.gcal,
    extract: () => [calendarRow],
    allCalendars: () => true,
    snapshot: () => SNAPSHOT,
    ...overrides,
  });
}

describe('several windows in one pass', () => {
  it('a clean pass reports each window in order, each with the account, one entry per distinct window', () => {
    const result = plan(many(() => [MON, WED, { ...MON }]));
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.coverage).toEqual([
      { ...MON, accountHash: HASH },
      { ...WED, accountHash: HASH },
    ]);
  });

  it('an empty list is a clean pass with no coverage, by design: OK_NO_COVERAGE, the account never read', () => {
    const account = vi.fn(() => 'priya.raman@example.com');
    const result = plan(many(() => [], { account }));
    expect(result.status).toBe('OK_NO_COVERAGE');
    expect(result.observations).toHaveLength(2);
    expect(account).not.toHaveBeenCalled();
  });
});

describe('a window list that is not one: DEGRADED, no coverage (Hard Rule 5)', () => {
  it.each<[string, Observer['visibleWindows'], string]>([
    ['null (windows unknown)', () => null, 'window.unknown'],
    ['not a list', answering(MON), 'window.invalid'],
    [
      'one window without an offset',
      () => [MON, { ...WED, windowEnd: '2026-10-01T00:00:00' }],
      'window.invalid',
    ],
    [
      'one window ending before it starts',
      () => [{ windowStart: WED.windowEnd, windowEnd: MON.windowStart }],
      'window.invalid',
    ],
    [
      'one Gmail window past the pass instant',
      () => [MON, { windowStart: NOW, windowEnd: '2026-10-01T14:31:00-04:00' }],
      'window.future',
    ],
    [
      'a throw',
      () => {
        throw new Error('x');
      },
      'window.threw',
    ],
  ])('a list that is %s: DEGRADED (%s), rows kept, no window at all', (_label, visibleWindows, reason) => {
    const result = plan(many(visibleWindows));
    expect(result.status).toBe('DEGRADED');
    expect(reasonsOf(result)).toEqual([reason]);
    expect(result).not.toHaveProperty('coverage');
    expect(result.observations).toHaveLength(2);
  });

  it('an observer with no window reader at all (never past assertObserver) is DEGRADED window.unknown', () => {
    expect(reasonsOf(plan(sentObserver({ visibleWindow: undefined })))).toEqual(['window.unknown']);
  });

  it('a refused row voids a pass that reported no window too, and names only the refusal', () => {
    const bad: RawRow = { type: 'email.sent', fields: { subjectHint: 'a\nb', occurredAt: NOW } };
    expect(reasonsOf(plan(many(() => [], { extract: () => [bad] })))).toEqual(['redact.invalid_field']);
  });
});

describe('allCalendars (gcal.event only; docs/grading.md §6.1)', () => {
  it.each([true, false])('is read once and sent on every window: %s', (all) => {
    const allCalendars = vi.fn(() => all);
    const result = plan(calendar({ allCalendars }));
    expect(result.status).toBe('OK');
    if (result.status === 'OK') expect(result.coverage.map((c) => c.allCalendars)).toEqual([all, all]);
    expect(allCalendars).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => unknown, string]>([
    ['unknown (null)', () => null, 'calendars.unknown'],
    ['not a boolean', () => 'yes', 'calendars.invalid'],
    [
      'a throw',
      () => {
        throw new Error('x');
      },
      'calendars.threw',
    ],
  ])(
    'a calendar list that is %s: DEGRADED (%s), no coverage, no snapshot',
    (_label, allCalendars, reason) => {
      const result = plan(calendar({ allCalendars: allCalendars as Observer['allCalendars'] }));
      expect(reasonsOf(result)).toEqual([reason]);
      expect(result).not.toHaveProperty('snapshot');
    },
  );

  it('is not read when the pass has no window, nor sent by any other source', () => {
    const allCalendars = vi.fn(() => true);
    expect(plan(calendar({ allCalendars, visibleWindows: () => [] })).status).toBe('OK_NO_COVERAGE');
    expect(allCalendars).not.toHaveBeenCalled();
    const gmail = plan(many(() => [MON], { allCalendars }));
    if (gmail.status === 'OK') expect(gmail.coverage[0]).not.toHaveProperty('allCalendars');
    expect(allCalendars).not.toHaveBeenCalled();
  });
});

describe('the Calendar snapshot (sprint_2 2.7)', () => {
  it('a clean pass with a known account carries it, beside its windows', () => {
    const result = plan(calendar());
    expect(result).toMatchObject({ status: 'OK', snapshot: SNAPSHOT });
  });

  it('a clean pass with no whole window still carries it (it holds the hidden days), and reads the account', () => {
    expect(plan(calendar({ visibleWindows: () => [] }))).toMatchObject({
      status: 'OK_NO_COVERAGE',
      snapshot: SNAPSHOT,
    });
  });

  it.each<[string, Partial<Observer>]>([
    ['the page shows no account', { account: () => null }],
    ['the observer has none for this page', { snapshot: () => null }],
  ])('is left out when %s', (_label, overrides) => {
    const result = plan(calendar(overrides));
    expect(result.status).toBe('OK');
    expect(result).not.toHaveProperty('snapshot');
  });

  it.each<[string, Partial<Observer>, string]>([
    [
      'the snapshot read throws',
      {
        snapshot: () => {
          throw new Error('x');
        },
      },
      'snapshot.threw',
    ],
    ['the account is not an address', { account: () => 'Priya Raman' }, 'account.invalid'],
    [
      'a row is refused',
      { extract: () => [{ ...calendarRow, fields: { occurredAt: 'soon' } }] },
      'redact.missing_occurred_at',
    ],
  ])('a DEGRADED pass carries none: %s (%s)', (_label, overrides, reason) => {
    const result = plan(calendar(overrides));
    expect(reasonsOf(result)).toEqual([reason]);
    expect(result).not.toHaveProperty('snapshot');
  });

  it('a Gmail observer handed a snapshot reader (never past assertObserver) carries none, never reads it', () => {
    const snapshot = vi.fn(() => SNAPSHOT);
    const result = plan(many(() => [MON], { snapshot }));
    expect(result.status).toBe('OK');
    expect(result).not.toHaveProperty('snapshot');
    expect(snapshot).not.toHaveBeenCalled();
  });
});

function deps(post = recordingPost()): PassDeps & { messages: BusMessage[] } {
  return {
    doc: syntheticDocument(),
    post: post.post,
    now: () => NOW,
    offsetAt: () => -240,
    policy: DEFAULT_POLICY,
    userActive: () => true,
    messages: post.messages,
  };
}

describe('runPass: one ping per window, then the snapshot', () => {
  it('posts health, observations, a ping per window (source, allCalendars), then calendar.snapshot', async () => {
    const observer = calendar();
    assertObserver(observer);
    const d = deps();
    const result = await runPass(observer, d);
    expect(result).toMatchObject({ status: 'OK', complete: true });
    expect(d.messages.map((m) => m.type)).toEqual([
      'adapter.health',
      'observer.observations',
      'coverage.ping',
      'coverage.ping',
      'calendar.snapshot',
    ]);
    const pings = d.messages.flatMap((m) => (m.type === 'coverage.ping' ? [m.ping] : []));
    expect(pings).toEqual(
      [MON, WED].map((span) => ({
        observerId: 'synthetic.sent',
        source: 'gcal.event',
        lastSyncAt: NOW,
        ...span,
        accountHash: HASH,
        allCalendars: true,
        userActive: true,
      })),
    );
    expect(d.messages.at(-1)).toEqual({
      type: 'calendar.snapshot',
      observerId: 'synthetic.sent',
      snapshot: SNAPSHOT,
    });
  });

  it('a clean pass with no window posts health OK and its rows, nothing else', async () => {
    const d = deps();
    const result = await runPass(
      many(() => []),
      d,
    );
    expect(result).toEqual({
      status: 'OK',
      reasons: [],
      posted: ['adapter.health', 'observer.observations'],
      complete: true,
    });
  });
});

describe('runPass: what never follows', () => {
  it.each([3, 4])('a post that fails at #%i stops the pass: the snapshot never follows', async (failing) => {
    const sent: string[] = [];
    let count = 0;
    const post = (message: BusMessage): Promise<unknown> => {
      count += 1;
      if (count === failing) return Promise.reject(new Error('refused'));
      sent.push(message.type);
      return Promise.resolve({ ok: true });
    };
    const result = await runPass(calendar(), { ...deps(), post });
    expect(result.complete).toBe(false);
    expect(sent).not.toContain('calendar.snapshot');
  });

  it('a DEGRADED plan posts its health and rows, never a snapshot, whatever the plan object carries', () => {
    const degraded = {
      status: 'DEGRADED',
      reasons: ['window.unknown'],
      observations: [],
      snapshot: SNAPSHOT,
    };
    const messages = passMessages(calendar(), degraded as PassPlan, IsoTs.parse(NOW), true);
    expect(messages.map((m) => m.type)).toEqual(['adapter.health']);
  });

  it('a snapshot that fails its bus schema sends only a DEGRADED message.invalid health report', async () => {
    const d = deps();
    await runPass(calendar({ snapshot: () => ({ ...SNAPSHOT, range: 'last week' }) }), d);
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]).toMatchObject({ health: { status: 'DEGRADED', reasons: ['message.invalid'] } });
  });
});
