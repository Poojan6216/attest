/**
 * Builds the extension as it ships, for a test or bench that measures or checks the build (Sprint 6 close, QA-2):
 * `NODE_ENV=production`, whatever the caller's own. Vitest sets `test`, which gave a build with Preact's development
 * JSX, this machine's file paths in it, and Dexie unminified, and that was the build the popup's paint gate measured.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** The extension's directory. */
export const EXTENSION_DIR = path.resolve(import.meta.dirname, '../..');

/** Runs `pnpm build` in the extension as a production build. */
export function buildExtension(): void {
  execFileSync('pnpm', ['build'], {
    cwd: EXTENSION_DIR,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });
}
