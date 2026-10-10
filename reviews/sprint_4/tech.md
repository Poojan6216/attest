# Sprint 4 — Tech

Role: agents/tech_reviewer.md (read-only). Range: `fc5cefe..efefaa0` (`git diff fc5cefe..efefaa0`): 272 files, +17,415 / −676. Tasks 4.0 to 4.10; every choice in Decisions [4.0] to [4.10]. The uncommitted CHANGELOG.md edit (the Sprint 4 lines under [Unreleased]) is reviewed as the current state.

**What I ran on the shared tree:** `pnpm lint` and `pnpm typecheck`, both exit 0. Lint covers ESLint on the extension and the root, Prettier (the uncommitted CHANGELOG.md included) and check-docs (OK: 7 files, 466 relative links, 30 pnpm commands, 735 Decisions.md lines).

**What I ran on `git archive` copies** in the scratchpad (`scratchpad/s4tech/`), node_modules linked from the repository:
- `wxt build` of efefaa0 (HEAD), fc5cefe (the Sprint 3 close) and ccf1014 (the commit RESULTS.md's popup numbers come from);
- per-entrypoint gzip sizes and a byte attribution from the source maps;
- a static import-graph tracer over the TypeScript sources;
- six ESLint `--stdin` probes against the real config;
- one Vitest probe file (three cases, happy-dom) over the side panel's timeline hook.

I did not run `pnpm test`, `pnpm e2e`, `pnpm bench`, `pnpm test:perf` or coverage. I wrote nothing in the repository but this file.

**Corrections to the brief.**
- The range holds 14 commits, not 13: three are bench work (`7db0c6a`, `ccf1014`, `a81e827`).
- The popup's load does not come from `views.ts → auto-check-record.ts`. That module adds 838 raw bytes and no import the popup did not already have (zod, `./db`, `./types`). The weight is Dexie, zod and the core schemas that `src/ledger/types.ts` and `src/ledger/migrations.ts` pull in (TECH-5).

## Summary

**What passes:**
- **src/core purity.** Lint enforces it. Core changed only to add `finalFrom` (contract v1.18), and lints clean. A probe linted as `src/core/units.ts` was refused an import of `../ui/format` twice (probe F).
- **The content-script fence.** A probe linted as `gmail.content.ts` was refused `src/ledger/shared` (probe E).
- **The worker's own DOM fence.** A probe linted as `src/background/flags.ts` was refused `document` (probe D).
- **One writer, in fact.** No page writes a table: no `put`, `add`, `delete`, `bulk*`, `modify` or `clear` on the ledger anywhere in `entrypoints/{popup,sidepanel,options,digest,dev}` or `src/ui`. Every change a person makes goes over one of six new page-only commands (`src/bus/page-commands.ts`). Each is a strict Zod schema, parsed by `send()` and `listen()`, and each answer is checked before it leaves (`PAGE_RESULTS`, `listen.ts:153-163`). The clock guard runs before each write (`background/user-events.ts:28`, `background/grant-save.ts:20`).
- **Indexed, paged UI reads.** Schema v8 adds `[agent+computedMs]` and `[agent+grade+computedMs]`. A page reads at most `limit + 1` rows per agent. The read-recorder test fails on a full scan. At 5,000 receipts the popup reads 204 receipt rows (RESULTS.md, `ui`).
- **Paged exports.** `export-file.ts` reads 500 keys at a time inside one read transaction. A unit test pins its bytes to `exportLedger` at page sizes 1, 2, 3 and 500.
- **Ids and data.** Alerts are keyed by receipt id and digests by week; a notification's id is its receipt's id. New instants carry the local offset. A grant's ceiling is stored in minor units of its currency.
- **Docs that did keep up.** All six new messages and the `reader_off` acknowledgement are in docs/adapters.md §3.4 and §9. `alerts` and `digests` have their sections (privacy-architecture §5.15, §5.16), and every new meta key is in §5.6, pinned by `META_KEYS`. docs/grading.md has v1.18 and "Grant changes".
- **Decisions.** Entries [4.0] to [4.10] are thorough (49 lines), including the permission choices: `scripting`, `notifications`, no `offscreen`, no `tabs`.
- **Bundles.** The popup is 115,046 B gzipped, under its 150 KB budget. The content scripts grew about 1 KB each and stay inside their budget test.

**Gaps (13): 5 MEDIUM, 8 LOW.**

- **TECH-1 (MEDIUM):** pages import service-worker modules, and no lint fence holds the sprint's layering. The options page now bundles the ledger's writers through a one-line helper.
- **TECH-2 (MEDIUM):** the side panel's reads can land out of order and overwrite newer ones. Three probes show a stale list, the wrong receipt's detail, and a fresh list replaced by an old one.
- **TECH-3 (MEDIUM):** the docs that define the product, the ledger and the bus lag the code: PRIVACY.md (also SEC-10), README, privacy-architecture, adapters and the CHANGELOG.
- **TECH-4 (MEDIUM):** the weekly digest leaves out the override reasons the sprint requires, so a mark hides a problem from it. There is no Decisions entry, and a schema comment says the opposite of the code.
- **TECH-5 (MEDIUM):** the popup's start load grew 7× with no size budget. Its gate covers the skeleton only. The day's paint was last measured at 92–112 ms, while Decisions [4.2] says 88–92 and the CHANGELOG says "under 100 ms".
- **TECH-6 (LOW):** the service worker does ledger and registration work at every start, against the checklist.
- **TECH-7 (LOW):** reads that grow with use: the side panel's re-read on every coverage ping, a stuck PENDING receipt that switches off the batch skip, and the CSV's re-reads.
- **TECH-8 (LOW):** duplicated logic and three time formats.
- **TECH-9 (LOW):** dead code and an answer code nothing sends.
- **TECH-10 (LOW):** comments and references that contradict the code.
- **TECH-11 (LOW):** error handling in the new code: raw ZodErrors, untyped errors, two silent catches (also SEC-9), one misnamed log event.
- **TECH-12 (LOW):** a batch can raise up to 100 notifications at once, and the cap has no Decisions entry.
- **TECH-13 (LOW):** three files are held at the 400-line cap by folding comments.

## Bundle size per entrypoint

**Method:**
- Each tree was built with `wxt build` in its own `git archive` copy, all on today's node_modules.
- An HTML entrypoint counts its page, every script it loads or preloads, transitively, and its stylesheet. The worker and the content scripts count their own transitive imports.
- "Start" is what loads before any `import()`; "with later imports" adds the chunks loaded on first use (the receipt detail, the bus listener).
- Gzip is zlib level 9, summed over files. Source maps are excluded.

| Entrypoint | fc5cefe raw (B) | fc5cefe gzip (B) | efefaa0 raw (B) | efefaa0 gzip (B) | Δ gzip |
|---|---|---|---|---|---|
| popup, start | 49,641 | 16,552 | 367,918 | 115,046 | +98,494 (×7.0; budget 150 KB: pass) |
| popup, with later imports | 49,641 | 16,552 | 383,823 | 121,688 | +105,136 |
| sidepanel | 256,449 | 79,227 | 427,359 | 137,217 | +57,990 |
| options | 352,101 | 109,903 | 432,284 | 137,025 | +27,122 |
| digest (new) | — | — | 372,877 | 117,738 | new |
| dev (new; left out of the store build) | — | — | 237,349 | 71,217 | new |
| background.js (worker) | 427,322 | 133,052 | 470,363 | 150,298 | +17,246 |
| content-scripts/gmail.js | 232,542 | 68,743 | 236,047 | 69,729 | +986 |
| content-scripts/gcal.js | 216,723 | 63,668 | 220,226 | 64,688 | +1,020 |

At ccf1014, where RESULTS.md measured the popup's paint, the popup's start was 359,642 B raw and 112,959 B gzipped. HEAD adds 2,087 B gzipped to it.

**What the popup's start loads,** from the source maps (raw bytes of its 338,407 bytes of JavaScript):

| Part | Bytes | Share |
|---|---|---|
| Dexie | 95,146 | 28% |
| zod | 76,369 | 23% |
| core schemas, checks, normalisers, hashing and policy | 50,631 | 15% |
| core Unicode tables (`schema-text` → `unicode-baseline`) | 49,815 | 15% |
| src/ledger (views 4,503; db 3,033; migrations 1,995; types 1,479; batch-instant 1,396; auto-check-record 838; settings 788) | 15,786 | 5% |
| src/ui | 14,531 | 4% |
| Preact | 13,351 | 4% |
| logger and its vocabulary | 7,344 | 2% |
| core reason text | 6,495 | 2% |
| the popup's own components | 3,310 | 1% |

The zod schemas are built when their module loads, so tree-shaking keeps every schema a loaded module defines. Three paths add code the popup never runs:
- `src/ledger/types.ts` defines the `policies` row, which pulls `core/policy-document`, `policy-schema` and `policy-checks` (about 5.7 KB raw);
- `src/ledger/migrations.ts` holds the v7 upgrade, which pulls `core/receipt` and `receipt-hash` (about 3.9 KB raw);
- `src/ui/data.ts` serves every page, so the popup loads the options page's `src/ledger/settings.ts`.

The options page's new weight includes the worker's own modules (TECH-1):
- `src/background/auto-check.ts` 1,370 B, `readers.ts` 1,782 B and `flags.ts` 479 B;
- `src/ledger/repo.ts` 1,553 B and `upsert.ts` 1,849 B;
- `core/batch-fixed*` 3,383 B.

## Measurements

**Probe R: do the side panel's reads land in order?** A Vitest probe in the scratch copy renders `useTimeline` (`entrypoints/sidepanel/use-timeline.ts`) over stand-in sources: `page` and `receipt` return promises the probe resolves by hand. Each case resolves a newer read before an older one:

| Case | What the person did | What the panel then holds |
|---|---|---|
| R1 | changed the agents filter to Muse while the first read was out | `filters.agents = ["muse"]`, and the list of the read before it (`old-filter`) |
| R2 | opened receipt A, then B | `openId = "B"`, and A's detail |
| R3 | scrolled to the end (load more), then the worker announced a change | after the re-read: the fresh list (`r0-new`, `r1-new`); once the older page landed: the old list plus that page (`r1-old`, `r2-old`) |

**ESLint `--stdin` probes** against the real config, each linted as an existing file of the scope:

| Probe | Linted as | Content | Result |
|---|---|---|---|
| A | `entrypoints/popup/use-popup-view.ts` | imports `putReceipt` (ledger writer) and `runGradingBatch` (worker) | allowed |
| B | `src/ledger/settings.ts` | imports `../ui/alert-text` | allowed |
| C | `src/ui/format.ts` (a module the worker bundles) | reads `document` | allowed |
| D | `src/background/flags.ts` | reads `document` | refused |
| E | `entrypoints/content/gmail.content.ts` | imports `src/ledger/shared` | refused |
| F | `src/core/units.ts` | imports `../ui/format` | refused twice |

**Hot-path reads added or changed this sprint:**

| Read | Where | Index | Bound | How often |
|---|---|---|---|---|
| Popup page | `views.ts:93-112` | `[agent+computedMs]` | agents × 51 rows | each popup open, and each announced change |
| Timeline page | `views.ts:93-112` | `[agent+computedMs]`, `[agent+grade+computedMs]` | agents (× grades) × (limit + 1); limit = rows shown on a re-read | each filter change, scroll, and change of 7 tables (TECH-7) |
| Receipt detail | `detail.ts:23-42` | keys | one receipt and its evidence | on open, and each change |
| Grading batch | `grading.ts:200-201` | none (`toArray`) | every claim and receipt | each batch while any receipt is PENDING (accepted at the Sprint 3 close; TECH-7) |
| Auto-check | `ledger/auto-check.ts:43-59` | `state` | PENDING receipts | each grace alarm, flag on |
| Alerts | `ledger/alerts.ts:96-100` | `state` | 100 | after each batch that graded, and each worker start |
| Digest | `ledger/digest.ts:128-139` | `[agent+computedMs]` | one week of receipts | weekly |
| JSON export | `export-file.ts:75-88` | primary key | 500 rows per read | on click |
| CSV export | `export-csv.ts:85-104` | `[agent+computedMs]` | agents × 501 rows per page | on click |
| Digest purge | `retention.ts:302-308` | none (`toArray`) | one row per kept week | daily |

## Checklist

| Item | Status | Evidence |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint rule) | PASS | Lint exit 0. Probe F was refused. Core's only change is `finalFrom` (`conditions-finality.ts`, `grade.ts`, `receipt.ts`, `schema*.ts`, `replay*.ts`). |
| Entrypoints are thin | PASS (LOW gap) | `background.ts` registers listeners and calls modules. It now also runs `syncReaders()` and `deliverAlerts` at every start (`:54-64`; TECH-6). The pages' hooks hold UI state only. |
| Adapters and observers pure over Document | PASS | Only `observers/base.ts` changed: `stopsForGood` stops a tab's observers on `reader_off` (`:300-312`). |
| Cross-context messages typed in src/bus and Zod-validated | PASS | Six page commands (`page-commands.ts`) are parsed at both ends; answers are checked (`listen.ts:153-173`). The alert click hands its receipt over through `chrome.storage.session`, parsed as a ULID on read (`use-open-request.ts:64`). One answer code is never sent (TECH-9). |
| Policy values from policy/default.json | PASS | The auto-check waits `graceMin / 2` (`auto-check.ts:43`). Presentation constants are in config with Decisions entries (`COVERAGE_FRESH_MINUTES` [4.1], `EXPORT_PAGE_SIZE` [4.5]). |
| No `any`, no `as unknown as`, no unexplained `!` | PASS | Lint rules on and clean; no TODO or FIXME was added. |
| No hardcoded hosts, ids or URLs; constants in config | PASS (LOW gaps) | `AUTO_CHECK_URL`, `ISSUES_URL`, `PRIVACY_DOC_URL`, `DIGEST_*` and `READERS` are in config. `ALERTS_PER_TAKE` and `DEFAULT_DAYS` are not (TECH-8, TECH-12). |
| No duplicate selector logic | PASS | No selector changed. Other duplication: TECH-8. |
| Errors typed, carry context, never swallowed | GAP | TECH-11. |
| Functions ≤ 60 lines, files ≤ 400 lines | PASS (LOW gap) | Lint SIZE_RULES. Three files sit at the cap by folding comments (TECH-13). |
| Naming | PASS (LOW gap) | Files kebab-case, components PascalCase, constants UPPER_SNAKE. `paste-labels.ts` now holds every surface's labels (TECH-8). |
| No clock, randomness or model in src/core | PASS | Lint. `finalFrom` is computed from the claim, the policy and the offset of `evaluatedAt`. |
| Ids from hashes where idempotency matters | PASS | Alerts keyed by receipt id (`db.ts:186`), digests by week (`db.ts:197`), notifications by receipt id (`background/alerts.ts:73`), the auto-check record by four fixed meta keys. |
| Timestamps ISO with offset; money in cents plus currency | PASS (LOW gap) | `isoWithLocalOffset` at `background/alerts.ts:69`, `digest.ts:143-144`, `auto-check.ts:120-121`; grant stamps through `stampEventAt`. Ceilings in minor units (`grant-form.ts`). One screen prints raw minor units (TECH-8). |
| Dexie indexes for every query; no full scans in hot paths | GAP | New paths are indexed (table above). The batch's full read, accepted at the Sprint 3 close, can now stay on for good (TECH-7). |
| Ledger reads paginated in UI; no `toArray` on unbounded tables | PASS (LOW gap) | Views and exports are paged. The side panel re-reads every row it shows on each change (TECH-7). |
| Content scripts debounce DOM observation | PASS | Unchanged. |
| Service worker does no work on `onStartup` beyond alarms | GAP | TECH-6. |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | PASS (MEDIUM gap) | Table above: 115,046 B. Nothing guards it (TECH-5). |
| New messages, tables, fields and grades documented | GAP | Messages, tables and meta keys are in. The schema version, the export example, a session key and a table count are stale (TECH-3). |
| Decisions.md entry for every unspecified choice | GAP | TECH-4 (the digest drops a stated requirement), TECH-12 (`ALERTS_PER_TAKE`). |
| CHANGELOG updated under Unreleased | GAP | The Sprint 4 lines are in the working tree, but older lines contradict them and nothing is under Changed (TECH-3). |
| Tests follow the build_spec §6 layout | PASS | New suites under `tests/unit/{background,ledger,ui,popup,sidepanel,options,digest,bus,bench}`, `tests/e2e/*.spec.ts` with `support/`, and `tests/perf/`. The committed trace (`bench/traces/popup-paint.zip`) is what 4.2 asked for. |
| Telemetry-api | N/A | Not touched. |

