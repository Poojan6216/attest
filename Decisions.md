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
