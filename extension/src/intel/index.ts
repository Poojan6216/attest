/**
 * The advisory model behind one call (sprint_5 5.1; agents/intel_engineer.md rules 1, 3 and 4). A provider, the
 * built-in on-device model or the person's own key (./providers), is given one claim's input (./input.ts), and its
 * answer becomes model scores for the grading context (./schema.ts `scoresOf`; docs/grading.md §5.4) or nothing. The
 * model proposes; `grade()` decides (Hard Rule 4). Failure is silent to the person and loud in the log: a provider
 * that throws or refuses, an answer later than INTEL_TIMEOUT_MS, or an answer that is not an `IntelOutput` for this
 * input gives no score, and the claim is graded rules-only (Hard Rule 6). The log names the provider and what went
 * wrong, never the input, the answer or an error's text (Hard Rule 10).
 */
import { INTEL_TIMEOUT_MS, type MODEL_PROVIDERS } from '../config';
import type { Claim, Observation } from '../core/schema';
import { log } from '../log';
import { buildInput, type IntelInput } from './input';
import { type ModelScores, scoresOf } from './schema';

export type IntelProviderId = (typeof MODEL_PROVIDERS)[number];

/** One way to ask the model. Its answer is parsed by the caller; `signal` aborts once the time is up. */
export interface IntelProvider {
  readonly id: IntelProviderId;
  score(input: IntelInput, signal: AbortSignal): Promise<unknown>;
}

const TIMED_OUT = Symbol('timed out');
const STOPPED = Symbol('stopped');

/**
 * `claim`'s input for `candidates` (./input.ts), or undefined, logged by provider, when it cannot be built. Never
 * throws. The service worker builds every input it asks with this (src/background/intel.ts; tech review TECH-7).
 */
export function inputFor(
  provider: IntelProvider,
  claim: Claim,
  candidates: readonly Observation[],
): IntelInput | undefined {
  try {
    return buildInput(claim, candidates);
  } catch (error) {
    log.warn('intel.failed', { provider: provider.id, error });
    return undefined;
  }
}

/**
 * `modelScores` for an input already built (the dev model check scores its own; entrypoints/model-check). `stop` ends
 * the call at once, as the time limit does, when the person turns the model off or changes the key
 * (src/background/model-run.ts): the provider's signal is aborted, its answer never counts, and nothing is asked when
 * `stop` has already fired.
 */
export async function scoresFor(
  provider: IntelProvider,
  input: IntelInput,
  timeoutMs: number = INTEL_TIMEOUT_MS,
  stop?: AbortSignal,
): Promise<ModelScores | undefined> {
  if (stop?.aborted === true) return undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onStop: (() => void) | undefined;
  const ended = new Promise<typeof TIMED_OUT | typeof STOPPED>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, timeoutMs);
    onStop = () => {
      resolve(STOPPED);
    };
    stop?.addEventListener('abort', onStop, { once: true });
  });
  try {
    const answer = await Promise.race([provider.score(input, controller.signal), ended]);
    if (answer === TIMED_OUT || answer === STOPPED) {
      controller.abort();
      if (answer === TIMED_OUT) log.warn('intel.timeout', { provider: provider.id });
      else log.warn('intel.stopped', { provider: provider.id });
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
    if (onStop !== undefined) stop?.removeEventListener('abort', onStop);
  }
}
