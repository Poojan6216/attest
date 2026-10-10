/**
 * One model call (src/intel/index.ts `modelScores`; sprint_5 5.1, 5.2; agents/intel_engineer.md rule 4): an answer
 * becomes scores; a provider that throws, one slower than the time allowed, and an answer that is no answer each give
 * none, never throw, and are logged by provider and kind only, never with the input or the answer (Hard Rules 6, 10).
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Claim, Observation } from '../../../src/core/schema';
import { type IntelProvider, modelScores } from '../../../src/intel';
import { type LogRecord, setLogSink } from '../../../src/log';
import { makeClaim, makeObservation } from '../ledger/fixtures';

const CLAIM = Claim.parse(makeClaim({ subjectHint: 'Quarterly numbers' }));
const CANDIDATE = Observation.parse(makeObservation({}));
let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  records = [];
  restore = setLogSink((record) => records.push(record));
});
afterEach(() => {
  restore();
});

const answering = (answer: () => Promise<unknown>): IntelProvider => ({ id: 'byo', score: answer });
const logged = () => records.map(({ level, event, fields }) => [level, event, fields.provider]);

describe('modelScores', () => {
  it('gives the scores of a valid answer', async () => {
    const provider = answering(() =>
      Promise.resolve({ scores: [{ candidateId: CANDIDATE.id, score: 0.9 }] }),
    );
    expect(await modelScores(provider, CLAIM, [CANDIDATE])).toEqual([
      { observationId: CANDIDATE.id, score: 9_000 },
    ]);
    expect(records).toEqual([]);
  });

  it('gives none for a provider slower than the time allowed, and aborts it', async () => {
    let aborted = false;
    const slow: IntelProvider = {
      id: 'builtin',
      score: (_input, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve({ scores: [] });
          });
        }),
    };
    expect(await modelScores(slow, CLAIM, [CANDIDATE], 20)).toBeUndefined();
    expect(aborted).toBe(true);
    expect(logged()).toEqual([['warn', 'intel.timeout', 'builtin']]);
  });

  it('gives none for a provider that throws, and for an answer that is no answer', async () => {
    expect(
      await modelScores(
        answering(() => Promise.reject(new Error('quota: sk-test-123'))),
        CLAIM,
        [CANDIDATE],
      ),
    ).toBeUndefined();
    expect(
      await modelScores(
        answering(() => Promise.resolve('VERIFIED')),
        CLAIM,
        [CANDIDATE],
      ),
    ).toBeUndefined();
    expect(logged()).toEqual([
      ['warn', 'intel.failed', 'byo'],
      ['warn', 'intel.answer_invalid', 'byo'],
    ]);
    expect(JSON.stringify(records)).not.toContain('sk-test-123');
  });

  it('gives none, without asking, for a claim with no candidate', async () => {
    let asked = false;
    const provider = answering(() => {
      asked = true;
      return Promise.resolve({ scores: [] });
    });
    expect(await modelScores(provider, CLAIM, [])).toBeUndefined();
    expect(asked).toBe(false);
  });
});
