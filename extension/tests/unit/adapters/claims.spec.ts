/**
 * src/adapters/claims.ts (sprint_3 3.0; docs/grading.md §10): Requests and Claims from one read of an agent page.
 *  - ids per §10, `rawHash` checked against the golden builder's independent reading of the same rule;
 *  - a sentence re-rendered is one claim, the same words at another minute another (red-team strategies 9 and 1);
 *  - a turn whose time is missing, unreadable or after the pass gives nothing and is counted (Hard Rules 5, 6);
 *  - the fields a claim takes from its sentence, and the text that never leaves whole (Hard Rule 2).
 * Every turn and entry here is invented (agents/adapter_engineer.md: no value from a real page).
 */
import { describe, expect, it } from 'vitest';

import {
  type AgentFacts,
  buildFacts,
  type FactsContext,
  sentences,
  unitStart,
} from '../../../src/adapters/claims';
import { PROPOSAL_CONFIDENCE } from '../../../src/adapters/patterns';
import type { AgentRead, AgentTurn } from '../../../src/adapters/types';
import { idFromHash } from '../../../src/core/base32';
import { hashCanonical, sha256Hex } from '../../../src/core/hash';
import { Claim, IsoTs, Request } from '../../../src/core/schema';
import { buildClaim } from '../../golden/build';

const NOW = IsoTs.parse('2026-10-01T14:30:00-04:00');
/** Eastern daylight time throughout: a fixed offset keeps the expectations exact in any test time zone. */
const CTX: FactsContext = {
  agent: 'claude',
  extractor: { id: 'claude.chat', version: '0.1.0' },
  observedAt: NOW,
  offsetAt: () => -240,
};

const read = (turns: AgentTurn[], extra: Partial<AgentRead> = {}): AgentRead => ({
  conversationId: 'c-7f3a',
  turns,
  activity: [],
  scopes: null,
  ...extra,
});
const user = (text: string, time: string | null = '2026-10-01T14:00:00-04:00'): AgentTurn => ({
  role: 'user',
  text,
  time,
});
const agent = (
  text: string,
  time: string | null = '2026-10-01T14:01:00-04:00',
  rowKey?: string,
): AgentTurn => ({
  role: 'agent',
  text,
  time,
  ...(rowKey === undefined ? {} : { rowKey }),
});
const build = (input: AgentRead): AgentFacts => buildFacts(input, CTX);

describe('Requests (§10)', () => {
  it('one per user turn: its text hash, a hint, its time, and the §10 id', () => {
    const facts = build(read([user('Please email Dana   the\nvenue options.')]));
    const text = 'Please email Dana the venue options.';
    const textHash = sha256Hex(text);
    const ts = '2026-10-01T14:00:00-04:00';
    expect(facts.requests).toEqual([
      {
        id: idFromHash(hashCanonical({ agent: 'claude', conversationId: 'c-7f3a', textHash, ts })),
        agent: 'claude',
        conversationId: 'c-7f3a',
        textHint: text,
        textHash,
        ts,
      },
    ]);
    for (const request of facts.requests) expect(Request.parse(request)).toEqual(request);
  });

  it('a hint is the first 200 code units, never half a surrogate pair', () => {
    const long = `${'a'.repeat(199)}😀 and more`;
    const [request] = build(read([user(long)])).requests;
    expect(request?.textHint).toBe('a'.repeat(199));
    expect(request?.textHash).toBe(sha256Hex(long));
  });

  it('none on a page without a conversation id, and none, counted, for a turn with no readable time', () => {
    expect(build(read([user('Book a table.')], { conversationId: null })).requests).toEqual([]);
    const facts = build(read([user('Book a table.', null), user('And a cab.', 'whenever')]));
    expect(facts.requests).toEqual([]);
    expect(facts.untimed).toBe(2);
  });

  it('a conversation id that is not a vendor id token fails its schema and is counted, never sent', () => {
    const facts = build(read([user('Book a table.')], { conversationId: 'My trip to Lisbon' }));
    expect(facts.requests).toEqual([]);
    expect(facts.invalid).toBe(1);
  });
});

