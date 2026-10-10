/**
 * Chrome's built-in on-device model as the advisory model's provider (sprint_5 5.2; agents/intel_engineer.md rules 4
 * and 5). It is the Prompt API's `LanguageModel`: Chrome 138 and later, in extension pages and service workers, with
 * no permission (checked against the specification's explainer and Chrome's documentation on 2026-10-10, Decisions
 * [5.2]). Its availability is read, never assumed: `unavailable`, `downloadable`, `downloading` or `available`, or no
 * API at all (`no_api`). Each call creates a session with the constant system prompt (../prompt.ts), prompts it with
 * the input's data block, holds the answer to the output's JSON Schema (../schema.ts), and destroys the session. The
 * answer is parsed as JSON; text that is not JSON is passed on as it is, which the caller reads as no answer. All of
 * it runs on this device: nothing is sent anywhere (Hard Rule 1).
 */
import type { IntelProvider } from '..';
import { dataBlock, SYSTEM_PROMPT } from '../prompt';
import { INTEL_OUTPUT_JSON_SCHEMA } from '../schema';

export type PromptAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
export type BuiltinAvailability = PromptAvailability | 'no_api';

/** The language of Attest's prompt and data, so Chrome can say whether its model reads it. */
const LANGUAGES = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
} as const;

type Languages = typeof LANGUAGES;

export interface PromptSession {
  prompt(input: string, options: { signal: AbortSignal; responseConstraint: object }): Promise<string>;
  destroy(): void;
}

/** What `create()` reports while Chrome downloads its model: the fraction loaded, from 0 to 1. */
export interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { readonly loaded: number }) => void): void;
}

/** The part of the Prompt API Attest uses. */
export interface PromptApi {
  availability(options: Languages): Promise<PromptAvailability>;
  create(
    options: Languages & {
      readonly initialPrompts?: readonly { readonly role: 'system'; readonly content: string }[];
      readonly signal?: AbortSignal;
      readonly monitor?: (monitor: DownloadMonitor) => void;
    },
  ): Promise<PromptSession>;
}

/** This context's Prompt API, or null where Chrome has none. */
export function promptApi(scope: object = globalThis): PromptApi | null {
  const api: unknown = Reflect.get(scope, 'LanguageModel');
  if ((typeof api !== 'function' && typeof api !== 'object') || api === null) return null;
  return typeof Reflect.get(api, 'availability') === 'function' &&
    typeof Reflect.get(api, 'create') === 'function'
    ? (api as PromptApi)
    : null;
}

/** Whether Chrome's model can run Attest's prompt here (header); a check that fails reads as `unavailable`. */
export async function builtinAvailability(api: PromptApi | null): Promise<BuiltinAvailability> {
  if (api === null) return 'no_api';
  try {
    return await api.availability(LANGUAGES);
  } catch {
    return 'unavailable';
  }
}

/** The answer as JSON, or the text itself when it is not JSON (the caller reads that as no answer). */
function parsedOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The built-in model as a provider (header): one session per call, destroyed after it. */
export function builtinProvider(api: PromptApi): IntelProvider {
  return {
    id: 'builtin',
    async score(input, signal) {
      const initialPrompts = [{ role: 'system', content: SYSTEM_PROMPT }] as const;
      const session = await api.create({ ...LANGUAGES, initialPrompts, signal });
      try {
        const text = await session.prompt(dataBlock(input), {
          signal,
          responseConstraint: INTEL_OUTPUT_JSON_SCHEMA,
        });
        return parsedOrText(text);
      } finally {
        session.destroy();
      }
    },
  };
}

/**
 * Asks Chrome to download its model (`create()`, which downloads it first), reporting progress from 0 to 1. Chrome
 * downloads only in answer to a person's click, so it is called from one; the session made is destroyed at once.
 */
export async function downloadBuiltin(api: PromptApi, onProgress: (loaded: number) => void): Promise<void> {
  const session = await api.create({
    ...LANGUAGES,
    monitor: (monitor) => {
      monitor.addEventListener('downloadprogress', ({ loaded }) => {
        onProgress(loaded);
      });
    },
  });
  session.destroy();
}
