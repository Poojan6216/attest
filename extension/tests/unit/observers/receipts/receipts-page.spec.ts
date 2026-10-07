/**
 * What the receipt observer reads of the Gmail page (sprint_2 close: TECH-5, TECH-14; Hard Rules 5, 6):
 *
 *  - only the main landmark Gmail shows (src/observers/shown.ts, the rule gmail.sent and gcal.event read with): a
 *    conversation kept hidden is never the one open, and two shown main landmarks are `selector.ambiguous.main`;
 *  - the account through the shared Google-account reader: in any display language (so the user's own mail is told
 *    apart, and coverage carries the account hash), and two accounts are `selector.ambiguous.account`;
 *  - the page address through Gmail's own fragment reader (src/observers/gmail/route.ts), so a compose window over
 *    an open thread still names the thread;
 *  - every reason health gives is in the closed list RECEIPT_HEALTH_REASONS.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs } from '../../../../src/core/schema';
import { accountHashOf } from '../../../../src/observers/account';
import {
  RECEIPT_SELECTORS,
  receiptObserver,
  receiptVerdicts,
} from '../../../../src/observers/gmail/receipts';
import { RECEIPT_HEALTH_REASONS } from '../../../../src/observers/gmail/receipts/health';
import { type PassPlan, planPass } from '../../../../src/observers/plan';
import type { HealthCheck } from '../../../../src/observers/types';
import {
  ACCOUNT,
  LIST_URL,
  type MessageSpec,
  messagePage,
  type PageSpec,
  rows,
  THREAD_URL,
} from './message-page';
import { withPage } from './receipt-fixtures';

const ctx = { observedAt: IsoTs.parse('2026-10-03T10:30:00-04:00'), offsetAt: () => -240 };
const AT = '2026-10-02T16:17:00-04:00';
const UBER_RECEIPT: MessageSpec = { from: 'noreply@uber.com', body: rows([['Total', '$23.84']]) };
const UBER: PageSpec = { subject: 'Your Thursday evening trip with Uber', messages: [UBER_RECEIPT] };
const MAIN_TAG = /<div class="[^"]*" role="main">/u;

interface Run {
  readonly health: HealthCheck;
  readonly plan: PassPlan;
}

const run = (html: string, url = THREAD_URL): Run =>
  withPage(html, url, (doc) => ({
    health: receiptObserver.health(doc),
    plan: planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
  }));

const reasonsOf = (health: HealthCheck): readonly string[] =>
  health.status === 'DEGRADED' ? health.reasons : [];

describe('a message drawn as real Gmail draws it (capture of 2026-10-06)', () => {
  it('the key on an element inside the list item: the receipt is read by that key, with the same row and point', () => {
    const flat = run(messagePage(UBER));
    const nested = run(messagePage({ ...UBER, messages: [{ ...UBER_RECEIPT, nestedKey: true }] }));
    expect(flat.plan.status).toBe('OK');
    expect(nested.health).toEqual({ status: 'OK' });
    expect(nested.plan).toEqual(flat.plan);
  });

  it('a list inside a message (attachment chips) is no message: nothing missing, nothing extra', () => {
    const nested = run(
      messagePage({ ...UBER, messages: [{ ...UBER_RECEIPT, nestedKey: true, expanded: null }] }),
    );
    expect(nested.health).toEqual({ status: 'OK' });
    expect(nested.plan.observations).toHaveLength(1);
  });
});

describe('which list items are messages (re-review: QA-R2, QA-R3, SEC-R9)', () => {
  it('a collapsed message drawn without its key is still a message: every message collapsed is OK', () => {
    const collapsed = run(
      messagePage({ ...UBER, messages: [{ ...UBER_RECEIPT, noKey: true, expanded: 'false' }] }),
    );
    expect(collapsed.health).toEqual({ status: 'OK' });
  });

  it('a list item in the main region of a list page is no conversation: OK, nothing read', () => {
    const html = messagePage(UBER)
      .replace(/<h2[^>]*>[^<]*<\/h2>/u, '')
      .replace(
        /<div class="[^"]*" role="listitem"[\s\S]*<\/div><\/div><\/div><\/body>/u,
        '<div role="listitem">Label</div></div></div></body>',
      );
    const page = run(html, LIST_URL);
    expect(page.health).toEqual({ status: 'OK' });
    expect(page.plan.observations).toEqual([]);
  });

  it('a list item inside a message body, even with aria-expanded, is part of that message: the receipt is read', () => {
    const body = `${rows([['Total', '$23.84']])}<div role="list"><div role="listitem" aria-expanded="true">Trip</div></div>`;
    const page = run(messagePage({ ...UBER, messages: [{ ...UBER_RECEIPT, body }] }));
    expect(page.health).toEqual({ status: 'OK' });
    expect(page.plan.observations).toHaveLength(1);
  });
});

describe('a page that names no account (security re-review, SEC-R8)', () => {
  it('the generic parser reads nothing there: the account’s own order mail cannot be told apart', () => {
    const own: PageSpec = {
      subject: 'Order confirmation',
      account: null,
      messages: [{ from: ACCOUNT, name: ACCOUNT, body: rows([['Order total', '$10.00']]) }],
    };
    expect(run(messagePage(own)).plan.observations).toEqual([]);
    // The same message from a shop is a generic receipt once the page names the account.
    const shop: PageSpec = {
      ...own,
      account: ACCOUNT,
      messages: [{ from: 'orders@bakery.example', name: 'Bakery', body: rows([['Order total', '$10.00']]) }],
    };
    expect(run(messagePage(shop)).plan.observations).toHaveLength(1);
    expect(run(messagePage({ ...shop, account: null })).plan.observations).toEqual([]);
  });

  it('a registry receipt is still read there: its sender is the merchant, never the account', () => {
    expect(run(messagePage({ ...UBER, account: null })).plan.observations).toHaveLength(1);
  });
});

describe('only the main landmark Gmail shows is read (TECH-5)', () => {
  it('a conversation kept hidden beside a shown list is not read: OK, nothing reported', () => {
    const stale = messagePage(UBER).replace('role="main"', 'role="main" hidden');
    const html = stale.replace('</body>', '<div role="main"><div role="grid"></div></div></body>');
    expect(run(html, LIST_URL)).toEqual({
      health: { status: 'OK' },
      plan: { status: 'OK_NO_COVERAGE', observations: [] },
    });
  });

  it('a hidden list kept before the shown conversation is passed over: the conversation is read', () => {
    const page = messagePage(UBER);
    const tag = MAIN_TAG.exec(page)?.[0] ?? '';
    const html = page.replace(tag, `<div role="main" hidden><div role="grid"></div></div>${tag}`);
    const { health, plan } = run(html);
    expect(health).toEqual({ status: 'OK' });
    expect(plan.status === 'OK' && plan.coverage.map((c) => [c.windowStart, c.windowEnd])).toEqual([
      [AT, AT],
    ]);
  });

  it('two shown main landmarks with a conversation open are ambiguous: DEGRADED, nothing read', () => {
    const html = messagePage(UBER).replace(
      '</body>',
      '<div role="main"><h2 data-legacy-thread-id="1a0fe43526000999">Another</h2></div></body>',
    );
    const { health, plan } = run(html);
    expect(health).toEqual({ status: 'DEGRADED', reasons: ['selector.ambiguous.main'] });
    expect(plan).toEqual({ status: 'DEGRADED', reasons: ['selector.ambiguous.main'], observations: [] });
  });
});

describe('the account in any display language, and only one (TECH-5)', () => {
  const french = (spec: PageSpec): string =>
    messagePage(spec).replace('Google Account: Avery Founder', 'Compte Google : Avery Founder');

  it('a French switcher still names the account: the coverage carries its hash', () => {
    const { plan } = run(french(UBER));
    expect(plan.status === 'OK' && plan.coverage.map((c) => c.accountHash)).toEqual([accountHashOf(ACCOUNT)]);
  });

  it("a French switcher still tells the user's own mail apart: it gets no parser", () => {
    const own = {
      subject: 'Your order confirmation',
      messages: [{ from: ACCOUNT, name: 'Avery Founder', body: rows([['Order total', '$40.00']]) }],
    };
    const verdicts = withPage(french(own), THREAD_URL, receiptVerdicts);
    expect(verdicts.map((v) => [v.parser, v.verdict.kind])).toEqual([[null, 'none']]);
  });

  it('two accounts in the banner where a conversation is open: DEGRADED selector.ambiguous.account', () => {
    const second = '<a aria-label="Google Account: Casey&#10;(casey.second@example.net)" role="button">C</a>';
    const html = messagePage(UBER).replace('</header>', `${second}</header>`);
    const { health, plan } = run(html);
    expect(health).toEqual({ status: 'DEGRADED', reasons: ['selector.ambiguous.account'] });
    expect(plan.status).toBe('DEGRADED');
    const list = messagePage({ subject: null, messages: [] }).replace('</header>', `${second}</header>`);
    expect(run(list, LIST_URL).health).toEqual({ status: 'OK' });
  });
});

describe("Gmail's address and placeholders come from one place (TECH-14)", () => {
  it('a compose window over an open thread still names the thread: a page with no main is DEGRADED', () => {
    const html = '<html><body><p>Loading</p></body></html>';
    expect(run(html, `${THREAD_URL}?compose=new`).health).toEqual({
      status: 'DEGRADED',
      reasons: ['selector.missing.main'],
    });
    expect(run(html, `${LIST_URL}?compose=new`).health).toEqual({ status: 'OK' });
  });

  it("Gmail's empty-subject placeholder is versioned in selectors.json, and no subject hint is made of it", () => {
    expect([...RECEIPT_SELECTORS.noSubject]).toEqual(['(no subject)']);
    const shop = {
      from: 'orders@corner-shop.example',
      name: 'Corner Shop',
      body: rows([['Total', '$12.34']]),
    };
    const { plan } = run(messagePage({ subject: '(no subject)', messages: [shop] }));
    expect(plan.observations.map((o) => [o.amountCents, o.subjectHint])).toEqual([[1234, undefined]]);
  });

  it('every reason a page above gave is in the closed list', () => {
    const listed: readonly string[] = RECEIPT_HEALTH_REASONS;
    const second = '<a aria-label="Google Account: Casey&#10;(casey.second@example.net)" role="button">C</a>';
    const pages = [
      messagePage(UBER).replace('</header>', `${second}</header>`),
      messagePage(UBER).replace(
        '</body>',
        '<div role="main"><h2 data-legacy-thread-id="1">x</h2></div></body>',
      ),
      '<html><body><p>Loading</p></body></html>',
      messagePage({ subject: null, messages: [] }),
    ];
    const given = pages.flatMap((html) => reasonsOf(run(html).health));
    expect(given.length).toBeGreaterThan(0);
    for (const reason of given) expect(listed, reason).toContain(reason);
  });
});
