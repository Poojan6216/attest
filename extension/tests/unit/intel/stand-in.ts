/**
 * A stand-in for Chrome's Prompt API (src/intel/providers/builtin.ts `PromptApi`), for the built-in model's tests: it
 * reports the availability it is given (changeable, as a download would change it), and records every session it
 * creates, the system prompt and languages each was given, each prompt and its constraint, and each session destroyed.
 * Each prompt is answered by `answer`, which the test sets.
 */
import type { DownloadMonitor, PromptApi, PromptAvailability } from '../../../src/intel/providers/builtin';

export interface StandIn {
  readonly api: PromptApi;
  availability: PromptAvailability;
  answer: (prompt: string, signal: AbortSignal) => Promise<string>;
  readonly created: unknown[];
  readonly prompts: string[];
  readonly constraints: unknown[];
  destroyed: number;
  /** Set during a create that downloads: reports progress as Chrome would. */
  progress?: (loaded: number) => void;
}

export function standIn(availability: PromptAvailability): StandIn {
  const stand: StandIn = {
    availability,
    answer: () => Promise.resolve('{"scores":[]}'),
    created: [],
    prompts: [],
    constraints: [],
    destroyed: 0,
    api: {
      availability: () => Promise.resolve(stand.availability),
      create: (options) => {
        stand.created.push(options);
        const listeners: ((event: { readonly loaded: number }) => void)[] = [];
        const monitor: DownloadMonitor = {
          addEventListener: (_type, listener) => listeners.push(listener),
        };
        options.monitor?.(monitor);
        stand.progress = (loaded) => {
          for (const listener of listeners) listener({ loaded });
        };
        return Promise.resolve({
          prompt: (text, { signal, responseConstraint }) => {
            stand.prompts.push(text);
            stand.constraints.push(responseConstraint);
            return stand.answer(text, signal);
          },
          destroy: () => {
            stand.destroyed += 1;
          },
        });
      },
    },
  };
  return stand;
}

/** An answer scoring every candidate of the prompt's data block `score`, as a model held to the schema would. */
export function scoringAll(score: number): (prompt: string) => Promise<string> {
  return (prompt) => {
    const json = prompt.split('\n')[1] ?? '{}';
    const { candidates } = JSON.parse(json) as { candidates: { id: string }[] };
    return Promise.resolve(
      JSON.stringify({ scores: candidates.map(({ id }) => ({ candidateId: id, score })) }),
    );
  };
}
