# Sprint 5 — Tech

**Role:** agents/tech_reviewer.md (read-only).
**Scope:** everything Sprint 5 touched: tasks 5.0 to 5.9 and the 62 Decisions entries [5.0] to [5.9].
**Range:** `a82916e..5f32641` (HEAD). 11 commits, 205 files, +12,060 / −713. Of that, `extension/src` and `extension/entrypoints` are 67 files (+3,300 / −235), and `telemetry-api/` is 27 files (+2,733).

**What I ran:**
- `pnpm lint` at the repository root. Exit 0. It covers ESLint and Prettier for the extension and the root, plus check-docs. check-docs reported OK: 7 files, 537 relative links, 34 pnpm commands, 823 Decisions.md lines.
- `pnpm typecheck`. Exit 0, across the four extension projects and the root.
- In telemetry-api, `uv run --no-sync`, so nothing was installed, with caches sent to the scratchpad:
  - `ruff check .`: all checks passed.
  - `ruff format --check .`: 19 files already formatted.
  - `mypy app tests scripts` (strict, with Pydantic's plugin): no issues in 18 source files.
  - A Python AST scan for functions longer than 60 lines.
- One `wxt build` of HEAD, in a `git archive` copy in the scratchpad with node_modules linked. The repository's own `.output/` was left alone, because QA's e2e run rebuilds it.
  - Sizes per entrypoint use the method of `tests/e2e/built-bundle.spec.ts` `startLoad`: gzip at level 9 per file, then summed.
  - Bytes were attributed to sources from the source maps.
- A static import tracer over the TypeScript sources at `a82916e` and at HEAD.
- 14 ESLint `lintText` probes against the real `extension/eslint.config.js` (table below).
- One Vitest probe file in the scratch copy, run under `TZ=America/New_York` and `TZ=UTC` (TECH-2).

**Not run:** `pnpm test`, `pnpm e2e`, coverage and bench. Nothing in the repository was written except this file.

**Files QA added during this review are out of scope.** These files appeared untracked while I worked and are not in the range:
- `extension/tests/property/monotonicity-scores*.spec.ts`
- `extension/tests/unit/**/…-edges.spec.ts`
- `telemetry-api/tests/test_api_edges.py`

## Summary

**Gaps: 13. None HIGH, 4 MEDIUM, 9 LOW.**

**What passes:**
- **The model never reaches `src/core`.** Lint exit 0. Probes F and G were refused: core may not import `src/intel` (`CORE_RESTRICTED_IMPORTS` lists `intel` and `telemetry`, and an allowlist admits only sibling modules, zod and the policy file). A grep of `src/core` finds no `Date.now`, `Math.random`, `getRandomValues`, `randomUUID`, `fetch` or `LanguageModel`. `model-raise.ts` imports five core siblings and nothing else. λ is read from `policy.bp.features.modelScore`, and its cap comes from the policy's thresholds (`policy-checks.ts` `modelIssues`).
- **Network.** Exactly two files may call `fetch`: `NETWORK_EXEMPT_FILES` holds `src/telemetry/send.ts` and `src/intel/providers/byo.ts`. Probes H and I were refused. The options page bundles the on-device provider only, never `byo.ts` or `send.ts` (source maps). Hosts, endpoints and models are in `src/config-network.ts`, and `tests/unit/intel/byo.spec.ts:140-142` pins each endpoint to its host.
- **The bus.** The three new messages (`byo.save`, `byo.forget`, `telemetry.send`) are strict Zod schemas in the bus union. Their answers are checked through `PAGE_COMMAND_RESULTS`, and they are page-only automatically, because `listen.ts:83-86` derives `EXTENSION_PAGE_ONLY` from that table. Values read from `chrome.storage.local` are parsed (`StoredByo`, `ByoVendorName`).
- **Indexes.** Every new query path has one:
  - `modelAnswers`: the primary key `claimId`, plus an `inputsHash` index (`db.ts` `STORES_V11`) for the cache.
  - The model's ask list: receipts by `state`.
  - Telemetry counts: `[agent+computedMs]` (v8).
  - Coverage hours: `[source+kind+endMs]` (v4).
  - Health: `adapterHealth` keyed by `adapterId`.
  - Every other read is a `bulkGet` by key.

  No new unbounded `toArray` sits in a hot path or the UI.
- **Ledger plumbing.** The v11 store is new and empty, so no data upgrade is needed. It is exported by both `export.ts` and `export-file.ts`, purged with its claim (retention rule 12, `retention.ts` and `retention-clock.ts`), and counted in `LedgerTable` and `ledger.changed`. Writes go through `parseWrite`, which raises a typed `LedgerError`. The meta key `telemetrySentDay` is in `META_KEYS`.
- **telemetry-api.** ruff, `ruff format` and mypy are strict and clean. Validation lives in `app/schema.py` (`extra='forbid'`, `strict=True`) and storage in `app/store.py`. All Python files are 216 lines or fewer.
- **Popup size.** The popup's start load is 115,079 B gzipped. That is under its 125,000 B budget and the checklist's 150 KB.

## Bundle size per entrypoint

**Method:**
- HEAD (`5f32641`) built once.
- An HTML entrypoint counts its page's scripts, modulepreloads and stylesheet, plus their static imports transitively. "With later imports" adds the dynamic `import()` chunks.
- The worker counts `background.js` and the 17 chunks it imports.

The last column repeats the Sprint 4 tech review's figures. Those were measured with the same method on `efefaa0`, before the Sprint 4 close. The popup's figure at the close was 113,062 B (`built-bundle.spec.ts`).

| Entrypoint | Start raw (B) | Start gzip (B) | With later imports, gzip (B) | Sprint 4 review, gzip (B) |
|---|---|---|---|---|
| popup | 364,867 | 115,079 | 124,406 | 115,046 (113,062 at the close). Budget 125,000; ceiling 150 KB: **pass** |
| sidepanel | 423,448 | 137,300 | 142,350 | 137,217 |
| options | 438,576 | 141,711 | 143,103 | 137,025 |
| digest | 372,232 | 118,766 | 128,224 | 117,738 |
| dev (not in the store build) | 233,724 | 70,788 | — | 71,217 |
| model-check (new; not in the store build, `DEV_ENTRYPOINTS`) | 235,509 | 69,919 | — | new |
| background.js + 17 chunks (worker) | 493,535 | 160,516 | — | 150,298 |
| content-scripts/gmail.js | 238,624 | 70,760 | — | 69,729 (budget 75,000: pass) |
| content-scripts/gcal.js | 222,802 | 65,667 | — | 64,688 (budget 75,000: pass) |

**What Sprint 5 put in the options page's start load** (raw bytes, from the source maps):

| Source | Bytes |
|---|---|
| `ByoModel.tsx` | 3,038 |
| `BuiltinModelToggle.tsx` | 2,585 |
| `TelemetryToggle.tsx` | 2,378 |
| `ModelSection.tsx` | 737 |
| `use-builtin-model.ts` | 461 |
| `src/telemetry/aggregate.ts` | 1,833 |
| `src/telemetry/schema.ts` | 879 |
| `src/telemetry/facts.ts` | 262 |
| `src/intel/providers/builtin.ts` | 907 |
| `src/intel/prompt.ts` | 802 |
| `src/intel/schema.ts` | 778 |
| `config-network.ts` | 352 |
| `src/ledger/upsert.ts` | 1,850 |
| `src/ledger/repo.ts` | 1,404 |

The last two are the ledger's writer modules, back on the page (TECH-1).

The content scripts grew about 1 KB each. They now carry `src/bus/page-commands.ts` (the new command schemas, through the bus union) and `src/config-network.ts`.

## ESLint probes

Each probe was linted with `ESLint.lintText` against the real config, as an existing file of the scope.

| Probe | Linted as | Content | Result |
|---|---|---|---|
| A | `src/telemetry/aggregate.ts` (the worker runs it) | reads `document` | **allowed** |
| B | `entrypoints/options/telemetry-preview.ts` | imports the writer `claimAsk` (`ledger/model-answers`) | **allowed** |
| C | same | imports the writer `recordTelemetrySent` (`ledger/telemetry-sent`) | **allowed** |
| D | same | imports `getInstallId` (writes when no id is stored) | **allowed** |
| E | same | imports `listAdapterHealth` from `ledger/repo` (control) | refused (`no-restricted-imports`) |
| F | `src/core/model-raise.ts` | imports `../intel` | refused (`no-restricted-imports`) |
| G | same | imports `../intel/input` | refused (`no-restricted-imports`) |
| H | `src/intel/input.ts` | calls `fetch` (control) | refused (`attest/no-network`) |
| I | `src/telemetry/aggregate.ts` | calls `fetch` (control) | refused (`attest/no-network`) |
| J | `src/intel/providers/builtin.ts` | reads `document` (control) | refused (`no-restricted-globals`) |
| K | `src/telemetry/aggregate.ts` (the options page bundles it) | imports the writer `putReceipt` | **allowed** |
| L | `src/intel/schema.ts` | imports `ledger/repo` | allowed (no rule asks otherwise; noted only) |
| M | `src/core/model-raise.ts` | `Date.now()` (control) | refused (`no-restricted-syntax`, `attest/core-determinism`) |
| N | `src/telemetry/facts.ts` | `Math.random()` (not core) | allowed, as designed |

## Checklist

| Item | Status | Finding |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint rule) | verified clean | Lint exit 0. Probes F, G and M were refused. The only import from outside core is `policy/default.json`. |
| Entrypoints are thin | verified clean | `background.ts` adds one line, `closeStorage()` at `onStartup`, with its log. The options components hold UI state and call hooks and modules. `model-check` is a development page. |
| Adapters and observers are pure over Document | verified clean | Untouched: no file under `entrypoints/content`, `src/adapters` or `src/observers` changed. |
| Cross-context messages typed in src/bus and Zod-validated | verified clean (LOW note) | The three new commands are typed, parsed at both ends and page-only. One announcement misuses `ledger.changed` (TECH-9). |
| Policy values from policy/default.json | verified clean (LOW note) | λ and the cap come from the policy. The worker picks claims by the policy's rule id `'partial'` (TECH-9). |
| Layering fences (Sprint 4 close, TECH-1) | **GAP** | The options page bundles the ledger's writers again. Sprint 5's writers and `src/telemetry` are outside every fence (TECH-1). |
| No `any`, no `as unknown as`, no unexplained `!` | verified clean | Lint rules are on and clean. New assertions: `as PromptApi` after a runtime check, and `as T` in `input.ts` `kept()`, which `IntelInput.parse` re-checks. |
| No hardcoded hosts, ids or URLs | verified clean (LOW note) | Everything is in `config-network.ts`, except Anthropic's API version id in `byo.ts:51` (TECH-9). |
| No duplicate selector logic | verified clean | No selector changed. Other duplication is in TECH-7. |
| No TODO or FIXME without a task | verified clean | None among the added lines. The only suppressions are four justified `# noqa: S310` in telemetry-api scripts. |
| Errors typed, with context, never swallowed | **GAP** | `IntelError`, `StoreError` and `parseWrite` are typed. One silent catch, an unhandled rejection path, a reused event name and a raw `SyntaxError` remain (TECH-6, TECH-12). |
| Functions ≤ 60 lines, files ≤ 400 lines | GAP (LOW) | TypeScript, JavaScript, bench and scripts are held by lint `SIZE_RULES` (tests included). Python is not linted for size: `create_app` is 68 lines (TECH-11). Closest to the cap: `tests/unit/ledger/retention.spec.ts` 399, `src/ledger/db.ts` 388, `src/bus/messages.ts` 386. |
| Naming conventions | GAP (LOW) | Case conventions hold. Four new `.tsx` files hold 3 to 4 components each, against "one component per file" (build_spec §5, locked). Two different components are both named `ModelCheck` (TECH-8). |
| No clock, randomness or model in src/core | verified clean | Lint (`core-determinism`, `no-restricted-syntax`) and grep. `model-raise.ts` is exact BigInt ratio arithmetic. |
| Ids from hashes where idempotency matters | **GAP** | Clean in the extension: one `modelAnswers` row per claim, and `inputsHash` is the SHA-256 of the canonical input. The server stores a retried day twice (TECH-3). |
| Timestamps ISO with offset; money in cents | verified clean | `askedAt` uses `isoWithLocalOffset` and `IsoTs`. The model's input carries integer minor units; currency is left out on purpose ([5.1]). `dayBucket` is a date. |
| Dexie indexes for every query path | verified clean | See Summary, "Indexes". |
| Ledger reads paginated in UI; no `toArray` on unbounded tables | verified clean | The telemetry preview reads one indexed day per agent. `claimsToAsk` reads PENDING by index. `export.ts`'s `toArray` is the export path; the options page uses the paged `export-file.ts`. |
| Content scripts debounce DOM observation | verified clean | Untouched. |
| Service worker does no work on onStartup beyond alarms | verified clean (LOW note) | `closeStorage()` was added at browser start, as Decisions [5.3] requires. Every install now wakes hourly for telemetry, and the grace alarm now waits on the model (TECH-10). |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | verified clean | See the table: 115,079 B. |
| New messages, tables, fields and grades documented | **GAP** | All are documented: the three messages in adapters.md, `modelAnswers` §5.17, `telemetrySentDay` §5.6, `features.modelScore` grading §5.4, the alarm §11. But privacy-facing statements now contradict the code (TECH-4), and older lines went stale (TECH-5). |
| Decisions.md entry for every unspecified choice | GAP (LOW) | 62 thorough entries. A few small choices have none (TECH-13), and neither does at-least-once delivery (TECH-3). |
| CHANGELOG updated under Unreleased | GAP (LOW) | Eight Sprint 5 lines were added. Four lines contradict the code (TECH-5). |
| Tests follow the build_spec §6 layout | verified clean | `tests/unit/{intel,telemetry,background,ledger,options,bus,docs,bench,core}`, `tests/property/monotonicity*.spec.ts`, `tests/e2e/{intel,telemetry}.spec.ts` with `support/`, `tests/fixtures/intel/corpus.json`, `tests/tools/{intel-inputs,telemetry-example,telemetry-schema}.ts` and `telemetry-api/tests/`. |
| telemetry-api: routers thin, validation in schema, storage in store.py | verified clean (LOW note) | The one route does the transport checks, then schema, limits and store. Structure notes are in TECH-11 and TECH-12. |
| telemetry-api: type hints, ruff, mypy --strict clean | verified clean (LOW note) | All clean, `scripts/` included. CI's mypy step omits `scripts/` (TECH-11). |

