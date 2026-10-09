/**
 * The meta keys kept per agent (./meta-keys.ts lists them with every other key): its last pasted import
 * (src/background/claims-import.ts writes it) and whether its alerts are muted (the options page's Grants, sprint_4
 * 4.4; read by the alerts of 4.6). A module of its own, so a page reads them without loading every module that owns a
 * key.
 */
import type { AgentId } from './types';

/** The prefix of each agent's last-import key. */
export const LAST_IMPORT_PREFIX = 'lastImportAt.';

/**
 * The meta key of `agent`'s last pasted import: the instant the service worker stored it, which counts as the
 * agent's adapter sync for UNASKED finality (docs/grading.md §7).
 */
export const lastImportKey = (agent: AgentId): string => `${LAST_IMPORT_PREFIX}${agent}`;

/** The prefix of each agent's alert-mute key. */
export const ALERTS_MUTED_PREFIX = 'alertsMuted.';

/** The meta key of whether `agent`'s alerts are muted (`true`), set with its grant in the options page. */
export const alertsMutedKey = (agent: AgentId): string => `${ALERTS_MUTED_PREFIX}${agent}`;
