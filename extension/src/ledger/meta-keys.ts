/**
 * Every key the ledger's `meta` table holds (docs/privacy-architecture.md §5.6; tech review TECH-4): one list, which
 * the docs test holds that section to, so no key is added without being documented. A key that ends in `.` is a
 * prefix: one key per agent, or per clock repair. Instants, counts and an id only, never content (Hard Rule 2).
 */
import { OPEN_IDLE } from './activity';
import { GRADED_WRITES, LAST_EVALUATED_AT } from './batch-instant';
import { CLOCK_FLOOR_AT } from './clock-guard';
import { CLOCK_HIGH_WATER, STORED_WRITES } from './clock-high-water';
import { CLOCK_REPAIR_PREFIX } from './clock-repairs';
import { PURGE_TRUSTED_AT } from './retention-clock';
import type { AgentId } from './types';

/** The prefix of each agent's last-import key (src/background/claims-import.ts writes them). */
export const LAST_IMPORT_PREFIX = 'lastImportAt.';

/**
 * The meta key of `agent`'s last pasted import: the instant the service worker stored it, which counts as the
 * agent's adapter sync for UNASKED finality (docs/grading.md §7).
 */
export const lastImportKey = (agent: AgentId): string => `${LAST_IMPORT_PREFIX}${agent}`;

/** Every meta key, a prefix for each family of them. */
export const META_KEYS: readonly string[] = Object.freeze([
  LAST_EVALUATED_AT,
  GRADED_WRITES,
  CLOCK_HIGH_WATER,
  STORED_WRITES,
  CLOCK_FLOOR_AT,
  CLOCK_REPAIR_PREFIX,
  PURGE_TRUSTED_AT,
  OPEN_IDLE,
  LAST_IMPORT_PREFIX,
]);
