# Sprint 3 — Tech

Role: agents/tech_reviewer.md (read-only). Range: `19697ef..8ab40c9` (`git diff 19697ef HEAD`): 25 commits, 175 files, +10,152 / −497. Tasks done this sprint: 3.2 and 3.10 to 3.17. The rest are BLOCKED(MANUAL) and are not gaps. Two things were decided and are not gaps either: the agent readers stay off under the vendors' terms (Decisions [3.10]), and claims come from a pasted log (Decisions [3.11]).

**What I ran on the shared tree:** `pnpm lint` and `pnpm typecheck`, both exit 0. Lint covers ESLint on the extension and the root, Prettier, and check-docs (OK: 7 files, 423 links).

**What I ran on `git archive` copies** in the scratchpad (`scratchpad/tech3/`):
- `wxt build` of HEAD and of 19697ef;
- a byte attribution from the source maps;
- ESLint `--stdin` probes against the real config;
- five Vitest probes (A to E) over fake-indexeddb.

I did not run `pnpm test`, `pnpm e2e`, `pnpm bench` or coverage, and I wrote nothing in the repository but this file.

**Correction to the brief.** A batch does not run after each observer pass. It runs after each import (`claims-import.ts:77`) and on the 5-minute grace alarm (`alarms.ts:45-47`, `config.ts:107`). Decisions [3.13] chose this: "A batch is not run after each observer pass: the alarm regrades within 5 minutes." The header at `grading.ts:3-4` still says otherwise (TECH-5).

## Summary

**What passes:**
- **src/core purity.** It is enforced by lint, not by eye. `eslint.config.js:291-306` applies:
  - `CORE_RESTRICTED_IMPORTS`, including an allowlist that admits only `./name`, `zod` and the shipped policy (`eslint-rules/core-fences.js:26-27`);
  - the restricted globals;
  - `attest/core-determinism` and `attest/core-globals`.

  An ESLint stdin probe linted as `src/core/batch-store.ts` was refused 16 times: `dexie`, `../log`, `../ledger/repo`, `../adapters/paste`, `../clock`, `Date.now()`, `Math.random()`, `new Date()` and `chrome`. The four new core files lint clean: batch-store, policy-document, normalize-names and normalize-upcoming.
- **The paste parser's fences.** A probe as `src/adapters/paste.ts` was refused `../bus/send`, `wxt/browser`, `../ledger/repo` and `.click()`.
- **Size and type rules.** Lint enforces them: no `any`, no `as unknown as`, no `!`, functions ≤ 60 lines, files ≤ 400 lines.
- **`claims.import`.** It is a Zod schema on both ends:
  - `send()` parses it (`send.ts:65-66`);
  - `listen()` parses it and accepts it from extension pages only (`listen.ts:78-81`, `:181`);
  - its reply has its own schema, checked before it leaves (`listen.ts:134`).
- **Thin entrypoints.** `background.ts` registers listeners and calls modules, and the router maps `claims.import` to `onClaimsImport` in one line.
- **Policy values.** Policy windows come from the policy: `orphanHorizonMs` (`grading.ts:91-94`) and the attribution reach (`:145-146`).
- **Ids and data.** Ids are hashes. Timestamps carry offsets. Money is minor units plus a currency.
- **Bundles.** The popup is 16.4 KB gzipped, and the content scripts grew 0.7 KB each.
- **Decisions.** Entries [3.0] to [3.17] are thorough.

**Gaps (9): 1 HIGH, 3 MEDIUM, 5 LOW.**

- **TECH-1 (HIGH):** every receipt's replay record holds a full copy of its batch's coverage.
  - Measured: 1.1 KB per row with no Calendar markers, 16.6 KB with 50, 62 KB with 200.
  - Every 5-minute batch rewrites each PENDING receipt's copy.
  - The export travels as one runtime message, so it crosses Chromium's 64 MiB message cap at about 1,000 receipts on a 200-marker calendar.
