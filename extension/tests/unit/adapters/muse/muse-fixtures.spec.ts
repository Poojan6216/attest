// @vitest-environment happy-dom
/**
 * The Muse adapter on its labelled fixtures (sprint_3 3.2 Done-when; tests/fixtures/pages/muse/, synthetic until the
 * founder captures Muse): each page's health, Requests, Claims and scopes are its label's; re-rendering the same
 * conversation gives no duplicate Claim (rawHash); the approval prompt is one Claim of type `other` from the chat,
 * never an action; a missing landmark is DEGRADED by name (Hard Rule 6); and it is valid only for Muse's site, where no
 * content script runs it while Muse's reader is off under Meta's terms (Hard Rule 8; Decisions [3.10]).
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assertAdapter, planAdapterPass } from '../../../../src/adapters/base';
import { AdapterError } from '../../../../src/adapters/errors';
import { MUSE_CHAT } from '../../../../src/adapters/muse/adapter';
import { PROPOSAL_CONFIDENCE } from '../../../../src/adapters/patterns';
import { IsoTs } from '../../../../src/core/schema';
import { type AgentFixture, allAgentFixtures } from '../../fixtures/agent-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';

const FIXTURES = allAgentFixtures().filter((fixture) => fixture.vendor === 'muse');

const docOf = (fixture: AgentFixture): Document =>
  new DOMParser().parseFromString(readFileSync(fixture.htmlPath, 'utf8'), 'text/html');

const planOf = (fixture: AgentFixture, doc: Document = docOf(fixture)) =>
  planAdapterPass(MUSE_CHAT, doc, {
    observedAt: IsoTs.parse(fixture.page.readAt),
    offsetAt: zoneOffset(fixture.page.timeZone),
  });

/** The fields a claim label states, as the claim or the label holds them. */
const CLAIM_FIELDS = [
  'type',
  'counterparty',
  'subjectHint',
  'amountCents',
  'currency',
  'claimedAt',
  'claimedAtPrecision',
  'claimedAtEnd',
  'sourceKind',
] as const;

const claimFacts = (
  claim: Partial<Record<(typeof CLAIM_FIELDS)[number], unknown>>,
): Record<string, unknown> =>
  Object.fromEntries(
    CLAIM_FIELDS.filter((field) => claim[field] !== undefined).map((field) => [field, claim[field]]),
  );

const byName = (name: string): AgentFixture => {
  const fixture = FIXTURES.find((f) => f.file === name);
  if (fixture === undefined) throw new Error(`no fixture ${name}`);
  return fixture;
};

describe('the Muse fixtures', () => {
  it('cover a conversation, the activity view, connected apps, an approval prompt and a page Muse does not read', () => {
    expect(FIXTURES.map((f) => f.page.view).sort()).toEqual([
      'agent.activity',
      'agent.conversation',
      'agent.conversation',
      'agent.other',
      'agent.settings',
    ]);
    expect(byName('synthetic-conversation.html').requests.length).toBeGreaterThanOrEqual(5);
  });
});

describe.each(FIXTURES.map((fixture) => [fixture.file, fixture] as const))('%s', (_, fixture) => {
  const plan = planOf(fixture);

  it('reports its labelled health', () => {
    expect({ status: plan.status, reasons: plan.reasons }).toEqual({
      status: fixture.health.status,
      reasons: fixture.health.reasons,
    });
  });

  it('reads its labelled requests, in page order', () => {
    expect(plan.facts.requests.map((r) => ({ textHint: r.textHint, ts: r.ts }))).toEqual(
      fixture.requests.map((r) => ({ textHint: r.textHint, ts: r.ts })),
    );
  });

  it('reads its labelled claims, in page order, each linked to the request before it', () => {
    expect(plan.facts.claims.map(claimFacts)).toEqual(fixture.claims.map(claimFacts));
    for (const claim of plan.facts.claims) {
      if (claim.sourceKind === 'activity_view') expect(claim).not.toHaveProperty('requestId');
      else expect(plan.facts.requests.map((r) => r.id)).toContain(claim.requestId);
    }
  });

  it('reads its labelled scopes', () => {
    expect(plan.scopes).toEqual(fixture.scopes);
  });
});

describe('the Muse adapter', () => {
  it('re-rendering the same conversation gives no duplicate claim (rawHash)', () => {
    const fixture = byName('synthetic-conversation.html');
    const once = planOf(fixture).facts.claims.map((c) => c.id);
    const again = planOf(fixture, docOf(fixture)).facts.claims.map((c) => c.id);
    expect(again).toEqual(once);
    expect(new Set([...once, ...again]).size).toBe(once.length);
  });

  it('reads an approval prompt as one `other` claim from the chat at the proposal confidence, never an action', () => {
    const { claims } = planOf(byName('synthetic-approval.html')).facts;
    expect(claims.map((c) => [c.type, c.sourceKind, c.extractor.confidence])).toEqual([
      ['other', 'chat', PROPOSAL_CONFIDENCE],
    ]);
  });

  it('never reads the text beside a message: a quoted email, an approval card', () => {
    for (const name of ['synthetic-conversation.html', 'synthetic-approval.html']) {
      const fixture = byName(name);
      const read = JSON.stringify(
        MUSE_CHAT.extract(docOf(fixture), {
          observedAt: IsoTs.parse(fixture.page.readAt),
          offsetAt: () => -240,
        }),
      );
      expect(read).not.toContain('data-attest-seeded');
      for (const id of fixture.label.seededSecrets) {
        const seeded = docOf(fixture).querySelector(`[data-attest-seeded="${id}"]`)?.textContent ?? '';
        expect(read).not.toContain(seeded);
      }
    }
  });

  it('is DEGRADED, naming the landmark, when a message has no text element', () => {
    const fixture = byName('synthetic-conversation.html');
    const doc = docOf(fixture);
    doc.querySelector('[data-message-text]')?.removeAttribute('data-message-text');
    expect(planOf(fixture, doc)).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.message_text'],
    });
  });

  it('is valid only for Muse’s site, though no content script runs it while its reader is off (Hard Rule 8)', () => {
    expect(MUSE_CHAT.hosts).toEqual(['https://muse.ai/*']);
    expect(() => {
      assertAdapter(MUSE_CHAT);
    }).not.toThrow();
    expect(() => {
      assertAdapter({ ...MUSE_CHAT, hosts: ['https://chatgpt.com/*'] });
    }).toThrow(AdapterError);
  });
});
