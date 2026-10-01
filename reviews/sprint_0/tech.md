# Technical review: Sprint 0

**Reviewer:** Technical Reviewer (`agents/tech_reviewer.md`) · **Date:** 2026-10-01 · **Mode:** read-only (this file is the only change)

**Scope:** every file committed in Sprint 0 (13 commits, `e6c2db4`..`89e7cc1`): `extension/src/**`, `extension/entrypoints/**`, `extension/eslint-rules/**`, the extension and root configs, `extension/tests/tools/**`, `extension/tests/e2e/**`, `bench/`, `policy/` and `.github/workflows/ci.yml`. I did not review QA's untracked, in-progress test files (`tests/unit/log.spec.ts`, `tests/property/log.property.spec.ts`, `tests/unit/options/options-ui.spec.ts`). At 16:57 three of their cases were failing, and those belong to QA.

## Summary

The code is in good shape. Lint, typecheck and the committed unit suite are green. No file is over 400 lines. There is no `any`, no `as unknown as`, no `!` and no TODO. Every host lives in `src/config.ts`, `src/core` is fenced by lint and by its own tsconfig, every repo query hits an index, and the worker does no startup I/O beyond alarms.

The gaps fall into four groups:
- **CI is red.** The artifact upload step fails.
- **Lint fences are missing.** Four rules that later sprints depend on are not enforced by lint: no storage or ledger access from code that runs in a vendor origin, no network outside telemetry, no ad-hoc runtime messaging, and no listeners registered inside other event callbacks.
- **Type and timestamp design.** Browser code is type-checked against Node globals, and no rule says which offset timestamps use.
- **Small items.** A set of LOW consistency, duplication and documentation gaps.

| Severity | Count | Gaps |
|---|---|---|
| CRITICAL | 0 | |
| HIGH | 2 | TECH-1, TECH-2 |
| MEDIUM | 5 | TECH-3, TECH-4, TECH-5, TECH-6, TECH-7 |
| LOW | 11 | TECH-8 … TECH-18 |

Overlap with `security.md`: TECH-3 is the same finding as SECURITY-5. One fix closes both. I rate it MEDIUM rather than LOW for the reason given in TECH-3. Security left the CI upload failure (TECH-1) to QA and Tech.

## Commands run and measurements

| Command / probe | Result |
|---|---|
| `pnpm lint` | exit 0 (`eslint --max-warnings 0` + `prettier --check`, extension and root) |
| `pnpm typecheck` | exit 0 (extension, `src/core/tsconfig.json`, root) |
| `pnpm test` | 37 files, **727/727 passed** (committed suite, 16:49) |
| `gh run list --limit 3` / `gh run view 36923944944` | Latest run on `main` (push of `b816bd4`) **failed**. Lint, typecheck, unit, build, `E2E (@mandatory)` and `E2E (rest)` all passed. `Upload build` failed with `##[error]No files were found with the provided path: extension/.output/` (`include-hidden-files: false`). |
| File-length scan (`wc -l` over every `.ts/.tsx/.js/.json` in `extension/{src,entrypoints,eslint-rules,tests}`, `bench`, `policy`) | Max 399 (`tests/unit/tools/sanitize.spec.ts`). Production max 353 (`src/ledger/repo.ts`); `src/core` max 300 (`policy.ts`). **All ≤ 400.** |
| Function-length scan (TypeScript compiler API over every function, arrow, method and accessor) | Over 60 lines: `eslint-rules/no-act.js:162-246` `create` (85) and `tests/e2e/no-leak.spec.ts:126-188` (63). The 21 `describe()` group callbacks over 60 lines (largest 231, `tests/e2e/options.spec.ts:160`) are grouping containers, not logic, and are not counted. |
| Lint-fence probes (ESLint API over the real `eslint.config.js`, the same method as `tests/unit/lint/fences.spec.ts`) | See TECH-2, TECH-3, TECH-4 and TECH-5. |
| `tsc` probe (scratch file extending `extension/tsconfig.json`) | `Buffer.from`, `process.env` and `NodeJS.Timeout` typecheck clean. They fail with `types: []` (TECH-6). |
| `eslint --print-config src/ledger/repo.ts` | `no-undef: off`; no `no-restricted-globals` (TECH-6) |

**Bundle size per entrypoint.** Measured from `extension/.output/chrome-mv3` (build 16:48:57). Each entrypoint counts its HTML plus every script, modulepreload and stylesheet it loads; each file is compressed with `gzip -9` and the results are summed. Source maps are excluded.

| Entrypoint | Raw | Gzipped | Budget |
|---|---|---|---|
| popup | 39,008 B | **13,411 B (13.1 KB)** | < 150 KB, PASS |
| sidepanel | 39,042 B | 13,440 B (13.1 KB) | — |
| options | 133,880 B | 41,089 B (40.1 KB) | — |
| background (service worker) | 106,795 B | 35,196 B (34.4 KB) | — |
| all `.map` files | 924,985 B | 227,520 B | — (79% of `.output` bytes; scheduled 7.0) |

## Checklist, item by item

### Architecture boundaries
| Item | Result | Evidence |
|---|---|---|
| `src/core` imports nothing from chrome, DOM, Dexie or adapters, enforced by ESLint | PASS | `eslint.config.js:27-118, 197-205`; proven by `tests/unit/lint/fences.spec.ts`. `src/core/tsconfig.json` sets `lib: ES2023`, `types: []`, so no DOM types are loaded (typecheck green). |
| Entrypoints thin | PASS, one LOW | `background.ts` only registers listeners; the install-then-alarms chain is TECH-8 |
| Adapters and observers pure over `Document`; no storage or bus in `extract()` | N/A (none exist yet) | The fence that should enforce this is missing: **TECH-2** |
| All cross-context messages typed in `src/bus` and Zod-validated | PASS in code, not enforced | grep finds no `sendMessage` or `onMessage` outside `src/bus`; nothing stops one: **TECH-4** |
| Policy values come from `policy/default.json` | PASS | `tests/unit/core/no-policy-literals.spec.ts` (AST scan of `src/` and `entrypoints/`) |

### Code quality
| Item | Result | Evidence |
|---|---|---|
| No `any`, no `as unknown as`, no unexplained `!` | PASS | grep over `src`, `entrypoints`, `bench`, `eslint-rules`, `tests`: none. `no-explicit-any` and `no-non-null-assertion` are errors. |
| No hardcoded hosts, ids or URLs | PASS | Hosts only at `src/config.ts:38-48`. Storage keys and alarm names come from config. |
| No duplicate logic | PASS, one LOW | TECH-12 (seed schemas), TECH-13 (mount code). Four deliberate duplicates are each pinned by a test and logged: `LedgerTable` ↔ `LEDGER_TABLE_NAMES` (`ledger-tables.spec.ts`, Decision [0.7]); `UiQueryKind` ↔ `UiQuery` kinds (`messages.spec.ts:35`); `ObservationFieldName` and `RuleOutcome` (Decisions [0.8]). Accepted. |
| TODO/FIXME | PASS | none |
| Typed errors that carry context and are never swallowed | PASS | `LedgerError`, `BusError`, `InstallIdError`, `PolicyError`, `CaptureError`. Every catch logs. |
| Functions ≤ 60 lines, files ≤ 400 lines | Files PASS; functions **TECH-11** | measurements above |
| Naming | PASS | kebab-case files, PascalCase components (one per file), UPPER_SNAKE constants, PascalCase Zod schemas |