## Gaps

### TECH-1 (MEDIUM): the options page bundles the ledger's writers again, and Sprint 5's modules sit outside the fences

**Where:**
- `extension/src/telemetry/aggregate.ts:23`
- `extension/eslint-rules/fences.js:35` (`WORKER_SCOPES`) and `fences.js:131-152` (`PAGE_RESTRICTED_IMPORTS`)
- `extension/entrypoints/options/use-install-id.ts:43`

**What is wrong:**
- **The writers came back to the options page.** `aggregate.ts` imports `listAdapterHealth` from `src/ledger/repo.ts`. The options page imports `aggregate.ts` for the telemetry preview (`telemetry-preview.ts:9`). So the page's start load holds `src/ledger/repo.ts` (1,404 B) and `src/ledger/upsert.ts` (1,850 B) again.
  - The import tracer finds no path from `entrypoints/options/main.tsx` to either module at `a82916e`.
  - At HEAD the path is `PrivacySection → TelemetryToggle → telemetry-preview → src/telemetry/aggregate → ledger/repo → ledger/upsert`.
  - A read-only twin, `healthReports` (`src/ledger/views.ts:200`), is byte for byte the same function.
- **The fence checks direct imports only.** `PAGE_RESTRICTED_IMPORTS` applies to page files. A shared module pages import is free to import writers (probe K). The same hole already let `export-file.ts` bring in `calendar-snapshots.ts` and `clock-high-water.ts` before this sprint.
- **The page fence was not extended to Sprint 5's writers.** Probes B, C and D: a page may import `claimAsk` and `answerAsk` (`ledger/model-answers`), `recordTelemetrySent` (`ledger/telemetry-sent`) and `getInstallId`.
- **Decisions [5.7]'s reasoning is contradicted on the same page.** [5.7] says the preview reads the id with `readInstallId` because `getInstallId` "would let a page recreate an id the person removed elsewhere". Yet the same page's install-id panel calls `getInstallId()` on mount (`use-install-id.ts:43`), which writes a new id when none is stored.
- **`src/telemetry/**` is not in `WORKER_SCOPES`,** though the worker runs `send.ts`, `aggregate.ts` and `facts.ts`. Probe A: `document` lints clean there and would fail only at run time in the worker. `src/intel/**` was added to the list this sprint. `src/config-network.ts` and `src/log-error-names.ts` are new worker-bundled files that are not listed either.

