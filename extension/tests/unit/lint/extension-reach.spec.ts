/**
 * How far the extension's own code reaches into tabs (sprint_4 close, security review SEC-8; Hard Rules 3, 11): the
 * `scripting` permission (Decisions [4.5]) is used by the page readers' registrations alone, in
 * src/background/readers.ts; a tab is created at the three reviewed call sites alone (the Gmail auto-check, an alert's
 * fallback and the popup's digest link, Decisions [4.6], [4.7], [4.9]); and nothing injects code or CSS into a tab or
 * changes a tab Attest did not create. Read from the TypeScript syntax of every shipped source file, so a new call fails
 * here before it ships. tests/e2e/built-bundle.spec.ts checks the built scripts too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** Every shipped source file, relative to the extension. */
function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const relative = path.join(dir, name);
      if (statSync(path.join(ROOT, relative)).isDirectory()) walk(relative);
      else if (/\.tsx?$/u.test(name) && !name.endsWith('.d.ts')) out.push(relative);
    }
  };
  walk('src');
  walk('entrypoints');
  return out.sort();
}

interface Reach {
  readonly file: string;
  readonly line: number;
  /** The last two names of the property chain: `scripting.registerContentScripts`, `tabs.create`. */
  readonly chain: string;
}

/** Every `….scripting…`, `….tabs.<name>` and injection name the source reaches, with where. */
function reachesOf(file: string): Reach[] {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: Reach[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      const owner = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : node.expression.getText();
      const watched =
        owner === 'scripting' ||
        owner === 'tabs' ||
        ['executeScript', 'insertCSS', 'removeCSS', 'registerContentScripts'].includes(name);
      if (watched) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        found.push({ file, line: line + 1, chain: `${owner}.${name}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const reaches = shippedFiles().flatMap(reachesOf);

const READERS_FILE = path.join('src', 'background', 'readers.ts');
const REGISTRATIONS = new Set([
  'scripting.getRegisteredContentScripts',
  'scripting.registerContentScripts',
  'scripting.updateContentScripts',
  'scripting.unregisterContentScripts',
]);
const TAB_CREATORS = new Set([
  path.join('src', 'background', 'auto-check.ts'),
  path.join('src', 'background', 'alerts.ts'),
  path.join('entrypoints', 'popup', 'components', 'PopupLinks.tsx'),
]);

describe('the extension’s reach into tabs (security review SEC-8)', () => {
  it('finds the reaches it is meant to watch, so a pass is no pass over nothing', () => {
    expect(reaches.some(({ chain }) => chain === 'scripting.registerContentScripts')).toBe(true);
    expect(reaches.filter(({ chain }) => chain === 'tabs.create').length).toBeGreaterThanOrEqual(3);
  });

  it('uses scripting for the readers’ registrations alone, in src/background/readers.ts', () => {
    const scripting = reaches.filter(
      ({ chain }) => chain.startsWith('scripting.') || chain.endsWith('ContentScripts'),
    );
    expect(
      scripting.filter(({ file }) => file !== READERS_FILE).map(({ file, chain }) => `${file}: ${chain}`),
    ).toEqual([]);
    expect(
      scripting.filter(({ chain }) => chain.startsWith('scripting.') && !REGISTRATIONS.has(chain)),
    ).toEqual([]);
  });

  it('injects no code or CSS into a tab, anywhere', () => {
    const injecting = reaches.filter(({ chain }) => /\.(?:executeScript|insertCSS|removeCSS)$/u.test(chain));
    expect(injecting).toEqual([]);
  });

  it('creates a tab at the three reviewed call sites alone, and changes, reloads or closes none', () => {
    const tabs = reaches.filter(({ chain }) => chain.startsWith('tabs.'));
    expect(
      tabs
        .filter(({ chain, file }) => chain === 'tabs.create' && !TAB_CREATORS.has(file))
        .map(({ file }) => file),
    ).toEqual([]);
    const allowed = new Set(['tabs.create', 'tabs.query']);
    expect(
      tabs.filter(({ chain }) => !allowed.has(chain)).map(({ file, chain }) => `${file}: ${chain}`),
    ).toEqual([]);
  });
});
