/**
 * The Gmail receipt observer as an observer (sprint_2 2.3; build_spec §7 adapter contract; docs/grading.md §3):
 *
 *  - its coverage is the instant of each receipt it parsed (sprint_2 2.7): a pass posts its health, its observations
 *    and one coverage.ping per parsed message whose window is that message's date and nothing more (an opened
 *    message says nothing about the other mail around it); a list view, or a pass that parsed nothing, posts none;
 *  - health is neutral where there is nothing to read (a list view), and DEGRADED, naming the landmark, where a
 *    conversation is open but a landmark the parsers need is missing (Hard Rule 6);
 *  - it is read-only: a pass leaves the page byte for byte as it found it (Hard Rule 3);
 *  - its selectors file is versioned and checked when it loads, and anchors on no class name.
 */
import { describe, expect, it, vi } from 'vitest';

import type { BusMessage } from '../../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { ComponentId, IsoTs } from '../../../../src/core/schema';
import { accountHashOf } from '../../../../src/observers/account';
import { assertObserver, runPass } from '../../../../src/observers/base';
import { ObserverError } from '../../../../src/observers/errors';
import { ReceiptError } from '../../../../src/observers/gmail/receipts/errors';
import { loadReceiptSelectors } from '../../../../src/observers/gmail/receipts/selectors';
import rawSelectors from '../../../../src/observers/gmail/receipts/selectors.json';
import { RECEIPT_SELECTORS, receiptObserver } from '../../../../src/observers/gmail/receipts';
import type { Observer } from '../../../../src/observers/types';
import { LIST_URL, type MessageSpec, onPage, type PageSpec, rows, THREAD_URL } from './message-page';
import { withPage } from './receipt-fixtures';

const NOW = '2026-10-03T10:30:00.000-04:00';
const RECEIPT: MessageSpec = { from: 'noreply@uber.com', body: rows([['Total', '$23.84']]) };
const SUBJECT = 'Your Thursday evening trip with Uber';
const UBER: PageSpec = { subject: SUBJECT, messages: [RECEIPT] };

async function pass(observer: Observer, spec: PageSpec, url = THREAD_URL): Promise<BusMessage[]> {
  const messages: BusMessage[] = [];
  const post = (message: BusMessage): Promise<unknown> => {
    messages.push(message);
    return Promise.resolve(undefined);
  };
  await onPage(
    spec,
    (doc) =>
      runPass(observer, {
        doc,
        post,
        now: () => NOW,
        offsetAt: () => -240,
        policy: DEFAULT_POLICY,
        userActive: () => true,
      }),
    url,
  );
  return messages;
}

const AT = '2026-10-02T16:17:00-04:00';

describe('coverage: the instant of each parsed receipt (sprint_2 2.7; docs/grading.md §3; Hard Rule 5)', () => {
  it('a clean pass posts health OK, its observation, then one ping whose window is the message instant', async () => {
    const messages = await pass(receiptObserver, UBER);
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    const [health, , ping] = messages;
    expect(health?.type === 'adapter.health' ? health.health : null).toMatchObject({
      adapterId: 'gmail.receipt',
      version: RECEIPT_SELECTORS.version,
      status: 'OK',
      reasons: [],
    });
    expect(ping?.type === 'coverage.ping' ? ping.ping : null).toEqual({
      observerId: 'gmail.receipt',
      source: 'gmail.receipt',
      lastSyncAt: NOW,
      windowStart: AT,
      windowEnd: AT,
      accountHash: accountHashOf('avery.founder@example.com'),
      userActive: true,
    });
  });

  it('a pass with nothing to read (a list view) posts only its health, OK, and never reads the account', async () => {
    const account = vi.fn(() => 'avery.founder@example.com');
    const spied: Observer = { ...receiptObserver, account };
    const messages = await pass(spied, { subject: null, messages: [] }, LIST_URL);
    expect(messages.map((m) => m.type)).toEqual(['adapter.health']);
    expect(account).not.toHaveBeenCalled();
  });

  it('an opened message that is no receipt posts its health, OK, and no coverage', async () => {
    const note = { from: 'friend@example.org', body: rows([['Lunch', 'Thursday']]) };
    const messages = await pass(receiptObserver, { subject: 'Lunch?', messages: [note] });
    expect(messages.map((m) => m.type)).toEqual(['adapter.health']);
  });
});

