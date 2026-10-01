# Security review: Sprint 0

- Reviewer role: `agents/security_reviewer.md` (read-only; nothing was fixed here, `sprint_closer.md` does the fixes)
- Date: 2026-10-01
- Scope: every file touched by commits `e6c2db4..89e7cc1` on `main` (`git log --stat`): the manifest/WXT config, `src/**`, `entrypoints/**`, `eslint-rules/**`, both ESLint configs, the test rails and the mandatory-test harness (`tests/e2e/**`, `tests/tools/**`), `policy/default.json`, `PRIVACY.md`, `docs/adapters.md`, `.github/workflows/ci.yml`, and both `package.json` files plus the lockfile.
- Built artifact inspected: `extension/.output/chrome-mv3/` (manifest, `background.js`, `chunks/*.js`, `assets/*.css`, `*.map`).

## Summary

Nothing in the shipped extension leaks today. The manifest is minimal, the CSP is strict, no source file makes a network call, every bus message and every stored row is Zod-parsed, and both `@mandatory` tests passed in CI (run 36923944944). `pnpm audit` is clean.

The gaps are in the safety rails that later sprints depend on. Three are MEDIUM:

- **SECURITY-1, logger:** the logger (HR10) can be made to print seeds.
- **SECURITY-2, capture sanitiser:** it keeps URL query tokens outside link attributes. That includes Gmail's `data-saferedirecturl`, and the output is written to fixtures that get committed.
- **SECURITY-3, `attest/no-act`:** the lint rule misses common DOM-mutation and resource-loading APIs.

Five gaps are LOW. All three MEDIUM gaps were reproduced with probe scripts (evidence below). None of the gaps is CRITICAL or HIGH.

| Severity | Count | Gaps |
|---|---|---|
| CRITICAL | 0 | |
| HIGH | 0 | |
| MEDIUM | 3 | SECURITY-1, SECURITY-2, SECURITY-3 |
| LOW | 5 | SECURITY-4, SECURITY-5, SECURITY-6, SECURITY-7, SECURITY-8 |

## Commands run

| Command | Result |
|---|---|
| `pnpm lint` | exit 0 (ESLint `--max-warnings 0` and Prettier, extension and root) |
| `pnpm typecheck` | exit 0 (extension, `src/core/tsconfig.json`, root) |
| `pnpm test` | 805 passed, 2 failed. Both failures are in QA's new, uncommitted `tests/unit/log.spec.ts` (`api_key_aws_shape: as a field key`, `url_with_token: as a field key`). They reproduce SECURITY-1 on their own. The committed suite has no failures. |
| `pnpm audit --prod` / `pnpm audit` | "No known vulnerabilities found" (both) |
| `gh run view 36923944944` | Steps `E2E (@mandatory)` 5/5 passed (network-intercept session 5.0 min, violations `[]`, unknown browser hosts `[]`; both negative controls caught every canary). The run is red only at `Upload build`: `.output/` is a hidden directory and `upload-artifact` excludes hidden files. That is not a security finding; it is left to QA/Tech. |
| `grep -rn "fetch(\|XMLHttpRequest\|navigator.sendBeacon\|WebSocket" extension/src extension/entrypoints` | no matches |
| Logger probe (`buildRecord` with seed-derived inputs, scratch script) | see SECURITY-1 |
| Sanitiser probe (`sanitizeHtml` with token-bearing inputs, scratch script) | see SECURITY-2 |
| `attest/no-act` probe (ESLint `Linter` with the rule, scratch script) | see SECURITY-3 |

Built manifest (`.output/chrome-mv3/manifest.json`): `permissions: ["storage","alarms","sidePanel"]`, `host_permissions: []`, `content_security_policy.extension_pages: "script-src 'self'; object-src 'none'"`. It has no `externally_connectable`, `web_accessible_resources`, `optional_permissions`, `webRequest` or `declarativeNetRequest`.

## Checklist, item by item

### Nothing leaves the browser (Hard Rule 1)

| Item | Verdict | Evidence |
|---|---|---|
| Network grep returns only `src/telemetry/send.ts` | PASS | No matches at all; `send.ts` arrives in Sprint 5.7. The *built* bundle has one `fetch(` from Vite's modulepreload polyfill (SECURITY-6). Outside the content/adapter/observer scopes, no static fence covers HR1 (SECURITY-5). |
| Network-intercept E2E ran this sprint; allowlist has 0 hosts (telemetry off) | PASS | CI run 36923944944: `✓ … a 5-minute scripted session makes no request outside the allowlist @mandatory (5.0m)`. `ALLOWLIST = []` (`tests/e2e/network-intercept.spec.ts:33`) is asserted equal to `NETWORK_ALLOWLIST` (`src/config.ts:24`, spec line 109). |
| No remote `<img>`, fonts, CDN in entrypoint HTML/CSS | PASS | The three `index.html` files load only `./main.tsx`. Built CSS has 0 `url(` and no `@font-face`. |
| No `externally_connectable`, `webRequest`, `declarativeNetRequest` | PASS | Built manifest above. |

### Derived facts only (Hard Rule 2)

| Item | Verdict | Evidence |
|---|---|---|
| Every Observation/Claim on the bus went through `redact.project()` | N/A (scheduled) | Nothing produces Observations or Claims yet. `redact.ts` is Sprint 1.2; the content-script skeleton `health → extract → redact.project → bus.post` is Sprint 2.0. Receiver-side caps: SECURITY-4. |
| `policy/default.json` allowlist unchanged, or change logged | PASS | Created this sprint exactly per §7. The decisions are logged in `Decisions.md` Sprint log [0.8] (allowlistedFields must cover exactly three sources; strict loader). |
| Secret-seed test ran, green across IndexedDB, console, export, telemetry | PASS | CI: `✓ … seeded pages leave no trace in export, IndexedDB, storage, console, or network @mandatory` and its negative control. Telemetry channel = network URLs and bodies (no telemetry exists yet). |
| No field over the caps (`textHint` ≤ 200, `subjectHint` ≤ 80) | PASS | `src/ledger/types.ts:36,49,71`. Other free-text fields are uncapped: SECURITY-4. |
| Exports/share use the redacted projection, never the raw row | PASS | `src/ledger/export.ts:73-87` strips index fields and strict-parses every row (`readRows`); corrupt rows are skipped. Share is Sprint 4. |

### Attest never acts (Hard Rule 3)

