// @vitest-environment happy-dom
/**
 * src/adapters/base.ts (sprint_3 3.0): one adapter pass, health → extract → Requests and Claims → bus, in order and
 * one message at a time. IDLE and DEGRADED health post only themselves (Hard Rule 6); a pass that lost a claim to an
 * unreadable time posts the rest and says so (Hard Rule 5); a settings page's scopes go out only from a clean pass; a
 * failed post ends the pass; every message parses with its bus schema; no page text reaches a health report (Hard
 * Rule 2); and the skeleton runs on the observer skeleton's loop. The page and the adapter are synthetic (./helpers.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADAPTER_REASONS, assertAdapter, runAdapterPass, startAdapters } from '../../../src/adapters/base';
import { AdapterError } from '../../../src/adapters/errors';
import { BusMessage } from '../../../src/bus/messages';
import { isoWithLocalOffset } from '../../../src/clock';
import { OBSERVER_DEBOUNCE_MS, OBSERVER_HOSTS } from '../../../src/config';
import { AGENT_HOSTS } from '../../../src/config-agents';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { HealthReport, SCHEMA_LIMITS } from '../../../src/core/schema';
import type { ObserverHandle, PassDeps } from '../../../src/observers/base';
import { recordingPost } from '../observers/helpers';
import { chatAdapter, chatDocument, chatPageHtml, NOW, TURNS } from './helpers';

function deps(overrides: Partial<PassDeps> = {}): PassDeps & { messages: BusMessage[] } {
  const recording = recordingPost();
  return {
    doc: chatDocument(),
    post: recording.post,
    now: () => NOW,
    offsetAt: () => -240,
    policy: DEFAULT_POLICY,
    userActive: () => true,
    messages: recording.messages,
    ...overrides,
  };
}

const typesOf = (messages: readonly BusMessage[]): string[] => messages.map((message) => message.type);
const healthOf = (messages: readonly BusMessage[]): unknown =>
  messages[0]?.type === 'adapter.health' ? messages[0].health : undefined;
const claimsIn = (messages: readonly BusMessage[]) =>
  messages.flatMap((message) => (message.type === 'adapter.claims' ? message.claims : []));

describe('runAdapterPass: a clean pass', () => {
  it('posts health OK, then the requests and claims, each a valid bus message', async () => {
    const d = deps();
    const result = await runAdapterPass(chatAdapter(), d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'adapter.claims']);
    expect(result).toEqual({
      status: 'OK',
      reasons: [],
      posted: ['adapter.health', 'adapter.claims'],
      complete: true,
    });
    for (const message of d.messages) expect(BusMessage.parse(message)).toEqual(message);
    const [, claims] = d.messages;
    if (claims?.type !== 'adapter.claims') throw new Error('expected the claims message');
    expect(claims.requests).toHaveLength(1);
    expect(claims.claims.map((claim) => [claim.type, claim.requestId])).toEqual([
      ['email.sent', claims.requests[0]?.id],
    ]);
  });

  it('a settings page posts its scopes after the health, one line and once each', async () => {
    const d = deps({
      doc: chatDocument({ conversation: null, scopes: ['Gmail', ' Google   Calendar ', 'Gmail', ''] }),
    });
    await runAdapterPass(chatAdapter(), d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'adapter.scope']);
    expect(d.messages[1]).toEqual({
      type: 'adapter.scope',
      adapterId: 'claude.chat',
      version: '0.1.0',
      snapshot: { agent: 'claude', scopes: ['Gmail', 'Google Calendar'], observedAt: NOW },
    });
  });

  it('two passes over the same page give the same claim ids', async () => {
    const first = deps();
    const second = deps();
    await runAdapterPass(chatAdapter(), first);
    await runAdapterPass(chatAdapter(), second);
    expect(claimsIn(second.messages).map((c) => c.id)).toEqual(claimsIn(first.messages).map((c) => c.id));
  });

  it('batches claims SCHEMA_LIMITS.BATCH to a message', async () => {
    const activity = Array.from({ length: SCHEMA_LIMITS.BATCH + 1 }, (_, i) => ({
      text: `Sent an email to person${String(i)}@example.com`,
      at: '2026-10-01T14:00:00-04:00',
    }));
    const d = deps({ doc: chatDocument({ turns: [], activity }) });
    await runAdapterPass(chatAdapter(), d);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'adapter.claims', 'adapter.claims']);
    expect(d.messages.map((m) => (m.type === 'adapter.claims' ? m.claims.length : 0))).toEqual([
      0,
      SCHEMA_LIMITS.BATCH,
      1,
    ]);
  });
});

describe('runAdapterPass: what a pass that is not clean posts', () => {
  it('a turn without a readable time: DEGRADED time.unknown, the rest posted, no scopes', async () => {
    const turns = [...TURNS, { role: 'agent' as const, text: 'I also texted Sam the address.' }];
    const d = deps({ doc: chatDocument({ turns, scopes: ['Gmail'] }) });
    const result = await runAdapterPass(chatAdapter(), d);
    expect(result.status).toBe('DEGRADED');
    expect(result.reasons).toEqual(['time.unknown']);
    expect(typesOf(d.messages)).toEqual(['adapter.health', 'adapter.claims']);
    expect(claimsIn(d.messages).map((c) => c.type)).toEqual(['email.sent']);
  });

  it('IDLE and DEGRADED health post only themselves', async () => {
    const idle = deps({ doc: chatDocument({ conversation: null }) });
    await runAdapterPass(chatAdapter(), idle);
    expect(idle.messages).toHaveLength(1);
    expect(healthOf(idle.messages)).toMatchObject({ status: 'IDLE', reasons: ['page.not_agent'] });
    const broken = deps();
    const adapter = chatAdapter({
      health: () => ({ status: 'DEGRADED', reasons: ['selector.missing.turn'] }),
    });
    await runAdapterPass(adapter, broken);
    expect(broken.messages).toHaveLength(1);
    expect(healthOf(broken.messages)).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.turn'],
    });
  });

  it.each([
    [
      'health.threw',
      {
        health: () => {
          throw new Error('boom');
        },
      },
    ],
    ['health.invalid', { health: () => ({ status: 'FINE' }) as never }],
    [
      'extract.threw',
      {
        extract: () => {
          throw new Error('boom');
        },
      },
    ],
    ['extract.invalid', { extract: () => ({ turns: 'none' }) as never }],
  ] as const)(
    '%s: an adapter that breaks its contract is DEGRADED and posts nothing else',
    async (reason, broken) => {
      const d = deps();
      await runAdapterPass(chatAdapter(broken), d);
      expect(d.messages).toHaveLength(1);
      expect(healthOf(d.messages)).toMatchObject({ status: 'DEGRADED', reasons: [reason] });
    },
  );
});

describe('runAdapterPass: what goes wrong in the pass itself', () => {
  it('a message that fails its schema leaves only a DEGRADED message.invalid health report', async () => {
    const scopes = Array.from({ length: SCHEMA_LIMITS.LIST + 1 }, (_, i) => `App ${String(i)}`);
    const d = deps({ doc: chatDocument({ conversation: null, scopes }) });
    await runAdapterPass(chatAdapter(), d);
    expect(d.messages).toHaveLength(1);
    expect(healthOf(d.messages)).toMatchObject({ status: 'DEGRADED', reasons: ['message.invalid'] });
  });

  it('a clock with no instant posts nothing', async () => {
    const d = deps({ now: () => 'soon' });
    expect(await runAdapterPass(chatAdapter(), d)).toEqual({
      status: 'DEGRADED',
      reasons: ['clock.invalid'],
      posted: [],
      complete: false,
    });
    expect(d.messages).toEqual([]);
  });

  it('a post that rejects ends the pass', async () => {
    const posted: string[] = [];
    const d = deps({
      post: (message) => {
        posted.push(message.type);
        return message.type === 'adapter.health'
          ? Promise.resolve(undefined)
          : Promise.reject(new Error('gone'));
      },
    });
    expect(await runAdapterPass(chatAdapter(), d)).toMatchObject({
      posted: ['adapter.health'],
      complete: false,
    });
    expect(posted).toEqual(['adapter.health', 'adapter.claims']);
  });

  it('no page text reaches a health report, and every reason the skeleton gives is a reason code', async () => {
    const secret = 'zq-7781-private-note';
    const turns = [{ role: 'agent' as const, text: `I texted Sam. ${secret}` }];
    const d = deps({ doc: chatDocument({ turns }) });
    await runAdapterPass(chatAdapter(), d);
    expect(JSON.stringify(healthOf(d.messages))).not.toContain(secret);
    for (const reason of ADAPTER_REASONS)
      expect(HealthReport.shape.reasons.element.parse(reason)).toBe(reason);
  });
});

describe('assertAdapter', () => {
  it('accepts an adapter on its own agent’s hosts, Dots on ChatGPT’s', () => {
    expect(() => {
      assertAdapter(chatAdapter());
    }).not.toThrow();
    expect(() => {
      assertAdapter(chatAdapter({ id: 'dots.activity', agent: 'dots', hosts: AGENT_HOSTS.chatgpt }));
    }).not.toThrow();
  });

  it.each([
    ['an id that is not a token', { id: 'claude chat' }],
    ['another agent’s host', { hosts: AGENT_HOSTS.chatgpt }],
    ['an observer host', { hosts: OBSERVER_HOSTS.gmail }],
    ['no host', { hosts: [] }],
    ['Muse, whose host is not confirmed yet', { agent: 'muse' as const, hosts: AGENT_HOSTS.claude }],
    ['an unknown agent', { agent: 'gemini' as never }],
  ])('refuses %s', (_, overrides) => {
    expect(() => {
      assertAdapter(chatAdapter(overrides));
    }).toThrow(AdapterError);
  });
});

describe('startAdapters', () => {
  let handle: ObserverHandle | undefined;
  const now = (): string => isoWithLocalOffset(new Date());

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T18:30:00Z'));
    document.body.innerHTML = new DOMParser().parseFromString(chatPageHtml(), 'text/html').body.innerHTML;
  });

  afterEach(() => {
    handle?.disconnect();
    handle = undefined;
    vi.useRealTimers();
  });

  it('passes one debounce after start, again when a turn appears, and never after disconnect', async () => {
    const recording = recordingPost();
    handle = startAdapters([chatAdapter()], { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    expect(typesOf(recording.messages)).toEqual(['adapter.health', 'adapter.claims']);
    recording.messages.length = 0;
    const turn = document.createElement('div');
    turn.setAttribute('data-turn', '');
    turn.setAttribute('data-role', 'agent');
    turn.innerHTML = '<p>I texted Sam the address.</p><time datetime="2026-10-01T14:20:00-04:00"></time>';
    document.querySelector('main')?.append(turn);
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    expect(claimsIn(recording.messages).map((c) => c.type)).toEqual(['email.sent', 'message.sent']);
    handle.disconnect();
    recording.messages.length = 0;
    turn.remove();
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS * 10);
    expect(recording.messages).toEqual([]);
  });

  it('refuses no adapters, or an invalid one, before it attaches anything', () => {
    expect(() => startAdapters([])).toThrow(AdapterError);
    expect(() => startAdapters([chatAdapter({ version: '' })])).toThrow(AdapterError);
  });
});