## Gaps

### TECH-1 (MEDIUM): pages import service-worker modules, and no lint fence holds the sprint's layering

**Rules.** Entrypoints call modules; pages read the ledger, and the service worker is its one writer (Decisions [4.0]); the worker's code has no DOM.

**What happens.**
- `entrypoints/options/components/AutoCheckToggle.tsx:3` imports `autoCheckWaitMs`, a one-line helper, from `src/background/auto-check.ts`. That module imports `getLedger` from `src/ledger/repo.ts` (`:37`). So the options page now bundles:
  - the ledger's writers: `repo.ts` and `upsert.ts`;
  - `core/batch-fixed*.ts` and the worker's `auto-check.ts`, `readers.ts` and `flags.ts`.

  This is the only path from the options page to `repo.ts`. None of these modules was in the page's import graph at fc5cefe.
- `entrypoints/options/use-settings.ts:12-13` imports `readFlags` and `readersOff` from `src/background/`. Those modules also hold the writers `onFlagSet`, `onReaderToggle` and `syncReaders`.
- The other way round, `src/background/alerts.ts:22` and `digest.ts:20` import `src/ui/alert-text.ts` and `digest-labels.ts`. They bring `receipt-labels.ts`, `paste-labels.ts` and `format.ts` into the worker. `WORKER_SCOPES` (`eslint-rules/fences.js:31-39`) does not cover them, so `document` there lints clean (probe C) and would fail only at run time in the worker.
- Probe A: a page may import `putReceipt` and `runGradingBatch`. Probe B: a ledger module may import `src/ui`. The single-writer rule holds today by convention only.
- `src/ui/data.ts:1-4` says the popup, the side panel, the options page and the digest read through it. Two do not:
  - the digest page reads `src/ledger/digest.ts` directly (`use-digests.ts:9`), whose module also exports `saveDigest`;
  - the options page's exports read `export-file.ts` and `export-csv.ts` directly (`export-ledger.ts:10-11`).

