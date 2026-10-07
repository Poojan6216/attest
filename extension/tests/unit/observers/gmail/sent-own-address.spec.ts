/**
 * The account's own address never leaves the content script but as its hash (docs/privacy-architecture.md §6; Hard
 * Rule 2), also when the account is a recipient: the first real Sent page held an email the user sent to themself
 * (capture of 2026-10-06), whose recipient is the account. Like the Calendar reader with guests, the Sent reader
 * leaves the account's mailbox out of a row's recipients (../../../../src/observers/own-address.ts: any case, a
 * `+tag`, Gmail's dots). A claim naming the account can then match no row, so a row that names the account narrows
 * the window like a conversation row: such a claim is UNVERIFIABLE, never NOT_FOUND (Hard Rule 5; tech re-review
 * TECH-R1: a row kept without its counterparty had graded a true claim NOT_FOUND).
 */
import { describe, expect, it } from 'vitest';

import { isOwnAddress } from '../../../../src/observers/own-address';
import { all, planVariant, row } from './variants';

const ACCOUNT = 'avery.founder@example.com';
const MINUTE = 60_000;

/** Makes the row's `index`-th shown recipient the account itself, written as `written`; returns the row's key. */
function recipientIsAccount(doc: Document, rowIndex: number, index: number, written: string): string {
  const target = row(doc, rowIndex);
  const recipient = all(target, '[email]')[index];
  if (recipient === undefined)
    throw new Error(`variant: row ${String(rowIndex)} has no recipient ${String(index)}`);
  recipient.setAttribute('email', written);
  recipient.setAttribute('data-hovercard-id', written);
  return (
    target.querySelector('[data-legacy-last-message-id]')?.getAttribute('data-legacy-last-message-id') ?? ''
  );
}

/** The index of the first row with `count` recipients. */
function rowWith(doc: Document, count: number): number {
  const index = all(doc, '[role="main"] [role="grid"] [role="row"]').findIndex(
    (candidate) => all(candidate, '[email]').length === count,
  );
  if (index < 0) throw new Error(`variant: no row with ${String(count)} recipients`);
  return index;
}

describe('the account is never a counterparty, and never a reason for NOT_FOUND (real capture, 2026-10-06)', () => {
  it('a row to the account and another person: one row, for the other person; the address is nowhere', async () => {
    const clean = await planVariant();
    const plan = await planVariant({
      mutate: (doc) => {
        recipientIsAccount(doc, rowWith(doc, 2), 0, 'Avery.Founder@Example.com');
      },
    });
    expect(plan.status).toBe('OK');
    expect(plan.observations).toHaveLength(clean.observations.length - 1);
    expect(JSON.stringify(plan).toLowerCase()).not.toContain(ACCOUNT);
  });

  it('a row only to the account gives no row, and the window starts after its minute', async () => {
    const clean = await planVariant();
    let key = '';
    const plan = await planVariant({
      mutate: (doc) => {
        key = recipientIsAccount(doc, rowWith(doc, 1), 0, 'AVERY.FOUNDER@example.com');
      },
    });
    expect(plan.status).toBe('OK');
    expect(plan.observations).toHaveLength(clean.observations.length - 1);
    expect(JSON.stringify(plan).toLowerCase()).not.toContain(ACCOUNT);
    expect(key).not.toBe('');
    // The send's own minute, from the clean pass: the window now starts a minute after it, so it vouches for no
    // claim at that minute.
    const removed = clean.observations.filter(
      (o) => !plan.observations.some((p) => p.contentHash === o.contentHash),
    );
    const [gone] = removed;
    expect(removed).toHaveLength(1);
    const [window] = plan.status === 'OK' ? plan.coverage : [];
    expect(Date.parse(window?.windowStart ?? '')).toBeGreaterThanOrEqual(
      Date.parse(gone?.occurredAt ?? '') + MINUTE,
    );
  });

  it('another address is kept exactly as written, whatever its case', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        recipientIsAccount(doc, rowWith(doc, 1), 0, 'Avery.Founder@Example.org');
      },
    });
    expect(plan.observations.map((o) => o.counterparty)).toContain('Avery.Founder@Example.org');
  });
});

describe('isOwnAddress: every spelling the account receives mail at (security re-review, SEC-R7)', () => {
  it.each([
    ['the same address in another case', 'Avery.Founder@Example.com', ACCOUNT],
    ['a +tag', 'avery.founder+notes@example.com', ACCOUNT],
    ['Gmail without the dots', 'averyfounder@gmail.com', 'avery.founder@gmail.com'],
    ['Gmail with other dots and a tag', 'a.very.founder+x@googlemail.com', 'avery.founder@gmail.com'],
  ])('%s is the account', (_label, address, account) => {
    expect(isOwnAddress(address, account)).toBe(true);
  });

  it.each([
    ['another domain', 'avery.founder@example.org', ACCOUNT],
    ['dots outside Gmail', 'averyfounder@example.com', ACCOUNT],
    ['an unknown account', ACCOUNT, null],
    ['not an address', 'Avery Founder', ACCOUNT],
  ])('%s is not', (_label, address, account) => {
    expect(isOwnAddress(address, account)).toBe(false);
  });
});