describe('Claims (§10)', () => {
  it('one per claiming sentence of an agent turn, linked to the request before it', () => {
    const facts = build(
      read([
        user('Please email Dana the venue options.'),
        agent('Sure. I sent an email to dana@example.com with the options. Anything else?'),
      ]),
    );
    expect(facts.claims).toHaveLength(1);
    const [claim] = facts.claims;
    expect(claim).toMatchObject({
      agent: 'claude',
      requestId: facts.requests[0]?.id,
      type: 'email.sent',
      counterparty: 'dana@example.com',
      claimedAt: '2026-10-01T14:01:00-04:00',
      claimedAtPrecision: 'minute',
      observedAt: NOW,
      sourceKind: 'chat',
      extractor: { id: 'claude.chat', version: '0.1.0', confidence: 0.9 },
    });
    expect(Claim.parse(claim)).toEqual(claim);
  });

  it('rawHash and id are what the golden builder derives from the same text, time and row key', () => {
    const sentence = 'I sent an email to dana@example.com with the options.';
    const [claim] = build(read([agent(sentence, '2026-10-01T14:01:37-04:00', 'turn-7')])).claims;
    const golden = buildClaim({
      ref: 'c1',
      agent: 'claude',
      type: 'email.sent',
      claimedAt: IsoTs.parse('2026-10-01T14:01:37-04:00'),
      claimedAtPrecision: 'minute',
      sourceKind: 'chat',
      text: sentence,
      rowKey: 'turn-7',
    });
    expect(claim?.rawHash).toBe(golden.rawHash);
    expect(claim?.id).toBe(golden.id);
  });

  it('a sentence re-rendered is one claim; the same words a minute later another', () => {
    const line = 'Sent an email to sam@example.org.';
    const twice = build(read([agent(line), agent(line)]));
    expect(twice.claims).toHaveLength(1);
    const again = build(read([agent(line)]));
    expect(again.claims[0]?.id).toBe(twice.claims[0]?.id);
    const later = build(read([agent(line), agent(line, '2026-10-01T14:02:00-04:00')]));
    expect(new Set(later.claims.map((c) => c.id)).size).toBe(2);
  });
});

describe('Claims: kinds and links', () => {
  it('an activity entry is an activity_view claim with no request; a proposal is `other` at 0.2', () => {
    const facts = build(
      read([user('Plan the offsite.'), agent('Should I book the venue for Friday?')], {
        activity: [{ text: 'Created event "Venue visit"', time: '2:03 PM' }],
      }),
    );
    expect(facts.claims.map((c) => [c.type, c.sourceKind, c.requestId === undefined])).toEqual([
      ['other', 'chat', false],
      ['calendar.created', 'activity_view', true],
    ]);
    expect(facts.claims[0]?.extractor.confidence).toBe(PROPOSAL_CONFIDENCE);
    expect(facts.claims[1]?.subjectHint).toBe('Venue visit');
  });

  it('a later user turn starts a new link; an agent turn before any request has none', () => {
    const facts = build(
      read([
        agent('I emailed dana@example.com.'),
        user('Now text Sam.'),
        agent('I texted Sam that you are on the way.'),
      ]),
    );
    expect(facts.claims.map((c) => c.requestId)).toEqual([undefined, facts.requests[0]?.id]);
  });
});

describe('Claims: one turn', () => {
  it('makes one claim per action it reports, and no `other` beside them', () => {
    const facts = build(
      read([agent('Done! I emailed dana@example.com the agenda. I also texted Sam the address.')]),
    );
    expect(facts.claims.map((c) => c.type)).toEqual(['email.sent', 'message.sent']);
  });

  it('makes at most one `other` when it reports no action: an approval prompt is one proposal', () => {
    const facts = buildFacts(
      read([agent('Ready to buy the lamp for $34.99? Tap Approve to place the order.')]),
      { ...CTX, agent: 'muse' },
    );
    expect(facts.claims.map((c) => [c.type, c.extractor.confidence])).toEqual([
      ['other', PROPOSAL_CONFIDENCE],
    ]);
  });
});

