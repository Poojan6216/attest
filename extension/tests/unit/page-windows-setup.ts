/**
 * Lets the page windows a test closed finish closing (CI run 37652047432): a setup file of the main run
 * (vitest.config.ts), so of the observer-coverage run too; the poisoned run parses no page.
 *
 * happy-dom finishes `happyDOM.close()` on a 1 ms timer, and until that timer fires the window, and every page parsed
 * in it, stay reachable. Synchronous tests run back to back with no timer turn between them, so the Calendar tests
 * kept every real page they parsed alive at once, and a CI worker ran out of its 2 GB heap (vitest.config.ts
 * TEST_WORKER_HEAP_MB). After each test this waits one real timer turn, by which every timer already due has fired.
 * It reads and changes nothing.
 */
import { afterEach } from 'vitest';

/** The real timer, taken before any test can fake it (happy-dom took its own the same way). */
const realSetTimeout = globalThis.setTimeout;

/** Resolves after a real timer of `ms` fires: every timer due before it has fired first. */
export function timerTurn(ms = 2): Promise<void> {
  return new Promise((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

afterEach(async () => {
  await timerTurn();
});