- **TECH-2 (MEDIUM):** each batch reads and Zod-parses the whole `claims` and `receipts` tables, and hands every claim to grading.
  - It runs every 5 minutes whether or not anything changed.
  - The `receipts.state` index exists and is unused.
  - No perf gate covers it.
- **TECH-3 (MEDIUM):** the new UI catch sites drop errors without a log.
  - A valid 87,445-character paste passes the parser, then is refused at send.
  - The person then sees "Try again" forever, with no trace (probe D).
- **TECH-4 (MEDIUM):** the docs that define the ledger and the grading inputs miss the paste path:
  - two meta keys;
  - the default grants;
  - what counts as the agent's adapter sync;
  - README's "grades nothing";
  - three stale CHANGELOG lines.
- **TECH-5 (LOW):** three code comments and three doc sentences contradict the code.
- **TECH-6 (LOW):** duplicated logic:
  - the address regex;
  - the day names;
  - the `import.<agent>` id;
  - the paste times read twice;
  - a dead batch coverage reader;
  - two unit literals;
  - a meta key outside the ledger.
- **TECH-7 (LOW):** the activity writer throws a raw ZodError where every other ledger writer throws `LedgerError('invalid_input')`.
- **TECH-8 (LOW):** a grace-alarm batch writes receipts and announces nothing.
- **TECH-9 (LOW):** the batch keeps the newest 10,000 claims for spend and attribution, with no Decisions entry and no log.

