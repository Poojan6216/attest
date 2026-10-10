# Sprint 4 — Close

Role: agents/sprint_closer.md. Inputs: `qa.md` (25 gaps, 11 of them written and closed by the QA review itself), `security.md` (10 gaps and a checklist note) and `tech.md` (13 gaps) in this folder. Range closed: `265c9fe` (the reviews) to HEAD, in seven commits: `bff489e`, `dc28dd5`, `f470859`, `25a2d8f`, `d71d49e` (a launcher fix the bench found, below), `7bf39e1` (RESULTS.md) and the closing commit. Every gap is fixed in code, written and verified by the QA review, or accepted below with its bound and its Decisions entry. Two items are the founder's to decide and are listed under MANUAL. Nothing was fixed by weakening a test, a Hard Rule, a lint rule, a threshold, a gate or an allowlist; every `[4.close]` entry in Decisions.md records a decision the close made.

## FIXED IN CODE

Severity order. A gap two reviews raised is fixed once and listed once.

### HIGH

1. **SEC-1 / QA-1: a name written with a dot was shared as a domain, and an address inside a hint was shared as it was.**
   - **Changed:** a counterparty gives a domain only from an address (`addressDomain`: what follows the `@`, and only when it is a domain); a merchant only when written as a domain (`merchantDomain`); a hint keeps its words with each address written as its domain and any other `@` word left out (`withoutAddresses`); a digest's notable receipt stores a `Domain`, the shape the grant form checks.
   - **Code:** `extension/src/ledger/domain.ts`, `digest.ts`; `extension/src/ui/receipt-share.ts`, `digest-share.ts`, `grant-form.ts`.
   - **Tests:** `extension/tests/unit/ledger/domain.spec.ts`; `tests/unit/ui/share-redaction.spec.ts` ("A.Kumar" and "Mr.Smith" give no domain; an address in a hint is its domain); the golden share test judges with a fixed rule (`expectedDomain`), never with the function it tests; the mandatory `no-leak.spec.ts` reads every receipt's share and a pasted name written with a dot, and finds no `@` and no name.

### MEDIUM

2. **SEC-2: Check Gmail for me opened Gmail "in front of you" without checking anyone was there.**
   - **Changed:** it opens only into the focused, non-minimised normal window the person last used, and, while away detection holds the `idle` permission, not while Chrome reports them idle or locked.
   - **Code:** `extension/src/background/auto-check.ts` (`visibleWindowOf`, `checkOnce`).
   - **Tests:** `tests/unit/background/auto-check.spec.ts` (the window table; idle and locked wait; the permission absent asks nothing).
3. **SEC-3: the consent flags and the readers' choice lived in `chrome.storage.local`, which content scripts can write.**
   - **Changed:** both live in ledger meta (`readerOff.<reader>`, `flag.<flag>`); only settable flags are read; an unreadable choice reads as the one that reads and opens less; an older profile's keys move once at install or update.
   - **Code:** `extension/src/ledger/consent.ts`, `extension/src/background/consent-move.ts`, `install.ts`, `readers.ts`, `flags.ts`; `extension/entrypoints/options/use-settings.ts`.
   - **Tests:** `tests/unit/ledger/consent.spec.ts`, `tests/unit/background/install.spec.ts`, `readers.spec.ts`, `flags.spec.ts`; `tests/e2e/options-settings.spec.ts` reads the choice from IndexedDB, and finds no `attest.readersOff` in storage.
4. **SEC-4: the digest notice said "Nothing to look at" for a week Attest could not check.**
   - **Changed:** the notice names what the week holds: claims that could not be checked, days a source was not checked, readers to repair, marks. The phrase is banned by the copy test.
   - **Code:** `extension/src/ui/digest-labels.ts` (`digestReadyText`). **Tests:** `tests/unit/ui/digest-labels.spec.ts`; `tests/unit/copy.spec.ts` (BANNED).
5. **QA-2: no end-to-end test showed the degraded banner on the popup or the side panel.**
   - **Changed:** `tests/e2e/degraded-banner.spec.ts`: a Sent list whose time cells are gone turns the reader DEGRADED (`selector.missing.time`); both pages show "Degraded: Gmail Sent reader <version>"; the report link holds exactly the reader, its version and the Chrome major; a clean pass takes the banner away from both while they are open. The broken list moved to the shared support (`brokenSentList`).
