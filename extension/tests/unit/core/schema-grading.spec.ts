/**
 * Task 1.0: the grading-input schemas (docs/grading.md §3, §7): ObserverCoverage, Coverage, Attribution,
 * GradeContext, Activity. Same contract as schema.spec.ts: at least five valid cases (each parses to exactly
 * itself) and five invalid ones, each rejected at one specific path. Window and interval checks compare
 * instants, never strings, so a later-looking string in another offset can still be earlier.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  Activity,
  Attribution,
  Claim,
  Coverage,
  Grant,
  GradeContext,
  IsoTs,
  Observation,
  ObserverCoverage,
  Receipt,
} from '../../../src/core/schema';

type Path = readonly (string | number)[];
type Invalid = readonly [label: string, value: unknown, path: Path];
interface Table {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly Invalid[];
}

const ULID = '01JA0000000000000000000001';
const HASH = 'cd'.repeat(32);
const T0 = '2026-10-06T14:02:00-04:00';
const T1 = '2026-10-06T15:00:00-04:00';

function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const GMAIL = {
  observerId: 'gmail.sent',
  source: 'gmail.sent',
  lastSyncAt: T1,
  windowStart: '2026-10-06T13:00:00-04:00',
  windowEnd: T1,
  accountHash: HASH,
};
const GCAL = { ...GMAIL, observerId: 'gcal', source: 'gcal.event', allCalendars: true };

const ATTRIBUTION = { agent: 'muse', scoreBp: 7000, signals: ['agentSessionActive', 'userIdle'] };

const CLAIM = {
  id: ULID,
  agent: 'muse',
  type: 'email.sent',
  claimedAt: T0,
  claimedAtPrecision: 'minute',
  observedAt: T1,
  sourceKind: 'activity_view',
  extractor: { id: 'muse.activity', version: '1', confidence: 1 },
  rawHash: HASH,
};

/** v1.3 §4.1: only a day claim may carry claimedAtEnd, so the timestamp checks below use one. */
const DAY_CLAIM = { ...CLAIM, claimedAtPrecision: 'day' };

const EMPTY_ACTIVITY = { sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [] };