**What grows under 90-day retention** (the brief's question):

| Store | Grows with | Read or written per batch | At 90 days |
|---|---|---|---|
| `claims` | every pasted claim (`RETENTION_DAYS`, `config.ts:154`) | read whole and Zod-parsed (TECH-2) | 900 rows at 10 claims a day; 5,000 at 55 |
| `receipts` | one per claim, plus UNASKED and OVER_SCOPE | read whole and parsed; every PENDING row rewritten | about as many as claims |
| `receiptInputs` | one per kept receipt, each a copy of its batch's coverage | one row written per PENDING receipt, one deleted | 900 receipts: 1 MB (no markers), 15 MB (50), 56 MB (200). 5,000 receipts: 5.5, 83 and 310 MB |
| `activity` | one session per agent and minute a paste names; one interval per time away | indexed range (`endMs`) | bounded per batch |
| export | all of the above, as one `ui.result` reply | none | past 64 MiB at about 1,000 receipts (200 markers) or about 4,000 (50) |

## Bundle size per entrypoint

**Method:**
- Each tree was built with `wxt build` in its own `git archive` copy: HEAD `8ab40c9` and the Sprint 2 close `19697ef`. Both copies use today's node_modules. The 19697ef lockfile differs only in dev dependencies.
- An HTML entrypoint counts its page plus every script it loads, transitively, plus its stylesheet. The worker and the content scripts count their own transitive imports.
- Gzip is zlib level 9, summed over files. Source maps are excluded.

| Entrypoint | 19697ef raw (B) | 19697ef gzip (B) | HEAD raw (B) | HEAD gzip (B) | Δ gzip |
|---|---|---|---|---|---|
| popup | 47,124 | 16,071 | 48,772 | 16,368 | +297 (budget 150 KB: pass) |
| sidepanel | 47,040 | 16,013 | 252,931 | 78,079 | +62,066 (×4.9) |
| options | 314,800 | 96,963 | 344,983 | 107,848 | +10,885 |
| background.js (worker) | 325,319 | 99,977 | 421,985 | 131,471 | +31,494 |
| content-scripts/gmail.js | 230,054 | 67,916 | 232,147 | 68,665 | +749 |
| content-scripts/gcal.js | 214,244 | 62,872 | 216,332 | 63,594 | +722 |

**Byte attribution of HEAD,** from the source maps (raw bytes):
- **Side panel chunk** (27,375 B):
  - pattern tables 7,878;
  - panel components 6,437;
  - patterns 3,863;
  - claims 3,589;
  - paste 2,662;
  - labels 1,940.
- **Shared `send` chunk** (173,017 B; side panel, options and worker):
  - zod 65,824;
  - Unicode tables 49,815;
  - core schema, normalize and hash about 45,000;
  - bus 4,600.
- **Shared `export` chunk** (108,700 B; options and worker): Dexie 95,132.

The side panel now parses pastes itself, by design (`docs/claims-import.md` §2), so it carries zod, the Unicode tables and core's normalisers. That is no gap; the side panel has no budget. The worker grew because the grading core ships in it since 3.13.

## Measurements

All probes run under Node on fake-indexeddb, in a scratch copy. They are not Chrome numbers. The growth is the point.

**Probe B: one `receiptInputs` row as Calendar first-look markers grow.** The §2 demo is stored as the worker stores it (`tests/unit/background/demo-store.ts`). M first-look markers are added inside the demo week. One batch then runs at 14:20 and grades the two claims.

| Markers in the week | Coverage entries in each row | Bytes per row |
|---|---|---|
| 0 | 2 | 1,097 |
| 50 | 51 | 16,630 |
| 200 | 194 | 61,961 |

Both rows of that batch hold the identical coverage.

**Probe A: the steady-state batch over N claims.** The ledger holds N `email.sent` claims spread over 90 days, with no coverage. Batch 1 grades them all. Batches 2 and 3 are 5 and 10 minutes later and are the steady state: only the last day's PENDING receipts are regraded.

| Claims = receipts | Batch 2, batch 3 (ms) | Read and parse receipts / claims (ms) | `receiptInputs` rows (B) | Export (B) |
|---|---|---|---|---|
| 500 | 88, 70 | 19 / 14 | 500 (285,000) | 756,916 |
| 2,000 | 297, 292 | 46 / 31 | 2,000 (1,140,000) | 3,011,776 |
| 5,000 | 1,522, 1,403 | 120 / 79 | 5,000 (2,850,000) | 7,522,536 |

**Probe C: the steps of a steady-state batch at 5,000 claims,** replicated from `gradeInside` with timers, inside the batch transaction. The batch regrades 52 to 53 PENDING claims and reads 10,000 rows to do it:

| Step | ms |
|---|---|
| `receipts.toArray()` | 55–65 |
| Zod parse of the receipts | 83–130 |
| `claims.toArray()` | 35–36 |
| Zod parse of the claims | 49–65 |
| `gradeBatch` | 46–88 |
| claimsToGrade, coverage, activity sorts, preAssignments, storeBatch and supersede, together | under 70 |

Rewriting the 52 to 53 PENDING receipts dominated the rest of the batch under fake-indexeddb. That part is not a Chrome number.

**Probe D: a paste the parser accepts but `claims.import` refuses.** Eight day headings ("Oct 1" to "Oct 8"), each followed by every minute of the day as an entry. The result:
- 87,445 characters, under the 100,000 limit;
- 1 claim;
- 11,520 timed minutes.

`readPastedLog` returns `ok: true`. `ClaimsImportMessage.safeParse` then fails, because `activeAt` holds at most `GRADING_INPUT` = 10,000 instants (`messages.ts:231`).

**Probe E: the side panel's parse time.** `readPastedLog`, median of 3, on a realistic log of title, summary and time lines:
- 10,000 characters: 154 ms;
- 50,000 characters: 399 ms;
- 100,000 characters: 648 ms (1,210 entries).

It runs on the panel's main thread when the person clicks Preview. It is bounded by `MAX_PASTE_CHARS`, so this is no gap; the preview could show a busy state.

## Checklist

| Item | Status | Evidence |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint rule) | PASS | `eslint.config.js:291-306`: CORE_RESTRICTED_IMPORTS with the allowlist (`core-fences.js:26-27`), the impure-layer regex (`:62`) and the log regex (`:66`); the restricted globals (`:78`); core-determinism and core-globals. The stdin probe was refused for every banned import, clock and randomness read, and `chrome`. `pnpm lint` exit 0. |
| Entrypoints are thin | PASS | `background.ts:18-44`: listeners only, the idle wiring included. `router.ts:83`: `claims.import` → `onClaimsImport`. The side panel's flow (`use-paste-flow.ts`) is UI state, as `entrypoints/sidepanel/` allows. |
| Adapters and observers pure over Document; no storage or bus in extract() | PASS | `paste.ts` is in HELPER_SCOPES (`fences.js:24`), and the probe was refused bus, `wxt/browser`, ledger and `.click()`. Muse `extract.ts` and `health.ts` only read. |
| Cross-context messages typed in src/bus and Zod-validated | PASS | `ClaimsImportMessage` and `ClaimsImportResult` (`messages.ts:225-253`) are parsed by `send()` and `listen()`, and the reply is checked (`listen.ts:134`). The type is page-only (`listen.ts:78-81`). `adapter.scope` has a schema and no handler: 3.7 is blocked. |
| Policy values from policy/default.json | PASS | The orphan horizon and the attribution reach derive from `policy.windows` and `unasked.windows` (`grading.ts:91-94`, `:145-146`). Plumbing constants are in `config.ts` with Decisions entries: 5 min and 1 min [3.13]; 60 s [3.14]. Pattern confidences live in `patterns.json`. |
| No `any`, no `as unknown as`, no unexplained `!` | PASS | Lint rules are on and clean. |
| No hardcoded hosts, ids or URLs | PASS | AGENT_HOSTS, AGENT_READERS and ADAPTER_SITES (`config.ts:47`, `:62`, `:194`); the Muse adapter's hosts come from config. `wxt.config.ts:117` spells `'idle'` beside IDLE_PERMISSION, pinned by `manifest-hosts.spec.ts:43` and `built-bundle.spec.ts:67`. |
| No duplicate selector logic; shared helpers in base | PASS (LOW gap) | Selectors: Muse is the only adapter, and its skeleton reuses the observers' `startPasses` and `checkHealth`. Other duplicates: TECH-6. |
| No TODO or FIXME | PASS | None added in the range. |
| Errors typed, carry context, never swallowed | GAP | TECH-3 and TECH-7. AdapterError has closed codes and is registered for the logger (`log-vocabulary.ts:283`). |
| Functions ≤ 60 lines, files ≤ 400 lines | PASS | Lint SIZE_RULES. Four touched files sit at the cap: schema.ts 400 (reached by folding a comment, `schema.ts:54-55`), coverage.ts 399 (`coverage-batch.ts` exists because it was full), observers/base.ts 395 and observer-messages.ts 391. The next change to any of them must split it. |
| Naming | PASS | New files are kebab-case and components PascalCase; constants are UPPER_SNAKE. |
| No clock, randomness or model in src/core | PASS | Lint and the stdin probe. |
| Ids from hashes where idempotency matters | PASS | Activity ids are `sha256(canonicalJson({kind, agent, ms}))` (`activity.ts:26`, `:44`, `:57`). A clock repair is keyed by its `from` ms (`clock-repairs.ts:47-49`). Claims come from `rawHash`. Receipts are keyed per subject. |
| Timestamps ISO with offset; money in cents plus currency | PASS | `isoWithLocalOffset` is used at `grading.ts:209`, `claims-import.ts:68`, `idle.ts:29` and `clock-guard.ts`. Claims carry `amountCents` plus `currency` (`claims.ts:171-177`). The preview formats minor units by currency (`paste-labels.ts:38-49`). |
| Dexie indexes for every query; no full scans in hot paths | GAP | TECH-2: `grading.ts:168-169` reads both tables whole, and `receipts.state` (`db.ts:52`, `:80`) is unused. Indexed reads: activity by `endMs` (`activity.ts:81-84`), `receiptInputs` by `policyHash` (`replay-records.ts:91`), meta by key prefix (`clock-repairs.ts:64`). `forgetIdle` (`activity.ts:100`) filters every row, but only when the person turns away detection off. |
| Ledger reads paginated in UI; no toArray on unbounded tables | GAP | There is no ledger UI yet. The batch's `toArray` on unbounded tables is TECH-2. The export is a deliberate full dump, but its size is TECH-1. |
| Content scripts debounce DOM observation | PASS | Unchanged: `startPasses` (`observers/base.ts:325`) keeps one batched watcher for observers and adapters. |
| Service worker does no work on onStartup beyond alarms | PASS | `background.ts:24-28`: `ensureAlarms` only. The grade alarm is recreated 1 min after start (`alarms.ts:85-95`). TECH-2 covers what that alarm costs. |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | PASS | Table above: the popup is 16,368 B. |
| New messages, tables, fields and grades documented | GAP | TECH-4 and TECH-5. Documented: `claims.import` and `adapter.scope` (`adapters.md:578`, `:585`); `activity`, `receiptInputs` and `policies` (`privacy-architecture.md` §5.11–5.13); `coverage.clock_repaired` and `Coverage.repairs` (`grading.md:110`, `:185`, `:516`, `:538`). |
| Decisions.md entry for every unspecified choice | GAP | TECH-9. Otherwise [3.0] to [3.17] cover the limits, alarm periods, idle detection, schema v5 and v6, and the 3.15 rules. |
| CHANGELOG updated under Unreleased | GAP | Sprint 3 entries exist (`CHANGELOG.md:45-54`), but `:15`, `:22` and `:31` contradict them (TECH-4). |
| Tests follow the build_spec §6 layout | PASS | New suites are under `tests/unit/{adapters,background,ledger,sidepanel,options,ui}`, `tests/e2e/demo-paste.spec.ts`, `tests/fixtures/pages/muse/2026-10-08/`, `tests/fixtures/patterns/` and golden 114. The property cases inside `paste.spec.ts:343`, `:382` and `normalize-upcoming.spec.ts:73` follow the repo's practice: 20 unit files use fast-check, and `property-layout.spec.ts` polices file names. The new hot path has no perf gate (TECH-2). |
| Telemetry-api | N/A | Not touched. |