describe('times', () => {
  it('reads vendor-relative text against the pass instant in the user’s zone', () => {
    const facts = build(read([agent('Sent an email to sam@example.org.', '2:03 PM')]));
    expect(facts.claims[0]).toMatchObject({
      claimedAt: '2026-10-01T14:03:00-04:00',
      claimedAtPrecision: 'minute',
    });
    const day = build(read([agent('Sent an email to sam@example.org.', 'Yesterday')]));
    expect(day.claims[0]).toMatchObject({
      claimedAt: '2026-09-30T00:00:00-04:00',
      claimedAtPrecision: 'day',
      claimedAtEnd: '2026-10-01T00:00:00-04:00',
    });
  });

  it('writes an instant given in another offset in the user’s', () => {
    const facts = build(read([agent('Sent an email to sam@example.org.', '2026-10-01T18:01:00Z')]));
    expect(facts.claims[0]?.claimedAt).toBe('2026-10-01T14:01:00-04:00');
  });

  it('gives nothing, and counts the turn, for a time missing, unreadable or after the pass', () => {
    for (const time of [null, 'a while ago', '2026-10-01T15:00:00-04:00', '2026-10-01T14:00:00']) {
      const facts = build(read([agent('Sent an email to sam@example.org.', time)]));
      expect(facts.claims, String(time)).toEqual([]);
      expect(facts.untimed, String(time)).toBe(1);
    }
  });

  it('counts no turn that claims nothing, whatever its time', () => {
    expect(build(read([agent('Here is a summary of your week.', null)])).untimed).toBe(0);
  });

  it('truncates a claim time to the start of its unit in its own offset, seconds written (§10)', () => {
    const at = IsoTs.parse('2026-10-01T14:01:37.250-04:00');
    expect(unitStart(at, 'minute')).toBe('2026-10-01T14:01:00-04:00');
    expect(unitStart(at, 'hour')).toBe('2026-10-01T14:00:00-04:00');
    expect(unitStart(at, 'day')).toBe('2026-10-01T00:00:00-04:00');
    expect(unitStart(IsoTs.parse('2026-10-01T00:30:00+05:30'), 'day')).toBe('2026-10-01T00:00:00+05:30');
  });
});

describe('fields', () => {
  const only = (text: string): Claim | undefined => build(read([agent(text)])).claims[0];

  it('an amount keeps its currency when the text names one, only its cents behind a bare $', () => {
    expect(only('Bought a desk lamp for €34.50.')).toMatchObject({ amountCents: 3450, currency: 'EUR' });
    expect(only('Bought a desk lamp for USD 34.50.')).toMatchObject({ amountCents: 3450, currency: 'USD' });
    const dollars = only('Bought a desk lamp for $34.50.');
    expect(dollars?.amountCents).toBe(3450);
    expect(dollars).not.toHaveProperty('currency');
  });

  it('a counterparty is the address named, else the capitalised words of a name, never a day or an article', () => {
    expect(only('I texted Priya Shah the address.')?.counterparty).toBe('Priya Shah');
    expect(only('Emailed the landlord about the leak.')).not.toHaveProperty('counterparty');
    expect(only('Added Monday standup to the team sync.')).not.toHaveProperty('counterparty');
    expect(only('I forwarded the lease to leasing@example.com.')?.counterparty).toBe('leasing@example.com');
  });

  it('a subject hint is one line without its quotes, at most 80 code units', () => {
    expect(only('Created event "Team   sync" for Friday.')?.subjectHint).toBe('Team sync');
    const long = only(`Created event "${'x'.repeat(100)}" for Friday.`);
    expect(long?.subjectHint).toBe('x'.repeat(80));
  });

  it('no claim carries the turn’s text beyond its fields, and no request beyond its hint', () => {
    const secret = 'zq-7781-private-note';
    const facts = build(
      read([user(`Email Dana. ${secret}`), agent(`I sent an email to dana@example.com. ${secret}`)]),
    );
    expect(JSON.stringify(facts.claims)).not.toContain(secret);
    expect(facts.requests[0]?.textHint).toContain(secret);
  });
});

describe('sentences', () => {
  it('splits lines and sentence ends, never an amount or an address', () => {
    expect(sentences('Bought it for $12.99. Sent to dana@example.com!\nDone')).toEqual([
      'Bought it for $12.99.',
      'Sent to dana@example.com!',
      'Done',
    ]);
  });
});