const TABLES: readonly Table[] = [
  {
    name: 'ObserverCoverage',
    schema: ObserverCoverage,
    valid: [
      GMAIL,
      GCAL,
      { ...GCAL, allCalendars: false },
      without(GMAIL, 'accountHash'),
      { ...GMAIL, windowStart: T1, windowEnd: T1 },
      // 18:30Z then 19:00Z: ordered as instants although the strings sort the other way.
      {
        ...GMAIL,
        source: 'gmail.receipt',
        windowStart: '2026-10-06T14:30:00-04:00',
        windowEnd: '2026-10-06T19:00:00Z',
      },
    ],
    invalid: [
      ['a window ending before it starts', { ...GMAIL, windowStart: T1, windowEnd: T0 }, ['windowEnd']],
      // 18:00Z then 17:00Z: the strings sort forwards, the instants do not.
      [
        'an inverted window in two offsets',
        { ...GMAIL, windowStart: '2026-10-06T14:00:00-04:00', windowEnd: '2026-10-06T17:00:00Z' },
        ['windowEnd'],
      ],
      ['allCalendars on Gmail', { ...GMAIL, allCalendars: true }, ['allCalendars']],
      ['an unknown source', { ...GMAIL, source: 'gmail.inbox' }, ['source']],
      ['an empty observerId', { ...GMAIL, observerId: '' }, ['observerId']],
      ['an account label instead of a hash', { ...GMAIL, accountHash: 'acct-a' }, ['accountHash']],
      ['a lastSyncAt without offset', { ...GMAIL, lastSyncAt: '2026-10-06T15:00:00' }, ['lastSyncAt']],
      ['a smuggled account address', { ...GMAIL, account: 'me@gmail.com' }, []],
    ],
  },
  {
    name: 'Coverage',
    schema: Coverage,
    valid: [
      { evaluatedAt: T1, observers: [] },
      { evaluatedAt: T1, observers: [GMAIL] },
      { evaluatedAt: T1, observers: [GMAIL, GCAL] },
      { evaluatedAt: '2026-10-06T19:00:00Z', observers: [GMAIL, { ...GMAIL, accountHash: 'ef'.repeat(32) }] },
      { evaluatedAt: T0, observers: [without(GCAL, 'allCalendars')] },
    ],
    invalid: [
      ['a missing evaluatedAt', { observers: [] }, ['evaluatedAt']],
      ['observers that are not a list', { evaluatedAt: T1, observers: GMAIL }, ['observers']],
      [
        'an inverted second window',
        { evaluatedAt: T1, observers: [GMAIL, { ...GMAIL, windowEnd: T0, windowStart: T1 }] },
        ['observers', 1, 'windowEnd'],
      ],
      [
        'an entry with an unknown key',
        { evaluatedAt: T1, observers: [{ ...GMAIL, url: 'https://mail.google.com' }] },
        ['observers', 0],
      ],
      ['an unknown top-level key', { evaluatedAt: T1, observers: [], tz: 'America/New_York' }, []],
    ],
  },
  {
    name: 'Attribution',
    schema: Attribution,
    valid: [
      ATTRIBUTION,
      { agent: 'claude', scoreBp: 5000, signals: ['agentSignature'] },
      { ...ATTRIBUTION, adapterLastSyncAt: T1 },
      { agent: 'dots', scoreBp: 0, signals: ['activityLogAdjacent'] },
      {
        agent: 'chatgpt',
        scoreBp: 10000,
        signals: ['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent'],
      },
    ],
    invalid: [
      ['a score above 10000 bp', { ...ATTRIBUTION, scoreBp: 10001 }, ['scoreBp']],
      ['a score that is a fraction', { ...ATTRIBUTION, scoreBp: 0.7 }, ['scoreBp']],
      ['no fired signal', { ...ATTRIBUTION, signals: [] }, ['signals']],
      ['userIdle alone', { ...ATTRIBUTION, signals: ['userIdle'] }, ['signals']],
      ['a repeated signal', { ...ATTRIBUTION, signals: ['agentSignature', 'agentSignature'] }, ['signals']],
      ['an unknown signal', { ...ATTRIBUTION, signals: ['mouseMoved'] }, ['signals', 0]],
      ['an unknown agent', { ...ATTRIBUTION, agent: 'gemini' }, ['agent']],
      ['a bad adapterLastSyncAt', { ...ATTRIBUTION, adapterLastSyncAt: 'yesterday' }, ['adapterLastSyncAt']],
      ['a smuggled verdict', { ...ATTRIBUTION, verdict: 'the agent did it' }, []],
    ],
  },
  {
    name: 'GradeContext',
    schema: GradeContext,
    valid: [
      { priorSpendCents: 0 },
      { priorSpendCents: 3000 },
      { priorSpendCents: 0, attribution: ATTRIBUTION },
      { priorSpendCents: 0, scope: { observed: 'gmail.send' } },
      { priorSpendCents: 2e12, attribution: ATTRIBUTION, scope: { observed: 'calendar.write' } },
    ],
    invalid: [
      ['a negative prior spend', { priorSpendCents: -1 }, ['priorSpendCents']],
      ['a fractional prior spend', { priorSpendCents: 1.5 }, ['priorSpendCents']],
      ['a missing prior spend', {}, ['priorSpendCents']],
      ['an empty observed scope', { priorSpendCents: 0, scope: { observed: '' } }, ['scope', 'observed']],
      [
        'a scope with an unknown key',
        { priorSpendCents: 0, scope: { observed: 'x', declared: 'y' } },
        ['scope'],
      ],
      [
        'an invalid attribution',
        { priorSpendCents: 0, attribution: { ...ATTRIBUTION, scoreBp: -1 } },
        ['attribution', 'scoreBp'],
      ],
      ['a smuggled clock', { priorSpendCents: 0, now: T1 }, []],
    ],
  },
  {
    name: 'Activity',
    schema: Activity,
    valid: [
      EMPTY_ACTIVITY,
      { ...EMPTY_ACTIVITY, sessions: [{ agent: 'muse', at: T0 }] },
      {
        ...EMPTY_ACTIVITY,
        idle: [
          { from: T0, to: T1 },
          { from: T1, to: T1 },
        ],
      },
      {
        ...EMPTY_ACTIVITY,
        entries: [
          { agent: 'chatgpt', at: T0, type: 'email.sent' },
          { agent: 'chatgpt', at: T1 },
        ],
      },
      { ...EMPTY_ACTIVITY, adapterSyncs: [{ agent: 'claude', lastSyncAt: T1 }], claims: [CLAIM] },
    ],
    invalid: [
      ['a missing claims list', without(EMPTY_ACTIVITY, 'claims'), ['claims']],
      [
        'an idle interval ending before it starts',
        { ...EMPTY_ACTIVITY, idle: [{ from: T1, to: T0 }] },
        ['idle', 0, 'to'],
      ],
      [
        'an entry of an unknown type',
        { ...EMPTY_ACTIVITY, entries: [{ agent: 'muse', at: T0, type: 'email.read' }] },
        ['entries', 0, 'type'],
      ],
      [
        'a session of an unknown agent',
        { ...EMPTY_ACTIVITY, sessions: [{ agent: 'gemini', at: T0 }] },
        ['sessions', 0, 'agent'],
      ],
      [
        'a claim without its precision',
        { ...EMPTY_ACTIVITY, claims: [without(CLAIM, 'claimedAtPrecision')] },
        ['claims', 0, 'claimedAtPrecision'],
      ],
      [
        'a sync without offset',
        { ...EMPTY_ACTIVITY, adapterSyncs: [{ agent: 'muse', lastSyncAt: '2026-10-06' }] },
        ['adapterSyncs', 0, 'lastSyncAt'],
      ],
      [
        'a session carrying a url',
        { ...EMPTY_ACTIVITY, sessions: [{ agent: 'muse', at: T0, url: 'https://x' }] },
        ['sessions', 0],
      ],
    ],
  },
];

