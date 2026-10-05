/**
 * ./selectors.json, parsed and compiled once (sprint_2 2.3; agents/adapter_engineer.md rule 3).
 *
 * The file is ours, not the page's, but it is still checked at the boundary (Zod, strict): a misspelt key, a regex
 * that does not compile, a currency that is not ISO 4217, two platforms claiming one sender domain, or a kind that
 * cannot name its merchant or its amount line throws `ReceiptError('invalid_selectors')` when the module loads,
 * before any page is read (Hard Rule 6). Every regex is compiled with the `iu` flags. Nothing here ever turns page
 * text into a pattern (adapter_engineer rule 6).
 *
 * The sender registry (`RECEIPT_SENDER_DOMAINS`) is the one list of domains whose mail a platform parser owns. The
 * fixture sanitiser keeps these domains (with fake local parts) and, for `RECEIPT_SENDER_NAME_DOMAINS`, a business's
 * display name, so a real receipt capture stays parseable (tests/tools/sanitize.ts).
 */
import { z } from 'zod';

import { asciiLower, type CurrencyCode, isCurrencyCode } from '../../../core/normalize';
import { ComponentId } from '../../../core/schema';
import { ReceiptError } from './errors';
import raw from './selectors.json' with { type: 'json' };

export const PLATFORM_IDS = [
  'stripe',
  'amazon',
  'marketplace',
  'opentable',
  'instacart',
  'uber',
  'shopify',
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];
export type ParserId = PlatformId | 'generic';

export const RECEIPT_TYPES = ['purchase.made', 'subscription.changed', 'listing.posted'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

const LABEL = z.string().min(1).max(64);
const SOURCE = z.string().min(1).max(512);
const DOMAIN = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u, 'expected a domain');
const DOLLAR = z.string().refine(isCurrencyCode, 'expected an ISO 4217 code');

const KindShape = z.strictObject({
  subject: SOURCE,
  exclude: SOURCE.optional(),
  type: z.enum(RECEIPT_TYPES),
  labels: z.array(LABEL),
  amount: z.enum(['required', 'optional']),
});

const MerchantShape = z.union([
  z.strictObject({ canonical: z.string().min(1).max(64) }),
  z.strictObject({ from: z.enum(['senderName', 'subject']) }),
]);

const PlatformShape = z.strictObject({
  senderDomains: z.array(DOMAIN).min(1),
  keepSenderName: z.boolean(),
  defaultDollar: DOLLAR,
  merchant: MerchantShape,
  kinds: z.array(KindShape).min(1),
});

const LandmarksShape = z.strictObject({
  main: SOURCE,
  subject: SOURCE,
  message: SOURCE,
  messageKey: SOURCE,
  expanded: SOURCE,
  sender: SOURCE,
  senderAddress: SOURCE,
  senderName: SOURCE,
  date: SOURCE,
  dateTitle: SOURCE,
  dateAlt: SOURCE,
  account: SOURCE,
  accountAttribute: SOURCE,
  header: SOURCE,
  blocks: SOURCE,
  cells: SOURCE,
});

const SelectorsShape = z.strictObject({
  $comment: z.string(),
  observer: z.literal('gmail.receipt'),
  version: ComponentId,
  fixtures: z.array(z.string().min(1)).min(1),
  landmarks: LandmarksShape,
  text: z.strictObject({ noSubject: z.array(z.string().min(1)) }),
  threadUrl: SOURCE,
  platforms: z.strictObject({
    stripe: PlatformShape,
    amazon: PlatformShape,
    marketplace: PlatformShape,
    opentable: PlatformShape,
    instacart: PlatformShape,
    uber: PlatformShape,
    shopify: PlatformShape,
  }),
  generic: z.strictObject({
    defaultDollar: DOLLAR,
    confidence: z.number().min(0).max(1),
    senderTrigger: z.string().regex(/^[a-z0-9]+$/u),
    subjectTrigger: SOURCE,
    refuseSubject: z.array(SOURCE).min(1),
    labels: z.array(LABEL).min(1),
    impersonationTokens: z.array(z.string().regex(/^[a-z0-9]+$/u)).min(1),
  }),
});

export interface Kind {
  readonly subject: RegExp;
  readonly exclude: RegExp | null;
  readonly type: ReceiptType;
  /** Total-line labels, most preferred first (`Amount paid` before `Total`). */
  readonly labels: readonly string[];
  /** `optional`: a receipt of this kind may carry no amount (a cancelled subscription). */
  readonly amount: 'required' | 'optional';
}

export type MerchantRule = { readonly canonical: string } | { readonly from: 'senderName' | 'subject' };

export interface Platform {
  readonly id: PlatformId;
  readonly senderDomains: readonly string[];
  readonly keepSenderName: boolean;
  /** What a bare `$` means in this sender's mail. */
  readonly defaultDollar: CurrencyCode;
  readonly merchant: MerchantRule;
  readonly kinds: readonly Kind[];
}

export interface GenericRules {
  readonly defaultDollar: CurrencyCode;
  readonly confidence: number;
  readonly senderTrigger: string;
  readonly subjectTrigger: RegExp;
  readonly refuseSubject: RegExp;
  readonly labels: readonly string[];
  readonly impersonationTokens: ReadonlySet<string>;
}

export type Landmarks = z.infer<typeof LandmarksShape>;

export interface ReceiptSelectors {
  readonly observer: 'gmail.receipt';
  readonly version: string;
  /** The fixture folders this version was checked against (agents/adapter_engineer.md rule 3). */
  readonly fixtures: readonly string[];
  readonly landmarks: Landmarks;
  /** Gmail's placeholders for an empty subject: interface text, never a subject (Decisions [2.1/2.4]). */
  readonly noSubject: ReadonlySet<string>;
  readonly threadUrl: RegExp;
  readonly platforms: Readonly<Record<PlatformId, Platform>>;
  readonly generic: GenericRules;
}

