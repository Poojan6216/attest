/**
 * CHANGELOG.md (QA-R13, QA-G14, TECH-C12, TECH-R9; tech_reviewer "CHANGELOG updated under Unreleased"; build_spec
 * "CHANGELOG kept by hand"): Keep a Changelog form, an [Unreleased] section first, and every command a person runs
 * from the repository root named there. A root script added without a changelog line fails here, which is how
 * Sprint 1's `pnpm attest`, `pnpm check-docs` and `pnpm test:coverage` went unrecorded.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CHANGELOG = readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
const ROOT_SCRIPTS = Object.keys(
  (
    JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts,
);
/** Run by pnpm itself on install (simple-git-hooks), never by a person. */
const LIFECYCLE = new Set(['prepare']);
/** Keep a Changelog 1.1.0 section names. */
const SECTIONS = new Set(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);

/** The text of the [Unreleased] section, up to the next release heading. */
function unreleased(): string {
  const start = CHANGELOG.indexOf('\n## [Unreleased]\n');
  const next = CHANGELOG.indexOf('\n## ', start + 1);
  return start === -1 ? '' : CHANGELOG.slice(start, next === -1 ? undefined : next);
}

describe('CHANGELOG.md', () => {
  it('starts with an [Unreleased] section whose subsections are Keep a Changelog ones, each with bullets', () => {
    const releases = [...CHANGELOG.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(releases[0]).toBe('[Unreleased]');
    const section = unreleased();
    const headings = [...section.matchAll(/^### (.+)$/gm)].map((match) => match[1] ?? '');
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(SECTIONS.has(heading), heading).toBe(true);
    for (const part of section.split(/^### .+$/m).slice(1)) expect(part).toMatch(/^- \S/m);
  });

  it('names every root command a person runs as `pnpm <script>` under [Unreleased]', () => {
    const section = unreleased();
    const runnable = ROOT_SCRIPTS.filter((script) => !LIFECYCLE.has(script));
    expect(runnable).toEqual(expect.arrayContaining(['attest', 'check-docs', 'test:coverage']));
    const missing = runnable.filter((script) => !new RegExp(`\`pnpm ${script}[\` ]`).test(section));
    expect(missing).toEqual([]);
  });
});