**Why it matters:** "Pages read, the worker writes" is the rule Sprint 4 closed TECH-1 on (Decisions [4.0]). It now holds only by convention again, and the first module shared between page and worker broke it unnoticed.

**Fix:**
1. In `aggregate.ts`, read health through `healthReports` from `src/ledger/views.ts`.
2. Add `src/telemetry/**`, `src/config-network.ts` and `src/log-error-names.ts` to `WORKER_SCOPES`.
3. Add these `importNames` entries to `PAGE_RESTRICTED_IMPORTS`:
   - `ledger/model-answers`: `claimAsk`, `answerAsk`, `purgeModelAnswers`
   - `ledger/telemetry-sent`: `recordTelemetrySent`
   - `ledger/install-id`: `getInstallId`, `ensureInstallId`
4. Apply the page fence to the modules pages import (`src/telemetry/{aggregate,facts,schema}.ts`), or add a unit test that walks each page's import graph and fails on a writer module. The second also catches the pre-existing `export-file.ts` reach.
5. Either switch `use-install-id.ts` to `readInstallId`, showing "missing" until the worker makes an id, or record in Decisions why that panel may create the id when the preview may not.

### TECH-2 (MEDIUM): on the day clocks go back, the usage numbers cannot be built, and that day is never sent

**Where:**
- `extension/src/telemetry/aggregate.ts:41-47` (`reportedDay`), `:90-106` (`hoursOf`) and `:126-142`
- `extension/src/telemetry/schema.ts:29` (`hours` is at most 24) and `telemetry-api/app/schema.py:27`
- `extension/src/telemetry/send.ts:56-59`

