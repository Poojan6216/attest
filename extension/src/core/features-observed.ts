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
import { instantMs } from './normalize';
import type { Observation } from './schema';

/** The observation fields features read. A parsed `Observation` satisfies it. */
export interface FeatureObservation extends Money {
  readonly counterparty?: string | undefined;
  readonly merchant?: string | undefined;
  readonly subjectHint?: string | undefined;
  readonly occurredAt: string;
}

/** One observation's raw fields and, computed on first use, what features read of them. */
export class ObservedFacts implements Money {
  #occurredMs: number | undefined;
  #address: PreparedAddress | null | undefined;
  #subject: ReadonlySet<string> | undefined;
  #merchant: PreparedMerchant | null | undefined;

  constructor(
    occurredMs: number | undefined,
    readonly occurredAt: string,
    readonly counterparty: string | undefined,
    readonly subjectHint: string | undefined,
    readonly merchant: string | undefined,
    readonly amountCents: number | undefined,
    readonly currency: string | undefined,
    readonly stopWords: readonly string[],
  ) {
    this.#occurredMs = occurredMs;
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
      const parsed = observedAddress(this.counterparty);
      this.#address = parsed === null ? null : prepareAddress(parsed);
    }
    return this.#address;
  }

  /** The §11 subject tokens (none when there is no subject). */
  get subject(): ReadonlySet<string> {
    this.#subject ??= subjectTokensWithout(this.subjectHint, stopWordSet(this.stopWords));
    return this.#subject;
  }

  /** The merchant read as a name (§5.1); null when it has no name tokens. */
  get merchantName(): PreparedMerchant | null {
    if (this.#merchant === undefined) this.#merchant = prepareMerchant(this.merchant);
    return this.#merchant;
  }
}

const OBSERVED = new WeakMap<FeatureObservation, ObservedFacts>();

/** The facts of `observation` under `stopWords`, read once per object while its fields are unchanged. */
/**
 * Whether `observation` is an index row (it carries an Observation's identity fields): its `occurredAt` instant is
 * then the one candidates-time.ts parsed for retrieval and keeps (checked against the same text), not parsed again.
 */
function isIndexRow(observation: FeatureObservation): observation is Observation {
  return 'contentHash' in observation && 'id' in observation && 'observedAt' in observation;
}

export function observedFacts(observation: FeatureObservation, stopWords: readonly string[]): ObservedFacts {
  const held = OBSERVED.get(observation);
  if (held?.matches(observation, stopWords) === true) return held;
  const facts = new ObservedFacts(
    isIndexRow(observation) ? occurredMs(observation) : undefined,
    observation.occurredAt,
    observation.counterparty,
    observation.subjectHint,
    observation.merchant,
    observation.amountCents,
    observation.currency,
    stopWords,
  );
  OBSERVED.set(observation, facts);
  return facts;
}
