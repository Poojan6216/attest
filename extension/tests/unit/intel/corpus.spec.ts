/**
 * The labelled matching corpus (sprint_5 5.5; tests/unit/intel/corpus.ts, tests/fixtures/intel/corpus.json): every
 * case grades by the rules alone as its story says, the model would be asked about exactly the PARTIAL ones, and the
 * score counts what VERIFIED got right and wrong. Two stand-in recordings, never a real model's, prove the measure can
 * move either way: one that scores the labelled observation 1 and any other 0 lifts the paraphrases in the band without
 * a false verification; one that scores everything 1 lifts the decoys in the band too, and precision falls. Every
 * value is invented.
 */
import { describe, expect, it } from 'vitest';

import { BASIS_POINTS } from '../../../src/core/units';
import {
  type Answers,
  askedInputs,
  gradeCase,
  type IntelCase,
  readIntelCorpus,
  scoreCorpus,
  truthIdOf,
} from './corpus';

/** Each case's rule by the rules alone, as its story says. */
const RULES: Readonly<Record<string, string>> = {
  'email-name-exact': 'verified',
  'email-name-paraphrase-quarterly': 'partial',
  'email-name-paraphrase-q3': 'partial',
  'email-name-paraphrase-invoice': 'verified',
  'email-name-paraphrase-offsite': 'verified',
  'email-name-paraphrase-far': 'partial',
  'email-name-paraphrase-late': 'partial',
  'email-name-decoy-same-person': 'partial',
  'email-name-decoy-one-word': 'partial',
  'email-name-decoy-one-word-of-four': 'partial',
  'email-name-decoy-other-person': 'partial',
  'email-name-nothing-sent': 'not_found',
  'email-address-exact': 'verified',
  'email-address-paraphrase': 'partial',
  'email-address-decoy-same-mailbox': 'partial',
  'email-address-two-sends': 'partial',
  'email-address-colleague': 'partial',
  'email-address-plus-tag': 'partial',
  'calendar-exact': 'verified',
  'calendar-paraphrase-close': 'partial',
  'calendar-paraphrase-half': 'partial',
  'calendar-decoy-one-word': 'partial',
  'calendar-decoy-close-words': 'partial',
  'calendar-nothing': 'not_found',
};

const CASES: readonly IntelCase[] = readIntelCorpus();

/** A stand-in recording: every asked input's one candidate scored by `score`, from its case. */
async function recorded(score: (intelCase: IntelCase, candidateId: string) => number): Promise<Answers> {
  const byHash = new Map<string, { observationId: string; score: number }[]>();
  for (const ask of await askedInputs(CASES)) {
    const intelCase = CASES.find(({ id }) => id === ask.caseId);
    if (intelCase === undefined) throw new Error(`no case ${ask.caseId}`);
    byHash.set(
      ask.hash,
      ask.input.candidates.map(({ id }) => ({
        observationId: id,
        score: score(intelCase, id) * BASIS_POINTS,
      })),
    );
  }
  return (hash) => (byHash.get(hash) as ReturnType<Answers>) ?? undefined;
}

describe('the labelled matching corpus', () => {
  it('grades every case by the rules alone as its story says', async () => {
    expect(CASES.map(({ id }) => id).sort()).toEqual(Object.keys(RULES).sort());
    for (const intelCase of CASES) {
      expect((await gradeCase(intelCase)).ruleId, intelCase.id).toBe(RULES[intelCase.id]);
    }
  });

  it('would have the model asked about exactly the PARTIAL cases, each with the one candidate it took', async () => {
    const asked = await askedInputs(CASES);
    const partial = Object.entries(RULES).filter(([, rule]) => rule === 'partial');
    expect(asked.map(({ caseId }) => caseId).sort()).toEqual(partial.map(([id]) => id).sort());
    for (const { input } of asked) expect(input.candidates).toHaveLength(1);
    // Two cases ask the same thing: the same claim and the same send (an observation's id is its content's), so one
    // answer serves both, as the cache by `inputsHash` does in the extension.
    const byHash = new Map<string, string[]>();
    for (const { hash, caseId } of asked) byHash.set(hash, [...(byHash.get(hash) ?? []), caseId]);
    expect([...byHash.values()].filter((ids) => ids.length > 1)).toEqual([
      ['email-address-paraphrase', 'email-address-two-sends'],
    ]);
  });

  it('by the rules alone: 5 true verifications of 14 labelled cases, and no false one', async () => {
    expect(await scoreCorpus(undefined, CASES)).toEqual({
      cases: 24,
      labelled: 14,
      asked: 17,
      answered: 0,
      verifiedTrue: 5,
      verifiedFalse: 0,
      precision: 1,
      recall: 5 / 14,
    });
  });
});

describe('the measure moves both ways (stand-in recordings, never a real model)', () => {
  it('a model that knows the label lifts the paraphrases in the band, and verifies nothing falsely', async () => {
    const truthful = await recorded((intelCase, id) => (truthIdOf(intelCase) === id ? 1 : 0));
    const score = await scoreCorpus(truthful, CASES);
    expect(score).toMatchObject({ asked: 17, answered: 17, verifiedFalse: 0, precision: 1 });
    expect(score.verifiedTrue).toBeGreaterThan(5);
  });

  it('a model that says yes to everything lifts the decoys in the band too, and precision falls', async () => {
    const yes = await recorded(() => 1);
    const score = await scoreCorpus(yes, CASES);
    expect(score.verifiedFalse).toBeGreaterThan(0);
    expect(score.precision).toBeLessThan(1);
  });

  it('a model that gives no answer changes nothing', async () => {
    const silent: Answers = () => null;
    expect(await scoreCorpus(silent, CASES)).toMatchObject({
      asked: 17,
      answered: 0,
      verifiedTrue: 5,
      verifiedFalse: 0,
    });
  });
});