## Gaps

### TECH-1 (HIGH): every receipt's replay record holds a full copy of its batch's coverage

**Rules.** Dexie storage stays bounded in the hot path, and an export is deliverable. Hard Rule 4 rests on these records.

**What happens.**
- `storeBatch` gives every receipt it writes its own inputs, the whole batch coverage included (`src/core/batch-store.ts:46-52`):

  ```ts
  inputs.set(receipt.inputsHash, { coverage, ...own });
  ```

- The worker stores one `receiptInputs` row per entry (`grading.ts:191`).
- The row's schema allows `Coverage.observers` up to `GRADING_INPUT` = 10,000 entries (`ledger/types.ts`, `ReceiptInputs`).
- A batch's coverage is every entry overlapping any graded claim's window, plus the 24.5-hour orphan horizon for all nine types. For Calendar that is closed under overlap, so a week or month view pulls in every first-look marker inside it (grading.md §3 v1.9, v1.10).
- So every receipt of a batch stores the same coverage again: probe B shows two rows of 61,961 B each at 200 markers.
- A FINAL receipt keeps its row for 90 days. A PENDING one has its row rewritten by every batch, because `computedAt` and so `inputsHash` change (`batch-store.ts:50-52`; probe C: 53 rewrites per batch).

**Why it matters.**
- **Storage.** Under 90-day retention, rows = kept receipts. At 62 KB per row (200 markers), 900 receipts take 56 MB and 5,000 take 310 MB. At 50 markers, 15 and 83 MB. Nearly all of it is identical copies.
- **Churn.** Ten PENDING receipts at 62 KB, over 288 batches a day, write and then delete about 178 MB a day.
- **Export.** The export carries all of it (`export.ts`, `replayRecords`) as one `ui.result` reply (`router.ts:36-42`). Chromium's extension messaging refuses a message longer than 64 MiB ("Message length exceeded maximum allowed length"). So with about 1,000 receipts on a 200-marker calendar, or about 4,000 at 50, the options page's Export and with it `pnpm attest replay` stop working.
- **Timing.** Schema v5 is new this sprint and nothing has shipped, so the fix costs no data migration now.