**Why it matters.** "Pages never write" is the sprint's main architecture rule. Nothing stops the next change from breaking it: a page could call a writer, or the worker could import a module that touches the DOM.

**Fix.**
1. Move `autoCheckWaitMs` out of the worker, into a module both sides may import (beside `AUTO_CHECK_URL`). Have `src/background/auto-check.ts` take `getLedger` from `src/ledger/shared.ts`.
2. Move the two `chrome.storage.local` readers (`readFlags`, `readersOff`) into a shared module. The writers stay in `src/background/`.
3. Add fences with `no-restricted-imports`:
   - `entrypoints/{popup,sidepanel,options,digest,dev}/**` and `src/ui/**` may not import `src/background/**`;
   - with `importNames`, they may not import the ledger's writers (`putReceipt`, `saveDigest`, `saveRetentionDays`, `recordAutoCheck`, `queueAlerts`, `takeAlerts`, `saveGrant`, `applyUserEvent`, …);
   - `src/ledger/**` may not import `src/ui/**`.
4. Add the `src/ui` text modules the worker imports to `WORKER_SCOPES`, or move the alert and digest wording into a worker-scoped module.
5. Route the digest's reads through `src/ui/data.ts`, or correct its header.

### TECH-2 (MEDIUM): the side panel's reads can land out of order and overwrite newer ones

