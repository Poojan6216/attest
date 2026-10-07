/**
 * A test's pages do not outlive it (CI run 37652047432: a worker ran out of its 2 GB heap on the Calendar tests).
 * happy-dom keeps a page alive until the window it was parsed in has closed, and finishes a close on a 1 ms timer
 * that synchronous tests, run back to back, never give a turn. So the Calendar helper parses each page in a window
 * of its own and closes it at once, every test ends with one real timer turn (./page-windows-setup.ts), and every run
 * gives each worker CI's heap, so a test that holds too much memory fails on the Mac as it does in CI.
 */
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';

import vitestConfig, { TEST_WORKER_EXEC_ARGV, TEST_WORKER_HEAP_MB } from '../../vitest.config';
import observersConfig from '../../vitest.observers.config';
import perfConfig from '../../vitest.perf.config';
import poisonConfig from '../../vitest.poison.config';
import { parseDocument } from './observers/gcal/gcal-fixtures';
import { timerTurn } from './page-windows-setup';

// The configs only (tests/unit/test-layout.spec.ts): WXT's Vitest plugin would import WXT's uninstalled `web-ext`.
vi.mock('wxt/testing/vitest-plugin', () => ({ WxtVitest: () => ({ name: 'wxt-vitest-stub' }) }));

const PAGE_WINDOWS_SETUP = 'tests/unit/page-windows-setup.ts';

describe('a parsed page does not outlive its test', () => {
  it('the Calendar helper closes the window a page was parsed in, and the page stays readable', () => {
    const doc = parseDocument('<main><div data-eventid="e1">Event</div></main>');
    expect((doc.defaultView as { readonly closed?: boolean } | null)?.closed).toBe(true);
    expect(doc.querySelector('[data-eventid]')?.textContent).toBe('Event');
  });

  it('one timer turn finishes a close that microtasks alone never finish', async () => {
    const window = new Window();
    let closed = false;
    void window.happyDOM.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await timerTurn();
    expect(closed).toBe(true);
  });
});

describe("every run gives a worker CI's heap, and the page runs end each test with a timer turn", () => {
  it('pins 2,048 MB in the main, observer, poisoned and perf runs', () => {
    expect(TEST_WORKER_HEAP_MB).toBe(2048);
    expect(TEST_WORKER_EXEC_ARGV).toEqual(['--max-old-space-size=2048']);
    for (const config of [vitestConfig, observersConfig, poisonConfig, perfConfig])
      expect(config.test?.execArgv).toEqual(TEST_WORKER_EXEC_ARGV);
  });

  it('the main and observer runs load the setup file that waits the timer turn', () => {
    expect(vitestConfig.test?.setupFiles).toContain(PAGE_WINDOWS_SETUP);
    expect(observersConfig.test?.setupFiles).toContain(PAGE_WINDOWS_SETUP);
  });
});
