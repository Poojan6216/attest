/**
 * Builds the extension as it ships, for a test or bench that measures or checks the build (Sprint 6 close, QA-2):
 * `NODE_ENV=production`, whatever the caller's own. Vitest sets `test`, which gave a build with Preact's development
 * JSX, this machine's file paths in it, and Dexie unminified, and that was the build the popup's paint gate measured.
 * A failed build throws with its own output, never silently (tech review TECH-14).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** The extension's directory. */
export const EXTENSION_DIR = path.resolve(import.meta.dirname, '../..');

/** Runs `pnpm build` in the extension as a production build; a failure says why, with the build's own output. */
export function buildExtension(): void {
  try {
    execFileSync('pnpm', ['build'], {
      cwd: EXTENSION_DIR,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  } catch (error) {
    const output = ['stdout', 'stderr']
      .map((stream): unknown => Reflect.get(Object(error), stream))
      .filter((text): text is string => typeof text === 'string')
      .join('\n');
    throw new Error(`pnpm build failed:\n${output.slice(-4_000)}`, { cause: error });
  }
}

let built = false;

/** One build for every bench `pnpm bench` runs (tech review TECH-14): the popup's, the perf and the red team's. */
export function buildExtensionOnce(): void {
  if (built) return;
  buildExtension();
  built = true;
}
