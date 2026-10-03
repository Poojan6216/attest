/**
 * SEC-5 (Hard Rules 5, 6): `grade()` refuses a claim's candidate that `candidates()` could never have returned for
 * it (docs/grading.md §4.1; grade-guard.ts) with `GradeError('foreign_candidate')`, instead of grading it into a
 * FINAL receipt: another type, an `occurredAt` outside the claim window (inclusive edges), any candidate of a
 * calendar claim without `targetAt`, a `calendar.created` event seen before the claim's first-seen bound, a source
 * the policy does not list for the claim's type (§6.1 relevant sources, as `candidates()` reads them). One first
 * seen after `evaluatedAt` is ignored (§3), not refused. `gradeBatch` never hands `grade` such a candidate: its receipts equal
 * `grade()` on `candidates()` (batch-oracle.ts) for a ledger full of foreign rows.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { grade, GradeError } from '../../../src/core/grade';
import { instantMs, isoWithOffset } from '../../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import {
  Activity,
  type Claim,
  type GradeContext,
  type Grant,
  type Observation,
} from '../../../src/core/schema';
import { MS_PER_MINUTE } from '../../../src/core/units';
import { claimWindow } from '../../../src/core/window';
import {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  mergePatch,
  PolicyView,
} from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage, ScenarioObservation } from '../../golden/scenario-schema';
import { againstOracle, type World } from './batch-oracle';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const NO_CONTEXT: GradeContext = { priorSpendCents: 0 };
const FOREIGN = new GradeError('foreign_candidate');

const claimOf = (over: Record<string, unknown> = {}): Claim =>
  buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
      claimedAt: at('14:02'),
      ...over,
    }),
  );

const obsOf = (over: Record<string, unknown> = {}): Observation =>
  buildObservation(
    ScenarioObservation.parse({
      ref: 'o1',
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
      occurredAt: at('14:02'),
      observedAt: at('14:30'),
      ...over,
    }),
    [],
    EVAL,
    VIEW,
  );

const entry = (source: ScenarioCoverage['source']): ScenarioCoverage => ({
  source,
  lastSyncAt: EVAL,
  windowStart: at('00:00', '03'),
  windowEnd: EVAL,
  accountHash: 'acct-a',
  ...(source === 'gcal.event' ? { allCalendars: true } : {}),
});
const COVERAGE = buildCoverage([entry('gmail.sent'), entry('gcal.event'), entry('gmail.receipt')], EVAL);
const GRANT: Grant = buildGrant({ agent: 'muse' }, EVAL);

const run = (claim: Claim, candidates: readonly Observation[]) =>
  grade(claim, candidates, GRANT, DEFAULT_POLICY, COVERAGE, NO_CONTEXT);

/** The instant `ms` written at -04:00, the offset every fixture here uses. */
const isoAt = (ms: number): string => isoWithOffset(ms, -240);