| Item | Verdict | Evidence |
|---|---|---|
| `attest/no-act` on `entrypoints/content/**`, `src/adapters/**`, `src/observers/**`; zero disables | PASS (rule coverage is SECURITY-3) | `extension/eslint.config.js:10,186-190` with `noInlineConfig`. `grep -rn eslint-disable src entrypoints` returns nothing. |
| No `.click()`, `.submit()`, `dispatchEvent`, `.value =`, `.focus()` on vendor DOM | PASS | No code reads or touches a vendor DOM in Sprint 0. The `.focus()` calls in `ResetInstallIdControl.tsx:41-42` act on Attest's own options page. |
| No `chrome.tabs.create/update` to a vendor host | PASS | No `tabs` usage anywhere. |
| No `chrome.scripting.executeScript` with string code | PASS | No `scripting` usage. |

### Permissions and manifest (Hard Rules 8, 9)

| Item | Verdict | Evidence |
|---|---|---|
| `permissions` ⊆ {storage, alarms, sidePanel, notifications, offscreen} | PASS | `storage, alarms, sidePanel`; justified in `Decisions.md` [0.1] (manifest line). |
| `host_permissions` exactly the §5 hosts; no wildcards, no `<all_urls>` | PASS | Empty, as Sprint 0 requires ("empty until Sprint 2"). Hosts are staged in `src/config.ts:37-52`; Muse is deliberately empty. |
| Optional permissions requested in a user gesture with an explanation | N/A | None declared. The `tabs` question is Sprint 4.9. |
| CSP `script-src 'self'; object-src 'none'`; no unsafe-* | PASS | `extension/wxt.config.ts:20-22` and the built manifest. |
| No `eval`, `new Function`, `import()` of a URL | PASS | `no-eval`, `no-implied-eval` and `no-new-func` are on globally (`eslint.config.js:156-158`). The bundle's only `Function(` is Zod's eval probe in `chunks/_virtual_wxt-plugins-*.js`, which is short-circuited by `jitless` (`src/setup.ts`, imported first by all four entrypoints and enforced by `tests/unit/setup.spec.ts`). The `innerHTML` in the Preact runtime is unused (no `dangerouslySetInnerHTML` anywhere). |

### Input handling and injection (Hard Rule 4, red team)

| Item | Verdict | Evidence |
|---|---|---|
| Page text never used as selector, message type, policy key, or model instruction | N/A | No page is read in Sprint 0. The capture tool's selectors come from the founder's CLI arguments. |
| Optional model input built from allowlisted fields; tested with a double | N/A (Sprint 5) | |
| All bus messages Zod-parsed on receive; unknown dropped and logged | PASS | `src/bus/listen.ts:124-132`: the sender-id check runs first and fails closed when an id is undefined, then strict `BusMessage.safeParse`, then the `ui.query`-from-extension-page-only check, then the handler lookup. Each drop logs `bus.dropped {reason, type?}`. `send.ts:42` parses outgoing messages; `query()` re-parses the response (`send.ts:68-70`). |
| Stored data Zod-parsed on read | PASS | Every ledger read goes through `readRow` (`src/ledger/db.ts:123-137`); the install id is parsed on read and on change (`src/ledger/install-id.ts:48,113`). |
| Extracted strings rendered as text, never `innerHTML` | PASS | No `innerHTML` or `dangerouslySetInnerHTML` in `src/` or `entrypoints/`; Preact text interpolation only. |

### Storage and crypto

| Item | Verdict | Evidence |
|---|---|---|
| Dexie version bumped when tables change; migration tested | PASS | `src/ledger/migrations.ts` validates the list before opening; `tests/unit/ledger/migrations.spec.ts` covers v1 to v2. |
| Optional encryption (AES-GCM, PBKDF2 ≥ 600k, key never stored) | N/A (Sprint 6.5) | |
| Wipe clears IndexedDB and `chrome.storage.local`, verified by test | N/A (Sprint 4.5) | The Danger zone honestly says "a later version" (`DangerZone.tsx:11-14`). |
| Install id random, resettable, the only identifier | PASS | `crypto.randomUUID()` checked as a lowercase v4 UUID (`install-id.ts:18,59`); two-step reset in Options; never logged. See the note on `accountHash` below. |

### Logging and errors (Hard Rule 10)

| Item | Verdict | Evidence |
|---|---|---|
| `src/log.ts` the only logger; redaction applied; no DOM nodes or raw objects logged | **GAP: SECURITY-1** | `no-console` is on everywhere except `src/log.ts` (`eslint.config.js:154,182-184`), and objects and arrays print only their shape. But redaction can be bypassed through field keys, numbers, identifier-shaped values and `error.name`. |
| No PII in user-facing error strings or issue prefills | PASS | User-facing strings are constants (`ResetInstallIdControl.tsx:16-20`, `InstallIdValue.tsx:20-22`). `BusError`, `LedgerError` and `InstallIdError` messages are built from codes. No issue prefill exists. |
| No bare `catch {}`; every catch logs with context | PASS | Every catch in `src/` and `entrypoints/` logs or rethrows a typed error (`alarms.ts:61`, `migrations.ts:77`, `repo.ts:336,350`, `install-id.ts:43,62`, `send.ts:30,46`, `listen.ts:107,113,145`, `background.ts:22,28`, `use-install-id.ts:47,62`, `ResetInstallIdControl.tsx:59`). `no-empty` is on with `allowEmptyCatch: false`. |

### Telemetry-api

N/A: not touched in Sprint 0 (Sprint 5.8).

### Dependencies and surface

| Item | Verdict | Evidence |
|---|---|---|
| `pnpm audit --prod` run; highs/criticals fixed or logged | PASS | Clean (prod and full). |
| No new dependency without a `Decisions.md` line (size, license, maintenance) | **GAP: SECURITY-7** | |
| Vendor terms re-read if an adapter changed | N/A | No adapter exists; the terms reading is Sprint 3.10 (MANUAL.md). |
| (CI surface) | **GAP: SECURITY-8** | Actions are pinned to mutable tags. |

## Gaps

### SECURITY-1: the logger prints secrets through field keys, numbers, identifier-shaped values and `error.name`

- **Severity:** MEDIUM
- **Hard Rule:** 10 (never log secrets or PII); 2 (the console is one of the four no-leak channels)
- **Where:**
  - `extension/src/log.ts:109-113`: `sanitizeKey` keeps the *original* key whenever its lowercased form is an identifier, or whenever it matches `/^[a-z][A-Za-z0-9]{0,40}$/`. That second pattern has no check for runs of digits.
  - `extension/src/log.ts:99`: every finite number prints verbatim.
  - `extension/src/log.ts:30,62-67,72-73`: any lowercase identifier (including `.`, `_`, `:`, `/`, `-`) or any UPPER_SNAKE word prints. Lowercase names, hyphenated passphrases, slugs, domains and URL paths all have that shape.
  - `extension/src/log.ts:42-60,103`: `CONTENT_KEYS` is an exact match, so `subjectText`, `subject_hint`, `recipient`, `to`, `from`, `href`, `link`, `host`, `token`, `passphrase` and `snippet` are not treated as content.
  - `extension/src/log.ts:91`: `error.name` prints if it matches `/^[A-Z][A-Za-z]{0,40}$/`.
  - `PRIVACY.md:92` says the log "replaces every other piece of text with its length". That is not true for the cases above.
