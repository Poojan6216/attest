/**
 * The advisory model behind one call (sprint_5 5.1; agents/intel_engineer.md rules 1, 3 and 4). A provider, the
 * built-in on-device model or the person's own key (./providers), is given one claim's input (./input.ts), and its
 * answer becomes model scores for the grading context (./schema.ts `scoresOf`; docs/grading.md §5.4) or nothing. The
 * model proposes; `grade()` decides (Hard Rule 4). Failure is silent to the person and loud in the log: a provider
 * that throws or refuses, an answer later than INTEL_TIMEOUT_MS, or an answer that is not an `IntelOutput` for this
 * input gives no score, and the claim is graded rules-only (Hard Rule 6). The log names the provider and what went
 * wrong, never the input, the answer or an error's text (Hard Rule 10).
 */
import { INTEL_TIMEOUT_MS } from '../config';
import type { Claim, Observation } from '../core/schema';
import { log } from '../log';
import { buildInput, type IntelInput } from './input';
import { type ModelScores, scoresOf } from './schema';

export type IntelProviderId = 'builtin' | 'byo';

/** One way to ask the model. Its answer is parsed by the caller; `signal` aborts once the time is up. */
export interface IntelProvider {
  readonly id: IntelProviderId;
  score(input: IntelInput, signal: AbortSignal): Promise<unknown>;
}

const TIMED_OUT = Symbol('timed out');

/**
 * The model scores `provider` gives `claim`'s `candidates` (header), or undefined when it gives none: it threw, it took
 * longer than `timeoutMs`, or its answer was not one. Never throws; never blocks longer than `timeoutMs`.
 */
export async function modelScores(
  provider: IntelProvider,
  claim: Claim,
  candidates: readonly Observation[],
  timeoutMs: number = INTEL_TIMEOUT_MS,
): Promise<ModelScores | undefined> {
  let input: IntelInput;
  try {
    input = buildInput(claim, candidates);
  } catch (error) {
    log.warn('intel.failed', { provider: provider.id, error });
    return undefined;
  }
  return scoresFor(provider, input, timeoutMs);
}

/** `modelScores` for an input already built (the dev model check scores its own; entrypoints/model-check). */
export async function scoresFor(
  provider: IntelProvider,
  input: IntelInput,
  timeoutMs: number = INTEL_TIMEOUT_MS,
): Promise<ModelScores | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    const answer = await Promise.race([provider.score(input, controller.signal), late]);
    if (answer === TIMED_OUT) {
      controller.abort();
      log.warn('intel.timeout', { provider: provider.id });
      return undefined;
    }
    const scores = scoresOf(answer, input);
    if (scores === null) log.warn('intel.answer_invalid', { provider: provider.id });
    return scores ?? undefined;
  } catch (error) {
    log.warn('intel.failed', { provider: provider.id, error });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
