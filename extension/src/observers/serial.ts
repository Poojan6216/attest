/**
 * One pass at a time, per observer (docs/grading.md §3; sprint_2 2.7 carry-forward). An observer sends its next pass
 * only after every message of the previous one was answered by the background, so it never sends a sighting earlier
 * than a row the ledger already stored from it (which the ledger would refuse as `late_sighting`).
 *
 * `request()` while a pass runs does not start a second one: it marks one more pass as due, which starts when the
 * current one settles. Any number of requests during one pass coalesce into that one follow-up pass, which reads
 * the page as it is then.
 */

export interface SerialRunner {
  /** A pass is due: run one now, or once the running pass settles. Ignored after `halt()`. */
  readonly request: () => void;
  /** Settles when no pass is running or due. */
  readonly idle: () => Promise<void>;
  /** No pass starts after this; a running one finishes. */
  readonly halt: () => void;
}

/**
 * Runs `run` serially on request. `run` must not reject (the skeleton's pass turns every failure into a DEGRADED
 * health report); if it does anyway, the rejection surfaces from `idle()` and the next request starts afresh.
 */
export function serialRunner(run: () => Promise<unknown>): SerialRunner {
  let running: Promise<void> | null = null;
  let due = false;
  let halted = false;

  const loop = async (): Promise<void> => {
    try {
      while (due && !halted) {
        due = false;
        await run();
      }
    } finally {
      running = null;
    }
  };
  const request = (): void => {
    if (halted) return;
    due = true;
    running ??= loop();
  };
  return Object.freeze({
    request,
    idle: (): Promise<void> => running ?? Promise.resolve(),
    halt: (): void => {
      halted = true;
    },
  });
}