**Fix.**
1. Store each distinct coverage once, keyed by its `coverageHash`: a `coverages` store beside `policies`, released when no input names it, as `purgeReplayRecords` does for policies. Each `receiptInputs` row names its coverage by hash.
   - The replay input gains a third map. The contract's `LedgerSnapshot` (`grading.md:285`) and `tests/tools/attest-snapshot.ts` change with it.
   - Replay already groups receipts by batch (`computedAt`), so one coverage per batch is exactly what it reads.
2. Optionally, store each coverage entry once and keep per-batch lists of entry keys. Most markers never change between batches.
3. Tests:
   - N receipts of one batch store one coverage;
   - a 90-day ledger's export stays under the messaging cap, or the export moves to a chunked transfer (a port).

### TECH-2 (MEDIUM): each batch reads and parses both whole tables, every 5 minutes, and no perf gate covers it

**Rule.** Indexes for every query path, and no full scans in hot paths.

**What happens.**
- `gradeInside` reads `db.receipts.toArray()` and `db.claims.toArray()`, Zod-parses every row (`grading.ts:168-169`), and passes every claim to grading as `Activity.claims` (`:162`).
- Cumulative spend reads only `spendWindowDays` = 30 days, and adjacency reads minutes.
- `storeBatch` and `supersede` walk every stored receipt (`:183-195`).
- The batch runs:
  - after each import (`claims-import.ts:77`);
  - every 5 minutes on the alarm (`alarms.ts:45-47`, `config.ts:107`): 288 times a day, whether or not anything is PENDING or new.