### Determinism and data
| Item | Result | Evidence |
|---|---|---|
| No clock, randomness or model in `src/core` | PASS | `no-restricted-syntax` and `no-restricted-globals` (`eslint.config.js:66-118`) |
| Ids from content hashes where idempotency matters | PASS for the ledger | Upserts are idempotent on `&contentHash` and `&rawHash` inside one rw transaction (`repo.ts:99-126`). Receipt id from `inputsHash` is scheduled in 1.5. |
| Timestamps ISO with offset; money integer cents + currency | Schema PASS; **TECH-7** | `IsoTs = z.iso.datetime({offset:true})`, `amountCents` int, `currency` length 3. Which offset to use is undecided. |
| Dexie indexes exist for every query path | PASS | Each of the six repo queries uses an index: `[type+timeBucket]`, `*counterpartyTokens`, `[agent+date]` ×3, `observerId`. ISO-string time indexes are part of **TECH-7**. |

### Performance
| Item | Result | Evidence |
|---|---|---|
| No `toArray()` on unbounded tables | PASS except export | **TECH-10** (export). `observationsByCounterpartyToken` is deferred to 1.3 (Decisions [0.6]). |
| Content-script debounce | N/A | Scheduled in 2.0 (500 ms / 2 s) |
| `onStartup` only re-registers alarms | PASS | `background.ts:27-31` calls `ensureAlarms()` only. The ledger opens lazily (`getLedger`). |
| Bundle size reported; popup < 150 KB gzipped | PASS (13.1 KB) | No automated report: **TECH-16** |

### Consistency and docs
| Item | Result | Evidence |
|---|---|---|
| New messages, tables, policy fields and grades documented | Scheduled / **TECH-17** | Tables → `docs/privacy-architecture.md` v1 (2.9); policy fields and grades → `docs/grading.md` v1 (1.11); bus messages have no owner (TECH-17) |
| `Decisions.md` covers every unspecified choice | Mostly PASS | 140+ Sprint 0 entries. Missing: **TECH-18**, plus the offset choice in **TECH-7** |
| CHANGELOG updated under Unreleased | PASS | `CHANGELOG.md` `## [Unreleased]` lists every Sprint 0 deliverable |
| Tests follow §6 layout | PASS | `tests/{unit,property,e2e,fixtures,tools}`; `tests/golden/**` is already in `vitest.config.ts` for Sprint 1 |

### Telemetry-api
N/A until Sprint 5.

## Gaps

### TECH-1: CI on `main` is red because the build-artifact upload fails
- **Severity:** HIGH
- **What:** run `36923944944` (push of `b816bd4`) passes lint, typecheck, unit, build, `E2E (@mandatory)` and `E2E (rest)`, then fails at `Upload build`: `##[error]No files were found with the provided path: extension/.output/. No artifacts will be uploaded.` `actions/upload-artifact@v4` runs with `include-hidden-files: false` (shown in the step log), and `.output` is a dot-directory, so nothing matches. `if-no-files-found: error` then fails the job.
- **Where:** `.github/workflows/ci.yml:58-64`
- **Rule:** `sprints/sprint_0.md` 0.11 Done when "CI green on main"; Sprint 0 Gate "CI green".
- **Suggested fix:** add `include-hidden-files: true` to the `Upload build` step (and narrow `path` to `extension/.output/chrome-mv3/`). Push, then confirm `gh run list --limit 1` shows `success`. Optionally move the four actions off Node 20 at the same time; the run carries the deprecation annotation.

### TECH-2: code that runs in a vendor page's origin can import the ledger and use the page's storage
- **Severity:** HIGH
- **What:** each of these probes, linted with the real config, returns **0 messages**:
  ```
  entrypoints/content/gmail.content.ts   import { upsertObservation } from '../../src/ledger/repo';
  src/observers/gmail/extract.ts         import { getLedger } from '../../ledger/repo';
  src/observers/gmail/extract.ts         localStorage.setItem('k', doc.title)
  src/adapters/muse/extract.ts           indexedDB.open('attest'); sessionStorage.setItem('k', doc.title)
  src/adapters/muse/extract.ts           void send({...})            // bus call inside extract()
  src/adapters/muse/extract.ts           browser.storage.local.set({ k: 1 })
  ```
  Content scripts run in the vendor page's origin. If one imports the ledger (Dexie), or uses `indexedDB`, `localStorage` or `sessionStorage`, it writes derived facts into storage the vendor's own scripts can read. `DEXIE_RESTRICTION` only blocks a direct `import 'dexie'`, not an import of `src/ledger/*`, which imports Dexie itself. The no-leak test won't catch this either: it dumps IndexedDB from an extension page (`tests/e2e/support/channels.ts:22-48`), so it sees only the extension's origin. Sprint 2.0 writes the first code in these scopes.