**What is wrong:**
- `reportedDay` spans local midnight to local midnight, so the fall-back day of daylight saving time lasts 25 hours.
- `hoursOf` clips coverage to that span. A reader whose windows covered the whole day gets `Math.floor(25 h)` = 25, which the schema refuses.
- `buildTelemetry` then returns null. The send logs `telemetry.not_built` every hour of the next day, and only yesterday is ever sent, so the day is lost.
- The options page's preview says "Attest cannot build the numbers on this browser" for that whole day.

**Probe** (`buildTelemetry` with one `gmail.sent` window over the whole day, reported on 2 November 2026):

| Time zone | Day | Hours in the day | Result |
|---|---|---|---|
| `America/New_York` | `2026-11-01` | 25 | `null` (not built) |
| `UTC` | `2026-11-01` | 24 | `{"gmail":24,"gcal":0}` |

No test covers a 23-hour or 25-hour day, and `pnpm test:tz` runs only core, property and golden tests.

**Why it matters:** A whole day's report is silently lost, once a year, in every time zone with daylight saving time. Coverage near 24 hours is exactly what a person who leaves Gmail open produces.

**Fix:**
- Clamp each reader's hours to 24 in `hoursOf` (or scale by the day's real length), and record the choice in Decisions.
- Add a unit test with a hand-built 25-hour `TelemetryDay`. `buildTelemetry` takes the day as an argument, so no time-zone run is needed.

