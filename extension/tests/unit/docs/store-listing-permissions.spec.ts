/**
 * launch/store-listing.md's permission justifications (sprint_6 6.6, sprint_7 7.4; QA review, sprint 7): the store asks
 * why for each permission the manifest names, so the listing's table has one row for each permission, optional
 * permission and host permission the built manifest asks for, an optional one marked so, and no row for one it does not
 * ask for. The built manifest's permissions are wxt.config.ts's and the `sidePanel` WXT adds for the side panel's
 * entrypoint, as tests/e2e/built-bundle.spec.ts pins on the build; `pnpm audit:manifest` would also let `offscreen`
 * through, and a build that asked for it would fail here until the listing says why.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../../../wxt.config';
import { REPO_ROOT } from './copy-rules';

const LISTING = readFileSync(path.join(REPO_ROOT, 'launch', 'store-listing.md'), 'utf8');
const SIDE_PANEL = existsSync(path.join(REPO_ROOT, 'extension', 'entrypoints', 'sidepanel'));

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const manifest: unknown = config.manifest;
const field = (key: string): string[] => list(Reflect.get(Object(manifest), key));

/** The rows of the listing's permission table: each permission as written, and whether it is marked optional. */
function rows(): { readonly permission: string; readonly optional: boolean }[] {
  const start = LISTING.indexOf('\n## Permission justifications\n');
  if (start === -1) throw new Error('the listing has no "Permission justifications" section');
  const next = LISTING.indexOf('\n## ', start + 1);
  const text = LISTING.slice(start, next === -1 ? undefined : next);
  return [...text.matchAll(/^\| `([^`]+)`( \(optional\))? \| \S.* \|$/gmu)].map(
    ([, permission = '', optional]) => ({
      permission,
      optional: optional !== undefined,
    }),
  );
}

describe("launch/store-listing.md's permission justifications", () => {
  it('has one row for each permission the built manifest asks for, and no other', () => {
    const asked = [
      ...field('permissions'),
      ...(SIDE_PANEL ? ['sidePanel'] : []),
      ...field('optional_permissions'),
      ...field('host_permissions'),
    ];
    expect(asked.length).toBeGreaterThan(4);
    const listed = rows().map(({ permission }) => permission);
    expect(new Set(listed).size, 'a permission listed twice').toBe(listed.length);
    expect([...listed].sort()).toEqual([...asked].sort());
  });

  it('marks exactly the optional permissions optional', () => {
    const marked = rows()
      .filter(({ optional }) => optional)
      .map(({ permission }) => permission);
    expect(marked.sort()).toEqual(field('optional_permissions').sort());
  });
});
