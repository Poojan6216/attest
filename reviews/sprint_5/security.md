# Sprint 5 — Security review

Role: agents/security_reviewer.md. Range: `git diff a82916e..5f32641` (HEAD; the working tree is clean). That is 11 commits and 205 files: 65 added or changed under `extension/src` and `extension/entrypoints`, 27 under `telemetry-api/`. Tasks 5.0 to 5.9, Decisions [5.0] to [5.9].

**How.** Read-only. I read every Sprint 5 source file against the checklist. I also ran:

- the checklist's commands and both audits;
- ESLint over the 63 changed `.ts`/`.tsx` files, and `tsc --noEmit`;
- three extension unit files and three API test files;
- an in-process probe of the API (`scratchpad/s5sec/api_probe.py`).

The bundle I scanned is the 06:49 build of HEAD, copied to scratch before reading. I did not run the end-to-end suite. Its last full run on this extension code is `scratchpad/e2e-5.7b.log` (05:46, the tree committed as 4231228, 77 passed); no commit after 4231228 changes extension source. I changed nothing but this file.

**Verdict: 12 gaps.** 0 CRITICAL, 3 HIGH, 2 MEDIUM, 7 LOW.

The three HIGH gaps are all about what leaves the browser (Hard Rule 1):

- **SEC-1.** The popup, the side panel, the digest page, the options page's first line, the extension's own description and the README still say nothing leaves the browser, even when an option that sends is on.
- **SEC-2.** "Forget my key" and "Turn off my own key" do not stop a model run already under way. Up to nine more claims' facts go to the vendor, with the key the person just withdrew.
- **SEC-3.** Both outbound calls follow redirects, so the vendor's server, not Attest, decides where the facts and the key finally go.

## Checklist