describe('SEC-5: grade() refuses a foreign candidate (the review probes)', () => {
  it('a calendar.created row for an email.sent claim, same person, subject and minute (was VERIFIED, FINAL)', () => {
    const event = obsOf({ source: 'gcal.event', type: 'calendar.created' });
    expect(() => run(claimOf(), [event])).toThrow(FOREIGN);
    expect(() => run(claimOf(), [obsOf(), event])).toThrow(GradeError);
    expect(run(claimOf(), [obsOf()]).grade).toBe('VERIFIED');
  });

  it('a gmail.sent row three days before the claim (was PARTIAL, FINAL)', () => {
    const early = obsOf({ occurredAt: at('14:02', '03'), observedAt: at('14:30', '03') });
    expect(() => run(claimOf(), [early])).toThrow(FOREIGN);
  });

  it('the message carries the code only, never a value (Hard Rule 10)', () => {
    let message = '';
    try {
      run(claimOf(), [obsOf({ type: 'purchase.made', merchant: 'Secret Shop' })]);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe('grade: foreign_candidate');
  });
});

describe('SEC-5: the window is §4.1 claimWindow, inclusive at both edges', () => {
  const claim = claimOf();
  const window = claimWindow(claim, DEFAULT_POLICY);
  if (window === null) throw new Error('an email claim always has a window');
  const occurred = (ms: number) => obsOf({ occurredAt: isoAt(ms), observedAt: at('14:50') });

  it('accepts candidates exactly at either edge and refuses one millisecond beyond', () => {
    expect(run(claim, [occurred(window.fromMs), occurred(window.toMs)]).ruleId).toBeDefined();
    expect(() => run(claim, [occurred(window.fromMs - 1)])).toThrow(FOREIGN);
    expect(() => run(claim, [occurred(window.toMs + 1)])).toThrow(FOREIGN);
  });

  it('a calendar claim without targetAt has no window: no_target with none, refused with any', () => {
    const calendar = claimOf({ type: 'calendar.created', subjectHint: 'Q3 sync' });
    const event = obsOf({ source: 'gcal.event', type: 'calendar.created', subjectHint: 'Q3 sync' });
    expect(run(calendar, []).ruleId).toBe('no_target');
    expect(() => run(calendar, [event])).toThrow(FOREIGN);
  });

  it('calendar.created: an event first seen before the claim minus beforeClaimMin was never a candidate', () => {
    const calendar = claimOf({
      type: 'calendar.created',
      subjectHint: 'Q3 sync',
      targetAt: at('10:00', '08'),
    });
    const boundMs = instantMs(at('14:02')) - DEFAULT_POLICY.windows.beforeClaimMin * MS_PER_MINUTE;
    const seen = (ms: number) =>
      obsOf({
        source: 'gcal.event',
        type: 'calendar.created',
        subjectHint: 'Q3 sync',
        occurredAt: at('10:00', '08'),
        observedAt: isoAt(ms),
      });
    expect(run(calendar, [seen(boundMs)]).observationIds).toHaveLength(1);
    expect(() => run(calendar, [seen(boundMs - 1)])).toThrow(FOREIGN);
    const updated = claimOf({
      type: 'calendar.updated',
      subjectHint: 'Q3 sync',
      targetAt: at('10:00', '08'),
    });
    const before = obsOf({
      source: 'gcal.event',
      type: 'calendar.updated',
      subjectHint: 'Q3 sync',
      occurredAt: at('10:00', '08'),
      observedAt: isoAt(boundMs - 1),
    });
    expect(run(updated, [before]).observationIds).toHaveLength(1);
  });
});

describe('SEC-5: the source must be one the policy lists for the claim type (§6.1 relevant sources)', () => {
  it('a row of the claim type read by a source the policy does not list for it is refused', () => {
    const stray = obsOf({ source: 'gcal.event' });
    expect(DEFAULT_POLICY.sourcesByType['email.sent']).not.toContain('gcal.event');
    expect(() => run(claimOf(), [stray])).toThrow(FOREIGN);
  });

  it('a policy that lists the source makes the same row a candidate', () => {
    const both = loadPolicy(
      mergePatch(defaultPolicyJson, { sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } }),
    );
    const stray = obsOf({ source: 'gcal.event' });
    const receipt = grade(claimOf(), [stray], GRANT, both, COVERAGE, NO_CONTEXT);
    expect(receipt.observationIds).toEqual([stray.id]);
  });
});

describe('SEC-5: what §4.1 does not ask of a candidate is not refused', () => {
  it('a candidate first seen after evaluatedAt is ignored (§3), not refused', () => {
    const late = obsOf({ observedAt: at('15:01') });
    expect(run(claimOf(), [late])).toEqual(run(claimOf(), []));
  });

  it('claim-less grades are not checked here: the orphan of any type is the subject', () => {
    const orphan = obsOf({ type: 'calendar.deleted', source: 'gcal.event', observedAt: EVAL });
    expect(grade(null, [orphan], GRANT, DEFAULT_POLICY, COVERAGE, NO_CONTEXT).ruleId).toBe(
      'default_unverifiable',
    );
  });
});

describe('SEC-5: gradeBatch never hands grade() a foreign candidate', () => {
  it('a ledger of other types, out-of-window rows, stray sources and a pre-existing event: oracle-equal', async () => {
    const claims = [
      claimOf(),
      claimOf({ ref: 'c2', counterparty: 'raj@company.com', claimedAt: at('14:20') }),
      claimOf({
        ref: 'c3',
        type: 'calendar.created',
        subjectHint: 'Q3 sync',
        targetAt: at('10:00', '08'),
        claimedAt: at('14:10'),
      }),
      claimOf({ ref: 'c4', type: 'calendar.created', subjectHint: 'Q3 sync', claimedAt: at('14:12') }),
    ];
    const observations = [
      obsOf(),
      obsOf({ ref: 'o2', source: 'gcal.event', type: 'calendar.created' }),
      obsOf({ ref: 'o3', occurredAt: at('14:02', '03'), observedAt: at('14:30', '03') }),
      obsOf({ ref: 'o4', source: 'gcal.event', counterparty: 'raj@company.com', occurredAt: at('14:20') }),
      obsOf({
        ref: 'o5',
        source: 'gcal.event',
        type: 'calendar.created',
        subjectHint: 'Q3 sync',
        occurredAt: at('10:00', '08'),
        observedAt: at('09:00'),
      }),
      obsOf({
        ref: 'o6',
        source: 'gcal.event',
        type: 'calendar.created',
        subjectHint: 'Q3 sync',
        occurredAt: at('11:00', '08'),
        observedAt: at('14:40'),
      }),
    ];
    const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims });
    const world: World = {
      claims,
      observations,
      grants: [GRANT],
      policy: DEFAULT_POLICY,
      coverage: COVERAGE,
      activity,
    };
    const graded = await gradeBatch(
      claims,
      createMemoryIndex(observations, 1),
      [GRANT],
      DEFAULT_POLICY,
      COVERAGE,
      activity,
    );
    const pairs = await againstOracle(world, graded);
    expect(pairs).toHaveLength(claims.length);
    for (const [id, batch, oracle] of pairs) expect(batch, id).toBe(oracle);
  });
});
