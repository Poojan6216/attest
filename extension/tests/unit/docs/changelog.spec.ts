/**
 * CHANGELOG.md (QA-R13, QA-G14, TECH-C12, TECH-R9; tech_reviewer "CHANGELOG updated under Unreleased"; build_spec
 * "CHANGELOG kept by hand"): Keep a Changelog form, an [Unreleased] section first, empty right after a release is cut
 * (sprint_7 7.0), then each release, newest first, dated; and every command a person runs from the repository root
 * named in it. A root script added without a changelog line fails here, which is how Sprint 1's `pnpm attest`,
 * `pnpm check-docs` and `pnpm test:coverage` went unrecorded. The newest release is the extension's version, the one
 * its manifest carries, and the privacy policy says it applies to that version. A golden scenario count it states is
 * the number of files in extension/tests/golden (docs_writer rule 1: no number without a source; the close once left
 * it one behind).
 */
import { readdirSync, readFileSync } from 'node:fs';
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

/** A release's heading: its version and the day it was cut. */
const RELEASE = /^\[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/u;

/** Each `## ` section: its heading and its text, up to the next one. */
function sections(): { readonly heading: string; readonly text: string }[] {
  return CHANGELOG.split(/^## /m)
    .slice(1)
    .map((part) => {
      const end = part.indexOf('\n');
      return { heading: part.slice(0, end), text: part.slice(end) };
    });
}

/** `[a, b, c]` of each version, compared as numbers. */
const versionParts = (version: string): number[] => version.split('.').map(Number);

describe('CHANGELOG.md', () => {
  it('starts with [Unreleased], then each release newest first and dated, every subsection a Keep a Changelog one with bullets', () => {
    const all = sections();
    const [first, ...releases] = all;
    expect(first?.heading).toBe('[Unreleased]');
    expect(releases.length).toBeGreaterThan(0);
    const versions = releases.map(({ heading }) => {
      const match = RELEASE.exec(heading);
      expect(match, heading).not.toBeNull();
      return match?.[1] ?? '';
    });
    const newestFirst = [...versions].sort((a, b) => {
      const [x, y] = [versionParts(a), versionParts(b)];
      return (y[0] ?? 0) - (x[0] ?? 0) || (y[1] ?? 0) - (x[1] ?? 0) || (y[2] ?? 0) - (x[2] ?? 0);
    });
    expect(versions).toEqual(newestFirst);
    for (const { heading, text } of all) {
      const subsections = [...text.matchAll(/^### (.+)$/gm)].map((match) => match[1] ?? '');
      if (heading !== '[Unreleased]') expect(subsections.length, heading).toBeGreaterThan(0);
      for (const subsection of subsections) expect(SECTIONS.has(subsection), subsection).toBe(true);
      for (const part of text.split(/^### .+$/m).slice(1)) expect(part).toMatch(/^- \S/m);
    }
  });

  it('names every root command a person runs as `pnpm <script>`', () => {
    const runnable = ROOT_SCRIPTS.filter((script) => !LIFECYCLE.has(script));
    expect(runnable).toEqual(expect.arrayContaining(['attest', 'check-docs', 'test:coverage']));
    const missing = runnable.filter((script) => !new RegExp(`\`pnpm ${script}[\` ]`).test(CHANGELOG));
    expect(missing).toEqual([]);
  });

  it("has the extension's version as its newest release, which the privacy policy applies to (sprint_7 7.0)", () => {
    const version: unknown = (
      JSON.parse(readFileSync(path.join(REPO_ROOT, 'extension', 'package.json'), 'utf8')) as {
        version?: unknown;
      }
    ).version;
    const newest = sections()
      .map(({ heading }) => RELEASE.exec(heading)?.[1])
      .find((found) => found !== undefined);
    expect(newest).toBe(version);
    const privacy = readFileSync(path.join(REPO_ROOT, 'PRIVACY.md'), 'utf8');
    expect(/Applies to Attest (\d+\.\d+\.\d+)\./u.exec(privacy)?.[1]).toBe(version);
  });

  it('states the number of golden scenarios extension/tests/golden holds (docs_writer rule 1)', () => {
    const files = readdirSync(path.join(REPO_ROOT, 'extension', 'tests', 'golden')).filter((name) =>
      /^\d{2,}-[a-z0-9-]+\.json$/.test(name),
    );
    const stated = [...CHANGELOG.matchAll(/\b(\d[\d,]*) golden scenarios\b/g)].map((match) =>
      Number((match[1] ?? '').replaceAll(',', '')),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(stated.length).toBeGreaterThan(0);
    for (const count of stated) expect(count).toBe(files.length);
  });
});
