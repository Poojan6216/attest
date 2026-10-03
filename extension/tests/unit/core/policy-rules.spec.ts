/**
 * SEC-4 (Sprint 1 security review; Hard Rules 5 and 7): `loadPolicy` refuses a rule that concludes a grade without
 * naming the evidence docs/grading.md §2 defines that grade by, whatever the rule order. VERIFIED needs a match at
 * the verified threshold, PARTIAL one at a threshold, NOT_FOUND the whole window seen after grace with nothing at
 * the partial threshold, UNASKED a likely attribution, OVER_SCOPE a fact outside the grant. UNVERIFIABLE asserts
 * nothing, and PENDING is its placeholder. Each refusal names the rule's path.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import { loadPolicy, PolicyError } from '../../../src/core/policy';

type When = Readonly<Record<string, string | boolean>>;

const SCOPE_FLAGS = [
  'observedScopeExceedsDeclared',
  'typeNotInGrant',
  'counterpartyNotAllowed',
  'amountAboveCeiling',
  'cumulativeAboveCeiling',
] as const;
const OVER_SCOPE_LINE = `rules[0].when: must set one of ${SCOPE_FLAGS.join(', ')} to true when then is "OVER_SCOPE"`;

/** The shipped document with `rule` (id `probe`) put first, so it is `rules[0]`. */
function withRule(when: When, then: string): unknown {
  return { ...structuredClone(policyJson), rules: [{ id: 'probe', when, then }, ...policyJson.rules] };
}

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError && error.code === 'invalid_policy') return error.issues;
    throw error;
  }
  return [];
}

const refused = (when: When, then: string): readonly string[] => issuesOf(withRule(when, then));

describe('loadPolicy: VERIFIED, PARTIAL and NOT_FOUND name the evidence they assert (§2)', () => {
  it('VERIFIED needs bestScoreGte "verified" (the review probe C rule graded VERIFIED with no candidate)', () => {
    const line = 'rules[0].when.bestScoreGte: must be "verified" when then is "VERIFIED"';
    expect(refused({ graceElapsed: true }, 'VERIFIED')).toEqual([line]);
    expect(refused({ bestScoreGte: 'partial' }, 'VERIFIED')).toEqual([line]);
    expect(refused({ bestScoreLt: 'verified' }, 'VERIFIED')).toEqual([line]);
    expect(refused({ bestScoreGte: 'verified' }, 'VERIFIED')).toEqual([]);
  });

  it('PARTIAL needs bestScoreGte, at either threshold', () => {
    const line = 'rules[0].when.bestScoreGte: must be "partial" or "verified" when then is "PARTIAL"';
    expect(refused({ coverage: 'full' }, 'PARTIAL')).toEqual([line]);
    expect(refused({ bestScoreLt: 'partial', graceElapsed: true }, 'PARTIAL')).toEqual([line]);
    expect(refused({ bestScoreGte: 'partial' }, 'PARTIAL')).toEqual([]);
    expect(refused({ bestScoreGte: 'verified' }, 'PARTIAL')).toEqual([]);
  });

  it('NOT_FOUND needs graceElapsed true, coverage "full" and bestScoreLt "partial": one line per gap', () => {
    const grace = 'rules[0].when.graceElapsed: must be true when then is "NOT_FOUND"';
    const coverage = 'rules[0].when.coverage: must be "full" when then is "NOT_FOUND"';
    const score = 'rules[0].when.bestScoreLt: must be "partial" when then is "NOT_FOUND"';
    const full = { graceElapsed: true, coverage: 'full', bestScoreLt: 'partial' };
    expect(refused({ typeNotInGrant: false }, 'NOT_FOUND')).toEqual([grace, coverage, score]);
    expect(refused({ ...full, graceElapsed: false }, 'NOT_FOUND')).toEqual([grace]);
    expect(refused({ ...full, coverage: 'partial' }, 'NOT_FOUND')).toEqual([coverage]);
    expect(refused({ graceElapsed: true, coverage: 'full' }, 'NOT_FOUND')).toEqual([score]);
    expect(refused({ ...full, bestScoreLt: 'verified' }, 'NOT_FOUND')).toEqual([score]);
    expect(refused(full, 'NOT_FOUND')).toEqual([]);
  });
});

