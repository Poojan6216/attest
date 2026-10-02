/**
 * An observation's parsed fields for features.ts (docs/grading.md §5.1, §11; the task 1.5 grading perf gate).
 * Internal to features.ts. Pure: a memo never changes a result (Hard Rule 4).
 *
 * An index hands one observation to every claim whose window holds it (a calendar event lies in every window
 * within ±calendarDays of it), so its instant, address, subject tokens and merchant name are parsed once per
 * object, each on first use, and kept on one `ObservedFacts` per object. The memo is keyed by object identity
 * and weakly held, so it never outlives the observation, and an entry is used only while the observation still
 * holds every raw field it was read from (and the stop-word list is the same array): the parsed `Observation`
 * type is mutable, and an object edited in place must never be scored from its old fields.
 */
import {
  type Money,
  type PreparedMerchant,
  prepareMerchant,
  stopWordSet,
  subjectTokensWithout,
} from './features-content';
import { observedAddress, type PreparedAddress, prepareAddress } from './features-counterparty';
import { occurredMs } from './candidates-time';
import { type Counterparty, counterparty, instantMs } from './normalize';
import type { Observation } from './schema';

/** The observation fields features read. A parsed `Observation` satisfies it. */
export interface FeatureObservation extends Money {
  readonly counterparty?: string | undefined;
  readonly merchant?: string | undefined;
  readonly subjectHint?: string | undefined;
  readonly occurredAt: string;
}

/**
 * Texts already read, shared by the observations of one batch under one stop-word list: equal text always reads
 * the same (each reader is a pure function of it), and many rows carry the same counterparty, subject or merchant,
 * so each distinct text is read once. The values are never modified. Lives only as long as the batch.
 */
export class TextFacts {
  readonly addresses = new Map<string, Read<PreparedAddress | null>>();
  readonly subjects = new Map<string, Read<ReadonlySet<string>>>();
  readonly merchants = new Map<string, Read<PreparedMerchant | null>>();
  readonly parties = new Map<string, Read<Counterparty | null>>();

  constructor(readonly stopWords: readonly string[]) {}

  /** `subjectTokensWithout(raw, stopWordSet(stopWords))`, once per text. */
  subject(raw: string | undefined): ReadonlySet<string> {
    return readSubject(raw, this.stopWords, this);
  }

  /** `prepareMerchant(raw)`, once per text. */
  merchant(raw: string | undefined): PreparedMerchant | null {
    return raw === undefined ? null : readOnce(this.merchants, raw, prepareMerchant);
  }

  /** `counterparty(raw)` (normalize.ts), once per text. */
  party(raw: string | undefined): Counterparty | null {
    return raw === undefined ? null : readOnce(this.parties, raw, counterparty);
  }
}

interface Read<T> {
  readonly value: T;
}

/** `read(text)`, from `held` when the same text was read before. */
function readOnce<T>(held: Map<string, Read<T>> | undefined, text: string, read: (text: string) => T): T {
  const hit = held?.get(text);
  if (hit !== undefined) return hit.value;
  const value = read(text);
  held?.set(text, { value });
  return value;
}

/** The §11 subject tokens of `raw` under `stopWords`, read once per text in a batch (`texts`). */
function readSubject(
  raw: string | undefined,
  stopWords: readonly string[],
  texts: TextFacts | null,
): ReadonlySet<string> {
  const hit = raw === undefined ? undefined : texts?.subjects.get(raw);
  if (hit !== undefined) return hit.value;
  const value = subjectTokensWithout(raw, stopWordSet(stopWords));
  if (raw !== undefined) texts?.subjects.set(raw, { value });
  return value;
}

function readAddress(raw: string): PreparedAddress | null {
  const parsed = observedAddress(raw);
  return parsed === null ? null : prepareAddress(parsed);
}

