/**
 * What an alert says (sprint_4 4.6; src/ui/alert-text.ts): the grade as a noun and the agent; "likely" on every UNASKED
 * alert (Hard Rule 7); the action and its time, never a counterparty, an amount or a subject; no exclamation mark.
 * Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import { IsoTs } from '../../../src/core/schema';
import type { AlertToShow } from '../../../src/ledger/alerts';
import { alertText } from '../../../src/ui/alert-text';
import { clockTime } from '../../../src/ui/format';

const NOW_MS = Date.parse('2026-10-09T15:00:00-04:00');
const AT = IsoTs.parse('2026-10-06T14:02:00-04:00');
const alert = (grade: AlertToShow['grade'], withAction = true): AlertToShow => ({
  receiptId: '01JA0000000000000000000001',
  agent: 'muse',
  grade,
  action: withAction ? { type: 'calendar.created', at: AT } : undefined,
});

describe('alertText', () => {
  it('names the grade, the agent, the action and its time', () => {
    const time = clockTime(AT, NOW_MS);
    expect(alertText(alert('NOT_FOUND'), NOW_MS)).toEqual({
      title: 'Not found: Muse',
      message: `Muse said it created a calendar event at ${time}. Attest found no sign of it.`,
    });
    expect(alertText(alert('UNASKED'), NOW_MS)).toEqual({
      title: 'Unasked: likely Muse',
      message: `A calendar event was created at ${time} that no agent reported. Likely Muse.`,
    });
    expect(alertText(alert('OVER_SCOPE'), NOW_MS)).toEqual({
      title: 'Over scope: Muse',
      message: `Muse said it created a calendar event at ${time}, beyond what its grant allows.`,
    });
  });

  it('says what it can without an action: a scope receipt, or one whose claim is gone', () => {
    expect(alertText(alert('OVER_SCOPE', false), NOW_MS).message).toBe(
      'Muse holds access you did not declare in its grant.',
    );
    expect(alertText(alert('UNASKED', false), NOW_MS).message).toContain('Likely Muse.');
    expect(alertText(alert('NOT_FOUND', false), NOW_MS).message).toBe(
      'Muse said it acted, and Attest found no sign of it.',
    );
  });

  it('has no exclamation mark, and "likely" on every UNASKED alert', () => {
    for (const grade of ['NOT_FOUND', 'UNASKED', 'OVER_SCOPE'] as const) {
      for (const withAction of [true, false]) {
        const { title, message } = alertText(alert(grade, withAction), NOW_MS);
        expect(`${title} ${message}`).not.toContain('!');
        if (grade === 'UNASKED') expect(`${title} ${message}`.toLowerCase()).toContain('likely');
      }
    }
  });
});
