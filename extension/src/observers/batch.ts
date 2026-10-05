/**
 * Batching DOM changes into passes (sprint_2 2.0). A Gmail or Calendar page changes constantly; reading it on every
 * mutation would be wasteful, and reading it only when it goes quiet would never read a page that never does.
 *
 * `createBatcher` turns a stream of pokes into flushes: one flush `debounceMs` after the last poke, and never later
 * than `maxWaitMs` after the first poke of a burst. Timers are injected (`SYSTEM_TIMERS` reads the global ones at
 * call time, so Vitest's fake timers drive it). `watchMutations` pokes on every DOM mutation under a node that its
 * init names: one watcher per content script, over the attributes its observers read (`watchedInit`, TECH-2).
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

/**
 * What a pass depends on: the tree, text and attributes (the time cell's `title`, a row's `aria-label`). Every
 * attribute, when not every observer of the content script says which ones it reads (`watchedInit`).
 */
export const MUTATION_INIT: MutationObserverInit = Object.freeze({
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
});

/**
 * The attributes that decide whether an element is drawn, which every observer's shown-view check reads
 * (src/observers/shown.ts: the `hidden` attribute, the inline style, and the computed style the classes give).
 */
export const VIEW_ATTRIBUTES: readonly string[] = Object.freeze(['class', 'hidden', 'style']);

/**
 * What one content script's watcher observes (TECH-2): the tree and the text always, and of the attributes only the
 * ones its observers read (each observer's `attributes`, src/observers/types.ts) plus VIEW_ATTRIBUTES. A page changes
 * other attributes all the time (hover state, focus, `aria-expanded`), and each change made a pass. When any
 * observer does not say which attributes it reads, every attribute is watched (`MUTATION_INIT`): a missed change
 * would leave the ledger without a pass the page called for, never with a wrong one, but nothing is guessed.
 */
export function watchedInit(lists: readonly (readonly string[] | undefined)[]): MutationObserverInit {
  const named: string[] = [];
  for (const list of lists) {
    if (list === undefined) return MUTATION_INIT;
    named.push(...list);
  }
  const attributeFilter = [...new Set([...VIEW_ATTRIBUTES, ...named])].sort();
  return Object.freeze({ childList: true, subtree: true, characterData: true, attributeFilter });
}

/** An attribute name in a CSS selector: what follows `[` up to the operator or `]`. */
const SELECTOR_ATTRIBUTE = /\[\s*([A-Za-z_][\w:.-]*)/g;

/**
 * Every attribute name the CSS selectors match on (`[role="main"]` → `role`), for an observer's `attributes`: a
 * change to one of them can change what its selectors find.
 */
export function selectorAttributes(selectors: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const selector of selectors) {
    for (const match of selector.matchAll(SELECTOR_ATTRIBUTE))
      if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

export interface MutationWatch {
  readonly disconnect: () => void;
}

/**
 * Calls `onChange` (no arguments: the records are never read) whenever the DOM under `target` changes as `init`
 * says. Pass the document itself to see a page that replaces its whole body. `Watcher` is injected for tests.
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