- **Evidence:** `buildRecord('info','x.y', …)` produced:
  ```
  { AKXQZ7QW3RT5YU8IOP2X: 1 }          -> {"AKXQZ7QW3RT5YU8IOP2X":1}        (seed api_key_aws_shape, verbatim)
  { ZXq9vL2mP8rT4wY7nB5c: true }       -> {"ZXq9vL2mP8rT4wY7nB5c":true}     (canary of url_with_token)
  { c4000056655665556: 1 }             -> {"c4000056655665556":1}           (card canary inside a key)
  { amount: 4000056655665556 }         -> {"amount":4000056655665556}       (card canary as a number)
  { n: 5415550187 }                    -> {"n":5415550187}                  (phone canary as a number)
  { recipient: 'marguerite' }          -> {"recipient":"marguerite"}
  { subjectText: 'biopsy-results-wexmoor' } -> printed verbatim
  { passphrase: 'glacier-minnow-trumpet' }  -> printed verbatim
  { href: 'files.example.net/share/q3-deck' } -> printed verbatim
  { who: 'OTTOLINE' }                  -> printed verbatim
  error with name 'Marguerite'         -> "Marguerite messageLength=18"
  ```
  For comparison, the same AWS seed passed as a *value* (`{ k: 'AKXQ…' }`) is correctly redacted (`[redacted len=20]`). QA's in-progress `tests/unit/log.spec.ts` fails on the same two key cases. No current call site passes data-derived keys or values: every Sprint 0 caller logs constants, codes, counts and validated ids. That is why the mandatory no-leak E2E is green. The exposure begins when observers and adapters (Sprints 2–3) log near page data. The E2E matcher also collapses whitespace instead of removing it (`tests/e2e/support/leaks.ts:49`), so an "identifier-ised" leak such as `ottoline.vasquez-brannigan` would not be detected either. The identifier rule itself is a documented choice (`Decisions.md` [0.1] `src/log.ts`), but its premise, that identifier-shaped means plumbing, does not hold. The key and number paths are not documented anywhere.
- **Suggested fix:**
  1. Keys: never print a caller-supplied key that fails the same rules as a value, applied to the original string rather than its lowercased form. Reject any digit run of 5 or more. Otherwise emit `field<N>`. Simplest of all: keys must match `/^[a-z][a-zA-Z]{0,30}$/` (no digits).
  2. Numbers: print a number only if its key is in a numeric allowlist (`count`, `issues`, `version`, `length`, `ms`, `*Count`, `*Ms`, `*At` epoch), or if `Math.abs(n) < 100000`. Otherwise print `[number digits=N]`.
  3. Strings: switch from "anything identifier-shaped" to an allowlist. ULID, SHA-256, ISO timestamp, semver and enum values from the bus/ledger schemas print anywhere. Free identifiers print only under plumbing keys (`reason`, `type`, `kind`, `table`, `alarm`, `code`, `adapterId`, `observerId`, `version`, `id`). Everything else is redacted.
  4. Match `CONTENT_KEYS` by token or substring (`subject*`, `*email*`, `*name`, `*address*`, `*url`, `href`, `*token*`, `*secret*`, `pass*`, `snippet`, `body`, `text*`).
  5. `error.name`: print only names in a known set (`Error`, `TypeError`, `RangeError`, `SyntaxError`, DOMException names, `ZodError`, `BusError`, `LedgerError`, `InstallIdError`).
  6. Commit QA's `tests/unit/log.spec.ts` / `tests/property/log.property.spec.ts` with all 15 seeds and their canaries in key, value, nested, number and `error.name` positions.
  7. Correct `PRIVACY.md:92` to describe exactly what prints.
  8. Add a `Decisions.md` line that supersedes the [0.1] logger entry.

### SECURITY-2: the capture sanitiser keeps URL query tokens outside link attributes, but the docs say query strings are dropped

- **Severity:** MEDIUM
- **Hard Rule:** 2 and 10 (the output is written to fixtures the founder commits; git history keeps them even if the repo visibility changes)
- **Where:**
  - `extension/tests/tools/capture-dom.ts:42`: `LINK_ATTRIBUTES` is only `href`, `xlink:href`, `action`, `formaction` and `cite`.
  - `extension/tests/tools/capture-dom.ts:152-169`: every other attribute, including all `data-*` and `<meta content>`, gets the `text` verdict and only PII patterns are applied.
  - `extension/tests/tools/capture-dom.ts:172-174`: `trimUrl` keeps `#fragment` whole, including `#access_token=…`.
  - `extension/tests/tools/capture-pii.ts`: no URL pattern for text nodes.
  - `docs/adapters.md:78`: "Trims links: … drops query strings". The reviewer checklist in §3 relies on this sentence.
- **Evidence:** `sanitizeHtml(…)` on a probe page:
  ```
  <meta property="og:url" content="…/order/view?order=88231&auth=RESETTOKEN111">   SURVIVES
  <a href="…/reset?token=HREFTOKEN222" …>                                          removed (href trimmed: correct)
  … data-saferedirecturl="https://www.google.com/url?q=…token%3DSAFEREDIR333&…&usg=AOvVaw0USGSIG444"   SURVIVES (both)
  <div data-url="…/share?sig=DATAURL555">                                           SURVIVES
  <p>Your link: https://files.example.io/dl?token=TEXTTOKEN666</p>                  SURVIVES
  <a href="https://app.example.io/cb#access_token=FRAGTOKEN777&state=x">             SURVIVES
  ```
  `data-saferedirecturl` is the attribute Gmail puts on every link inside an opened message. Sprint 2.3 captures eight opened receipt emails, whose links routinely carry order-auth, tracking and one-click unsubscribe tokens. `href` is trimmed, but the copy in `data-saferedirecturl` keeps the full original URL and Google's `usg` signature. The documented blind spots (`docs/adapters.md` §4; `Decisions.md` [0.9] "Known blind spots") cover ids in paths and fragments and free text, not query tokens.
