// @vitest-environment happy-dom
/**
 * src/observers/base.ts, one pass (sprint_2 2.0): health → extract → project → bus, in order, one message at a time.
 * A DEGRADED health posts only the health report; a refused row posts no coverage (Sprint 1 close, SEC-3, Hard
 * Rule 5); a failed post ends the pass so coverage never follows undelivered observations; the account leaves only
 * as a hash; every message parses with its bus schema.
 */
import { describe, expect, it, vi } from 'vitest';

import { BusMessage, CoveragePingMessage } from '../../../src/bus/messages';
import { OBSERVER_HOSTS } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';
import { accountHashOf } from '../../../src/observers/account';
import {
  assertObserver,
  browserOffsetAt,
  type HealthCheck,
  type Observer,
  type PassDeps,
  passMessages,
  type RawRow,
  runPass,
} from '../../../src/observers/base';
import { ObserverError } from '../../../src/observers/errors';
import { leaks, NOW, recordingPost, sentObserver, syntheticDocument } from './helpers';

function deps(overrides: Partial<PassDeps> = {}): PassDeps & { messages: BusMessage[] } {
  const recording = recordingPost();
  return {
    doc: syntheticDocument(),
    post: recording.post,
    now: () => NOW,
    offsetAt: browserOffsetAt,
    policy: DEFAULT_POLICY,
    userActive: () => true,
    messages: recording.messages,
    ...overrides,
  };
}

const typesOf = (messages: readonly BusMessage[]): string[] => messages.map((message) => message.type);

describe('runPass: a clean pass', () => {
  it('posts health OK, the observations, then the coverage ping, each a valid bus message', async () => {
    const d = deps();
    const result = await runPass(sentObserver(), d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    expect(result).toEqual({
      status: 'OK',
      reasons: [],
      posted: ['adapter.health', 'observer.observations', 'coverage.ping'],
      complete: true,
    });
    for (const message of d.messages) expect(BusMessage.safeParse(message).success).toBe(true);
  });

  it('stamps one instant: health checkedAt, every observedAt and the ping lastSyncAt (the sighting, §3)', async () => {
    const d = deps();
    await runPass(sentObserver(), d);
    const [health, observations, ping] = d.messages;
    expect(health).toMatchObject({
      health: { adapterId: 'synthetic.sent', version: '1.0.0', checkedAt: NOW },
    });
    if (observations?.type !== 'observer.observations') throw new Error('no observations message');
    expect(observations.observations.map((o) => o.observedAt)).toEqual([NOW, NOW]);
    expect(observations.observations.every((o) => !('sightedAt' in o))).toBe(true);
    expect(ping).toEqual(
      CoveragePingMessage.parse({
        type: 'coverage.ping',
        ping: {
          observerId: 'synthetic.sent',
          source: 'gmail.sent',
          accountHash: accountHashOf('priya.raman@example.com'),
          lastSyncAt: NOW,
          windowStart: '2026-10-01T13:10:00-04:00',
          windowEnd: NOW,
          userActive: true,
        },
      }),
    );
  });

  it('sends the user-activity flag as read at the pass', async () => {
    const d = deps({ userActive: () => false });
    await runPass(sentObserver(), d);
    expect(d.messages.at(-1)).toMatchObject({ type: 'coverage.ping', ping: { userActive: false } });
  });

  it('never posts a seeded secret, a non-allowlisted field or the raw account (Hard Rules 2, 10)', async () => {
    const d = deps();
    await runPass(sentObserver(), d);
    expect(leaks(d.messages)).toEqual([]);
    expect(JSON.stringify(d.messages)).not.toContain('"body"');
  });
});

describe('runPass: one clock read', () => {
  it('reads the clock once per pass, even when it moves on while the pass runs', async () => {
    let tick = 0;
    const now = vi.fn(() => {
      tick += 1;
      return `2026-10-01T14:30:0${String(tick)}.000-04:00`;
    });
    const d = deps({ now });
    await runPass(sentObserver(), d);
    expect(now).toHaveBeenCalledTimes(1);
    const first = '2026-10-01T14:30:01.000-04:00';
    const [health, observations, ping] = d.messages;
    expect(health?.type === 'adapter.health' ? health.health.checkedAt : null).toBe(first);
    if (observations?.type !== 'observer.observations') throw new Error('no observations message');
    expect(observations.observations.map((o) => o.observedAt)).toEqual([first, first]);
    expect(ping?.type === 'coverage.ping' ? [ping.ping.lastSyncAt, ping.ping.windowEnd] : null).toEqual([
      first,
      first,
    ]);
  });
});

describe('runPass: what a clean pass may hold', () => {
  it('a pass with no rows still posts its coverage: it looked and saw nothing in the window', async () => {
    const empty = sentObserver({
      extract: () => [],
      visibleWindow: (_doc, ctx) => ({ windowStart: '2026-10-01T00:00:00-04:00', windowEnd: ctx.observedAt }),
    });
    const d = deps();
    await runPass(empty, d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'coverage.ping']);
  });

  it(`splits more than ${String(SCHEMA_LIMITS.BATCH)} observations across messages, coverage last`, async () => {
    const rows: RawRow[] = Array.from({ length: SCHEMA_LIMITS.BATCH + 1 }, (_, i) => ({
      type: 'email.sent',
      rowKey: `row-${String(i)}`,
      fields: { occurredAt: NOW },
    }));
    const d = deps();
    await runPass(sentObserver({ extract: () => rows }), d);
    expect(typesOf(d.messages)).toEqual([
      'adapter.health',
      'observer.observations',
      'observer.observations',
      'coverage.ping',
    ]);
    const counts = d.messages.map((m) => (m.type === 'observer.observations' ? m.observations.length : 0));
    expect(counts).toEqual([0, SCHEMA_LIMITS.BATCH, 1, 0]);
  });
});

