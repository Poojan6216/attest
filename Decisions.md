# Decisions.md — Attest

Every decision the spec left open, or that changed a locked decision, goes here. Format: date, decision, reason, Hard Rule it protects (if any), who/what triggered it. Newest at the bottom of each section. Never delete an entry; supersede it.

## Locked by build_spec.md (2026-10-01)

- Product: local-first Chrome extension that verifies agent claims against the user's own Gmail/Calendar tabs; never acts; nothing leaves the browser. Reason: trust gate (users burned by Muse will not grant server-side Gmail access) and Google restricted-scope gate (CASA assessment) both cleared by the in-browser shape. Protects HR1, HR3.
- Name: **Attest**. Reason: founder's choice from Receipt / Attest / Vouch.
- Platform: Chrome MV3 via WXT; Chromium browsers for free; Firefox/Safari deferred. Reason: single build, store reach.
- Language/typing: TypeScript 5 strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; no `any` in `src/core`.
- UI: Preact + Tailwind; no router or state library (the ledger is the state).
- Storage: Dexie over IndexedDB, versioned migrations; `chrome.storage.local` only for flags + install id.
- Schemas: Zod at every boundary. Reason: HR2, HR4 (parse, don't trust).
- Tests: Vitest + fast-check; Playwright against locally served fixture pages; two `@mandatory` tests (network intercept, secret seed) from Sprint 0.
- Lint: ESLint strict + custom `attest/no-act` + `no-restricted-imports` fencing `src/core`. Protects HR3, HR4.
- Package manager: pnpm; Node 22 LTS.
- Adapters: fixture-driven, versioned `selectors.json`, `health()` before `extract()`, read-only. Protects HR3, HR6.
- Grading: pure `grade()`; policy as data in `policy/default.json`; first-match-wins rules; terminal `default_unverifiable`. Protects HR4, HR5.
- Optional model: Chrome built-in on-device first, BYO key second, both off by default, advisory only with capped weight and a monotonicity property test. Protects HR4.
- Telemetry: opt-in, off by default, counts/booleans/enums + random install id only, one host, FastAPI + Pydantic (`extra='forbid'`) + motor on Railway. Protects HR1, HR10.
- Encryption at rest: optional passphrase, AES-GCM, PBKDF2 ≥ 600k iterations, hashes plaintext for indexing. Off by default.
- v1 adapters: Muse (web), ChatGPT (agent mode) with Dots behind `ATTEST_DOTS=1` until a fixture exists, Claude.ai. Instinct and Perplexity Computer deferred to v2.
- v1 observers: Gmail web (Sent + opened receipts), Google Calendar web. No Gmail API, no Plaid, no Outlook (v2).
- Default Grants: permissive (all types, no ceiling, no allowlist) so first run produces receipts; user tightens in options.
- Retention: 90 days default (30/90/180 selectable).
- License: Apache-2.0. Repo: `github.com/Poojan6216/attest`, public from first commit.
- Versioning: SemVer; `0.1.0` = store launch; Conventional Commits.
- Sprints: 8, self-paced, each closed by QA → Security → Tech → Closer, outputs in `reviews/sprint_N/`.
- Out of scope for v1 (do not build): accounts, sync, paid tier, mobile, Firefox/Safari, Gmail API, bank links, analytics SDKs, any acting feature, recovery actions.

## Open questions (resolve during the build; log the answer here)

- Muse web app exact host for `host_permissions` → confirm in Sprint 2/3 (MANUAL.md).
- Chrome built-in model API name/availability on the founder's Chrome → log in Sprint 5.2.
- Whether `tabs` permission is needed for the opt-in auto-check Gmail tab → verify in Sprint 4.9.
- Vendor terms readings (Meta, OpenAI, Anthropic, Google) → Sprint 3.10 entries.
- Model default after `bench/intel.ts` → Sprint 5.5 entry.

## Sprint log

(agent appends here: `- YYYY-MM-DD [N.M] decision — reason — rule`)
- 2026-10-01 [0.1] pnpm pinned to 10.34.6 (`packageManager`), not npm `latest` 12.x — mature, known lockfile and install-script behaviour; installed to `~/.local/bin` because the global npm prefix is root-owned — reproducible builds.
- 2026-10-01 [0.1] TypeScript pinned to 5.9.3. npm `latest` is 7.0, but §5 locks TS 5.x and typescript-eslint 8.71 supports `<6.1` — §5.
- 2026-10-01 [0.1] WXT 0.21.4 ships no Preact template. Used the vanilla template; Preact JSX compiles through Vite 8's built-in oxc transform (`jsx.importSource: 'preact'`). No `@preact/preset-vite` (it pulls `@babel/core` for dev-only refresh) — fewer dependencies, HR9.
- 2026-10-01 [0.1] Preact 10.29.8, not 11.0.0 (released days ago): widest compatibility with test tooling for Sprint 4 UI tests.
- 2026-10-01 [0.1] WXT auto-imports disabled (`imports: false`); every module imports `defineBackground`, `browser`, etc. explicitly so reviewers and the lint rules see every dependency — HR3, HR4.
- 2026-10-01 [0.1] Repo is a pnpm workspace: root `package.json` delegates every script (`pnpm build`, `pnpm test`, …) to `extension/`; `policy/`, `bench/`, `docs/` stay at the root per §6.
- 2026-10-01 [0.1] Manifest: `permissions` = `storage` (install id + flags), `alarms` (scheduler), `sidePanel` (added by WXT for the side panel entrypoint, §6 surface); `host_permissions` empty; `minimum_chrome_version` 120 (side panel API + MV3 module service worker) — HR8.
- 2026-10-01 [0.1] Popup and side panel exist as static shells in Sprint 0 because task 0.4's scripted session opens them; they read nothing.
- 2026-10-01 [0.1] Build emits source maps (readable, unobfuscated code for store review; CWS forbids obfuscation) — HR9.
- 2026-10-01 [0.1] Extension version is 0.0.1 until the 0.1.0 store release — SemVer per §5.
- 2026-10-01 [0.1] The agent did not create the public GitHub repo. MANUAL.md reserves that for the founder and publishing is not reversible. All commits are local on `main` until the repo exists; then one push publishes the history — HR-neutral, outward-facing action.
- 2026-10-01 [0.1] `src/log.ts` is safe by construction: event names must be identifiers; string values print only if they look like plumbing (identifiers, enum values, ULIDs, SHA-256 hex, ISO timestamps, semver); keys naming content (subject, counterparty, body, …) are always redacted; error messages are never printed (name + length only) — HR10.
- 2026-10-01 [0.2] `attest/no-act` goes beyond the five listed patterns: it also forbids synthetic event constructors, `preventDefault`/`stopPropagation`, DOM mutation (`appendChild`, `setAttribute`, `classList.*`, `style.*`, `innerHTML =`, …), navigation (`location`, `history`, `window.open`), programmatic scrolling (Sprint 3: "no scrolling for the user"), `on*` handler assignment, and any reference to network globals (calls, `new`, aliasing, `window.fetch`) — HR1, HR3.
- 2026-10-01 [0.2] Fenced scopes (`entrypoints/content/**`, `src/adapters/**`, `src/observers/**`, `src/core/**`) run with `linterOptions.noInlineConfig`, so an `eslint-disable` comment there has no effect and is reported — the rules cannot be disabled locally — HR3, HR4.
- 2026-10-01 [0.2] `src/core` fence is three rules: `no-restricted-imports` (Dexie, wxt, preact, ulidx, Node built-ins, and any path into adapters/observers/ledger/bus/ui/telemetry/crypto/intel/background/entrypoints/log), `no-restricted-globals` (chrome, browser, DOM, fetch, timers, performance, crypto, globalThis, …), `no-restricted-syntax` (`Date.now()`, argless `new Date()`/`Date()`, `Math.random()`, `getRandomValues`, `randomUUID`, dynamic import) — HR4.
- 2026-10-01 [0.2] Custom rule `attest/top-level-listeners` (background entry, `src/background/**`, `src/bus/**`): `addListener` inside an async function, generator, or then/catch/finally/timer/microtask callback is an error — MV3 listener rule (task 0.7 asks for this).
- 2026-10-01 [0.2] typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`; Prettier `printWidth` 110, single quotes, trailing commas. `no-console` is off only in `src/log.ts` and in `tests/**` (the test runner's own output, not the extension's console).
- 2026-10-01 [0.2] Lint fences are proven by permanent tests (`tests/unit/lint/*.spec.ts`: RuleTester cases for both custom rules, and probes through the real `eslint.config.js`), not by a one-off manual check.
- 2026-10-01 [0.3] Test pages that are not vendor captures (blank pages, attack harnesses) live in `tests/fixtures/pages/_harness/`, outside the `<vendor>/<yyyy-mm-dd>/` scheme reserved for captured fixtures.
- 2026-10-01 [0.3] E2E uses Playwright's bundled Chromium (`channel: 'chromium'`, new headless) with a fresh profile per test; branded Chrome ignores `--load-extension`. `pnpm e2e` always rebuilds first so tests never run a stale build. No retries; `forbidOnly` in CI (qa_tester rule 10).
- 2026-10-01 [0.3] The fixture server binds 127.0.0.1 only, serves GET/HEAD, and rejects any `..` segment, backslash or NUL outright (property-tested, 2,000 runs) instead of clamping.
- 2026-10-01 [0.3] Root-level TypeScript tooling (`bench/`, later `scripts/`) gets its own `tsconfig.json` + `eslint.config.js` at the repo root, using the same pinned lint stack; root `pnpm lint`/`pnpm typecheck` run the extension's checks and then the root's. Root `package.json` is `"type": "module"`.
- 2026-10-01 [0.3] `bench/run_bench.ts` regenerates `RESULTS.md` from the newest `bench/results/<bench>-<date>.json` per bench; with no benches it says so and reports no numbers — HR12.
- 2026-10-01 [0.4] Network-intercept test uses Chromium's NetLog (`--log-net-log`) as ground truth instead of Playwright routing alone: NetLog sees every request from process start, including the extension service worker, which page-level routing does not reliably see. Each request is attributed by its recorded initiator: `chrome-extension://<id>` or any page origin (where content scripts run) counts against the allowlist; `not an origin` is the browser process itself — HR1.
- 2026-10-01 [0.4] Chromium contacts its own services even with Playwright's `--disable-background-networking` (observed: accounts.google.com, android.clients.google.com, clients2.google.com, update.googleapis.com, www.google.com, mtalk.google.com). Browser-initiated requests are ignored only if they go to a fixed list of known Chromium hosts; any other browser-initiated host fails the test (fail closed against misattribution). The list never contains a vendor or agent host (unit-tested) — HR1.
- 2026-10-01 [0.4] The guarded session also routes every page request through Playwright (recorded and aborted unless local or fixture) and sets a dead proxy (`--proxy-server=http://127.0.0.1:9`), so nothing can actually leave the machine even while the test is failing — HR1.
- 2026-10-01 [0.4] Each mandatory test file carries a negative control that runs every time: canary fetches from the service worker, an extension page and a fixture page must be detected; a seed planted in each channel must be caught. A recorder that silently breaks makes the suite red, never green — HR1, HR2.
- 2026-10-01 [0.4] The test's ALLOWLIST is written in the test file and asserted equal to `NETWORK_ALLOWLIST` in `src/config.ts`, so widening it requires changing both (visible in review) — HR1.
- 2026-10-01 [0.5] Seeded secrets carry canary fragments (e.g. "vault code for the Lisbon storage unit") so a partial leak (an 80-char subject hint cut from a body) is caught, not only exact copies. Matching is NFKC + case + whitespace insensitive, over decoded values and serialised JSON — HR2, HR10.
- 2026-10-01 [0.5] Seeds are injected into fixture pages server-side (the page is served already seeded, in text and in the attributes adapters read), so the extension sees them exactly as real content. Channels: ledger export (via the extension's own `ui.query`), raw dump of every IndexedDB database, chrome.storage local/session/sync, console from every context, network URLs and bodies. The test also asserts every channel was actually read — HR2.
- 2026-10-01 [0.4] The scheduler's first real alarm is `attest.purge` (retention, implemented in 2.6); Sprint 0 schedules it and logs when it fires, which is the alarm the 5-minute session triggers. Alarms not ours are cleared on install/update; ours are recreated on startup if Chrome dropped them.
- 2026-10-01 [0.11] CI runs the `@mandatory` E2E tests as their own named step before the rest; validated with actionlint 1.7.12.
- 2026-10-01 [0.1] Repo created public at github.com/Poojan6216/attest on the founder's explicit instruction ("create the repo"). Before the first push, the three API-key-shaped seeds were changed to non-provider prefixes (`zk-proj-…`, `AKXQ…`, `sk-anx-api99-…`): the originals matched real AWS/Anthropic key formats and would trip GitHub push protection and provider leak scanners. The leak test needs the shape, not a real vendor format. The unpushed commit was amended so no provider-shaped fake key is in public history — HR10.
- 2026-10-01 [0.1] SUPERSEDES §5 "Repo … public from the first commit": the founder asked to make `Poojan6216/attest` private; done with `gh repo edit --visibility private`. Consequences tracked: (a) Sprint 7.2 serves `PRIVACY.md` via GitHub Pages, which needs a public repo on the free plan — flip public before launch or host the policy elsewhere; (b) store review and the launch copy ("read the source") assume a public repo; (c) private repos get a limited free Actions minutes budget and each CI run includes the 5-minute mandatory network test; (d) the README CI badge only renders for signed-in collaborators. The code and docs keep the public-repo URL; nothing else changes.
- 2026-10-01 [0.8] A Zod 4 schema construction probe (new Function) would trip the extension CSP; handled globally in src/setup.ts (see 0.4 wiring) — HR9
- 2026-10-01 [0.8] src/core/tsconfig.json also sets "jsx": null and "jsxImportSource": null — the inherited react-jsx + preact settings with moduleDetection force made TypeScript import preact/jsx-runtime into every core file, and preact's types load lib.dom, so core was silently type-checked with DOM globals — Hard Rule 4 (src/core pure)
- 2026-10-01 [0.8] Host constants are frozen lists of match patterns per vendor (gmail: ['https://mail.google.com/*'], muse: []) rather than single strings — an empty list cannot leak a '' pattern into host_permissions, and it matches the adapter contract `hosts: readonly string[]` — Hard Rule 8
- 2026-10-01 [0.8] Rule ids must be lowercase snake_case identifiers, stricter than the spec's 'non-empty string' — receipts and logs carry ruleId, and log.ts prints only identifier-shaped strings, so ids stay loggable — Hard Rule 10
- 2026-10-01 [0.8] allowlistedFields must contain exactly the three sources gmail.sent, gmail.receipt and gcal.event (missing or unknown sources are errors) — a source with no allowlist would leave redaction undefined — Hard Rule 2
- 2026-10-01 [0.8] ObservationFieldName (Zod enum) is defined in src/core/policy.ts because core may not import src/ledger; a unit test pins it to Object.keys(Observation.shape) until Sprint 1 task 1.0 moves the schemas into core — Hard Rule 2
- 2026-10-01 [0.8] RuleOutcome = the 6 Grades + PENDING; a test pins it to the ledger Grade enum — Hard Rules 4/5
- 2026-10-01 [0.8] Policy type is DeepReadonly<z.output<typeof Policy>> and loadPolicy deep-freezes its own parse output (never the caller's input) — no runtime retuning of thresholds — Hard Rule 4
- 2026-10-01 [0.8] loadPolicy parses with { jitless: true } so Zod never uses its new Function fast path for the policy, and parsing behaves the same in Node tests and under the extension CSP — Hard Rule 9
- 2026-10-01 [0.8] Error format: '<path>: <problem>'. A missing key reads 'is required', a non-finite number 'must be a finite number', each unknown key gets its own line with the key in the path, keys containing dots are bracket-quoted (allowlistedFields["gmail.sent"][1]), and a non-object document reads '(root): expected object, got <kind>'. A partial >= verified error is reported on thresholds.partial. — specific errors (task Done-when)
- 2026-10-01 [0.8] Windows are non-negative finite numbers, not forced to integers (as the spec says) — Hard Rule 4
- 2026-10-01 [0.8] The AST test scans entrypoints/ as well as src/ (the spec named src/) because background.ts holds scheduling and alerts, where a hardcoded threshold would be just as wrong. In src/core the rule is stricter than the spec: no numeric literal other than 0 or 1, including fractions (ledger_engineer rule 2 'no magic numbers in src/core'); the exemption set is commented — Hard Rule 4
- 2026-10-01 [0.8] default.json number spelling follows Prettier (0.5, 0.2 instead of 0.50, 0.20); the values are identical, and the root `prettier --check .` requires it — Hard Rule 12 (no hand-edited divergence)
- 2026-10-01 [0.8] Feature flags are a frozen FEATURE_FLAGS tuple, a FeatureFlag union type, and a frozen FEATURE_FLAG_DEFAULTS of type Record<FeatureFlag, boolean>, all false — Hard Rules 1, 4, 11 (opt-in only)
- 2026-10-01 [0.8] Policy rules may not use the id 'default_unverifiable'. It is exported as TERMINAL_RULE_ID from src/core/policy.ts, where the grading contract lives, so grade() can import it without core depending on src/config.ts — a policy rule with that id could grade VERIFIED while its receipt's ruleId says no rule matched — Hard Rule 5 (and ledger_engineer rule 3)
- 2026-10-01 [0.8] The no-threshold scan counts string and template literals that parse as numbers (Number('0.85')) as numeric literals. It covers every TS/JS extension, and in src/core the only JSON import allowed is policy/default.json — this closes the three gaps around 'no threshold exists anywhere in code' — Hard Rule 4
- 2026-10-01 [0.8] Strictness and required keys are tested by walking the shipped default.json, not a hand-written list — any new level or key added to the policy is covered automatically, so the schema cannot loosen silently — Hard Rules 2 and 4
- 2026-10-01 [0.8] I kept the implementer's decisions after checking each one: the snake_case rule-id pattern, frozen lists as host constants, jsx/jsxImportSource null in the core tsconfig, per-parse jitless, Prettier's spelling 0.5 and 0.2, and windows as non-negative non-integers — reasons as in the implementer's report — Hard Rules 2, 4, 8, 9, 10