- **Suggested fix:**
  1. Add a URL matcher to `Scrubber.scrub` (applied to every text node and every non-handled attribute value, `data-*` and `meta content` included) that rewrites any `scheme://…` or `//…` URL with `trimUrl`.
  2. Make `trimUrl` also drop a fragment that contains `=` or `&` (token-style fragments), keeping plain `#anchor` and `#label/thread` fragments.
  3. Treat `data-saferedirecturl`, `data-url`, `data-href`, `data-link` and `meta[content]` with a URL value as `link` attributes.
  4. Add unit cases for each probe line above to `tests/unit/tools/sanitize.spec.ts`.
  5. Correct `docs/adapters.md:78` and §4.
  6. Optional but cheap: a pre-commit/CI check that fails if any file under `tests/fixtures/pages/<vendor>/` contains `[?&](token|sig|auth|key|code|usg|access_token)=`.

### SECURITY-3: `attest/no-act` misses common DOM-mutation, resource-loading and cross-context APIs

- **Severity:** MEDIUM
- **Hard Rule:** 3 (never act on a vendor page); 1 (content scripts make no requests); 9 (no remote code)
- **Where:** `extension/eslint-rules/no-act.js:11-35` (`ACTION_METHODS`), `:38-56` (`MUTATION_METHODS`), `:73-96` (`ASSIGNED_PROPERTIES`), `:99-123` (constructors and `NETWORK_IDENTIFIERS`), `:194-200` (`NewExpression`). Applied via `extension/eslint.config.js:186-190`.
- **Evidence:** linting single statements with the rule (scratch `Linter` probe):
  ```
  el.append(x) / el.prepend(x) / el.after(x) / el.before(x)   not reported
  document.write("<img src=https://x>")                         not reported
  range.insertNode(n)                                           not reported
  img.srcset = "https://x/a.png 1x"                             not reported   (fetches)
  new Audio("https://x/a.mp3")                                  not reported   (fetches)
  new Worker("https://x/w.js")                                  not reported   (fetches + runs code)
  import("https://x/m.js")                                      not reported   (remote code)
  window.postMessage({cmd:"send"}, "*")                         not reported   (talks to vendor page scripts)
  el.showPopover()                                              not reported
  Reflect.set(el,"value","x") / Object.assign(el,{value:"x"})   not reported
  el[k] = "x" (computed, non-literal key)                       not reported
  el.click() / form.requestSubmit()                             reported (correct)
  ```
  No code lives in the fenced scopes yet, so nothing violates HR3 today. The first observer code lands in Sprint 2, and this rule is the only static HR3 gate. `Decisions.md` [0.2] says the rule forbids "DOM mutation … navigation … and any reference to network globals", which these probes contradict.
- **Suggested fix:**
  1. Add `append`, `prepend`, `before`, `after`, `insertNode`, `surroundContents`, `deleteContents`, `extractContents`, `normalize`, `write`, `writeln`, `showPopover`, `hidePopover`, `togglePopover`, `requestFullscreen`, `requestPointerLock` and `postMessage` to the forbidden methods.
  2. Add `srcset`, `poster`, `formAction`, `ping`, `data` and `background` to `ASSIGNED_PROPERTIES`.
  3. Treat `new Audio(…)`/`new Image(…)` with arguments, `Worker`, `SharedWorker`, `ImportExpression` and `navigator.serviceWorker.register` as network.
  4. Report `Reflect.set`, `Reflect.defineProperty`, `Object.defineProperty`, `Object.assign` and any assignment through a computed member with a non-literal key in these scopes (adapters never need them).
  5. Add a RuleTester valid/invalid pair for each, in `tests/unit/lint/no-act.spec.ts`.
  6. Update the [0.2] `Decisions.md` line.

### SECURITY-4: free-text fields at the service-worker trust boundary have no length caps

- **Severity:** LOW
- **Hard Rule:** 2 (derived facts only; never an email body)
- **Where:**
  - `extension/src/ledger/types.ts`: `:35` `conversationId`, `:46` and `:67-68` `counterparty`/`merchant`, `:54-55` `extractor.id`/`version`, `:80-83` grant string arrays, `:96-97` `ruleId`/`reasons`, `:107-110` `adapterId`/`version`/`reasons`, `:116` `observerId`, `:127-128` meta `key`/`value`.
  - `extension/src/bus/messages.ts`: `:53-56` and `:62-64` (`adapterId`/`observerId`/`version`, and the `requests`/`claims`/`observations` arrays have no maximum).
- **Evidence:** `Observation.counterparty`, `merchant`, `AdapterHealth.reasons[]` and `Request.conversationId` accept strings of any length. A content script (the least-trusted context, per `Decisions.md` [0.7] "ui.query is accepted only from extension pages") can therefore put a full email body into `counterparty` or `reasons`. It would pass `BusMessage.safeParse` in the worker and be stored and exported. HR2's guarantee at the receiver currently rests entirely on sender-side redaction (Sprint 1.2/2.0). Sprint 1.0 replaces these schemas "exactly per §7", and §7 has no caps either, so no later task schedules this.
- **Suggested fix:** in the Sprint 1.0 core schemas (and in the placeholders until then), add a `.max()` to every string and array:
  - `counterparty` ≤ 320 (an RFC 5321 address is ≤ 254, so 320 leaves room for a name)
  - `merchant` ≤ 120
  - `conversationId` ≤ 128
  - ids and versions ≤ 64 and identifier-shaped
  - `reasons[]` items ≤ 120 (`AdapterHealth.reasons` as an enum of reason codes)
  - `declaredScopes`/`observedScopes` items ≤ 120
  - batch arrays ≤ 500
  - `MetaEntry.value` string ≤ 256

  Log the caps in `Decisions.md` as an addition to §7 that protects HR2.

### SECURITY-5: Hard Rule 1 has no static fence outside the content/adapter/observer scopes

- **Severity:** LOW
- **Hard Rule:** 1
- **Where:** `extension/eslint.config.js:10` (`ACT_SCOPES` only) and `:186-190`. `no-restricted-globals` for network APIs exists only for `src/core/**` (`:66-87`).
- **Evidence:** a `fetch()` in `src/background/**`, `src/ledger/**`, `src/bus/**` or `entrypoints/options/**` passes lint. Today it is caught only by the review-time grep, and by the 5-minute E2E if the code path happens to run during the scripted session. A fetch on an error path or a rarely-hit branch would ship.
- **Suggested fix:** add a config block for `src/**` and `entrypoints/**` with `no-restricted-globals` (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `importScripts`) and `no-restricted-properties` (`navigator.sendBeacon`, `window.fetch`, `globalThis.fetch`, `self.fetch`), with `noInlineConfig`. Override it only for `src/telemetry/send.ts` when Sprint 5.7 lands, and for `src/intel/providers/byo.ts` (Sprint 5.3, which also needs a fetch even though 5.7 calls `send.ts` "the only fetch"), each with a `Decisions.md` line. Add a probe test to `tests/unit/lint/fences.spec.ts`.