**Rules.** The UI is a view of the ledger (sprint_4 header): it shows what the ledger holds, for what the person asked.

**What happens.**
- `serial()` (`use-timeline.ts:102-126`) keeps one hook instance's reads from overlapping. But `reread` is rebuilt for every filter change (`useMemo` on `[sources, filters]`, `:144-162`), and the detail's for every receipt opened (`:192-204`). The old instance's read is not cancelled, and its result is not checked against the filters or the receipt it was for. Whichever read lands last wins.
- `loadMore` (`:169-182`) appends to the list it saw when it started, `[...items, ...page.items]`. If a re-read landed in between, it replaces the fresh list with the old one plus the next page.
- The other pages differ again:
  - `useSettings` (`use-settings.ts:80-100`), `useGrantSettings` (`use-grant-settings.ts:30-50`) and `useDigests` (`use-digests.ts:39-66`) start a read per change with no ordering at all;
  - only the popup's `reader` (`use-popup-view.ts:43-75`) keeps one ordered queue.

**Evidence.** Probe R: R1 shows the previous filter's list under the Muse filter, R2 shows receipt A's detail with B open, and R3 replaces a fresh list with an older one.

**How likely.** It needs a read to finish after a later one. IndexedDB can run read transactions together, and a narrower read (one agent) can finish before the wider read it replaced. So this is rare, but nothing prevents it, and nothing corrects it until the next change.

