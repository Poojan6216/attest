/**
 * The logger's closed vocabulary (src/log-vocabulary.ts) covers every enum the code logs, so a value of ours
 * is never redacted by accident, and holds nothing shaped like the seeded secrets (Hard Rule 10).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INSTALL_REASONS } from '../../src/background/install';
import { BUS_ERROR_CODES } from '../../src/bus/errors';
import { DROP_REASONS } from '../../src/bus/listen';
import { BusMessageType, LedgerTable, UiQueryKind, UiResultError } from '../../src/bus/messages';
import { ADAPTER_SITES, ALARM_NAMES, OBSERVER_SOURCES } from '../../src/config';
import { logTableId } from '../../src/ledger/db';
import { LEDGER_ERROR_CODES } from '../../src/ledger/errors';
import { INSTALL_ID_ERROR_CODES } from '../../src/ledger/install-id';
import { AdapterHealth, AgentId, Grade, Receipt } from '../../src/ledger/types';
import { isSafeString } from '../../src/log';
import { LOG_ERROR_NAMES, LOG_EVENTS, LOG_VALUES } from '../../src/log-vocabulary';
import { loadSeeds } from '../e2e/support/leaks';

const EXTENSION = path.resolve(import.meta.dirname, '../..');

describe('LOG_VALUES covers every enum the code logs', () => {
  it.each([
    ['bus message types', BusMessageType.options],
    ['bus drop reasons', DROP_REASONS],
    ['ui query kinds', UiQueryKind.options],
    ['ui result errors', UiResultError.options],
    ['bus error codes', BUS_ERROR_CODES],
    ['ledger error codes', LEDGER_ERROR_CODES],
    ['install id error codes', INSTALL_ID_ERROR_CODES],
    ['install reasons', INSTALL_REASONS],
    ['ledger tables as logged', LedgerTable.options.map(logTableId)],
    ['alarm names', Object.values(ALARM_NAMES)],
    ['agent ids', AgentId.options],
    ['observer and adapter ids', [...Object.keys(OBSERVER_SOURCES), ...Object.keys(ADAPTER_SITES)]],
    ['grades', Grade.options],
    ['receipt states', Receipt.shape.state.options],
    ['health statuses', AdapterHealth.shape.status.options],
    ['query failure reasons', ['no_response', 'malformed_result', 'kind_mismatch']],
    ['install id states', ['missing', 'corrupt']],
    ['ui surfaces', ['popup', 'sidepanel', 'options']],
  ])('%s', (_label, values) => {
    for (const value of values) expect(isSafeString(value), value).toBe(true);
  });
});

describe('the vocabulary is closed and clean', () => {
  it('has no duplicates', () => {
    for (const list of [LOG_EVENTS, LOG_VALUES, LOG_ERROR_NAMES] as const) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
  });

  it('no seed value or canary is a vocabulary word', () => {
    const words = new Set<string>(
      [...LOG_EVENTS, ...LOG_VALUES, ...LOG_ERROR_NAMES].map((w) => w.toLowerCase()),
    );
    for (const seed of loadSeeds()) {
      for (const secret of [seed.value, ...seed.canaries])
        expect(words.has(secret.toLowerCase())).toBe(false);
    }
  });

  it('every event the code emits is in LOG_EVENTS, and every LOG_EVENTS entry is emitted somewhere', () => {
    const emitted = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          for (const match of readFileSync(full, 'utf8').matchAll(
            /\blog\.(?:debug|info|warn|error)\(\s*'([^']+)'/g,
          )) {
            if (match[1] !== undefined) emitted.add(match[1]);
          }
        }
      }
    };
    walk(path.join(EXTENSION, 'src'));
    walk(path.join(EXTENSION, 'entrypoints'));
    expect([...emitted].sort()).toEqual([...LOG_EVENTS].sort());
  });
});