/** One observation's raw fields and, computed on first use, what features read of them. */
export class ObservedFacts implements Money {
  #occurredMs: number | undefined;
  #address: PreparedAddress | null | undefined;
  #subject: ReadonlySet<string> | undefined;
  #merchant: PreparedMerchant | null | undefined;
  /** Texts already read in this batch, under `stopWords` (`TextFacts`); null when the facts stand alone. */
  readonly #texts: TextFacts | null;

  constructor(
    occurredMs: number | undefined,
    readonly occurredAt: string,
    readonly counterparty: string | undefined,
    readonly subjectHint: string | undefined,
    readonly merchant: string | undefined,
    readonly amountCents: number | undefined,
    readonly currency: string | undefined,
    readonly stopWords: readonly string[],
    texts: TextFacts | null = null,
  ) {
    this.#occurredMs = occurredMs;
    this.#texts = texts?.stopWords === stopWords ? texts : null;
  }

  /** Whether these facts were read from exactly what `observation` and `stopWords` hold now. */
  matches(observation: FeatureObservation, stopWords: readonly string[]): boolean {
    return (
      this.occurredAt === observation.occurredAt &&
      this.counterparty === observation.counterparty &&
      this.subjectHint === observation.subjectHint &&
      this.merchant === observation.merchant &&
      this.amountCents === observation.amountCents &&
      this.currency === observation.currency &&
      this.stopWords === stopWords
    );
  }

  /** The `occurredAt` instant (epoch ms). Throws `NormalizeError` like `instantMs`, and then keeps nothing. */
  get occurredMs(): number {
    this.#occurredMs ??= instantMs(this.occurredAt);
    return this.#occurredMs;
  }

  /** The counterparty read through `email()` (§5.1), prepared for comparison; null when it has no address. */
  get address(): PreparedAddress | null {
    if (this.#address === undefined) {
      const raw = this.counterparty;
      this.#address = raw === undefined ? null : readOnce(this.#texts?.addresses, raw, readAddress);
    }
    return this.#address;
  }

  /** The §11 subject tokens (none when there is no subject). */
  get subject(): ReadonlySet<string> {
    this.#subject ??= readSubject(this.subjectHint, this.stopWords, this.#texts);
    return this.#subject;
  }

  /** The merchant read as a name (§5.1); null when it has no name tokens. */
  get merchantName(): PreparedMerchant | null {
    if (this.#merchant === undefined) {
      const raw = this.merchant;
      this.#merchant = raw === undefined ? null : readOnce(this.#texts?.merchants, raw, prepareMerchant);
    }
    return this.#merchant;
  }
}

const OBSERVED = new WeakMap<FeatureObservation, ObservedFacts>();

/**
 * New facts of `observation` under `stopWords`, with its `occurredAt` instant when the caller already has it
 * (parsed from that same text): a batch reads each of its rows once and keeps the facts itself.
 */
export function freshFacts(
  observation: FeatureObservation,
  occurredMs: number | undefined,
  stopWords: readonly string[],
  texts: TextFacts | null = null,
): ObservedFacts {
  return new ObservedFacts(
    occurredMs,
    observation.occurredAt,
    observation.counterparty,
    observation.subjectHint,
    observation.merchant,
    observation.amountCents,
    observation.currency,
    stopWords,
    texts,
  );
}

/**
 * Whether `observation` is an index row (it carries an Observation's identity fields): its `occurredAt` instant is
 * then the one candidates-time.ts parsed for retrieval and keeps (checked against the same text), not parsed again.
 */
function isIndexRow(observation: FeatureObservation): observation is Observation {
  return 'contentHash' in observation && 'id' in observation && 'observedAt' in observation;
}

/** The facts of `observation` under `stopWords`, read once per object while its fields are unchanged. */
export function observedFacts(observation: FeatureObservation, stopWords: readonly string[]): ObservedFacts {
  const held = OBSERVED.get(observation);
  if (held?.matches(observation, stopWords) === true) return held;
  const facts = freshFacts(
    observation,
    isIndexRow(observation) ? occurredMs(observation) : undefined,
    stopWords,
  );
  OBSERVED.set(observation, facts);
  return facts;
}