**Fix.**
1. Give each read a generation number. Drop a result whose generation, filters or `openId` is no longer current.
2. Have `loadMore` append only when the list it extended is still the current one.
3. Use one hook for all four pages (for example `useLedgerRead(read, tables)`) with the popup's ordering.
4. Keep probe R as unit tests: out-of-order resolution must leave the newest state.

### TECH-3 (MEDIUM): the docs that define the product, the ledger and the bus lag the code

**Rule.** Every new message, table, field and choice is documented, and the docs agree with the code.

**PRIVACY.md** (also SEC-10, which lists each line):
- it still lists three permissions (`:86-90`);
- it still promises that Check Gmail for me "is described here in full before it ships" (`:27`);
- it still calls the retention choice, Delete all data and the CSV "a later version" (`:78`, `:82`);
- it never mentions alerts, digests, shares or the readers' choice.

Its own rule is that a version that stores anything new "updates this policy before it is released" (`:111`).

**README.md:9:** "Status: pre-release, Sprint 3." It names no popup, timeline, settings, alert, digest or share. It says Attest reads only tabs you have open, with no word of the one tab it may open itself.

**docs/privacy-architecture.md:**
- `:102`: "schema version 8". The ledger is v10 (`alerts` v9, `digests` v10).
- `:104`: `chrome.storage.session` "holds one flag, `attest.idleSession`". Since 4.6 it also holds `attest.openReceipt` (`config.ts:30`).
- `:381` and the example around it: `"schemaVersion": 7`, and no `alerts` or `digests` key, though the export has both (`export.ts:61-64`).

**docs/adapters.md:**
- `:585`: `ledger.changed` carries "1 to 11 ledger table names". `LedgerTable` has 13 (`messages.ts:59-73`).
- `:164`: "The popup banner that shows it arrives in Sprint 4. Until then, read it in the DevTools console". It shipped in 4.1 and 4.2.

**CHANGELOG.md** (working tree):
- `:15`: "Dexie schema v7 (fourteen tables…)". It is v10, with sixteen stores.
- `:20`: "a daily purge of facts older than 90 days". It is now the window the person chose.
- `:28`: "the screens that set one arrive in Sprint 4". They arrived.
- All eight Sprint 4 lines (`:56-63`) are under Added. Nothing under Changed records:
  - the two new permissions (`scripting`, `notifications`);
  - the readers moving from the manifest to runtime registration;
  - schema v8 to v10;
  - grading contract v1.18 (`finalFrom`).

  Sprint 3's lines named their schema and contract versions.
- `:56` says the popup "paints in under 100 ms" (TECH-5).

**Fix.**
- Update each place.
- Pin what drifts, as `changelog.spec.ts` pins the golden count:
  - privacy-architecture's schema version and export example equal `MIGRATIONS` and `LedgerExport`'s keys;
  - adapters.md's `ledger.changed` bound equals `LedgerTable.options.length`;
  - the session-key list equals `SESSION_KEYS`;
  - PRIVACY.md's permissions equal the manifest's (as `manifest-hosts.spec.ts` does for hosts).

### TECH-4 (MEDIUM): the weekly digest leaves out the override reasons the sprint requires

**Rules.** sprints/sprint_4.md:36: "Overrides (4.3) are how users correct Attest; they are also how a lazy user hides problems. The override reason is required and visible in the digest." Every unspecified or changed choice has a Decisions entry.

**What happens.**
- `agentWeek` (`src/ledger/digest.ts:49-65`) counts a marked receipt (USER_OVERRIDDEN) only as `marked`. It is not in the grade counts or in `checked` and `verified`.
- `notable` keeps FINAL receipts only (`:138`), so a marked one is never listed.
- `DigestRecord` has no field for a mark's grade or reason (`src/ledger/types.ts:153-205`). The digest page shows "N marked by you" (`AgentWeekCard.tsx:45`) and nothing more.
- So for a week whose Not found receipts were all marked Verified:
  - the share says "Nothing ended Not found, Unasked or Over scope" (`digest-share.ts:67`);
  - the notification says "Nothing to look at" (`digest-labels.ts:74`);

  though Attest's own grade was Not found. That is the hiding the sprint warns about.
- Decisions [4.7] counts "the person's marks as marked". It does not mention the requirement or why it was dropped.
- `src/ledger/types.ts:155` says the grade counts include "those the person marked, by Attest's own grade". The code does the opposite. privacy-architecture §5.16 says what the code does.