| Item | Status | Finding |
| --- | --- | --- |
| Network grep finds only `src/telemetry/send.ts` | PASS, one documented exception | Two hits: `send.ts:37` and `src/intel/providers/byo.ts:102`.<br>The person's own key's call is allowed by build_spec §5 ("BYO key … second"), sprint 5.3, agents/intel_engineer.md rule 6 and Decisions [5.3] and [5.4].<br>The lint (`fences.js:72` NETWORK_EXEMPT_FILES) confines `fetch` to those two files. The 06:49 bundle has exactly those two constructs, both in `background.js`.<br>No XHR, beacon, WebSocket, EventSource or importScripts anywhere.<br>HR1's own text in build_spec §4 and this checklist item still name telemetry alone (see SEC-1). |
| Network-intercept E2E ran; allowlist exactly one host, or none | PASS | e2e-5.7b.log: the mandatory session made 0 attributed requests, under an allowlist `[]` asserted equal to `allowedHosts` with both options off (`network-intercept.spec.ts:225`).<br>`telemetry.spec.ts` and `intel.spec.ts` each allow exactly their own host. The negative control caught 4 of 4.<br>No test makes a stand-in redirect (SEC-3). |
| No remote img, fonts or CDN | PASS | Built pages load only `/chunks` and `/assets`. The CSS's only URL is Tailwind's licence comment. `model-check.html` is local, and no page has an inline script. |
| No externally_connectable, webRequest or DNR | PASS | Built manifest at HEAD. |
| Observations and claims go through `redact.project()` | PASS | No new observation or claim path. The model's input and the telemetry payload are built in the worker from stored rows, which were projected when they were written. |
| Policy allowlist unchanged, or logged | PASS | Only `features.modelScore` changed, 0 → 0.15 (Decisions [5.0]). `allowlistedFields` is unchanged. |
| Secret-seed test green across every channel | PASS | e2e-5.7b.log: no-leak and its negative control passed, now with the telemetry channel (what was sent and what was shown) and an invented key.<br>The key is found in its own storage slot and nowhere else.<br>Its network channel searches URLs and bodies, never request headers, which is where the key travels (SEC-3 fix). |
| Length caps | PASS | Model input: subject hint ≤ 80, counterparty and merchant capped (`input.ts:27-43`).<br>`rationaleHint` is checked to be at most 80 characters, then dropped.<br>`modelAnswers` and the telemetry payload hold no free text. |
| Exports and shares use the projection | PASS | `modelAnswers` exports ids, a hash, the provider, an instant and scores. The key is never in the ledger. |
| `attest/no-act`, zero disables | PASS | ESLint over the 63 files: exit 0. No `eslint-disable` in any of them. |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | The only hit is `model-check/App.tsx:84`, the dev page clicking its own download link. |
| No tabs.create or update on a vendor host | PASS | None added. |
| No executeScript with string code | PASS | None, in the source or the bundle. |
| Permissions ⊆ allowed set | PASS | Unchanged: storage, alarms, scripting, notifications, sidePanel; optional idle.<br>Neither the model hosts nor the telemetry host get host access: both calls are plain CORS requests. |
| host_permissions exact | PASS | Gmail and Calendar only. |
| Optional permission in a gesture | PASS | None added. Chrome's model download starts only from a click (`use-builtin-model.ts:52-69`). |
| CSP | PASS | `script-src 'self'; object-src 'none'`, unchanged. No wasm needed. There is no `connect-src` (SEC-3 fix). |
| No remote code | PASS | No eval, `new Function` or `import()` in the 63 files. The bundle's only `Function(` is Zod's probe, guarded by jitless, and predates this sprint. |
| Page text never a selector, type, key or instruction | PASS | Hints and counterparties reach the model only inside the data block. The system prompt is a constant (`prompt.ts:12-20`), and every `<` is escaped (`:24`; `prompt-answer.spec.ts:21`, `:46`).<br>Residual steering within the cap: SEC-11. |
| Model input allowlisted, tested with a double; model only raises PARTIAL toward VERIFIED | PASS | `input.ts` uses strict schemas. `input.spec.ts` checks 20 claims, one with "ignore previous instructions" in its Request.<br>The model can only raise PARTIAL:<br>- `model-raise.ts:40-44` raises only the candidate chosen on the floor, and only when that floor is ≥ `partial`;<br>- every `over_*` rule precedes `verified`;<br>- the loader caps λ·(1 − partial) < verified − partial (`policy-checks.ts` `modelIssues`);<br>- the answer must name only candidates it was given (`schema.ts:58-69`);<br>- scores are integer basis points, 0 to 10,000 (`core/schema.ts:302-305`).<br>e2e intel passed. |
| Bus messages parsed; unknown dropped and logged | PASS | `byo.save`, `byo.forget` and `telemetry.send` are strict schemas in the union, and extension pages only (`listen.ts:83-86`, `:186`). A refused key is logged by message type alone. |
| Stored data parsed on read | PASS | `ModelAnswer` through readRow(s); `telemetrySentDay` through `SentDay`; the stored key and vendor through `StoredByo`; flags fail closed. |
| Text nodes only | PASS | No HTML sink in the 63 files. The payload preview is a text child of a `<pre>`. |
| Dexie bump, migration tested | PASS | v11 adds `modelAnswers` (`db.ts` STORES_V11), tested by `migrations-v11.spec.ts`. |
| Encryption | N/A | Not built. |
| Wipe clears IndexedDB and storage.local | PASS | `settings.ts:58-62` clears `storage.local`, taking the key and its vendor with it, and deletes the database, which turns the flags off. The e2e `options-settings.spec.ts` requires storage empty except the reader choice kept. |
| Install id random, resettable, the only identifier | GAP | It is a v4 `crypto.randomUUID`, resettable in the Danger zone, and sent only with telemetry. But the stored arrival time re-links a reset id (SEC-9), and the panel says nothing uses the id yet (SEC-8). |
| log.ts only; no DOM or raw objects | PASS | No `console` in the 63 files. The new events and values are constants. Errors print as name, code and message length.<br>`byo.saved` logs the vendor only. `bench/intel-record.ts` prints counts and a file name. |
| No PII in user-facing errors or issue prefills | PASS | User-facing errors are fixed sentences. `IntelError` messages are codes, and a vendor's error body is never read. |
| No bare catch; every catch logs | GAP | `builtin.ts:63` (SEC-10). `byo.ts:95` and `builtin.ts:72` return the text, which the caller logs as `intel.answer_invalid`; acceptable. |
| API: `extra='forbid'`; JSON-Schema parity green | PASS | `schema.py:32-35` sets `extra='forbid'` and `strict=True`. Parity is green on both sides, and 77 API tests pass. An id with a trailing newline gets 422 (probe). |
| API: limit per install id and per IP; IP never stored | GAP | Both limits exist, and a payload one limit refuses counts against neither.<br>The address is kept only as a salted hash, in memory: the stored document is exactly `{payload, received_at}` (probe), and the log takes ints only (`logs.py:10`).<br>uvicorn runs with `--no-access-log --no-proxy-headers` (`Dockerfile:18`).<br>The per-client limit can be dodged (SEC-5).<br>Railway's edge sees every address, and what it keeps is Railway's business, outside this code. The docs say only that the API never keeps it. |
| API: no endpoint beyond `/health`, `/v1/aggregate` | PASS | `app.routes` holds exactly these two (probe). Docs and OpenAPI give 404, `HEAD /health` gives 405, and `/v1/stats` gives 404 (Sprint 7). |
| API: CORS | PASS | A preflight from `https://evil.example` gets 400 with no `allow-origin`. The extension's origin is allowed. A `text/plain` POST, which a page could send without a preflight, gets 415. |
| API: error envelopes | PASS | Every status answers one fixed sentence, 500 included. Nothing is echoed. |
| API: body limit | GAP | SEC-4. |
| API: secrets in env; pip-audit | PASS | `MONGO_URL` comes from the environment only; no `.env` is read. Nothing secret is in the Dockerfile, compose (its Mongo binds to 127.0.0.1), `railway.json` or CI (`contents: read`, actions pinned by SHA).<br>`uv run pip-audit`: "No known vulnerabilities found". |
| `pnpm audit --prod` | PASS | "No known vulnerabilities found". No npm dependency changed. |
| New dependency logged | GAP | SEC-12. |
| Vendor terms | N/A | No adapter changed. |

