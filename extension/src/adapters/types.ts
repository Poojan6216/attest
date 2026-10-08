/**
 * The agent adapter contract (build_spec §7 "Adapter contract"; sprint_3 3.0; agents/adapter_engineer.md;
 * docs/adapters.md §9). Types only. A Muse, ChatGPT/Dots or Claude adapter implements `AgentAdapter`; the skeleton in
 * ./base.ts runs it: `health()` → `extract()` → Requests and Claims (./claims.ts, ./patterns.ts) → bus.
 *
 * Every function here is pure over the DOM (Hard Rule 3): it reads `doc`, returns data, and never mutates,
 * dispatches, focuses, scrolls, fetches or stores. If a claim is not rendered, it is not read (sprint_3: no clicking
 * "show more", no expanding activity rows). `attest/no-act` lints all of src/adapters/**.
 *
 * Kept apart from ./base.ts so an extractor (`src/adapters/<vendor>/…`) can import the contract without importing
 * the bus, which its lint scope forbids (eslint-rules/fences.js EXTRACTOR_RESTRICTED_IMPORTS).
 */
import type { AgentId } from '../core/schema';
import type { ExtractContext, HealthCheck } from '../observers/types';

export type { ExtractContext, HealthCheck } from '../observers/types';

/** One turn of a conversation, as the page shows it. */
export interface AgentTurn {
  /** Who wrote it: the user (a Request) or the agent (whose sentences may be Claims). */
  readonly role: 'user' | 'agent';
  /**
   * The turn's text as the page shows it. It never leaves the content script whole: a Request keeps its hash and a
   * hint, a Claim the facts its pattern read (Hard Rule 2).
   */
  readonly text: string;
  /**
   * When it was written, as the page shows it: an ISO 8601 instant with an offset (a `datetime` attribute) or
   * vendor-relative text ("2:03 PM", "Yesterday"). Null when the page shows no time: the turn then gives no Request
   * and no Claim (Hard Rule 5), and the pass says so.
   */
  readonly time: string | null;
  /** The vendor's own id for the turn, when the page shows one; only its SHA-256 is kept. */
  readonly rowKey?: string | undefined;
}

/** One entry of an agent's activity view, or one tool-use entry in a thread. `time` and `rowKey` as `AgentTurn`'s. */
export interface ActivityEntry {
  readonly text: string;
  readonly time: string | null;
  readonly rowKey?: string | undefined;
}

/** What one read of an agent page holds. */
export interface AgentRead {
  /**
   * The vendor's id of the conversation shown (from the address or the page; a vendor id token, never its title or
   * first lines), or null on a page with none, which then has no Requests.
   */
  readonly conversationId: string | null;
  readonly turns: readonly AgentTurn[];
  readonly activity: readonly ActivityEntry[];
  /** The scopes a settings page lists (connected apps, permissions), as the page names them; null on other pages. */
  readonly scopes: readonly string[] | null;
}

/** build_spec §7's adapter contract for an agent page, with the skeleton's `HealthCheck` (see ../observers/types). */
export interface AgentAdapter {
  /** A short token (`claude.chat`): ComponentId. Bump `version` whenever selectors.json changes. */
  readonly id: string;
  readonly agent: AgentId;
  readonly vendor: string;
  readonly version: string;
  /** Exact host permissions (src/config.ts AGENT_HOSTS of its agent), never a wildcard (Hard Rule 8). */
  readonly hosts: readonly string[];
  /** Every attribute a read of the page depends on (../observers/types `Observer.attributes`). Absent: all. */
  readonly attributes?: readonly string[] | undefined;
  /** Runs first, on every pass. IDLE or DEGRADED → nothing is extracted (Hard Rule 6). */
  readonly health: (doc: Document, ctx?: ExtractContext) => HealthCheck;
  /** Pure over the DOM; never mutates, never dispatches events (Hard Rule 3). */
  readonly extract: (doc: Document, ctx: ExtractContext) => AgentRead;
}