describe('runPass: what a DEGRADED pass posts', () => {
  it('DEGRADED health: the health report only, no extraction, no coverage (Hard Rules 5, 6)', async () => {
    const extract = vi.fn(() => [] as RawRow[]);
    const d = deps({ doc: syntheticDocument({ folder: 'drafts' }) });
    const result = await runPass(sentObserver({ extract }), d);
    expect(d.messages).toEqual([
      {
        type: 'adapter.health',
        health: {
          adapterId: 'synthetic.sent',
          version: '1.0.0',
          status: 'DEGRADED',
          reasons: ['not_sent_folder'],
          checkedAt: NOW,
        },
      },
    ]);
    expect(extract).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'DEGRADED', reasons: ['not_sent_folder'], complete: true });
  });

  it('a row project() refuses: DEGRADED, the accepted rows, and no coverage for the window (SEC-3)', async () => {
    const bad: RawRow = { type: 'email.sent', fields: { subjectHint: 'two\nlines', occurredAt: NOW } };
    const good: RawRow = { type: 'email.sent', fields: { counterparty: 'sam@example.org', occurredAt: NOW } };
    const d = deps();
    await runPass(sentObserver({ extract: () => [good, bad] }), d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'observer.observations']);
    expect(d.messages[0]).toMatchObject({
      health: { status: 'DEGRADED', reasons: ['redact.invalid_field'] },
    });
  });

  it('a window it cannot read: DEGRADED, no coverage', async () => {
    const d = deps();
    await runPass(sentObserver({ visibleWindow: () => null }), d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'observer.observations']);
    expect(d.messages[0]).toMatchObject({ health: { status: 'DEGRADED', reasons: ['window.unknown'] } });
  });

  it('a clock that gives no instant sends nothing', async () => {
    const d = deps({ now: () => 'now' });
    const result = await runPass(sentObserver(), d);
    expect(d.messages).toEqual([]);
    expect(result).toEqual({ status: 'DEGRADED', reasons: ['clock.invalid'], posted: [], complete: false });
  });
});

describe('runPass: what an IDLE pass posts (a page the observer does not read, sprint_2 2.11)', () => {
  it('IDLE health: the IDLE report only, with its reasons, no extraction, no coverage (sprint_2 2.11)', async () => {
    const extract = vi.fn(() => [] as RawRow[]);
    const health = (): HealthCheck => ({ status: 'IDLE', reasons: ['not_sent_folder'] });
    const d = deps({ doc: syntheticDocument({ folder: 'drafts' }) });
    const result = await runPass(sentObserver({ health, extract }), d);
    expect(d.messages).toEqual([
      {
        type: 'adapter.health',
        health: {
          adapterId: 'synthetic.sent',
          version: '1.0.0',
          status: 'IDLE',
          reasons: ['not_sent_folder'],
          checkedAt: NOW,
        },
      },
    ]);
    expect(extract).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'IDLE', reasons: ['not_sent_folder'], complete: true });
  });

  it('a pass that cannot vouch for the present keeps an IDLE plan IDLE (no OK is made of it)', async () => {
    const health = (): HealthCheck => ({ status: 'IDLE', reasons: ['not_sent_folder'] });
    const d = deps({ doc: syntheticDocument({ folder: 'drafts' }), vouches: () => false });
    expect(await runPass(sentObserver({ health }), d)).toMatchObject({ status: 'IDLE', complete: true });
    expect(typesOf(d.messages)).toEqual(['adapter.health']);
  });
});