### TECH-3 (MEDIUM): a retried day is stored twice; delivery is at-least-once, but neither side is idempotent

**Where:**
- `extension/src/telemetry/send.ts:60-73`
- `telemetry-api/app/store.py:38-44` and `telemetry-api/app/main.py:111-114`
- `docs/privacy-architecture.md:471`

**What is wrong:**
- The extension records `telemetrySentDay` only after reading a 204. It sends again at the next alarm when any of these happens:
  - `fetch` throws after the server stored the payload (a response lost on the way back);
  - the worker stops before `recordTelemetrySent`;
  - that write fails.
- The API inserts every accepted payload with a random `_id`. Nothing in the API, its tests or Decisions dedupes by `(installId, dayBucket)`. A day can be stored up to 24 times, the per-install limit.
- `docs/privacy-architecture.md:471` says "no day is sent twice".

**Why it matters:** The stored aggregates over-count whenever a response is lost. Sprint 7's public `GET /v1/stats` will read them. The doc also promises an exactly-once delivery the code does not provide.

**Fix:**
- Make the server idempotent. Store with a deterministic `_id` (SHA-256 of `installId` and `dayBucket`), or add a unique index on `payload.installId` and `payload.dayBucket`.
- Answer a duplicate with 204 and store nothing new. Today a `DuplicateKeyError` is a `PyMongoError`, which `store.py:42` would turn into a 503, and the extension would retry hourly.
- Have a duplicate not count against the install's limit.
- Test it, record "at-least-once from the extension, at most one stored per day" in Decisions, and reword §11.

### TECH-4 (MEDIUM): the privacy-facing docs contradict the code on what is stored and what leaves

**Where:**
- `README.md:9` and `README.md:23-25`
- `docs/privacy-architecture.md:108`

**What is wrong:**
- **`README.md` was not touched this sprint.**
  - Its status line says "pre-release, Sprint 4".
  - Its section "Nothing leaves your browser" says "Attest makes no network requests", enforced by a test that "fails the build if any host is contacted".
  - Since 5.3 and 5.7, the person's own key sends facts to its vendor, and the usage numbers go to the telemetry host. The network tests now allow exactly those hosts when each option is on (`allowedHosts`).
  - PRIVACY.md (0.6) and privacy-architecture §1 were updated in 5.7. The README was not.
- **`docs/privacy-architecture.md:108`** (the §5 inventory) says `chrome.storage.local` "holds one key today and nothing else: `attest.installId` … will only ever be used by the opt-in telemetry of Sprint 5".
  - `STORAGE_KEYS` now also holds `attest.byoKey` (a secret) and `attest.byoVendor` (`config.ts:20-26`).
  - The area is now closed to content scripts (`setAccessLevel`).
  - §10 of the same document says the key is kept there.
- `tests/unit/docs/doc-pins.spec.ts` pins `SESSION_KEYS` to the doc, but not `STORAGE_KEYS`. So the drift passed `pnpm lint` and the unit tests.

