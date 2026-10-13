/**
 * launch/demo.gif (sprint_7 7.3; `pnpm record-demo`, scripts/record-launch.ts): the build_spec §2 demo at 1280×800, six
 * frames of ten seconds, sixty seconds in all, as the README shows it. Read from the GIF's own blocks (the GIF89a
 * format): its logical screen size, and each frame's delay from the graphic control extension before it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const GIF = readFileSync(path.join(REPO_ROOT, 'launch', 'demo.gif'));
const README = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

/** The bytes of the data sub-blocks starting at `at`, skipped: where the block after them starts. */
function skipSubBlocks(at: number): number {
  let next = at;
  for (let size = GIF[next] ?? 0; size !== 0; size = GIF[next] ?? 0) next += size + 1;
  return next + 1;
}

/** Each frame's delay, in hundredths of a second, in order. */
function frameDelays(): number[] {
  const packed = GIF[10] ?? 0;
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  const delays: number[] = [];
  let delay = 0;
  while (at < GIF.length && GIF[at] !== 0x3b) {
    if (GIF[at] === 0x21) {
      if (GIF[at + 1] === 0xf9) delay = GIF.readUInt16LE(at + 4);
      at = skipSubBlocks(at + 2);
    } else if (GIF[at] === 0x2c) {
      const local = GIF[at + 9] ?? 0;
      at += 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0);
      at = skipSubBlocks(at + 1);
      delays.push(delay);
      delay = 0;
    } else {
      throw new Error(`a block of no known kind at byte ${String(at)}`);
    }
  }
  return delays;
}

describe('launch/demo.gif', () => {
  it('is a 1280×800 GIF', () => {
    expect(GIF.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect([GIF.readUInt16LE(6), GIF.readUInt16LE(8)]).toEqual([1280, 800]);
  });

  it('is six frames of ten seconds each: request, claim, Gmail, Calendar, receipts, digest', () => {
    expect(frameDelays()).toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
  });

  it('is in the README, after its opening and before Install', () => {
    const at = README.indexOf('](launch/demo.gif)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(README.indexOf('\n## Install\n'));
  });
});
