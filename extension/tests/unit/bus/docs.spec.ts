/**
 * Every bus message type is documented (TECH-17, tech_reviewer: "every new bus message … documented in
 * docs/adapters.md"), so a message added without its sender, receiver and response fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DROP_REASONS } from '../../../src/bus/listen';
import { BUS_MESSAGE_TYPES } from '../../../src/bus/messages';

const DOC = readFileSync(path.resolve(import.meta.dirname, '../../../../docs/adapters.md'), 'utf8');

describe('docs/adapters.md documents the bus', () => {
  it.each([...BUS_MESSAGE_TYPES])('%s has a row in the message table', (type) => {
    expect(DOC).toMatch(new RegExp(`^\\| \`${type.replace('.', '\\.')}\` \\|`, 'm'));
  });

  it.each([...DROP_REASONS])('drop reason %s is explained', (reason) => {
    expect(DOC).toContain(`\`${reason}\``);
  });
});