/** The distinct paths of every issue a parse raised; empty when it parsed. */
function issuePaths(schema: z.ZodType, value: unknown): Path[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  const paths = result.error.issues.map((issue) =>
    issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
  );
  return [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()];
}

describe.each(TABLES)('$name', ({ schema, valid, invalid }) => {
  it('has at least five valid and five invalid cases', () => {
    expect(valid.length).toBeGreaterThanOrEqual(5);
    expect(invalid.length).toBeGreaterThanOrEqual(5);
  });

  it.each(valid.map((value, index) => ({ index, value })))(
    'parses valid case $index to exactly itself',
    ({ value }) => {
      expect(schema.parse(value)).toEqual(value);
    },
  );

  it.each(invalid.map(([label, value, path]) => ({ label, value, path })))(
    'rejects $label at $path',
    ({ value, path }) => {
      expect(issuePaths(schema, value)).toEqual([path]);
    },
  );
});

describe('cross-field refinements', () => {
  it('never throw on malformed input: safeParse always answers (property)', () => {
    // The ledger reads untrusted rows with safeParse and skips the bad ones; a throwing refinement would
    // turn one corrupt row into a failed read of the whole table (Hard Rule 6).
    const refined = [
      Receipt,
      Grant,
      ObserverCoverage,
      Coverage,
      Attribution,
      GradeContext,
      Activity,
      Claim,
      Observation,
    ];
    const malformed = fc.oneof(
      fc.anything(),
      fc.record({
        signals: fc.anything(),
        state: fc.anything(),
        override: fc.anything(),
        grade: fc.anything(),
      }),
      fc.record({
        windowStart: fc.anything(),
        windowEnd: fc.anything(),
        from: fc.anything(),
        to: fc.anything(),
      }),
      fc
        .record({ claimedAt: fc.anything(), claimedAtEnd: fc.anything(), day: fc.boolean() })
        .map(({ day, ...times }) => ({ ...(day ? DAY_CLAIM : CLAIM), ...times })),
      fc.record({ id: fc.anything(), contentHash: fc.anything(), signals: fc.anything() }),
    );
    fc.assert(
      fc.property(malformed, (value) => {
        for (const schema of refined) expect(() => schema.safeParse(value)).not.toThrow();
      }),
      { numRuns: 1_000 },
    );
  }, 60_000);
});

describe('cross-field refinements on timestamps', () => {
  it('report a bad timestamp once, at its own path, in every host time zone', () => {
    // Zod runs a refinement even after a field failed its IsoTs check, and Date reads an offset-less string in
    // the host's zone. Such a string is never compared, or the issues would depend on where Attest runs: each
    // offset-less value below is earlier than its partner in every zone from −12:00 to +14:00.
    const DAY_BEFORE = '2026-10-05T00:00:00';
    const cases: readonly (readonly [z.ZodType, unknown, Path])[] = [
      [Claim, { ...DAY_CLAIM, claimedAtEnd: DAY_BEFORE }, ['claimedAtEnd']],
      [Claim, { ...DAY_CLAIM, claimedAt: 'not a time', claimedAtEnd: T1 }, ['claimedAt']],
      [ObserverCoverage, { ...GMAIL, windowEnd: DAY_BEFORE }, ['windowEnd']],
      [Activity, { ...EMPTY_ACTIVITY, idle: [{ from: T0, to: DAY_BEFORE }] }, ['idle', 0, 'to']],
    ];
    for (const [schema, value, path] of cases) {
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([path]);
    }
  });

  it('compare every timestamp IsoTs accepts: an end at the same instant is always rejected (property)', () => {
    // The offset guard above must never skip a real IsoTs, or a claimedAtEnd before claimedAt would pass.
    const zone = fc.constantFrom('Z', '+00:00', '-04:00', '+05:30', '+0400', '+04', '');
    const fraction = fc.constantFrom('', '.5', '.123', '.1234567');
    let compared = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fraction, zone, (hour, digits, offset) => {
        const at = `2026-10-06T${String(hour).padStart(2, '0')}:02:00${digits}${offset}`;
        if (!IsoTs.safeParse(at).success) return;
        compared += 1;
        const claim = { ...DAY_CLAIM, claimedAt: at, claimedAtEnd: at };
        expect(issuePaths(Claim, claim)).toEqual([['claimedAtEnd']]);
        expect(Claim.safeParse(claim).error?.issues.map((issue) => issue.message)).toEqual([
          'must be after claimedAt',
        ]);
      }),
      { numRuns: 1_000 },
    );
    expect(compared).toBeGreaterThan(100);
  }, 60_000);
});
