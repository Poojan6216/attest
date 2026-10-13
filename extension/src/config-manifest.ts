/**
 * What the extension's manifest holds that its build (wxt.config.ts) and its audit (scripts/audit-manifest.ts) must
 * agree on, from one place (Sprint 6 close, security review SEC-3). UPPER_SNAKE only.
 */

/**
 * The oldest Chrome Attest runs on (Decisions [0.1]): the Unicode baseline assumes Chrome 120's (Decisions [1.close];
 * Hard Rule 4), above what the side panel (114), storage access levels (102) and the worker's keep-awake (110) need.
 */
export const MIN_CHROME_MAJOR = 120;
