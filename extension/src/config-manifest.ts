/**
 * What the extension's manifest holds that its build (wxt.config.ts) and its audit (scripts/audit-manifest.ts) must
 * agree on, from one place (Sprint 6 close, security review SEC-3). UPPER_SNAKE only.
 */

/**
 * The oldest Chrome Attest runs on (Decisions [0.1]): 122, the first with storage buckets, which the ledger lives in
 * (Sprint 6 close, security review SEC-1; src/ledger/place.ts). It was 120, whose Unicode (15.0) the Unicode baseline
 * reads as (Decisions [1.close]; Hard Rule 4): every later Chrome has that Unicode or a later one. Above what the side
 * panel (114), storage access levels (102) and the worker's keep-awake (110) need.
 */
export const MIN_CHROME_MAJOR = 122;

/** The item's name, which the store shows as its title (launch/store-listing.md; Decisions [7.4]). */
export const MANIFEST_NAME = 'Attest — receipts for your AI agents';

/**
 * The pages built for development and the tests, never for the store: the components page (entrypoints/dev, sprint_4
 * 4.1) and the on-device model check (entrypoints/model-check, sprint_5 5.2). `pnpm build:release` sets
 * ATTEST_RELEASE=1, and the store zip then holds none of them (wxt.config.ts `releaseEntrypoints`), which its check
 * holds it to (tests/tools/check-release-zip.ts); every other build has them, so the end-to-end tests and a person
 * checking Chrome's model can open them.
 */
export const DEV_ENTRYPOINTS: readonly string[] = ['dev', 'model-check'];