function compile(source: string): RegExp {
  try {
    return new RegExp(source, 'iu');
  } catch {
    throw new ReceiptError('invalid_selectors');
  }
}

/** One regex that matches where any of `sources` does; each must compile on its own (one per refusal family). */
function compileAny(sources: readonly string[]): RegExp {
  for (const source of sources) compile(source);
  return compile(sources.map((source) => `(?:${source})`).join('|'));
}

function dollar(code: string): CurrencyCode {
  if (!isCurrencyCode(code)) throw new ReceiptError('invalid_selectors');
  return code;
}

type KindInput = z.infer<typeof KindShape>;
type PlatformInput = z.infer<typeof PlatformShape>;

/** A kind must be able to name its amount line (labels, or the subject's `item`) and, if asked, its merchant. */
function compileKind(input: KindInput, merchant: PlatformInput['merchant']): Kind {
  const subject = compile(input.subject);
  const fromSubject = 'from' in merchant && merchant.from === 'subject';
  if (fromSubject && !input.subject.includes('(?<merchant>')) throw new ReceiptError('invalid_selectors');
  if (input.labels.length === 0 && !input.subject.includes('(?<item>')) {
    throw new ReceiptError('invalid_selectors');
  }
  const exclude = input.exclude === undefined ? null : compile(input.exclude);
  return Object.freeze({ subject, exclude, type: input.type, labels: input.labels, amount: input.amount });
}

function compilePlatform(id: PlatformId, input: PlatformInput): Platform {
  return Object.freeze({
    id,
    senderDomains: Object.freeze([...input.senderDomains]),
    keepSenderName: input.keepSenderName,
    defaultDollar: dollar(input.defaultDollar),
    merchant: Object.freeze({ ...input.merchant }),
    kinds: Object.freeze(input.kinds.map((kind) => compileKind(kind, input.merchant))),
  });
}

function load(value: unknown): ReceiptSelectors {
  const parsed = SelectorsShape.safeParse(value);
  if (!parsed.success) throw new ReceiptError('invalid_selectors');
  const data = parsed.data;
  const entries = PLATFORM_IDS.map((id) => [id, compilePlatform(id, data.platforms[id])] as const);
  const platforms = Object.fromEntries(entries) as Record<PlatformId, Platform>;
  const domains = PLATFORM_IDS.flatMap((id) => platforms[id].senderDomains);
  if (new Set(domains).size !== domains.length) throw new ReceiptError('invalid_selectors');
  const generic = data.generic;
  return Object.freeze({
    observer: data.observer,
    version: data.version,
    fixtures: Object.freeze([...data.fixtures]),
    landmarks: Object.freeze({ ...data.landmarks }),
    noSubject: new Set(data.text.noSubject),
    threadUrl: compile(data.threadUrl),
    platforms: Object.freeze(platforms),
    generic: Object.freeze({
      defaultDollar: dollar(generic.defaultDollar),
      confidence: generic.confidence,
      senderTrigger: generic.senderTrigger,
      subjectTrigger: compile(generic.subjectTrigger),
      refuseSubject: compileAny(generic.refuseSubject),
      labels: Object.freeze([...generic.labels]),
      impersonationTokens: new Set(generic.impersonationTokens),
    }),
  });
}

/** Parses a selectors document (exported for tests: a broken file must throw, never half-load). */
export function loadReceiptSelectors(value: unknown): ReceiptSelectors {
  return load(value);
}

export const RECEIPT_SELECTORS: ReceiptSelectors = load(raw);

/** True when `domain` is `registered` or a subdomain of it (both ASCII; compared after ASCII lowercasing). */
function underDomain(domain: string, registered: string): boolean {
  const lower = asciiLower(domain);
  return lower === registered || lower.endsWith(`.${registered}`);
}

/** The platform whose sender list holds `domain` (or a parent of it), if any. */
export function platformForDomain(domain: string): Platform | undefined {
  return PLATFORM_IDS.map((id) => RECEIPT_SELECTORS.platforms[id]).find((platform) =>
    platform.senderDomains.some((registered) => underDomain(domain, registered)),
  );
}

/** Every sender domain in the receipt-parser registry, sorted. */
export const RECEIPT_SENDER_DOMAINS: readonly string[] = Object.freeze(
  PLATFORM_IDS.flatMap((id) => RECEIPT_SELECTORS.platforms[id].senderDomains).sort(),
);

/**
 * The registry domains whose senders' display names are a business's name (the merchant, or the platform itself,
 * which its receipt subjects name too), so the sanitiser may keep them: only a machine sender's (`+tag`) or one
 * that names a registry brand (`RECEIPT_BRAND_TOKENS`), never a person's (tests/tools/sanitize.ts). Not
 * Facebook's: facebookmail.com relays mail from people.
 */
export const RECEIPT_SENDER_NAME_DOMAINS: readonly string[] = Object.freeze(
  PLATFORM_IDS.map((id) => RECEIPT_SELECTORS.platforms[id])
    .filter((platform) => platform.keepSenderName)
    .flatMap((platform) => platform.senderDomains)
    .sort(),
);

/** True when `domain` is a registry domain or a subdomain of one in `registry`. */
export function inRegistry(domain: string, registry: readonly string[] = RECEIPT_SENDER_DOMAINS): boolean {
  return registry.some((registered) => underDomain(domain, registered));
}

/** The registry merchants' brand tokens (`amazon`, `uber`, …): a name holding one is a business, not a person. */
export const RECEIPT_BRAND_TOKENS: ReadonlySet<string> = RECEIPT_SELECTORS.generic.impersonationTokens;
