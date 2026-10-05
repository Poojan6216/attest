/**
 * Every typed error under src/ is printed by src/log.ts with its name and its code (TECH-3; Hard Rules 6, 10).
 *
 * The logger prints an error's name only if it is in LOG_ERROR_NAMES and its code only if it is in LOG_VALUES (or is
 * otherwise a safe string), so a class or a code missing from the vocabulary is logged as an anonymous `Error`:
 * the failure is still loud, but nobody can tell which one it was. This scans the source, as a reviewer would:
 * every `class X extends Error`, and every code its `code` field can hold (a literal union, a `*_CODES` list, or a
 * literal), and checks each through the real `buildRecord`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildRecord } from '../../../src/log';
import { LOG_ERROR_NAMES } from '../../../src/log-vocabulary';

const SRC = path.resolve(import.meta.dirname, '../../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The file without comments, so a quoted word in a comment is never read as a code. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const SOURCES = new Map(sourceFiles(SRC).map((file) => [file, codeOf(file)]));

const literals = (text: string): string[] => [...text.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');

/** Every `export const NAME = [...]` list and every `export type Name = 'a' | 'b'` union of literals in src/. */
function namedLists(): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const text of SOURCES.values()) {
    for (const match of text.matchAll(/export const (\w+) = (?:Object\.freeze\()?\[([^\]]*)\]/g)) {
      lists.set(match[1] ?? '', literals(match[2] ?? ''));
    }
    for (const match of text.matchAll(/export type (\w+) =([^;]*);/g)) {
      const body = match[2] ?? '';
      const fromList = /\(typeof (\w+)\)\[number\]/.exec(body)?.[1];
      if (fromList !== undefined)
        lists.set(match[1] ?? '', lists.get(fromList) ?? [`<unresolved ${fromList}>`]);
      else if (/^[\s|']*'/.test(body) && /^[\s'|a-z_.]*$/.test(body))
        lists.set(match[1] ?? '', literals(body));
    }
  }
  // A second round resolves a type declared from a list in a file read before the list.
  for (const text of SOURCES.values()) {
    for (const match of text.matchAll(/export type (\w+) =\s*\(typeof (\w+)\)\[number\];/g)) {
      const list = lists.get(match[2] ?? '');
      if (list !== undefined) lists.set(match[1] ?? '', list);
    }
  }
  return lists;
}

interface ErrorClass {
  readonly name: string;
  readonly file: string;
  readonly codes: readonly string[];
}

/** Each `class X extends Error` under src/, with the codes its `code` field can hold. */
function errorClasses(): ErrorClass[] {
  const lists = namedLists();
  const found: ErrorClass[] = [];
  for (const [file, text] of SOURCES) {
    for (const match of text.matchAll(/class (\w+) extends Error \{([\s\S]*?)\n\}/g)) {
      const body = match[2] ?? '';
      const fixed = /readonly code = '([^']+)'/.exec(body)?.[1];
      const typed = /(?:readonly )?code\??: (\w+)/.exec(body)?.[1];
      const codes = fixed !== undefined ? [fixed] : (lists.get(typed ?? '') ?? []);
      found.push({ name: match[1] ?? '', file: path.relative(SRC, file), codes });
    }
  }
  return found;
}

const CLASSES = errorClasses();

/** How src/log.ts prints an error with this name and code. */
function printed(name: string, code: string): unknown {
  const error = Object.assign(new Error('seeded message'), { name, code });
  return buildRecord('error', 'bus.handler_failed', { error }).fields.error;
}

describe('typed errors are logged with their name and code (TECH-3)', () => {
  it('the scan finds the typed errors of every layer', () => {
    const names = CLASSES.map(({ name }) => name);
    // A sample from each layer: if the scan stops finding them, this test must fail, not pass vacuously.
    for (const name of [
      'LedgerError',
      'BusError',
      'PolicyError',
      'GcalError',
      'ObserverError',
      'CalendarRowRefused',
    ]) {
      expect(names).toContain(name);
    }
    expect(CLASSES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(CLASSES.map((each) => [each.name, each] as const))(
    '%s: its name is in LOG_ERROR_NAMES',
    (_name, each) => {
      expect(LOG_ERROR_NAMES as readonly string[], each.file).toContain(each.name);
    },
  );

  it.each(CLASSES.map((each) => [each.name, each] as const))('%s: every code prints', (_name, each) => {
    expect(each.codes.length, `${each.file}: no code found for ${each.name}`).toBeGreaterThan(0);
    for (const code of each.codes) {
      expect(printed(each.name, code)).toBe(`${each.name} code=${code} messageLength=14`);
    }
  });

  it('a name outside the vocabulary still prints as Error, and an unknown code is never echoed', () => {
    expect(printed('SneakyError', 'invalid_input')).toBe('Error code=invalid_input messageLength=14');
    expect(printed('PolicyError', 'priya@example.com')).toBe('PolicyError messageLength=14');
  });
});
