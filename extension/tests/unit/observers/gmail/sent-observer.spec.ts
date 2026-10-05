/**
 * The Gmail Sent observer as the skeleton runs it (sprint_2 2.2 with src/observers/base.ts from 2.0): a valid
 * observer definition, versioned selectors that never anchor on a class or an id, a pass that never writes the page
 * (Hard Rule 3), and the bus messages a pass posts: health, observations and a coverage ping on the Sent list, only a
 * DEGRADED health on Drafts, every message valid, the account only as a hash, no seeded secret (Hard Rules 2, 10).
 */
import { describe, expect, it } from 'vitest';

import { BusMessage } from '../../../../src/bus/messages';
import { OBSERVER_HOSTS } from '../../../../src/config';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { ComponentId } from '../../../../src/core/schema';
import { accountHashOf } from '../../../../src/observers/account';
import { assertObserver, runPass } from '../../../../src/observers/base';
import { SENT_SELECTORS } from '../../../../src/observers/gmail/selectors';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import { planPass } from '../../../../src/observers/plan';
import { findLeaks, loadSeeds } from '../../../e2e/support/leaks';
import { fixtureCtx, fixtureNamed, gmailFixtures, openFixture } from './sent-fixtures';

describe('the observer definition and its selectors', () => {
  it('is a valid observer of gmail.sent on the Gmail host, versioned by selectors.json', () => {
    expect(() => {
      assertObserver(gmailSentObserver);
    }).not.toThrow();
    expect(gmailSentObserver).toMatchObject({ id: 'gmail.sent', vendor: 'gmail', source: 'gmail.sent' });
    expect(gmailSentObserver.version).toBe(SENT_SELECTORS.version);
    expect(ComponentId.safeParse(SENT_SELECTORS.version).success).toBe(true);
    expect(gmailSentObserver.hosts).toEqual(OBSERVER_HOSTS.gmail);
    expect(Object.isFrozen(gmailSentObserver)).toBe(true);
  });

  it('no selector anchors on a class name or an element id', () => {
    for (const [name, selector] of Object.entries(SENT_SELECTORS.selectors)) {
      expect(selector, name).not.toMatch(/(?:^|[\s>+~,(])[\w-]*[.#][A-Za-z_-]/u);
      expect(selector, name).not.toMatch(/\[\s*(?:class|id)\s*[\]~|^$*]?=?/u);
    }
  });

  it('every selector is valid CSS on a fixture page', async () => {
    const page = openFixture(fixtureNamed('synthetic-sent-page-1.html'));
    try {
      for (const selector of Object.values(SENT_SELECTORS.selectors)) {
        expect(() => page.doc.querySelectorAll(selector), selector).not.toThrow();
      }
    } finally {
      await page.close();
    }
  });
});

describe('read-only (Hard Rule 3)', () => {
  it('a pass over every Gmail fixture changes nothing in the page', async () => {
    for (const fixture of gmailFixtures()) {
      const page = openFixture(fixture);
      const before = page.doc.documentElement.outerHTML;
      planPass({
        observer: gmailSentObserver,
        doc: page.doc,
        ctx: fixtureCtx(fixture),
        policy: DEFAULT_POLICY,
      });
      expect(page.doc.documentElement.outerHTML, fixture.file).toBe(before);
      await page.close();
    }
  });
});

async function postedFor(file: string): Promise<BusMessage[]> {
  const fixture = fixtureNamed(file);
  const page = openFixture(fixture);
  const messages: BusMessage[] = [];
  try {
    await runPass(gmailSentObserver, {
      doc: page.doc,
      post: (message) => {
        messages.push(BusMessage.parse(JSON.parse(JSON.stringify(message))));
        return Promise.resolve(undefined);
      },
      now: () => fixture.page.readAt,
      offsetAt: fixtureCtx(fixture).offsetAt,
      policy: DEFAULT_POLICY,
      userActive: () => true,
    });
  } finally {
    await page.close();
  }
  return messages;
}

describe('what the skeleton posts', () => {
  it('Sent page 1: health OK, the 11 observations, then a ping with the account hash and the window', async () => {
    const messages = await postedFor('synthetic-sent-page-1.html');
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    const [, observations, ping] = messages;
    expect(observations?.type === 'observer.observations' && observations.observations).toHaveLength(11);
    expect(ping).toMatchObject({
      type: 'coverage.ping',
      ping: {
        observerId: 'gmail.sent',
        source: 'gmail.sent',
        lastSyncAt: '2026-10-03T10:15:00-04:00',
        windowStart: '2026-09-29T17:55:00-04:00',
        windowEnd: '2026-10-03T10:15:00-04:00',
        accountHash: accountHashOf('avery.founder@example.com'),
      },
    });
  });

  it('Sent page 2: health OK and its observations, never a ping (only the head asserts coverage)', async () => {
    const messages = await postedFor('synthetic-sent-page-2.html');
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations']);
    expect(messages[0]).toMatchObject({ health: { adapterId: 'gmail.sent', status: 'OK', reasons: [] } });
  });

  it('Drafts: only a DEGRADED health report, naming the observer and its version', async () => {
    expect(await postedFor('synthetic-drafts.html')).toEqual([
      {
        type: 'adapter.health',
        health: {
          adapterId: 'gmail.sent',
          version: SENT_SELECTORS.version,
          status: 'DEGRADED',
          reasons: ['not_sent_folder'],
          checkedAt: '2026-10-03T10:20:00-04:00',
        },
      },
    ]);
  });

  it('no message carries a seeded secret or an account address', async () => {
    const seeds = loadSeeds();
    for (const fixture of gmailFixtures()) {
      const messages = await postedFor(fixture.file);
      expect(findLeaks(fixture.file, messages, seeds), fixture.file).toEqual([]);
      expect(JSON.stringify(messages).toLowerCase()).not.toContain(fixture.page.account.toLowerCase());
    }
  });
});
