/**
 * src/observers/serial.ts (docs/grading.md §3; sprint_2 2.7 carry-forward): one pass at a time per observer. The
 * next pass starts only after the previous one settled (every message answered), and requests made during a pass
 * coalesce into one follow-up pass.
 */
import { describe, expect, it } from 'vitest';

import { serialRunner } from '../../../src/observers/serial';

/** A pass that stays open until the test releases it. */
function gatedRun(): { run: () => Promise<void>; started: number[]; release: () => void } {
  const started: number[] = [];
  const gates: (() => void)[] = [];
  return {
    started,
    run: () => {
      started.push(started.length);
      return new Promise<void>((resolve) => gates.push(resolve));
    },
    release: () => {
      gates.shift()?.();
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('serialRunner', () => {
  it('runs a pass on request, and settles when it is done', async () => {
    const gated = gatedRun();
    const runner = serialRunner(gated.run);
    await runner.idle();
    runner.request();
    expect(gated.started).toEqual([0]);
    gated.release();
    await runner.idle();
    expect(gated.started).toEqual([0]);
  });

  it('never runs two passes at once; requests during a pass coalesce into one follow-up', async () => {
    const gated = gatedRun();
    const runner = serialRunner(gated.run);
    runner.request();
    runner.request();
    runner.request();
    await tick();
    expect(gated.started).toEqual([0]);
    gated.release();
    await tick();
    expect(gated.started).toEqual([0, 1]);
    gated.release();
    await runner.idle();
    expect(gated.started).toEqual([0, 1]);
  });

  it('starts no pass after halt; a running one finishes', async () => {
    const gated = gatedRun();
    const runner = serialRunner(gated.run);
    runner.request();
    runner.request();
    runner.halt();
    runner.request();
    gated.release();
    await runner.idle();
    expect(gated.started).toEqual([0]);
  });

  it('a pass that rejects surfaces from idle(), and the next request starts afresh', async () => {
    let calls = 0;
    const runner = serialRunner(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('pass failed')) : Promise.resolve();
    });
    runner.request();
    await expect(runner.idle()).rejects.toThrow('pass failed');
    runner.request();
    await runner.idle();
    expect(calls).toBe(2);
  });
});
