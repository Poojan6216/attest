/**
 * A module core-poison.spec.ts's negative controls count as src/core (FR3-1, FR3-3). It is imported only after their
 * guard is installed, and does what the verifier's probes did: it captures the clock and the host's time-zone offset
 * when it loads and calls them later, reads the clock while it loads (and swallows the error), and replaces the
 * built-ins a stack-reading guard relies on. Each must still be caught.
 */

/** Captured when this module loads, as zz-q01 and zz-q02 did: the twins, because the guard came first. */
const CLOCK = Date.now;
const OFFSET: unknown = Reflect.get(Date.prototype, 'getTimezoneOffset');

/** The clock read while this module loads, the error swallowed: the guard records it all the same. */
export const LOADED_AT = ((): number => {
  try {
    return Date.now();
  } catch {
    return -1;
  }
})();

/** The clock captured at load, called now. */
export function capturedClock(): number {
  return CLOCK();
}

/** The host's offset, through the method captured at load. */
export function capturedOffset(ms: number): number {
  if (typeof OFFSET !== 'function') return Number.NaN;
  const offset: unknown = Reflect.apply(OFFSET, new Date(ms), []);
  return typeof offset === 'number' ? offset : Number.NaN;
}

/** The clock handed to `wrap` `depth` times over (a dependency's deep call chain), then called through it. */
export function clockThrough(wrap: (inner: () => number) => () => number, depth: number): number {
  let clock: () => number = Date.now;
  for (let i = 0; i < depth; i += 1) clock = wrap(clock);
  return clock();
}

/** The clock, looked up when called. */
export function liveClock(): number {
  return Date.now();
}

/**
 * Replaces what a stack-reading guard reads callers with (zz-r06, zz-s01) and changes two built-ins (zz-r01): every
 * captured stack is empty, every stack limit 0, every file name looks like a dependency. The caller puts them back.
 */
export function blindTheGuard(): void {
  Reflect.set(Error, 'captureStackTrace', (): undefined => undefined);
  Reflect.set(Error, 'prepareStackTrace', (): unknown[] => []);
  Reflect.set(Error, 'stackTraceLimit', 0);
  Reflect.set(String.prototype, 'startsWith', (): boolean => false);
  Reflect.set(String.prototype, 'includes', (): boolean => true);
  Reflect.defineProperty(Array.prototype, 'probe', { value: 1, configurable: true });
}
