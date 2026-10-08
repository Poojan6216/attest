/**
 * The labels beside each agent fixture folder (tests/fixtures/pages/<agent vendor>/<yyyy-mm-dd>/labels.json; sprint_3
 * 3.1) and the one loader the adapter tests and the 3.8 bench read them through. The format is documented in
 * tests/fixtures/pages/README.md ("Agent fixtures"); this file is its schema.
 *
 * Each entry keeps the capture tool's shape (tests/tools/capture-output.ts `LabelEntrySchema`); `expected` is a list
 * of facts tagged by `kind`:
 *  - `page` (exactly one, first): the agent, the view, its time zone, the instant it was read (`readAt`: the pass's
 *    observedAt and the reference for relative times), and the live URL it stands for when the host is confirmed;
 *  - `health` (exactly one): the status the adapter reports for the page, with reason codes;
 *  - `request`: one user turn, as its Request keeps it (the hint and the time);
 *  - `claim`: one Claim, with the sentence it was read from (`text`), its type, fields, time and source kind;
 *  - `scopes`: a settings page's scopes, in page order.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  ActionType,
  AgentId,
  AmountCents,
  ClaimPrecision,
  ComponentId,
  Currency,
  IsoTs,
  SCHEMA_LIMITS,
  SourceKind,
} from '../../../src/core/schema';
import { HEALTH_REASON, oneLineText } from '../../../src/core/schema-text';
import { LabelEntrySchema } from '../../tools/capture-output';
import { PAGES_ROOT } from './fixture-labels';

export const AGENT_VENDORS = ['muse', 'chatgpt', 'claude'] as const;
export type AgentVendor = (typeof AGENT_VENDORS)[number];

const FileName = z.string().regex(/^[a-z0-9-]+\.html$/, 'expected a fixture file name');
const Text = (max: number) => oneLineText(max).min(1);
/** A claim's sentence: classify() reads at most this many code units (src/adapters/patterns.ts MAX_SENTENCE). */
const SENTENCE = 400;

export const AgentPageFact = z.strictObject({
  kind: z.literal('page'),
  vendor: z.enum(AGENT_VENDORS),
  agent: AgentId,
  view: z.enum(['agent.conversation', 'agent.activity', 'agent.settings', 'agent.other']),
  synthetic: z.boolean(),
  timeZone: z.string().min(1),
  readAt: IsoTs,
  /** The address the page stands for; absent while its host is not confirmed (Muse, MANUAL.md). */
  liveUrl: z.url({ protocol: /^https$/ }).optional(),
});

export const AgentHealthFact = z
  .strictObject({
    kind: z.literal('health'),
    adapter: ComponentId,
    status: z.enum(['OK', 'IDLE', 'DEGRADED']),
    reasons: z.array(z.string().max(SCHEMA_LIMITS.ID).regex(HEALTH_REASON)),
  })
  .refine((fact) => (fact.status === 'OK') === (fact.reasons.length === 0), {
    message: 'OK has no reasons; IDLE and DEGRADED have at least one',
  });

export const RequestFact = z.strictObject({
  kind: z.literal('request'),
  textHint: Text(SCHEMA_LIMITS.TEXT_HINT),
  ts: IsoTs,
});

export const ClaimFact = z.strictObject({
  kind: z.literal('claim'),
  text: Text(SENTENCE),
  type: ActionType,
  counterparty: Text(SCHEMA_LIMITS.COUNTERPARTY).optional(),
  subjectHint: Text(SCHEMA_LIMITS.SUBJECT_HINT).optional(),
  amountCents: AmountCents.optional(),
  currency: Currency.optional(),
  claimedAt: IsoTs,
  claimedAtPrecision: ClaimPrecision,
  claimedAtEnd: IsoTs.optional(),
  sourceKind: SourceKind,
});

export const ScopesFact = z.strictObject({
  kind: z.literal('scopes'),
  scopes: z.array(Text(SCHEMA_LIMITS.ITEM)).max(SCHEMA_LIMITS.LIST),
});

