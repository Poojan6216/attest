/**
 * The meta keys of each agent's last pasted import (src/background/claims-import.ts writes them; ./meta-keys.ts lists
 * them with every other key). A module of its own, so a page reads them without loading every module that owns a key.
 */
import type { AgentId } from './types';

/** The prefix of each agent's last-import key. */
export const LAST_IMPORT_PREFIX = 'lastImportAt.';

/**
 * The meta key of `agent`'s last pasted import: the instant the service worker stored it, which counts as the
 * agent's adapter sync for UNASKED finality (docs/grading.md §7).
 */
export const lastImportKey = (agent: AgentId): string => `${LAST_IMPORT_PREFIX}${agent}`;
