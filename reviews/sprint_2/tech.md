# Sprint 2 — Tech

Role: agents/tech_reviewer.md. Range reviewed: `60bca2d..1e54fd9` (Sprint 1 close to the last Sprint 2 commit). Each review was checked by an independent refuting verifier that re-ran the evidence; verdicts are inline (CONFIRMED, RESIZED with the new severity, or REFUTED). Real-page captures and the live smoke (tasks 2.1, 2.4, 2.8) are BLOCKED(MANUAL) and are not gaps.

## Tech review

Sprint 2 tech review (60bca2d..1e54fd9, read-only). No CRITICAL or HIGH gap. Lint is clean on all 184 shipped files (size limits, no any, no `as unknown as`, no `!`, act/network/ledger fences). Every bus message and stored type is Zod-checked at both ends, onStartup only recreates a missing alarm, content scripts batch DOM changes, and the popup is 15.3 KB gzipped. The built content scripts and worker contain no network calls. I filed 17 gaps: 9 MEDIUM and 8 LOW. The MEDIUM ones: (1) coverage-store reads grow with every future-dated Calendar first-look marker: 200 markers mean 200 rows read on every Calendar ping and 380–580 per coverageFor, and no perf gate covers it. (2) A pass re-reads the page 4–8 times (409–585 getComputedStyle calls per Calendar pass on the synthetic fixtures), the MutationObserver watches every attribute (a pass up to every 2 s), and the worker runs N+5 readwrite transactions per Gmail pass and rewrites the whole Calendar snapshot on every pass. (3) The logger prints PolicyError, GcalError, ReceiptError, ObserverError and CalendarRowRefused as a bare `Error` with no code. (4) Fixture labels say gcal.event@1.1.0 while the selectors are 1.2.0, and the gmail.sent labels carry no version; nothing checks either. (5) Two copies of shown.ts and three account readers with different rules. (6) Calendar event equality is written twice (diff and calendar-seen). (7) The worker and ledger import Calendar observer code, so the worker parses the Calendar selectors at start-up. (8) The Gmail Sent boundary-minute defect is still open 'for the sprint close'. (9) CHANGELOG still says 'no host permissions'. Live smoke must measure pass cost and frequency on real Gmail and Calendar.

# Sprint 2 — Tech

Role: agents/tech_reviewer.md (read-only). Range: `git diff 60bca2d..1e54fd9`: 15 commits, 342 files. I edited nothing in the shared tree. Scratch work is in `scratchpad/s2rev/tech/`. It holds:
- a `git archive HEAD` copy built with `wxt build`;
- ESLint `--stdin` probes against the real config;
- tsx probes over the synthetic fixtures (happy-dom) and over the ledger (fake-indexeddb).

The one background probe I started was stopped. Nothing is left running.

## Summary

The Sprint 2 code is well factored and heavily documented. What passes:
- `npx eslint src entrypoints` is clean on all 184 shipped files. That covers size limits, `any`, `as unknown as`, `!`, and the act, network and ledger fences.
- Every bus message and stored type is a Zod schema, parsed at both ends: `calendar.snapshot`, `BusAck`, `coverageIntervals` and `calendarSnapshots`.
- On `onStartup` the worker only recreates a missing alarm.
- Content scripts batch DOM changes: 500 ms debounce, 2 s cap.
- The popup is 15.3 KB gzipped.
- The two host permissions come from one constant.
- No CRITICAL or HIGH gap on Hard Rules 1–4 or 10. The built content scripts and worker contain no `fetch(`, XHR, WebSocket or `sendBeacon`. The one `postMessage` is WXT's handshake, and it is switched off by `noScriptStartedPostMessage`. The one `Function(` is zod's jitless probe. The logger never prints an error message.

The gaps are about cost, duplication and drift.

**MEDIUM (9)**
- TECH-1: coverage-store reads grow with every future-dated Calendar marker and window.
- TECH-2: a pass re-reads the page 4–8 times and can run every 2 s; the worker runs N+5 readwrite transactions per Gmail pass and rewrites the whole Calendar snapshot on every pass.
- TECH-3: the logger prints every Sprint 2 error class as a bare `Error` with no code.
- TECH-4: fixture labels carry stale or missing selector versions, and nothing checks them.
- TECH-5: two copies of `shown.ts` and three account readers with different rules.
- TECH-6: Calendar event equality is written twice.
- TECH-7: the worker and ledger import the Calendar observer, so the worker parses Calendar selectors at start-up.
- TECH-8: the Gmail Sent boundary-minute defect is still open "for the sprint close".
- TECH-9: the CHANGELOG says "no host permissions".

**LOW (8)**
- TECH-10: fence edges.
- TECH-11: docs on the Calendar read cadence.
- TECH-12: logic in the Calendar entrypoint.
- TECH-13: vestigial code, and a bench that measures the pure diff.
- TECH-14: small duplicates.
- TECH-15: test layout.
- TECH-16: Decisions closure.
- TECH-17: content-script weight.

**What live smoke (2.8, BLOCKED(MANUAL)) must measure, because the synthetic fixtures cannot:**
- ms per pass and passes per minute on real Gmail Sent and Calendar, including while the mouse moves over the page (TECH-2);
- script evaluation time in Chrome (TECH-17);
- how many first-look markers a real calendar accumulates (TECH-1).

## Bundle size per entrypoint

Measured from a `wxt build` of HEAD. Each HTML entrypoint counts its page plus every script and stylesheet it loads. Gzip is zlib level 9. Source maps are excluded.

| Entrypoint | Raw (B) | Gzip (B) | Notes |
|---|---|---|---|
| popup | 44,093 | 15,341 | under the 150 KB budget |
| sidepanel | 44,009 | 15,282 | |
| options | 137,210 | 42,262 | includes the install-id chunk |
| background.js (worker) | 231,151 | 71,807 | dexie 94.9 KB (41%), Unicode tables 49.8 KB, Calendar selectors/snapshot/diff 4.8 KB (TECH-7) |
| content-scripts/gmail.js | 235,834 | 69,982 | zod 90.5 KB (38.4%), Unicode tables 49.8 KB (21.1%), observers/gmail 22.8 KB |
| content-scripts/gcal.js | 221,193 | 65,304 | zod 90.5 KB (40.9%), Unicode tables 49.8 KB (22.5%), observers/gcal 16.9 KB |

The byte attribution comes from the source maps (scratch `attrib.cjs`).

## Measurements

**Per-pass DOM work.** Synthetic fixtures, happy-dom, median of 30 passes, through `planPass` and the production observers. The Calendar observer is wrapped by `calendarScript`, as in production.

| Observer, fixture | ms/pass | getComputedStyle per pass | Repeated full reads per pass |
|---|---|---|---|
| gmail.sent, synthetic-sent-page-1 (10 rows) | 12.5 | 92 | readSentPage ×4 |
| gmail.receipt, synthetic-receipt-shopify | 2.6 | 0 | readPage ×4; classify ×3 per message |
| gcal.event, synthetic-gcal-week-before | 23.8 | 409 | readCalendar ×4, pageBusy ×4 (`[role=main]` queried 8×, `querySelectorAll('*')` 32×) |
| gcal.event, synthetic-gcal-month-november | 38.4 | 585 | same |

**Coverage-store rows read.** fake-indexeddb, counted with a Dexie `reading` hook.

| Future markers | Past markers | recordCoverage (gcal week) | recordCoverage (gmail.sent) | coverageFor (calendar.created, 1 h at +10 d) |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 2 |
| 50 | 0 | 50 | 0 | 97 |
| 200 | 0 | 200 | 0 | 380 |
| 200 | 200 | 200 | 0 | 580 |

The same calls timed under fake-indexeddb (not a Chrome number; the growth is the point). Each cell is recordCoverage / coverageFor:
- 0 markers: 2.3 ms / 4.9 ms
- 500 markers: 1,299 ms / 2,315 ms
- 2,000 markers: 17,045 ms / 27,642 ms

## Checklist

