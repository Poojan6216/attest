import { useState } from 'preact/hooks';

import { nowIso } from '../../src/clock';
import { type BuiltinAvailability, builtinProvider, type PromptApi } from '../../src/intel/providers/builtin';
import { BENCH_INPUTS, recordBench, recordingOf } from './record';

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
export function BenchRecord({
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
