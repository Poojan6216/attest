/**
 * The labels beside each observer fixture folder (tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/labels.json) and the
 * one loader every observer test and bench reads them through. The format is documented in
 * tests/fixtures/pages/README.md; this file is its schema.
 *
 * Each entry keeps the capture tool's shape (tests/tools/capture-output.ts `LabelEntrySchema`); only `expected` is
 * typed here: a list of facts, each tagged by `kind`:
 *  - `page` (exactly one, first): which view the fixture is, its time zone, the instant it was read (`readAt`: the
 *    pass's observedAt and the reference for relative times), the signed-in account and the live URL it stands for;
 *  - `health`: the status an observer reports for the page after its pass, with reason codes;
 *  - `observation`: one row an extractor must hand to `redact.project()`, as `project()` keeps it (content fields
 *    plus `source`, `type` and the vendor's `rowKey`; `parser` and `confidence` name the receipt parser);
 *  - `coverage`: a window the pass may report as seen (`windowEnd: 'lastSyncAt'` at the head of a list);
 *  - `dedup`: how many observations this fixture shares (same contentHash) with another fixture in the folder;
 *  - `event` (Calendar): one event visible in the snapshot;
 *  - `diff` (Calendar): the observations a snapshot diff emits against an earlier fixture (`from`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { CONTENT_FIELDS } from '../../../src/core/redact';
import {
  ActionType,
  AmountCents,
  Currency,
  IsoTs,
  ObservationSource,
  SCHEMA_LIMITS,
} from '../../../src/core/schema';
import { HEALTH_REASON, oneLineText } from '../../../src/core/schema-text';
import { LabelEntrySchema } from '../../tools/capture-output';

export const PAGES_ROOT = path.resolve(import.meta.dirname, '../../fixtures/pages');
export const OBSERVER_VENDORS = ['gmail', 'gcal'] as const;
export type ObserverVendor = (typeof OBSERVER_VENDORS)[number];

/** `pnpm capture --name` accepts /^[a-z0-9-]+$/ (tests/tools/capture-args.ts), so a captured name always parses. */
const FileName = z.string().regex(/^[a-z0-9-]+\.html$/, 'expected a fixture file name');
const Email = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'expected an email address');
const Text = (max: number) => oneLineText(max).min(1);

export const PageFact = z.strictObject({
  kind: z.literal('page'),
  vendor: z.enum(OBSERVER_VENDORS),
  view: z.enum([
    'gmail.list.sent',
    'gmail.list.drafts',
    'gmail.list.inbox',
    'gmail.message',
    'gcal.week',
    'gcal.month',
  ]),
  folder: z.enum(['sent', 'drafts', 'inbox']).optional(),
  synthetic: z.boolean(),
  /** IANA zone of the browser (Gmail) or of the calendar's display setting (Calendar). */
  timeZone: z.string().min(1),
  readAt: IsoTs,
  account: Email,
  liveUrl: z.url({ protocol: /^https$/, hostname: /^(?:mail|calendar)\.google\.com$/ }),
  /** What a bare `$` means on this page (normalize.amount's defaultDollar). */
  defaultDollar: Currency.optional(),
});

export const HealthFact = z
  .strictObject({
    kind: z.literal('health'),
    observer: ObservationSource,
    status: z.enum(['OK', 'IDLE', 'DEGRADED']),
    reasons: z.array(z.string().max(SCHEMA_LIMITS.ID).regex(HEALTH_REASON)),
  })
  .refine((fact) => (fact.status === 'OK') === (fact.reasons.length === 0), {
    message: 'OK has no reasons; IDLE and DEGRADED have at least one',
  });

