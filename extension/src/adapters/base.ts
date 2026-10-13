/**
 * The agent adapter skeleton (sprint_3 3.0; build_spec §7 adapter contract; agents/adapter_engineer.md "Pattern"):
 * what a Muse, ChatGPT/Dots or Claude content script runs, on the observer skeleton's loop (../observers/base.ts
 * `startPasses`: one watcher, batched passes, a prerendered page left unread, a stop once the extension is gone).
 *
 *   health() → extract() → Requests and Claims (./claims.ts, ./patterns.ts) → bus
 *
 * Each pass reads the clock once, then posts, in this order and one message at a time, each only after the previous
 * one was answered:
 *  1. `adapter.health`: OK; IDLE with reason codes when the page is not one the adapter reads (nothing else is posted);
 *     or DEGRADED with reason codes (Hard Rule 6), among them ADAPTER_REASONS. A pass that read the page but left out a
 *     Request or a Claim, because the page shows no time it can read (`time.unknown`) or because one failed its schema
 *     (`claim.invalid`), still posts what it read, and its health says what it lost;
 *  2. `adapter.claims`: the pass's Requests and Claims, at most SCHEMA_LIMITS.BATCH of each per message (none when
 *     the page holds neither);
 *  3. `adapter.scope`: on a settings page (`extract()` returned scopes) whose pass was clean, the scopes as the page
 *     names them, one line each and once each: a list read from a pass that lost anything is not posted (Hard Rule 5).
 * If a post rejects, the rest of the pass is not sent. A message that fails its bus schema (a bug, never expected)
 * makes the pass post only a DEGRADED `message.invalid` health report.
 *
 * Read-only (Hard Rule 3): nothing here writes the DOM, dispatches an event or reaches the network; `attest/no-act`
 * lints all of src/adapters/**. Page text is data (sprint_3): it is matched against fixed patterns and hashed, never
 * run, and none of it reaches a health report.
 */
import { z } from 'zod';

import {
  AdapterClaimsMessage,
  AdapterHealthMessage,
  AdapterScopeMessage,
  type BusMessage,
  type BusMessageType,
} from '../bus/messages';
import { AGENT_HOSTS } from '../config-agents';
import { AgentId, ComponentId, IsoTs, SCHEMA_LIMITS } from '../core/schema';
import {
  type ObserverHandle,
  type PassDeps,
  type PassResult,
  type StartOptions,
  startPasses,
} from '../observers/base';
import { checkHealth } from '../observers/plan';
import { oneLine } from '../observers/text';
import { type AgentFacts, buildFacts } from './claims';
import { AdapterError } from './errors';
import type { AgentAdapter, ExtractContext } from './types';

export type * from './types';
export type { AgentFacts } from './claims';

/** The reasons a pass of the skeleton itself can give, beside those an adapter's `health()` names. */
export const ADAPTER_REASONS = Object.freeze([
  'health.threw',
  'health.invalid',
  'extract.threw',
  'extract.invalid',
  'claims.threw',
  'time.unknown',
  'claim.invalid',
  'message.invalid',
] as const);

/** What one pass decided, before it posts anything. */
export interface AdapterPlan {
  readonly status: 'OK' | 'IDLE' | 'DEGRADED';
  readonly reasons: readonly string[];
  readonly facts: AgentFacts;
  /** A clean settings page's scopes, one line and once each; null on any other page or pass. */
  readonly scopes: readonly string[] | null;
}

const NO_FACTS: AgentFacts = Object.freeze({ requests: [], claims: [], untimed: 0, invalid: 0 });

/** `extract()`'s answer as the contract allows it (./types.ts `AgentRead`): anything else is `extract.invalid`. */
const ReadShape = z.strictObject({
  conversationId: z.string().nullable(),
  turns: z.array(
    z.strictObject({
      role: z.enum(['user', 'agent']),
      text: z.string(),
      time: z.string().nullable(),
      rowKey: z.string().optional(),
    }),
  ),
  activity: z.array(
    z.strictObject({ text: z.string(), time: z.string().nullable(), rowKey: z.string().optional() }),
  ),
  scopes: z.array(z.string()).nullable(),
});

function degraded(reason: (typeof ADAPTER_REASONS)[number]): AdapterPlan {
  return { status: 'DEGRADED', reasons: [reason], facts: NO_FACTS, scopes: null };
}

/** Each scope as one line, the empty ones left out, each once, in the page's order. */
function scopeList(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map(oneLine).filter((scope) => scope !== ''))];
}

/** One pass decided: health, then the page's facts (rules in the module comment). Never throws. */
export function planAdapterPass(adapter: AgentAdapter, doc: Document, ctx: ExtractContext): AdapterPlan {
  const health = checkHealth(adapter, doc, ctx);
  if (health.status !== 'OK')
    return { status: health.status, reasons: health.reasons, facts: NO_FACTS, scopes: null };
  let read: unknown;
  try {
    read = adapter.extract(doc, ctx);
  } catch {
    return degraded('extract.threw');
  }
  const parsed = ReadShape.safeParse(read);
  if (!parsed.success) return degraded('extract.invalid');
  let facts: AgentFacts;
  try {
    const extractor = { id: adapter.id, version: adapter.version };
    facts = buildFacts(parsed.data, { agent: adapter.agent, extractor, ...ctx });
  } catch {
    return degraded('claims.threw');
  }
  const reasons = [
    ...(facts.untimed > 0 ? ['time.unknown'] : []),
    ...(facts.invalid > 0 ? ['claim.invalid'] : []),
  ];
  if (reasons.length > 0) return { status: 'DEGRADED', reasons, facts, scopes: null };
  const scopes = parsed.data.scopes === null ? null : scopeList(parsed.data.scopes);
  return { status: 'OK', reasons: [], facts, scopes };
}

