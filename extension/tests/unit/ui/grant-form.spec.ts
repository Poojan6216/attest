/**
 * The options page's grant form (sprint_4 4.4; src/ui/grant-form.ts): the draft of a stored grant or of the default;
 * recipients that are domains or addresses (a domain in capitals is the same domain, repeats kept once); a ceiling in
 * whole main units stored in minor units, blank for none; declared access one per line; each wrong field said in words;
 * only what the person chooses, never what Attest observed; and the grant in plain language. Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import { ActionType, Grant } from '../../../src/core/schema';
import { draftOf, grantOfDraft, grantSentence } from '../../../src/ui/grant-form';
import { makeGrant } from '../ledger/fixtures';

const STORED = Grant.parse(
  makeGrant({ spendCeilingCents: 5000, spendCurrency: 'USD', observedScopes: ['gmail.read'] }),
);

describe('draftOf', () => {
  it('drafts a stored grant, and the default (every action, no list, no ceiling) for an agent with none', () => {
    expect(draftOf(STORED, true)).toEqual({
      allowedTypes: ['email.sent', 'calendar.created'],
      recipients: 'example.com',
      ceiling: '50',
      currency: 'USD',
      access: 'gmail.send',
      muted: true,
    });
    expect(draftOf(undefined, false)).toEqual({
      allowedTypes: ActionType.options,
      recipients: '',
      ceiling: '',
      currency: 'USD',
      access: '',
      muted: false,
    });
    // Declared access starts from what the vendor's settings page showed, when none was declared.
    expect(draftOf(Grant.parse({ ...STORED, declaredScopes: [] }), false).access).toBe('gmail.read');
  });
});

describe('grantOfDraft', () => {
  it('makes the choices: recipients cleaned, the ceiling in minor units, nothing Attest observed', () => {
    const draft = {
      ...draftOf(STORED, false),
      recipients: '  Company.COM \n\npriya@Company.com\ncompany.com',
      ceiling: '120',
    };
    // The stored grant's observed scopes stay with the service worker, which keeps them when it saves.
    expect(grantOfDraft('muse', draft)).toEqual({
      ok: true,
      muted: false,
      grant: {
        agent: 'muse',
        allowedTypes: ['email.sent', 'calendar.created'],
        counterpartyAllowlist: ['company.com', 'priya@Company.com'],
        spendCeilingCents: 12000,
        spendCurrency: 'USD',
        declaredScopes: ['gmail.send'],
      },
    });
    const yen = grantOfDraft('muse', { ...draft, ceiling: '1500', currency: 'JPY' });
    expect(yen.ok && yen.grant.spendCeilingCents).toBe(1500);
    const none = grantOfDraft('muse', { ...draft, ceiling: '' });
    expect(none.ok && none.grant).toMatchObject({ spendCeilingCents: null });
    expect(none.ok && 'spendCurrency' in none.grant).toBe(false);
  });

  it('says what each wrong field must fix, and makes no grant', () => {
    const draft = draftOf(undefined, false);
    expect(
      grantOfDraft('muse', {
        ...draft,
        recipients: 'company.com\nnot a domain',
        ceiling: '12.50',
        access: 'x'.repeat(121),
      }),
    ).toEqual({
      ok: false,
      errors: {
        recipients:
          '“not a domain” is not a domain, such as example.com, or an address, such as priya@example.com.',
        ceiling: 'Write a whole number, such as 50, or leave it blank for no ceiling.',
        access: 'Each kind of access is at most 120 characters.',
      },
    });
    expect(grantOfDraft('muse', { ...draft, ceiling: '9999999999999' })).toEqual({
      ok: false,
      errors: { ceiling: 'That ceiling is larger than Attest can hold.' },
    });
  });
});

describe('grantSentence', () => {
  it('says what the agent may do in plain language', () => {
    const made = grantOfDraft('muse', draftOf(STORED, false));
    expect(made.ok && grantSentence('Muse', made.grant)).toBe(
      'Muse may: send email, create calendar events; write only to example.com; spend up to $50.00.',
    );
    const open = grantOfDraft('dots', draftOf(undefined, false));
    expect(open.ok && grantSentence('Dots', open.grant)).toMatch(
      /^Dots may: send email, .*; write to anyone; spend without a ceiling\.$/u,
    );
    const nothing = grantOfDraft('claude', { ...draftOf(undefined, false), allowedTypes: [] });
    expect(nothing.ok && grantSentence('Claude', nothing.grant)).toBe('Claude may do nothing Attest checks.');
  });
});