export const ObservationFact = z.strictObject({
  kind: z.literal('observation'),
  source: ObservationSource,
  type: ActionType,
  counterparty: Text(SCHEMA_LIMITS.COUNTERPARTY).optional(),
  merchant: Text(SCHEMA_LIMITS.MERCHANT).optional(),
  amountCents: AmountCents.optional(),
  currency: Currency.optional(),
  subjectHint: Text(SCHEMA_LIMITS.SUBJECT_HINT).optional(),
  occurredAt: IsoTs,
  /** The vendor's own row id (Gmail legacy message id, Calendar data-eventid); project() keeps only its hash. */
  rowKey: z.string().min(1).optional(),
  /** gmail.receipt: the parser that must claim the message (src/observers/gmail/receipts/<parser>.ts). */
  parser: z
    .string()
    .regex(/^[a-z]+$/)
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const CoverageFact = z.strictObject({
  kind: z.literal('coverage'),
  source: ObservationSource,
  /** The account switcher's address; the observer hashes it before it leaves the page. */
  account: Email,
  windowStart: IsoTs,
  windowEnd: z.union([IsoTs, z.literal('lastSyncAt')]),
  allCalendars: z.boolean().optional(),
});

export const DedupFact = z.strictObject({
  kind: z.literal('dedup'),
  with: FileName,
  shared: z.number().int().min(1),
});

export const EventFact = z.strictObject({
  kind: z.literal('event'),
  rowKey: z.string().min(1),
  calendar: Text(SCHEMA_LIMITS.ITEM),
  subjectHint: Text(SCHEMA_LIMITS.SUBJECT_HINT),
  occurredAt: IsoTs,
  allDay: z.boolean(),
  attendees: z.array(Email),
});

export const DiffFact = z.strictObject({
  kind: z.literal('diff'),
  from: FileName,
  observations: z.array(ObservationFact),
});

export const Fact = z.discriminatedUnion('kind', [
  PageFact,
  HealthFact,
  ObservationFact,
  CoverageFact,
  DedupFact,
  EventFact,
  DiffFact,
]);

export const FixtureLabel = LabelEntrySchema.extend({ expected: z.array(Fact).min(1) }).refine(
  (entry) =>
    entry.expected[0]?.kind === 'page' && entry.expected.filter((f) => f.kind === 'page').length === 1,
  { message: 'expected starts with the one page fact' },
);

export const LabelsFile = z.record(FileName, FixtureLabel);

export type PageFact = z.infer<typeof PageFact>;
export type HealthFact = z.infer<typeof HealthFact>;
export type ObservationFact = z.infer<typeof ObservationFact>;
export type CoverageFact = z.infer<typeof CoverageFact>;
export type EventFact = z.infer<typeof EventFact>;
export type DiffFact = z.infer<typeof DiffFact>;
export type DedupFact = z.infer<typeof DedupFact>;
export type Fact = z.infer<typeof Fact>;
export type FixtureLabel = z.infer<typeof FixtureLabel>;

/** One labelled fixture, its facts split by kind. */
export interface LabelledFixture {
  readonly vendor: ObserverVendor;
  readonly date: string;
  readonly dir: string;
  readonly file: string;
  readonly htmlPath: string;
  readonly label: FixtureLabel;
  readonly page: PageFact;
  readonly health: readonly HealthFact[];
  readonly observations: readonly ObservationFact[];
  readonly coverage: readonly CoverageFact[];
  readonly events: readonly EventFact[];
  readonly diffs: readonly DiffFact[];
  readonly dedups: readonly DedupFact[];
}

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** Every `<vendor>/<yyyy-mm-dd>` folder with a labels.json, oldest date first. */
export function labelFolders(root = PAGES_ROOT): { vendor: ObserverVendor; date: string; dir: string }[] {
  return OBSERVER_VENDORS.flatMap((vendor) => {
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

function ofKind<K extends Fact['kind']>(facts: readonly Fact[], kind: K): Extract<Fact, { kind: K }>[] {
  return facts.filter((fact): fact is Extract<Fact, { kind: K }> => fact.kind === kind);
}

/** Parses one folder's labels.json (throws a ZodError naming the entry and path on a bad label). */
export function loadLabels(vendor: ObserverVendor, date: string, root = PAGES_ROOT): LabelledFixture[] {
  const dir = path.join(root, vendor, date);
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const labels = LabelsFile.parse(raw);
  return Object.entries(labels).map(([file, label]) => {
    const facts = label.expected;
    const [page] = ofKind(facts, 'page');
    if (page === undefined) throw new Error(`${file}: no page fact`);
    return {
      vendor,
      date,
      dir,
      file,
      htmlPath: path.join(dir, file),
      label,
      page,
      health: ofKind(facts, 'health'),
      observations: ofKind(facts, 'observation'),
      coverage: ofKind(facts, 'coverage'),
      events: ofKind(facts, 'event'),
      diffs: ofKind(facts, 'diff'),
      dedups: ofKind(facts, 'dedup'),
    };
  });
}

/** Every labelled fixture of one vendor, across date folders. */
export function loadVendor(vendor: ObserverVendor, root = PAGES_ROOT): LabelledFixture[] {
  return labelFolders(root)
    .filter((folder) => folder.vendor === vendor)
    .flatMap((folder) => loadLabels(vendor, folder.date, root));
}

/** The arguments `redact.project(source, raw, ctx, policy)` takes for an observation fact read at `readAt`. */
export function projectArgs(
  fact: ObservationFact,
  readAt: string,
): {
  source: ObservationFact['source'];
  raw: Record<string, unknown>;
  ctx: { type: ObservationFact['type']; observedAt: string; rowKey?: string };
} {
  const raw = Object.fromEntries(
    CONTENT_FIELDS.flatMap((field) => (field in fact ? [[field, fact[field]]] : [])),
  );
  const { source, type, rowKey } = fact;
  return { source, raw, ctx: { type, observedAt: readAt, ...(rowKey === undefined ? {} : { rowKey }) } };
}
