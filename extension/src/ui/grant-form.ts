/**
 * The options page's grant form (sprint_4 4.4; agents/ux_engineer.md rule 7: grants in plain language, Zod validation
 * with inline errors, explicit Save): a draft the person edits, made from an agent's stored grant (or the default one,
 * every action allowed), and the grant it makes, or why not. Pure.
 *
 *  - Recipients: one per line, each a domain (`example.com`) or an address (`priya@example.com`), at most 200 of 320
 *    characters; blank lines are skipped, repeats kept once, and a domain written in capitals is the same domain.
 *  - Spend ceiling: a whole number in the currency's main unit (dollars, euros, yen), stored in its minor units
 *    (cents), or blank for none.
 *  - Declared access: one per line, at most 200 of 120 characters.
 *  - Alerts: muted or not, kept beside the grant (ledger meta `alertsMuted.<agent>`), never in it.
 */
import type { GrantChoices } from '../bus/messages';
import { CURRENCY_MINOR_UNITS } from '../core/units';
import { ActionType, type AgentId, type Grant, SCHEMA_LIMITS } from '../core/schema';
import { DOMAIN, DOMAIN_LABEL } from '../ledger/domain';
import { formatMoney } from './format';

/** What the form holds for one agent. */
export interface GrantDraft {
  readonly allowedTypes: readonly ActionType[];
  /** One recipient per line. */
  readonly recipients: string;
  /** A whole number, or blank for no ceiling. */
  readonly ceiling: string;
  readonly currency: keyof typeof CURRENCY_MINOR_UNITS;
  /** One declared access per line. */
  readonly access: string;
  readonly muted: boolean;
}

export type DraftField = 'recipients' | 'ceiling' | 'access';

export type DraftResult =
  | { readonly ok: true; readonly grant: GrantChoices; readonly muted: boolean }
  | { readonly ok: false; readonly errors: Readonly<Partial<Record<DraftField, string>>> };

export const CURRENCIES = Object.keys(CURRENCY_MINOR_UNITS) as readonly (keyof typeof CURRENCY_MINOR_UNITS)[];

const L = SCHEMA_LIMITS;
const ADDRESS = new RegExp(`^[^\\s@]{1,64}@(?:${DOMAIN_LABEL}\\.)+[a-z]{2,63}$`, 'iu');

const isCurrency = (code: string): code is keyof typeof CURRENCY_MINOR_UNITS =>
  Object.hasOwn(CURRENCY_MINOR_UNITS, code);

/** The draft of `grant` (or, with none, of the default: every action, no recipient list, no ceiling). */
export function draftOf(grant: Grant | undefined, muted: boolean): GrantDraft {
  const currency = grant?.spendCurrency ?? 'USD';
  const known = isCurrency(currency) ? currency : 'USD';
  const ceiling = grant?.spendCeilingCents ?? null;
  return {
    allowedTypes: grant?.allowedTypes ?? [...ActionType.options],
    recipients: (grant?.counterpartyAllowlist ?? []).join('\n'),
    ceiling: ceiling === null ? '' : String(ceiling / 10 ** CURRENCY_MINOR_UNITS[known]),
    currency: known,
    access:
      (grant?.declaredScopes.length ?? 0) > 0
        ? (grant?.declaredScopes ?? []).join('\n')
        : (grant?.observedScopes ?? []).join('\n'),
    muted,
  };
}

const lines = (text: string): string[] => [
  ...new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];

/** The recipients, each a domain (lower-cased) or an address, or the first line that is neither. */
function recipientsOf(text: string): string[] | string {
  // A domain in capitals is the same domain: lower-cased before repeats are dropped.
  const kept = [...new Set(lines(text).map((line) => (line.includes('@') ? line : line.toLowerCase())))];
  if (kept.length > L.LIST) return `At most ${String(L.LIST)} recipients.`;
  const wrong = kept.find(
    (line) => line.length > L.COUNTERPARTY || !(line.includes('@') ? ADDRESS : DOMAIN).test(line),
  );
  return wrong === undefined
    ? kept
    : `“${wrong}” is not a domain, such as example.com, or an address, such as priya@example.com.`;
}

/** The ceiling in minor units, null for none, or why it is not a whole number the ledger can hold. */
function ceilingOf(text: string, currency: keyof typeof CURRENCY_MINOR_UNITS): number | null | string {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,13}$/u.test(trimmed))
    return 'Write a whole number, such as 50, or leave it blank for no ceiling.';
  const minor = Number(trimmed) * 10 ** CURRENCY_MINOR_UNITS[currency];
  return minor > L.AMOUNT_CENTS ? 'That ceiling is larger than Attest can hold.' : minor;
}

/** The declared access, or why not. */
function accessOf(text: string): string[] | string {
  const kept = lines(text);
  if (kept.length > L.LIST) return `At most ${String(L.LIST)} kinds of access.`;
  return kept.some((line) => line.length > L.ITEM)
    ? `Each kind of access is at most ${String(L.ITEM)} characters.`
    : kept;
}

/**
 * What `draft` chooses for `agent` (the service worker keeps what Attest observed and stamps the save), or what each
 * field must fix.
 */
export function grantOfDraft(agent: AgentId, draft: GrantDraft): DraftResult {
  const recipients = recipientsOf(draft.recipients);
  const ceiling = ceilingOf(draft.ceiling, draft.currency);
  const access = accessOf(draft.access);
  const errors: Partial<Record<DraftField, string>> = {};
  if (typeof recipients === 'string') errors.recipients = recipients;
  if (typeof ceiling === 'string') errors.ceiling = ceiling;
  if (typeof access === 'string') errors.access = access;
  if (typeof recipients === 'string' || typeof ceiling === 'string' || typeof access === 'string')
    return { ok: false, errors };
  const grant: GrantChoices = {
    agent,
    allowedTypes: ActionType.options.filter((type) => draft.allowedTypes.includes(type)),
    counterpartyAllowlist: recipients,
    spendCeilingCents: ceiling,
    ...(ceiling === null ? {} : { spendCurrency: draft.currency }),
    declaredScopes: access,
  };
  return { ok: true, grant, muted: draft.muted };
}

const MAY: Readonly<Record<ActionType, string>> = Object.freeze({
  'email.sent': 'send email',
  'calendar.created': 'create calendar events',
  'calendar.updated': 'change calendar events',
  'calendar.deleted': 'cancel calendar events',
  'purchase.made': 'make purchases',
  'subscription.changed': 'change subscriptions',
  'listing.posted': 'post listings',
  'message.sent': 'send messages',
  other: 'do other things',
});

/**
 * A grant in plain language (agents/ux_engineer.md rule 7): "Muse may: send email, create calendar events; write
 * only to company.com; spend up to $50.00."
 */
export function grantSentence(name: string, grant: GrantChoices): string {
  if (grant.allowedTypes.length === 0) return `${name} may do nothing Attest checks.`;
  const actions = grant.allowedTypes.map((type) => MAY[type]).join(', ');
  const recipients =
    grant.counterpartyAllowlist.length === 0
      ? 'write to anyone'
      : `write only to ${grant.counterpartyAllowlist.join(', ')}`;
  const { spendCeilingCents: ceiling, spendCurrency: currency } = grant;
  const spend =
    ceiling === null || currency === undefined
      ? 'spend without a ceiling'
      : `spend up to ${formatMoney(ceiling, currency)}`;
  return `${name} may: ${actions}; ${recipients}; ${spend}.`;
}
