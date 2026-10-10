/**
 * The advisory model's cache key (sprint_5 5.3, 5.4; agents/intel_engineer.md rule 7: cost is the person's): the
 * SHA-256 of an input's canonical JSON (src/core/hash.ts), so two inputs with the same facts hash alike whatever the
 * order their keys were written in. The ledger keeps it beside each claim's answer (src/ledger/model-answers.ts): an
 * input a provider answered once is never sent to it again. A hash of allowlisted facts, never the facts themselves.
 */
import { hashCanonical } from '../core/hash';
import { Sha256 } from '../core/schema';
import type { IntelInput } from './input';

/** The hash of `input` (header). */
export function inputsHash(input: IntelInput): Sha256 {
  return Sha256.parse(hashCanonical(input));
}