describe('receipt coverage: accounts, the contract, refusals', () => {
  it('a page with no account switcher still covers the instant, without an account hash', async () => {
    const messages = await pass(receiptObserver, { ...UBER, account: null });
    const ping = messages.find((m) => m.type === 'coverage.ping');
    expect(ping?.type === 'coverage.ping' ? ping.ping : null).not.toHaveProperty('accountHash');
  });

  it('is a valid observer with one window reader, and a second one is a developer error', () => {
    expect(() => {
      assertObserver(receiptObserver);
    }).not.toThrow();
    expect(receiptObserver.visibleWindow).toBeUndefined();
    const both = { ...receiptObserver, visibleWindow: () => null };
    expect(() => {
      assertObserver(both);
    }).toThrow(new ObserverError('invalid_observer'));
  });

  it('a row project() refuses (a merchant over 120 characters) makes the pass DEGRADED, with no coverage', async () => {
    const shopify = {
      from: 'store+1@t.shopifyemail.com',
      name: 'S'.repeat(121),
      body: rows([['Total', '$5.00']]),
    };
    const messages = await pass(receiptObserver, { subject: 'Order #1 confirmed', messages: [shopify] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ health: { status: 'DEGRADED', reasons: ['redact.invalid_field'] } });
  });

  it('a receipt dated after the pass is DEGRADED window.future: a Gmail window never ends in the future', async () => {
    const future = { ...RECEIPT, title: 'Sat, Oct 3, 2026, 10:31 AM' };
    const messages = await pass(receiptObserver, { subject: SUBJECT, messages: [future] });
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations']);
    expect(messages[0]).toMatchObject({ health: { status: 'DEGRADED', reasons: ['window.future'] } });
  });
});

describe('health: neutral with nothing to read, loud when a landmark is missing (Hard Rule 6)', () => {
  const health = (spec: PageSpec, url = THREAD_URL) =>
    onPage(spec, (doc) => receiptObserver.health(doc), url);

  it('a list view with no conversation open is IDLE: neither OK nor broken (sprint_2 2.11)', () => {
    expect(health({ subject: null, messages: [] }, LIST_URL)).toEqual({
      status: 'IDLE',
      reasons: ['no_conversation'],
    });
  });

  it('an address naming a thread with no message on the page names what is missing', () => {
    expect(health({ subject: null, messages: [] })).toEqual({
      status: 'DEGRADED',
      reasons: ['selector.missing.subject', 'selector.missing.message'],
    });
  });

  it.each([
    ['no sender', { ...RECEIPT, noSender: true }, ['selector.missing.sender']],
    ['no date', { ...RECEIPT, noDate: true }, ['selector.missing.date']],
  ])('an opened message with %s', (_case, message, reasons) => {
    expect(health({ subject: SUBJECT, messages: [message] }, LIST_URL)).toEqual({
      status: 'DEGRADED',
      reasons,
    });
  });

  it('a page with no main landmark is DEGRADED where the address names a thread, and neutral elsewhere', () => {
    const html = '<html><body><p>Loading</p></body></html>';
    expect(withPage(html, THREAD_URL, (doc) => receiptObserver.health(doc))).toEqual({
      status: 'DEGRADED',
      reasons: ['selector.missing.main'],
    });
    expect(withPage(html, LIST_URL, (doc) => receiptObserver.health(doc))).toEqual({
      status: 'IDLE',
      reasons: ['no_conversation'],
    });
  });
});

describe('read-only (Hard Rule 3)', () => {
  it('a pass leaves the page byte for byte as it found it', () => {
    onPage(UBER, (doc) => {
      const before = doc.documentElement.outerHTML;
      const ctx = { observedAt: IsoTs.parse(NOW), offsetAt: () => -240 };
      receiptObserver.health(doc);
      receiptObserver.extract(doc, ctx);
      expect(doc.documentElement.outerHTML).toBe(before);
    });
  });
});

const UBER_KIND = rawSelectors.platforms.uber.kinds[0];

/** The selectors file with one platform's entry patched. */
function withPlatform(id: keyof typeof rawSelectors.platforms, patch: object): object {
  const platforms = { ...rawSelectors.platforms, [id]: { ...rawSelectors.platforms[id], ...patch } };
  return { ...rawSelectors, platforms };
}

describe('selectors.json (agents/adapter_engineer.md rule 3)', () => {
  it('is versioned, and its version is the observer version', () => {
    expect(ComponentId.safeParse(RECEIPT_SELECTORS.version).success).toBe(true);
    expect(receiptObserver.version).toBe(rawSelectors.version);
  });

  it('anchors on no class name: no landmark selector holds a .class', () => {
    for (const selector of Object.values(rawSelectors.landmarks)) {
      expect(selector.replace(/\[[^\]]*\]/gu, '').replace(/"[^"]*"/gu, ''), selector).not.toMatch(
        /\.[A-Za-z_-]/u,
      );
    }
  });

  it.each([
    ['an unknown key', { ...rawSelectors, extra: 1 }],
    ['a regex that does not compile', { ...rawSelectors, threadUrl: '(' }],
    [
      'a currency that is not ISO 4217',
      { ...rawSelectors, generic: { ...rawSelectors.generic, defaultDollar: 'XYZ' } },
    ],
    ['two platforms claiming one domain', withPlatform('uber', { senderDomains: ['stripe.com'] })],
    ['a subject merchant rule with no merchant group', withPlatform('opentable', { kinds: [UBER_KIND] })],
    [
      'a kind with no labels and no item group',
      withPlatform('uber', { kinds: [{ ...UBER_KIND, labels: [] }] }),
    ],
  ])('refuses %s, whole (never half-loaded)', (_case, broken) => {
    expect(() => loadReceiptSelectors(broken)).toThrow(new ReceiptError('invalid_selectors'));
  });
});
