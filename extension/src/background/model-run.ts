/**
 * The model runs in progress (./intel.ts; Sprint 5 close, security review SEC-2; Hard Rule 1). A run asks about its
 * claims one at a time, and a person may turn a model off, save another key or forget theirs while it does: nothing may
 * be sent after that. So saving or forgetting the key and switching either model (./byo.ts, ./flags.ts) stop every run
 * at once: the call in flight is aborted (src/intel/index.ts `scoresFor`) and the run asks no other claim. The run also
 * reads the person's switch again before each claim, so a run that began after a stop and before the switch was stored
 * still ends.
 */

const runs = new Set<AbortController>();

/** A new run (header): its signal aborts when the runs are stopped. `endModelRun` forgets it. */
export function startModelRun(): AbortController {
  const run = new AbortController();
  runs.add(run);
  return run;
}

/** Forgets `run`, which has ended. */
export function endModelRun(run: AbortController): void {
  runs.delete(run);
}

/** Stops every run in progress (header). */
export function stopModelRuns(): void {
  for (const run of runs) run.abort();
  runs.clear();
}