**Why it matters:** A privacy architecture whose storage inventory omits the one secret Attest stores, and a README that tells a sceptical reader nothing ever leaves, are the documents trust rests on (Hard Rules 1, 2 and 12).

**Fix:**
- Rewrite the README's status line and its network section in the words of PRIVACY.md's short version.
- List both keys and the access level in §5.
- Add a pin from `STORAGE_KEYS` to §5, as `SESSION_KEYS` has.

### TECH-5 (LOW): stale lines in adapters.md, the CHANGELOG and code comments

**Where and what:**
- **`docs/adapters.md:591`** (`flag.set`): "`SETTABLE_FLAGS` (`ATTEST_AUTO_CHECK_GMAIL`, `ATTEST_MODEL`, `ATTEST_MODEL_BYO`; any other flag fails the schema)". `ATTEST_TELEMETRY` has been settable since 5.7 (`config.ts` `SETTABLE_FLAGS`), and the Sender column does not name the Privacy section.
- **`docs/adapters.md:599`**: the `untrusted_context` drop list names eight page commands and leaves out `byo.save`, `byo.forget` and `telemetry.send`. All three are dropped exactly so from a content script.
- **`CHANGELOG.md:15`**: "Dexie schema v10 (sixteen tables…)". It is now v11 with seventeen.
- **`CHANGELOG.md:68`**: the telemetry payload "(not sent yet)".
- **`CHANGELOG.md:79`**: "With the model off, which it is until it is wired in", and "A property test grades 5,000 random inputs". The model was wired in at 5.4, and the property grades 20,000 since [5.7]; docs/grading.md says 20,000.
- **Code comments:**
  - `entrypoints/options/use-settings.ts:2-6`: lists only the on-device model among the views and four commands, without `byo.save` or `byo.forget`. Line 3 also runs past the 120-column width.
  - `src/bus/page-commands.ts:1-9`: the header leaves out `telemetry.send`, though this file defines it.
  - `src/bus/send.ts:169`: the comment on `sendSetting` leaves out the key commands.

**Why it matters:** Readers of the bus contract and the release notes get a wrong list. The adapters.md line is a statement about what the schema refuses.

**Fix:** Correct each line. A pin from `SETTABLE_FLAGS` and the page-only set to adapters.md would hold them, as `changedBound` holds the table count.

### TECH-6 (LOW): error handling in the new code

**Where and what:**
- **`src/intel/providers/builtin.ts:59-66`, `builtinAvailability`: `catch { return 'unavailable'; }` logs nothing.**
  - The worker's `chooseProvider` then falls back silently.
  - The options page says "Chrome says this computer cannot run its on-device model", which is false when the call merely threw.
  - This breaks intel_engineer rule 4 ("silent to the user, loud in logs") and the project's "every catch logs" rule.
- **`entrypoints/options/components/TelemetryToggle.tsx:92-100`: `run` has no rejection path.**
  - `void task().then(...)` with `task = change` leaves `busy` true for good and raises an unhandled rejection if `toggle` rejects.
  - `sendCommand` rejects on `invalid_outgoing`, so this is latent, not live.
- **One event name for two failures.** `telemetry.send_failed` is a warning for a `fetch` that threw (`src/telemetry/send.ts:64`) and an error for anything else that threw (`src/background/telemetry.ts:24`). A log reader cannot tell them apart.
- **A non-JSON 200 answer is not an `IntelError`.** In `src/intel/providers/byo.ts:121`, such an answer surfaces as a raw `SyntaxError` from `response.json()`, while the file's header says an unreadable reply is an `IntelError` (`bad_reply`).

**Why it matters:** Fail loud (Hard Rule 6). A provider that never answers because its check throws is invisible in the log and misexplained to the person.

**Fix:**
- Log `intel.availability_failed` with the error. Return a distinct status (`unknown`) that the page words as "could not check", not "cannot run".
- Give `run` a rejection handler that logs and clears `busy`.
- Rename one of the two events.
- Map a `response.json()` failure to `IntelError('bad_reply')`.

### TECH-7 (LOW): duplicated logic and test-only production code

