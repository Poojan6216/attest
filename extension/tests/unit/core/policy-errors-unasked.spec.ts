/**
 * `unasked.threshold` must be above 0 basis points (docs/grading.md §5.3, §7; Hard Rules 5, 7): UNASKED names its
 * evidence, the signals that fired, so at a threshold of 0 an attribution whose fired signals weigh nothing would
 * still be "likely", a FINAL accusation resting on nothing. The partial threshold's sibling rule (§2, §4.3).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { loadPolicy, PolicyError } from '../../../src/core/policy';
import { Activity, Coverage } from '../../../src/core/schema';
import { OBSERVATIONS, scenarioWorld, T1, T1_MS } from '../../tools/attest-scenario';
import { isoAt, MS_PER_MINUTE } from '../../tools/attest-world';

const ZERO_SIGNALS = { agentSessionActive: 0, userIdle: 0, agentSignature: 0, activityLogAdjacent: 0 };

/** The default policy with `unasked` patched. */
const withUnasked = (patch: Record<string, unknown>) => ({
  ...defaultPolicyJson,
  unasked: { ...defaultPolicyJson.unasked, ...patch },
});

function issuesOf(document: unknown): readonly string[] {
  try {
    loadPolicy(document);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  return [];
}

describe('unasked.threshold must be above 0 basis points (§7)', () => {
  it.each([
    ['0', withUnasked({ threshold: 0 })],
    ['-0 (0 basis points too)', withUnasked({ threshold: -0 })],
    ['0 with every signal weighing 0', withUnasked({ threshold: 0, signals: ZERO_SIGNALS })],
  ])('refuses a threshold of %s', (_label, document) => {
    expect(issuesOf(document)).toEqual(['unasked.threshold: must be > 0']);
  });

  it('refuses a threshold that rounds to 0 basis points, beside its grid error', () => {
    expect(issuesOf(withUnasked({ threshold: 0.00004 }))).toEqual([
      'unasked.threshold: must be a multiple of 0.0001',
      'unasked.threshold: must be > 0',
    ]);
  });

  it('accepts 1 basis point: an UNASKED receipt then needs a signal with a positive weight', () => {
    expect(issuesOf(withUnasked({ threshold: 0.0001 }))).toEqual([]);
    expect(loadPolicy(withUnasked({ threshold: 0.0001, signals: ZERO_SIGNALS })).bp.unasked.threshold).toBe(
      1,
    );
  });

  it('so no policy that loads accuses an agent on a score of 0 (the verifier’s probe, through gradeBatch)', async () => {
    // o9 alone, no claim; muse pinged a session 9 minutes after o9 and the user was not idle: one signal fired.
    const world = scenarioWorld();
    const activity = Activity.parse({
      ...world.activity,
      idle: [],
      sessions: [{ agent: 'muse', at: isoAt(T1_MS - 291 * MS_PER_MINUTE, 0) }],
      claims: [],
    });
    const coverage = Coverage.parse({
      evaluatedAt: T1,
      observers: world.passes.filter((pass) => Date.parse(pass.lastSyncAt) <= T1_MS),
    });
    const unaskedOf = async (document: unknown) => {
      const graded = await gradeBatch(
        [],
        createMemoryIndex([OBSERVATIONS.o9], 15),
        world.grants,
        loadPolicy(document),
        coverage,
        activity,
        [],
      );
      return graded
        .filter(({ receipt }) => receipt.grade === 'UNASKED')
        .map(({ receipt }) => receipt.signals);
    };
    expect(await unaskedOf(defaultPolicyJson)).toEqual([]);
    expect(await unaskedOf(withUnasked({ threshold: 0.0001, signals: ZERO_SIGNALS }))).toEqual([]);
    expect(() => loadPolicy(withUnasked({ threshold: 0, signals: ZERO_SIGNALS }))).toThrow(PolicyError);
  });
});