**Fix.**
1. Keep the week's marked receipts in the digest (receipt id, Attest's grade, the mark's grade, the reason) and show them on the digest page.
2. Count a marked receipt under Attest's own grade too, so a mark cannot empty the "to look at" list.
3. Keep the reason out of the share (Decisions [4.8]) and say so on the page.
4. Fix the comment at `types.ts:155`. If the requirement is dropped on purpose, write the Decisions entry.

### TECH-5 (MEDIUM): the popup's start load grew 7× with no budget, and its content paint has no gate

**Rules.** Popup < 150 KB gzipped (checklist), and paints in < 100 ms at 5,000 receipts (4.2). Never report an unmeasured number (Hard Rule 12).

**What happens.**
- The popup now reads the ledger itself, so its start loads Dexie, zod, the core schemas and the Unicode tables: 16,552 → 115,046 B gzipped (table above). That was chosen in Decisions [4.0] and [4.2], and it passes the budget.
- Nothing guards it: `built-bundle.spec.ts:153-170` budgets the content scripts only. The 7× growth needed no decision, and the next one will not either.
- It loads code it never runs: the policy schema and checks through `ledger/types.ts`, receipt hashing through `ledger/migrations.ts`, and the options page's settings reader through `ui/data.ts`. That is about 10 KB raw.
- The paint gate holds the first paint, the skeleton (Decisions [4.2]). The day's paint, what the person reads, has no gate. RESULTS.md (`popup`, measured at ccf1014) gives:
  - first paint median 60 ms (56–64);
  - the day's paint median 96 ms (92–112);
  - CPU 76 ms.

  Decisions [4.2] says "88 to 92 ms to the day's paint". The CHANGELOG (`:56`) says the popup "paints in under 100 ms".
- Eight feature commits followed ccf1014. Together they changed what the popup loads and reads: +2,087 B gzipped, and 4.9 added the auto-check record to its read transaction. RESULTS.md has not been measured since.

**Fix.**
1. Add a popup budget to `built-bundle.spec.ts` (its static closure, zlib level 9), so the next growth is a decision.
2. Split the row schemas so the popup's views load only the rows they read. Move each page's readers out of the shared `ui/data.ts`.
3. Re-run `pnpm bench` at HEAD. Make Decisions [4.2] and the CHANGELOG quote RESULTS.md, and say which paint each number is. Gate or at least record the day's paint against the 100 ms the person sees.

### TECH-6 (LOW): the service worker does ledger and registration work at every start

**Rule.** The service worker does no work on start-up beyond re-registering alarms.

**What happens.** `main()` runs at every start of the worker, not only at a browser start. The 5-minute grade alarm alone wakes a stopped worker about 288 times a day. Each start now runs:
- `syncReaders()` (`background.ts:55-57`): a `storage.local` read and `scripting.getRegisteredContentScripts`, plus a register or update when they disagree (`readers.ts:90-107`);
- `getLedger()` and `deliverAlerts` (`background.ts:60-64`): an IndexedDB open and a readwrite transaction over `alerts`, `receipts`, `claims`, `observations` and `meta` (`ledger/alerts.ts:93-116`), outside the grading queue.

Decisions [4.5] and [4.6] chose both, but neither weighs it against this rule. The registrations persist across sessions (`persistAcrossSessions: true`, `readers.ts:62`). Pending alerts come only from a batch, which already delivers after itself (`grading.ts:305-314`).

**Fix.**
- Sync the readers on `onInstalled` (install, update), `onStartup`, `reader.toggle` and `ledger.wipe`.
- Deliver pending alerts at every grace alarm, after an indexed count of `alerts.state = 'pending'`, so a skipped batch still delivers. Do it there, not in `main()`.
- Or record in Decisions why every wake must do both.

### TECH-7 (LOW): reads that grow with use

**The side panel re-reads every row it shows on each change.**
- `TIMELINE_TABLES` (`use-timeline.ts:52-60`) includes `coverage`, `observations`, `adapterHealth` and `meta`. On any of them, `reread` reads the list again with `limit = max(TIMELINE_PAGE_SIZE, rows shown)` (`:149`), plus the overview and the open detail.
- Each Gmail or Calendar pass announces `coverage` (`observer-messages.ts:349`, `:371`) and new `observations` (`:274`). So with 1,000 rows shown, each pass reads up to 4,004 receipt rows, parses 1,000 receipts and joins their claims, even when no receipt changed.

**A stuck PENDING receipt switches the batch skip off.**
- A claim-less PENDING receipt that holds reverted overrides is kept when no batch produces it any more (`batch-store.ts:9-10`, `:57`). 4.3 makes such receipts reachable: an UNASKED receipt marked, then the mark undone, and the action later explained or out of reach.
- While one exists, `nothingToGrade` (`grading.ts:250-253`) is false. Every 5-minute batch then reads and parses every claim and receipt (`:200-201`), until the purge removes that receipt.
- The Sprint 3 close accepted the full read for a batch that grades. This keeps it on for batches with nothing to grade.

**The CSV re-reads.** Each page reads each agent's next `pageSize + 1` rows and drops the ones not shown (`views.ts:155-158`). A 500-row page reads up to 2,004 rows. This is low priority.

