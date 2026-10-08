/**
 * Which site an observer or adapter message came from (SEC-V1, SEC-4; Hard Rules 5, 6).
 *
 * src/bus listen() already drops every message that is not from this extension, and only a content script can send
 * an observer message. But the extension has two content scripts on two sites, and before this check the service
 * worker took any observer id from either: a buggy or compromised Gmail content script could write a whole Calendar
 * pass (rows, a snapshot record, windows, first-look markers) or Calendar's health, and the reverse. Now an observer's
 * health, rows, pings and snapshots are accepted only from a page on its own site (src/config.ts OBSERVER_SITES and
 * OBSERVER_HOSTS), read from the sender Chrome sets (`sender.url`, and `sender.origin` when Chrome gives it, which
 * must agree), never from the message. An observer id the extension does not have is served by no site. An agent
 * adapter's health is held to the same rule, on its agent's site (src/config.ts ADAPTER_SITES and AGENT_HOSTS; sprint_3
 * 3.2): a Gmail tab cannot report Muse's health, nor a Muse tab Gmail's.
 *
 * A refusal is `invalid_input`, logged as `observer.wrong_site` with the message type and the observer id only (the
 * logger prints an id only if it is one of ours; Hard Rule 10). It does not turn the named observer DEGRADED: a page
 * on another site cannot vouch for that observer's health, in either direction (Hard Rule 6: never cry wolf).
 */
import type { MessageSender } from '../bus/listen';
import { ackRefused, type BusAck } from '../bus/messages';
import {
  ADAPTER_SITES,
  type AdapterId,
  AGENT_HOSTS,
  OBSERVER_HOSTS,
  OBSERVER_SITES,
  type ObserverId,
} from '../config';
import { log } from '../log';

/** `https://host/*` → `https://host` (src/config.ts holds exact-host match patterns only, Hard Rule 8). */
function originOfPattern(pattern: string): string {
  return pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
}

const SITE_ORIGINS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  [...Object.entries(OBSERVER_HOSTS), ...Object.entries(AGENT_HOSTS)].map(([site, patterns]) => [
    site,
    new Set(patterns.map(originOfPattern)),
  ]),
);

const isObserverId = (id: string): id is ObserverId => Object.hasOwn(OBSERVER_SITES, id);

/** Whether `id` names an agent adapter the service worker hears from (src/config.ts ADAPTER_SITES). */
export const isAdapterId = (id: string): id is AdapterId => Object.hasOwn(ADAPTER_SITES, id);

/** The site whose content script speaks for an observer or an adapter; undefined for an id the extension lacks. */
function siteOf(id: string): string | undefined {
  if (isObserverId(id)) return OBSERVER_SITES[id];
  return isAdapterId(id) ? ADAPTER_SITES[id] : undefined;
}

/** The sender's origin, or null when Chrome gave no URL, a URL that does not parse, or an origin that disagrees. */
export function senderOrigin(sender: MessageSender): string | null {
  if (typeof sender.url !== 'string') return null;
  let origin: string;
  try {
    origin = new URL(sender.url).origin;
  } catch {
    return null;
  }
  const stated: unknown = Reflect.get(sender, 'origin');
  return stated === undefined || stated === origin ? origin : null;
}

/** Whether `sender`'s page is on the site that speaks for `observerId` (an observer's or an adapter's id). */
export function servesObserver(sender: MessageSender, observerId: string): boolean {
  const site = siteOf(observerId);
  if (site === undefined) return false;
  const origin = senderOrigin(sender);
  return origin !== null && (SITE_ORIGINS.get(site)?.has(origin) ?? false);
}

/**
 * Null when `sender` may speak for `observerId`; otherwise the refusal (`invalid_input`), logged with the message type
 * and the observer id only. Nothing of the message is read or stored.
 */
export function wrongSite(sender: MessageSender, observerId: string, type: string): BusAck | null {
  if (servesObserver(sender, observerId)) return null;
  log.warn('observer.wrong_site', { observer: observerId, type });
  return ackRefused('invalid_input');
}
