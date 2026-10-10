/**
 * Every key the ledger's `meta` table holds (docs/privacy-architecture.md §5.6; tech review TECH-4): one list, which
 * the docs test holds that section to, so no key is added without being documented. A key that ends in `.` is a
 * prefix: one key per agent, or per clock repair. Instants, counts and an id only, never content (Hard Rule 2).
 */
import { OPEN_IDLE } from './activity';
import { AUTO_CHECK_AGENTS, AUTO_CHECK_AT, AUTO_CHECK_CLAIMS, AUTO_CHECK_UNTIL } from './auto-check-record';
import { FLAG_PREFIX, READER_OFF_PREFIX } from './consent';
import { GRADED_WRITES, LAST_EVALUATED_AT } from './batch-instant';
import { CLOCK_FLOOR_AT } from './clock-guard';
import { CLOCK_HIGH_WATER, STORED_WRITES } from './clock-high-water';
import { CLOCK_REPAIR_PREFIX } from './clock-repairs';
import { PURGE_TRUSTED_AT } from './retention-clock';
import { RETENTION_DAYS_KEY } from './settings';

import { ALERTS_MUTED_PREFIX, LAST_IMPORT_PREFIX } from './agent-keys';

export { ALERTS_MUTED_PREFIX, alertsMutedKey, LAST_IMPORT_PREFIX, lastImportKey } from './agent-keys';

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
  ALERTS_MUTED_PREFIX,
  RETENTION_DAYS_KEY,
  AUTO_CHECK_AT,
  AUTO_CHECK_UNTIL,
  AUTO_CHECK_CLAIMS,
  AUTO_CHECK_AGENTS,
  READER_OFF_PREFIX,
  FLAG_PREFIX,
]);