- The `receipts.state` index exists (`db.ts:52`, `:80`) and is never used.
- `tests/perf` gates `gradeBatch` over the memory index, candidates and the coverage reads, but not `runGradingBatch` over a Dexie ledger.

**Evidence.**
- Probe A: the steady-state batch takes 70–88 ms at 500 claims, 292–297 ms at 2,000 and 1,403–1,522 ms at 5,000, while regrading only the last day's 5, 21 and 53 claims.
- Probe C at 5,000: 220–300 ms of every batch is the read and Zod parse of 10,000 rows, before any grading.
- The alarm also wakes a stopped worker 288 times a day for a person who never pasted anything.

**Fix.**
1. Skip the batch when there is nothing to do. Either:
   - count PENDING receipts through the `state` index and compare the clock high water with `lastEvaluatedAt`; or
   - arm `attest.grade` only while a receipt is PENDING.
2. Bound the reads:
   - PENDING receipts by `state`;
   - new claims by an indexed `observedAt` (schema v7);
   - the FINAL and overridden receipts whose evidence can meet the batch's candidates, for `preAssignments`, by `[agent+date]` over the pending windows and the orphan horizon. §3 makes `fixed` the stored receipts' pre-assignments, so keep every pair that can touch this batch;
   - `Activity.claims` only over `max(spendWindowDays, attribution windows)`.
3. Add a perf gate: `runGradingBatch` on 5,000 claims and receipts over 90 days, with markers, steady state and nothing new.

### TECH-3 (MEDIUM): the new UI catch sites drop errors; a valid paste fails at send forever with no trace

**Rules.** Errors are typed, carry context, and are never swallowed (Hard Rule 6). Parse at every boundary.

**What happens.** The parser does not refuse everything the message refuses:
- `readPastedLog` refuses a paste over 100,000 characters or over 500 claims (`paste.ts:240-249`);
- `claims.import` also caps `activeAt` at 10,000 instants (`messages.ts:231`), which the parser never checks;
- so `send()` throws `BusError('invalid_outgoing')` without logging it (`send.ts:65-66`);
- `importClaims` passes the rejection up (`send.ts:105-118`);
- `use-paste-flow.ts:137-139` turns it into `{ ok: false }` with no log, and the preview shows "Could not import the claims. Try again." Every retry fails the same way.

