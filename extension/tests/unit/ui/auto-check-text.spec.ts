/**
 * What the popup says after the Gmail auto-check opened Gmail (sprint_4 4.9; src/ui/auto-check-text.ts): when, for
 * how many emails of whose, and why; said from the open until its window ends, and never for a record later than now.
 * The copy holds no exclamation mark (agents/ux_engineer.md). Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import type { AutoCheckRecord } from '../../../src/ledger/auto-check-record';
import { IsoTs } from '../../../src/ledger/types';
import { autoCheckShown, autoCheckText } from '../../../src/ui/auto-check-text';

const AT = new Date(2026, 9, 9, 17, 15);
const record = (claims: number, agents: AutoCheckRecord['agents']): AutoCheckRecord => ({
  at: IsoTs.parse(AT.toISOString()),
  until: IsoTs.parse(new Date(AT.getTime() + 30 * 60_000).toISOString()),
  claims,
  agents,
});
const NOW = AT.getTime() + 5 * 60_000;

describe('autoCheckText', () => {
  it('says when, for one email of one agent, and why', () => {
    expect(autoCheckText(record(1, ['muse']), NOW)).toBe(
      'At 17:15 Attest opened your Gmail Sent folder in a pinned tab, to check an email Muse says it sent: ' +
        'Attest had not seen the folder since. It only reads the folder. Close the tab whenever you like, or turn ' +
        'this off in Options.',
    );
  });

  it.each([
    [3, ['muse', 'claude'], 'to check 3 emails Muse and Claude say they sent'],
    [4, ['muse', 'chatgpt', 'claude'], 'to check 4 emails Muse, ChatGPT and Claude say they sent'],
    [2, ['dots'], 'to check 2 emails Dots says it sent'],
  ] as const)('counts %i emails of %j', (claims, agents, words) => {
    const text = autoCheckText(record(claims, agents), NOW);
    expect(text).toContain(words);
    expect(text).not.toContain('!');
  });
});

describe('autoCheckShown', () => {
  it('is said from the open until its window ends', () => {
    const open = record(1, ['muse']);
    expect(autoCheckShown(null, NOW)).toBe(false);
    expect(autoCheckShown(open, AT.getTime() - 1)).toBe(false);
    expect(autoCheckShown(open, AT.getTime())).toBe(true);
    expect(autoCheckShown(open, AT.getTime() + 30 * 60_000 - 1)).toBe(true);
    expect(autoCheckShown(open, AT.getTime() + 30 * 60_000)).toBe(false);
  });
});