### SECURITY-6: the shipped bundle contains a `fetch()` call site (Vite modulepreload polyfill)

- **Severity:** LOW
- **Hard Rule:** 1, 9 (what reviewers and "read the source" readers see)
- **Where:** `extension/wxt.config.ts:35-38` (`vite.build` leaves `modulePreload` at its default); emitted into `.output/chrome-mv3/chunks/jsxRuntime.module-DOsaeP9Q.js`.
- **Evidence:** the bundle contains `function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}`, preceded by `if(e&&e.supports&&e.supports('modulepreload'))return;`. On Chrome ≥ 120 (the `minimum_chrome_version`) it returns early, and it would fetch only same-origin `<link rel=modulepreload>` hrefs, so no request is made. But a grep of the shipped code for network calls is not clean, which blocks adding a bundle-level check (Sprint 6.6 `audit-manifest.ts`) and invites store-review or HN questions.
- **Suggested fix:** set `build: { sourcemap: true, modulePreload: { polyfill: false } }` in `wxt.config.ts`. Then add a CI step, or a unit test over `.output/`, that fails if any built `.js` contains `fetch(`, `XMLHttpRequest`, `sendBeacon`, `new WebSocket`, `eval(` or `importScripts`. Allowlist Zod's guarded `Function("")` probe by exact snippet until `src/telemetry/send.ts` exists, then allow that one call site.

### SECURITY-7: dependencies added without a `Decisions.md` line; one unused production dependency; happy-dom's JS evaluation is off only by default