Probe D does exactly that with an 87,445-character paste of one claim and 11,520 timed entries.

The same dropping happens elsewhere:
- `AwayDetection.tsx:17-24`: a failing `permissions.contains` shows "off", which may be false, and logs nothing.
- `AwayDetection.tsx:29-35` and `:41-43`: a failing request or removal shows "Something went wrong" and logs nothing.
- The established pattern logs: `ResetInstallIdControl.tsx:59-61` calls `log.error('options.install_id_reset_rejected', { error })`.
- `importClaims` logs its failures as `bus.query_unavailable` (`send.ts:113`), though an import is not a query.

Security found the catches too (SEC-6). The reachable trigger is new here.

**Fix.**
- The parser refuses a log whose timed entries name more than `GRADING_INPUT` minutes, with its own message. Hold `PasteResult` `ok: true` to the message schema with a property: every accepted log yields a valid `ClaimsImportMessage`.
- Log at every catch with a registered event (`sidepanel.import_failed` with the BusError code; `options.away_failed`) and give `importClaims` its own event.
- When `contains` fails, say Attest could not tell, not "off".

### TECH-4 (MEDIUM): the docs that define the ledger and the grading inputs miss the paste path

**Rule.** Every new table, meta key, field and grading input is documented, and the docs agree with the code.

**docs/privacy-architecture.md** (the "every ledger table and field" contract):
- `:193`: the §5.6 list of meta keys lacks two keys, also SEC-5:
  - `lastImportAt.<agent>` (`grading.ts:85`, written at `claims-import.ts:38-42`);
  - `idleOpen` (`activity.ts:21`, `:59`).
- `:213` claims: "Empty until Sprint 3". Claims are now written from pastes, and the `observedAt`, `sourceKind` and `extractor` rows still describe page reading only.
- `:231` grants: "Empty until Sprint 4… as you declare it in the options page". Default grants for all four agents are written at the first import (`claims-import.ts:69`, `default-grants.ts:25-29`).
- `:246` receipts: "Empty until Sprint 3.6". Receipts are written since 3.13.

**docs/grading.md** (the contract replay is built on):
- `:108` names "the ledger readers (Sprint 2.6, 3.5)" for Activity. The reader is `src/ledger/activity.ts` (3.14), and it reads from the earliest instant the batch's coverage reaches (3.16).
- Nowhere does it say that on the paste path an agent's adapter sync, the instant UNASKED finality reads (§7), is its last import (`lastImportAt.<agent>`). Only Decisions [3.13] does.
- It should also say which instant. The code records the worker's clock at import (`claims-import.ts:66-73`), not the side panel's paste instant (`use-paste-flow.ts:67`), which can be minutes earlier.

**README.md:9**: "pre-release, Sprint 2 … It does not read your AI agents' pages yet, so it grades nothing." Pasted claims are graded since 3.13. This sprint removed the same sentence from the popup and the options page (`popup/App.tsx`, `PrivacySection.tsx`) but not from the README.

**CHANGELOG.md**:
- `:15` says "Dexie schema v4 (ten tables…)". The ledger is v6: 11 tables plus two replay stores.
- `:22` and `:31` say a real export becomes replayable only once 3.6 adds the inputs. `:50` says it now is.

**Fix.**
- Update each place above.
- Export one META_KEYS list from src/ledger and have `privacy-architecture.spec.ts` check §5.6 against it.

### TECH-5 (LOW): comments and doc sentences that contradict the code