6. **QA-4: an amount behind a bare `$` was dropped from the detail, the row and both shares.**
   - **Changed:** every surface writes an amount through `formatAmount`, which says "(currency not stated)" when there is none.
   - **Code:** `extension/src/ui/format.ts` and its callers. **Tests:** `tests/unit/ui/format.spec.ts` and the share and detail specs.
7. **TECH-2 / QA-5: the side panel's reads could land out of order and overwrite newer ones.**
   - **Changed:** one ordered reader (`src/ui/serial.ts`, `use-ledger-read.ts`) for the options and digest pages; the side panel's list, detail and overview each guard their generation.
   - **Tests:** `tests/unit/sidepanel/timeline-order.spec.ts` (QA's red test, now green, and the detail, page and overview cases; a mutation run confirmed it fails without the guard); `tests/unit/ui/use-ledger-read.spec.ts`.
8. **TECH-4 / QA-6: the weekly digest held no mark's reason.**
   - **Changed:** a digest keeps each mark with its reason (`DigestMark`, `marksCount`), counts a marked receipt under Attest's own grade, and shows the reasons on the page; no share holds one.
   - **Code:** `extension/src/ledger/digest.ts`, `types.ts`; `extension/entrypoints/digest/components/MarksSection.tsx`, `MarkItem.tsx`. **Tests:** `tests/unit/ledger/digest.spec.ts`, `tests/unit/digest/digest-page.spec.ts`, `tests/unit/ui/digest-share.spec.ts`.
9. **QA-7: the mandatory network-intercept session opened none of Sprint 4's surfaces.**
   - **Changed:** the session runs Check Gmail for me (with the Sent fixture routed at `AUTO_CHECK_URL`), the §2 demo's alert, a receipt's share and image, the weekly digest with its page and share, a grant, both exports, a reader turned off and on, and Delete all data, then its five minutes of reloads. The analysis compares a NetLog request with the routed addresses without its fragment, which never leaves the browser; only the exact routed addresses are exempt.
   - **Code:** `extension/tests/e2e/network-intercept.spec.ts`, `support/sprint4-surfaces.ts`, `support/auto-check.ts`, `support/network-guard.ts`. **Tests:** `tests/unit/harness/netlog.spec.ts` (a routed address with its fragment is known; `/u/1/` and a changed query are still caught). Result: 0 attributed requests, no violation, no unknown host; the negative control caught 4 of 4.
10. **TECH-1: pages imported service-worker modules, and no lint fence held the sprint's layering.**
    - **Changed:** lint fences: a page imports no worker module, no writer module and no writer from a mixed module; the ledger imports neither the worker nor the UI; the five worker-bundled `src/ui` text modules have no DOM.
    - **Code:** `extension/eslint-rules/fences.js`, `extension/eslint.config.js`. **Tests:** `tests/unit/lint/fences-pages.spec.ts`.
11. **TECH-3 / SEC-10: the docs lagged the code; PRIVACY.md was unchanged since Sprint 3.**
    - **Changed:** `PRIVACY.md` v0.4 (the two new permissions, Check Gmail for me, alerts, the digest, shares, the readers' choice, retention, Delete all data, the CSV); README status; `docs/privacy-architecture.md` schema v10 and its export example; `docs/adapters.md` (the banner shipped; `ledger.changed` carries 1 to 13 tables); CHANGELOG (stale lines fixed, a Changed section for Sprint 4, the paint line quoting RESULTS.md).
    - **Tests:** `tests/unit/docs/doc-pins.spec.ts` pins PRIVACY.md's permissions to the manifest's, the architecture doc's schema version and export example to the code, its session keys to `SESSION_KEYS`, and adapters.md's bound to `LedgerTable`; each also fails on a changed copy.
12. **TECH-5: the popup's start load grew 7× with no budget.**
    - **Changed:** a budget of 125,000 B gzipped on the popup's start load (113,062 B at the close; the checklist's ceiling is 150 KB). The `policies` row schema and the options readers left its path (`src/ledger/policy-record.ts`, `src/ui/settings-data.ts`). CHANGELOG and Decisions quote RESULTS.md for the paint, naming which paint.
    - **Tests:** `tests/e2e/built-bundle.spec.ts` ("the popup's start load is within its budget").
13. **QA-3: the perf gates and the bench had to run again on a quiet machine.**
    - **Done:** both ran at the close on a quiet machine (no stray test process), on a clean tree. The bench's first run, at `25a2d8f`, stopped at its popup step: a batch-1 change to the end-to-end launcher's readers wait (`tests/e2e/support/extension.ts` `waitForReaders`) put a named function inside a callback the service worker evaluates, and `pnpm bench` runs the launcher under tsx, which wraps a named function in a helper the worker does not have. The check is now inline (`d71d49e`, checked under tsx), and the bench re-ran green. See "Verification" for every number.

### LOW

14. **SEC-5: the dead proxy covered the vendor sessions only.** Every end-to-end launch now runs behind it unless a test opts out (`tests/e2e/support/extension.ts`, `allowNetwork`); a launch naming another proxy throws.
15. **SEC-6: Delete all data left alerts on screen and turned back on a reader the person had turned off.** The wipe clears `chrome.storage.session` and Attest's notifications and keeps each reader that is off (`src/background/settings.ts`). Tests: `tests/unit/background/settings.spec.ts`, `tests/e2e/options-settings.spec.ts`.
16. **SEC-7: a digest outlived the receipts it copies, and an unparseable digest was never purged.** Digests go once their week started before the cutoff, by key, without reading the row (`src/ledger/retention.ts` `purgeDigests`). Test: `tests/unit/ledger/retention.spec.ts` ("SEC-7").
17. **SEC-8: nothing stopped a future `executeScript`.** `tests/unit/lint/extension-reach.spec.ts` reads every shipped file's syntax: `scripting` for the readers' registrations alone, three reviewed tab creators, nothing injected, no tab changed; the built-bundle scan bans `executeScript`, `insertCSS` and `tabs.update`.
18. **SEC-9: two catches dropped the error.** Both log (`autocheck.window_failed`, `alerts.side_panel_failed`); a failed digest notice logs `digest.notify_failed`.
19. **QA-8: `queueAlerts` given one receipt twice threw.** It queues one alert per receipt (`src/ledger/alerts.ts`). Test: `tests/unit/ledger/alerts.spec.ts`.
20. **QA-9: the receipt's share was not a channel of the secret-seed test.** `no-leak.spec.ts` reads every receipt's share (at least 8) and the digest's.
21. **QA-10: the auto-check end-to-end test waited a fixed 3 seconds.** It clears the purge alarm and waits for the upkeep to set it again; it also records input on the opened tab and finds none.
22. **QA-11: no end-to-end test of the PENDING row.** The auto-check test checks "Checking — final from" within the grace and "Checking — waiting for a check after" past it.
23. **QA-12 / TECH-6: a lost digest alarm came back only at a browser start, and the worker did ledger work at every start.** Each grace alarm's upkeep delivers pending alerts, restores a lost alarm and syncs the readers; a worker start does nothing (`src/background/alarms.ts` `graceUpkeep`). Tests: `tests/unit/background/grace-upkeep.spec.ts`, `background-entry.spec.ts`.
24. **QA-13: tests for the SEC-6 and SEC-7 fixes.** Items 15 and 16.
25. **QA-14: no CI gate held the UI to 70%.** `pnpm test:coverage:ui` (`extension/vitest.ui.config.ts`), run by CI, fails below 70%; 95.91% at the close, the digest page's entry, live reads and read failure now tested (`tests/unit/digest/digest-app.spec.ts`, `tests/unit/options/options-ui.spec.ts`).
26. **TECH-7: reads that grew with use.** The side panel re-reads its list only on `receipts`, `claims`, `requests`, and the overview alone on the rest; the batch skip leaves out held PENDING receipts (meta `heldPending`). The CSV's per-agent read is accepted below.
27. **TECH-8: duplicated logic.** One module each for the calendar words, the markdown escape and its inverse, `GrantChoices`, the page commands (one table and one sender, `bus.command_refused` / `bus.command_unavailable`), grade lists (`Grade.options`), the error-text colour (`text-error-fg`), the instant parse shared by the v8 upgrade, `seriousViolations`; `labels.ts` renamed; `TIMELINE_DEFAULT_DAYS` in config. The three time formats are decided in Decisions.
28. **TECH-9: dead code and an answer code nothing sends.** The two page loaders went; `GrantSaveResult` answers `failed` only; docs/adapters.md says so.
29. **TECH-10: comments and references that contradicted the code.** Each corrected (the wipe's module, Decisions [4.2]'s file name, the export's three maps, the unwrapped headers).
30. **TECH-11: raw ZodErrors from the new writers, two unparsed writes, untyped share errors.** `parseWrite` gives every Sprint 4 writer `LedgerError('invalid_input')` with the table and paths; the alert settle and the clock repair's grants are parsed; `ShareImageError`. Tests: `tests/unit/ledger/write-refusals.spec.ts` (7 writers), `tests/unit/ui/share-png.spec.ts`.
31. **TECH-12: a batch could raise up to 100 notifications at once.** More than 3 at once show as one notice; the cap is in config and Decisions.
32. **TECH-13: three files held at the 400-line cap.** `core/schema.ts` split (its closed sets in `schema-enums.ts`; 388 lines with `GrantChoices` added). The other two are accepted below.
33. **Security checklist note: the committed bench trace recorded this machine's paths.** The bench writes them as placeholders and fails if the home folder is still named (`bench/trace-scrub.ts`; `tests/unit/bench/trace-scrub.spec.ts`); the committed trace was scrubbed. Its history is listed under MANUAL.

## VERIFIED CLEAN

**VERIFIED CLEAN.** Every gap of the three reviews is fixed in code and tested, written and verified by the QA review, or accepted above with its bound; the two MANUAL items below are decisions about the future (a new gate, the repository's history), not defects in what Sprint 4 built. The full gate ran last, on the committed tree (Verification, Gate).

Written by the QA review, in the tree, and green at the close (gaps 15 to 25 of `qa.md`):

- GAP 15: the four setting commands refused from a content script, held by `EXTENSION_PAGE_ONLY` (now derived from the command table).
- GAP 16: the multi-zone digest test Decisions [4.7] describes.
- GAP 17: an alert pending across a stopped worker.
- GAP 18: Check Gmail for me across a stopped worker.
- GAP 19: repeats, absences and two page reads of the new ledger methods (`sprint4-repeat-writes.spec.ts`).
- GAP 20: the schema v10 migration test.
- GAP 21: the CSV's formula guard end to end.
- GAP 22: unicode and markdown in shares (`share-escaping.spec.ts`, now through `src/ui/markdown.ts`).
- GAP 23: the share's image drawn in a unit test.
- GAP 24: the receipt pages as properties.
- GAP 25: the settings at their edges.

## ACCEPTED

- **TECH-7, the CSV's per-agent read.** A page of N rows reads at most (N + 1) × 4 rows: 2,004 for 500. A bound that does not grow with use (Decisions `[4.close]`).
- **TECH-8, the export's two table lists.** A byte test pins one to the other, so a drift fails.
- **TECH-13, `tests/golden/scenario-schema.ts` and `src/observers/base.ts`.** The first stays one file because `pnpm check-docs` reads the golden format's keys from it as one file; the second is split before its next change (the close changes nothing in it).
- **TECH-5, the v7 upgrade in the popup's path (about 3.9 KB raw).** Any page may be the first to open a ledger after an update, so every page must be able to run every upgrade, and an upgrade cannot wait for a module to load inside IndexedDB's upgrade transaction.

## MANUAL

Only the founder can decide these; each is also in `MANUAL.md`.

1. **Whether to gate the day's paint at 100 ms.** The gate holds the popup's first paint (Decisions [4.2]); the day's paint, the list a person reads, is measured and recorded but not gated. At the close it reads a median of 92.0 ms in the perf gate (84 to 108) and 96 ms in RESULTS.md (88 to 104). Adding a gate is a gate change.
2. **The old bench trace in git history.** Commits before `25a2d8f` hold `bench/traces/popup-paint.zip` with this machine's paths, the home folder among them. The repository is private. Removing them needs a history rewrite.

## Test expectations changed with the behaviour they describe

- The digest notice's wording (SEC-4) and the marked counts (TECH-4).
- Amounts: the detail's earlier spend is "$12.00", and an amount with no currency says so (QA-4).
- The share-escaping property builds hints with `withoutAddresses` and domains with `fc.domain()` (SEC-1).
- After Delete all data, `readerOff.gmail` is kept (SEC-6); the install test logs `consent.move_failed` for a failed move (SEC-3); the worker entry test syncs readers at a browser start, never at a worker start (TECH-6).
- The log vocabulary: `flags.invalid` and `readers.choice_invalid` gone; `autocheck.window_failed`, `alerts.side_panel_failed`, `digest.notify_failed`, `ledger.wipe_choice_unread`, `ledger.wipe_notifications_failed`, `consent.moved`, `consent.move_failed`, `bus.command_refused` and `bus.command_unavailable` added; the eight per-command send events replaced by the last two, each carrying the command's type (TECH-8).
- The strict-schema walker counts 21 object schemas plus one per reason code: `GrantChoices` joined core (TECH-8).
- `tests/unit/ui/data.spec.ts` reads the grants through `loadGrantSettings` (TECH-9).

## Verification

At HEAD, on a quiet machine (no stray test process):

- `pnpm lint` (ESLint, Prettier, `check-docs`) and `pnpm typecheck`: pass.
- `vitest run`: 468 files, 10,672 tests passed, 7 skipped (the same 7 as before the close).
- `pnpm e2e`: 73 passed, the five `@mandatory` tests among them.
- `pnpm test:perf`: all 9 gates pass. Popup at 5,000 receipts: first paint median 60.0 ms (gate 100), the day's paint 92.0 ms, 75.7 ms CPU; `gradeBatch` 5,000 claims 1,506 ms CPU (gate 2,000); candidate lookup 475 ms (gate 2,000); steady-state batch 570 ms; idle batch 1.2 ms; UI reads 17.4, 11.5, 17.6 and 0.8 ms (gate 50); `coverageForBatch` 2,150 rows (gate 3,000).
- `pnpm bench` at `d71d49e` (RESULTS.md, Chrome 153), every gate passed: popup first paint median 64 ms (52 to 72; gate 100), the day's paint 96 ms (88 to 104; recorded), 74.2 ms CPU; candidate lookup 414.2 ms and batch grading 1,351.4 ms CPU (gate 2,000); UI reads 17.1, 14.6, 14.7 and 1.3 ms CPU (gate 50); the Gmail Sent, receipt, Calendar, pattern and paste accuracy gates. The committed trace names no machine path.
- Coverage, lines: `src/core` 99.4% (gate 95, `pnpm test:coverage`); observers and adapters 99.03% (gate 85, `pnpm test:coverage:observers`); UI 95.91% (gate 70, `pnpm test:coverage:ui`).

## Gate

| Gate item | At the close |
|---|---|
| Popup < 100 ms at 5,000 receipts | Met: first paint median 64 ms in RESULTS.md (60.0 ms in `pnpm test:perf`), the gated paint (Decisions [4.2]). |
| Coverage header and degraded banner proven by E2E | Met: `popup.spec.ts` (the header, the §2 demo with Calendar never opened) and `degraded-banner.spec.ts` (the popup and the side panel). |
| Side panel detail shows every evidence field | Met: `sidepanel.spec.ts`. |
| Grants save, validate, and re-grade only PENDING | Met: `grants.spec.ts`, and the unit tests of the grant save. |
| Export + wipe verified | Met: `options-export.spec.ts`, `options-settings.spec.ts` (the wipe leaves nothing but a reader kept off). |
| Alerts exactly as specified | Met: `alerts.spec.ts` (two for the §2 demo, none after a restart, none when muted). |
| Weekly digest renders and shares redacted | Met: `digest.spec.ts`; `no-leak.spec.ts` searches its share. |
| axe zero serious | Met: `a11y.spec.ts` (four surfaces, light and dark), `ui-components.spec.ts`, `popup.spec.ts` at 5,000 receipts. |
| Both mandatory tests green including share output | Met: `network-intercept.spec.ts` (every Sprint 4 surface run, 0 requests) and `no-leak.spec.ts` (every receipt's share and the digest's). |
| `closed.md` says VERIFIED CLEAN | Met (above). |

