/**
 * The paste parser on its labelled corpus (./paste-corpus.ts; Sprint 3 QA review GAP 11; qa_tester rule 2): every
 * entry, outcome and claim field of every invented log read as labelled.
 */
import { describe, expect, it } from 'vitest';

import { scorePasteCorpus } from './paste-corpus';

describe('the labelled paste corpus', () => {
  it('is read field by field as labelled, in every log', () => {
    const score = scorePasteCorpus();
    expect(score.logs).toBeGreaterThanOrEqual(4);
    expect(score.fields).toBeGreaterThan(100);
    expect(score.wrong).toEqual([]);
  });
});
