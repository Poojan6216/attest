/**
 * The words the receipt surfaces use (sprint_4 4.1; agents/ux_engineer.md rules 1 to 5 and the copy rules): each
 * grade's name, each source's and adapter's name, the coverage header's lines, the degraded banner's line and report
 * link, and what a piece of evidence was. Pure: the caller passes the instant it calls now, and every time is written on
 * the page's own clock (./format.ts). Every value shown is a stored one; nothing here grades or matches.
 */
import { COVERAGE_FRESH_MINUTES, ISSUES_URL } from '../config';
import { MS_PER_MINUTE } from '../core/units';
import {
  type AdapterHealth,
  type AgentId,
  type Grade,
  type Observation,
  ObservationSource,
} from '../ledger/types';
import type { CoverageSummary } from '../ledger/views';
import { clockTime, formatMoney } from './format';
import { AGENT_NAMES, AGENT_ORDER, claimTypeLabel } from './paste-labels';

const GRADE_LABELS: Readonly<Record<Grade, string>> = Object.freeze({
  VERIFIED: 'Verified',
  PARTIAL: 'Partial',
  NOT_FOUND: 'Not found',
  UNASKED: 'Unasked',
  OVER_SCOPE: 'Over scope',
  UNVERIFIABLE: 'Unverifiable',
});

/** A grade's name, as every chip writes it (ux_engineer rule 1: grades are nouns). */
export const gradeLabel = (grade: Grade): string => GRADE_LABELS[grade];

const SOURCE_NAMES: Readonly<Record<ObservationSource, string>> = Object.freeze({
  'gmail.sent': 'Gmail Sent',
  'gmail.receipt': 'Gmail receipts',
  'gcal.event': 'Calendar',
});

/** What each source is called on screen. */
export const sourceName = (source: ObservationSource): string => SOURCE_NAMES[source];

const ADAPTER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'gmail.sent': 'Gmail Sent reader',
  'gmail.receipt': 'Gmail receipts reader',
  'gcal.event': 'Calendar reader',
  'muse.chat': 'Muse reader',
});

/** An adapter's or observer's name; one Attest does not know is named by its id. */
export const adapterName = (adapterId: string): string =>
  Object.hasOwn(ADAPTER_NAMES, adapterId) ? (ADAPTER_NAMES[adapterId] ?? adapterId) : adapterId;

/** One line of the coverage header: its words, and whether it reports a check recent enough to rely on. */
export interface CoverageLine {
  readonly key: string;
  readonly text: string;
  readonly current: boolean;
}

/**
 * The coverage header's lines (ux_engineer rule 2): each source the observers read, in the schema's order, from its
 * latest check, "checked 14:10" when within COVERAGE_FRESH_MINUTES of now, else "not checked since 09:12", or "not
 * checked yet" with none; then each agent whose activity was added, with when.
 */
export function coverageLines(summary: CoverageSummary, nowMs: number): CoverageLine[] {
  const lines: CoverageLine[] = ObservationSource.options.map((source) => {
    const latest = summary.coverage.find((ping) => ping.source === source);
    const name = sourceName(source);
    if (latest === undefined) return { key: source, text: `${name} not checked yet`, current: false };
    const at = clockTime(latest.lastSyncAt, nowMs);
    const current = nowMs - Date.parse(latest.lastSyncAt) <= COVERAGE_FRESH_MINUTES * MS_PER_MINUTE;
    return {
      key: source,
      text: current ? `${name} checked ${at}` : `${name} not checked since ${at}`,
      current,
    };
  });
  for (const agent of AGENT_ORDER) {
    const at = summary.imports[agent];
    if (at === undefined) continue;
    lines.push({
      key: agent,
      text: `${AGENT_NAMES[agent]} activity added ${clockTime(at, nowMs)}`,
      current: true,
    });
  }
  return lines;
}

/** The degraded banner's line for one adapter (ux_engineer rule 3): which reader, which version, and what it means. */
export const degradedLine = (health: AdapterHealth): string =>
  `${adapterName(health.adapterId)} ${health.version} is not reading its page as expected. Receipts that need it may be Unverifiable.`;

/** The Chrome major version in a user agent string, or null without one. */
export function chromeMajor(userAgent: string): string | null {
  return /\bChrome\/(\d+)/u.exec(userAgent)?.[1] ?? null;
}

/**
 * A new GitHub issue about a degraded adapter (ux_engineer rule 3), filled in with its id and version and the Chrome
 * major version, and nothing else: no reason code, no page, no account.
 */
export function reportUrl(health: AdapterHealth, userAgent: string): string {
  const chrome = chromeMajor(userAgent) ?? 'unknown';
  const query = new URLSearchParams({
    title: `Degraded: ${health.adapterId} ${health.version}`,
    body: `Adapter: ${health.adapterId}\nVersion: ${health.version}\nChrome: ${chrome}\n`,
  });
  return `${ISSUES_URL}?${query.toString()}`;
}

const EVIDENCE_KINDS: Readonly<Record<Observation['type'], string>> = Object.freeze({
  'email.sent': 'Sent-folder row',
  'purchase.made': 'Order email',
  'subscription.changed': 'Subscription email',
  'listing.posted': 'Listing email',
  'calendar.created': 'Calendar event created',
  'calendar.updated': 'Calendar event changed',
  'calendar.deleted': 'Calendar event cancelled',
  'message.sent': 'Message sent',
  other: 'Other evidence',
});

/** One piece of evidence in one line (ux_engineer rule 5): "Sent-folder row, 14:02, to priya@example.com, “Q3 deck”". */
export function evidenceSummary(observation: Observation, nowMs: number): string {
  const parts = [EVIDENCE_KINDS[observation.type], clockTime(observation.occurredAt, nowMs)];
  if (observation.counterparty !== undefined) {
    parts.push(`${observation.type === 'email.sent' ? 'to' : 'with'} ${observation.counterparty}`);
  }
  if (observation.merchant !== undefined) parts.push(observation.merchant);
  if (observation.amountCents !== undefined && observation.currency !== undefined) {
    parts.push(formatMoney(observation.amountCents, observation.currency));
  }
  if (observation.subjectHint !== undefined) parts.push(`“${observation.subjectHint}”`);
  return parts.join(', ');
}

/**
 * Every field of a piece of evidence, as label and value, in the order the detail lists them: what Attest stored about
 * it, all of it (sprint_4 4.3: the detail shows every field that fed the score). "First seen" is its sighting
 * (`sightedAt` when the ledger stored it later, else `observedAt`); "Stored" is when the ledger stored it.
 */
export function evidenceFields(observation: Observation, nowMs: number): [string, string][] {
  const fields: [string, string][] = [
    ['Source', sourceName(observation.source)],
    ['What', claimTypeLabel(observation.type)],
    ['When', clockTime(observation.occurredAt, nowMs)],
  ];
  if (observation.counterparty !== undefined) {
    fields.push([observation.type === 'email.sent' ? 'To' : 'With', observation.counterparty]);
  }
  if (observation.merchant !== undefined) fields.push(['Merchant', observation.merchant]);
  if (observation.amountCents !== undefined && observation.currency !== undefined) {
    fields.push(['Amount', formatMoney(observation.amountCents, observation.currency)]);
  }
  if (observation.subjectHint !== undefined) fields.push(['Subject', observation.subjectHint]);
  fields.push(['First seen', clockTime(observation.sightedAt ?? observation.observedAt, nowMs)]);
  fields.push(['Stored', clockTime(observation.observedAt, nowMs)]);
  return fields;
}

/** An agent's name, as every surface writes it. */
export const agentName = (agent: AgentId): string => AGENT_NAMES[agent];