describe('runPass: a failed post ends the pass', () => {
  it.each([1, 2])('post #%i rejects: nothing after it is sent, never the coverage ping', async (failing) => {
    const sent: string[] = [];
    let count = 0;
    const post = vi.fn((message: BusMessage) => {
      count += 1;
      if (count === failing) return Promise.reject(new Error('transport'));
      sent.push(message.type);
      return Promise.resolve(undefined);
    });
    const result = await runPass(sentObserver(), deps({ post }));
    expect(post).toHaveBeenCalledTimes(failing);
    expect(sent).not.toContain('coverage.ping');
    expect(result.complete).toBe(false);
    expect(result.posted).toEqual(sent);
  });

  it('posts one message at a time, each after the previous was answered', async () => {
    const answered: (() => void)[] = [];
    const post = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          answered.push(() => {
            resolve(undefined);
          });
        }),
    );
    const pass = runPass(sentObserver(), deps({ post }));
    for (let expected = 1; expected <= 3; expected += 1) {
      await vi.waitFor(() => {
        expect(post).toHaveBeenCalledTimes(expected);
      });
      await Promise.resolve();
      expect(post).toHaveBeenCalledTimes(expected);
      answered.shift()?.();
    }
    await expect(pass).resolves.toMatchObject({ complete: true });
  });
});

describe('passMessages', () => {
  const at = IsoTs.parse(NOW);

  it('a message that fails its bus schema sends only a DEGRADED message.invalid health report', () => {
    const plan = {
      status: 'OK' as const,
      observations: [],
      coverage: [{ windowStart: 'not a time' as IsoTs, windowEnd: at }] as const,
    };
    expect(passMessages(sentObserver(), plan, at, true)).toEqual([
      {
        type: 'adapter.health',
        health: {
          adapterId: 'synthetic.sent',
          version: '1.0.0',
          status: 'DEGRADED',
          reasons: ['message.invalid'],
          checkedAt: NOW,
        },
      },
    ]);
  });
});

describe('assertObserver', () => {
  it('accepts the synthetic observer', () => {
    expect(() => {
      assertObserver(sentObserver());
    }).not.toThrow();
  });

  it.each<[string, keyof Observer, unknown]>([
    ['an id with a space', 'id', 'gmail sent'],
    ['an empty version', 'version', ''],
    ['a vendor that is a sentence', 'vendor', 'Google Mail, the inbox'],
    ['an unknown source', 'source', 'gmail.inbox'],
    ['no hosts', 'hosts', []],
    ['a wildcard host', 'hosts', ['https://*.google.com/*']],
    ['<all_urls>', 'hosts', ['<all_urls>']],
    ['an agent host', 'hosts', ['https://chatgpt.com/*']],
    ['no health()', 'health', undefined],
    ['an extract that is not a function', 'extract', 'rows'],
    ['no account()', 'account', undefined],
    ['a visibleWindow that is not a function', 'visibleWindow', { windowStart: NOW, windowEnd: NOW }],
    ['no window reader at all', 'visibleWindow', undefined],
    ['a second window reader beside visibleWindow', 'visibleWindows', () => []],
    ['allCalendars on a Gmail observer', 'allCalendars', () => true],
    ['a snapshot on a Gmail observer', 'snapshot', () => null],
  ])('refuses %s with ObserverError(invalid_observer)', (_label, member, value) => {
    const observer = sentObserver();
    Object.defineProperty(observer, member, { value });
    expect(() => {
      assertObserver(observer);
    }).toThrow(new ObserverError('invalid_observer'));
  });

  it('accepts either observer host list (Hard Rule 8: exactly OBSERVER_HOSTS)', () => {
    for (const hosts of Object.values(OBSERVER_HOSTS)) {
      expect(() => {
        assertObserver(sentObserver({ hosts }));
      }).not.toThrow();
    }
  });
});

describe('browserOffsetAt', () => {
  it('is the browser time zone offset at that instant, in minutes east of UTC', () => {
    const at = Date.UTC(2026, 0, 15, 12);
    expect(browserOffsetAt(at)).toBe(-new Date(at).getTimezoneOffset());
  });
});