**Where and what:**
- **`src/intel/index.ts:30-44` `modelScores` is called only by tests** (`tests/unit/intel/input.spec.ts`, `model-scores.spec.ts`). The worker re-implements its build, catch and log in `src/background/intel.ts:118-124` and calls `scoresFor` itself.
- **`parsedOrText` is identical** in `providers/builtin.ts:69-75` and `providers/byo.ts:92-98`.
- **The `ModelScores` type is defined twice:** `src/core/schema.ts:352` and `src/intel/schema.ts:52`.
- **The provider ids are a closed set written twice:** `IntelProviderId` (`src/intel/index.ts:16`) and `ModelProvider` (`src/ledger/types.ts:148`).
- **The telemetry outcomes are written twice:** `TelemetryOutcome` (`src/telemetry/send.ts:18`) and the `outcome` enum in `src/bus/page-commands.ts:147`.
- **The `YYYY-MM-DD` pattern is written four times:**
  - `src/telemetry/schema.ts:24`
  - `src/ledger/telemetry-sent.ts:17`
  - `src/bus/page-commands.ts:148`
  - `src/ledger/types.ts:166`, which uses `\d`, the class [5.6] avoids.
- **Chrome's major version is parsed twice:** `src/telemetry/facts.ts:14` and `entrypoints/model-check/record.ts:42`. The second misses `HeadlessChrome`.
- **The recording file is built twice:** `recordingOf` (`entrypoints/model-check/record.ts:41-51`) and `byoRecording` (`bench/intel-record.ts:50-59`).
- **The adapter-health read is written twice:** `listAdapterHealth` (`src/ledger/repo.ts:260`) and `healthReports` (`src/ledger/views.ts:200`).

The compiler links most of the closed sets today, but each pair can drift apart.

**Fix:**
- Delete `modelScores`, or have `askOne` call one shared build-and-ask helper the tests also use.
- Keep one copy of each, imported where needed: `parsedOrText`, the day schema (one in `core/schema-primitives.ts`), `chromeMajorOf` and the recording builder.
- Derive the provider ids and the telemetry outcomes from one constant each.

### TECH-8 (LOW): "one component per file" broken in four new files, and two components named `ModelCheck`

**Where:**

| File | Components (line) |
|---|---|
| `entrypoints/options/components/ByoModel.tsx` | `ByoStatement` 26, `VendorChoice` 47, `ByoKeyForm` 75, `ByoModel` 125 |
| `entrypoints/options/components/BuiltinModelToggle.tsx` | `ModelStatement` 33, `ModelDownload` 50, `ModelCheck` 74, `BuiltinModelToggle` 93 |
| `entrypoints/options/components/TelemetryToggle.tsx` | `TelemetryStatement` 31, `TelemetryPreview` 57, `TelemetryToggle` 81 |
| `entrypoints/model-check/App.tsx` | `ModelCheck` 32, `BenchRecord` 94, `App` 136 |

**What is wrong:**
- build_spec §5 locks "One component per file", as do ux_engineer rule 12 and Decisions line 36.
- Before this sprint, only the development page `dev/App.tsx` held two components.
- `BuiltinModelToggle.tsx`'s button and the development page's root are both named `ModelCheck`.

**Why it matters:** It is a locked decision changed without a Decisions entry. The shared name confuses stack traces and searches.

**Fix:**
- Move each component to its own file.
- Rename the button component (for example `CheckModelButton`).
- Optionally, add a lint test that counts components per `.tsx`.

### TECH-9 (LOW): contracts held by convention: a policy rule id, a misused announcement, a vendor id outside config

**Where and what:**
- **The worker picks claims by the policy's rule id.** In `src/background/intel.ts:66` it asks about a claim only when `receipt.ruleId === 'partial'`; the bench copies this in `tests/unit/intel/corpus.ts:154`. The grade and state (`grade === 'PARTIAL' && state === 'PENDING'`) say the same thing without depending on how `policy/default.json` names its rule. A policy version that renamed the rule would silently stop every ask.
- **A storage change is announced as a ledger change.** `src/background/byo.ts:69` and `:84` announce `ledger.changed` with `['meta']` after saving or forgetting the key. That is a change to `chrome.storage.local`, not to the ledger's meta. The options page depends on it to re-read the vendor, but adapters.md documents neither the announcement nor that `ledger.changed` may name a table that did not change.
- **Anthropic's API version id is hardcoded outside config.** `src/intel/providers/byo.ts:51` writes `'anthropic-version': '2023-06-01'`, while the endpoint and model are in `BYO_VENDORS`.

**Fix:**
- Select by grade and state, or through a core predicate (`modelMayRaise(receipt)`) next to `raisedBest`.
- Document the BYO announcement in adapters.md, or have the Model section re-read after its own command's answer.
- Move the version id into `BYO_VENDORS.anthropic`.

### TECH-10 (LOW): service-worker scheduling: an hourly wake for every install, and the grace alarm waits on the model

**Where:**
- `extension/src/background/alarms.ts:103-108`, `:130-134` and `:143-150`
- `extension/src/background/alarms.ts:62-75`