| Item | Status | Evidence |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint) | PASS | The core block (CORE_RESTRICTED_IMPORTS, core-globals, core-determinism) applies. `npx eslint src entrypoints` gives 0 errors and 0 warnings over 184 files, Sprint 2's core edits included (batch-orphans, conditions-level, features). |
| Content scripts and observers cannot reach the ledger (lint) | PASS | The stdin probes were refused (no-restricted-imports, fences.js:94): `../../ledger/repo` from src/observers/gcal; `../ledger/repo` from src/observers/text.ts; `src/ledger/repo` and `src/background/observer-messages` from entrypoints/content. Fence edges: TECH-10. |
| Entrypoints are thin | GAP | background.ts and gmail.content.ts are wiring only. gcal.content.ts:39-57 holds calendarScript (TECH-12). |
| Observers are pure over the DOM: no storage or bus in extract() | PASS (LOW gap) | Extractor scope refuses `src/bus`, the ledger, `wxt/*` and `indexedDB`. attest/no-act refuses `.click()`. A transitive path through `../base` is open (TECH-10). |
| Cross-context messages typed in src/bus and Zod-validated | PASS | CalendarSnapshotMessage, AckCode, BusAck and ACKED_TYPES (messages.ts). sendChecked and listen validate both ends. MESSAGING_SYNTAX bans ad-hoc runtime messaging; lint is clean. |
| Policy values from policy/default.json; nothing hardcoded | PASS | staleChangeMs reads policy.unasked.windows (calendar-step.ts:88-91). The plumbing timings are in config.ts: debounce, max wait, heartbeat, hold, RETENTION_DAYS, startup delay. The receipt prior 0.6 lives in selectors.json and is never graded (Decisions [2.3]). Two constants are unrecorded (TECH-16). |
| No any, no `as unknown as`, no unexplained `!` | PASS | Lint rules are on and clean. I reviewed the single assertions: plan.ts:127, observers/coverage.ts:57 and :88, receipts/selectors.ts:197, ledger/coverage.ts:176. All narrow `unknown` or `object`. |
| No hardcoded hosts, ids or URLs | PASS (LOW) | Hosts come from OBSERVER_HOSTS: the manifest (wxt.config.ts:48), content-script matches, and the observers' `hosts`. gmail selectors.json:7 repeats `mail.google.com` (TECH-14). |
| No duplicated selector logic; shared helpers in base | GAP | TECH-5 (shown.ts ×2, account readers ×3), TECH-6 (event equality ×2), TECH-14. |
| No TODO or FIXME | PASS | grep over src, entrypoints, scripts and bench finds 0 (only mktemp's XXXXXX). |
| Errors typed, carry context, never swallowed | GAP | ObserverError, GcalError, ReceiptError and CalendarRowRefused have closed codes, and catch sites map to reason codes or rethrow. But the logger drops their name and code (TECH-3). gmail and gcal selectors throw a raw ZodError at load. |
| Functions ≤ 60 lines, files ≤ 400 lines | PASS | SIZE_RULES are enforced by lint, which is clean. The largest Sprint 2 files: base.ts 372, coverage.ts 323, retention.ts 322, observer-messages.ts 315. |
| Naming | PASS | All new files are kebab-case (find check). Classes are PascalCase and constants UPPER_SNAKE. |
| Determinism: no clock or randomness in src/core | PASS | Lint (core-determinism) is clean. Clock reads sit at the edges: base.ts runPass, router.ts, alarms.ts, ledger upsert.ts:160. |
| Ids from content hashes where idempotency matters | PASS | contentHash comes from project(). Event key = hashRowKey(data-eventid) (read.ts:153). Calendar key = hashText(name) (read.ts:220-222). Calendar record key = [observerId+accountHash+range] (db.ts:86). |
| Timestamps ISO with offset; money in cents plus currency | PASS | IsoTs is used in the snapshot, coverage and messages. Receipts carry amountCents in minor units plus an ISO 4217 currency (receipts/extract.ts:35; selectors.ts:41). |
| Dexie indexes for every hot query; no full scans in hot paths | GAP | Every queried index exists: [source+endMs], [source+accountKey+syncMs], readMs, contentHash, [type+timeBucket], supersededBy, observationIds. But the range shapes read every future-dated interval per ping and per claim, and the closure reads the whole source (TECH-1). The clock-repair path full-scans tables (TECH-1, rare). |
| Ledger reads paginated in UI; no toArray on unbounded tables | N/A | No UI this sprint. The export is a deliberate full dump. Hot-path reads are covered by TECH-1. |
| Content scripts debounce DOM observation | PASS (gap on cost) | batch.ts:63-85 debounces 500 ms with a 2 s cap. The observer callback only pokes (batch.ts:109-111). Pass cost, the unfiltered attributes and the two watchers per Gmail tab: TECH-2. |
| Service worker does no work on onStartup beyond alarms | PASS | background.ts:23-27 calls ensureAlarms, which only creates missing alarms; the purge then first fires 1 min later (alarms.ts:68-78; Decisions [2.7]). |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | PASS | Table above; the popup is 15,341 B. Content-script weight is flagged in TECH-17. |
| New messages, tables and fields documented | PASS | docs/adapters.md §3.4 and §9, and docs/privacy-architecture.md §5. `tsx scripts/check-docs.ts` is OK (17 allowlisted fields). adapters-reasons and privacy-architecture unit tests enforce it. |
| Docs in sync with code | GAP | grading.md v1.11 matches the code where spot-checked (calendarBound, changeSpan removed, staleChangeMs, heartbeat). privacy-architecture retention and hosts match. adapters.md heartbeat text is stale (TECH-11). The selector-version rule is broken (TECH-4). |
| Decisions.md entry for every unspecified choice | GAP | TECH-16. |
| CHANGELOG updated under Unreleased | GAP | Sprint 2 lines exist (:36-37, :41-45), but :9, :15 and :20 contradict the build (TECH-9). |
| Tests follow the build_spec §6 layout | GAP | Six property suites sit under tests/unit (TECH-15). |
| selectors.json versioning and fixture-folder pairing | GAP | TECH-4. |
| Dead code | GAP | TECH-13. |
| Complexity hot spots in src/background and src/ledger | PASS | Ad-hoc `complexity:8`: the background maximum is 9 (storeRows, pingProblem). The ledger has none over 8 (one depth-4 block, retention.ts:201). In observers, gcal readEvent is 17 (flat guards). The Calendar worker pipeline is intricate but documented (adapters.md §3.6, §8.3). |
| Telemetry-api | N/A | Not touched. |

## Gaps

### TECH-1 (MEDIUM): coverage-store reads grow with every future-dated Calendar marker and window

Rule: Dexie indexes for every hot query, and no full scans in hot paths (coverageFor, the closure, calendar passes). Hard Rule 5 rests on this store.

`recordCoverage` runs on every coverage ping. That means every Calendar pass: at least once a minute per visible tab, plus each burst of changes.
- `mayTouch` (coverage-store.ts:87-92) reads `[source+endMs]` from the new window's start up to `Dexie.maxKey`. So it reads and Zod-parses every gcal.event interval that ends later, including every first-look marker of a future event. A marker is its own merge group and never merges with a window (coverage-merge.ts:58-68).
- `coverageFor` has the same half-open range in `overlapping` (coverage.ts:95-97).
- `overlapRuns` (coverage.ts:189-191) reads the whole source for every calendar claim's closure. It is cached only inside one read transaction.
- Markers are written for every event first seen and kept 90 days, so each ping and each claim costs more as the calendar fills.
- The clock-guard repair full-scans coverageIntervals, coverage and every observation (clock-guard.ts:93-96, 106) inside one readwrite transaction. This path is rare.
- No perf gate covers the Dexie coverage store or the Dexie ObservationIndex. tests/perf only gates candidates and grading over the memory index.

Evidence: the two tables under "Measurements".

Fix:
1. Bound the range from above. A gmail.* window ends by its sync. A gcal.event window that may merge ends at most MAX_RANGE_DAYS after the incoming end, because Calendar unions only by containment.
2. Keep markers out of window reads with a derived, indexed kind ('marker' or 'window'; index `[source+kind+endMs]`, schema v4).
3. In coverageFor, read windows within [fromMs, toMs + longest window] and markers within [fromMs, toMs]. Build the closure by widening from the seeds instead of reading the whole source.
4. Add a perf gate that counts rows read (deterministic) for 2,000 markers and 90 days of windows.

### TECH-2 (MEDIUM): each pass re-reads the page 4–8 times and may run every 2 s; the worker runs N+5 transactions per Gmail pass

Rule: content scripts batch DOM work; flag anything that would slow a Gmail tab. Decisions [2.0] said re-posting every row was to be revisited in 2.7.

In the content scripts:
- `planPass` calls health, extract, the window reader, the snapshot and account separately, and each one re-reads the page.
  - gmail.sent: readSentPage at health.ts:26 and extract.ts:58, 64 and 84.
  - gmail.receipt: readPage at health.ts:17, extract.ts:42 and 63, and index.ts:44.
  - gcal.event: readCalendar at health.ts:19, observer.ts:65 and 86, and extract.ts:24, plus pageBusy 4 times. zoneHints walks every element of role=main on each read (page.ts:185).
- The MutationObserver watches every attribute of the whole document, with no attributeFilter (batch.ts:88-93). Under continuous changes it fires a pass every 2 s (batch.ts:79-83).
- Gmail starts two observers, so two whole-document watchers and two sets of input listeners (gmail.content.ts:25-28).

In the worker:
- A Gmail Sent head pass of N rows costs N + 5 readwrite transactions (observer-messages.ts:138, 162-174, 206, 293-294; upsert.ts:149; repo.ts:280).
- Every health report is written (ledger health.ts:75-77) and broadcast as `ledger.changed`.
- A Calendar pass rewrites the range's whole snapshot record every time, even when nothing changed (calendar-pass.ts:190).
- No Decisions entry revisits [2.0]'s re-post choice (Decisions.md:1013).

Evidence: the per-pass table under "Measurements".

Fix:
1. Read each page once per pass: one `read(doc, ctx)` step, or a memo per pass, with one shownChecker per pass.
2. Restrict the watcher with an attributeFilter built from the attributes selectors.json reads, and share one watcher and one activity tracker per content script.
3. In the worker, store a Gmail message's rows in one transaction while still collecting each row's refusal. Skip unchanged health writes and broadcasts. Keep the Calendar base's readAt in a small record.
4. Have live smoke record ms per pass and passes per minute.

### TECH-3 (MEDIUM): the logger prints Sprint 2's typed errors as a bare `Error`

Rule: errors are typed and carry context; Hard Rule 6. The 2.7 carry-forward requires `PolicyError('policy_not_loaded')` to fail loud.

- `describeError` (log.ts:124-129) prints a name only if it is in LOG_ERROR_NAMES, and a code only if it is in LOG_VALUES.
- LOG_ERROR_NAMES (log-vocabulary.ts:155-203) lacks GcalError, ReceiptError, ObserverError and CalendarRowRefused, all new this sprint. It also lacks PolicyError, RedactError and CandidatesError.
- None of their codes is in LOG_VALUES.
- listen.ts:143 logs a throwing handler with its error, so the failure the carry-forward cares about is logged anonymously.
- The gmail and gcal selectors loaders throw a raw ZodError (gmail/selectors.ts:58, gcal/selectors.ts:67-69). The receipts loader throws `ReceiptError('invalid_selectors')`.

Evidence (scratch `logprobe.mts`, through the real src/log.ts):
- `PolicyError([], 'policy_not_loaded')` → `Error messageLength=25`
- `GcalError('range_mismatch')` → `Error messageLength=20`
- `CalendarRowRefused('late_sighting')` → `Error code=late_sighting messageLength=42`
- `LedgerError` → `LedgerError code=invalid_input`

Fix:
1. Register the names and their closed codes.
2. Add a unit test that every class extending Error under src/, and every `*_ERROR_CODES` entry, is loggable.
3. Make the gmail and gcal selectors loaders throw a typed error.

### TECH-4 (MEDIUM): fixture labels carry stale or missing selector versions, and nothing checks them

Rule: adapter_engineer rule 3; docs/adapters.md §5 ("labels record the version they were checked against"); Hard Rule 12.

- The gcal selectors are 1.2.0 (selectors.json:4, Decisions [2.7-observers]). All 8 gcal labels say `gcal.event@1.1.0`.
- The 9 Gmail Sent, Drafts, Inbox and thread labels carry `selectorsVersion: null`, although gmail.sent 1.0.0 is recorded as paired with that folder.
- receipts/selectors.json has no `observer` and no `fixtures` fields, unlike the other two.
- `selectorsVersion` is a free, nullable field (tests/tools/capture-output.ts:27). No test compares it with the observers' versions.

Evidence: a node read of both labels.json files: 16 `gmail.receipt@1.0.1`, 9 null, 8 `gcal.event@1.1.0`.

Fix:
1. Re-check the labels and set them to the current versions (`gcal.event@1.2.0`, `gmail.sent@1.0.0`).
2. Add `observer` and `fixtures` to receipts/selectors.json.
3. Add a fixture-labels test that every observer reporting on a page has its current `<id>@<version>` in the label, and that every selectors.json `fixtures` folder exists and carries that version.

### TECH-5 (MEDIUM): visibility and account readers are duplicated across the observers, with different rules

Rule: no duplicated selector logic; shared helpers live in src/observers/base.ts; Hard Rules 5 and 6.

**shown.ts**
- gmail/shown.ts:12-24 and gcal/shown.ts:12-23 are the same code; the gcal copy adds a memoized checker. The shared src/observers/shown.ts that Decisions [2.5-verify] requested (Decisions.md:1147) was never made.
- The receipt observer uses neither copy. It takes the first role=main, shown or not (receipts/message.ts:206).
- docs/adapters.md:495 says a stale view "can be told apart only by class-based styles". gmail.sent and gcal.event already tell hidden views apart through the `hidden` attribute and computed style, never a class name.

**Account readers.** The Google account bar is read three ways:
- gmail/account.ts:23-43: works in any language and reports two accounts as ambiguous.
- receipts/message.ts:70-76: first `a[aria-label^='Google Account:']`, English only, no two-account check.
- gcal/page.ts:198-206: English prefix.

Decisions [2.2] (Decisions.md:1086) says gmail/account.ts can be reused by the receipt observer. In a non-English Gmail, receipt pings carry no account hash, while gmail.sent on the same page reads the account.

Fix:
1. One src/observers/shown.ts for all three observers. The receipt reader should require exactly one shown role=main.
2. One account reader that follows the gmail.sent rule, with its selectors in each selectors.json (version bumps).
3. Update adapters.md §8.2.

### TECH-6 (MEDIUM): Calendar event equality is written twice

Rule: no duplicated logic; Hard Rule 7.

calendar-seen.ts:24-39 (`sameInstant`, `sameState`) repeats gcal/diff.ts:93-108 (`sameInstant`, `changed`). Its comment says it compares "every field the diff compares". Its test (calendar-seen.spec.ts:196-220) pins a hand-written field list, not the diff.

If a field is added to `changed` and not to `sameState`, an update that another range saw first is no longer turned into a first sighting. That gives a false UNASKED.

Fix: export one `sameEventState` from the diff module (with `changed = !sameEventState`) and import it in calendar-seen.ts. Or add a property test that `sameState(a, b)` equals `!changed(a, b)`.

### TECH-7 (MEDIUM): the worker and ledger import the Calendar observer; the worker parses Calendar selectors at start-up

Rule: architecture boundaries enforced by lint; TECH-V3 (no DOM code in the service worker); Hard Rule 6.

- The snapshot schema, the diff and the day helpers live in src/observers/gcal. They are imported by:
  - src/ledger/calendar-snapshots.ts:24
  - src/bus/messages.ts:39
  - src/background/calendar-step.ts:47-49
  - src/background/calendar-pass.ts:58
  - src/background/calendar-seen.ts:21
- snapshot.ts imports time.ts, time.ts imports selectors.ts, and selectors.ts parses selectors.json when it loads.
- So a selectors.json that fails its schema (a slip during the 2.8 selector repair) throws during the worker's module evaluation, before `main()` registers the bus listener and the alarms. Every observer and the purge would stop, not just Calendar.
- No fence covers this direction. WORKER_SCOPES (fences.js:23) bans DOM globals only in the worker's own files.

Evidence:
- background.js.map lists gcal/selectors.json, selectors.ts, time.ts, snapshot.ts, errors.ts and diff.ts.
- `Google Account:` and `aria-busy` appear in background.js.
- A stdin probe importing `../observers/gcal/read` from src/background and from src/ledger is ALLOWED.

Fix: move these pieces into a DOM-free shared module (for example src/calendar/) that takes the selectors version as a parameter. Fence WORKER_SCOPES and src/ledger off src/observers/**.

### TECH-8 (MEDIUM): an open defect left for the sprint close: the Gmail Sent head window includes a boundary minute it did not see

Rule: Hard Rule 5.

- extract.ts:72-76 starts the head's window at the oldest visible row's minute.
- A send in that same minute that is older than the oldest row sits on page 2, yet falls inside the window. A claim for that send can then grade NOT_FOUND although the send happened.
- docs/adapters.md:473 states how it is triggered and says "The fix (start the window one minute later when the list may continue) is open for the sprint close".
- Decisions [2.7-observers] (Decisions.md:1190) left it as a residual. [2.9] (Decisions.md:1238) says the risk is higher than first stated.
- It is not in docs/attacks-that-work.md, so it is not an accepted limit.

Fix: when the list may continue (Older enabled, or a full page), start the window after the boundary minute. Add the two-sends-in-one-minute fixture the doc describes.

### TECH-9 (MEDIUM): CHANGELOG [Unreleased] contradicts the build

Rule: CHANGELOG updated under Unreleased; Hard Rule 8.

- CHANGELOG.md:9 says "no host permissions", and no other line mentions hosts. The manifest asks for two (wxt.config.ts:48); PRIVACY.md:89 was updated.
- :15 says "Dexie schema v1 (eight tables)". It is now v3 with ten tables.
- :20 says "retention alarm scheduling". The 90-day purge now runs.
- The observers' addition is not listed under Added.

Fix: correct those lines. Add the two hosts, the schema v3 tables, the purge, and the three observers (Gmail Sent, eight receipt parsers, Calendar).

### TECH-10 (LOW): fence edges

Rule: observers are pure over the DOM, with no storage or bus inside extract, enforced by lint.

- EXTRACTOR_RESTRICTED_IMPORTS (fences.js:108) checks import specifiers only. An extractor may import `../base`, which imports src/bus/send and src/clock.
- The top-level helpers that every extractor imports (text.ts, account.ts, types.ts) may import src/bus and wxt/browser.
- ACT_RESTRICTED_IMPORTS does not list wxt/browser, so content-script code may use `browser.storage.local`.
- Nothing does any of this today.

Evidence (stdin probes): `import { browserOffsetAt } from '../base'` in src/observers/gcal is ALLOWED. `import { send } from '../bus/send'` in src/observers/text.ts is ALLOWED. `browser.storage.local.get` in src/observers/text.ts and in the Gmail content script is ALLOWED.

Fix:
1. Move browserOffsetAt out of base.ts.
2. Refuse imports of base and plan from extractors, and of src/bus from helper files.
3. Ban `browser.storage` and `chrome.storage` in ACT_SCOPES.

### TECH-11 (LOW): docs/adapters.md and config.ts describe the Calendar read cadence wrongly

Rule: docs in sync with code.

- adapters.md:540 says Calendar passes run only when the page changes, and that a read every minute is "an observer change, not made yet". It was made: gcal.content.ts:67 passes `heartbeatMs: OBSERVER_HEARTBEAT_MS`, and grading.md:86 and attacks-that-work.md:14 describe it.
- §3.1 (line 78) omits the heartbeat.
- config.ts:140-141 says "only a tab the user has open and visible is read". A pass triggered by a DOM change also runs in a hidden tab: base.ts:354-357 checks prerendering, not visibility. Hard Rule 11 still holds; the wording is wrong.

Fix: document the heartbeat and the read on becoming visible in §3.1, delete the stale clause in §8.3, and reword the config.ts comment.

### TECH-12 (LOW): the Calendar content-script entrypoint holds business logic

Rule: entrypoints are thin.

calendarScript (gcal.content.ts:39-57) decides that a known-account page posts no rows, and tags each snapshot with that pass's account hash (Decisions [2.7]; Hard Rules 5 and 7). Its unit test imports the entrypoint (calendar-script.spec.ts:9). It also reads the account a second time each pass.

Fix: move it to src/observers/gcal/script.ts and keep the entrypoint to wiring.

### TECH-13 (LOW): vestigial code paths

Rule: no dead code; Hard Rule 12 (a number says what it measures).

- Production builds the Calendar observer with `previous: () => null` (gcal.content.ts:65), and the worker derives every row. So the following are used only by tests and the bench:
  - GcalObserverOptions.previous (observer.ts:45)
  - PreviousSnapshot (extract.ts:33)
  - previousSnapshot() and the baseline continuation (pass.ts:29-36, 102-107)
  - GcalObserver.range (observer.ts:50, 83)
- bench/observers/gcal.ts:10-11 scores "the change rows the observer emits", but in production the observer emits none. `gcalDiffsExact 6/6` (RESULTS.md:62) measures `diffSnapshots` alone, not the shipped calendarStep, which reports a deletion only after two complete snapshots. The E2E covers the shipped path.
- The v1 `*counterpartyTokens` index (db.ts:45, index-fields.ts:106, 136) is computed on every observation write. It is read only by `observationsByCounterpartyToken` (repo.ts:164), which only tests call.
- retention.ts:61 re-exports RETENTION_DAYS for one test.

Fix:
1. Drop the `previous` option, or mark it test-only.
2. Rename the bench metric, or score calendarStep.
3. Drop or rederive the token index in a schema v4.

### TECH-14 (LOW): small duplicates and vendor strings outside selectors.json

Rule: no duplicated logic; selectors live in selectors.json (adapter_engineer rule 3); no hardcoded hosts.

- ELEMENT_NODE, TEXT_NODE and isElement are defined twice (receipts/message.ts:86-92, gcal/page.ts:44-49).
- MS_PER_MINUTE is defined again in gcal/time.ts:30 (core/units.ts:8 has it).
- "The day after a date" is computed three ways: gcal/time.ts:73-76, calendar-pass.ts:73-77, and core civilDateAt.
- Gmail's URL fragment is parsed twice (route.ts:25-36, receipts/message.ts:63-68).
- `'(no subject)'` is a code literal in receipts/extract.ts:23 but a versioned value in gmail/selectors.json:37.
- The receipt reader hard-codes its date and account attributes and the account regex (message.ts:72-73, 149, 162).
- gmail/selectors.json:7 repeats the host `mail.google.com` that config.ts:38 owns.

Fix: share the helpers and move the vendor strings into receipts/selectors.json (version bump, recorded in Decisions).

### TECH-15 (LOW): six property suites added under tests/unit

Rule: tests follow the build_spec §6 layout.

These are property tests:
- tests/unit/ledger/coverage.property.spec.ts
- tests/unit/ledger/coverage-calendar.property.spec.ts
- tests/unit/ledger/coverage-closure.property.spec.ts
- tests/unit/ledger/coverage-many.property.spec.ts
- tests/unit/ledger/retention.property.spec.ts
- tests/unit/observers/gcal/diff-property.spec.ts

The other Sprint 2 property suites are in tests/property. Nothing enforces where they go.

Fix: move them to tests/property, and add a layout check.

### TECH-16 (LOW): Decisions.md has stale and unclosed entries

Rule: Decisions.md has an entry for every unspecified choice.

- [2.9] (Decisions.md:1234, 1243) describes Calendar writes as separate, "the atomicity gap stays documented". [2.7-D2] (Decisions.md:1262) made one transaction but does not supersede them.
- [2.6] (Decisions.md:1066): RETENTION_DAYS was to move to config.ts. It moved, with no entry.
- [2.0] "Revisit in 2.7" (Decisions.md:1013) and [2.5-verify] "shared shown.ts requested" (Decisions.md:1147) are never closed.
- REFUSED_KEPT = 32 (observer-state.ts:25) and MAX_LABEL = 20,000 (label.ts:46) have no entry.

Fix: append dated entries that supersede, record or close each of these.

### TECH-17 (LOW): content scripts weigh 65–70 KB gzipped; 38–41% of each is zod

Rule: bundle size per entrypoint; flag anything that would slow a Gmail tab.

- gmail.js and gcal.js are injected into every Gmail and Calendar tab.
- zod classic is 90.5 KB of each. Its schemas.js pulls in about 17.5 KB of JSON-schema code that Attest never calls (json-schema-processors.js, to-json-schema.js).
- The Unicode tables add 49.8 KB; core normalisation needs them.
- At start, each script builds every schema and parses the policy.
- No budget exists. Sprint 0 TECH-16 was refuted before any content script existed.

Evidence: evaluating the built scripts in fresh happy-dom windows took 38–196 ms (gmail) and 29–255 ms (gcal) over 5 runs. That is not a Chrome number.

Fix:
1. Add a bundle-size bench with a budget per content script.
2. Try `zod/mini` for the content-script schemas.
3. Have live smoke record evaluation time in Chrome.

## Commands run

All read-only, or run on a scratch copy.
- `git diff --stat 60bca2d..1e54fd9`
- `npx eslint src entrypoints --max-warnings 0`
- `npx eslint --print-config` on 8 files
- ESLint `--stdin` fence probes
- `git archive HEAD` into scratch, then `wxt build`
- size and source-map attribution scripts
- happy-dom evaluation of the built scripts
- the tsx pass probe over the synthetic fixtures
- fake-indexeddb coverage probes (timing, and rows read)
- the logger probe
- an ad-hoc complexity lint
- `npx tsx scripts/check-docs.ts`
- `npx vitest run` on 3 targeted files (43 passed)

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint-enforced) | PASS | Core block (CORE_RESTRICTED_IMPORTS, core-globals, core-determinism) applies; npx eslint src entrypoints --max-warnings 0 gives 0 errors and 0 warnings over 184 files, including Sprint 2 core edits (batch-orphans.ts, conditions-level.ts, features.ts). |
| Content scripts and observers cannot reach the ledger (lint-enforced) | PASS | ESLint stdin probes through the real config were refused by no-restricted-imports (fences.js:94 ACT_RESTRICTED_IMPORTS): ../../ledger/repo from src/observers/gcal/health.ts, ../ledger/repo from src/observers/text.ts, ../../src/ledger/repo and ../../src/background/observer-messages from entrypoints/content/gmail.content.ts. Edge cases in TECH-10. |
| Entrypoints are thin (no business logic in background.ts or *.content.ts) | GAP | background.ts:14-35 and gmail.content.ts:19-30 are wiring only; gcal.content.ts:39-57 calendarScript decides which rows a pass posts and tags snapshots with the account hash (TECH-12). |
| Observers pure over the DOM; no storage or bus inside extract() | PASS | Extractor scope (src/observers/*/**) refuses src/bus (probe: extract() returns data; the content script posts it to the bus), the ledger, wxt/* and indexedDB; attest/no-act refuses .click(). Transitive path through ../base and extension storage left open: TECH-10 (LOW). |
| Cross-context messages typed in src/bus and Zod-validated | PASS | messages.ts adds CalendarSnapshotMessage, AckCode, BusAck, ACKED_TYPES; send.ts sendChecked parses outgoing and the BusAck reply; listen.ts checkedAck validates answers; MESSAGING_SYNTAX bans ad-hoc runtime messaging (lint clean). |
| Policy values from policy/default.json; no thresholds, windows or weights hardcoded | PASS | calendar-step.ts:88-91 staleChangeMs reads policy.unasked.windows; timings in config.ts (OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS, OBSERVER_HEARTBEAT_MS, CALENDAR_PASS_HOLD_MS, RETENTION_DAYS, PURGE_STARTUP_DELAY_MINUTES); receipt prior 0.6 in receipts selectors.json, never graded (Decisions [2.3]). Two unrecorded plumbing constants noted in TECH-16. |
| No any outside tests; no as unknown as; no unexplained non-null assertions | PASS | Rules no-explicit-any, no-non-null-assertion and DOUBLE_ASSERTION_SYNTAX are on; lint clean. Single assertions reviewed: plan.ts:127, observers/coverage.ts:57 and :88, receipts/selectors.ts:197, ledger/coverage.ts:176, all narrowing unknown/object. |
| No hardcoded hosts, ids or URLs; constants in src/config.ts | PASS | Hosts come from OBSERVER_HOSTS: manifest (wxt.config.ts:48), content-script matches (gcal.content.ts:60, gmail.content.ts:20), observer hosts checked by assertObserver (base.ts:95-100). Minor duplicate of mail.google.com in gmail/selectors.json:7 (TECH-14). |
| No duplicate selector logic across observers; shared helpers in base | GAP | gmail/shown.ts and gcal/shown.ts duplicate each other; three account readers with different rules (TECH-5); event equality in gcal/diff.ts and background/calendar-seen.ts (TECH-6); smaller duplicates (TECH-14). |
| No TODO/FIXME without a linked task | PASS | grep TODO\|FIXME\|XXX\|HACK over extension/src, extension/entrypoints, scripts/pre-push.sh, scripts/check-docs-allowlist.ts, bench/observers: 0 hits (only mktemp's XXXXXX template). |
| Errors are typed, carry context, never swallowed | GAP | New typed classes ObserverError, GcalError, ReceiptError, CalendarRowRefused with closed codes; catch sites map to reason codes or rethrow. But LOG_ERROR_NAMES/LOG_VALUES omit them, so bus.handler_failed logs PolicyError('policy_not_loaded') as Error messageLength=25 (TECH-3). |
| Functions <= 60 lines; files <= 400 lines | PASS | SIZE_RULES enforced by lint (clean). Largest Sprint 2 files: observers/base.ts 372, ledger/coverage.ts 323, ledger/retention.ts 322, background/observer-messages.ts 315. |
| Naming: camelCase, PascalCase, kebab-case files, UPPER_SNAKE constants | PASS | find over src, entrypoints and tests shows no file outside kebab-case .ts/.json or PascalCase .tsx; classes PascalCase; module constants UPPER_SNAKE. |
| No Date.now, Math.random or model call in src/core | PASS | attest/core-determinism and CORE_RESTRICTED_SYNTAX lint clean; Sprint 2 clock reads are at the edges (base.ts runPass via nowIso, router.ts:24, alarms.ts:32, ledger upsert.ts:160). |
| Ids derived from content hashes where idempotency matters | PASS | Observations keyed by contentHash via project(); snapshot event key = hashRowKey(data-eventid) (gcal/read.ts:153); calendar key = hashText(name) (read.ts:220-222); calendar record key [observerId+accountHash+range] (db.ts:86). |
| Timestamps ISO 8601 with offset; money integer cents plus currency | PASS | IsoTs in CalendarSnapshot, ObserverCoverage and bus messages; receipts carry amountCents (Money.minor) plus an ISO 4217 currency (receipts/extract.ts:35; receipts/selectors.ts:41 DOLLAR refine). |
| Dexie indexes exist for every query path; no full-table scans in hot paths | GAP | Indexes exist for every query ([source+endMs], [source+accountKey], [source+accountKey+syncMs], readMs, contentHash, [type+timeBucket], supersededBy, *observationIds). But recordCoverage and coverageFor use half-open [source+endMs] ranges that read every future-dated gcal interval and marker (200 markers -> 200 rows per Calendar ping, 380-580 per coverageFor), and overlapRuns reads the whole source (TECH-1). |
| Ledger reads paginated in UI; no toArray on unbounded tables | N/A | No UI work in Sprint 2; export.ts dumps every table by design. Hot-path reads covered by TECH-1. |
| Content scripts debounce DOM observation; no per-mutation extraction | PASS | batch.ts:63-85 debounce 500 ms, cap 2 s; MutationObserver callback only pokes (batch.ts:109-111); tests/unit/observers/batch.spec.ts. Per-pass cost, unfiltered attributes and two watchers per Gmail tab filed as TECH-2. |
| Service worker does no work on onStartup beyond re-registering alarms | PASS | background.ts:23-27 calls ensureAlarms only; alarms.ts:68-78 creates missing alarms (purge first fires PURGE_STARTUP_DELAY_MINUTES later, Decisions [2.7]). |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | PASS | Measured on a wxt build of HEAD: popup 15,341 B gzip, sidepanel 15,282, options 42,262, background.js 71,807, gcal.js 65,304, gmail.js 69,982. Content-script weight flagged in TECH-17. |
| Every new bus message, table and field documented | PASS | docs/adapters.md §3.4 and §9 (calendar.snapshot, BusAck codes), docs/privacy-architecture.md §5 (coverageIntervals, calendarSnapshots); tsx scripts/check-docs.ts OK (17 allowlisted fields checked); tests/unit/docs/adapters-reasons.spec.ts and privacy-architecture.spec.ts enforce it. |
| Docs in sync with code (adapters.md, privacy-architecture.md, grading.md v1.11, PRIVACY.md) | GAP | grading.md v1.11 spot checks match (calendarBound, changeSpan removed, staleChangeMs, heartbeat); privacy-architecture retention and hosts match; PRIVACY.md lists the two hosts. adapters.md:540 and :78 are stale on the heartbeat, config.ts:140-141 wording (TECH-11); label version rule broken (TECH-4). |
| Decisions.md has an entry for every unspecified choice | GAP | Stale [2.9] entries (lines 1234, 1243) not superseded by [2.7-D2] (line 1262); unclosed requests at lines 1013, 1066, 1147; REFUSED_KEPT and MAX_LABEL unrecorded (TECH-16). |
| CHANGELOG updated under Unreleased | GAP | Sprint 2 lines exist (CHANGELOG.md:36-37, :41-45) but :9 says no host permissions, :15 schema v1 eight tables, :20 alarm scheduling only (TECH-9). |
| Tests follow the build_spec §6 layout | GAP | Six fast-check property suites live under tests/unit (5 in tests/unit/ledger, 1 in tests/unit/observers/gcal) while other Sprint 2 properties are in tests/property (TECH-15). |
| selectors.json versioning and fixture-folder pairing | GAP | gcal selectors 1.2.0 vs all 8 labels gcal.event@1.1.0; 9 gmail.sent labels null; receipts selectors.json lacks observer/fixtures; no test compares (TECH-4). |
| Dead code | GAP | Observer previous-snapshot option, PreviousSnapshot, GcalObserver.range unused in production (gcal.content.ts:65 passes () => null); unused *counterpartyTokens index; RETENTION_DAYS re-export (TECH-13). |
| Complexity hot spots in src/background and src/ledger | PASS | Ad-hoc eslint complexity:8 / max-depth:3: background max 9 (storeRows, pingProblem), ledger none over 8 (one depth-4 block at retention.ts:201); observers gcal readEvent 17 (flat guards). Calendar worker pipeline documented in adapters.md §3.6 and §8.3. |
| Telemetry-api routers thin, typed | N/A | telemetry-api not touched in this range. |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **TECH-1** [MEDIUM] Coverage store reads grow with every future-dated Calendar marker and window → `extension/src/ledger/coverage-store.ts:91`
   - Rule: tech_reviewer: Dexie indexes for every hot query path, no full-table scans in hot paths (coverageFor, the closure, calendar passes); Hard Rule 5 depends on this store
   - Detail: recordCoverage runs on every coverage ping, so on every Calendar pass (at least once a minute per visible tab, plus each burst of changes). mayTouch (coverage-store.ts:87-92) reads [source+endMs] from the new window's start to Dexie.maxKey, reading and Zod-parsing every gcal.event interval that ends later, including every first-look marker of a future event, although a marker is its own merge group and never merges with a window (coverage-merge.ts:58-68). coverageFor has the same half-open range in overlapping (coverage.ts:95-97) and reads the whole source in overlapRuns (coverage.ts:189-191) for every calendar claim's closure, cached only within one read transaction. Markers are written for every event first seen and kept 90 days, so each ping and each claim costs more as the calendar fills. The clock-guard repair full-scans coverageIntervals, coverage and every observation (clock-guard.ts:93-96, 106) in one readwrite transaction (rare path). No perf gate covers the Dexie coverage store or the Dexie ObservationIndex: tests/perf only gates candidates and grading over the memory index.
   - Evidence: Scratch probe build/extension/probe/coverage-rows.mts (fake-indexeddb, Dexie reading hook): future markers 0/50/200/200 (+200 past) -> rows read by recordCoverage(gcal week) 0/50/200/200, by recordCoverage(gmail.sent) 0/0/0/0, by coverageFor(calendar.created, 1 h at +10 d) 2/97/380/580. Timing probe coverage-probe.mts (fake-indexeddb, not Chrome): 0 markers 2.3 ms recordCoverage and 4.9 ms coverageFor; 500 markers 1,299 ms and 2,315 ms; 2,000 markers 17,045 ms and 27,642 ms.
   - Suggested fix: Bound the range above: a gmail.* window never ends after its sync, and a gcal.event window that may merge ends at most MAX_RANGE_DAYS after the incoming end (Calendar unions only by containment). Keep markers out of window reads with a derived, indexed kind ('marker' or 'window', index [source+kind+endMs], schema v4). In coverageFor read windows within [fromMs, toMs + longest window] and markers within [fromMs, toMs], and build the overlap closure by widening from the seeds instead of reading the whole source. Add a tests/perf gate that counts rows read (deterministic) for recordCoverage and coverageForMany with 2,000 markers and 90 days of windows.
   - Verification: **CONFIRMED**. Reproduced exactly. vprobe/cov-rows.mts (fake-indexeddb, Dexie reading hook) gives the review's numbers: recordCoverage(gcal week) reads 0/200/200 rows and coverageFor reads 2/380/580 rows, at 0, 200 and 200+200 markers.
     
     One correction: past markers cost a ping nothing. With 0 future and 400 past markers, recordCoverage reads 0 rows. A ping only reads intervals ending at or after its window start (coverage-store.ts:87-92). So ping cost grows with future-dated markers and windows, not with all 90 days.
     
     Real Chromium 153 (vprobe/chrome-cov-entry.ts, Playwright, real IndexedDB), at 0/200/500/2,000 future markers:
     - recordCoverage median: 3.0 / 13.7 / 24.8 / 103.6 ms
     - coverageFor median: 3.1 / 21.5 / 43.5 / 230 ms
     
     So fake-indexeddb overstated time 50-165x. The live cost per ping is modest, and it runs in the worker.
     
     The batch path is worse than the review shows. overlapping() (coverage.ts:89-107) runs per query and is outside the [2.7-E2] cache. So coverageForMany costs claims x future intervals. vprobe/chrome-many-entry.ts:
     - 50 calendar.created claims at 0/200/2,000 future markers: 52 / 10,252 / 102,052 rows read, 20 / 364 / 2,809 ms
     - 200 claims at 2,000 markers: 401,990 rows, 11.4 s
     
     tests/perf uses only createMemoryIndex, so no gate covers this. MEDIUM holds: the Sprint 3.6 batches will pay seconds.

2. **TECH-2** [MEDIUM] Each pass re-reads the page 4 to 8 times and may run every 2 s; the worker runs N+5 readwrite transactions per Gmail pass → `extension/src/observers/batch.ts:88`
   - Rule: tech_reviewer: content scripts debounce DOM observation, no per-mutation extraction; flag anything that would slow a Gmail tab; Decisions [2.0] re-post choice marked 'revisit in 2.7'
   - Detail: planPass calls health, extract, the window reader, the snapshot and account separately, and each re-reads the page. gmail.sent: readSentPage at health.ts:26, extract.ts:58, 64, 84. gmail.receipt: readPage at health.ts:17, extract.ts:42 and 63, index.ts:44; classify 3 times per message. gcal.event: readCalendar at health.ts:19, observer.ts:65 and 86, extract.ts:24, plus pageBusy 4 times; zoneHints walks every element of role=main each read (page.ts:185). The MutationObserver watches every attribute of the whole document with no attributeFilter (batch.ts:88-93), and under continuous changes the batcher fires every OBSERVER_MAX_WAIT_MS = 2 s (batch.ts:79-83). Gmail starts two observers, so two whole-document watchers and two input-listener sets (gmail.content.ts:25-28). Worker side: a Gmail Sent head pass of N rows costs N + 5 readwrite transactions (observer-messages.ts:138, 162-174, 206, 293-294; upsert.ts:149; repo.ts:280), every health report is written (ledger health.ts:75-77) and broadcast as ledger.changed, and a Calendar pass rewrites the range's whole snapshot record every time (calendar-pass.ts:190) even when nothing changed. Decisions.md:1013 ([2.0]) said re-posting every row would be revisited in 2.7; no entry revisits it.
   - Evidence: Scratch probe passprobe.mts over the synthetic fixtures (happy-dom, median of 30): gmail.sent page-1 12.5 ms/pass, 92 getComputedStyle, role=main and role=row each queried 4 times; gmail.receipt shopify 2.6 ms, readPage 4 times; gcal week-before 23.8 ms, 409 getComputedStyle, role=main queried 8 times, querySelectorAll('*') 32 times; gcal month-november 38.4 ms, 585 getComputedStyle. Real pages are larger; passes per minute on live Gmail cannot be measured on fixtures.
   - Suggested fix: Read each page once per pass: one read(doc, ctx) step in the Observer contract (or a per-pass memo) from which health, extract, windows, snapshot and account derive, with one shownChecker per pass. Add an attributeFilter built from the attributes selectors.json reads, and share one watcher and one activity tracker per content script. In the worker store a Gmail message's rows in one readwrite transaction while still collecting per-row refusals, skip the adapterHealth write and broadcast when status, reasons and version are unchanged, and keep the Calendar base's readAt in a small record instead of rewriting the snapshot. Make live smoke (2.8) record ms per pass and passes per minute on real Gmail Sent and Calendar.
   - Verification: **CONFIRMED**. The structure reproduces; the timings and two counts need correcting.
     
     Page reads per pass (vprobe/pass-count.mts, counters on the readers):
     - Sent head: readSentPage x4 (x1 on Inbox, which goes DEGRADED early).
     - Opened receipt: readPage x4 (x3 on Inbox).
     - Calendar in production: readCalendar x4 and pageBusy x3, not x4. The wrapped extract skips calendar.extract when the account is known.
     - getComputedStyle per pass: 92 / 409 / 585, as reported.
     
     Real Chromium on the same fixtures (vprobe/chrome-pass-entry.ts):
     - 1.5 ms Sent (312 elements)
     - 0.8 ms receipt
     - 2.5 / 3.1 ms Calendar week / month
     happy-dom gave 10.7-31 ms for these.
     
     Real pages are 10-50x larger, so the 4x re-read multiplies a cost nobody has measured. Live smoke must measure it.
     
     Worker side (vprobe/txn-count.mts, hook on Dexie core.transaction): an 11-row Sent head pass opens 18 readwrite transactions. That is N+7, not N+5: guardClock and clearLedgerDegraded each open one per message.
     
     In Chromium (vprobe/chrome-worker-entry.ts), re-posting unchanged rows costs per pass:
     - 11 rows: 11-16 ms (18 transactions)
     - 50 rows: 29 ms (57)
     - 100 rows: 57 ms (107)
     
     Also confirmed: batch.ts:88-93 sets no attributeFilter, and gmail.content.ts:25-28 starts two watchers.
     
     Caveat on the fix: writing health every pass is by design (Decisions.md:1011). Any skip must keep checkedAt fresh.

3. **TECH-5** [MEDIUM] Visibility and account readers are duplicated across the three observers, with different rules → `extension/src/observers/gmail/receipts/message.ts:71`
   - Rule: tech_reviewer: no duplicate selector logic across observers, shared helpers in src/observers/base.ts; Hard Rules 5 and 6
   - Detail: gmail/shown.ts:12-24 and gcal/shown.ts:12-23 are the same code; the gcal copy adds a memoized shownChecker. Decisions.md:1147 ([2.5-verify]) requested one src/observers/shown.ts and nothing closes it. The receipt observer uses neither copy: readPage takes the first role=main, shown or not (message.ts:206), and docs/adapters.md:495 says a stale view can be told apart only by class-based styles, though gmail.sent and gcal.event already tell hidden views apart through the hidden attribute and computed style. The signed-in account is read three ways: gmail/account.ts:23-43 (any banner aria-label ending in (address), any language, two addresses -> DEGRADED), receipts/message.ts:70-76 (first a[aria-label^='Google Account:'], English only, no two-account check), gcal/page.ts:198-206 (English prefix). Decisions.md:1086 ([2.2]) says gmail/account.ts can be reused by the receipt observer. In a non-English Gmail the receipt pings carry no account hash and the user's own mail is not excluded, while gmail.sent on the same page reads the account.
   - Evidence: Diff of the two shown.ts files differs only in comments and the added shownChecker; gcal/page.ts:13 and gmail/sent-page.ts:24 import their own copies; receipts imports neither. The three account-reader bodies at the cited lines.
   - Suggested fix: One src/observers/shown.ts (with the memoized checker) used by all three observers, the receipt reader requiring exactly one shown role=main. One Google-account reader with the gmail.sent rule (language-free, ambiguity is a reason) used by gmail.sent, gmail.receipt and gcal.event, its selectors in each selectors.json (version bumps). Update docs/adapters.md §8.2.
   - Verification: **CONFIRMED**. Confirmed.
     - A diff of gmail/shown.ts and gcal/shown.ts shows the same rule; the gcal copy adds the memoised shownChecker. Decisions.md:1147 asked for one shared file, and no entry closes that request.
     - receipts/message.ts:206 takes doc.querySelector('[role="main"]') with no shown check.
     - message.ts:70-76 reads the first 'Google Account:' link: English only, no two-account check. gmail/account.ts:23-43 reads any language and refuses two addresses.
     - docs/adapters.md:495 says a stale view 'can be told apart only by class-based styles'. gmail.sent already does it with the hidden attribute and computed style (gmail/shown.ts:16-37).
     
     The receipt behaviour is described in adapters.md §8.2, but not in docs/attacks-that-work.md, so it is not an accepted limit.

4. **TECH-6** [MEDIUM] Calendar event equality is written twice, in the observer's diff and in the worker → `extension/src/background/calendar-seen.ts:28`
   - Rule: tech_reviewer: no duplicated logic; Hard Rule 7 (UNASKED is never false)
   - Detail: calendar-seen.ts:24-39 (sameInstant, sameState) repeats gcal/diff.ts:93-108 (sameInstant, changed); its comment says it compares every field the diff compares. Its test (tests/unit/background/calendar-seen.spec.ts:196-220) pins a hand-written field list, not the diff. If a field is added to changed (a location hash, a recurrence id) and not to sameState, an update another range already saw is no longer turned into a first sighting, and whoever was active at this pass can be named for a change made earlier: a false UNASKED.
   - Evidence: Code read: diff.ts changed compares occurredAt and endAt as instants, allDay, subjectHint, calendar, guestCount and ASCII-folded guests; calendar-seen.ts sameState writes the same list out again plus key; no import between them.
   - Suggested fix: Export one sameEventState(a, b) from the Calendar diff module (changed = !sameEventState) and import it in calendar-seen.ts, or add a property test that sameState(a, b) equals !changed(a, b) for events with the same key.
   - Verification: **CONFIRMED**. Confirmed, but the stated failure direction is backwards. calendar-seen.ts:24-39 restates diff.ts:93-108: same fields, same ASCII folding.
     
     Which drift is dangerous:
     - Adding a field to the diff's changed() alone makes sameState looser. More updates then become first sightings. That is a missed UNASKED, the safe side (Decisions.md:1268).
     - The false-UNASKED path is the other one. changed() is loosened (a field ignored or normalised) while sameState still compares it. Then a change that another range saw first stays a change.
     
     No test catches drift. In scratch I removed guestCount from changed():
     - calendar-seen.spec.ts still passed 10/10.
     - Only the diff's own field pin failed (diff-change.spec.ts 'the guest count alone'). An intended change would update that test along with the code.
     
     MEDIUM holds for a Hard Rule 7 predicate kept in two copies.

5. **TECH-8** [MEDIUM] Open defect left for the sprint close: the Gmail Sent head window includes a boundary minute it did not see → `extension/src/observers/gmail/extract.ts:76`
   - Rule: Hard Rule 5 (UNVERIFIABLE beats a guess); docs/adapters.md §8.1 marks the fix open for the sprint close
   - Detail: sentWindow starts the head's window at the oldest visible row's minute (extract.ts:72-76). A send in that same minute that is older than the oldest row sits on page 2 but inside the window, so a claim for it can grade NOT_FOUND although it happened. docs/adapters.md:473 states the trigger (the send and the next one in the same minute, then a page of later sends before any head pass, e.g. an agent's burst) and says the fix (start the window one minute later when the list may continue) is open for the sprint close. Decisions.md:1190 ([2.7-observers]) left it as a residual; Decisions.md:1238 ([2.9]) says the risk is higher than first written. It is not in docs/attacks-that-work.md, so it is not an accepted limit.
   - Evidence: extract.ts:76 returns { windowStart: oldest, windowEnd: page.head ? ctx.observedAt : newest } with oldest = the oldest row's minute; docs/adapters.md:473 quoted above.
   - Suggested fix: When the head page may continue (Older control enabled, or the page is full), start the window after the oldest row's minute, and add the adversarial fixture the doc describes (two sends in one minute, the older on page 2) with its expected coverage.
   - Verification: **CONFIRMED**. Confirmed.
     - extract.ts:72-76 starts the head's window at the oldest row's minute.
     - docs/adapters.md:473 says a same-minute, older send on page 2 falls inside the window, and that a claim for it 'grades NOT FOUND although the send happened'. It also says the fix 'is open for the sprint close'.
     - Decisions.md:1190 left it as a residual. Decisions.md:1238 says the risk had been understated.
     
     The 2-minute beforeClaimMin does not prevent it. A claim stamped two or more minutes after the boundary minute (for example 10:34 for a 10:32 boundary) has a window that starts inside the covered span. That is the natural case for an after-the-fact report of a burst of sends.
     
     It is not listed in docs/attacks-that-work.md.

6. **TECH-3** [LOW (reviewer: MEDIUM)] The logger prints Sprint 2's typed errors as a bare Error with no code → `extension/src/log-vocabulary.ts:155`
   - Rule: tech_reviewer: errors are typed and carry context; Hard Rule 6 (fail loud); 2.7 carry-forward: PolicyError('policy_not_loaded') must fail loud
   - Detail: describeError (log.ts:124-129) prints an error's name only if it is in LOG_ERROR_NAMES and its code only if it is in LOG_VALUES. LOG_ERROR_NAMES (log-vocabulary.ts:155-203) lacks GcalError, ReceiptError, ObserverError and CalendarRowRefused (new this sprint) and PolicyError, RedactError and CandidatesError, which the worker can now meet. None of their codes (policy_not_loaded, range_mismatch, invalid_snapshot, unreadable_page, invalid_observer, invalid_options, invalid_selectors, time_unresolved, invalid_range) is in LOG_VALUES. listen.ts:143 logs a throwing handler with its error, so the failure the carry-forward says must fail loud is logged anonymously. Separately, gmail/selectors.ts:58 and gcal/selectors.ts:67-69 throw a raw ZodError at load, while the receipt loader throws ReceiptError('invalid_selectors').
   - Evidence: Scratch probe logprobe.mts through the real src/log.ts: PolicyError([], 'policy_not_loaded') -> Error messageLength=25; GcalError('range_mismatch') -> Error messageLength=20; CalendarRowRefused('late_sighting') -> Error code=late_sighting messageLength=42; LedgerError('invalid_input') -> LedgerError code=invalid_input. grep finds 0 occurrences of each listed code in log-vocabulary.ts.
   - Suggested fix: Add the class names to LOG_ERROR_NAMES and their closed codes to LOG_VALUES. Add a unit test that every class extending Error under src/ and every exported *_ERROR_CODES entry is loggable. Make gmail/selectors.ts and gcal/selectors.ts throw a typed error (ObserverError('invalid_selectors')) like the receipts loader.
   - Verification: **RESIZED** to LOW. Real but overstated.
     
     vprobe/logprobe.mts, through the real buildRecord:
     - PolicyError(policy_not_loaded) -> 'Error messageLength=25'
     - GcalError -> 'Error messageLength=20'
     - ReceiptError -> 'Error messageLength=32'
     - ObserverError -> 'Error messageLength=25'
     
     But only PolicyError and GcalError can reach src/log.ts. Both are bug paths in the worker (listen.ts:143).
     - ReceiptError and ObserverError are content-script errors. plan.ts:140-143 turns an extract throw into extract.threw. A throw at start-up goes to WXT's own crash log. No src/observers file imports log.
     - CalendarRowRefused is always caught and mapped to an ack code (calendar-pass.ts:211-212, calendar-rows.ts:93-94).
     
     The failure is still loud: log.error bus.handler_failed with the message type, ack 'failed', and postAcked stops the pass. Only the class name and code are lost. LOW.

7. **TECH-4** [LOW (reviewer: MEDIUM)] Fixture labels carry stale or missing selector versions, and nothing checks them → `extension/src/observers/gcal/selectors.json:4`
   - Rule: agents/adapter_engineer.md rule 3 (selectors versioned, recorded with the fixture folder); docs/adapters.md §5 (labels record the version they were checked against); Hard Rule 12
   - Detail: The Calendar selectors are 1.2.0 (Decisions [2.7-observers]) but all 8 entries of tests/fixtures/pages/gcal/2026-10-03/labels.json say selectorsVersion gcal.event@1.1.0. The 9 Gmail Sent, Drafts, Inbox and thread entries of gmail/2026-10-03/labels.json carry selectorsVersion null although gmail.sent 1.0.0 is recorded as paired with that folder (Decisions [2.2], [selectors]). receipts/selectors.json has no observer and no fixtures fields, unlike the other two (receipts/selectors.json:1-3, selectors.ts:80-103). selectorsVersion is a free nullable field (tests/tools/capture-output.ts:27) and no test compares it with the observers' versions, so the 1.2.0 bump went through without the labels.
   - Evidence: node over both labels.json: 16 gmail.receipt@1.0.1, 9 null (synthetic-drafts, -inbox, -sent-account-2, -sent-dst-auckland, -sent-midnight, -sent-page-1, -sent-page-2, -sent-thread, -sent-time-unresolved), 8 gcal.event@1.1.0; gcal/selectors.json:4 version 1.2.0; grep selectorsVersion under extension/tests finds only the capture tool's schema and its tests.
   - Suggested fix: Re-check the fixtures and set the labels to gcal.event@1.2.0 and gmail.sent@1.0.0 (a Gmail page may need both observers' versions). Add observer and fixtures fields to receipts/selectors.json. Add a test in tests/unit/fixtures/fixture-labels.spec.ts: each observer that reports on a fixture has its current <id>@<selectors version> in the entry, and each selectors.json fixtures folder exists and is labelled with that version.
   - Verification: **RESIZED** to LOW. Real, but mis-sized.
     
     A node read of both labels.json files gives:
     - 16 entries gmail.receipt@1.0.1
     - 9 null (synthetic-drafts, -inbox, -sent-account-2, -sent-dst-auckland, -sent-midnight, -sent-page-1, -sent-page-2, -sent-thread, -sent-time-unresolved)
     - 8 gcal.event@1.1.0, while gcal/selectors.json:4 says 1.2.0
     
     grep finds selectorsVersion only in the capture tool and its tests.
     
     Why LOW:
     - adapter_engineer rule 3 is met. Decisions.md:1246 [selectors] pairs gcal.event 1.2.0, gmail.sent 1.0.0 and gmail.receipt 1.0.1 with their folders.
     - Hard Rule 12 holds. The bench reports the version it ran (RESULTS.md gcal table: gcalSelectorsVersion 1.2.0).
     
     What is broken is label metadata against docs/adapters.md:286 and :434, and nothing checks it.

8. **TECH-7** [LOW (reviewer: MEDIUM)] The worker and the ledger import the Calendar observer, so the worker parses Calendar selectors at start-up → `extension/src/ledger/calendar-snapshots.ts:24`
   - Rule: tech_reviewer: architecture boundaries enforced by lint; TECH-V3 (no DOM code in the service worker); Hard Rule 6
   - Detail: The Calendar snapshot schema, its diff and day helpers live in src/observers/gcal (vendor-page code) and are imported by src/ledger/calendar-snapshots.ts:24, src/bus/messages.ts:39, src/background/calendar-step.ts:47-49, calendar-pass.ts:58 and calendar-seen.ts:21. snapshot.ts imports time.ts, which imports selectors.ts, which parses selectors.json with a strict schema at module load. So background.js evaluates the Calendar DOM selectors at start-up: a selectors.json that fails its schema (a slip during the 2.8 selector repair) throws during module evaluation, before main() registers the bus listener and alarms, stopping every observer and the purge, not just Calendar. No fence covers this direction: WORKER_SCOPES (fences.js:23) bans DOM globals only in the worker's own files, and src/background and src/ledger may import any src/observers module.
   - Evidence: background.js.map sources include src/observers/gcal/selectors.json, selectors.ts, time.ts, snapshot.ts, errors.ts, diff.ts; grep finds 'Google Account:', 'aria-busy' and 'data-eventid' in background.js. ESLint stdin probes through the real config: import { readCalendar } from '../observers/gcal/read' in src/background/row-codes.ts and src/ledger/clock-high-water.ts -> ALLOWED.
   - Suggested fix: Move CalendarSnapshot, RangeKey, SnapshotEvent, diffSnapshots and the day helpers to a DOM-free shared module (for example src/calendar/), taking the selectors version as a parameter instead of importing selectors.json. Add a fence: WORKER_SCOPES and src/ledger/** may not import src/observers/**.
   - Verification: **RESIZED** to LOW. Real, but mis-sized.
     
     My own wxt build of HEAD:
     - background.js.map lists gcal/selectors.json, selectors.ts, time.ts, snapshot.ts, errors.ts and diff.ts.
     - 'Google Account:' and 'aria-busy' appear in background.js.
     
     vprobe/lintprobe.mjs, through the real ESLint config:
     - Importing ../observers/gcal/read from src/background and from src/ledger: ALLOWED.
     - `document` in src/observers/gcal/time.ts: ALLOWED. The same line in src/background is REFUSED ('or code it shares').
     So the Sprint 0 TECH-V3 fence has a hole.
     
     But nothing breaks today:
     - A grep finds no DOM global in the shared modules.
     - A selectors.json that fails its schema fails every gcal unit test (the vitest environment is node), the build and the pre-push hook before it can ship.
     - The e2e runs the built worker on the Calendar fixture.
     
     LOW: coupling plus a fence hole, with no runtime defect.

9. **TECH-9** [LOW (reviewer: MEDIUM)] CHANGELOG [Unreleased] contradicts the build: no host permissions, schema v1 with eight tables → `CHANGELOG.md:9`
   - Rule: tech_reviewer: CHANGELOG updated under Unreleased; Hard Rule 8 (minimal permissions, stated); Hard Rule 12
   - Detail: CHANGELOG.md:9 still says the scaffold has no host permissions and no other line mentions hosts, while the manifest asks for mail.google.com and calendar.google.com (wxt.config.ts:48; PRIVACY.md:89 was updated). :15 says Dexie schema v1 (eight tables): now v3 with ten. :20 says retention alarm scheduling: the 90-day purge now runs. The Sprint 2 lines under Changed (:41-45) describe the observers feeding the ledger but not their addition, the permissions or the purge.
   - Evidence: grep -n -i host CHANGELOG.md -> line 9 only; built manifest.json host_permissions [https://mail.google.com/*, https://calendar.google.com/*]; db.ts STORES_V3 and LEDGER_TABLE_NAMES (10 tables).
   - Suggested fix: Under Unreleased: correct the scaffold line; add that Attest asks to read mail.google.com and calendar.google.com in tabs the user opens, the schema v3 tables (coverageIntervals, calendarSnapshots), the 90-day purge, and the three observers (Gmail Sent, eight receipt parsers, Calendar).
   - Verification: **RESIZED** to LOW. Real, but mis-sized.
     - CHANGELOG.md:9 says 'no host permissions'. The built manifest (my wxt build) has host_permissions [https://mail.google.com/*, https://calendar.google.com/*].
     - :15 'Dexie schema v1 (eight tables)' and :20 'retention alarm scheduling' are stale.
     
     Why LOW:
     - The statements users see are correct. PRIVACY.md:87-89 names both sites, and Chrome shows the manifest's hosts at install.
     - Precedent: Sprint 1's TECH-C12 (no Sprint 1 CHANGELOG entry at all) was confirmed at LOW.

10. **TECH-10** [LOW] Fence edges: extractors can reach the bus through ../base, and content-script code may use extension storage → `extension/eslint-rules/fences.js:108`
   - Rule: tech_reviewer: observers pure over the DOM, no storage or bus inside extract(), enforced by lint
   - Detail: EXTRACTOR_RESTRICTED_IMPORTS refuses direct imports of src/bus, the ledger and wxt/*, by specifier only. An extractor may import ../base (which imports src/bus/send and src/clock), and the top-level src/observers helpers every extractor imports (text.ts, account.ts, types.ts) may import src/bus and wxt/browser. ACT_RESTRICTED_IMPORTS (fences.js:94) does not list wxt/browser, so content-script code may call browser.storage.local. Nothing does any of this today.
   - Evidence: ESLint stdin probes through the real config: src/observers/gcal/health.ts with import { browserOffsetAt } from '../base' -> ALLOWED; src/observers/text.ts with import { send } from '../bus/send' -> ALLOWED; browser.storage.local.get in src/observers/text.ts and entrypoints/content/gmail.content.ts -> ALLOWED; the same files importing the ledger or src/background -> REFUSED.
   - Suggested fix: Move browserOffsetAt out of base.ts (e.g. src/observers/time-zone.ts) and refuse (^|/)base$ and (^|/)plan$ in EXTRACTOR_RESTRICTED_IMPORTS; refuse src/bus in the top-level helpers other than base.ts; ban browser.storage and chrome.storage in ACT_SCOPES with no-restricted-properties.
   - Verification: **CONFIRMED**. Reproduced with vprobe/lintprobe.mjs through the real ESLint config:
     - src/observers/gcal/health.ts importing ../base: ALLOWED.
     - src/observers/text.ts importing ../bus/send: ALLOWED.
     - browser.storage.local.get in src/observers/text.ts and in entrypoints/content/gmail.content.ts: ALLOWED.
     - A ledger import from an extractor: REFUSED.
     
     These are ordinary imports, not deliberate evasion. Nothing uses these paths today.

11. **TECH-11** [LOW] docs/adapters.md and config.ts describe the Calendar read cadence wrongly → `docs/adapters.md:540`
   - Rule: tech_reviewer: docs in sync with code (docs/adapters.md)
   - Detail: §8.3 Known limits (line 540) says Calendar passes run when the page changes and that a pass at least every minute while visible is an observer change not made yet. It was made: gcal.content.ts:67 passes heartbeatMs: OBSERVER_HEARTBEAT_MS (60 s), and docs/grading.md:86 and docs/attacks-that-work.md:14 describe it. §3.1 When a pass runs (line 78) omits the heartbeat and the read on becoming visible. config.ts:140-141 says only a tab the user has open and visible is read; that holds for the heartbeat only, since a pass triggered by a DOM change runs in a hidden tab too (base.ts:354-357 checks prerendering, not visibility). Hard Rule 11 holds; the wording does not.
   - Evidence: grep -n -i heartbeat docs/adapters.md -> no match; adapters.md:540 text quoted above; gcal.content.ts:67.
   - Suggested fix: Add the heartbeat and the on-visible read to §3.1, delete the stale clause in §8.3, and reword config.ts:136-142 to say a hidden tab is read when its page changes and when it becomes visible, never on a beat.
   - Verification: **CONFIRMED**. Confirmed.
     - `grep -i heartbeat docs/adapters.md` finds nothing.
     - adapters.md:540 still calls a per-minute pass 'an observer change, not made yet'. But gcal.content.ts:67 passes heartbeatMs: OBSERVER_HEARTBEAT_MS.
     - config.ts:140-142 says only a visible tab is read. base.ts:354-357 checks only prerendering, so a DOM change in a hidden tab still runs a pass.
     - Decisions.md:1299 repeats the same inaccurate sentence.
     
     Hard Rule 11 itself holds: the tab is open.

12. **TECH-12** [LOW] The Calendar content-script entrypoint holds business logic → `extension/entrypoints/content/gcal.content.ts:39`
   - Rule: tech_reviewer: entrypoints are thin, no business logic in *.content.ts
   - Detail: calendarScript (gcal.content.ts:39-57) decides that a known-account page posts no rows and tags each snapshot with the account hash read by the same pass (Decisions [2.7]); Hard Rules 5 and 7 rest on it. Its unit test imports the entrypoint (tests/unit/bus/calendar-script.spec.ts:9), and it reads the account a second time per pass (the skeleton reads it again in readCoverage).
   - Evidence: gcal.content.ts:39-57; calendar-script.spec.ts:9 imports calendarScript from '../../../entrypoints/content/gcal.content'.
   - Suggested fix: Move calendarScript to src/observers/gcal/script.ts (or into createGcalObserver), keep the entrypoint to wiring, and test the module.
   - Verification: **CONFIRMED**. Confirmed.
     - gcal.content.ts:39-57 decides whether a pass posts rows, and tags each snapshot with the account hash.
     - tests/unit/bus/calendar-script.spec.ts:9 imports calendarScript from the entrypoint.
     - The account is read in the wrapper (gcal.content.ts:45) and again by readCoverage (observers/coverage.ts:155).

13. **TECH-13** [LOW] Vestigial code paths: the observer's previous-snapshot option, a bench that scores the pure diff, an index nothing reads → `extension/src/observers/gcal/observer.ts:45`
   - Rule: tech_reviewer: dead code; Hard Rule 12 (a number says what it measures)
   - Detail: Production builds the Calendar observer with previous: () => null (gcal.content.ts:65) and the worker derives every row (calendar-step.ts). GcalObserverOptions.previous (observer.ts:45), PreviousSnapshot (extract.ts:33), previousSnapshot() and the baseline continuation (pass.ts:29-36, 102-107) and GcalObserver.range (observer.ts:50, 83) serve only tests and the bench. bench/observers/gcal.ts:10-11 says it scores the change rows the observer emits, but the observer emits none in production; gcalDiffsExact 6/6 (RESULTS.md:62) measures diffSnapshots alone, not the shipped calendarStep (a deletion only after two complete snapshots, late changes as first sightings); the E2E covers that pipeline. The v1 *counterpartyTokens index (db.ts:45; index-fields.ts:106, 136) is computed on every observation write and read only by observationsByCounterpartyToken (repo.ts:164), which only tests call (Decisions [2.6]). retention.ts:61 re-exports RETENTION_DAYS for one test.
   - Evidence: grep 'previous:' in src and entrypoints -> only gcal.content.ts:65 (() => null); grep observationsByCounterpartyToken -> repo.ts plus two test files; bench/observers/gcal.ts:133-147 calls diffSnapshots(previous, snapshot).changes.
   - Suggested fix: Drop the previous option (the observer always compares with nothing; snapshot baselineAt = readAt) or mark it test-only; rename the bench metric to a pure-diff name or score calendarStep over the labelled sequences; drop or rederive the token index in a schema v4; import RETENTION_DAYS from config in the test.
   - Verification: **CONFIRMED**. Confirmed.
     - `grep 'previous:'` in src and entrypoints finds only gcal.content.ts:65 ('() => null').
     - GcalObserver.range (observer.ts:83) has no caller in src or entrypoints.
     - observationsByCounterpartyToken is called only from two test files.
     - bench/observers/gcal.ts:135 scores diffSnapshots(previous, snapshot).changes, not calendarStep.
     - retention.ts:61 re-exports RETENTION_DAYS only for retention.spec.ts:212.
     
     In production the snapshot hook still computes diffSnapshots(null, snapshot) on every pass and discards it (extract.ts:46-53).

14. **TECH-14** [LOW] Small duplicates and vendor strings outside selectors.json → `extension/src/observers/gmail/receipts/extract.ts:23`
   - Rule: tech_reviewer: no duplicated logic; selectors live in selectors.json (adapter_engineer rule 3); no hardcoded hosts
   - Detail: ELEMENT_NODE, TEXT_NODE and isElement are defined in receipts/message.ts:86-92 and gcal/page.ts:44-49. MS_PER_MINUTE is redefined in gcal/time.ts:30 (core/units.ts:8). The day after a date is computed three ways: gcal/time.ts:73-76 nextDay, calendar-pass.ts:73-77 dayAfter (Date.UTC over a split string), core normalize-time civilDateAt. The Gmail fragment is parsed twice: gmail/route.ts:25-36 and receipts/message.ts:63-68. Gmail's '(no subject)' is a code literal in receipts/extract.ts:23 but a versioned value in gmail/selectors.json:37. The receipt reader hard-codes the date and account attributes and the account regex (message.ts:72-73, 149, 162), which gmail.sent keeps in selectors.json. gmail/selectors.json:7 repeats the host mail.google.com that config.ts:38 OBSERVER_HOSTS owns.
   - Evidence: Code read at the cited lines.
   - Suggested fix: Share the node helpers, units and day arithmetic (nextDay over dayFromIso in calendar-pass.ts); move '(no subject)' and the receipt attributes into receipts/selectors.json (bump to 1.0.2 and record it in Decisions); derive the Gmail route host from OBSERVER_HOSTS.
   - Verification: **CONFIRMED**. Each duplicate is at the cited lines:
     - ELEMENT_NODE, TEXT_NODE and isElement: receipts/message.ts:86-92 and gcal/page.ts:44-49.
     - MS_PER_MINUTE: gcal/time.ts:30 and core/units.ts:8.
     - The day after a date: nextDay (gcal/time.ts:73-76) and dayAfter (calendar-pass.ts:73-77).
     - Fragment parsing: route.ts:25-36 and message.ts:63-68.
     - The '(no subject)' literal: receipts/extract.ts:23.
     - The host 'mail.google.com': gmail/selectors.json:7.
     
     The grep for URL literals in TypeScript finds hosts only in config.ts.

15. **TECH-15** [LOW] Six property suites added under tests/unit → `extension/tests/unit/ledger/coverage.property.spec.ts:1`
   - Rule: tech_reviewer: tests follow the build_spec §6 layout
   - Detail: tests/unit/ledger/coverage.property.spec.ts, coverage-calendar.property.spec.ts, coverage-closure.property.spec.ts, coverage-many.property.spec.ts, retention.property.spec.ts and tests/unit/observers/gcal/diff-property.spec.ts are fast-check properties under tests/unit, while the other Sprint 2 properties sit in tests/property. tests/unit/test-layout.spec.ts checks file names only.
   - Evidence: find extension/tests -name '*property*' -not -path '*/tests/property/*' -> the six files.
   - Suggested fix: Move them to tests/property/ledger/ and tests/property/observers/ (VITEST_INCLUDE already covers both) and add a layout check that *.property.spec.ts lives under tests/property.
   - Verification: **CONFIRMED**. Confirmed. find lists the six *property* suites outside tests/property, added in commits 3b6b7d3, 58108b9 and 58ccd0b.
     
     Precedent: Decisions.md:579 and :778 accepted fast-check tests in tests/unit for specific files. So this is mainly a naming and placement nit.
     
     One extra effect: CI's test:tz (extension/package.json:25) runs only tests/unit/core, tests/property and tests/golden. These six suites skip the time-zone runs. Today that code has no zone-dependent call (the only one is base.ts:93 getTimezoneOffset, by design).

16. **TECH-16** [LOW] Decisions.md: stale entries not superseded, requests never closed, two constants unrecorded → `Decisions.md:1234`
   - Rule: tech_reviewer: Decisions.md has an entry for every unspecified choice
   - Detail: [2.9] (lines 1234, 1243) says Calendar rows, the snapshot record and the windows are separate writes and the atomicity gap stays documented in §3.6; [2.7-D2] (line 1262) made one transaction (first-look.ts:99-106 inCalendarPass) without marking them superseded. [2.6] (line 1066) says RETENTION_DAYS is defined in retention.ts for now and a move is requested; it moved to config.ts:106 with no entry. [2.0] (line 1013) revisit in 2.7 and [2.5-verify] (line 1147) shared shown.ts request are never closed. REFUSED_KEPT = 32 (observer-state.ts:25) and MAX_LABEL = 20,000 (label.ts:46) have no entry.
   - Evidence: grep of the quoted phrases in Decisions.md at the cited lines; config.ts:106; first-look.ts:99-106.
   - Suggested fix: Append dated entries that supersede the two [2.9] lines, record the RETENTION_DAYS move, close (or accept with a reason) the re-post and shown.ts requests, and record the two constants with their reasons.
   - Verification: **CONFIRMED**. Confirmed.
     - Decisions.md:1234 and :1243 still describe separate Calendar writes. Decisions.md:1262 made one transaction without marking them superseded. docs/adapters.md:134 is already up to date.
     - No entry closes Decisions.md:1013 (re-post, 'revisit in 2.7').
     - No entry closes Decisions.md:1066 (moving RETENTION_DAYS, now done in config.ts).
     - No entry closes Decisions.md:1147 (shared shown.ts).
     - REFUSED_KEPT = 32 (observer-state.ts:25) and MAX_LABEL = 20_000 (label.ts:46) appear in no Decisions or docs line.

17. **TECH-17** [LOW] Content scripts weigh 65-70 KB gzipped, 38-41% zod including JSON-schema code never called → `extension/wxt.config.ts:58`
   - Rule: tech_reviewer: bundle size per entrypoint, flag anything that would slow a Gmail tab
   - Detail: gmail.js is 235,834 B (69,982 B gzipped) and gcal.js 221,193 B (65,304 B), injected into every Gmail and Calendar tab at document_idle. zod classic is 90.5 KB of each (38-41%); its classic schemas.js imports json-schema-processors.js and to-json-schema.js (about 17.5 KB) for methods Attest never calls. The Unicode baseline tables add 49.8 KB (needed by core normalisation). At start each script builds every Zod schema and parses the shipped policy. Nothing records or budgets these sizes (Sprint 0 TECH-16 was refuted before any content script existed).
   - Evidence: wxt build of git archive HEAD in scratch; sizes with zlib level 9; source-map attribution (attrib.cjs); zod/v4/classic/schemas.js lines 3 and 5 import the JSON-schema modules. Evaluating the built scripts in fresh happy-dom windows took 38-196 ms (gmail) and 29-255 ms (gcal) over 5 runs, first runs including compile; not a Chrome number.
   - Suggested fix: Add a bundle-size bench with a budget per content script (for example 80 KB gzipped) so growth is visible; try zod/mini for the schemas content scripts build, or confirm tree-shaking; have live smoke (2.8) record script evaluation time in Chrome's Performance panel.
   - Verification: **CONFIRMED**. Reproduced with my own wxt build of HEAD:
     - gmail.js: 235,834 B (69,583 with gzip -9)
     - gcal.js: 221,193 B (64,918)
     - background.js: 231,151 B (71,542)
     
     Real Chromium (vprobe/chrome-eval-run.mjs): running each built content script takes 24-28 ms on a fresh page (41 ms on gcal's first run), compile time not counted. That is a one-time cost per tab load, and no size budget exists. LOW.

### TESTS WRITTEN

- None in the repository (read-only role). Scratch probes, not committed, under scratchpad/s2rev/tech/:
- probe.mjs: ESLint --stdin fence probes through extension/eslint.config.js (existing file names as stdin paths)
- passprobe.mts: per-pass DOM work (getComputedStyle and querySelectorAll counts, ms/pass) of the production observers over the synthetic Gmail, receipt and Calendar fixtures
- build/extension/probe/coverage-rows.mts: rows read by recordCoverage and coverageFor as first-look markers accumulate (fake-indexeddb, Dexie reading hook)
- build/extension/probe/coverage-probe.mts: the same calls timed under fake-indexeddb (0, 500, 2,000 markers)
- logprobe.mts: what src/log.ts prints for PolicyError, GcalError, CalendarRowRefused and LedgerError
- sizes.mjs, attrib.cjs, evalcs.cjs: per-entrypoint gzip sizes, source-map byte attribution, and happy-dom evaluation time of the built content scripts

### ADVERSARIAL VERIFICATION

I re-ran the evidence for all 17 gaps myself. I worked in a scratch copy of HEAD 1e54fd9 (git archive, node_modules linked) and changed nothing in the shared tree. The untracked files now in the tree belong to other reviewers.

**No gap is refuted.** All 17 are real.
- **Kept at MEDIUM (5):** TECH-1, TECH-2, TECH-5, TECH-6, TECH-8.
- **Resized from MEDIUM to LOW (4):** TECH-3, TECH-4, TECH-7, TECH-9.
- **The eight LOWs stand.**

**Real-Chromium numbers change how big the cost gaps are.**
- The review timed things in fake-indexeddb and happy-dom. Those tools overstated time by 8 to 165 times.
- TECH-1 holds, and is worse than written. coverageForMany re-reads every future-dated Calendar interval for each claim. With 50 calendar claims and 2,000 future markers it read 102,052 rows and took 2.8 s in real Chromium.
- TECH-2's structure is right, but two counts are off:
  - a Gmail Sent pass opens N+7 readwrite transactions, not N+5;
  - pageBusy runs 3 times per pass in production, not 4.
- On the synthetic fixtures a pass costs only 0.8 to 3.1 ms in Chrome. Live smoke must measure real pages.
- TECH-6's failure direction is backwards. The real risk is the other way round, and no test ties the two equality functions together.

**Why the four were resized:**
- **TECH-3:** only two error classes can reach the logger, both on bug paths, and the failure is still logged at error level.
- **TECH-4:** the Decisions.md pairing of version and folder is done; only label metadata is stale.
- **TECH-7:** the shared modules use no DOM today, and the tests catch a broken selectors file.
- **TECH-9:** PRIVACY.md and the manifest state the permissions correctly, and Sprint 1 sized a CHANGELOG gap as LOW.

**No new gap from this role's checklist survived my checks.**
- ESLint over src, entrypoints, tests, bench and scripts (624 files) reports 0 problems.
- All five TypeScript projects typecheck clean.
- The built bundles contain no network call.

**One checklist status is wrong.** The "no toArray() on unbounded tables" item is marked N/A, but the clock-guard repair reads the whole observations table.

All probes are in scratchpad/s2rev/tech-verifier/tree/extension/vprobe/.

Checklist corrections:

- 'Ledger reads paginated in UI; no toArray() on unbounded tables' should be GAP (LOW), not N/A. clock-guard.ts:106 reads db.observations.toArray(), an unbounded table. clock-guard.ts:93-95 scans coverageIntervals with an unindexed .filter(). Both run inside the repair's five-table readwrite transaction. The path is rare (the clock went back), and TECH-1 already names it.
- 'selectors.json versioning and fixture-folder pairing': the Decisions.md half of adapter_engineer rule 3 passes. Decisions.md:1246 [selectors] pairs gcal.event 1.2.0, gmail.sent 1.0.0 and gmail.receipt 1.0.1 with their folders. Only the labels' selectorsVersion, and the missing check on it, fail (TECH-4, now LOW).
- 'Errors are typed, carry context, never swallowed' stays GAP, at LOW. Only PolicyError and GcalError can reach src/log.ts, both on worker bug paths. CalendarRowRefused, ReceiptError and ObserverError never pass through the logger (TECH-3).
- 'Functions <= 60 lines; files <= 400 lines' PASS also holds beyond the shipped files. npx eslint src entrypoints tests (606 files) and the root config over bench and scripts (18 files) report 0 problems. All four extension tsc projects and the root tsc exit 0.
- 'Tests follow the build_spec §6 layout' (GAP, TECH-15): also note that the six misplaced property suites miss CI's test:tz run (extension/package.json:25).
- 'Docs in sync with code' (GAP): also note that Decisions.md:1299 repeats the inaccurate claim that only a visible tab is read (TECH-11).

### COMMANDS RUN

- `git log --oneline 60bca2d..1e54fd9; git diff --stat 60bca2d..1e54fd9` → 15 commits, 342 files, +37,913/-721: Scope of the review; Decisions.md diff (297 added lines) read in full.
- `cd extension && npx eslint src entrypoints --max-warnings 0 -f json` → exit 0: 184 files, 0 errors, 0 warnings: Size limits, any, as unknown as, non-null, act/network/ledger/core fences all clean.
- `npx eslint --print-config <8 files>` → Fence lists per scope: src/observers/*.ts get ACT patterns only (no bus ban); src/observers/<vendor>/* add the bus and wxt bans; src/background and src/ledger have no ban on src/observers.
- `node scratch/probe.mjs <existing file> <code> (ESLint --stdin)` → Refused: ledger/background imports from observers and content scripts, bus import from an extractor, indexedDB, .click(). Allowed: extractor importing ../base, src/observers/text.ts importing ../bus/send, browser.storage.local in observers and content scripts, src/background and src/ledger importing src/observers/gcal/read: Evidence for TECH-7 and TECH-10.
- `git archive HEAD extension policy package.json tsconfig.json | tar -x -C scratch/build; npx wxt prepare; npx wxt build` → Built in 1.6 s; manifest host_permissions are exactly mail.google.com and calendar.google.com: Clean build of committed HEAD in scratch with node_modules symlinked.
- `node scratch/sizes.mjs; node scratch/attrib.cjs <bundle>` → popup 15,341 B gzip; options 42,262; sidepanel 15,282; background 71,807; gcal.js 65,304; gmail.js 69,982. zod 38-41% of content scripts, Unicode tables 21-22.5%, dexie 41% of the worker: Per-entrypoint table; TECH-17. background.js.map lists src/observers/gcal selectors.json, selectors.ts, time.ts, snapshot.ts, errors.ts, diff.ts (TECH-7).
- `grep fetch(|XMLHttpRequest|WebSocket|sendBeacon|postMessage|dispatchEvent|.click(|localStorage|Function( on built bundles` → 0 network calls; 1 guarded postMessage (WXT handshake, noScriptStartedPostMessage), 1 Function( (zod jitless probe), dispatchEvent only in WXT's context code: No Hard Rule 1 or 3 finding in shipped code.
- `node scratch/evalcs.cjs content-scripts/{gmail,gcal}.js (happy-dom, 5 fresh windows)` → gmail 38-196 ms, gcal 29-255 ms: Not a Chrome number; flagged for live smoke (TECH-17).
- `cd extension && npx tsx scratch/passprobe.mts` → gmail.sent 12.5 ms/pass, 92 getComputedStyle, 4 page reads; receipt 2.6 ms, readPage x4; gcal week 23.8 ms, 409 getComputedStyle, role=main x8; gcal month 38.4 ms, 585 getComputedStyle: Evidence for TECH-2.
- `cd scratch/build/extension && npx tsx probe/coverage-probe.mts (background, stopped after three sizes)` → 0 markers 2.3/4.9 ms; 500 markers 1,299/2,315 ms; 2,000 markers 17,045/27,642 ms (recordCoverage/coverageFor, fake-indexeddb): Timing growth; the 5,000-marker case was stopped (pkill). No job left running.
- `cd scratch/build/extension && npx tsx probe/coverage-rows.mts` → rows read per recordCoverage(gcal week): 0/50/200/200; per coverageFor: 2/97/380/580: Deterministic evidence for TECH-1.
- `cd extension && npx tsx scratch/logprobe.mts` → PolicyError(policy_not_loaded) -> Error messageLength=25; GcalError(range_mismatch) -> Error messageLength=20: Evidence for TECH-3.
- `npx eslint src/background src/ledger src/observers entrypoints/content --rule complexity:8, max-depth:3, max-params:5` → 16 hits: background max 9, ledger none over 8 (one max-depth 4 at retention.ts:201), gcal readEvent 17: Complexity hot-spot check; no gap filed.
- `node over tests/fixtures/pages/{gmail,gcal}/2026-10-03/labels.json selectorsVersion` → 16 gmail.receipt@1.0.1, 9 null, 8 gcal.event@1.1.0 (selectors at 1.2.0): Evidence for TECH-4.
- `npx tsx scripts/check-docs.ts` → check-docs: OK (6 files, 337 links, 17 allowlisted fields checked): 2.9 Done-when holds; stale semantic text (TECH-11, TECH-9) is outside what it checks.
- `cd extension && npx vitest run tests/unit/fixtures/fixture-labels.spec.ts tests/unit/background/calendar-seen.spec.ts tests/unit/observers/heartbeat.spec.ts --testTimeout=120000` → 3 files, 43 tests passed: Confirms the existing tests pass yet do not check label versions (TECH-4) or tie sameState to the diff (TECH-6).

