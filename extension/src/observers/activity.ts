/**
 * The coverage ping's user-activity flag (sprint_2 2.0; Sprint 3.5 builds idle intervals on it).
 *
 * `active()` is true when the tab is visible and the user pressed a key, pointed, scrolled or touched in it within
 * the last `windowMs`. Listening is not acting (Hard Rule 3): the listeners are passive, read nothing from the event
 * but `isTrusted` (not the key, not the target, not the position), never call `preventDefault`, and keep one number,
 * the instant of the last trusted input, noted at most once per `throttleMs`. A page script's synthetic events do
 * not count as the user. `false` means "no input seen here", never "the user is idle": idle evidence must be
 * positive (docs/grading.md §7).
 */
import { USER_ACTIVE_WINDOW_MS, USER_ACTIVITY_THROTTLE_MS } from '../config';
import { instantMs } from '../core/normalize';
import { SYSTEM_TIMERS, type TimerHandle, type Timers } from './batch';

/** Input a person makes. Never `click` or `input`: those also fire for keyboard and scripted activation. */
export const USER_INPUT_EVENTS = Object.freeze([
  'keydown',
  'pointerdown',
  'pointermove',
  'wheel',
  'touchstart',
]);

const LISTENER_OPTIONS: AddEventListenerOptions = Object.freeze({ capture: true, passive: true });

export interface UserActivity {
  readonly active: () => boolean;
  readonly disconnect: () => void;
}

export interface ActivityOptions {
  /** The clock (src/clock.ts nowIso): ISO 8601 with offset. */
  readonly now: () => string;
  readonly timers?: Timers;
  readonly windowMs?: number;
  readonly throttleMs?: number;
  /** Whether an event is the user's own input (default: `event.isTrusted`). Injected for tests only. */
  readonly isUserInput?: (event: Event) => boolean;
}

const trusted = (event: Event): boolean => event.isTrusted;

/** Tracks input in `view` (the content script's window, which shares the page's DOM events). */
export function trackUserActivity(view: Window, options: ActivityOptions): UserActivity {
  const timers = options.timers ?? SYSTEM_TIMERS;
  const windowMs = options.windowMs ?? USER_ACTIVE_WINDOW_MS;
  const throttleMs = options.throttleMs ?? USER_ACTIVITY_THROTTLE_MS;
  const isUserInput = options.isUserInput ?? trusted;
  let lastInputMs: number | null = null;
  let rearm: TimerHandle | null = null;

  const noteInput = (event: Event): void => {
    if (rearm !== null || !isUserInput(event)) return;
    lastInputMs = instantMs(options.now());
    rearm = timers.setTimeout(() => {
      rearm = null;
    }, throttleMs);
  };
  for (const type of USER_INPUT_EVENTS) view.addEventListener(type, noteInput, LISTENER_OPTIONS);

  return Object.freeze({
    active: (): boolean => {
      if (view.document.visibilityState !== 'visible' || lastInputMs === null) return false;
      return instantMs(options.now()) - lastInputMs <= windowMs;
    },
    disconnect: (): void => {
      for (const type of USER_INPUT_EVENTS) view.removeEventListener(type, noteInput, LISTENER_OPTIONS);
      if (rearm !== null) timers.clearTimeout(rearm);
      rearm = null;
    },
  });
}
