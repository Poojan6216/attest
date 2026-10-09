/**
 * Field accuracy of the paste parser (src/adapters/paste.ts; Sprint 3 QA review GAP 11; qa_tester rule 2; Hard Rule
 * 12): every labelled log of tests/fixtures/paste read as the side panel reads it, and every entry, outcome and claim
 * field compared with its label (extension/tests/unit/adapters/paste-corpus.ts). The gate (`pasteGatePassed`): at
 * least `PASTE_ACCURACY_GATE` of the fields read as labelled, the bar the Gmail Sent reader keeps. Corpus honesty:
 * every log is invented, since no vendor's page may be read (Decisions [3.10]), and the result says so.
 */
import { scorePasteCorpus } from '../../extension/tests/unit/adapters/paste-corpus';
import type { MetricValue } from '../results';

/** The bar: the share of labelled fields the parser reads as labelled. */
export const PASTE_ACCURACY_GATE = 0.95;

export function runPasteBench(): Promise<Readonly<Record<string, MetricValue>>> {
  const score = scorePasteCorpus();
  const accuracy = score.fields === 0 ? 0 : score.right / score.fields;
  return Promise.resolve({
    pasteLogs: score.logs,
    pasteFields: score.fields,
    pasteFieldAccuracy: Math.round(accuracy * 10_000) / 10_000,
    pasteAccuracyThreshold: PASTE_ACCURACY_GATE,
    pasteCorpusInvented: true,
    pasteGatePassed: score.fields > 0 && accuracy >= PASTE_ACCURACY_GATE,
  });
}
