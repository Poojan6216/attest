/**
 * Every fixture label records the selectors it was checked against (TECH-4; agents/adapter_engineer.md rule 3;
 * docs/adapters.md §5; Hard Rule 12). Each observer's selectors.json lists the fixture folders its version was checked
 * against (`fixtures`); every entry of such a folder's labels.json names, in `selectorsVersion`, each observer that
 * lists the folder as `<observer>@<version>`, sorted and separated by a space (`gmail.receipt@1.1.0 gmail.sent@1.1.0`).
 * So a selectors change that bumps a version without re-checking the fixtures, or a new folder no observer claims,
 * fails here instead of leaving a stale label.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { GCAL_SELECTORS } from '../../../src/observers/gcal/selectors';
import { RECEIPT_SELECTORS } from '../../../src/observers/gmail/receipts/selectors';
import { SENT_SELECTORS } from '../../../src/observers/gmail/selectors';
import { labelFolders, loadLabels, PAGES_ROOT } from '../fixtures/fixture-labels';

/** The extension folder, which selectors.json `fixtures` paths are relative to. */
const EXTENSION_ROOT = path.resolve(PAGES_ROOT, '../../..');

const OBSERVERS = [SENT_SELECTORS, RECEIPT_SELECTORS, GCAL_SELECTORS].map((selectors) => ({
  id: selectors.observer,
  version: selectors.version,
  folders: selectors.fixtures.map((folder) => path.resolve(EXTENSION_ROOT, folder)),
}));

/** What every label in `dir` must record: each observer that lists the folder, at its version. */
const expectedFor = (dir: string): string =>
  OBSERVERS.filter((observer) => observer.folders.includes(path.resolve(dir)))
    .map((observer) => `${observer.id}@${observer.version}`)
    .sort()
    .join(' ');

describe('fixture labels carry the selectors version they were checked against (TECH-4)', () => {
  it('every folder an observer lists exists and is labelled', () => {
    for (const observer of OBSERVERS) {
      expect(observer.folders.length, observer.id).toBeGreaterThan(0);
      for (const folder of observer.folders) {
        expect(existsSync(path.join(folder, 'labels.json')), `${observer.id}: ${folder}`).toBe(true);
      }
    }
  });

  it.each(labelFolders().map((folder) => [`${folder.vendor}/${folder.date}`, folder] as const))(
    '%s: every label names each observer that lists the folder, at its current version',
    (_name, folder) => {
      const expected = expectedFor(folder.dir);
      expect(expected, 'a labelled folder no observer lists').not.toBe('');
      for (const fixture of loadLabels(folder.vendor, folder.date)) {
        expect(fixture.label.selectorsVersion, fixture.file).toBe(expected);
      }
    },
  );
});
