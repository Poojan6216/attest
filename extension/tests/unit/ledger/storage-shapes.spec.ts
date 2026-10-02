/**
 * Task 1.0: the two schemas src/ledger/types.ts defines itself (the rest are core re-exports, tested in
 * tests/unit/core/schema*.spec.ts). Same contract: at least five valid cases, each parsing to exactly itself,
 * and five invalid ones, each rejected at one specific path.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { CoveragePing, MetaEntry } from '../../../src/ledger/types';
import { makePing, omit, sha } from './fixtures';

type Path = readonly (string | number)[];
type Invalid = readonly [label: string, value: unknown, path: Path];
interface Table {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly Invalid[];
}

const TABLES: readonly Table[] = [
  {
    name: 'CoveragePing',
    schema: CoveragePing,
    valid: [
      makePing(),
      omit(makePing(), 'accountHash'),
      makePing({ observerId: 'gcal', userActive: false }),
      makePing({ lastSyncAt: '2026-10-01T06:00:00-04:00', windowStart: '2026-10-01T05:00:00-04:00' }),
      makePing({ accountHash: sha(901), windowEnd: '2026-10-01T10:00:00.250Z' }),
    ],
    invalid: [
      ['an account address instead of its hash', makePing({ accountHash: 'me@gmail.com' }), ['accountHash']],
      ['an empty observerId', makePing({ observerId: '' }), ['observerId']],
      ['a lastSyncAt without offset', makePing({ lastSyncAt: '2026-10-01T10:00:00' }), ['lastSyncAt']],
      ['a missing userActive', omit(makePing(), 'userActive'), ['userActive']],
      ['a smuggled url', { ...makePing(), url: 'https://mail.google.com/mail/u/0' }, []],
    ],
  },
  {
    name: 'MetaEntry',
    schema: MetaEntry,
    valid: [
      { key: 'lastPurgeAt', value: '2026-09-30T00:00:00Z' },
      { key: 'retentionDays', value: 90 },
      { key: 'encrypted', value: false },
      { key: 'schemaVersion', value: 1 },
      { key: 'k', value: 'x'.repeat(256) },
    ],
    invalid: [
      ['an empty key', { key: '', value: 1 }, ['key']],
      ['a value over 256', { key: 'k', value: 'x'.repeat(257) }, ['value']],
      ['an object value', { key: 'k', value: { nested: true } }, ['value']],
      ['a missing value', { key: 'k' }, ['value']],
      ['a smuggled field', { key: 'k', value: 1, note: 'x' }, []],
    ],
  },
];

/** The distinct paths of every issue a parse raised; empty when it parsed. */
function issuePaths(schema: z.ZodType, value: unknown): Path[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  const paths = result.error.issues.map((issue) =>
    issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
  );
  return [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()];
}

describe.each(TABLES)('$name', ({ schema, valid, invalid }) => {
  it('has at least five valid and five invalid cases', () => {
    expect(valid.length).toBeGreaterThanOrEqual(5);
    expect(invalid.length).toBeGreaterThanOrEqual(5);
  });

  it.each(valid.map((value, index) => ({ index, value })))(
    'parses valid case $index to exactly itself',
    ({ value }) => {
      expect(schema.parse(value)).toEqual(value);
    },
  );

  it.each(invalid.map(([label, value, path]) => ({ label, value, path })))(
    'rejects $label at $path',
    ({ value, path }) => {
      expect(issuePaths(schema, value)).toEqual([path]);
    },
  );
});