export const AgentFact = z.discriminatedUnion('kind', [
  AgentPageFact,
  AgentHealthFact,
  RequestFact,
  ClaimFact,
  ScopesFact,
]);

export const AgentLabel = LabelEntrySchema.extend({ expected: z.array(AgentFact).min(2) }).refine(
  (entry) =>
    entry.expected[0]?.kind === 'page' &&
    entry.expected.filter((f) => f.kind === 'page').length === 1 &&
    entry.expected.filter((f) => f.kind === 'health').length === 1 &&
    entry.expected.filter((f) => f.kind === 'scopes').length <= 1,
  { message: 'expected starts with the one page fact and holds one health fact and at most one scopes fact' },
);

export const AgentLabelsFile = z.record(FileName, AgentLabel);

export type AgentPageFact = z.infer<typeof AgentPageFact>;
export type AgentHealthFact = z.infer<typeof AgentHealthFact>;
export type RequestFact = z.infer<typeof RequestFact>;
export type ClaimFact = z.infer<typeof ClaimFact>;
export type AgentFact = z.infer<typeof AgentFact>;
export type AgentLabel = z.infer<typeof AgentLabel>;

/** One labelled agent fixture, its facts split by kind. */
export interface AgentFixture {
  readonly vendor: AgentVendor;
  readonly date: string;
  readonly file: string;
  readonly htmlPath: string;
  readonly label: AgentLabel;
  readonly page: AgentPageFact;
  readonly health: AgentHealthFact;
  readonly requests: readonly RequestFact[];
  readonly claims: readonly ClaimFact[];
  /** A settings page's scopes; null when the label lists none. */
  readonly scopes: readonly string[] | null;
}

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** Every `<agent vendor>/<yyyy-mm-dd>` folder with a labels.json, oldest date first. */
export function agentLabelFolders(root = PAGES_ROOT): { vendor: AgentVendor; date: string; dir: string }[] {
  return AGENT_VENDORS.flatMap((vendor) => {
    let dates: string[];
    try {
      dates = readdirSync(path.join(root, vendor)).filter((name) => DATE_DIR.test(name));
    } catch {
      return [];
    }
    return dates
      .sort()
      .map((date) => ({ vendor, date, dir: path.join(root, vendor, date) }))
      .filter(({ dir }) => readdirSync(dir).includes('labels.json'));
  });
}

function ofKind<K extends AgentFact['kind']>(
  facts: readonly AgentFact[],
  kind: K,
): Extract<AgentFact, { kind: K }>[] {
  return facts.filter((fact): fact is Extract<AgentFact, { kind: K }> => fact.kind === kind);
}

/** Parses one folder's labels.json (throws a ZodError naming the entry and path on a bad label). */
export function loadAgentLabels(vendor: AgentVendor, date: string, root = PAGES_ROOT): AgentFixture[] {
  const dir = path.join(root, vendor, date);
  const labels = AgentLabelsFile.parse(JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8')));
  return Object.entries(labels).map(([file, label]) => {
    const [page] = label.expected;
    const health = label.expected.find((f) => f.kind === 'health');
    if (page?.kind !== 'page' || health?.kind !== 'health')
      throw new Error(`${file}: no page or health fact`);
    const scopes = label.expected.find((f) => f.kind === 'scopes');
    return {
      vendor,
      date,
      file,
      htmlPath: path.join(dir, file),
      label,
      page,
      health,
      requests: ofKind(label.expected, 'request'),
      claims: ofKind(label.expected, 'claim'),
      scopes: scopes?.kind === 'scopes' ? scopes.scopes : null,
    };
  });
}

/** Every labelled agent fixture of every folder. */
export function allAgentFixtures(root = PAGES_ROOT): AgentFixture[] {
  return agentLabelFolders(root).flatMap(({ vendor, date }) => loadAgentLabels(vendor, date, root));
}