**What is wrong:**
- **Every install wakes hourly.** `resetAlarms` and `ensureAlarms` create `attest.telemetry` for every install, so the worker wakes every hour to read a flag that is off by default.
- **The grace alarm waits on the model.** `runGraceBatch` now awaits `askModel(db)` before the Gmail auto-check, and `upkeep` (alerts left pending, lost alarms, reader registrations) runs after it. That wait is up to `MODEL_ASKS_PER_RUN` × `INTEL_TIMEOUT_MS` = 20 s, plus a second full grading batch.
- Decisions [5.4] budgets the 20 s against the worker's 30 s idle limit. It does not count the batch before or the regrade after.

**Fix:**
- Create the telemetry alarm on `flag.set ATTEST_TELEMETRY` (and at install only while it is on), and clear it when the flag is turned off. Or record in Decisions why an always-on hourly alarm is preferred.
- In `runGraceBatch`, ask the model last, after the auto-check and the upkeep.

### TECH-11 (LOW): telemetry-api structure

**Where and what:**
- **`telemetry-api/app/main.py:61-128` `create_app` is 68 lines,** over the 60-line limit. Python is not linted for size, and ruff has no length rule enabled. The route closure orchestrates the content type, size, schema, both limits and the store.
- **`telemetry-api/app/store.py:55-72` `MemoryStore` is a test double in the application package.** It ships in the image (`Dockerfile`: `COPY app ./app`).
- **There is no Pydantic response model.** backend_engineer rule 1 asks for "Pydantic models for every request and response", but `envelope()` (`main.py:41-45`) builds a dict.
- **CI's type check omits `scripts/`.** `.github/workflows/ci.yml:150` runs `uv run mypy app tests`, while CI runs `scripts/prove_flow.py`. They pass mypy strict today (my run), but CI does not hold them to it.

**Fix:**
- Split `create_app`: register the error handlers and the routes in two helpers. Move "ask both limits, then count both" into a `Limits.admit(install_id, client, today)` in `limits.py`.
- Move `MemoryStore` to `tests/`.
- Add an `Envelope` model.
- Run `uv run mypy app tests scripts` in CI.
- Optionally, enable ruff `PLR0915` or `C901` to hold function size.

### TECH-12 (LOW): telemetry-api: the 413 comes after the whole body is read, and an unexpected error leaves the JSON log

**Where:** `telemetry-api/app/main.py:96-98` and `:82-85`.

**What is wrong:**
- **The body is read in full before its size is checked.** `await request.body()` reads the whole body into memory before `len(body) > max_body_bytes` is compared, and uvicorn sets no body limit.
- **An unexpected error escapes the log contract.** Starlette 1.7.0's `ServerErrorMiddleware` re-raises after the `Exception` handler answers 500 (`starlette/middleware/errors.py:183-186` in the locked environment). uvicorn then logs "Exception in ASGI application" with the traceback (`uvicorn/protocols/http/h11_impl.py:414-416`). That is a multi-line record outside the "one JSON line per event, never … " contract of `app/logs.py` and Decisions [5.8]. An exception message can carry values: a `bson.errors.InvalidDocument` is not a `PyMongoError`, so it skips `StoreError`.
- **The 500 path is untested in the range.** QA's uncommitted `tests/test_api_edges.py` tests the envelope through `TestClient`, which never shows uvicorn's record.

**Fix:**
- Refuse on `Content-Length` before reading, then read the stream with a cap (stop at `max_body_bytes + 1`).
- Catch unexpected errors in a pure ASGI middleware that answers the envelope without re-raising, or run uvicorn with a log config that drops `exc_info`.
- Test that one JSON line and no traceback are written.

### TECH-13 (LOW): Decisions entries missing for small unspecified choices

**What has no entry:**
- `TELEMETRY_STARTUP_DELAY_MINUTES = 2` (`src/config.ts:176`). The other alarms use 1.
- The telemetry POST has no timeout (`src/telemetry/send.ts:36-45`). The model's calls have 2 s.
- Mongo's `serverSelectionTimeoutMS=2_000` (`telemetry-api/app/store.py:35`). It bounds `/health` and every insert.
- CORS `max_age=86_400` (`telemetry-api/app/main.py:71`).
- `railway.json`'s `healthcheckTimeout: 30` and `restartPolicyType: ON_FAILURE` with 5 retries.
- At-least-once telemetry delivery (TECH-3).

**Why it matters:** CLAUDE.md asks for every unspecified decision, dated, with its reason.

**Fix:** One line each in Decisions, or align the startup delay with the other alarms and add an `AbortSignal.timeout` to the POST.