## Gaps

| # | Sev | Rule | Where | Gap |
| --- | --- | --- | --- | --- |
| SEC-1 | HIGH | HR1 | `PrivacyStatement.tsx:7-10`; `Popup.tsx:32`; `SidePanel.tsx:36`; `DigestPage.tsx:26`; `extension/package.json:3`; `README.md:23-25` | "Nothing leaves your browser" is still said unconditionally while either opt-in sends |
| SEC-2 | HIGH | HR1 | `src/background/intel.ts:112-131`, `:141-146` | Turning the key off or forgetting it does not stop a run in progress: up to 9 more claims go to the vendor |
| SEC-3 | HIGH | HR1, HR10 | `src/intel/providers/byo.ts:111-119`; `src/telemetry/send.ts:37-44`; `wxt.config.ts:152-154` | Both calls follow redirects: the vendor's server, not Attest, picks the final host for the facts and the key |
| SEC-4 | MEDIUM | — | `telemetry-api/app/main.py:96-98`; `railway.json:9-11` | The 16 KB limit is checked after the whole body is read into memory |
| SEC-5 | MEDIUM | — | `telemetry-api/app/main.py:48-53`, `:106`; `app/limits.py:12-36`; `scripts/check_client_address.py:28-32` | The per-client limit, the API's only flood control, keys on an exact address and on the first `X-Forwarded-For` line |
| SEC-6 | LOW | HR10 | `src/background/byo.ts:41-44`; `entrypoints/background.ts:29-40`; `src/ledger/consent.ts:6` | The key's closure to content scripts is tested only on a fake, and is unverified on the minimum Chrome |
| SEC-7 | LOW | HR10 | `src/bus/page-commands.ts:114`; `ByoModel.tsx:82`, `:84-90` | A key saved under the wrong vendor is sent to that vendor |
| SEC-8 | LOW | — | `TelemetryToggle.tsx:56-73`, `:85-91`; `InstallIdPanel.tsx:14-16`; `ByoModel.tsx:30-34` | The opt-ins' own disclosures are inexact in three places |
| SEC-9 | LOW | — | `telemetry-api/app/main.py:104`, `:114`; `src/background/alarms.ts:130-134`; `src/ledger/install-id.ts:106-110` | A reset install id can be re-linked by the stored arrival time |
| SEC-10 | LOW | HR6 | `src/intel/providers/builtin.ts:59-66` | A failed availability check is silent and blamed on Chrome |
| SEC-11 | LOW | — (HR4 holds) | `docs/privacy-architecture.md:450`; `docs/grading.md` §5.4 | The docs present the data block as the defence against injection; the cap is the real one |
| SEC-12 | LOW | — | `telemetry-api/pyproject.toml:7-22`; Decisions [5.6], [5.8] | The API's new dependencies have no Decisions line (size, licence, maintenance) |

