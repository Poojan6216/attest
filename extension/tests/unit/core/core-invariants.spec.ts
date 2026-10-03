/**
 * Close-1 fixes in src/core that no grading input reaches, each tested directly:
 *
 *  - QA-R10: window.ts reads the UTC offset written at the end of a timestamp with `trailingOffsetMinutes` alone; text
 *    without one is `WindowError('no_offset')`, never a guessed offset (the old regex fallback was unreachable: a
 *    property pins `trailingOffsetMinutes` to every timestamp `instantMs` accepts).
 *  - TECH-C7: a candidate table asked for a row it does not hold, and a SHA-256 writer written after its digest, throw
 *    the typed `InvariantError` (closed codes), so replay's report names them; never a bare RangeError.
 *  - TECH-C5: an UNASKED receipt's rule reasons are attribution.ts `attributionReasons`, the one map from signal to
 *    reason code.
 *  - Hard Rule 6 (with SEC-2): `attributor` and `attribute` refuse a policy `loadPolicy` did not return, like every
 *    other grading entry, with `PolicyError('policy_not_loaded')`.
 */
import { describe, expect, it } from 'vitest';

import { attribute, attributionReasons, attributor } from '../../../src/core/attribution';
import { CandidateTable } from '../../../src/core/batch-table';
import { TextFacts } from '../../../src/core/features';
import { grade } from '../../../src/core/grade';
import { InvariantError } from '../../../src/core/invariant-error';
import { DEFAULT_POLICY, PolicyError } from '../../../src/core/policy';
import { Activity, Attribution, type UnaskedSignal } from '../../../src/core/schema';
import { Sha256Writer } from '../../../src/core/sha256';
import { precisionStartMs, WindowError, writtenOffsetMinutes } from '../../../src/core/window';
import defaultPolicyJson from '../../../../policy/default.json';
import { buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioObservation } from '../../golden/scenario-schema';

describe('QA-R10: the written UTC offset, or a typed error', () => {
  it.each([
    ['2026-10-06T14:02:00Z', 0],
    ['2026-10-06T14:02:00-04:00', -240],
    ['2026-10-06T14:02:00.250+05:45', 345],
    ['2026-10-06T14:02:00+00:00', 0],
  ])('%s is %i minutes', (iso, minutes) => {
    expect(writtenOffsetMinutes(iso)).toBe(minutes);
  });

  it.each(['2026-10-06T14:02:00', '2026-10-06T14:02:00 EST', '', '+'])(
    '%j has none: WindowError(no_offset)',
    (iso) => {
      expect(() => writtenOffsetMinutes(iso)).toThrow(new WindowError('no_offset'));
    },
  );

  it('a window reads the offset after instantMs accepted the text, so it unit-aligns in that offset', () => {
    const claim = { claimedAt: '2026-10-06T23:30:00+05:45', claimedAtPrecision: 'day' } as const;
    expect(precisionStartMs(claim)).toBe(Date.parse('2026-10-06T00:00:00+05:45'));
  });
});

describe('TECH-C7: broken internal invariants throw InvariantError with a closed code', () => {
  it('a candidate table asked for a row it does not hold: no_such_row', () => {
    const table = new CandidateTable([], [], new TextFacts([]));
    expect(() => table.id(0)).toThrow(new InvariantError('no_such_row'));
    expect(() => table.facts(3)).toThrow(InvariantError);
  });

  it('a SHA-256 writer written after its digest: write_after_digest', () => {
    const writer = new Sha256Writer();
    writer.write('abc');
    writer.hex();
    expect(() => {
      writer.write('d');
    }).toThrow(new InvariantError('write_after_digest'));
  });

  it('the message is the code only (Hard Rule 10), and the name is replay-readable', () => {
    const error = new InvariantError('no_such_row');
    expect([error.name, error.code, error.message]).toEqual([
      'InvariantError',
      'no_such_row',
      'core invariant: no_such_row',
    ]);
  });
});

describe("TECH-C5: an UNASKED receipt's signal reasons are attributionReasons, the one copy", () => {
  const EVAL = '2026-10-06T15:00:00-04:00';
  const orphan = buildObservation(
    ScenarioObservation.parse({
      ref: 'o1',
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      occurredAt: '2026-10-06T14:02:00-04:00',
      observedAt: EVAL,
    }),
    [],
    EVAL,
    PolicyView.parse(defaultPolicyJson),
  );
  const coverage = buildCoverage([], EVAL);
  const grant = buildGrant({ agent: 'claude' }, EVAL);

  it.each<UnaskedSignal[]>([
    ['activityLogAdjacent', 'userIdle', 'agentSessionActive'],
    ['agentSignature'],
    ['userIdle', 'agentSignature', 'activityLogAdjacent', 'agentSessionActive'],
  ])('signals %j', (...signals) => {
    const attribution = Attribution.parse({ agent: 'claude', scoreBp: 9000, signals });
    const receipt = grade(null, [orphan], grant, DEFAULT_POLICY, coverage, {
      priorSpendCents: 0,
      attribution,
    });
    expect(receipt.grade).toBe('UNASKED');
    expect(receipt.reasons).toEqual(attributionReasons(attribution));
  });
});

describe('attribution refuses a policy loadPolicy did not return (Hard Rule 6)', () => {
  const EVAL = '2026-10-06T15:00:00-04:00';
  const activity = Activity.parse({
    sessions: [{ agent: 'muse', at: '2026-10-06T14:02:00-04:00' }],
    idle: [],
    entries: [],
    adapterSyncs: [],
    claims: [],
  });
  const orphan = buildObservation(
    ScenarioObservation.parse({
      ref: 'o1',
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      occurredAt: '2026-10-06T14:02:00-04:00',
      observedAt: EVAL,
    }),
    [],
    EVAL,
    PolicyView.parse(defaultPolicyJson),
  );

  it('a spread copy of the loaded default: policy_not_loaded from attributor and attribute', () => {
    const copy = { ...DEFAULT_POLICY };
    expect(() => attributor(activity, copy, EVAL)).toThrow(new PolicyError([], 'policy_not_loaded'));
    expect(() => attribute(orphan, activity, copy, EVAL)).toThrow(PolicyError);
    expect(attribute(orphan, activity, DEFAULT_POLICY, EVAL)?.signals).toEqual(['agentSessionActive']);
  });
});