- **Severity:** LOW
- **Hard Rule:** checklist "No new dependency added without a Decisions.md line (size, license, maintenance)"; 9 (surface)
- **Where:**
  - `extension/package.json:29`: `ulidx` 2.4.1 is in `dependencies` but imported nowhere (`grep -rln ulidx extension/src extension/entrypoints extension/tests` returns nothing; it is absent from the bundle's source map).
  - `extension/package.json:37,39,40,42,43,46` and `package.json:32,33,36`: `@vitest/coverage-v8`, `eslint-config-prettier`, `fake-indexeddb`, `globals`, `happy-dom` and `tsx` have no size/license/maintenance entry. Decisions mentions `happy-dom` and `tsx` only for behaviour, not for adoption.
  - `extension/tests/tools/capture-dom.ts:47-76`: `createInertWindow` does not set `enableJavaScriptEvaluation: false` explicitly.
- **Evidence:** happy-dom parses captured vendor HTML in Node on the founder's machine. That HTML includes email content written by third parties. happy-dom's own settings type says that with JS evaluation enabled, "if you run untrusted code you are at risk of RCE" (`node_modules/.pnpm/happy-dom@20.14.5/…/IBrowserSettings.d.ts:24`). It is off only because 20.x defaults it off (`DefaultBrowserSettings.js:6`). A future upgrade or a config merge could flip it silently.
- **Suggested fix:**
  1. Remove `ulidx` (Sprint 1's ULIDs can be added back with a Decisions line when they are needed outside `src/core`, where it is banned anyway).
  2. Add one `Decisions.md` line per remaining non-§5 dependency (version, install size, license, last release and maintenance).
  3. Set `enableJavaScriptEvaluation: false` explicitly in `createInertWindow`, and add a unit test that an inline `<script>` in sanitiser input never runs (e.g. it cannot set a property the test then reads from `window`).

### SECURITY-8: CI actions are pinned to mutable tags

- **Severity:** LOW
- **Hard Rule:** 9 (no remote code; supply chain of the build that produces the extension artifact)
- **Where:** `.github/workflows/ci.yml:20` (`actions/checkout@v4`), `:22` (`pnpm/action-setup@v4`, third-party), `:24` (`actions/setup-node@v4`), `:60` and `:68` (`actions/upload-artifact@v4`).
- **Evidence:** a moved tag runs new code with the job's `contents: read` token over the private source, and can alter the uploaded `chrome-mv3` build artifact. Sprint 7.0 keeps CI artifacts alongside the release. `permissions: contents: read` and the `pull_request` trigger (not `pull_request_target`) are already correct.
- **Suggested fix:** pin each `uses:` to a full commit SHA with a `# v4.x.y` comment, add `.github/dependabot.yml` for `github-actions` (and `npm`) so the pins stay current, and record the choice in `Decisions.md`.

## Scheduled for later sprints (not Sprint 0 gaps)

- `redact.project()` at the content-script edge: Sprint 1.2 and 2.0. Telemetry sender: 5.7. The secret-seed test covering telemetry and the BYO key is in the Sprint 5 gate. When it lands, add a negative control that POSTs a seed in a body *from the service worker*; today's control posts only from an extension page (`tests/e2e/no-leak.spec.ts:171-179`). CI shows the route layer does see service-worker requests in Playwright 1.63 (`BLOCKED sw-canary.example.com via=route initiator=…/background.js`).
- Wipe with test: 4.5. Encryption at rest: 6.5. Manifest/permission audit script in CI: 6.6. Vendor terms: 3.10. Telemetry-api review items: 5.8. Optional `tabs` permission question: 4.9.

## Notes for the sprints that touch these files (not gaps)

- **Bus sender binding (Sprints 2.7, 3.6):** when handlers for `observer.*`, `coverage.ping` and `adapter.*` are added, bind each type to the content-script hosts that may send it (`sender.url` origin ∈ `OBSERVER_HOSTS` for observer messages, ∈ `AGENT_HOSTS` for adapter messages), extending the `EXTENSION_PAGE_ONLY` check at `src/bus/listen.ts:61,128`.
- **`CoveragePing.accountHash` (`src/ledger/types.ts:117-118`, Sprint 2.0):** an unsalted SHA-256 of an email address can be reversed by guessing and travels in exports. Salt it with a per-install random value kept locally, so the install id stays the only stable identifier.
- **`PRIVACY.md`** still points to the public repo and its issue tracker while the repo is private. This is already tracked (`Decisions.md` [0.1] repo-visibility entry, MANUAL.md Sprint 7) and is not a security gap.
- **Source maps** ship in `.output/` on purpose (`Decisions.md` [0.1]). Their `sources` are relative (`../../src/…`), so no local user paths leak.

## Verification (adversarial)

- **Verifier:** adversarial pass over SECURITY-1 to SECURITY-8, 2026-10-01. Read-only on code. Probes ran as scratch scripts outside the repo against the real modules: `buildRecord` (logger), `sanitizeHtml` (capture sanitiser), the `attest/no-act` rule through ESLint's `Linter`, the real `extension/eslint.config.js` through `ESLint.lintText` and `calculateConfigForFile`, and `findLeaks` (no-leak matcher). `pnpm build` and `pnpm e2e` were not run; the bundle checks used the `.output/` another agent rebuilt at 17:07.
- **Severity rule** (`agents/sprint_closer.md`): anything touching Hard Rules 1–4 is CRITICAL. "Touching" here means the gap weakens a control whose job is to enforce HR1–4: the logger (HR2 names logs as a no-leak channel), the capture sanitiser (`Decisions.md` [0.9] cites HR2 for it), the schemas, the lint fences, the mandatory tests and their merge gate. Dependency and CI supply-chain hygiene (HR9) and the dead polyfill stay LOW. **None of the CRITICAL items is a live violation today.** No Sprint 0 code reads a vendor page or logs page data. They are CRITICAL because Sprints 2–3 build on these controls.
- **Result:** 8 of 8 confirmed, 0 refuted. 6 new gaps (SECURITY-V1 to V6). Nothing in Sprint 1–7 schedules any of the 14.

### Verdicts

| Gap | Verdict | Severity (review → verified) | Kind | Reason |
|---|---|---|---|---|
| SECURITY-1 | CONFIRMED | MEDIUM → **CRITICAL** | CODE | Every probe reproduced. QA's tests fail 2/80. The [0.1] logger decision does not cover keys or numbers, and its identifier premise lets seeds through. No later task touches `src/log.ts`. |
| SECURITY-2 | CONFIRMED | MEDIUM → **CRITICAL** | CODE | Every probe reproduced. A relative URL in `data-*` also survives. Must land before the founder's Sprint 2.1 capture. |
| SECURITY-3 | CONFIRMED | MEDIUM → **CRITICAL** | CODE | Every listed miss reproduced. Sprints 2.0 and 3.0 only require "`no-act` lint green", which a weak rule passes. See also V1 and V2. |
| SECURITY-4 | CONFIRMED | LOW → **CRITICAL** | CODE | `counterparty`, `merchant` and the rest are uncapped. 1.2's `redact.project` enforces only the §7 caps (textHint, subjectHint), so they stay uncapped on both the sending and the receiving side. |
| SECURITY-5 | CONFIRMED | LOW → **CRITICAL** | CODE | `fetch`, `sendBeacon` and `WebSocket` lint clean in the worker, the ledger and the options page. 5.7's "send.ts is the only fetch" has no static check. |
| SECURITY-6 | CONFIRMED | LOW → LOW | CODE | The polyfill is in the bundle, but its fetch is dead code and could only load Attest's own `chrome-extension://` URLs, so HR1 behaviour is not touched. 6.6 audits only the manifest. |
| SECURITY-7 | CONFIRMED | LOW → LOW | CODE | `ulidx` is imported nowhere, and six non-§5 dependencies have no adoption line. happy-dom JS evaluation is off by default only. |
| SECURITY-8 | CONFIRMED | LOW → LOW | CODE | All five `uses:` are tag refs. Also set `persist-credentials: false` on checkout. |

### Evidence per gap

**SECURITY-1.** Scratch call to `buildRecord('info','x.y', …)`:
```
{ AKXQZ7QW3RT5YU8IOP2X: 1 }               -> {"AKXQZ7QW3RT5YU8IOP2X":1}
{ ZXq9vL2mP8rT4wY7nB5c: true }            -> {"ZXq9vL2mP8rT4wY7nB5c":true}
{ amount: 4000056655665556 }              -> {"amount":4000056655665556}
{ n: 5415550187 }                         -> {"n":5415550187}
{ passphrase: 'glacier-minnow-trumpet' }  -> {"passphrase":"glacier-minnow-trumpet"}
{ who: 'OTTOLINE' }                       -> {"who":"OTTOLINE"}
error with name 'Marguerite'              -> "Marguerite messageLength=14"
{ k: 'AKXQZ7QW3RT5YU8IOP2X' }             -> {"k":"[redacted len=20]"}   (the value path is correct)
```
`pnpm exec vitest run tests/unit/log.spec.ts tests/property/log.property.spec.ts` gives `Tests 2 failed | 78 passed (80)`; the failures are `api_key_aws_shape: as a field key` and `url_with_token: as a field key`.

One correction to the review: one current caller does hand stored strings to the identifier rule. `readRow` logs `id: rowId(table, row)` (`src/ledger/db.ts:131-135`). For `adapterHealth`, `coverage` and `meta`, the id only has to pass `PLAIN_KEY = z.string().min(1)` (`db.ts:48,61-63`). `Decisions.md` [0.6] itself says "a corrupt row's id field can hold content that looks like an identifier, such as a hyphenated passphrase". Those ids are code constants in practice, so this is not a live leak, but the fix should add a test for this caller.

**SECURITY-2.** A scratch `sanitizeHtml` probe reproduced all six survivors (`RESETTOKEN111`, `SAFEREDIR333`, `USGSIG444`, `DATAURL555`, `TEXTTOKEN666`, `FRAGTOKEN777`). It also confirmed what is trimmed: the `href`, protocol-relative `href`, `formaction`, `mailto:` query and `ping`. It found one more survivor: `data-href="/relative/path?session=RELSESS222"`. The suggested fix, which matches only `scheme://` and `//`, would miss it. Also strip `?query` from any `data-*` value that starts with `/` or `./`. `docs/adapters.md:78` and `:111` both say query strings are dropped. The Sprint 2 captures are founder work in MANUAL.md ("During Sprint 2"), so this fix must land before that capture.

**SECURITY-3.** The `Linter` probe with the rule reproduced every miss: `el.append(x)`, `document.write`, `import("https://…")`, `new Worker(url)`, `new Audio(url)`, `img.srcset = …`, `window.postMessage`, `navigator.serviceWorker.register`. `Object.assign` and `Reflect.set` are missed because `propertyName` returns `null` for a computed key (`no-act.js:126-133`). `assign` is reported only when its owner is `history` or `location` (`:188`).

**SECURITY-4.** `src/ledger/types.ts:35,46,54-55,67-68,80,82-83,96-97,107-110,116,127-128` and `src/bus/messages.ts:53-56,62-64` are as cited. The file header says "Do not add fields here that §7 does not define". A `.max()` adds no field, but it does deviate from Sprint 1.0's "exactly per §7", so the Decisions.md line the review asks for is required.

**SECURITY-5.** `ESLint.lintText` through the real config:
```
src/background/router.ts      void fetch('https://example.com/')             -> 0 messages
src/ledger/export.ts          navigator.sendBeacon('https://example.com/','x') -> 0 messages
entrypoints/options/main.tsx  new WebSocket('wss://example.com/')            -> 0 messages
```
`calculateConfigForFile` shows `no-restricted-globals` is unset everywhere except `src/core/**`.

**SECURITY-6.** The rebuilt `chunks/jsxRuntime.module-CoilK63K.js` (the hash changed since the review) starts with `let e=document.createElement('link').relList;if(e&&e.supports&&e.supports('modulepreload'))return;` and contains `fetch(e.href,n)`. Only `options.html`, `popup.html` and `sidepanel.html` load it, not the worker. Chrome has supported `modulepreload` since version 66, and the minimum here is 120, so the function returns before it fetches. The only hrefs it could fetch are Attest's own `chrome-extension://` URLs. The fix is still worth making because it unblocks a clean bundle grep.

**SECURITY-7.**
- `grep -rln ulidx extension/src extension/entrypoints extension/tests` returns nothing.
- `Decisions.md` mentions `happy-dom`, `fake-indexeddb` and `tsx` only for how they behave. None of the six has a size, license or maintenance line.
- happy-dom 20.14.5: `DefaultBrowserSettings.js:6` has `enableJavaScriptEvaluation: false`, and `IBrowserSettings.d.ts:24` warns "if you run untrusted code you are at risk of RCE". `createInertWindow` (`capture-dom.ts:47-76`) does not set the flag.
- There is no RCE today: the flag is off by default and the sanitiser parses through `DOMParser`. LOW is right.

**SECURITY-8.** `.github/workflows/ci.yml:20,22,24,60,68` are as cited. One addition: `actions/checkout` keeps `persist-credentials` at its default (`true`). The job token therefore stays in `.git/config` for every later step, including dependency install scripts and Playwright's browser installer. Set `persist-credentials: false`.

### New gaps the review missed

#### SECURITY-V1: `attest/no-act` misses every indirect call of the four actions task 0.2 names

- **Severity:** CRITICAL (HR3). **Kind:** CODE.
- **Where:**
  - `extension/eslint-rules/no-act.js:164-193`: `CallExpression` checks only the callee's own property name.
  - `:219-225`: `MemberExpression` reports network names only.
  - `tests/unit/lint/no-act.spec.ts`: no aliasing case.
- **Evidence:** `Linter` probe with the rule, file `entrypoints/content/probe.content.ts`:
  ```
  el.click()                                    reported
  el.click.call(el)                             NOT REPORTED
  el.click.apply(el, [])                        NOT REPORTED
  const c = el.click.bind(el); c()              NOT REPORTED
  HTMLElement.prototype.click.call(el)          NOT REPORTED
  Reflect.apply(el.click, el, [])               NOT REPORTED
  const { click } = el; click.call(el)          NOT REPORTED
  el['cl' + 'ick']()                            NOT REPORTED
  el.dispatchEvent.call(el, ev)                 NOT REPORTED
  HTMLFormElement.prototype.submit.call(form)   NOT REPORTED
  el.focus.call(el)                             NOT REPORTED
  ```
  Task 0.2 names `.click(`, `.submit(`, `dispatchEvent(` and `.focus(`, and `Decisions.md` [0.2] says the rule forbids them. SECURITY-3 covers writes through `Reflect.set`, `Object.assign` and computed keys. It does not cover calls.
- **Fix:**
  1. Report any member access whose property is a forbidden action, mutation or navigation name, whether or not it is called. That covers `.call`, `.apply`, `.bind`, `Reflect.apply` and `X.prototype.click`.
  2. Report destructuring patterns that take a forbidden name.
  3. Report calls through a computed member with a non-literal key.
  4. Report `Reflect.apply` and `Reflect.construct` in these scopes.
  5. Add a RuleTester invalid case for each line above, and update `Decisions.md` [0.2].

#### SECURITY-V2: `attest/no-act` misses page-state writes beyond SECURITY-3's list, including writes into the vendor's own storage

- **Severity:** CRITICAL (HR3; HR2 for storage). **Kind:** CODE.
- **Where:** `extension/eslint-rules/no-act.js:11-35` and `:73-96`.
- **Evidence:** the same probe does not report:
  - `textNode.data = "x"`, `el.className = "x"`, `el.id = "x"`, `el.contentEditable = "true"`, `document.designMode = "on"`, `document.title = "x"`, `details.open = true`
  - `form.reset()`, `dialog.close()`, `window.close()`, `window.stop()`, `el.animate([], 1)`
  - `localStorage.setItem("k","v")`, `sessionStorage.setItem("k","v")`, `indexedDB.open("x")`, `navigator.clipboard.writeText("x")`
  - a bare read of `document.cookie`

  A content script's `localStorage` and `indexedDB` belong to the vendor page's origin (for example `mail.google.com`), where the vendor's own scripts can read them.
- **Fix:**
  1. Add `data`, `className`, `id`, `title`, `contentEditable`, `designMode`, `open`, `dir`, `lang`, `name`, `slot` and the ARIA reflection properties (`aria*`) to `ASSIGNED_PROPERTIES`.
  2. Add `reset`, `close`, `stop`, `animate` and `print` to the action methods.
  3. Forbid `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `cookieStore`, `navigator.clipboard`, `navigator.storage` and `document.cookie` (read or write) in these scopes.
  4. Add RuleTester pairs.

#### SECURITY-V3: the @mandatory no-leak matcher misses partial and lightly transformed seeds

- **Severity:** CRITICAL (HR2: this is the test HR2 names; HR10). **Kind:** CODE.
- **Where:**
  - `extension/tests/e2e/support/leaks.ts:48-54`: `normalizeForSearch` collapses whitespace to one space instead of removing it, and the needles are the whole value plus its canaries. The docstring at `:1-9` claims the match is "whitespace-insensitive".
  - `tests/fixtures/secrets/seeded.json`: 8 of 15 seeds have no canaries at all (`api_key_openai_shape`, `api_key_aws_shape`, `api_key_anthropic_shape`, `ssn_shape`, `passphrase`, `person_name_1`, `person_name_2`, `base64_blob`).
  - `tests/e2e/no-leak.spec.ts:46-50`: network URLs and bodies are searched as they are, without percent- or base64-decoding.
  - `Decisions.md` [0.5] makes the same "whitespace insensitive" claim.
- **Evidence:** `findLeaks('console', [line], loadSeeds())`:
  ```
  "who":"ottoline.vasquez-brannigan"                      MISSED
  "who":"vasquez-brannigan"                               MISSED
  OttolineVasquezBrannigan                                MISSED
  "p":"glacier-minnow-trumpet"                            MISSED
  "p":"glacier minnow trumpet"  (3 of the 5 words)        MISSED
  https://x/?q=Ottoline%20Vasquez-Brannigan               MISSED
  https://x/?q=<base64 of the same name>                  MISSED
  first 40 of the 80 chars of api_key_anthropic_shape     MISSED
  "ssn":"912447031"                                       MISSED
  "AKXQZ7QW3RT5YU8IOP2X":1                                DETECTED
  "amount":4000056655665556                               DETECTED (card canary)
  ```
  SECURITY-1 shows the logger prints lowercase names, hyphenated passphrases and slugs. Together, a real console leak can pass the mandatory test, and Sprint 2.7 relies on this test to prove fixture bodies never reach storage.
- **Fix:**
  1. Also compare a compact form: strip all whitespace, punctuation and symbols from both the needle and the haystack.
  2. Give every seed canaries: each name token of 6 or more characters, 3-word windows of the passphrase, 16-character windows of each key and of the base64 blob, and the SSN digits.
  3. Percent-decode, and base64/base64url-decode, URL components and bodies before matching.
  4. Add one transformed plant per form to the negative control.
  5. Correct the `leaks.ts` docstring and `Decisions.md` [0.5].

  This makes the test stricter, never weaker.

#### SECURITY-V4: storage outside the two checked stores is neither fenced nor tested

- **Severity:** CRITICAL (HR2). **Kind:** CODE.
- **Where:**
  - `extension/eslint.config.js:164,177-180`: the only import restriction outside `src/core` is `dexie`, so `entrypoints/content/**`, `src/adapters/**` and `src/observers/**` may import `src/ledger/*`.
  - `extension/tests/e2e/support/channels.ts:22-54`: IndexedDB is dumped only from the extension page (`indexedDB.databases()`, so the extension origin only). Web Storage, CacheStorage and the page origin's storage are not read.
- **Evidence:**
  - `calculateConfigForFile('entrypoints/content/gmail.content.ts')` gives `no-restricted-imports: [2,{paths:[{name:'dexie'}]}]` and `no-restricted-globals: null`.
  - A content script that imports `src/ledger/repo.ts` would open the Dexie ledger in the vendor page's origin, because content scripts share the page's IndexedDB. There the vendor's scripts can read it, and the no-leak test never looks.
  - `grep -rn "localStorage\|sessionStorage\|caches\.\|indexedDB\|document\.cookie"` finds nothing in `src`, `entrypoints` or the no-leak harness. Nothing uses these stores today, and nothing would catch a first use.
- **Fix:**
  1. In the content, adapter and observer scopes, ban imports of `**/ledger/**`, `**/crypto/**`, `**/telemetry/**`, `**/intel/**` and `dexie`. Content scripts reach the ledger only through `src/bus`.
  2. Ban the `localStorage`, `sessionStorage`, `indexedDB` and `caches` globals there (this overlaps V2). Outside those scopes, ban `localStorage`, `sessionStorage` and `caches` unless a `Decisions.md` line allows one.
  3. Extend `collectStorageChannels` to read the extension origin's `localStorage`, `sessionStorage` and CacheStorage, and each fixture page's `localStorage`, `sessionStorage`, IndexedDB and `document.cookie`.
  4. Add a planted-seed negative control for each new channel.

#### SECURITY-V5: the HR10 lint fence (`no-console`) can be switched off or aliased

- **Severity:** CRITICAL (HR10; HR2 names logs). **Kind:** CODE.
- **Where:**
  - `extension/eslint.config.js:154`: only `no-console`, which catches direct `console.x` calls.
  - `:186-205`: `noInlineConfig` is set only for the act, listener and core scopes.
  - `tests/unit/lint/fences.spec.ts:107-110`: tests only the direct call.
- **Evidence:** `ESLint.lintText` through the real config:
  ```
  src/ledger/export.ts          // eslint-disable-next-line no-console + console.log(secret) -> 0 messages
  entrypoints/options/main.tsx  same                                                       -> 0 messages
  entrypoints/popup/main.tsx    same                                                       -> 0 messages
  src/bus/send.ts               globalThis.console.log(secret)                             -> 0 messages
  src/background/router.ts      const c = console; c.warn(secret)                          -> 0 messages
  src/ledger/repo.ts            self.console.error(secret)                                 -> 0 messages
  ```
  In `src/background` and `src/bus` an inline disable is refused, because those are listener scopes. Aliasing passes everywhere. The no-leak E2E catches such a line only if it runs during the scripted session. There are no `eslint-disable` comments in `src` or `entrypoints` today.
- **Fix:**
  1. Set `linterOptions.noInlineConfig: true` for all of `src/**` and `entrypoints/**`.
  2. Add `no-restricted-globals` for `console` everywhere except `src/log.ts`; this catches `const c = console`.
  3. Add `no-restricted-properties` for `globalThis.console`, `window.console` and `self.console`.
  4. Add a `fences.spec.ts` probe for each line above.

#### SECURITY-V6: nothing on GitHub stops a red @mandatory test from landing on `main`

- **Severity:** CRITICAL (this is the gate that enforces the HR1 and HR2 tests). **Kind:** MANUAL.
- **Where:** the GitHub repository settings, and `package.json:25-27` (`"pre-commit": "pnpm lint && pnpm typecheck"`).
- **Evidence:**
  - `gh api repos/Poojan6216/attest/branches/main/protection` and `gh api repos/Poojan6216/attest/rulesets` both return HTTP 403: "Upgrade to GitHub Pro or make this repository public to enable this feature."
  - The pre-commit hook runs no tests, and `git commit --no-verify` skips it.
  - `sprints/sprint_0.md:5` says "No sprint after this one may merge with either test red, skipped, or weakened". Today only the sprint process enforces that; GitHub does not.
- **Fix (founder):**
  1. Make the repo public, or upgrade to GitHub Pro.
  2. Then add a ruleset on `main` that requires the `lint · typecheck · unit · build · e2e` check and blocks force-pushes.

  This is one more input to the open public/private decision (MANUAL.md, Sprint 7). Optional code mitigation for the closer: a `pre-push` hook that runs the two @mandatory tests against a fresh build (about 6 minutes; `--no-verify` can skip it).

### Note on repo visibility (not a gap)

The shipped build contains the full original TypeScript, comments included. `background.js.map` carries `sourcesContent` for all 18 of its sources, and source maps ship on purpose (`Decisions.md` [0.1]). A private repo hides the tests, docs and history, but not the code that runs. Who may legally republish a fork is a license question, already in MANUAL.md ("Choose the license before the repo is ever made public again"). The only security-relevant effects of the visibility choice are SECURITY-V6 (branch protection needs a public repo or Pro) and the GitHub Pages dependency already logged in `Decisions.md` [0.1].
