/**
 * Batching DOM changes into passes (sprint_2 2.0). A Gmail or Calendar page changes constantly; reading it on every
 * mutation would be wasteful, and reading it only when it goes quiet would never read a page that never does.
 *
 * `createBatcher` turns a stream of pokes into flushes: one flush `debounceMs` after the last poke, and never later
 * than `maxWaitMs` after the first poke of a burst. Timers are injected (`SYSTEM_TIMERS` reads the global ones at
 * call time, so Vitest's fake timers drive it). `watchMutations` pokes on every DOM mutation under a node.
 *
 * Read-only (Hard Rule 3): a MutationObserver only listens. Nothing here reads a mutation record, writes the DOM or
 * dispatches anything, so a pass can never trigger itself.
 */
import { ObserverError } from './errors';

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface Timers {
  readonly setTimeout: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimeout: (handle: TimerHandle) => void;
}

/** The global timers, looked up on every call (not captured at import), so fake timers installed later apply. */
export const SYSTEM_TIMERS: Timers = Object.freeze({
  setTimeout: (callback: () => void, ms: number): TimerHandle => setTimeout(callback, ms),
  clearTimeout: (handle: TimerHandle): void => {
    clearTimeout(handle);
  },
});

export interface BatchOptions {
  /** Quiet time after the last poke before a flush. */
  readonly debounceMs: number;
  /** Longest time from the first poke of a burst to its flush, however often it is poked. */
  readonly maxWaitMs: number;
  readonly timers?: Timers;
}

export interface Batcher {
  /** Something changed: flush after the debounce, or at the max wait, whichever comes first. */
  readonly poke: () => void;
  /** Drops a pending flush. A later poke starts a new burst. */
  readonly cancel: () => void;
}

/**
 * Throws `ObserverError('invalid_options')` unless both are positive integers with `debounceMs ≤ maxWaitMs`.
 * `createBatcher` runs it; `startObserver` runs it first, before it attaches any listener.
 */
export function checkOptions(options: Pick<BatchOptions, 'debounceMs' | 'maxWaitMs'>): void {
  const { debounceMs, maxWaitMs } = options;
  const valid =
    Number.isSafeInteger(debounceMs) &&
    Number.isSafeInteger(maxWaitMs) &&
    debounceMs > 0 &&
    maxWaitMs >= debounceMs;
  if (!valid) throw new ObserverError('invalid_options');
}

/**
 * Calls `flush` once per burst of pokes: `debounceMs` after the last poke, or `maxWaitMs` after the first, whichever
 * is earlier. A poke during `flush` starts the next burst. Throws `ObserverError('invalid_options')` unless both
 * are positive integers with `debounceMs ≤ maxWaitMs`.
 */
export function createBatcher(flush: () => void, options: BatchOptions): Batcher {
  checkOptions(options);
  const timers = options.timers ?? SYSTEM_TIMERS;
  let debounce: TimerHandle | null = null;
  let maxWait: TimerHandle | null = null;

  const cancel = (): void => {
    if (debounce !== null) timers.clearTimeout(debounce);
    if (maxWait !== null) timers.clearTimeout(maxWait);
    debounce = null;
    maxWait = null;
  };
  const fire = (): void => {
    cancel();
    flush();
  };
  const poke = (): void => {
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = timers.setTimeout(fire, options.debounceMs);
    maxWait ??= timers.setTimeout(fire, options.maxWaitMs);
  };
  return Object.freeze({ poke, cancel });
}

/** What a pass depends on: the tree, text and attributes (the time cell's `title`, a row's `aria-label`). */
export const MUTATION_INIT: MutationObserverInit = Object.freeze({
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
});

export interface MutationWatch {
  readonly disconnect: () => void;
}

/**
 * Calls `onChange` (no arguments: the records are never read) whenever the DOM under `target` changes. Pass the
 * document itself to see a page that replaces its whole body. `Watcher` is injected for tests.
 */
export function watchMutations(
  target: Node,
  onChange: () => void,
  Watcher: typeof MutationObserver = MutationObserver,
  init: MutationObserverInit = MUTATION_INIT,
): MutationWatch {
  const watcher = new Watcher(() => {
    onChange();
  });
  watcher.observe(target, init);
  return Object.freeze({
    disconnect: (): void => {
      watcher.disconnect();
    },
  });
}