**Fix.**
- Re-read only the overview on `coverage`, `adapterHealth` and `meta`. Re-read the list on `receipts`, `claims` and `requests`.
- Leave such held receipts out of the skip test: an index, or the `gradedAt`-style rule the batch already applies.
- Optionally, keep a cursor per agent in the CSV loop.

### TECH-8 (LOW): duplicated logic and three time formats

- **Calendar words and helpers.**
  - `MONTHS` is written three times: `format.ts:9`, `digest-labels.ts:11`, `paste-labels.ts:51`. `WEEKDAYS` twice: `digest-labels.ts:12`, `paste-labels.ts:50`.
  - The zero-pad `two()` is in `format.ts:11`, `digest-week.ts:24` and `use-timeline.ts:67`.
  - The local `YYYY-MM-DD` formatter is in `digest-week.ts:27-29` and `use-timeline.ts:65-69`.
  - `digest-labels.ts:13` redeclares `MS_PER_DAY`, which `core/units.ts:10` exports.
- **Three time formats.**
  - `clockTime`: the page's zone, 24-hour (`format.ts:14`).
  - `instantLabel`: as stored, 24-hour, with the year (`digest-labels.ts:28`).
  - `claimWhen`: as stored, 12-hour (`paste-labels.ts:60`).

  The side panel shows one pasted claim as "Thu 8 Oct, 4:33 pm" in the paste preview (`ClaimItem.tsx:15`) and as "8 Oct, 16:33" in its detail's "When it says" (`detail-labels.ts:53-56`). The digest page uses `clockTime` (`DigestView.tsx:28`) and `instantLabel` (`NotableItem.tsx:20`) on one page. The receipt share takes its time helpers from the digest's labels (`receipt-share.ts:18`).
- **Markdown.** `escapeMarkdown` lives in the digest's share (`digest-share.ts:25`), and the receipt's share imports it from there (`receipt-share.ts:19`). Its inverse is written three times: `share-png.ts:30`, `tests/unit/ui/receipt-share.spec.ts:19`, `tests/e2e/no-leak.spec.ts:154`.
- **Two domain tests.** The share's `domainOf` is loose: it accepts "1.2" and "-a.b" (`domain.ts:15`). The grant form's is strict (`grant-form.ts:40-42`). `DigestRecord.domain` checks neither (`types.ts:179`). SEC-1 covers what the loose one lets through.
- **Grades and grants.**
  - `GRADES` is written out in `digest-share.ts:15-22` and `AgentWeekCard.tsx:9-16`; `TimelineFiltersForm.tsx:15` uses `Grade.options`.
  - `GrantChoices` is defined twice: the bus schema (`page-commands.ts:50-62`) and the ledger type (`ledger/grant-save.ts:24`).
- **Page commands in five places.** `BusMessageType` (`messages.ts:75`), the bus union (`messages.ts:285-302`), `EXTENSION_PAGE_ONLY` (`listen.ts:91-100`), `PAGE_RESULTS` (`:153-163`) and `BusHandlerResult` with `SettingCommand` (`:60-75`). `send.ts:115-202` has four near-identical senders.
- **The export's two lists.** The paged export re-lists every table and its reader (`export-file.ts:106-164`) beside `exportLedger` (`export.ts:123-149`). A byte test pins them, so this is upkeep, not risk.
- **`computedMs` two ways.** The v8 upgrade uses `Date.parse` (`migrations.ts:102`); a write uses `epochMs` (`index-fields.ts:137`).
- **Names and tokens.**
  - `paste-labels.ts` now holds every surface's labels (`AGENT_NAMES`, `claimTypeLabel`, `count`, `claimWhat`) and the worker's.
  - The options page's error lines use raw palette classes, `text-red-700 dark:text-red-300`, in eight components (`AutoCheckToggle.tsx:65` among them). The popup uses the 4.1 token `text-grade-not-found-fg` (`PopupLinks.tsx:80`).
  - `DEFAULT_DAYS` (`use-timeline.ts:63`) sits outside `src/config.ts`, where its siblings `POPUP_RECEIPT_LIMIT` and `TIMELINE_PAGE_SIZE` are.
- **Money.** The detail prints the earlier spend as raw minor units with no currency ("12500"): `detail-labels.ts:127`. Every other amount goes through `formatMoney`.
- **Tests.** `seriousViolations` is written twice: `tests/e2e/ui-components.spec.ts:47` and `support/a11y.ts:39`.

**Fix.**
- One calendar-words module, `MS_PER_DAY` from `core/units`.
- One markdown module with escape and unescape, used by the shares, the image and the tests.
- One `Domain` schema, used by `domainOf`, the grant form and `DigestRecord`.
- `Grade.options` for grade lists; one `GrantChoices`; one table of page commands that the type union, `EXTENSION_PAGE_ONLY` and `PAGE_RESULTS` derive from.
- `epochMs` in the upgrade.
- Rename `paste-labels.ts` (for example `labels.ts`); use tokens for error text; move `DEFAULT_DAYS` to config; `formatMoney` for the earlier spend.
- Either one time format, or a Decisions line that names which surface writes which, and why.

### TECH-9 (LOW): dead code and an answer code nothing sends