describe('loadPolicy: UNASKED and OVER_SCOPE name their facts; UNVERIFIABLE and PENDING need none (§2)', () => {
  it('UNASKED needs unaskedLikely true (Hard Rule 7: only above the attribution threshold)', () => {
    const line = 'rules[0].when.unaskedLikely: must be true when then is "UNASKED"';
    expect(refused({ coverage: 'full' }, 'UNASKED')).toEqual([line]);
    expect(refused({ unaskedLikely: false }, 'UNASKED')).toEqual([line]);
    expect(refused({ observedScopeExceedsDeclared: true }, 'UNASKED')).toEqual([line]);
    expect(refused({ unaskedLikely: true }, 'UNASKED')).toEqual([]);
  });

  it('OVER_SCOPE needs one fact outside the grant set to true', () => {
    expect(refused({ graceElapsed: true }, 'OVER_SCOPE')).toEqual([OVER_SCOPE_LINE]);
    expect(refused({ typeNotInGrant: false, amountAboveCeiling: false }, 'OVER_SCOPE')).toEqual([
      OVER_SCOPE_LINE,
    ]);
    for (const flag of SCOPE_FLAGS) expect(refused({ [flag]: true }, 'OVER_SCOPE'), flag).toEqual([]);
  });

  it('UNVERIFIABLE and PENDING need no evidence: they assert nothing', () => {
    expect(refused({ graceElapsed: true }, 'UNVERIFIABLE')).toEqual([]);
    const rules = policyJson.rules.map((rule) =>
      rule.id === 'pending' ? { ...rule, when: { coverage: 'full' } } : rule,
    );
    expect(issuesOf({ ...structuredClone(policyJson), rules })).toEqual([]);
  });

  it('every shipped rule already names its evidence, and a gap is reported at its own index', () => {
    expect(() => loadPolicy(policyJson)).not.toThrow();
    const index = policyJson.rules.findIndex((rule) => rule.id === 'not_found');
    const rules = policyJson.rules.map((rule, i) =>
      i === index ? { ...rule, when: { ...rule.when, coverage: 'partial' } } : rule,
    );
    expect(issuesOf({ ...structuredClone(policyJson), rules })).toEqual([
      `rules[${String(index)}].when.coverage: must be "full" when then is "NOT_FOUND"`,
    ]);
  });
});

/** §2, written from the contract (not from the loader): the evidence each grade asserts. */
const ASSERTS: Readonly<Record<string, (when: When) => boolean>> = {
  VERIFIED: (when) => when.bestScoreGte === 'verified',
  PARTIAL: (when) => when.bestScoreGte !== undefined,
  NOT_FOUND: (when) =>
    when.graceElapsed === true && when.coverage === 'full' && when.bestScoreLt === 'partial',
  UNASKED: (when) => when.unaskedLikely === true,
  OVER_SCOPE: (when) => SCOPE_FLAGS.some((flag) => when[flag] === true),
  UNVERIFIABLE: () => true,
};

const flag = fc.boolean();
const threshold = fc.constantFrom('verified', 'partial');
const whenArb: fc.Arbitrary<When> = fc
  .record(
    {
      unaskedLikely: flag,
      observedScopeExceedsDeclared: flag,
      typeNotInGrant: flag,
      counterpartyNotAllowed: flag,
      amountAboveCeiling: flag,
      cumulativeAboveCeiling: flag,
      targetMissing: flag,
      underspecified: flag,
      coverage: fc.constantFrom('none', 'partial', 'full'),
      bestScoreGte: threshold,
      bestScoreLt: threshold,
      graceElapsed: flag,
    },
    { requiredKeys: [] },
  )
  .filter((when) => Object.keys(when).length > 0);

describe('loadPolicy: rule evidence, property (fast-check)', () => {
  it('a rule loads iff it names the evidence §2 gives its grade; every refusal names rules[0].when', () => {
    fc.assert(
      fc.property(whenArb, fc.constantFrom(...Object.keys(ASSERTS)), (when, then) => {
        const issues = refused(when, then);
        expect(issues.length === 0).toBe(ASSERTS[then]?.(when));
        for (const line of issues) expect(line.startsWith('rules[0].when')).toBe(true);
      }),
      // qa_tester rule 4: property tests over src/core run at least 1,000 examples each.
      { numRuns: 1_000 },
    );
  });
});
