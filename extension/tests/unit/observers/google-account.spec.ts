/**
 * One Google-account reader for the three observers (src/observers/google-account.ts; TECH-5; docs/grading.md §6.1).
 * The switcher's label ends with the address in parentheses; the words before it are localised. Each observer reads
 * it with its own selectors.json, in any display language, and two different addresses are never one account
 * (Hard Rule 5): gmail.sent and gmail.receipt say `selector.ambiguous.account`, gcal.event refuses the account. The
 * receipt observer's own account behaviour (an opened conversation) is in ./receipts/receipts-page.spec.ts.
 */
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { accountOf as gcalAccountOf } from '../../../src/observers/gcal/page';
import { GCAL_SELECTORS } from '../../../src/observers/gcal/selectors';
import { readGmailAccount } from '../../../src/observers/gmail/account';
import { RECEIPT_SELECTORS } from '../../../src/observers/gmail/receipts';
import { SENT_SELECTORS } from '../../../src/observers/gmail/selectors';
import { type AccountSelectors, readGoogleAccount } from '../../../src/observers/google-account';

const SENT: AccountSelectors = {
  selector: SENT_SELECTORS.selectors.account,
  attribute: SENT_SELECTORS.attributes.accountLabel,
};
const RECEIPT: AccountSelectors = {
  selector: RECEIPT_SELECTORS.landmarks.account,
  attribute: RECEIPT_SELECTORS.landmarks.accountAttribute,
};
const GCAL: AccountSelectors = {
  selector: GCAL_SELECTORS.selectors.account,
  attribute: GCAL_SELECTORS.attributes.label,
};

/** A page whose banner holds one link per label (and `outside`, a labelled element outside the banner). */
function withBanner<T>(labels: readonly string[], read: (doc: Document) => T, outside = ''): T {
  const window = new Window({ url: 'https://mail.google.com/mail/u/0/#inbox' });
  try {
    const links = labels.map((label) => `<a role="button" aria-label="${label}">A</a>`).join('');
    const html = `<html><body><header role="banner">${links}</header>${outside}<div role="main"></div></body></html>`;
    const parsed: unknown = new window.DOMParser().parseFromString(html, 'text/html');
    return read(parsed as Document);
  } finally {
    void window.happyDOM.close();
  }
}

const FRENCH = 'Compte Google&#160;: Avery Founder&#10;(avery.founder@example.com)';
const GERMAN = 'Google-Konto: Avery Founder&#10;(Avery.Founder@Example.com)';
const OTHER = 'Google Account: Casey Second&#10;(casey.second@example.net)';
const OTHER_FRENCH = 'Compte Google&#160;: Casey Second&#10;(casey.second@example.net)';

describe('the shared reader (any display language; Hard Rule 5)', () => {
  it.each([
    ['gmail.sent', SENT],
    ['gmail.receipt', RECEIPT],
    ['gcal.event', GCAL],
  ])('%s reads a switcher labelled in French, with its own selectors', (_observer, selectors) => {
    expect(withBanner([FRENCH], (doc) => readGoogleAccount(doc, selectors))).toEqual({
      ok: true,
      address: 'avery.founder@example.com',
    });
  });

  it('the same address in another case and another language is one account; another address is two', () => {
    expect(withBanner([FRENCH, GERMAN], (doc) => readGoogleAccount(doc, SENT))).toEqual({
      ok: true,
      address: 'avery.founder@example.com',
    });
    expect(withBanner([FRENCH, OTHER], (doc) => readGoogleAccount(doc, SENT))).toEqual({
      ok: false,
      reason: 'selector.ambiguous.account',
    });
  });

  it('words after the address (a second account’s note, real capture of 2026-10-06) do not hide it', () => {
    const noted = 'Google Account: Avery Founder&#10;(avery.founder@example.com), needs attention';
    expect(withBanner([noted], (doc) => readGoogleAccount(doc, SENT))).toEqual({
      ok: true,
      address: 'avery.founder@example.com',
    });
    const both = [noted, 'Google Account: Sam Lee&#10;(sam.lee@example.org)'];
    expect(withBanner(both, (doc) => readGoogleAccount(doc, SENT))).toEqual({
      ok: false,
      reason: 'selector.ambiguous.account',
    });
  });

  it('only the last parenthesised address counts, and only inside the banner', () => {
    const inName = 'Google Account: Avery (someone.else@example.org)&#10;(avery.founder@example.com)';
    expect(withBanner([inName], (doc) => readGoogleAccount(doc, SENT))).toMatchObject({
      address: 'avery.founder@example.com',
    });
    const outside = '<a aria-label="Alex Rivera (alex.rivera@example.com)">x</a>';
    expect(withBanner(['Menu'], (doc) => readGoogleAccount(doc, SENT), outside)).toEqual({
      ok: false,
      reason: 'selector.missing.account',
    });
  });
});

describe('each observer through the shared reader', () => {
  it('gmail.sent: a French switcher reads; two accounts are selector.ambiguous.account', () => {
    expect(withBanner([FRENCH], readGmailAccount)).toEqual({
      ok: true,
      address: 'avery.founder@example.com',
    });
    expect(withBanner([FRENCH, OTHER], readGmailAccount)).toEqual({
      ok: false,
      reason: 'selector.ambiguous.account',
    });
  });

  it('gcal.event: a French switcher reads; two accounts, or a switcher with no address, are refused', () => {
    expect(withBanner([FRENCH], gcalAccountOf)).toBe('avery.founder@example.com');
    // Refused ('') makes the pass DEGRADED account.invalid: whose calendar this is cannot be told.
    expect(withBanner([FRENCH, OTHER_FRENCH], gcalAccountOf)).toBe('');
    expect(withBanner(['Google Account: Avery Founder'], gcalAccountOf)).toBe('');
    // No account named: coverage carries none (capped) and nothing is compared.
    expect(withBanner(['Menu'], gcalAccountOf)).toBeNull();
  });
});