### SEC-1 (HIGH, HR1): "Nothing leaves your browser", unconditionally

**Where.** None of these files is in the diff. Sprint 5.3 and 5.7 made what they say false:

- `extension/entrypoints/options/components/PrivacyStatement.tsx:7-10`: "Nothing leaves your browser. … sends nothing to any server."
- `extension/entrypoints/popup/components/Popup.tsx:32`
- `extension/entrypoints/sidepanel/components/SidePanel.tsx:36`
- `extension/entrypoints/digest/components/DigestPage.tsx:26`
- `extension/package.json:3`: the manifest description, shown on `chrome://extensions` and used as the store summary.
- `README.md:23-25`: "Attest makes no network requests."

Tests pin the old wording:

- `extension/tests/e2e/options.spec.ts:67-71`
- `extension/tests/unit/options/options-ui.spec.ts:93`, `:275`, `:291`
- `extension/tests/unit/copy.spec.ts:116`

**What happens.** With their own key on, a person's partial claims go to `api.anthropic.com` or `api.openai.com`. Each request carries:

- the claim's kind;
- the recipient's address or name;
- the subject hint;
- the amount and the time;
- the same facts for its match.

With usage numbers on, counts and the install id go out daily. 5.7 and 5.9 rewrote PRIVACY.md (line 7: "Nothing leaves your browser unless you turn it on") and the privacy architecture's §1. The product itself was not changed.

So a person who turned their key on still reads "Nothing leaves your browser … sends nothing to any server". It is the first line of the options page, directly above the Model section that sends. Every popup, side panel and digest page says the same, while each partial match's recipient and subject go to the vendor. The store description and the README make the same claim. build_spec §4 Hard Rule 1 still names the telemetry call as the only permitted outbound request, though §5 locks the BYO call in.

**Fix.**

- Make every statement conditional, as PRIVACY.md is: "Nothing leaves your browser unless you turn on an option that sends", on the options page, in `package.json` and in the README.
- In the popup, side panel and digest:
  - show the plain line only while both options are off;
  - while one is on, name it, e.g. "Your own model key is on: partial matches' facts go to Anthropic." or "Usage numbers are on."
- Change the five pinning tests to require the conditional, and add a test that the line changes when a flag is on.
- Amend HR1's text to name the BYO call, with a Decisions entry.

### SEC-2 (HIGH, HR1): turning the key off does not stop a run in progress

**Where.** `extension/src/background/intel.ts`:

- `:141-146`: the claims to ask and the provider are chosen once per run, then up to MODEL_ASKS_PER_RUN (10) calls run in a loop.
- `:112-131`: `askOne` re-checks neither the flag nor the key before its call.

`src/background/byo.ts:74-86` (`byo.forget`) and `src/background/flags.ts:17-27` (`flag.set`) change storage and meta only.

**What happens.**

1. After a grading batch, a run starts with several PARTIAL claims due. Calls go one at a time, each allowed up to 2 seconds.
2. During the first call, the person clicks "Forget my key" or "Turn off my own key".
3. The handler deletes the key and turns the flag off. The loop, though, still holds the provider, with the key in its closure.
4. The loop sends each remaining claim's facts to the vendor: up to 9 more requests, over up to about 18 seconds, after the person withdrew.