- `grading.ts:3-4` says a batch runs "after an observer pass". None does: `runGradingBatch` is called only at `claims-import.ts:77` and `alarms.ts:46`, as Decisions [3.13] chose.
- `default-grants.ts:5-6` says grants are written "on install and update, and before it stores an import". Only `claims-import.ts:69` calls `ensureDefaultGrants`; `install.ts` does not.
- `muse/adapter.ts:3-5` says "AGENT_HOSTS.muse, empty until the founder confirms… until then `assertAdapter` refuses it". `config.ts:51` holds `https://muse.ai/*`. AGENT_READERS keeps the reader off, not the host.
- `docs/adapters.md:584` gives `ledger.changed` "1 to 10 ledger table names". `LedgerTable` has 11 (`messages.ts:47-59`, `activity` added).
- `docs/claims-import.md:16` says the person picks "Muse, ChatGPT or Claude". The picker offers Dots too (`paste-labels.ts:19`).
- `docs/claims-import.md:18` gives "a proposal, not an action" as a reason a line is not used. A proposal is imported as an `other` claim; the skipped reasons are no day, no time, nothing checked and invalid (`paste-labels.ts:87-92`).

**Fix.** Correct each.

### TECH-6 (LOW): duplicated logic

- **The address shape.** It is written twice: `claims.ts:137` and `pattern-tables.ts:28`. The comment at `claims.ts:136` admits it ("patterns.ts reads the same shape"). Export one constant.
- **Weekday and month names.** `claims.ts:141-147` (`NOT_A_NAME`) repeats the tables of `core/normalize-names.ts:9-31`. Build the set from them.
- **The import extractor id.** `import.<agent>` is spelled three times: `paste.ts:202`, `:223` and `messages.ts:237`. Use one helper.
- **Paste times read twice.** `paste.ts:220-233` (`activeAtOf`) resolves every entry's time a second time and rebuilds the context `readEntry` built (`:198-206`). Return the stated time from `readEntry`.
- **A dead batch coverage reader.** `coverageForMany` (`coverage.ts:376-389`) has had no production caller since `coverageForBatch` (`coverage-batch.ts:21-42`) took its place. Its property suite (`tests/property/ledger/coverage-many.property.spec.ts`) holds the unused reader, while the shipped one has two unit cases. Move the property onto `coverageForBatch` and delete the other.
- **Unit literals.**
  - `idle.ts:37` multiplies by `1_000`; use MS_PER_SECOND (`core/units.ts:7`).
  - `paste-labels.ts:67` uses `12`; use HOURS_PER_HALF_DAY (`units.ts:21`).
- **A meta key outside the ledger.** `lastImportKey` (`grading.ts:85`) lives in the background, while every other meta key is a src/ledger constant (batch-instant, clock-guard, retention-clock, activity, clock-repairs).

### TECH-7 (LOW): the activity writer throws a raw ZodError

`activity.ts:34` calls `ActivityRecord.parse(input)`. Every other ledger writer throws `LedgerError('invalid_input')` with field names only: `repo.ts:84-89` `parseInput`, and `replay-records.ts:27-30` in this same sprint. So a refused session or interval reaches its caller (`idle.ts:57`, `claims-import.ts`) as an untyped error.

**Fix.** `safeParse` and throw `LedgerError('invalid_input', …, { paths })`, with a test.

### TECH-8 (LOW): a grace-alarm batch writes receipts and announces nothing

`runGraceBatch` (`alarms.ts:45-47`) finalises PENDING receipts and issues UNASKED ones, but broadcasts no `ledger.changed`. The import path does, at `claims-import.ts:78`. Once the Sprint 4 timeline listens, a receipt the alarm finalised stays shown as PENDING until something else moves.

**Fix.** Announce `receipts` from one wrapper both paths use, when `written + deleted + superseded > 0`.

### TECH-9 (LOW): the batch keeps the newest 10,000 claims, with no Decisions entry and no log

`latest()` (`grading.ts:127-130`) cuts each Activity list to the newest `GRADING_INPUT` items (`:153-163`). Past 10,000 claims in the ledger (111 a day over 90 days), older claims inside the 30-day spend window drop out of `priorSpendCents` silently. `historyOf` (`core/batch.ts:145-159`) re-adds only the claims being graded, so a ceiling can pass on a partial total.

**Fix.**
- Read only the spend and attribution windows (TECH-2).
- If a window still exceeds the cap, log it loud.
- Record the rule in Decisions.md.
