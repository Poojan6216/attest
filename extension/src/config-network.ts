/**
 * The hosts the extension may contact (Hard Rule 1), kept apart from src/config.ts, which the Gmail and Calendar
 * readers import, so their code carries none of these hosts (Sprint 7 close, privacy review gap 15; held by
 * tests/e2e/built-bundle.spec.ts). Only the service worker and the extension's pages import this module: none whatever
 * the person chose (`NETWORK_ALLOWLIST`), the opt-in telemetry's one host (sprint_5 5.7), the model vendors a person
 * may bring their own key for (sprint_5 5.3), and `allowedHosts`, which says which of these each choice allows.
 */

/**
 * Hard Rule 1: the hosts the extension may contact whatever the person chose. Empty: nothing leaves the browser on its
 * own. The opt-in telemetry's host (TELEMETRY_HOST) and a model vendor's (BYO_VENDORS) may be contacted only while the
 * person has that turned on: `allowedHosts` says which, and the network tests hold the extension to it.
 */
export const NETWORK_ALLOWLIST: readonly string[] = [];

/**
 * The one host the opt-in telemetry posts to (sprint_5 5.7; telemetry-api/), and its one endpoint: the API the founder
 * deployed on Railway on 2026-10-13 (MANUAL.md, Sprint 5; Decisions [7.0]). Until then it was a name under `.invalid`,
 * which never resolves (RFC 6761), and `pnpm build:release` refuses a store build with such a host, or with a privacy
 * policy that does not name this one (wxt.config.ts `assertReleasable`).
 */
export const TELEMETRY_HOST = 'attest-production-5149.up.railway.app';
export const TELEMETRY_ENDPOINT = `https://${TELEMETRY_HOST}/v1/aggregate`;

/**
 * The hosts the extension may contact with `on` (Hard Rule 1): NETWORK_ALLOWLIST, the telemetry host while telemetry
 * is on, and the person's key's vendor while their own key is on. Everything off: none.
 */
export function allowedHosts(on: {
  readonly telemetry: boolean;
  readonly byo: keyof typeof BYO_VENDORS | null;
}): string[] {
  return [
    ...NETWORK_ALLOWLIST,
    ...(on.telemetry ? [TELEMETRY_HOST] : []),
    ...(on.byo === null ? [] : [BYO_VENDORS[on.byo].host]),
  ];
}

/**
 * The model vendors a person may bring their own key for (sprint_5 5.3; agents/intel_engineer.md rule 6): each one's
 * name as the pages write it, official API host, the one endpoint Attest posts to, and the model it asks. A vendor's host may be contacted only
 * while the person has their own key on with that vendor (src/intel/providers/byo.ts); it is never in
 * NETWORK_ALLOWLIST, which holds what may be contacted whatever the person chose.
 */
export const BYO_VENDORS = Object.freeze({
  anthropic: {
    label: 'Anthropic',
    host: 'api.anthropic.com',
    endpoint: 'https://api.anthropic.com/v1/messages',
    /** The API version its requests name (`anthropic-version`; tech review TECH-9). */
    apiVersion: '2023-06-01',
    model: 'claude-haiku-4-5-20251001',
  },
  openai: {
    label: 'OpenAI',
    host: 'api.openai.com',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
} as const);

export type ByoVendor = keyof typeof BYO_VENDORS;
