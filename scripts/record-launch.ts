/**
 * `pnpm record-demo` and `pnpm record-screenshots` (sprint_7 7.3, 7.4; Sprint 7 close, tech review TECH-7): the launch's
 * pictures, made by Playwright on the built extension and saved test pages with invented names
 * (extension/tests/e2e/demo.record.ts and store-shots.record.ts, run by extension/playwright.record.config.ts), every
 * page checked for seeded secrets and real addresses before its picture (extension/tests/e2e/support/launch-shots.ts).
 *
 * - `demo`: launch/demo.gif, 1280×800, six captioned frames of ten seconds each, sixty seconds in all, with no sound;
 *   ffmpeg, which must be installed, makes it from the frames with one palette drawn from all six.
 * - `screenshots`: the store listing's five screenshots, launch/screenshots/*.png at 1280×800, and its promo tile,
 *   launch/promo-tile.png at 440×280, as launch/store-listing.md lists them.
 *
 * Everything is made in a temporary folder, the GIF's encoding too, and copied into launch/ only once all of it is
 * made, so a run that fails leaves the committed pictures as they were. The folder is deleted after.
 *
 *   tsx scripts/record-launch.ts demo|screenshots
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FRAMES = 6;
const SECONDS_PER_FRAME = 10;
const SCREENSHOTS = [
  '1-receipts.png',
  '2-receipt-detail.png',
  '3-grants.png',
  '4-degraded.png',
  '5-digest.png',
];

interface Target {
  /** The recorder, from extension/. */
  readonly recorder: string;
  /** The variable that names the folder it writes to. */
  readonly folder: string;
  /** What the recorder made in `made` turned into the files to copy: each from `made` to a path from the root. */
  finish(made: string): (readonly [string, string])[];
}

/** launch/demo.gif from the six frames in `made`, encoded there (header). */
function demoGif(made: string): (readonly [string, string])[] {
  const frames = readdirSync(made).filter((name) => /^frame-\d\.png$/u.test(name)).length;
  if (frames !== FRAMES) throw new Error(`record-demo: ${String(frames)} frames made, not ${String(FRAMES)}`);
  execFileSync(
    'ffmpeg',
    [
      ...['-y', '-loglevel', 'error'],
      ...['-framerate', `1/${String(SECONDS_PER_FRAME)}`, '-i', path.join(made, 'frame-%d.png')],
      ...['-vf', 'split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'],
      ...['-loop', '0', path.join(made, 'demo.gif')],
    ],
    { stdio: 'inherit' },
  );
  return [['demo.gif', path.join('launch', 'demo.gif')]];
}

/** The five screenshots and the tile in `made`, all of them (header). */
function storePictures(made: string): (readonly [string, string])[] {
  const files = readdirSync(made);
  const missing = [...SCREENSHOTS, 'promo-tile.png'].filter((file) => !files.includes(file));
  if (missing.length > 0) throw new Error(`record-screenshots: not made: ${missing.join(', ')}`);
  return [
    ...SCREENSHOTS.map((file) => [file, path.join('launch', 'screenshots', file)] as const),
    ['promo-tile.png', path.join('launch', 'promo-tile.png')],
  ];
}

const TARGETS: Readonly<Record<string, Target>> = {
  demo: { recorder: 'tests/e2e/demo.record.ts', folder: 'ATTEST_DEMO_FRAMES', finish: demoGif },
  screenshots: {
    recorder: 'tests/e2e/store-shots.record.ts',
    folder: 'ATTEST_STORE_SHOTS',
    finish: storePictures,
  },
};

const [name, ...rest] = process.argv.slice(2);
const target = name === undefined ? undefined : TARGETS[name];
if (target === undefined || rest.length > 0) {
  process.stderr.write('usage: tsx scripts/record-launch.ts demo|screenshots\n');
  process.exit(2);
}
const made = mkdtempSync(path.join(os.tmpdir(), 'attest-launch-'));
try {
  execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.record.config.ts', target.recorder],
    {
      cwd: path.join(ROOT, 'extension'),
      stdio: 'inherit',
      env: { ...process.env, [target.folder]: made },
    },
  );
  const copies = target.finish(made);
  for (const [from, to] of copies) {
    mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
    copyFileSync(path.join(made, from), path.join(ROOT, to));
  }
  const sizes = copies.map(([, to]) => `${to} (${String(statSync(path.join(ROOT, to)).size)} bytes)`);
  console.log(`record-launch ${name ?? ''}: ${sizes.join(', ')}`);
} finally {
  rmSync(made, { recursive: true, force: true });
}
