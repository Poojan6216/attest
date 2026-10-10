/**
 * The labelled matching corpus of the advisory model's bench (sprint_5 5.5; agents/intel_engineer.md rule 8; qa_tester
 * rule 2; tests/fixtures/intel/corpus.json): invented claims, each with the sends or events around it and a label
 * naming the one that records the claimed action, or none. A case is graded as the service worker grades it
 * (src/core/batch.ts `gradeBatch`, the shipped policy, an hour after the claim with every view synced). The model is
 * asked only about a case the rules grade by rule `partial`, with the one candidate it took: exactly the input the
 * service worker would send (src/background/intel.ts). Its answer comes from a recording, keyed by that input's hash.
 * A VERIFIED receipt naming the labelled observation is a true verification; one naming any other, or made where the
 * label is null, a false one. Recall is over the labelled cases. Every value is invented: the numbers say how the
 * matcher reads these stories, not how it reads real mail.
 *
 * Not a test file: the corpus spec and bench/intel.ts share it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import defaultPolicyJson from '../../../../policy/default.json';
import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs, isoWithOffset } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import {
  Activity,
  IsoTs,
  ModelScores,
  type Observation,
  type ObservationSource,
  type Receipt,
  type Sha256,
  type Ulid,
} from '../../../src/core/schema';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../../../src/core/units';
import { inputsHash } from '../../../src/intel/cache';
import { buildInput, type IntelInput } from '../../../src/intel/input';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../../golden/scenario-schema';

const CORPUS_FILE = path.join(import.meta.dirname, '../../fixtures/intel/corpus.json');
const VIEW = PolicyView.parse(defaultPolicyJson);
/** The local offset of every story (UTC−04:00). */
const OFFSET = -240;

export const IntelCase = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    story: z.string().min(1),
    claim: ScenarioClaim.omit({ ref: true, agent: true }),
    observations: z.array(ScenarioObservation.omit({ source: true, observedAt: true, rowKey: true })).min(1),
    /** The observation that records the claimed action, or null when none does. */
    truth: z.string().nullable(),
  })
  .refine(
    ({ truth, observations }) => truth === null || observations.some(({ ref }) => ref === truth),
    'the label names one of its observations',
  );
export type IntelCase = z.infer<typeof IntelCase>;

const IntelCorpus = z
  .strictObject({ note: z.string().min(1), cases: z.array(IntelCase).min(1) })
  .refine(({ cases }) => new Set(cases.map(({ id }) => id)).size === cases.length, 'case ids are unique');

/** Every case of the corpus, in file order. */
export function readIntelCorpus(): IntelCase[] {
  return IntelCorpus.parse(JSON.parse(readFileSync(CORPUS_FILE, 'utf8'))).cases;
}

/** The one source the shipped policy reads for `type`. */
function sourceOf(type: IntelCase['claim']['type']): ObservationSource {
  const [source] = DEFAULT_POLICY.sourcesByType[type];
  if (source === undefined) throw new Error(`no source reads ${type}`);
  return source;
}

/** The case as the ledger would hold it an hour after the claim (header). */
function ledgerOf(intelCase: IntelCase) {
  const claimedMs = instantMs(intelCase.claim.claimedAt);
  const at = (ms: number) => isoWithOffset(ms, OFFSET);
  const evaluatedAt = at(claimedMs + MS_PER_HOUR);
  const observedAt = at(claimedMs + 38 * MS_PER_MINUTE);
  const source = sourceOf(intelCase.claim.type);
  const claim = buildClaim(ScenarioClaim.parse({ ref: 'c1', agent: 'muse', ...intelCase.claim }));
  const rows = intelCase.observations.map((row, index) =>
    buildObservation(
      ScenarioObservation.parse({ source, ...row, observedAt, rowKey: `row-${String(index)}` }),
      [],
      evaluatedAt,
      VIEW,
    ),
  );
  const account = { accountHash: 'acct-a' } as const;
  const month = { windowStart: '2026-10-01T00:00:00-04:00', windowEnd: '2026-11-01T00:00:00-04:00' } as const;
  const entries =
    source === 'gmail.sent'
      ? [
          {
            source,
            ...account,
            lastSyncAt: evaluatedAt,
            windowStart: at(claimedMs - 4 * MS_PER_HOUR),
            windowEnd: evaluatedAt,
          },
        ]
      : [at(claimedMs - 5 * MS_PER_HOUR), observedAt].map((lastSyncAt) => ({
          source,
          ...account,
          ...month,
          lastSyncAt,
          allCalendars: true,
        }));
  const coverage = buildCoverage(entries, evaluatedAt);
  return { claim, rows, coverage, evaluatedAt };
}

/** The case's claim receipt (header), graded with `scores` as its claim's model scores when given. */
export async function gradeCase(intelCase: IntelCase, scores?: ModelScores): Promise<Receipt> {
  const { claim, rows, coverage, evaluatedAt } = ledgerOf(intelCase);
  const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [claim] });
  const grants = [buildGrant({ agent: 'muse' }, evaluatedAt)];
  const model = new Map<Ulid, ModelScores>(scores === undefined ? [] : [[claim.id, scores]]);
  const graded = await gradeBatch(
    [claim],
    createMemoryIndex(rows, 1),
    grants,
    DEFAULT_POLICY,
    coverage,
    activity,
    [],
    model,
  );
  const receipt = graded.find((entry) => entry.receipt.claimId === claim.id)?.receipt;
  if (receipt === undefined) throw new Error(`${intelCase.id}: no claim receipt`);
  return receipt;
}

