/**
 * entrypoints/sidepanel/use-paste-flow.ts (sprint_3 3.12; Sprint 3 QA review): the words the panel says once an import
 * is done, for every count the service worker can answer, and the form's step to the preview, each refusal named
 * as the form shows it. add-activity.spec.ts drives the same flow through the rendered panel. Every log is invented.
 */
import { describe, expect, it } from 'vitest';

import {
  type FormStep,
  importedNotice,
  NO_AGENT,
  type PasteClock,
  previewOf,
  REFUSALS,
} from '../../../entrypoints/sidepanel/use-paste-flow';
import { MAX_PASTE_CHARS } from '../../../src/adapters/paste';
import { IsoTs } from '../../../src/core/schema';

const CLOCK: PasteClock = { now: () => IsoTs.parse('2026-10-08T17:00:00-04:00'), offsetAt: () => -240 };
const form = (fields: Partial<FormStep> = {}): FormStep => ({
  kind: 'form',
  agent: 'muse',
  text: ['Today', 'Sent an email to sam@example.org', '4:33 pm'].join('\n'),
  error: null,
  ...fields,
});

describe('the notice after an import', () => {
  it('says how many were new and how many Attest already had, in the singular and the plural', () => {
    expect(importedNotice(1, 1)).toBe('Imported 1 claim.');
    expect(importedNotice(3, 3)).toBe('Imported 3 claims.');
    expect(importedNotice(1, 0)).toBe('Attest already had this claim.');
    expect(importedNotice(3, 0)).toBe('Attest already had all 3 claims.');
    expect(importedNotice(3, 1)).toBe('Imported 1 new claim; 2 were already in Attest.');
    expect(importedNotice(3, 2)).toBe('Imported 2 new claims; 1 was already in Attest.');
  });
});

describe('Preview', () => {
  it('asks for the agent first, keeping the text', () => {
    const step = form({ agent: null });
    expect(previewOf(step, CLOCK)).toEqual({ ...step, error: NO_AGENT });
  });

  it('names each refusal as the form shows it, keeping the agent and the text', () => {
    for (const [text, refusal] of [
      [' \n\t ', 'empty'],
      ['a'.repeat(MAX_PASTE_CHARS + 1), 'too_long'],
    ] as const) {
      expect(previewOf(form({ text }), CLOCK)).toEqual(form({ text, error: REFUSALS[refusal] }));
    }
    expect(REFUSALS.too_long).toContain('100,000 characters');
  });

  it('opens the preview of a log it reads, read at the panel’s clock in the person’s zone, not importing yet', () => {
    const next = previewOf(form(), CLOCK);
    if (next.kind !== 'preview') throw new Error('no preview');
    expect([next.agent, next.importing, next.failed, next.text]).toEqual(['muse', false, false, form().text]);
    expect(next.log.claims.map((c) => [c.type, c.claimedAt, c.observedAt])).toEqual([
      ['email.sent', '2026-10-08T16:33:00-04:00', '2026-10-08T17:00:00-04:00'],
    ]);
  });
});