- **Where:** `extension/eslint.config.js:10` (`ACT_SCOPES`), `:16-21` (`DEXIE_RESTRICTION`), `:164`, `:185-190`
- **Rule:** `tech_reviewer.md` "Adapters/observers are pure over `Document`; no storage, no bus access inside `extract()`"; build_spec §7 adapter contract; Hard Rules 1 and 2 (facts in vendor-readable storage have left Attest's control).
- **Suggested fix:**
  1. In the `ACT_SCOPES` block, add `no-restricted-imports` with `dexie`, `dexie/*` and the regex `(^|/)(ledger|background|crypto|telemetry|intel|ui)(/|$)`.
  2. In the same block, add `no-restricted-globals` for `indexedDB`, `localStorage`, `sessionStorage`, `caches`, `openDatabase` and `cookieStore`.
  3. For the per-vendor folders `src/adapters/*/**` and `src/observers/*/**`, where `extract()` and `health()` live, also forbid `bus` paths and `wxt/browser`. Leave `base.ts` and the content-script entry free to post: Sprint 2.0 makes `src/observers/base.ts` the skeleton that calls `bus.post()`.
  4. Add each probe above to `tests/unit/lint/fences.spec.ts` as a must-fail case.

  QA may also extend the no-leak dump to the fixture-page origin's storage.

### TECH-3: network calls are lint-fenced only in content, adapter and observer code
- **Severity:** MEDIUM (same finding as SECURITY-5)
- **What:** the network checks live inside `attest/no-act`, which applies only to `ACT_SCOPES`. Each of these probes returns 0 messages:
  - `await fetch('https://example.com/x')` in `src/background/alarms.ts`
  - `navigator.sendBeacon(...)` in `src/ledger/repo.ts`
  - `new WebSocket('wss://…')` in `entrypoints/options/main.tsx`
  - `void fetch(...)` in `entrypoints/background.ts`

  The only other guard is the network-intercept E2E, which sees only the paths its 5-minute session runs. It fires the purge alarm only; no error paths, no future grace or digest alarms, no options actions. A fetch anywhere else ships. I rate this above security's LOW because `extension_engineer.md` rule 6 is explicit ("The only `fetch` in the codebase lives in `src/telemetry/send.ts`"), and lint is the only check that covers code paths the session never runs.
- **Where:** `extension/eslint.config.js:10`, `:185-190`; `extension/eslint-rules/no-act.js:115-123`, `:219-244`
- **Rule:** Hard Rule 1; `extension_engineer.md` rule 6; `tech_reviewer.md` "verified by an ESLint rule, not by eye".
- **Suggested fix:** move the network detection out of `no-act` into a new rule, `attest/no-network`, reusing `NETWORK_IDENTIFIERS`, `sendBeacon` and the `Program:exit` scope analysis. Apply it to `src/**` and `entrypoints/**` with `noInlineConfig`. Exempt only `src/telemetry/send.ts` (5.7) and `src/intel/providers/**` (5.3) when they land, each with a `Decisions.md` line. Add probes for the background, ledger, options and popup scopes to `fences.spec.ts`.

### TECH-4: nothing stops ad-hoc runtime messaging outside `src/bus`
- **Severity:** MEDIUM
- **What:** `browser.runtime.sendMessage({ anything: 'goes' })` in `entrypoints/options/components/Foo.tsx` lints clean. `chrome.runtime.onMessage.addListener(...)` in `src/background/router.ts` trips only `no-console`. Today the code complies (grep: no `sendMessage` or `onMessage` outside `src/bus`), but only because nobody has written one. Sprints 2 to 4 add content scripts and UI pages that need messaging.
- **Where:** `extension/eslint.config.js:142-168` (global rules)
- **Rule:** `tech_reviewer.md` "no ad-hoc `chrome.runtime.sendMessage` with untyped objects"; `extension_engineer.md` rule 2.
- **Suggested fix:** add a global `no-restricted-syntax` entry. Its selector should match `MemberExpression` nodes whose property is `sendMessage`, `onMessage`, `onMessageExternal`, `connect`, `onConnect` or `onConnectExternal`, so it covers both `runtime.*` and `tabs.sendMessage`. Switch it off only for `src/bus/**` and `tests/**`, and add must-fail probes.

### TECH-5: `attest/top-level-listeners` misses listeners registered inside other event callbacks
- **Severity:** MEDIUM
- **What:** the rule treats only async or generator functions and callbacks of `then`, `catch`, `finally`, `setTimeout` and similar as deferred. Each of these probes returns 0 messages:
  ```
  chrome.runtime.onInstalled.addListener(() => { chrome.runtime.onMessage.addListener(onMessage); });
  function later() { chrome.alarms.onAlarm.addListener(onAlarm); } chrome.runtime.onStartup.addListener(later);
  chrome.storage.local.get('x', () => { listen(h); });
  ```
  All three register after the worker's first turn and are lost when the worker restarts. That is the MV3 bug the rule exists to catch. Sprint 4.6 (`notifications.onClicked`) is a likely first instance.
- **Where:** `extension/eslint-rules/top-level-listeners.js:11-20`, `:23-39`, `:59-80`; `extension/tests/unit/lint/top-level-listeners.spec.ts:21-50`
- **Rule:** `extension_engineer.md` service-worker checklist "No listener registered inside an async callback"; sprint 0.7 Done when.
- **Suggested fix:** treat any function passed as an argument to a call as deferred, unless the callee is a known synchronous invoker (`forEach`, `map`, `filter`, `some`, `every`, `reduce`) or the function is an IIFE. Also resolve identifiers passed to `addListener` (`onStartup.addListener(later)`) through scope analysis and check their bodies. Add the three probes as invalid RuleTester cases, and record any remaining blind spot in `Decisions.md`.

### TECH-6: browser code is type-checked against Node globals
- **Severity:** MEDIUM
- **What:** `extension/tsconfig.json:16` sets `"types": ["node"]` for the whole package. The WXT base config includes `../**/*`, so that covers `src/**` and `entrypoints/**`. A probe file using `Buffer.from('x')`, `process.env.HOME` and `NodeJS.Timeout` typechecks clean under this config and fails with `types: []`. ESLint does not compensate: the resolved config for `src/ledger/repo.ts` has `no-undef: off` and no `no-restricted-globals`. A Node-only API in the service worker or a UI page therefore passes `pnpm typecheck` and `pnpm lint` and fails only at runtime. `src/core` already fixed this for itself (`src/core/tsconfig.json`, Decision [0.8] on jsx/types).
- **Where:** `extension/tsconfig.json:16`; `extension/.wxt/tsconfig.json` (`include: ["../**/*"]`)
- **Rule:** §5 "TypeScript strict" (types must describe the runtime); Hard Rule 6 (fail at compile time, not at runtime).
- **Suggested fix:** make `extension/tsconfig.json` browser-only: `types: []`, excluding `tests/**`, `*.config.ts` and `eslint-rules/**`. Add `extension/tests/tsconfig.json` (extends it, `types: ["node"]`, includes `tests/**`) so typescript-eslint's `projectService` finds it. Cover the root config files via `allowDefaultProject` or a small `tsconfig.node.json`. Run every config in `pnpm typecheck`, as is already done for `src/core`.

### TECH-7: no rule for timestamp offsets: the local-date index is fed by a UTC clock, and ISO-string indexes sort wrongly across offsets
- **Severity:** MEDIUM
- **What:**
  - **(a) Date key versus clock.** The `[agent+date]` index stores `date = isoTs.slice(0, 10)`, documented as "the local date at the place it was recorded" (`index-fields.ts:55-58`; `repo.ts:197, 215, 234`). The only edge clock emits UTC: `systemClock = () => new Date().toISOString()` (`router.ts:13`). If Sprint 3.6 stamps `computedAt` with that clock, a receipt computed at 21:00 in New York (UTC−4) is keyed to the next day. Claims parsed with the page's local offset then land on a different key from their receipts, and the Sprint 4.2 "today's receipts" query misses or misplaces them.
  - **(b) String-ordered time indexes.** `observations.occurredAt` (`db.ts:37`) and `coverage.lastSyncAt` (`db.ts:41`) are indexed as ISO strings with varying offsets. For example, `'2026-10-01T23:30:00-05:00'` (04:30Z on the 2nd) sorts before `'2026-10-02T03:00:00Z'`. Any range query on these indexes, with the 2.6 retention purge the obvious first user, is off by up to ±14 h. Decisions [0.6] (DEFERRED to 2.6) notes this for coverage only.
  - **(c) No decision.** No `Decisions.md` entry says which offset edge clocks must emit.
- **Where:** `extension/src/background/router.ts:10-13`; `extension/src/ledger/index-fields.ts:55-58`; `extension/src/ledger/db.ts:37`, `:41`
- **Rule:** CLAUDE.md "Timestamps ISO 8601 with offset"; checklist "Determinism and data"; `Decisions.md` (every unspecified choice); Hard Rule 5 (evidence must not drop out of its window).
- **Suggested fix:**
  1. Decide one rule and log it in `Decisions.md`. Recommended: one `src/clock.ts` (an edge module, never imported by core) whose `nowIso()` emits the user's local offset (`2026-10-01T21:00:00.000-04:00`). Use it for every edge timestamp, including `router.ts`'s `systemClock`.
  2. Keep `dateKey` as the writer's local date and say so in `Decisions.md`.
  3. Before 2.6 uses them, replace the string time indexes with epoch-derived index fields (`occurredAtMs`, `lastSyncAtMs`), through the migration path `index-fields.ts:9-12` already describes.
  4. Unit-test that one instant written as `-05:00` and as `Z` orders identically, and that `dateKey` follows the documented rule.

### TECH-8: install and alarm orchestration lives in the entrypoint and couples two failures
- **Severity:** LOW
- **What:** `background.ts:19-25` chains `handleInstalled(details).then(() => resetAlarms())`. This has three problems:
  - If the install-id storage call rejects, `resetAlarms` never runs, so the purge alarm does not exist until the next browser start (`ensureAlarms`).
  - A `resetAlarms` failure is logged under the wrong event, `install.failed`.
  - `resetAlarms` also runs for `chrome_update` and `shared_module_update`, which `handleInstalled` deliberately skips, so every browser update restarts the 24-hour purge countdown.

  Unit tests cover the two functions separately but not the sequence.
- **Where:** `extension/entrypoints/background.ts:19-25`
- **Rule:** checklist "Entrypoints are thin: no business logic in `background.ts`"; `extension_engineer.md` "Business logic never lives in an entrypoint"; Hard Rule 6.
- **Suggested fix:**
  1. Add `onInstalled(details)` to `src/background/install.ts`. It runs `ensureInstallId()` and `resetAlarms()` independently (`Promise.allSettled`) and logs each failure under its own event (`install.id_failed`, `alarm.reset_failed`).
  2. Reset alarms only for `install` and `update`.
  3. Reduce `background.ts` to `void onInstalled(details)`.
  4. Unit-test both failure paths.

### TECH-9: expected broadcast drops log at `warn` (Decision [0.7] asked tech review to revisit this)
- **Severity:** LOW
- **What:** `runtime.sendMessage` reaches every extension context except the sender. Once Sprint 4 pages call `listen()` for `ledger.changed`, two kinds of normal traffic will log warnings:
  - Every `adapter.claims`, `observer.observations` or `coverage.ping`, and every other page's `ui.query`, that reaches an open page logs `warn bus.dropped reason=no_handler` there (`listen.ts:69-73, 132`).
  - Every `ledger.changed` sent while no UI page is open logs `warn bus.send_failed` with `BusError no_receiver` (`send.ts:44-49`).

  This noise will hide real warnings.
- **Where:** `extension/src/bus/listen.ts:69-73`, `:132`; `extension/src/bus/send.ts:44-49`; `Decisions.md` [0.7] "Bus log noise … revisit at tech review"
- **Rule:** Hard Rule 6 (failing loud only works if `warn` means something).
- **Suggested fix:**
  1. Log `no_handler` at `debug`; keep `warn` for `foreign_sender`, `malformed` and `untrusted_context`.
  2. Give `send()` a broadcast set (`BROADCAST_TYPES = ['ledger.changed']`) or an option, so a `no_receiver` on those types logs at `debug`.
  3. Update the [0.7] `Decisions.md` entry with this resolution, and adjust `listen.spec.ts` and `send.spec.ts`.

### TECH-10: the full-ledger export reads every table unbounded and ships it as one runtime message
- **Severity:** LOW
- **What:** `exportLedger` reads all eight tables with `toArray()` in one transaction (`export.ts:73-87`). Its only runtime caller returns the result as a single `ui.result` over runtime messaging (`router.ts:18-24`). At the Sprint 6.4 scale (5,000 claims, 50,000 observations, an IndexedDB of up to 50 MB), the worker holds several copies: the rows, the Zod-parsed objects and the serialised message. The message itself approaches Chrome's 64 MiB message limit. This is harmless with Sprint 0's empty ledger.
- **Where:** `extension/src/ledger/export.ts:73-87`; `extension/src/background/router.ts:18-24`
- **Rule:** checklist "Ledger reads paginated in UI; no `toArray()` on unbounded tables".
- **Suggested fix:**
  1. Record the export as the one accepted full read in `Decisions.md` now.
  2. In 4.5, build the export in the options page (same extension origin) with paged Dexie reads (`offset`/`limit`, or `each`) streamed into a `Blob`. Keep `ledger.export` over the bus only for the test harness, or replace it with a paged query.
  3. Add a size test at 6.4 scale.

### TECH-11: two functions over 60 lines
- **Severity:** LOW
- **What:**
  - `eslint-rules/no-act.js:162-246` `create` is 85 lines, with five visitors inline.
  - The negative-control test body `tests/e2e/no-leak.spec.ts:126-188` is 63 lines, including a 20-line inline IndexedDB writer at `:145-165`.
- **Where:** `extension/eslint-rules/no-act.js:162-246`; `extension/tests/e2e/no-leak.spec.ts:126-188`
- **Rule:** checklist "Functions ≤ 60 lines".
- **Suggested fix:**
  - Extract the visitors into named functions taking `(context, node)`: `checkCall`, `checkNew`, `checkAssignment`, `checkMember`, `reportNetworkGlobals`. This also eases the TECH-3 split.
  - Move the probe writer into `tests/e2e/support/channels.ts` as `plantIndexedDbProbe(page, value)`.

### TECH-12: `seeded.json` has two schemas and two loaders that disagree
- **Severity:** LOW
- **What:** two modules each define a path constant, a Zod schema and a loader for the same file, with different rules:

  | | `tests/e2e/support/leaks.ts:17-45` | `tests/tools/capture-output.ts:18-36, 78-90` |
  |---|---|---|
  | Object schema | strict, `version: 1` | not strict |
  | Seeds | exactly 15 | at least 1, unique ids |
  | `id` | any non-empty string | `/^[a-z0-9_]+$/` |
  | `value` | ≥ 8 chars | ≥ 1 char |
  | `canaries` | each ≥ 6 chars | default `[]` |
  | `kind` | required | ignored |

  An edit to `seeded.json` can pass one loader and fail the other: a 16th seed, a hyphenated id, a seed without canaries.
- **Where:** `extension/tests/e2e/support/leaks.ts:17-45`; `extension/tests/tools/capture-output.ts:18-36`, `:78-90`
- **Rule:** checklist "no duplicate logic; shared helpers".
- **Suggested fix:** create one module (e.g. `tests/tools/seeds.ts`) that exports `SEEDS_PATH`, a single strict schema meeting both sets of rules, and sync and async loaders. Make `leaks.ts` and `capture-output.ts` import it.

### TECH-13: popup and side-panel bootstraps fail silently; three copies of the mount code
- **Severity:** LOW
- **What:** `popup/main.tsx:8-9` and `sidepanel/main.tsx:8-9` do `if (root) render(...)` with no else, so a missing `#app` gives a blank page with no log. `options/main.tsx:9-14` logs `options.root_missing`. Otherwise the three files are copies.
- **Where:** `extension/entrypoints/popup/main.tsx:8-9`; `extension/entrypoints/sidepanel/main.tsx:8-9`; `extension/entrypoints/options/main.tsx:9-14`
- **Rule:** Hard Rule 6 (fail loud); checklist "no duplicate logic".
- **Suggested fix:** add `src/ui/mount.ts` with `mount(App, surface)`, which renders or logs `ui.root_missing {surface}`. Each `main.tsx` becomes the `setup` import (still first, enforced by `setup.spec.ts`), the CSS import and one `mount` call.

### TECH-14: `action.default_title` in `wxt.config.ts` is dead config
- **Severity:** LOW
- **What:** `wxt.config.ts:23-25` sets `'Attest: receipts for your AI agents'`, but the built `manifest.json` has `"default_title":"Attest"`. WXT copies the popup's `<title>` over it (`node_modules/wxt/dist/core/utils/manifest.mjs:139`), so the toolbar tooltip is not what the config says.
- **Where:** `extension/wxt.config.ts:23-25`; `extension/entrypoints/popup/index.html:6`
- **Rule:** consistency (config must describe the shipped manifest).
- **Suggested fix:** delete the `action` block from `wxt.config.ts` and set the tooltip where WXT reads it: `<meta name="manifest.default_title" content="…">` or the popup `<title>`. Assert `action.default_title` in a test of the built manifest.

### TECH-15: the `RESULTS.md` generator trusts result files through a type cast
- **Severity:** LOW
- **What:** `bench/run_bench.ts:33-35` reads each results file with `JSON.parse(...) as BenchResult`. A malformed or hand-edited result file then renders `Measured undefined` or `[object Object]` into `RESULTS.md` instead of failing. This is the Hard Rule 12 pipeline, and it starts carrying numbers in Sprint 1.
- **Where:** `bench/run_bench.ts:16-21`, `:33-35`
- **Rule:** CLAUDE.md "parse at every boundary"; Hard Rule 12.
- **Suggested fix:** validate each file with a Zod schema:
  - `metrics` is `record(string, number | boolean)`;
  - `date` matches the date in the file name;
  - `command` is non-empty.

  Add `zod` to the root `devDependencies` (or write a type guard). Throw with the file name on failure, and add a unit test with one bad file.

### TECH-16: bundle sizes are not measured anywhere in the repo
- **Severity:** LOW
- **What:** no script, bench or CI step records size per entrypoint or checks the popup's < 150 KB gzipped budget. The table above exists only in this review. Sprint 6.4 (performance) does not cover bundle size.
- **Where:** `bench/run_bench.ts:24` (`BENCHES` is empty); `.github/workflows/ci.yml:41-42`
- **Rule:** checklist "Bundle size per entrypoint reported; popup < 150 KB gzipped"; Hard Rule 12.
- **Suggested fix:**
  1. Add `bench/bundle-size.ts` and register it in `BENCHES`.
  2. For each entrypoint, it sums the gzipped size of the HTML plus every file it references (script, modulepreload, stylesheet), excluding `.map`.
  3. It writes `bench/results/bundle-<date>.json`.
  4. Add a CI step after `Build` that fails when the popup exceeds 150 KB gzipped.

### TECH-17: no doc task owns the catalogue of bus messages
- **Severity:** LOW
- **What:** the seven message types (`src/bus/messages.ts:28-36`) are documented only in TSDoc. Scheduled docs cover tables and allowlists (`docs/privacy-architecture.md` v1, task 2.9) and grades, rules and policy fields (`docs/grading.md` v1, task 1.11). `docs/adapters.md` v1 (2.9) covers "the contract", but no task names `ui.query`, `ui.result` or `ledger.changed`, the respond-once protocol, or the four drop reasons.
- **Where:** `extension/src/bus/messages.ts:28-36`; `docs/adapters.md:5`
- **Rule:** checklist "Every new bus message, table, policy field, or grade documented in `docs/grading.md` or `docs/adapters.md`".
- **Suggested fix:** add a "Message bus" section to `docs/adapters.md` now: a table of type, sender context, receiver, payload schema, response and drop reasons. Alternatively, add "every `BusMessageType` appears in `docs/adapters.md`" to 2.9's Done when, so `scripts/check-docs.ts` can enforce it.

### TECH-18: `Decisions.md` is missing four Sprint 0 choices
- **Severity:** LOW
- **What:** there is no entry for:
  1. `LEDGER_TIME_BUCKET_MINUTES = 60` (`config.ts:30`). Decision [0.6] says changing it needs a migration, not why 60 was chosen.
  2. The purge alarm's 24-hour period, with its first run 24 hours after every install or update (`config.ts:86`, `alarms.ts:38, 47`). Decision [0.4] covers scheduling the alarm, not its period or delay, nor that updates restart it.
  3. The default log level `info`, with no runtime switch, so `log.debug` lines (for example `install.skipped`) never print in a shipped build (`log.ts:131`).
  4. The options page opening in a tab (`options/index.html:7`).

  The edge-clock offset choice is TECH-7.
- **Where:** `extension/src/config.ts:30`, `:86`; `extension/src/background/alarms.ts:38`, `:47`; `extension/src/log.ts:131`; `extension/entrypoints/options/index.html:7`
- **Rule:** checklist "`Decisions.md` has an entry for every unspecified choice made this sprint"; CLAUDE.md.
- **Suggested fix:** append four dated entries, each with its reason and the Hard Rule it protects (or "none").

## Scheduled for later sprints (not Sprint 0 gaps)

- `docs/grading.md`: task 1.11. `docs/privacy-architecture.md`: 2.9 (v1), 5.9, 7.2. `docs/threat-model.md`: 6.8.
- The placeholder schemas in `src/ledger/types.ts` and the `ObservationFieldName`/`RuleOutcome` copies move into `src/core/schema.ts` in 1.0 (Decisions [0.8]). A note for 1.0: §7 has `currency: z.string().length(3)`, which accepts `"ab1"`; consider `/^[A-Z]{3}$/`.
- `Receipt.agent`: 1.0 (Decisions [0.6]). Receipt id derived from `inputsHash`: 1.5.
- `observationsByCounterpartyToken` is unbounded until 1.3 (Decisions [0.6]). Coverage history and an epoch index: 2.6 (Decisions [0.6]; TECH-7 extends the same fix to `occurredAt`).
- MutationObserver debounce: 2.0. Paginated UI reads with every query on an index: 4.0.
- `pnpm attest` points at `tests/tools/attest-cli.ts`, which does not exist yet. 1.9 schedules it ("later exposed as `pnpm attest replay`"). Until then the command fails with module-not-found.
- Source maps make up 79% of the bytes in `.output/chrome-mv3` (925 KB raw). Whether they go in the store zip or only in CI artifacts is decided in 7.0.
- Benchmarks with numbers: Sprint 1 onward. `RESULTS.md` correctly says none have been measured.

## Verified clean (no action)

- No `any`, `as unknown as`, `!` or TODO/FIXME in `src`, `entrypoints`, `bench` or `eslint-rules`.
- Hosts appear only in `src/config.ts:38-48`. The built manifest has `host_permissions: []`, permissions `storage`, `alarms` and `sidePanel`, and the strict CSP.
- `src/core` is protected three ways: lint fences, its own tsconfig without DOM types, and the AST no-literals test. `DEFAULT_POLICY` is deep-frozen and fails loudly at load.
- Each repo query uses an index. Upserts are idempotent and happen inside one rw transaction. Reads strip index fields and Zod-parse, and corrupt rows are skipped and logged by id only.
- The worker registers `listen()` and three listeners synchronously in `main()`, `onStartup` only ensures alarms, and the ledger opens lazily.
- `CHANGELOG.md` Unreleased is current. The test layout matches §6.

## Verification (adversarial)

**Verifier:** adversarial pass over this review · **Date:** 2026-10-01 · **Mode:** read-only on code (this section is the only change). I re-ran each probe through the real `extension/eslint.config.js` (ESLint API; type-aware where noted, otherwise the same type-check-off override as `tests/unit/lint/fences.spec.ts`), re-read every cited line, and checked `Decisions.md`, `sprints/sprint_1..7.md` and `security.md` before confirming anything. Severity follows `agents/sprint_closer.md`: anything touching Hard Rules 1–4 is CRITICAL, even when no violating code exists yet.

**Re-run state:** `pnpm lint` exit 0. `pnpm typecheck` exit 0. `pnpm test`: 830 tests, 828 passed and 2 failed. Both failures are in QA's untracked, in-progress `tests/unit/log.spec.ts` (`api_key_aws_shape` and `url_with_token` "as a field key"), which is SECURITY-1 territory and not a tech gap. `gh run view 36923944944` still shows `Upload build` failed with `include-hidden-files: false`. Local `main` is 1 commit ahead of `origin/main`.

### Verdicts on TECH-1 … TECH-18

| Id | Verdict | Severity (re-rated) | Kind | Evidence / reason |
|---|---|---|---|---|
| TECH-1 | CONFIRMED | HIGH | CODE | `ci.yml:58-64` has no `include-hidden-files`. Run log: `include-hidden-files: false`, then `##[error]No files were found with the provided path: extension/.output/`. Every other step passed. Blocks the Gate ("CI green"). The fix is in code, but proving it needs a push (main is 1 ahead of origin). |
| TECH-2 | CONFIRMED | **CRITICAL** (was HIGH; HR1, HR2) | CODE | All six probes return 0 messages: `import {upsertObservation} from '../../src/ledger/repo'` in `entrypoints/content/gmail.content.ts`, `getLedger`, `localStorage.setItem`, `indexedDB.open` + `sessionStorage`, bus `send()` and `browser.storage.local.set` in `src/{adapters,observers}/*/extract.ts`. Only a direct `import Dexie` fires (`no-restricted-imports`). `channels.ts:22-55` dumps storage from an extension page only. No later task adds this fence: 2.0 and 3.0 only require "`no-act` lint green". |
| TECH-3 | CONFIRMED | **CRITICAL** (was MEDIUM; HR1) | CODE | 0 messages for `fetch` in `src/background/alarms.ts`, `navigator.sendBeacon` in `src/ledger/repo.ts`, `new WebSocket` in `entrypoints/options/main.tsx`, `fetch` in `entrypoints/background.ts`, and `new XMLHttpRequest` in `src/bus/send.ts`. Same finding as SECURITY-5: one fix closes both. |
| TECH-4 | CONFIRMED | MEDIUM | CODE | 0 messages for `browser.runtime.sendMessage({anything:'goes'})` in an options component, `browser.runtime.onMessage.addListener` in `router.ts`, and `browser.tabs.sendMessage` / `runtime.connect()` in `popup/App.tsx`. Grep confirms that no call exists outside `src/bus` today. Fix caveat: in flat config a later block's `no-restricted-syntax` *replaces* an earlier one, so the `src/core/**` block (`eslint.config.js:203`) drops the global selector. That is harmless there because `chrome` and `browser` are banned globals, but any future block that sets the rule must re-include it. |
| TECH-5 | CONFIRMED | MEDIUM | CODE | 0 messages for all three probes: `onInstalled.addListener(() => { onMessage.addListener(...) })`, `function later(){ onAlarm.addListener(...) } onStartup.addListener(later)`, and `storage.local.get('x', () => { listen(h) })`. The async and `.then` variants are caught. Another blind spot: `self.addEventListener('message', …)` inside a `.then` callback also returns 0, because the rule matches only `addListener`. Fix caveat: `defineBackground({ main() {…} })` is safe under "function passed as a call argument is deferred", since `main` is an object-literal method. A `defineBackground(() => …)` form would need allow-listing. |
| TECH-6 | CONFIRMED | MEDIUM | CODE | `extension/tsconfig.json:16` has `"types": ["node"]`, and `.wxt/tsconfig.json` includes `../**/*`. I wrote a scratch probe (`Buffer.from`, `process.env`, `NodeJS.Timeout`) and typechecked it with configs extending `extension/tsconfig.json`: exit 0 with the shipped types, and TS2591/TS2503 with `types: []`. `--print-config src/ledger/repo.ts`: `no-undef` off, no `no-restricted-globals`. No Decisions entry covers it. |
| TECH-7 | CONFIRMED IN PART | LOW (was MEDIUM) | CODE | (a) and (c) hold. `router.ts:13` `systemClock = () => new Date().toISOString()` emits `Z`. `index-fields.ts:55-58` documents `dateKey` as "the local date at the place it was recorded". No Decisions entry picks the edge-clock offset. **(b) is REFUTED as a new gap:** `Decisions.md:117` ([0.6] DEFERRED to 2.6) already says "add an epoch-ms index for range queries (occurredAt/lastSyncAt are ISO strings with varying offsets)". It covers `occurredAt`, not only coverage. Downgraded because today the only clock-stamped value (`exportedAt`) is not date-keyed, and `Z` is a valid ISO offset (CLAUDE.md is not violated). The mismatch first bites at 3.6 and 4.0/4.2. Fix: steps 1, 2 and 4 of the suggestion. Step 3 is already scheduled. |
| TECH-8 | CONFIRMED | LOW | CODE | `background.ts:19-25` chains `handleInstalled(details).then(() => resetAlarms())`. A rejection skips `resetAlarms`, and only `onStartup` → `ensureAlarms` repairs it. A `resetAlarms` error is logged as `install.failed`. `handleInstalled` *resolves* `'skipped'` for `chrome_update` and `shared_module_update`, and `'ignored'` for malformed details, so `resetAlarms` still runs and `alarms.create` replaces the purge alarm (countdown restarts). `Decisions.md:94` says alarms are reset "on install/update". `install.spec.ts:105-130` tests the wiring but never asserts alarms. |
| TECH-9 | CONFIRMED | LOW | CODE | `listen.ts:71` logs every drop at `warn`, including `no_handler` (`:132`). `send.ts:47` logs `warn bus.send_failed`. `Decisions.md:137` ([0.7]) says "revisit at tech review", which makes this the required resolution. No noise today: only the worker calls `listen()`, and nothing sends `ledger.changed` until 2.7. |
| TECH-10 | CONFIRMED | LOW | SCHEDULED_LATER_SPRINT (4.5 Export; 6.4 scale) | `export.ts:78-85` runs eight `toArray()` calls, and `router.ts:18-24` returns the result in one `ui.result`. `Decisions.md:127` ([0.6]) already records the single-transaction full read, so fix step 1 is mostly done. The scale problem only exists once 4.5 ships a user export, and 6.4 is the 50k-observation test that should cover it. Nothing needs doing in Sprint 0. |
| TECH-11 | CONFIRMED | LOW | CODE | My own TypeScript-API scan matches: `no-act.js:162-246` `create` is 85 lines and `no-leak.spec.ts:126-188` is 63. The only other function over 60 lines is in QA's untracked `worker-lifecycle.spec.ts:86-173` (88), which belongs to QA. |
| TECH-12 | CONFIRMED | LOW | CODE | The schemas differ exactly as tabled (`leaks.ts:22-33` vs `capture-output.ts:22-36`). Fix caveat: `capture-fixture.ts:108` accepts `--seeds <path>` (`capture-args.ts:45`), so the shared module should export one base seed schema. The "`version: 1`, exactly 15" refinement belongs to the mandatory-test loader only, or custom seed files break. |
| TECH-13 | CONFIRMED | LOW | CODE | In `popup/main.tsx:8-9` and `sidepanel/main.tsx:8-9`, `if (root) render(...)` has no else. `options/main.tsx:12-13` logs `options.root_missing`. |
| TECH-14 | CONFIRMED | LOW | CODE | Built `manifest.json` has `"action":{"default_title":"Attest",…}`, but `wxt.config.ts:23-25` says `'Attest: receipts for your AI agents'`. `wxt/dist/core/utils/manifest.mjs:135-145` rebuilds `manifest.action` from the popup entrypoint options. |
| TECH-15 | CONFIRMED | LOW | CODE | `run_bench.ts:34` has `JSON.parse(...) as BenchResult` with no validation. Note that `BenchResult.metrics` already allows `string` (`:20`). The fix's schema should decide that deliberately. |
| TECH-16 | **REFUTED** | — | — | The checklist item ("Bundle size per entrypoint reported; popup < 150 KB gzipped") is met by this review's per-entrypoint table. I re-measured the current build: popup 13,422 B gzipped. Hard Rule 12 binds figures in README and docs, and none exist. No rule or task requires automating it in Sprint 0. A `bench/bundle-size.ts` is a reasonable optional improvement, not a gap. |
| TECH-17 | CONFIRMED | LOW | CODE | `docs/adapters.md` mentions no bus message (grep for `ui.query`, `ledger.changed` and `message` returns nothing relevant), and `scripts/` does not exist. Task 2.9 covers "the contract" but names neither `ui.*` nor `ledger.changed`, so the checklist line "Every new bus message … documented" fails for the seven Sprint 0 types. |
| TECH-18 | CONFIRMED | LOW | CODE | Grep of `Decisions.md` for bucket, period, 24, log level, debug, `open_in_tab` and tab finds none of the four choices. `config.ts:30` is `60`. `config.ts:86` is `24 * 60`. `alarms.ts:38,47` set `delayInMinutes = period`. `log.ts:131` `let currentLevel: LogLevel = 'info'` (`setLogLevel` is never called outside tests). `options/index.html:7` `<meta name="manifest.open_in_tab" content="true">`. |

### Gaps the review missed

#### TECH-V1: the `src/core` determinism fence is bypassable, and environment-dependent time and locale APIs are unfenced
- **Severity:** CRITICAL (Hard Rule 4) · **Kind:** CODE
- **Evidence:** I linted these with the full type-aware config, using `src/core/policy.ts` as the virtual path. Each returns **0 messages**:
  ```
  const { now } = Date; export const t = now();
  const r = Math.random; export const x = r();
  const { random } = Math; export const x = random();
  export const t = Reflect.apply(Date.now, Date, []);
  export const hour = (s: string) => new Date(s).getHours();            // host time zone
  export const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;    // host time zone
  [...a].sort((x, y) => x.localeCompare(y));                             // host locale
  new Date(s).toLocaleDateString();                                      // host locale + zone
  Date.parse(s.slice(0, 19));                                            // offset stripped → local time
  ```
  `Date['now']()` and `Math['random']()` are flagged only incidentally by `@typescript-eslint/dot-notation`. `CORE_RESTRICTED_SYNTAX` (`eslint.config.js:89-118`) matches only direct `Date.now()` and `Math.random()` *calls*. `CORE_RESTRICTED_GLOBALS` (`:66-87`) does not list `Intl`. `src/core/tsconfig.json` (`lib: ES2023`) types all of these. If `grade()` or `normalize.time()` (1.1) used a local-time getter or a default-locale compare, it would grade differently on the founder's machine than in CI (UTC), and replay would not reproduce receipts across machines. The Sprint 1 Gate's grep for `Date.now|Math.random` catches some aliases but not destructuring, `Intl` or local getters. The "Timezone edge" golden scenario runs in one zone only.
- **Where:** `extension/eslint.config.js:66-118`; `extension/src/core/tsconfig.json`
- **Rule:** Hard Rule 4; tech_reviewer "no `Date.now`, `Math.random` … inside `src/core` (grep + lint rule)"; ledger_engineer rule 1.
- **Suggested fix:**
  1. Add `Intl` to `CORE_RESTRICTED_GLOBALS`.
  2. Make the Date/Math selectors match any reference, not only calls: `MemberExpression[object.name='Date'][property.name='now']`, `MemberExpression[object.name='Math'][property.name='random']`, `MemberExpression[object.name=/^(Date|Math|Reflect)$/][computed=true]`, and `VariableDeclarator[init.name=/^(Date|Math)$/]` (destructuring).
  3. Ban local-time and locale members: `MemberExpression[property.name=/^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$|^getTimezoneOffset$|^toLocale|^localeCompare$/]`.
  4. Add the probes as must-fail cases in `fences.spec.ts`.
  5. Run the core property tests under two `TZ` values (for example `TZ=Pacific/Kiritimati` and `TZ=America/St_Johns`) in CI.
  6. Log the extension of the [0.2] fence in `Decisions.md`.

#### TECH-V2: web storage is unfenced in every extension context, and the no-leak test cannot see it
- **Severity:** CRITICAL (Hard Rule 2) · **Kind:** CODE
- **Evidence:** No rule outside `src/core/**` restricts `localStorage`, `sessionStorage`, `caches` or `cookieStore`. Type-aware probes `sessionStorage.getItem('k')` in `src/ledger/repo.ts` and `localStorage.setItem('k', document.title)` in `src/background/alarms.ts` both return 0 messages. `tests/e2e/support/channels.ts:22-55` reads the ledger export, IndexedDB and `chrome.storage.{local,session,sync}`, but not the extension origin's `localStorage`, `sessionStorage` or CacheStorage (grep of `tests/e2e` for them: none). Example: a Sprint 4 options or side-panel component that caches a receipt, a draft Grant or a counterparty in `localStorage` passes lint and the `@mandatory` secret-seed test. That breaks §5 "IndexedDB via Dexie … `chrome.storage.local` only for small flags and the install id". This is separate from TECH-2, which covers only the vendor-origin scopes.
- **Where:** `extension/eslint.config.js:142-168` (no storage globals restriction); `extension/tests/e2e/support/channels.ts:22-55`
- **Rule:** Hard Rule 2; build_spec §5 Storage; tech_reviewer "verified by an ESLint rule, not by eye".
- **Suggested fix:**
  1. Apply TECH-2's `no-restricted-globals` (`localStorage`, `sessionStorage`, `caches`, `cookieStore`, `openDatabase`) to all of `src/**` and `entrypoints/**`, and `indexedDB` everywhere except `src/ledger/**` and `src/crypto/**`.
  2. Have QA add `localStorage`, `sessionStorage` and CacheStorage dumps from an extension page to `collectStorageChannels`, with a negative-control plant for each.
  3. Add must-fail probes.

#### TECH-V3: service-worker code is linted and type-checked as if it had a DOM
- **Severity:** MEDIUM · **Kind:** CODE
- **Evidence:** Type-aware probes return **0 messages**:
  - `window.alert`, `document.title` and `localStorage` in `src/background/alarms.ts`
  - `document.createElement` and `new XMLHttpRequest()` in `entrypoints/background.ts`

  Typecheck also passes, because `.wxt/tsconfig.json` sets `lib: [ESNext, DOM, DOM.Iterable]` for the whole package and `eslint.config.js:146` gives every file `globals.browser`. An MV3 service worker has none of these, so they throw `ReferenceError` only when the code path runs. This is the DOM twin of TECH-6. Sprints 3.6 (grading wiring) and 4.6 (notifications) add worker code.
- **Where:** `extension/eslint.config.js:146`, `:191-196`; `extension/.wxt/tsconfig.json` (`lib`)
- **Rule:** build_spec §5 TypeScript strict (types must describe the runtime); Hard Rule 6.
- **Suggested fix:** for `entrypoints/background.ts` and `src/background/**`, set `globals: globals.serviceworker` and add `no-restricted-globals` for `window`, `document`, `localStorage`, `sessionStorage`, `XMLHttpRequest` and `alert`. Do the same for `src/ledger/**` and `src/bus/**`, which run in both the worker and pages. Optionally add a `src/background/tsconfig.json` with `lib: [ES2023, WebWorker]` to `pnpm typecheck`. Land it together with TECH-6.

#### TECH-V4: `no-console` is the only fence for "logging only via `src/log.ts`" and it is bypassable
- **Severity:** LOW · **Kind:** CODE
- **Evidence:** Type-aware probes return 0 messages for:
  - `window.console.log(x)` and `globalThis.console.info(x)` in `src/background/router.ts`
  - `const c = console; c.log(x)`
  - `const { log: out } = console; out(x)` in `entrypoints/options/main.tsx`

  A bare `console.log(x)` is caught. The 0.10 Done-when ("`console.log` outside `src/log.ts` fails lint") is met only literally. The `@mandatory` no-leak test captures console output, but only on the code paths its session runs.
- **Where:** `extension/eslint.config.js:154`
- **Rule:** CLAUDE.md "Logging only via `src/log.ts`"; Hard Rule 10.
- **Suggested fix:** add `no-restricted-globals: console` (catches every reference, including aliasing) and `no-restricted-properties` for `window.console`, `globalThis.console` and `self.console`. Switch both off for `src/log.ts` and `tests/**` exactly where `no-console` is off today. Add must-fail probes.

#### TECH-V5: Vitest silently skips `*.spec.tsx`
- **Severity:** LOW · **Kind:** CODE
- **Evidence:** `extension/vitest.config.ts` has `include: ['tests/unit/**/*.spec.ts', 'tests/property/**/*.spec.ts', 'tests/golden/**/*.spec.ts']`. No `.tsx` test exists today. Sprint 4's component tests (popup, side panel, Grants editor) are the natural `.spec.tsx` files, and they would never run. A test that never runs passes silently, against Hard Rule 6 and qa_tester rule 10.
- **Where:** `extension/vitest.config.ts:9`
- **Rule:** Hard Rule 6; build_spec §6 test layout.
- **Suggested fix:** use the include pattern `tests/{unit,property,golden}/**/*.spec.{ts,tsx}`. Add a unit test that globs `tests/{unit,property,golden}/**/*.{spec,test}.*` and asserts every match is covered by the include pattern.

### Net result for the closer
- **CRITICAL:** TECH-2, TECH-3 (same as SECURITY-5), TECH-V1, TECH-V2. All four are lint or test fences for Hard Rules 1, 2 and 4. No code violates them today.
- **HIGH:** TECH-1. This is the Gate blocker.
- **MEDIUM:** TECH-4, TECH-5, TECH-6, TECH-V3.
- **LOW:** TECH-7 (downgraded), TECH-8, TECH-9, TECH-11 … TECH-15, TECH-17, TECH-18, TECH-V4, TECH-V5.
- **Scheduled:** TECH-10 (4.5 / 6.4).
- **Refuted:** TECH-16. TECH-7 (b) is refuted as a new gap; it is already deferred to 2.6 in `Decisions.md:117`.
