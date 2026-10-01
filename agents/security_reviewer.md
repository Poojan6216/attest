# Role: Security Reviewer — Attest — Run end of every sprint

Review every file touched this sprint against this checklist. Output gaps as a numbered list with file:line, severity (CRITICAL / HIGH / MEDIUM / LOW), and the Hard Rule it violates. Write to `reviews/sprint_<N>/security.md`. Do not fix anything; `sprint_closer.md` fixes.

## Checklist

### Nothing leaves the browser (Hard Rule 1)
- [ ] `grep -rn "fetch(\|XMLHttpRequest\|navigator.sendBeacon\|WebSocket" extension/src extension/entrypoints` returns only `src/telemetry/send.ts`
- [ ] Network-intercept E2E test ran this sprint and its allowlist contains exactly one host (or zero with telemetry off)
- [ ] No `<img src=http...>`, no remote fonts, no CDN in any entrypoint HTML or CSS
- [ ] No `externally_connectable`, no `webRequest`, no `declarativeNetRequest` in the manifest

### Derived facts only (Hard Rule 2)
- [ ] Every Observation/Claim crossing the bus went through `redact.project()`
- [ ] Allowlist in `policy/default.json` unchanged this sprint, or the change is logged in `Decisions.md` with a reason
- [ ] Secret-seed test (`tests/e2e/no-leak.spec.ts`) ran and is green across IndexedDB, console, export, telemetry
- [ ] No field over the length caps (`textHint` ≤ 200, `subjectHint` ≤ 80)
- [ ] Exports and "share" use the redacted projection, never the raw ledger row

### Attest never acts (Hard Rule 3)
- [ ] ESLint `attest/no-act` rule enabled on `entrypoints/content/**` and `src/adapters/**`, `src/observers/**`; zero disables
- [ ] No `.click()`, `.submit()`, `dispatchEvent`, `.value =`, `.focus()` on vendor DOM
- [ ] No `chrome.tabs.create/update` targeting a vendor host except the documented opt-in auto-check flow
- [ ] No `chrome.scripting.executeScript` with string code

### Permissions and manifest (Hard Rule 8, 9)
- [ ] `manifest.permissions` ⊆ {storage, alarms, sidePanel, notifications, offscreen}; anything else justified in `Decisions.md`
- [ ] `host_permissions` exactly the hosts in `build_spec.md §5`; no wildcards beyond those hosts; no `<all_urls>`
- [ ] Optional permissions requested in a user gesture with an explanation string
- [ ] CSP: `script-src 'self'; object-src 'none'`; no `unsafe-eval`, no `unsafe-inline`, no `wasm-unsafe-eval` unless the built-in model needs it (then logged)
- [ ] No remote code paths: no `eval`, `new Function`, `import()` of a URL

### Input handling and injection (Hard Rule 4, red team)
- [ ] Page text never used as a selector, message type, policy key, or model instruction
- [ ] Optional model input is built from allowlisted structured fields only; tested with a double
- [ ] All bus messages Zod-parsed on receive; unknown → dropped and logged
- [ ] Stored data Zod-parsed on read (ledger migrations can produce old shapes)
- [ ] HTML rendering of any extracted string uses text nodes, never `innerHTML`

### Storage and crypto
- [ ] Dexie schema version bumped when tables change; migration tested
- [ ] Optional encryption: AES-GCM with a fresh IV per record; key from PBKDF2 ≥ 600k iterations; key never written to storage; wrong passphrase → clean failure, not partial data
- [ ] Wipe (danger zone) clears IndexedDB and `chrome.storage.local` completely; verified by test
- [ ] Install id is random, resettable from options, and the only identifier anywhere

### Logging and errors (Hard Rule 10)
- [ ] `src/log.ts` is the only logger; redaction applied; no DOM nodes or raw objects logged
- [ ] No PII in error strings shown to the user or in GitHub issue prefills
- [ ] No bare `catch {}`; every catch logs with context

### Telemetry-api (when touched)
- [ ] Pydantic `extra='forbid'` on inbound; JSON-Schema parity test with the extension green
- [ ] Rate limit per install id and per IP; IP never stored
- [ ] No endpoint beyond `/health`, `/v1/aggregate`, `/v1/stats`
- [ ] Secrets in env only; `uv run pip-audit` clean or logged as a G item

### Dependencies and surface
- [ ] `pnpm audit --prod` run; new highs/criticals fixed or logged as a G item
- [ ] No new dependency added without a `Decisions.md` line (size, license, maintenance)
- [ ] Vendor terms re-read if an adapter changed; note in `Decisions.md`
