/**
 * The claim pattern tables (sprint_3 3.0 Done-when; agents/adapter_engineer.md rule 9; src/adapters/patterns.ts):
 *  - every vendor's table types at least 90% of its labelled sentences right: its own corpus
 *    (tests/fixtures/patterns/<vendor>.json, at least 40 invented sentences, positives of every ActionType and
 *    negatives) and the shared one; Dots reads with ChatGPT's table and corpus;
 *  - a miss is never a wrong action: every sentence a table types as an action is labelled that action, so an error
 *    only ever loses a claim or makes it `other`, never one that could end in a NOT_FOUND against the agent
 *    (Hard Rule 5);
 *  - a proposal that names an action is `other` at PROPOSAL_CONFIDENCE (a Muse approval prompt, sprint_3 3.2), a
 *    refusal or a step under way is no claim, two types are `other` at AMBIGUOUS_CONFIDENCE, a vague report is
 *    `other` at VAGUE_CONFIDENCE, and every `other` is at most 0.4;
 *  - what a match captures for the claim's fields; and no sentence, however long or repetitive, makes a pass slow.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AMBIGUOUS_CONFIDENCE,
  classify,
  CLAIM_PATTERNS,
  MAX_SENTENCE,
  PROPOSAL_CONFIDENCE,
  VAGUE_CONFIDENCE,
} from '../../../src/adapters/patterns';
import { ActionType, type AgentId } from '../../../src/core/schema';

const CORPUS_DIR = path.join(import.meta.dirname, '../../fixtures/patterns');

const Corpus = z.strictObject({
  vendor: z.string(),
  note: z.string(),
  cases: z.array(z.strictObject({ text: z.string().min(1), type: ActionType.nullable() })),
});
type Case = z.infer<typeof Corpus>['cases'][number];

function corpus(name: string): Case[] {
  return Corpus.parse(JSON.parse(readFileSync(path.join(CORPUS_DIR, `${name}.json`), 'utf8'))).cases;
}

const SHARED = corpus('shared');
/** Each agent and the corpus of its vendor (Dots runs on ChatGPT's pages, with ChatGPT's table). */
const VENDORS: readonly (readonly [AgentId, string])[] = [
  ['muse', 'muse'],
  ['chatgpt', 'chatgpt'],
  ['dots', 'chatgpt'],
  ['claude', 'claude'],
];
const ACTIONS = ActionType.options.filter((type) => type !== 'other');

const typeOf = (agent: AgentId, text: string): ActionType | null => classify(agent, text)?.type ?? null;

describe('each vendor corpus (sprint_3 3.0: at least 40 labelled strings, positive and negative)', () => {
  it.each(['muse', 'chatgpt', 'claude'])(
    '%s has 40 or more sentences, every action and 10 or more negatives',
    (name) => {
      const cases = corpus(name);
      expect(cases.length).toBeGreaterThanOrEqual(40);
      for (const action of ACTIONS)
        expect(
          cases.some((c) => c.type === action),
          action,
        ).toBe(true);
      expect(cases.filter((c) => c.type === null || c.type === 'other').length).toBeGreaterThanOrEqual(10);
      expect(new Set(cases.map((c) => c.text)).size).toBe(cases.length);
    },
  );
});

describe.each(VENDORS)('the %s table', (agent, name) => {
  const cases = [...corpus(name), ...SHARED];

  it('types at least 90% of its corpus and the shared one right', () => {
    const wrong = cases.filter((c) => typeOf(agent, c.text) !== c.type);
    const accuracy = 1 - wrong.length / cases.length;
    expect(accuracy, wrong.map((c) => `${c.type}: ${c.text}`).join('\n')).toBeGreaterThanOrEqual(0.9);
  });

  it('never reads a sentence as an action it is not labelled', () => {
    const wrongAction = cases.filter((c) => {
      const type = typeOf(agent, c.text);
      return type !== null && type !== 'other' && type !== c.type;
    });
    expect(wrongAction.map((c) => c.text)).toEqual([]);
  });

  it('gives every `other` at most 0.4 and every action more, at most 1', () => {
    for (const { text } of cases) {
      const read = classify(agent, text);
      if (read === null) continue;
      if (read.type === 'other') expect(read.confidence, text).toBeLessThanOrEqual(0.4);
      else expect(read.confidence, text).toBeGreaterThan(0.4);
      expect(read.confidence, text).toBeLessThanOrEqual(1);
    }
  });
});

