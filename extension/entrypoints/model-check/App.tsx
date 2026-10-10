import { useEffect, useState } from 'preact/hooks';

import { scoresFor } from '../../src/intel';
import {
  type BuiltinAvailability,
  builtinAvailability,
  builtinProvider,
  type PromptApi,
  promptApi,
} from '../../src/intel/providers/builtin';
import type { ModelScores } from '../../src/intel/schema';
import { nowIso } from '../../src/clock';
import { CHECK_INPUTS } from './inputs';
import { BENCH_INPUTS, recordBench, recordingOf } from './record';

interface Row {
  readonly claim: number;
  /** Undefined when the model gave no answer in time (src/intel/index.ts). */
  readonly scores: ModelScores | undefined;
}

export interface ModelCheckProps {
  /** Chrome's Prompt API; the page's own when absent. */
  readonly api?: () => PromptApi | null;
}

/**
 * The on-device model check (sprint_5 5.2; a development page, never in the store build: wxt.config.ts
 * DEV_ENTRYPOINTS): on a Chrome that has its model, scores the ten check claims (./inputs.ts) through the same provider
 * and call the grading uses, with its time limit, and lists each claim's parsed scores, or "No answer".
 */
export function ModelCheck({ api = promptApi }: ModelCheckProps) {
  const [availability, setAvailability] = useState<BuiltinAvailability | null>(null);
  const [rows, setRows] = useState<readonly Row[]>([]);
  useEffect(() => {
    void builtinAvailability(api()).then(setAvailability);
  }, [api]);
  const run = async (): Promise<void> => {
    const prompt = api();
    if (prompt === null) return;
    const provider = builtinProvider(prompt);
    const done: Row[] = [];
    for (const [index, input] of CHECK_INPUTS.entries()) {
      done.push({ claim: index + 1, scores: await scoresFor(provider, input) });
      setRows([...done]);
    }
  };
  return (
    <main class="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 class="text-2xl font-semibold">Attest model check</h1>
      <p role="status">Chrome’s on-device model: {availability ?? 'checking'}.</p>
      <button
        type="button"
        class="rounded border border-rule px-3 py-1"
        disabled={availability !== 'available'}
        onClick={() => void run()}
      >
        Score the ten check claims
      </button>
      <ol class="space-y-1" aria-label="Scores">
        {rows.map(({ claim, scores }) => (
          <li key={claim}>
            Claim {claim}:{' '}
            {scores === undefined
              ? 'No answer'
              : scores
                  .map(({ observationId, score }) => `${observationId.slice(-4)} ${String(score / 10_000)}`)
                  .join(', ')}
          </li>
        ))}
      </ol>
      <BenchRecord api={api} availability={availability} />
    </main>
  );
}

/** Hands the browser the recording to save (`attest-intel-builtin.json`), at the person's click. */
function saveRecording(file: string): void {
  const url = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attest-intel-builtin.json';
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The bench's recording (sprint_5 5.5; ./record.ts): every bench input asked of the on-device model in turn, then the
 * answers saved as a file at a click, for bench/fixtures/intel/builtin.json (MANUAL.md, Sprint 5).
 */
function BenchRecord({
  api,
  availability,
}: {
  readonly api: () => PromptApi | null;
  readonly availability: BuiltinAvailability | null;
}) {
  const [asked, setAsked] = useState(0);
  const [file, setFile] = useState<string | null>(null);
  const record = async (): Promise<void> => {
    const prompt = api();
    if (prompt === null) return;
    const answers = await recordBench(builtinProvider(prompt), setAsked);
    setFile(recordingOf(answers, nowIso(), navigator.userAgent));
  };
  return (
    <section class="space-y-2" aria-label="Bench recording">
      <button
        type="button"
        class="rounded border border-rule px-3 py-1"
        disabled={availability !== 'available'}
        onClick={() => void record()}
      >
        Record the bench’s answers
      </button>
      <p role="status">{`Asked ${String(asked)} of ${String(BENCH_INPUTS.length)} bench inputs.`}</p>
      {file === null ? null : (
        <button
          type="button"
          class="rounded border border-rule px-3 py-1"
          onClick={() => {
            saveRecording(file);
          }}
        >
          Save the recording
        </button>
      )}
    </section>
  );
}

/** The page's root: the check, on the page's own Prompt API. */
export function App() {
  return <ModelCheck />;
}