The answers are stored like any other. The window is short, but the rule has no window: nothing is sent once the person has turned the option off.

**Fix.**

- Before each call, check again that the flag is on and, for the key, that one is still saved. Stop the run when either has changed; the cheapest way is to run `chooseProvider` per item and stop when it no longer returns the same kind.
- Better: keep the run's AbortController where `byo.forget` and `flag.set ATTEST_MODEL_BYO false` can reach it. That also cancels the call in flight.
- Add a unit test: two PARTIAL claims, and a provider double that turns the flag off during its first call. Expect exactly one call.

### SEC-3 (HIGH, HR1, HR10): both outbound calls follow redirects

**Where.**

- `extension/src/intel/providers/byo.ts:111-119` and `extension/src/telemetry/send.ts:37-44`: neither init sets `redirect`, and fetch's default is `follow`.
- `extension/wxt.config.ts:152-154`: the CSP sets no `connect-src`.
- `tests/e2e/support/network-guard.ts:56-62` and `no-leak.spec.ts:111`: route records hold the URL and the body, never headers.

**What happens.**

- **307 or 308.** Suppose `api.anthropic.com`, or anything terminating its TLS, answers the POST with a 307 or 308 pointing at another origin. Chrome sends a preflight there. If that origin approves it, Chrome re-sends the body (the claim's facts) and the `x-api-key` header.
- **301, 302 or 303.** These drop the body but still carry `x-api-key`.
- **OpenAI.** The Fetch standard drops OpenAI's `authorization` header on a cross-origin redirect. It does not drop the facts.
- **Telemetry.** The same holds for the telemetry POST.

Nothing in the code or the tests holds the destination to the one host:

- the stand-ins never redirect;
- the secret-seed test never reads headers, which is where the key travels.

agents/intel_engineer.md rule 6 ("sent only to the provider's official endpoint") is then kept by the vendor, not by Attest. The likelihood is low, since the vendor's own endpoint would have to redirect, but the guarantee is unenforced.

**Fix.**

- Set `redirect: 'error'` in both inits. Extend the bundle check's TELEMETRY_CALL pattern to match. Add unit tests that a 3xx is an `IntelError`, or a failed send.
- In depth: add a `connect-src` to the `extension_pages` CSP. It covers the service worker too. List `'self'`, the two vendor endpoints and TELEMETRY_HOST, so the browser refuses every other host, redirects included. The network test's negative control will need its canaries adjusted.
- In the no-leak test, search request headers too, in both the network channel and the telemetry channel.

### SEC-4 (MEDIUM): the body limit is checked after the whole body is read

**Where.**

- `telemetry-api/app/main.py:96-98`: `await request.body()`, and only then `len(body) > max_body_bytes`.
- Starlette 1.7's `Request.body()` joins every chunk with no cap, and uvicorn sets no body limit.
- `telemetry-api/railway.json:9-11`: restart policy ON_FAILURE, 5 retries.

**What happens.** A POST sent as `application/json` with a body of several gigabytes is read whole into memory before the 413, and held twice while it is joined. The probe's 5 MiB body was read whole, then refused.

A few such requests run the container out of memory. Railway restarts it at most five times, then may leave it down until someone redeploys. Meanwhile the extension's sends fail and are retried every hour. No person's data is at risk, but anyone can take the project's only server down, unless Railway's edge caps request bodies, which nothing here sets or checks.

**Fix.**

- Refuse a Content-Length above the limit before reading anything.
- Read the stream chunk by chunk, and answer 413 as soon as the total passes the limit. This also covers chunked bodies.
- Add a test with an oversized body that asserts the stream was not read past the limit.

### SEC-5 (MEDIUM): the per-client limit can be dodged

**Where.**

- `telemetry-api/app/main.py:48-53`, `:106`: the client is the first entry of the first `X-Forwarded-For` line (or the socket's address), taken as an exact string.
- `app/limits.py:12-36`: one entry per key per day, with no bound.
- `scripts/check_client_address.py:28-32`, `:53-57`: one header line per send.

**What happens.** The client chooses its own install id, so the per-client limit is the API's only flood control. It has three weaknesses:

- **IPv6.** Every distinct address is a new client. A client reaching the API over IPv6 can use any address in its /64, and gets 240 payloads a day from each.
- **Duplicate headers.** Starlette's `headers.get` returns the first `X-Forwarded-For` line (probe). The deploy check proves only that a single line written by the client is ignored. A proxy that rewrites one line and passes a duplicate through would pass the check and still let the client choose its address.
- **Memory.** Every new key adds an entry until the UTC day ends, so a flood also grows memory without bound.

The result is unbounded inserts into Mongo (cost and storage), aggregates poisoned before Sprint 7 publishes them, and growing memory. No person's data is at risk.

**Fix.**

- Key IPv6 clients by their /64, and refuse an address that does not parse.
- Read every `X-Forwarded-For` line (`getlist`), and distrust a request that has more than one.
- Add a two-line case and an IPv6 case to `check_client_address.py`.
- Bound the keys counted per day, or add a global daily ceiling on inserts.

### SEC-6 (LOW, HR10): the key's closure to content scripts is not proven

**Where.**

- `extension/src/background/byo.ts:41-44`, `:59-63`.
- The area is closed only at install, update and browser start: `entrypoints/background.ts:29-40`, `src/background/install.ts:81`.
- The only test runs against a fake: `tests/unit/fake-browser-setup.ts:16`.
- `src/ledger/consent.ts:6` still says `storage.local` "is open to content scripts on every Chrome Attest supports".

**What happens.** PRIVACY.md, the docs and the options page all promise the key is kept "where only Attest can read it". No end-to-end test reads `chrome.storage.local` from a content script after a key is saved.

The Sprint 4 review asked for a check that Chrome 120, the minimum version, accepts `setAccessLevel` for `local`. It was never made. The Sprint 4 close moved the flags out of `storage.local` on the opposite premise, which `consent.ts:6` still states.

Chromium 153 accepts the call; the e2e test saves a key there. On an older Chrome that refuses it, saving a key fails closed: nothing is exposed, but the feature is broken there. If the access level does not survive the extension being turned off and on again (neither onInstalled nor onStartup fires then), the area stays open until the next browser start or the next save.

**Fix.**

- Add an e2e test that saves a key, then reads `storage.local` from the Gmail content script's isolated world (CDP, or a test-only script), and requires a refusal.
- Close the area at every worker start as well, with one idempotent call in `main()`.
- Confirm which Chrome first supports `setAccessLevel` for `local`. Raise `minimum_chrome_version` to it, or record the finding in Decisions.
- Correct `consent.ts:6`.

### SEC-7 (LOW, HR10): a key saved under the wrong vendor is sent to that vendor

**Where.**

- `extension/src/bus/page-commands.ts:114`: any 20 to 300 letters, digits, `-` and `_`.
- `extension/entrypoints/options/components/ByoModel.tsx:82`: Anthropic is chosen by default; `:84-90`: the save.
- `src/intel/providers/byo.ts:46-73`: where each vendor's key goes in the request.

**What happens.** A person pastes an OpenAI key (`sk-proj-…`) and leaves the default vendor, Anthropic. Attest saves it as an Anthropic key. At the first partial match, it sends the person's OpenAI secret key to `api.anthropic.com` in `x-api-key`; the reverse mistake works the same way. The vendor answers 401, and a third party now holds the key.

**Fix.** Check the key's prefix against the chosen vendor before saving, both in the schema and in the form, with a one-line reason: Anthropic keys start `sk-ant-`, OpenAI keys start `sk-` but not `sk-ant-`. Or infer the vendor from the prefix.

### SEC-8 (LOW): the opt-ins' own disclosures are inexact

No Hard Rule is broken: the payload and the facts sent are exactly what the schemas allow. But 5.3 and 5.7 ask for "exactly", and three statements are not exact.

**1. The telemetry preview (`TelemetryToggle.tsx:56-73`, `:85-91`).**

- "Exactly what the next send holds:" is built for yesterday, once when the page opens and again after a click.
- Once yesterday has been sent, the box still shows that payload as "the next send", beside "Already sent the numbers for <day>". `tests/e2e/telemetry.spec.ts:50-53` and `:76` read the box after the send and require it to equal what was sent.
- A page left open across midnight, or across new receipts, shows stale numbers under the same caption.

**2. The install id panel (`InstallIdPanel.tsx:14-16`).** It says "Only the opt-in telemetry in a later version uses it." Telemetry ships in this version, and sends the id every day it is on.

**3. The BYO statement (`ByoModel.tsx:30-34`).** It ends "… and the same for each item that might match. Nothing else". The request also carries:

- the candidate's id;
- for a purchase, its merchant (`src/intel/input.ts:35-43`; the docs' §10 table lists both).

The id is an opaque hash, and the shipped policy never asks about a purchase, so no more personal data leaves than the text says. It is still not exact.

**Fix.**

- **Preview:** caption the box "The numbers for <day>", marked "Sent" or "Not sent yet" from `telemetrySentDay`, and rebuild it on `ledger.changed` and when the day turns.
- **Install id panel:** say what uses the id today.
- **BYO statement:** name the id and the merchant, or drop the merchant from the input, since nothing reads it.

### SEC-9 (LOW): a reset install id can be re-linked by its arrival time

**Where.**

- `telemetry-api/app/main.py:104`, `:114`: `received_at` is stored to the microsecond.
- `extension/src/background/alarms.ts:130-134`: the hourly alarm's phase is fixed when the alarm is created.
- `src/ledger/install-id.ts:106-110`: a reset writes a new id and nothing else.
- The promise "can no longer be linked": `PRIVACY.md:115`, `docs/privacy-architecture.md:552`, `InstallIdPanel.tsx:15-16`.

**What happens.**

1. Each install sends at the first hourly alarm after its midnight. Its payloads therefore arrive at the same minute past the hour every day, until Chrome restarts and recreates the alarm.
2. A reset changes the id but not the alarm.
3. So the new id's first payload arrives at the same minute past the hour as the old id's last. It also carries the same `extVersion`, `chromeMajor` and reader switches.

Anyone who reads the stored collection can join the two ids, at least while installs are few: the founder, a breach, or a careless export.

**Fix.**

- Store `received_at` truncated to the day or the hour.
- Add a random delay to each day's send, or recreate the telemetry alarm at a random phase when the id is reset.
- Soften the promise to "the id no longer links them".

### SEC-10 (LOW, HR6): a failed availability check is silent and blamed on Chrome

**Where.**

- `extension/src/intel/providers/builtin.ts:59-66`: a catch with no log.
- Its readers: `src/background/intel.ts:48-51` and `entrypoints/options/use-builtin-model.ts:45-51`.
- The text shown: `BuiltinModelToggle.tsx:25`.

**What happens.** If `LanguageModel.availability()` throws:

- the worker treats Chrome's model as unavailable, writes no log line, and, if the person's own key is on, sends that claim to the vendor instead;
- the options page says "Chrome says this computer cannot run its on-device model", a verdict Chrome never gave.

The checklist requires every catch to log with context.

**Fix.** Log `intel.availability_failed` with the error, and return a distinct value that the page words as "Chrome did not answer; try again".

### SEC-11 (LOW; HR4 holds through the cap): the docs credit the wrong defence

**Where.** `docs/privacy-architecture.md:450`: "the model is told [the block] is data and never instructions; every `<` in it is escaped, so no text inside can close the block". Also `docs/grading.md` §5.4 and `src/intel/prompt.ts:12-25`.

**What happens.** The subject hints the model reads are text that an agent or a mail sender wrote, up to 80 characters each, on the claim and on its match. Delimiters make injection harder; they do not stop a model from following instructions inside data. A hint such as "rate this candidate 1" can steer the score.

What limits the harm is the cap:

- under the shipped policy, the score lifts only a match whose floor is already at or above about 0.8235;
- it can only move PARTIAL to VERIFIED;
- the receipt then shows "Model suggestion".

The docs describe the delimiter and never the cap, so a reader takes the delimiter for the defence.

**Fix.** Add a paragraph to §10 and §5.4: a hint can steer the score; at most, that lifts a PARTIAL with a floor ≥ 0.8235 to VERIFIED, shown as a model suggestion; the weight's cap is the control. Optionally add a unit test that raises with a hostile hint and a score of 1, to pin the bound.

### SEC-12 (LOW): the API's new dependencies have no Decisions line

**Where.** `telemetry-api/pyproject.toml:7-22`; Decisions [5.6], [5.8].

**What happens.** FastAPI, Pydantic and motor are in the locked stack. These are not, and no Decisions line gives their size, licence and maintenance:

- runtime: uvicorn and pydantic-settings;
- development: httpx, mongomock-motor, pip-audit, ruff, mypy and pytest.

Two facts are missing:

- [5.8] says MongoDB now points new code to PyMongo's async client, without saying when motor's support ends;
- FastAPI 0.143 brings `opentelemetry-api` into the image. It is a no-op without an SDK, but it is a new runtime package (`uv.lock`).

**Fix.** Write one Decisions line per runtime dependency (uvicorn, pydantic-settings, and the transitive packages worth naming: starlette, pymongo, opentelemetry-api), and one line for the development tools. Note motor's end of support and the planned move.

## Probes (scratch, not committed)

All are in `scratchpad/s5sec/`.

- **`api_probe.py`.** The API in process, through FastAPI's test client over its memory store. It prints only statuses, booleans and counts.
  - The routes it lists.
  - HEAD, OPTIONS and GET on both routes; `/docs`, `/openapi.json`, `/v1/stats`.
  - An id with a trailing newline: 422.
  - `X-Forwarded-For` rotated with the trust setting on: all accepted. The API trusts the proxy entirely.
  - Two header lines: the first is read.
  - A 5 MiB body: read whole, then 413.
  - Preflights from a foreign origin and from the extension's.
  - A `text/plain` POST: 415.
  - The stored document's keys: exactly `payload` and `received_at`.
- **`build/`.** A copy of the 06:49 build of HEAD. I printed its manifest and scanned every script and page.
- **`trace/`.** `bench/traces/popup-paint.zip` unzipped. It holds no home-folder path.

## Commands run

- `git log --oneline a82916e..HEAD` (11 commits); `git diff --name-only` and `--stat` (205 files).
- The checklist's network grep over `src` and `entrypoints`, with EventSource and importScripts added: two hits, both cited above.
- Greps over the 63 changed `.ts` and `.tsx` files for:
  - acts on vendor DOM;
  - HTML sinks;
  - `eval`, `new Function` and `import(`;
  - `console` and `eslint-disable`;
  - tab and scripting calls;
  - every `catch`.
- `npx eslint --max-warnings=0` over the 63 files, `wxt.config.ts` and `eslint-rules/fences.js`: exit 0. `npx tsc --noEmit`: exit 0.
- `npx vitest run` on `tests/unit/telemetry/schema-parity.spec.ts`, `tests/unit/intel/byo.spec.ts` and `tests/unit/background/byo.spec.ts`: 17 passed.
- `uv run --frozen --no-sync pytest` on `tests/test_schema_parity.py`, `tests/test_api.py` and `tests/test_schema.py`: 77 passed.
- `uv run --frozen --no-sync pip-audit` in `telemetry-api/`: "No known vulnerabilities found".
- `pnpm audit --prod` at the repository root: "No known vulnerabilities found".
- In the built bundle:
  - the manifest, printed;
  - every script, grepped for network APIs, `eval`, `Function(`, executeScript and insertCSS;
  - the vendor and telemetry host strings, located;
  - every page, checked for inline scripts and remote URLs.
- Read, not rerun: `scratchpad/e2e-5.7b.log`, 77 passed on the extension code HEAD carries.