describe('the rules', () => {
  it('reads a proposal that names an action as `other` at the proposal confidence, never as the action', () => {
    for (const text of [
      'Should I email dana@example.com the agenda?',
      'Would you like me to cancel the meeting with Sam?',
      'Ready to purchase the lamp for $34.99.',
      'I’ll send the email to dana@example.com in a minute.',
      'Here is a draft of the reply to Sam.',
    ]) {
      expect(classify('muse', text), text).toEqual({ type: 'other', confidence: PROPOSAL_CONFIDENCE });
    }
  });

  it('reads a proposal that names no action, a refusal and a step under way as no claim', () => {
    for (const text of [
      'Should I check the weather for Saturday?',
      'I couldn’t send the email to dana@example.com.',
      'I was unable to cancel the meeting.',
      'Sending email to dana@example.com…',
      'Creating the event now',
    ]) {
      expect(classify('chatgpt', text), text).toBeNull();
    }
  });

  it('reads Muse’s approval cards as proposals', () => {
    expect(classify('muse', 'Tap Approve to buy the blender for $89.')).toEqual({
      type: 'other',
      confidence: PROPOSAL_CONFIDENCE,
    });
  });

  it('reads a sentence two types match as `other` at the ambiguous confidence', () => {
    expect(classify('claude', 'I booked the hotel and scheduled the kickoff meeting.')).toEqual({
      type: 'other',
      confidence: AMBIGUOUS_CONFIDENCE,
    });
  });

  it('reads a report that says it acted, not how, as `other` at the vague confidence', () => {
    for (const text of ['All done.', 'I’ve taken care of it.', 'Shared the deck with the team.']) {
      expect(classify('claude', text), text).toEqual({ type: 'other', confidence: VAGUE_CONFIDENCE });
    }
  });

  it('reads a sentence longer than MAX_SENTENCE, or an empty one, as no claim', () => {
    const long = `Sent an email to dana@example.com ${'a'.repeat(MAX_SENTENCE)}`;
    expect(classify('chatgpt', long)).toBeNull();
    expect(classify('chatgpt', long.slice(0, MAX_SENTENCE))).toMatchObject({ type: 'email.sent' });
    expect(classify('chatgpt', '   ')).toBeNull();
  });

  it('reads any case and curly quotes', () => {
    expect(classify('claude', 'SENT AN EMAIL TO DANA@EXAMPLE.COM')).toMatchObject({ type: 'email.sent' });
    expect(classify('claude', 'Created event “Team sync” for Friday.')).toMatchObject({
      type: 'calendar.created',
      subject: 'Team sync',
    });
  });
});

describe('what a match captures', () => {
  it('the recipient of an email, as written', () => {
    expect(classify('chatgpt', 'Sent an email to Dana@Example.com about the lease.')).toEqual({
      type: 'email.sent',
      confidence: 0.9,
      counterparty: 'Dana@Example.com',
    });
  });

  it('the quoted name of an event', () => {
    expect(classify('muse', 'Deleted event "Old planning session" from your calendar.')).toMatchObject({
      type: 'calendar.deleted',
      subject: 'Old planning session',
    });
  });

  it('the item and the amount of a purchase', () => {
    expect(classify('claude', 'Bought a desk lamp for $34.99.')).toEqual({
      type: 'purchase.made',
      confidence: 0.9,
      subject: 'a desk lamp',
      amount: '$34.99',
    });
    expect(classify('claude', 'Ordered 2 bags of coffee beans for 24,50 €.')).toMatchObject({
      type: 'purchase.made',
      amount: '24,50 €',
    });
  });

  it('the item of a listing and the guest added to a meeting', () => {
    expect(classify('muse', 'Listed the bike on Craigslist for $150.')).toMatchObject({
      type: 'listing.posted',
      subject: 'the bike',
    });
    expect(classify('muse', 'Added Priya Shah to the Friday planning meeting.')).toMatchObject({
      type: 'calendar.updated',
      counterparty: 'Priya Shah',
    });
  });
});

describe('page text cannot slow a pass down (sprint_6 red team)', () => {
  const crafted = [
    'sent '.repeat(80),
    'sent email to '.repeat(28),
    `${'a'.repeat(64)}@${'b.'.repeat(160)}`,
    'added to the meeting '.repeat(19),
    'bought for $1.1.1.1.1.1.1 '.repeat(15),
    `${'listed '.repeat(40)}on marketplace`,
    'e'.repeat(MAX_SENTENCE),
  ].map((text) => text.slice(0, MAX_SENTENCE));

  it('classifies every crafted sentence for every vendor quickly', () => {
    const agents = Object.keys(CLAIM_PATTERNS) as AgentId[];
    const classifyAll = (): void => {
      for (const agent of agents) for (const text of crafted) classify(agent, text);
    };
    // The first pass compiles the patterns; measured warm, the slowest crafted sentence took 0.4 ms (2026-10-08).
    classifyAll();
    const started = performance.now();
    classifyAll();
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