function healthMessage(adapter: AgentAdapter, plan: AdapterPlan, checkedAt: IsoTs): BusMessage | null {
  const parsed = AdapterHealthMessage.safeParse({
    type: 'adapter.health',
    health: {
      adapterId: adapter.id,
      version: adapter.version,
      status: plan.status,
      reasons: plan.reasons,
      checkedAt,
    },
  });
  return parsed.success ? parsed.data : null;
}

/** The Requests and Claims in messages of at most SCHEMA_LIMITS.BATCH of each, or null when one fails its schema. */
function claimsMessages(adapter: AgentAdapter, facts: AgentFacts): BusMessage[] | null {
  const messages: BusMessage[] = [];
  const count = Math.max(facts.requests.length, facts.claims.length);
  for (let start = 0; start < count; start += SCHEMA_LIMITS.BATCH) {
    const parsed = AdapterClaimsMessage.safeParse({
      type: 'adapter.claims',
      adapterId: adapter.id,
      version: adapter.version,
      requests: facts.requests.slice(start, start + SCHEMA_LIMITS.BATCH),
      claims: facts.claims.slice(start, start + SCHEMA_LIMITS.BATCH),
    });
    if (!parsed.success) return null;
    messages.push(parsed.data);
  }
  return messages;
}

function scopeMessages(adapter: AgentAdapter, plan: AdapterPlan, observedAt: IsoTs): BusMessage[] | null {
  if (plan.scopes === null) return [];
  const parsed = AdapterScopeMessage.safeParse({
    type: 'adapter.scope',
    adapterId: adapter.id,
    version: adapter.version,
    snapshot: { agent: adapter.agent, scopes: plan.scopes, observedAt },
  });
  return parsed.success ? [parsed.data] : null;
}

/** The messages one pass posts, in order; only a DEGRADED `message.invalid` health report when one fails its schema. */
export function adapterMessages(adapter: AgentAdapter, plan: AdapterPlan, at: IsoTs): BusMessage[] {
  const health = healthMessage(adapter, plan, at);
  const claims = claimsMessages(adapter, plan.facts);
  const scope = scopeMessages(adapter, plan, at);
  if (health !== null && claims !== null && scope !== null) return [health, ...claims, ...scope];
  const fallback = healthMessage(adapter, degraded('message.invalid'), at);
  if (fallback === null) throw new AdapterError('invalid_adapter');
  return [fallback];
}

function resultOf(messages: readonly BusMessage[], posted: BusMessageType[], complete: boolean): PassResult {
  const [first] = messages;
  const health = first?.type === 'adapter.health' ? first.health : null;
  return { status: health?.status ?? 'DEGRADED', reasons: health?.reasons ?? [], posted, complete };
}

/**
 * One pass: read the clock once, decide, post each message after the previous one was answered. Resolves what it did;
 * never rejects. A post that rejects ends the pass: nothing after it is sent.
 */
export async function runAdapterPass(adapter: AgentAdapter, deps: PassDeps): Promise<PassResult> {
  const clock = IsoTs.safeParse(deps.now());
  if (!clock.success) return { status: 'DEGRADED', reasons: ['clock.invalid'], posted: [], complete: false };
  const observedAt = clock.data;
  const plan = planAdapterPass(adapter, deps.doc, { observedAt, offsetAt: deps.offsetAt });
  const messages = adapterMessages(adapter, plan, observedAt);
  const posted: BusMessageType[] = [];
  for (const message of messages) {
    try {
      await deps.post(message);
    } catch {
      return resultOf(messages, posted, false);
    }
    posted.push(message.type);
  }
  return resultOf(messages, posted, true);
}

/** The hosts an agent's pages are on (Dots runs on ChatGPT's). */
function hostsOf(agent: AgentId): readonly string[] {
  return agent === 'dots' ? AGENT_HOSTS.chatgpt : AGENT_HOSTS[agent];
}

/**
 * Throws `AdapterError('invalid_adapter')` unless the adapter's id, vendor and version are ComponentIds, its agent is
 * one Attest knows, its hosts are some of that agent's exact hosts (src/config.ts AGENT_HOSTS, Hard Rule 8), and its
 * `health`, `extract` and `attributes` are what the contract says.
 */
export function assertAdapter(adapter: AgentAdapter): void {
  const agent = AgentId.safeParse(adapter.agent);
  const valid =
    agent.success &&
    [adapter.id, adapter.vendor, adapter.version].every((token) => ComponentId.safeParse(token).success) &&
    adapter.hosts.length > 0 &&
    adapter.hosts.every((host) => hostsOf(agent.data).includes(host)) &&
    typeof adapter.health === 'function' &&
    typeof adapter.extract === 'function' &&
    (adapter.attributes === undefined || adapter.attributes.every((name) => typeof name === 'string'));
  if (!valid) throw new AdapterError('invalid_adapter');
}

/**
 * Starts the skeleton for a content script's `adapters` on this page (../observers/base.ts `startPasses`, each pass
 * `runAdapterPass`). Throws `AdapterError` for an invalid adapter, or `ObserverError` for invalid options, before it
 * attaches any listener.
 */
export function startAdapters(
  adapters: readonly AgentAdapter[],
  overrides: Partial<StartOptions> = {},
): ObserverHandle {
  if (adapters.length === 0) throw new AdapterError('invalid_adapter');
  for (const adapter of adapters) assertAdapter(adapter);
  return startPasses(adapters, runAdapterPass, overrides);
}
