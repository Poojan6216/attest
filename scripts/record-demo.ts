/**
 * `pnpm record-demo` (sprint_7 7.3): the build_spec §2 demo as launch/demo.gif, 1280×800, six captioned frames of ten
 * seconds each, sixty seconds in all, with no sound. It builds the extension, has Playwright drive the demo on the built
 * extension and the invented fixture pages (extension/tests/e2e/demo.record.ts, run by
 * extension/playwright.record.config.ts), then has ffmpeg (which must be installed) make the GIF from the frames, with
 * one palette drawn from all six. The frames' folder is deleted after. Every name and address in it is invented.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GIF = path.join(ROOT, 'launch', 'demo.gif');
const FRAMES = 6;
const SECONDS_PER_FRAME = 10;

const frames = mkdtempSync(path.join(os.tmpdir(), 'attest-demo-'));
try {
  execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.record.config.ts', 'tests/e2e/demo.record.ts'],
    {
      cwd: path.join(ROOT, 'extension'),
      stdio: 'inherit',
      env: { ...process.env, ATTEST_DEMO_FRAMES: frames },
    },
  );
  const made = readdirSync(frames).filter((name) => /^frame-\d\.png$/u.test(name)).length;
  if (made !== FRAMES) throw new Error(`record-demo: ${String(made)} frames made, not ${String(FRAMES)}`);
  execFileSync(
    'ffmpeg',
    [
      ...['-y', '-loglevel', 'error'],
      ...['-framerate', `1/${String(SECONDS_PER_FRAME)}`, '-i', path.join(frames, 'frame-%d.png')],
      ...['-vf', 'split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'],
      ...['-loop', '0', GIF],
    ],
    { stdio: 'inherit' },
  );
  console.log(
    `record-demo: ${path.relative(ROOT, GIF)}, ${String(FRAMES)} frames of ${String(SECONDS_PER_FRAME)} s, ${String(statSync(GIF).size)} bytes`,
  );
} finally {
  rmSync(frames, { recursive: true, force: true });
}