/** The id of the observation the case's label names, as the ledger would hold it; null when the label is null. */
export function truthIdOf(intelCase: IntelCase): string | null {
  const index = intelCase.observations.findIndex(({ ref }) => ref === intelCase.truth);
  return index < 0 ? null : (ledgerOf(intelCase).rows[index]?.id ?? null);
}

/** What the model would be sent for a case, and the hash a recording keys its answer by. */
export interface AskedInput {
  readonly caseId: string;
  readonly hash: Sha256;
  readonly input: IntelInput;
}

/** The input the service worker would send for `intelCase` (header), or null when it would ask nothing. */
export async function askedOf(intelCase: IntelCase): Promise<AskedInput | null> {
  const receipt = await gradeCase(intelCase);
  const [taken, ...more] = receipt.observationIds;
  // The grade the service worker's predicate reads (core `modelMayRaise`): the corpus grades once, past the grace, so
  // its receipts are FINAL where the worker asks while they are PENDING (tech review TECH-9).
  if (receipt.grade !== 'PARTIAL' || taken === undefined || more.length > 0) return null;
  const { claim, rows } = ledgerOf(intelCase);
  const observation = rows.find(({ id }) => id === taken);
  if (observation === undefined) throw new Error(`${intelCase.id}: the taken observation is missing`);
  const input = buildInput(claim, [observation]);
  return { caseId: intelCase.id, hash: inputsHash(input), input };
}

/** Every input the corpus would have the model asked, in case order. */
export async function askedInputs(cases: readonly IntelCase[] = readIntelCorpus()): Promise<AskedInput[]> {
  const asked = await Promise.all(cases.map(askedOf));
  return asked.filter((entry) => entry !== null);
}

/** A model's recorded answers: an input's hash → its scores, or null for no answer; undefined when never recorded. */
export type Answers = (hash: string) => ModelScores | null | undefined;

/** One model on the corpus, or the rules alone: counts, and precision and recall of VERIFIED. */
export interface IntelScore {
  readonly cases: number;
  /** Cases with a label: those a perfect matcher would verify. */
  readonly labelled: number;
  /** Cases the model would be asked about, and of those, how many the recording answered. */
  readonly asked: number;
  readonly answered: number;
  readonly verifiedTrue: number;
  readonly verifiedFalse: number;
  /** Null when nothing was verified: a share of nothing is not a number. */
  readonly precision: number | null;
  readonly recall: number;
}

/** Whether `receipt` verifies the labelled observation of `intelCase`, another, or nothing. */
function verdict(
  intelCase: IntelCase,
  receipt: Receipt,
  rows: readonly Observation[],
): 'true' | 'false' | null {
  if (receipt.grade !== 'VERIFIED') return null;
  const taken = rows.find(({ id }) => id === receipt.observationIds[0]);
  const ref = taken === undefined ? undefined : intelCase.observations[rows.indexOf(taken)]?.ref;
  return intelCase.truth !== null && ref === intelCase.truth ? 'true' : 'false';
}

/** The corpus graded with the rules alone, or with `answers` for the cases the model would be asked about. */
export async function scoreCorpus(
  answers?: Answers,
  cases: readonly IntelCase[] = readIntelCorpus(),
): Promise<IntelScore> {
  let [asked, answered, verifiedTrue, verifiedFalse] = [0, 0, 0, 0];
  for (const intelCase of cases) {
    const ask = await askedOf(intelCase);
    if (ask !== null) asked += 1;
    const scores = ask === null ? undefined : (answers?.(ask.hash) ?? undefined);
    if (scores !== undefined) answered += 1;
    const receipt = await gradeCase(intelCase, scores);
    const said = verdict(intelCase, receipt, ledgerOf(intelCase).rows);
    if (said === 'true') verifiedTrue += 1;
    if (said === 'false') verifiedFalse += 1;
  }
  const labelled = cases.filter(({ truth }) => truth !== null).length;
  const verified = verifiedTrue + verifiedFalse;
  return {
    cases: cases.length,
    labelled,
    asked,
    answered,
    verifiedTrue,
    verifiedFalse,
    precision: verified === 0 ? null : verifiedTrue / verified,
    recall: labelled === 0 ? 0 : verifiedTrue / labelled,
  };
}

/** A recording of a model's answers to the corpus's asked inputs (bench/fixtures/intel/, written by its recorders). */
export const IntelRecording = z.strictObject({
  note: z.string().min(1),
  provider: z.enum(['builtin', 'byo']),
  /** The model that answered, as its provider names it. */
  model: z.string().min(1).max(120),
  recordedAt: IsoTs,
  /** Each asked input's hash → the scores the model gave, in basis points; null when it gave none in time. */
  answers: z.record(z.string().regex(/^[0-9a-f]{64}$/u), ModelScores.nullable()),
});
export type IntelRecording = z.infer<typeof IntelRecording>;