- `loadCoverage` and `loadGrants` (`src/ui/data.ts:120-122`, `:139-142`): no page calls them, only `tests/unit/ui/data.spec.ts`.
- `export { domainOf } from './domain'` (`src/ledger/digest.ts:170`): only `tests/unit/ledger/digest.spec.ts` imports it from there.
- `GrantSaveResult` offers `invalid_input` (`page-commands.ts:74-78`), and docs/adapters.md §9 lists it. `onGrantSave` (`background/grant-save.ts:18-31`) answers `{ ok: true }` or throws, which `listen()` turns into `failed`. Nothing sends `invalid_input`, and the options page has no branch for it.

**Fix.** Delete the two loaders and the re-export, or use them. Drop `invalid_input` from the schema and the docs, or have the handler answer it.

### TECH-10 (LOW): comments and references that contradict the code

- `page-commands.ts:120`: "(src/background/wipe.ts)". There is no such file; the wipe is `onLedgerWipe` in `src/background/settings.ts`.
- Decisions.md:1454 ([4.2]): "the last-import keys (src/ledger/import-keys.ts)". There is no such file; it is `src/ledger/agent-keys.ts`.
- `src/ledger/types.ts:155`: says the grade counts take in the receipts the person marked, by Attest's own grade. They do not (TECH-4).
- `src/ui/data.ts:1-4`: says the four pages read through it. Two do not (TECH-1).
- `src/ledger/export.ts:12-14`: "the two maps the replay input holds". There are three (`:66-74` says so).
- Header lines edited without re-wrapping, one at 163 characters and one broken mid-sentence (Prettier leaves comments alone):
  - `views.ts:7`;
  - `page-commands.ts:4-6`;
  - `background/grant-save.ts:6-7`;
  - `send.ts:183`;
  - `listen.ts:25`;
  - `Today.tsx:19`;
  - `core/receipt.ts:11`.

**Fix.** Correct each.

### TECH-11 (LOW): error handling in the new code

**Rule.** Errors are typed, carry context, and are never swallowed (Hard Rule 6). Parse at every boundary.

- **Raw ZodErrors from the new ledger writers.**
  - `saveRetentionDays` (`settings.ts:33`);
  - `recordAutoCheck` (`auto-check-record.ts:70-73`);
  - `queueAlerts` (`alerts.ts:42`), inside the grading batch's transaction;
  - `buildDigest` and `saveDigest` (`digest.ts:141`, `:157`).

  Sprint 3's TECH-7 moved `activity.ts` to `LedgerError('invalid_input')` for exactly this (`activity.ts:42-44`).
- **Two rows written without their schema.** `takeAlerts` writes `{ ...alert, state, handledAt }` (`alerts.ts:107`). The clock repair `bulkPut`s re-stamped grants (`clock-guard.ts:176`). Both are built from parsed rows, but neither is parsed at the write.
- **Untyped errors.** `share-png.ts:90`, `:96` and `:113` reject with a bare `Error('no canvas')` or `Error('no image')`.
- **Two silent catches** (also SEC-9):
  - `auto-check.ts:73-75`: a failing `getLastFocused` reads as "no window" and is logged as `autocheck.no_window`;
  - `alerts.ts:126`: the side panel's refusal is dropped before the tab fallback.
- **A misnamed event.** A failed digest notification is logged as `alerts.show_failed` (`background/digest.ts:65-67`), the receipt alerts' event. The log cannot tell the two apart.

**Fix.**
- `safeParse` and `LedgerError('invalid_input', …, { paths })` in the writers, with a test each.
- Parse the two writes.
- A typed share-image error.
- Log both catches.
- A `digest.notify_failed` event.

### TECH-12 (LOW): a batch can raise up to 100 notifications at once, and the cap has no Decisions entry

**What happens.**
- `ALERTS_PER_TAKE = 100` (`ledger/alerts.ts:31`) is set in the module. It is not in `src/config.ts`, and Decisions [4.6] does not mention it.
- One batch can make many receipts FINAL at once. A pasted log whose claims are past their grace is graded FINAL in its first batch, and each Not found gets an alert.
- `deliverAlerts` then asks Chrome for up to 100 notifications in a row (`background/alerts.ts:70-83`).
- A batch delivers only when it graded (`grading.ts:308`), so the next 100 wait for the worker's next start (`background.ts:59-64`).

**Fix.**
- Record the cap and the rule for a burst in Decisions, and move the cap to config.
- Above a small number per take, show one notification ("12 receipts need a look") that opens the timeline on them, and settle the rest as shown.
- Deliver after a skipped batch too (TECH-6).

### TECH-13 (LOW): three files are held at the 400-line cap by folding comments

- `src/core/schema.ts` is at 400 again. Sprint 3's review said the next change to it must split it. This sprint added `finalFrom` by deleting a blank comment line and putting the field's comment at the end of its line (`:319`). The invariant comment grew to 129 characters (`:293`).
- `tests/golden/scenario-schema.ts` is at 400 by re-flowing its header.
- `src/observers/base.ts` is at 398 (it was 395).
- Close behind: `tests/e2e/no-leak.spec.ts` 394, `src/core/replay.ts` 394, `src/log-vocabulary.ts` 388.

**Fix.**
- Move the Receipt schemas from `core/schema.ts` into `schema-receipt.ts`, which already holds their checks.
- Split the golden scenario schema, and split `observers/base.ts` before its next change.
- Or record in Decisions why not.
