# Sprint 7 — Security review

Role: agents/security_reviewer.md (task 7.7). Range: `git diff 20bd94a..509f3b6` ("chore: close sprint 6" to HEAD): 7 commits, 69 files, tasks 7.0 to 7.6, Decisions [7.0] to [7.6]. Every file:line below is as at 509f3b6.

What changed, by kind:

- **Shipped extension code.** Copy only: the grant form's hint and error (`src/ui/grant-form.ts`, `GrantLists.tsx`, now `example.com`), the manifest's name and description, the version (0.1.0) and new icons.
- **Telemetry API.** It gains `GET /v1/stats` (`app/stats.py`, `app/main.py`, `app/store.py`) and `scripts/reliability_report.py`.
- **Release and recording tools.** `scripts/check-release.ts`, `tests/tools/check-release-zip.ts`, the two recorders and their frame helper, `render-icons.ts`.
- **Everything else.** Tests, docs and the launch kit under `launch/`, pictures included.

`policy/` and both lockfiles are unchanged.

**How.**

- Read every changed file against the checklist.
- Probed the stats route and the report script with scratch scripts, outside the repository. They ran on a clean export of 509f3b6's `telemetry-api/`, using the repository's own virtual environment.
- Looked at every picture under `launch/`: the six GIF frames (extracted with ffmpeg), the five screenshots and the promo tile. Listed their metadata chunks.
- Read the production build on disk, `extension/.output/chrome-mv3/`: built 05:36 from a tree whose extension code is HEAD's. Also read the zip already in `extension/.output/`.
- Ran the checklist's commands (listed at the end).
- Did not run Playwright, `pnpm e2e` or `pnpm build:release`.

Other sprint-end reviews changed the working tree while this one ran: `MANUAL.md`, `README.md`, `sprints/sprint_7.md`, new tests, the other review files, and for a few minutes `telemetry-api/app/main.py` (an edit since reverted). None of that is covered here. I wrote only this file and scratch files outside the repository.

**Verdict: 7 gaps.** 0 CRITICAL, 0 HIGH, 2 MEDIUM, 5 LOW.

Nothing in the extension Sprint 7 ships sends, reads or stores anything new:

- the network grep, the manifest, the CSP and the bundle are as the Sprint 6 close left them;
- every launch picture holds invented data only.

The two MEDIUM gaps are both in `GET /v1/stats`, the one new route on the public side:

- **SEC-1.** Two answers an hour apart differ by exactly the reports stored between them. In a quiet hour that is one install's whole day, which PRIVACY.md says is never published.
- **SEC-2.** The 50-install floor counts install ids the server cannot verify, and the server takes any calendar day as a report's day. One address can add the 49 missing installs in a second. That makes the endpoint publish one real install's 30-day totals, and lets anyone steer the rates the monthly report will publish.

## Checklist

| Item | Status | Finding |
| --- | --- | --- |
| Network grep finds only `src/telemetry/send.ts` | PASS, one documented exception (unchanged) | Two hits, as at the Sprint 6 close: `send.ts:37` and `src/intel/providers/byo.ts:94`. No new construct; EventSource, importScripts, WebTransport and RTCPeerConnection: none. In the build, `fetch(` is only in `background.js`. |
| Network-intercept E2E ran; allowlist one host or none | NOT RUN here | Not run: the review was asked not to run Playwright. Last result: the Sprint 6 close, 104 of 104 at 6dffbef, the mandatory tests among them. No request path changed in Sprint 7. |
| No remote img, fonts or CDN | PASS | No URL in any built page or stylesheet; the CSP's `default-src 'self'` stands. |
| No externally_connectable, webRequest or DNR | PASS | The built manifest has none; the audit forbids them. |
| Observations and claims go through `redact.project()` | PASS | No new observation or claim path. |
| Policy allowlist unchanged, or logged | PASS | `policy/` is unchanged. |
| Secret-seed test green across every channel | NOT RUN here | Same reason. Last green at the Sprint 6 close (`no-leak.spec.ts` and `no-leak-encrypted.spec.ts` among the 104). |
| Length caps | PASS | No new field. |
| Exports and shares use the projection | PASS | Unchanged. |
| `attest/no-act`, zero disables | PASS | ESLint exits 0 on the 12 Sprint 7 code, config, recorder and script files, with the extension's and the root's configs; the new unit tests were not linted here. No `eslint-disable` in `src`, `entrypoints` or the new scripts and recorders. |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | Shipped code unchanged. The recorders click only the extension's own pages, and are test code. |
| No tabs.create or update on a vendor host | PASS | None added. |
| No executeScript with string code | PASS | None. |
| Permissions ⊆ allowed set | PASS | storage, alarms, scripting, notifications, sidePanel; optional idle; unchanged. |
| host_permissions exact | PASS | Gmail and Calendar only. |
| Optional permission requested in a gesture | PASS | Unchanged. |
| CSP | PASS | `default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob:; form-action 'none'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://telemetry.attest.invalid`. `pnpm audit:manifest`: OK. The release build differs only in the telemetry host, which the audit takes from the same constant. |
| No remote code | PASS | No `eval(`. `Function(` only as Zod's jitless probe (three files, as before). The tinyurl and bit.ly strings in the bundle are Dexie's error texts. |
| Page text never a selector, type, key or instruction | PASS | Unchanged. |
| Model input allowlisted, tested with a double | PASS | Unchanged. |
| Bus messages parsed; unknown dropped and logged | PASS | Unchanged. |
| Stored data parsed on read | PASS | Unchanged. |
| Text nodes only | PASS | The grant form's change is copy. `tests/e2e/support/frames.ts` writes HTML from constants and escapes them (test code). |
| Dexie bump, migration tested | N/A | No table changed. |
| Encryption | N/A | Unchanged. |
| Wipe | N/A | Unchanged. |
| Install id random, resettable, the only identifier | PASS, with SEC-2 | The stats never name one (`test_never_names_an_install_id`). But the floor counts them as people (SEC-2). |
| `log.ts` only; no DOM or raw objects | PASS | No shipped logging change. The API's new events (`stats.served`, `stats.withheld`, `stats.store_failed`) carry an int status only. |
| No PII in user-facing errors | PASS | The grant form's error names `example.com`. `check-release-zip.ts` prints the kind of each problem, never a message. |
| No bare catch; every catch logs | PASS | Sprint 7 code uses try/finally; the API's `except StoreError` logs; the report script prints its own fixed message. |
| Pydantic `extra='forbid'` inbound; JSON-Schema parity green | PASS | Inbound unchanged. The stats answer's models forbid extra keys too. The parity tests are among the 125 that pass. |
| Rate limit per install id and per IP; IP never stored | PASS for POST, with SEC-2 and SEC-4 | The stats route never reads the address. It has no limit of its own (SEC-4). The POST limits leave 240 new install ids a day to each address (SEC-2). |
| No endpoint beyond `/health`, `/v1/aggregate`, `/v1/stats` | PASS, with SEC-3 | 404 for every other path tested. But every route also answers its path with a final slash: a 307 to `http://<Host header>/<path>` (FastAPI's default, on every route since 5.8; SEC-3). |
| Secrets in env only; `pip-audit` clean | PASS | No new setting; `MIN_INSTALLS` and `WINDOW_DAYS` are constants, not settings. `uv run pip-audit`: "No known vulnerabilities found". |
| `pnpm audit --prod` | PASS | "No known vulnerabilities found". |
| New dependency logged | PASS | No lockfile change. ffmpeg is a tool `pnpm record-demo` needs on the machine, never in the build (Decisions [7.3]). |
| Vendor terms | N/A | No adapter changed. |

## Beyond the checklist

### The stats endpoint

- **What one install can give away.** Its whole day, from two answers an hour apart (SEC-1). With invented installs beside it, its 30-day totals (SEC-2).
- **Cache poisoning.** None in the HTTP sense:
  - The answer depends on no request input: query strings are ignored (`?since=2000-01-01&installs=1` gets the same answer), and no header is read.
  - The cache is one answer, and only the store's data changes it.
  - Changing it through the data is SEC-2.
- **Unbounded queries.** Every read of a stale answer runs both aggregations. They scan the whole collection: nothing indexes `payload.dayBucket`, and nothing is ever deleted. See SEC-4.
- **CORS.**
  - A GET from the extension's origin gets `access-control-allow-origin`; any other site's page cannot read the answer in a browser, which Decisions [7.5] intends.
  - A preflight from another origin is refused, in Starlette's plain text, as it has been since 5.8.
  - The data is public by design, so CORS protects nothing here and opens nothing.
- **Error shapes.**
  - POST, PUT and HEAD get a 405 in the envelope; a store failure gets a 503 in the envelope.
  - Below the floor, a 204 with no body.
  - Only the trailing-slash 307 answers outside the envelope (SEC-3).
- **The floor and the window.** Both are constants (`app/stats.py:22`, `:24`). Settings ignore unknown variables (`extra="ignore"`), and the route takes no parameter, so neither a deployment nor a request can change them. The window is the 30 days before the server's UTC date.

### The report script

It trusts its answer in four ways: no floor of its own, a prefix check on the address, redirects followed, and free text into the report (SEC-3). Also, the command its documentation gives does not run (Notes).

### The recorder and release scripts

- **Command injection.** None found. Every `execFileSync` takes an argument array, with no shell. Each argument is one of these:
  - a constant;
  - a path under the repository;
  - an `mkdtemp` folder;
  - the version read from `extension/package.json`.
- **Temporary folders.** Made by `mkdtemp`, owner-only, and removed in `finally`.
- **Unzipping.** `unzip` refuses `../` entries by default, and the zip is the build's own.
- **Other inputs.** ffmpeg's input and output paths are absolute, so it never reads them as a protocol. `render-icons.ts` renders a repository SVG in a browser with no extension and no external reference.
- **What the release check checks.** It cannot tell a development zip from a release one (SEC-5).

### The launch pictures

- **What they show.** I viewed every frame of `launch/demo.gif`, the five screenshots and the promo tile:
  - every name is invented (Priya, Sam Chen, Vendor Billing);
  - every address is at a reserved domain (`supplier.example`, `company.example`, `example.com`);
  - the only real-world values are the recording's clock times (04:17, 04:26) and its dates.
- **Metadata.** The PNGs hold only IHDR, IDAT and IEND chunks. The GIF holds only its NETSCAPE loop block. No file contains a home path or a temporary folder's name.
- **The demo's source pages.** `synthetic-sent-page-1.html` holds 24 addresses and the Calendar week 9, all at reserved domains.
- **The launch kit's text.** No handle and no address; its only URLs are the two observer hosts in `store-listing.md`. No line Sprint 7 added anywhere holds an address at a non-reserved domain.
- **The gap.** The pictures are clean; the checks that should keep them so are thin (SEC-6). Separately, the launch sequence makes the repository public without naming the clean-up that must come first (SEC-7).

### The manifest's new name

No security effect:

- No code reads it: the only `getManifest()` read is the version, for the usage numbers. Pages and alerts use `EXTENSION_NAME` ('Attest').
- The extension's id, and so the API's CORS allowlist, does not depend on it.
- The zip's name comes from `package.json` (WXT's `{{name}}`), not from the manifest.
- The audit allows the `name` key with any value, as before.

### The release build as it would ship

These two differences are made at build time:

- no `dev` or `model-check` page (`releaseEntrypoints`, unit-tested in `tests/unit/ui/components.spec.ts`);
- a telemetry host that is not `.invalid` (`assertReleasable`, unit-tested in `tests/unit/telemetry/facts.spec.ts`).

The CSP's `connect-src` will then name the real host, and the audit's `CONNECT_HOSTS` derives from the same constant. Its source maps (Decisions [7.0]) hold relative sources under `src/`, `entrypoints/`, `node_modules/` and `policy/`: no home path, no test, no fixture. `extension/assets/icon.svg` does not ship.

The zip itself cannot be built yet (BLOCKED(MANUAL), 7.0), and the check that would run on it does not verify either difference (SEC-5).

## Gaps

| # | Sev | Rule | Where | Gap | Fix direction (one line) |
| --- | --- | --- | --- | --- | --- |
| SEC-1 | MEDIUM | HR1, HR10 | `telemetry-api/app/main.py:204-222`; `app/stats.py:75-93`; `PRIVACY.md:112`; `docs/privacy-architecture.md:478` | Two answers an hour apart differ by exactly the reports stored between them: in a quiet hour, one install's whole day | Publish one answer per UTC day, made from reports stored before that day began, withheld when fewer than k installs changed it; else correct PRIVACY.md and §11 |
| SEC-2 | MEDIUM | HR12, HR1 | `app/schema.py:87`, `:94-99`; `app/main.py:186`; `app/limits.py:85-98`; `app/settings.py:30`; `app/store.py:80-82`; `launch/reliability-report-v0.md:5`, `:11-17` | The floor counts unverified install ids, and any day is taken: one address crosses 50 in a second and can steer the published rates | Refuse days far from the server's date, cap new install ids per address a day, count installs seen on several days, and say installs are unverified |
| SEC-3 | LOW | HR12 | `telemetry-api/scripts/reliability_report.py:29`, `:32`, `:36-40`, `:60-71`; `app/stats.py:43-62`; `app/main.py:227`; `build_spec.md:604` | The report script has no floor of its own, accepts plain http to any host, follows redirects to http, and puts the answer's free text in the report | Check the floor, dates and bounds in the script, parse the address strictly, refuse redirects, and set `redirect_slashes=False` |
| SEC-4 | LOW | — | `app/main.py:206-216`; `app/store.py:73-91`; `app/settings.py:31` | Every read during a refresh runs its own two full-collection scans; no index, no retention, no limit on GET | Run one refresh at a time, index `payload.dayBucket`, bound retention, and limit GET per address |
| SEC-5 | LOW | HR1, HR9 | `scripts/check-release.ts:18-25`; `extension/tests/tools/check-release-zip.ts:48-50`; `scripts/audit-manifest.ts:120-149`; `extension/wxt.config.ts:200-202`; `MANUAL.md:70` (at HEAD) | The release check passes a development zip, and one is in `extension/.output/` under the exact name MANUAL.md says to upload | Have the zip check refuse a development page or a `.invalid` host, name non-release zips differently, and delete the stale one |
| SEC-6 | LOW | HR2, HR10 | `extension/tests/e2e/demo.record.ts:79-122`; `extension/tests/e2e/store-shots.record.ts:29-34`, `:62-66` | The demo recorder checks no frame for seeded secrets or real addresses, two vendor test pages among them; the screenshots' check reads `innerText` only | Run the seeded-secret and reserved-domain check before every frame of both recorders, form values included |
| SEC-7 | LOW | HR2, HR10 | `launch/launch-checklist.md:7`; `MANUAL.md:69` step (1), `:67`, open `:65` and `:44` (at HEAD) | The launch steps make the repository public without naming the two open clean-ups MANUAL.md requires first | Name both as preconditions in each step that makes the repository public, and have the agent refuse until they are done |

### SEC-1 (MEDIUM, HR1, HR10): two answers an hour apart give away one install's day

**Where.**

- `telemetry-api/app/main.py:204-222`: one answer is kept an hour. The first read after the hour remakes it from whatever the store holds then (`:209`, `:216`).
- `app/stats.py:75-93`: the 50-install floor applies to the window's installs. Nothing compares an answer with the one before.
- What is promised:
  - `PRIVACY.md:112`: "never an install id or any one install's day";
  - `docs/privacy-architecture.md:478`, the same;
  - `launch/store-listing.md:77`, the certification that user data is not transferred.

**What happens.**

1. Within a UTC day the window is fixed. Each answer is the one before plus the reports stored since.
2. An install sends one report a day: at its first hourly alarm after local midnight, at the first unlock if encrypted, or when the person presses "Send a test payload now". In an hour when one report arrives, the next answer differs from the last by exactly that install's day:
   - for each agent, its receipts, VERIFIED, NOT_FOUND and UNASKED;
   - from `installs`, whether the install is new to the window.
3. Measured on 509f3b6, over the in-memory store: 50 installs, then one report stored, then the answer an hour later. `installs` went 50 → 51, and ChatGPT's numbers rose by receipts 6, verified 2, not found 1 and unasked 3: exactly that report.
4. Anyone can poll. The first read after the hour starts the next one, so the poller also chooses when each hour begins. A deployment with more than one replica keeps a cache per process, so it refreshes more often.

Linking a delta to a person takes one more fact: the hour their report went. Someone who sees their connection to the telemetry host can know it, and so can anyone who knows they pressed the test button. With it, the public learns which agents that person uses, how many actions those agents took that day, and how many were not found or done unasked. That is exactly what PRIVACY.md and §11 say is never published.

**Fix.**

- Make one answer per UTC day, from the reports stored before that day began, and serve it unchanged until the next.
- Withhold an answer when fewer than k installs' reports changed it since the one before.
- Add a test: two answers around one stored report never differ by that report alone.
- If the hourly answer stays, PRIVACY.md and §11 must say that one report can be read from two answers.

### SEC-2 (MEDIUM, HR12, HR1): the floor counts install ids anyone can make, on any day

**Where.**

- **Days.** `app/schema.py:87` and `:94-99` take any real calendar date as `dayBucket`, and `app/main.py:186` checks the limits against the server's date only. Nothing compares the report's day with it.
- **Limits.** `app/limits.py:85-98` and `app/settings.py:29-30` allow 24 reports per install id and 240 per address a day, and a new install id costs nothing. An IPv6 client gets one address per /64 it holds.
- **The count.** `app/store.py:80-82` counts distinct install ids in the window; `app/stats.py:77` is the floor.
- **What is promised.**
  - `launch/reliability-report-v0.md:5` ("From {{installs}} Attest installs"), and its "What these numbers cannot say" (`:11-17`), which does not mention this.
  - `launch/README.md:17`: "it never ships with fewer than 50 installs".

**What happens.** All measured on 509f3b6:

- One address posted 49 invented installs, each answered 204, in under a second. With one real install in the store, the next answer published `installs: 50`. Claude's numbers in it were exactly the real install's 30 days (receipts 5, verified 1, unasked 4), the invented ones having none.
- One address can add 240 invented installs a day; the 241st is refused (429).
- A report may claim any day: 2031-01-01 and 1999-01-01 were both stored. So one person can fill the whole 30-day window in a day, or preload the days to come.

So the floor guarantees neither that 50 people reported nor that one person's totals stay hidden. Anyone can also move the published rates, and the report's "From N Attest installs", which is the founder's public number (Hard Rule 12).

**Fix.**

- Refuse at ingest a `dayBucket` more than two days from the server's UTC date: the extension only ever sends its local yesterday.
- Cap how many new install ids one address may introduce a day.
- Count an install toward the floor only once it has reported on several days.
- Say, in the report's limits and in PRIVACY.md, that installs are self-reported ids the server cannot verify.
- Compare the installs with the store's user count before a report is published.

### SEC-3 (LOW, HR12): the report script trusts what it is answered

**Where.**

- `telemetry-api/scripts/reliability_report.py`:
  - `:29`, the scheme check, a prefix;
  - `:32`, `urlopen` with its default redirect handling;
  - `:36-40`, the answer accepted;
  - `:60-71`, `render`.
- `app/stats.py:43-62`: read back, `since` and `until` may be any string, and counts and rates any number.
- `app/main.py:227`: FastAPI's default `redirect_slashes`.
- `build_spec.md:604`: the Progress Log says the script "also refuses below 50".

**What happens.** Each item below was measured, with `urlopen` stubbed:

1. **No floor of its own.** A 200 answer with `installs: 3` renders "From 3 Attest installs". The script refuses only a 204, so the floor rests on the server alone. An answer from an older build, a test deployment or a wrong address would be written up, and the Progress Log line overstates the script.
2. **Plain http to any host.** The prefix check accepts `http://localhost.attacker.example/…`, `http://127.0.0.1.attacker.example/…` and `http://localhost@attacker.example/…`.
3. **Redirects to http.** urllib's default handler follows an https address to an http one. The API itself makes such a redirect: it answers `/v1/stats/` with a 307 to `http://<Host header>/v1/stats`. That is FastAPI's slash redirect, on every route since 5.8, built from a client header with the http scheme, because uvicorn runs with `--no-proxy-headers`. An address typed with a final slash is then fetched over plain HTTP, wherever the edge serves it.
4. **Free text in the report.** `since` and `until` reach the report as they come: a Markdown link and an `<img>` tag both did. A count of −5 and a rate of 7.5 render as "-5 (750.0%)".

Each needs a wrong or hostile answer, which is why this is LOW. But the report is the founder's public number, published by pasting.

**Fix.**

- In the script, require:
  - `installs` ≥ `MIN_INSTALLS`;
  - `since` and `until` ISO dates, `WINDOW_DAYS` apart;
  - counts ≥ 0, and each rate in [0, 1] and equal to its counts' ratio.
- Parse the address: https, or http with a host of exactly `localhost`, `127.0.0.1` or `::1`, and no user info.
- Refuse redirects.
- Create the app with `redirect_slashes=False`, and test that `/v1/stats/` is a 404.
- Correct the Progress Log line.

### SEC-4 (LOW): each read during a refresh scans the whole collection again

**Where.**

- `app/main.py:206-216`: a stale answer is checked, the sums awaited, then the answer kept. Nothing stops a second refresh starting meanwhile. `:206`: the route has no limit, and each read logs a line.
- `app/store.py:73-91`: two aggregations per refresh, each a `$match` on `payload.dayBucket`. No index covers it: nothing calls `create_index`. The `$group` holds every distinct install id of the window.
- `app/settings.py:31`: up to 100,000 documents stored a day. Nothing ever deletes one.

**What happens.**

- Measured: 40 reads of a stale answer, all at once, ran the sums 40 times, over a stand-in store whose sum takes 0.2 s.
- Every read that arrives while a refresh runs starts its own, each scanning the whole collection twice, and the collection only grows. So a burst of reads at the turn of each hour multiplies full scans of the database `POST /v1/aggregate` writes to. A database that slows down answers both routes with 503.
- Availability only: no data is exposed.

**Fix.**

- Run one refresh at a time (an asyncio lock or a shared task); the other reads serve the kept answer or wait for the new one.
- Index `payload.dayBucket`.
- Set a retention period, and state it in PRIVACY.md.
- Limit GET per address, as POST is.

### SEC-5 (LOW, HR1, HR9): the release check passes a development zip, and one is waiting

**Where.**

- `scripts/check-release.ts:18-25`.
- `extension/tests/tools/check-release-zip.ts:16`, `:48-50`: the service worker starts, three pages open clean, the version matches. Nothing more is checked.
- `scripts/audit-manifest.ts:63-67`, `:120-149`: the manifest only.
- `extension/wxt.config.ts:108-125`, `:169-174`: the release differences, made only while `ATTEST_RELEASE=1` builds. `:200-202`: the same zip name with or without it.
- `MANUAL.md:70` at HEAD: "upload `.output/attest-0.1.0.zip`".
- Decisions [7.0].

**What happens.**

- What makes a store zip a release (no `dev` or `model-check` page, and a telemetry host that is not `.invalid`) is enforced only while the zip is built. The checks that run after it never look.
- The zip in `extension/.output/` now is such a build. Decisions [7.0] records that it was built without `ATTEST_RELEASE`, and the install check passed it. It holds:
  - `dev.html` and `model-check.html`;
  - a CSP naming `https://telemetry.attest.invalid`;
  - the name, description and icon from before 7.4 (built 03:48; 7.4 landed 04:40).

  `pnpm audit:manifest extension/.output/attest-0.1.0.zip` answers OK (measured). It is the exact file MANUAL.md says to upload.
- Once `TELEMETRY_HOST` is set, the audit would refuse that zip's `connect-src`. But any `wxt zip` without `ATTEST_RELEASE` then writes the same name with the real host, and both checks pass it.
- Shipped, it would add two development pages to the store build: a component gallery, and the on-device model check, which saves a recording at a click. Neither reads the ledger. Today it would also ship a usage-numbers option that can never deliver.

**Fix.**

- Make `check-release-zip.ts` fail when the zip holds a page of `DEV_ENTRYPOINTS`, when its CSP names a `.invalid` host, or when its name or description differ from the build's.
- Delete `extension/.output/attest-*.zip` before `wxt zip`, and give a non-release zip another name (a `-dev` suffix).
- Delete the zip there now.

### SEC-6 (LOW, HR2, HR10): the recorders' checks do not cover every frame

**Where.**

- `extension/tests/e2e/demo.record.ts:79-122`: no seeded-secret check and no address check on any frame. Two frames are vendor test pages: Gmail at `:101`, Calendar at `:106`.
- `extension/tests/e2e/store-shots.record.ts:29-34`: the check reads `document.body.innerText` only. `:62-66`: the grant shot's typed recipients are a value `innerText` never holds.
- Sprint 7.3 and 7.4's Done-when: fixture data only, checked by a secret-seed grep.

**What happens.**

- The pictures are clean today (see "The launch pictures" above).
- But the demo recorder, which also photographs two vendor test pages, runs neither check. A future change to `synthetic-sent-page-1.html`, or to the Calendar week, reaches the README's GIF unchecked.
- The screenshots' check misses everything `innerText` leaves out: input, textarea and select values, alt and title text, and pictures.

**Fix.**

- Run the same check before every frame in both recorders, vendor pages included.
- Extend it to form values, failing on any address outside a reserved domain.

### SEC-7 (LOW, HR2, HR10): the launch steps go public without the clean-ups that must come first

**Where.** In `launch/launch-checklist.md`, and in `MANUAL.md` at HEAD:

- `launch-checklist.md:7`: "The repository is public, under the license chosen".
- `MANUAL.md:69`, the GitHub Pages item, rewritten in 7.2, whose step (1) is "Make the repository public first (the item above)".
- `MANUAL.md:67`: the item that makes it public.
- The two open items that must come first:
  - `:65`, cleaning the real captures;
  - `:44`, the old bench trace in git history.

**What happens.**

- **The captures.** By `:65`, the 2026-10-06 and 2026-10-07 Gmail captures keep names, addresses and phrases faked with the old public seed, which anyone can confirm by guessing. Counted without reading values: 7 of 8 pages in each folder still hold addresses at non-reserved domains.
- **The bench trace.** By `:44`, the old trace in the history names the founder's home folder.
- **The gap.** Only `:65` says it is needed first. The launch checklist, the Pages step and the go-public item name neither. A founder following the checklist from his phone, or an agent told "make the repo public", publishes both.

**Fix.**

- Name both items as preconditions in `launch-checklist.md:7`, in the Pages step (1) and in the go-public item.
- Have the agent refuse "make the repo public" while either is open.

## Notes (not security gaps)

- **The report command fails as documented.** `uv run python scripts/reliability_report.py <address>`, given in `telemetry-api/README.md:9` and the template, fails at import: "No module named 'app'". `pyproject.toml` has no build system, so the project is not installed, and Python puts the script's folder, not the project's, first on its path. `python -m scripts.reliability_report` runs.
- **The edit seen in `main.py` during this review.** It set `cache.made` before the sums, then was reverted; it looked like a QA mutation. If something like it comes back as the fix for SEC-4, it would keep a failed refresh as fresh: after a 503, the previous answer, or a 204 at first start, would be served for the hour. QA's `test_never_keeps_a_failure` covers that.
- **Design, not defects.**
  - Source maps ship in the store zip by Decisions [7.0], holding nothing but sources.
  - `installs` publishes adoption over time.
  - The pictures show when they were recorded.

## Commands run

- `git log --oneline 20bd94a..HEAD`, `git diff --stat` and `--name-status`; `git status` at the start and before writing.
- The checklist's network grep over `extension/src` and `extension/entrypoints`, with EventSource, importScripts, WebTransport and RTCPeerConnection added: two hits, as above.
- On the build in `extension/.output/chrome-mv3/`:
  - the manifest, printed;
  - `fetch(`, `eval(` and `Function(` greps;
  - every URL in the HTML, CSS and JavaScript;
  - every source map's `sources` and `sourcesContent` searched for home paths, tests and fixtures.
- `pnpm audit:manifest`: OK. Also `pnpm audit:manifest extension/.output/attest-0.1.0.zip`: OK (SEC-5); and `unzip -l` and `unzip -p … manifest.json` on that zip.
- `pnpm audit --prod` at the root: "No known vulnerabilities found".
- In `telemetry-api/`:
  - `uv run pip-audit`: no known vulnerabilities;
  - `uv run ruff check .`: all checks passed;
  - `uv run mypy app tests scripts`: no issues in 25 files;
  - `uv run pytest -q`: 125 passed, and 125 again on a clean export of 509f3b6.
- `pnpm --dir extension exec eslint --max-warnings 0` on the nine Sprint 7 code, config, recorder and tool files under `extension/`, and `pnpm exec eslint` on the three new root scripts: exit 0.
- `pnpm --dir extension exec vitest run` on 13 files, 116 tests passed:
  - grant-form and grants;
  - store-listing, launch-kit, demo-gif, results-md, headers, readme, changelog;
  - audit-manifest, manifest-hosts, components, telemetry facts.
- Scratch probes, outside the repository, on a clean export of 509f3b6's `telemetry-api/`:
  - differencing (SEC-1);
  - invented installs, days and one address's budget (SEC-2);
  - concurrent reads (SEC-4);
  - methods, query strings, the trailing slash and CORS;
  - the report script's address check, its handling of a 200 answer and urllib's redirects, with `urlopen` stubbed (SEC-3).
- `ffmpeg -i launch/demo.gif -vsync 0 <scratch>/f-%d.png`, then every frame, screenshot and the tile viewed. PNG chunks and GIF blocks listed. Every changed text file scanned for addresses at non-reserved domains, counting only, in the lines Sprint 7 added. The demo's two source pages and the capture folders were counted the same way, never printing a value.

## Re-run 2026-10-14 on v0.1.0 (088cc7f)

Role: agents/security_reviewer.md (task 7.7, again, on the release build). Range: `git diff 4f5d3c2..5f12c02`, from the Sprint 7 close ("chore(sprint-7): close 58 review gaps", 4f5d3c2 in the rewritten history; `commit-map-2026-10-14.txt` maps the old ids) to HEAD: 20 commits, 52 files. Also the release zip, `extension/.output/attest-0.1.0.zip` (SHA-256 `a2f6e40ff33abf49…faad4`, built at the tag v0.1.0 = 088cc7f), and the public repository's settings. Every file:line below is as at 5f12c02.

What changed, by kind:

- **Shipped extension code.** Two constants:
  - `TELEMETRY_HOST` is the deployed Railway host (`extension/src/config-network.ts:22`);
  - `HOMEPAGE_URL` (`src/config-manifest.ts:19`) is written as the manifest's `homepage_url` (`wxt.config.ts:204`). The audit allows that key with that value only (`scripts/audit-manifest.ts:35`, `:150`).
- **Telemetry API.** PyMongo's `AsyncMongoClient` replaces motor (`app/store.py:24`, `:104-107`, `:143-144`). For the tests only: `httpx2` (with `httpcore2` and `truststore`) in place of `httpx`, `mongomock` in place of `mongomock-motor`, and `tests/async_mongo.py`. The image still installs with `uv sync --locked --no-dev` (Dockerfile unchanged since 5.8).
- **Test tooling.** `extension/tests/tools/capture-refake-people.ts` (new); `capture-fakes.ts` now exports its pools.
- **CI.** The unit job installs Playwright's Chromium (`.github/workflows/ci.yml:47-48`).
- **The repository.** Public since 2026-10-14: a new repository holding the rewritten history, two rulesets on `main`, Pages built from `main`'s root, the tag and release v0.1.0.
- **Everything else.** Docs, the license (FSL-1.1-ALv2), tests.

`policy/` and `pnpm-lock.yaml` are unchanged; `telemetry-api/uv.lock` changed.

**How.**

- Read every changed code, config and tool file against the checklist.
- Unzipped the release zip into a new empty folder in the scratchpad. Read its manifest and CSP, grepped every bundle, page and stylesheet, and compared every source its source maps hold with the tree at 088cc7f.
- Read the repository's GitHub settings with read-only `gh api` calls. Changed nothing.
- Ran the tools listed at the end.
- Did not run Playwright, `pnpm e2e` or the extension's full unit suite. CI run 38675724976 on 088cc7f passed all eight jobs, `build · e2e` with both mandatory tests among them.
- Never read the capture key. Fixture values were counted by shape, never printed.

I wrote only this section and scratch files outside the repository.

**Verdict: 6 gaps.** 0 CRITICAL, 0 HIGH, 0 MEDIUM, 6 LOW.

The release zip is what the tag says, and holds nothing it should not:

- it is byte for byte the build in `extension/.output/chrome-mv3/`, and GitHub's digest of the release asset `attest-0.1.0.zip` is the same SHA-256;
- all 420 sources under `src/`, `entrypoints/` and `policy/` in its source maps equal their files at 088cc7f;
- its `connect-src` names the two model vendors and the Railway host only, it has no development page, and `fetch(` is at two sites in `background.js` only.

The repository holds no secret, no home path and no personal value but those the founder chose to publish (PRIVACY.md's operator and private contact). The gaps are in what surrounds the release:

- the public repository's own guards are off (SEC-R3, SEC-R4);
- Pages publishes the whole repository beside the policy (SEC-R2);
- the telemetry host is a name the founder holds only while Railway's service keeps it (SEC-R5);
- what is left of the clean-up: the re-fake tool's record guard (SEC-R1) and the two private archives (SEC-R6).

### Checklist

| Item | Status | Finding |
| --- | --- | --- |
| Network grep finds only `src/telemetry/send.ts` | PASS, one documented exception (unchanged) | Two hits, as at the close: `send.ts:38` and `src/intel/providers/byo.ts:94`. No EventSource, importScripts, WebTransport or RTCPeerConnection. In the zip, `fetch(` is only in `background.js`, twice. |
| Network-intercept E2E ran; allowlist one host or none | NOT RUN here; green on CI | Not run, as asked. CI run 38675724976 on 088cc7f: `build · e2e` passed, its @mandatory step and the report check among it. Now that `TELEMETRY_HOST` resolves, what matters is that no test reaches it: every launch runs behind the dead proxy (`extension/tests/e2e/support/extension.ts:176-180`), the perf gate and the zip's install check included, since they use the same launcher. |
| No remote img, fonts or CDN | PASS | The zip's four pages load only `/chunks/` and `/assets/`; its stylesheet has no `url(` or `@import`. |
| No externally_connectable, webRequest or DNR | PASS | None in the zip's manifest. |
| Observations and claims go through `redact.project()` | PASS | No new path. |
| Policy allowlist unchanged, or logged | PASS | `policy/` is unchanged. |
| Secret-seed test green across every channel | NOT RUN here; green on CI | The same CI run; `no-leak.spec.ts` is among the mandatory tests. |
| Length caps | PASS | No new field. The re-fake keeps each phrase on its side of the 80-character subject hint (`capture-refake-people.ts:41`, `:132`). |
| Exports and shares use the projection | PASS | Unchanged. |
| `attest/no-act`, zero disables | PASS | ESLint exits 0 on the seven changed extension files and on `scripts/audit-manifest.ts`. No `eslint-disable` in `src` or `entrypoints`. |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | The shipped change is two constants. |
| No tabs.create or update on a vendor host | PASS | None added. |
| No executeScript with string code | PASS | None. |
| Permissions ⊆ allowed set | PASS | storage, alarms, scripting, notifications, sidePanel; optional idle; unchanged. |
| host_permissions exact | PASS | Gmail and Calendar only. |
| Optional permission requested in a gesture | PASS | Unchanged. |
| CSP | PASS, with SEC-R5 | `default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob:; form-action 'none'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://attest-production-5149.up.railway.app`. `pnpm audit:manifest extension/.output/attest-0.1.0.zip`: OK. Whose name the host is: SEC-R5. |
| `homepage_url`, a new manifest key | PASS, with SEC-R2 | The audit requires exactly `HOMEPAGE_URL` and fails any other value or none (`scripts/audit-manifest.ts:150`), unit-tested. It is a link on Chrome's details page; no code reads it. What its site publishes besides the policy: SEC-R2. |
| No remote code | PASS | No `eval(`. `Function(` only as Zod's jitless probe (three files, as before). Every `import(` is a relative chunk. The bit.ly and tinyurl strings are Dexie's error texts. |
| Page text never a selector, type, key or instruction | PASS | Unchanged. |
| Model input allowlisted, tested with a double | PASS | Unchanged. |
| Bus messages parsed; unknown dropped and logged | PASS | Unchanged. |
| Stored data parsed on read | PASS | Unchanged. |
| Text nodes only | PASS | Unchanged. |
| Dexie bump; encryption; wipe | N/A | Unchanged. |
| Install id random, resettable, the only identifier | PASS | Unchanged. |
| `log.ts` only; no DOM or raw objects | PASS | No shipped logging change. `capture-refake-people.ts` prints file names and counts only (`:231-237`), and its errors carry no value. |
| No PII in user-facing errors | PASS | Unchanged. The zip's issue link names the public repository. |
| No bare catch; every catch logs | PASS | No catch added. `store.py` still turns `PyMongoError` into `StoreError`, which the routes log. |
| Pydantic `extra='forbid'` inbound; JSON-Schema parity green | PASS | Inbound unchanged. `uv run pytest`: 278 passed, the parity tests among them. |
| Rate limit per install id and per IP; IP never stored | PASS | Unchanged; a stored document is still `{_id, payload, received_at}`. |
| No endpoint beyond `/health`, `/v1/aggregate`, `/v1/stats` | PASS | The routes are unchanged. |
| Secrets in env only; `pip-audit` clean | PASS | `MONGO_URL` comes from the environment, as before; no secret in `railway.json`, the Dockerfile or the API's README. `uv run pip-audit`: "No known vulnerabilities found". The image's packages (`uv export --locked --no-dev`): 18, PyMongo 4.18.3 and dnspython in place of motor. httpx2, httpcore2, truststore and mongomock are for the tests and never in the image. |
| `pnpm audit --prod` | PASS | "No known vulnerabilities found". `pnpm-lock.yaml` unchanged. |
| New dependency logged | PASS, with a note | Decisions [7.close] (2026-10-14, the Mongo driver) names PyMongo, mongomock and httpx2, but no license, size or maintenance. Read from their metadata: PyMongo Apache-2.0 (MongoDB); httpx2 and httpcore2 BSD-3-Clause (by Tom Christie, maintained by Pydantic Services; Starlette 1.7's test client imports `httpx2` first and warns on `httpx`); truststore MIT; mongomock ISC. truststore 0.10.5 was published 2026-10-12, two days before the lock. |
| Vendor terms | N/A | No adapter changed. |

### Beyond the checklist

#### The release zip

- **What it is.** `diff -rq` finds it identical to `extension/.output/chrome-mv3/` (built 23:20). GitHub reports the release asset's digest as `sha256:a2f6e40f…faad4`, the local file's. `sprints/sprint_7.md:26`, on protected `main`, records the same.
- **Its manifest.**
  - Version 0.1.0, `homepage_url` the policy's address, `minimum_chrome_version` 122, `incognito: not_allowed`.
  - The permissions and hosts above, and no content script declared.
  - No development page: no `dev.html` or `model-check.html`. The words appear only in two source maps, as a type name and a comment.
- **Every URL in its code and pages.**
  - The vendors' endpoints and the telemetry host, in the background's chunk only.
  - The observer hosts' match patterns, and the agents' sites as data.
  - The policy's address and the issue link, both on the public repository.
  - WXT's and Tailwind's comment URLs, and Dexie's error links.
  - The two content scripts hold no telemetry or vendor host (privacy review gap 15 holds).
- **Its source maps.** 420 sources under `src/`, `entrypoints/` and `policy/`, all equal to 088cc7f's files, and 82 under `node_modules/`. No home path, no test, no fixture.
- **Personal values.** None: the GitHub handle `Poojan6216` appears only in the two links.

#### The telemetry API's driver

- What it does is unchanged: the errors (`PyMongoError`, `DuplicateKeyError`), the two-second server selection, the stored document, the indexes; `aggregate` is awaited, as PyMongo's async collection requires.
- The stand-in lives under `tests/`, and the image copies only `app/` (`Dockerfile`, `COPY app ./app`). Nothing in `app/` imports from the tests or mongomock.
- ruff, `ruff format --check` and mypy strict are clean; 278 tests pass; `uv lock --check` is current.

#### The re-fake tool

- What it reads, writes and prints:
  - it reads the capture key, every page named and every `--scan` file;
  - it rewrites the pages in place;
  - it writes the mapping, every old fake beside its new one, to `--record`;
  - it prints file names and counts.
- The record must stay out of the repository: committed, it would bring back the old fakes the history rewrite removed. The guard that keeps it out has holes (SEC-R1).
- No record is in the working tree, tracked or ignored.

#### CI

- The new step installs Chromium with its system packages in the unit job, as the e2e job already did.
- Unchanged around it:
  - the workflow's token stays `contents: read`;
  - every action stays pinned by SHA;
  - the triggers stay `push` to `main` and `pull_request`, never `pull_request_target`, so a fork's PR runs with a read-only token and no secret (the repository has none).

#### The public repository

- **At HEAD (`git grep`).**
  - **Keys.** No token or key shape but the tests' invented `sk-ant-…invented…` keys. No tracked `.env`, key or credential file.
  - **Paths.** Absolute paths only as test strings (an invented user's home folder, under `/home/…` and `/Users/…`) and in check-docs' own rule text.
  - **The founder.** The founder's Gmail address once, in PRIVACY.md's Contact, the private contact the founder chose (MANUAL.md:70). The GitHub handle in links.
- **The captures.** The 25 captured pages hold 462 addresses at non-reserved domains. Every one has a local part in the faker's shape, at a kept sender's domain (by design, Decisions [2.close-r3]). There are no others. Counted, never printed.
- **The history.** Every reachable blob (5,055) was searched, and the seven versions of `bench/traces/popup-paint.zip` were unzipped.
  - No path of this Mac's home folder in any trace.
  - The founder's address appears only in PRIVACY.md's versions.
  - All 488 author and committer fields are the no-reply address, apart from Dependabot's and GitHub's; the tag's tagger is the no-reply address too.
- **The old ids.** Four original ids from the map, asked of the public repository's API, each answer "No commit found"; their new ids resolve. The repository is not a fork and has no fork.
- **Settings, read only.**
  - **Rulesets.**
    - "main: no force-push or deletion" has no bypass.
    - "main: CI checks pass" requires the eight jobs, each bound to GitHub Actions' app (id 15368), so no other app's status counts. Repository admins bypass it always; it is not strict.
    - The only collaborator is the founder (admin). No ruleset covers tags (SEC-R4).
  - **Actions.**
    - The default token is read-only and cannot approve PRs.
    - A first-time contributor's PR waits for approval.
    - Every action is allowed, and SHA pinning is not required (SEC-R4).
    - No secrets and no variables; artifacts are kept 90 days.
  - **Security.**
    - Dependabot alerts and security updates are on.
    - Off: secret scanning, push protection, validity checks and private vulnerability reporting (SEC-R3), and immutable releases (SEC-R4).
  - **Pages.** The legacy build of `main` at `/`, HTTPS enforced, no `_config.yml` (SEC-R2).
  - **Environments.**
    - `github-pages`, with a branch policy.
    - Railway's `elegant-quietude / production`, with no protection rule. Railway deploys `main` on a change under `telemetry-api/` (Decisions [7.0]).

### Gaps

| # | Sev | Rule | Where | Gap | Fix direction (one line) |
| --- | --- | --- | --- | --- | --- |
| SEC-R1 | LOW | HR2, HR10 | `extension/tests/tools/capture-refake-people.ts:195-196`, `:216-222`, `:227-229`, `:235`; `extension/tests/unit/tools/capture-refake-people.spec.ts:128-133`; `docs/adapters.md:425` | The record's "outside the repository" check is a string prefix on an unresolved path, which three kinds of path inside the repository pass: `..people.json` at its root, its path in another case, a symlink. `0o600` holds only for a new file, and the record is written after the pages | Compare real paths (or ask git), test `..` plus a separator, create the record exclusively without following links, write it before any page, test each case |
| SEC-R2 | LOW | — | GitHub Pages (legacy build of `main` at `/`); `extension/src/config-manifest.ts:19`; `launch/store-listing.md:81`; `MANUAL.md:69`; `Decisions.md:1708` | Pages publishes the whole repository on the policy's origin and path, 64 Google and Muse look-alike fixture pages among it | Publish the policy alone, at the same address, and test what is published |
| SEC-R3 | LOW | HR10 | Repository settings: `security_and_analysis`, private vulnerability reporting; no `SECURITY.md`; `PRIVACY.md:173` | On the public repository, secret scanning, push protection and private vulnerability reporting are off, and no SECURITY.md says where to report | Turn all three on and add a SECURITY.md naming the private route |
| SEC-R4 | LOW | HR9 | Rulesets (branch only); immutable releases off; Actions `allowed_actions: all`, `sha_pinning_required: false`; `MANUAL.md:72`; `Decisions.md:1709` | The release's tag and zip can be moved or replaced, and only convention keeps every action pinned | A tag ruleset on `v*`, immutable releases, Actions limited to the three owners used, SHA pinning required |
| SEC-R5 | LOW | HR1 | `extension/src/config-network.ts:22`; `Decisions.md:1698`; `telemetry-api/README.md:48` | The one telemetry host is a name under Railway's shared domain. Freed, anyone can take it, and every installed build would send its usage numbers there | Never give the name up while a build naming it may be installed (MANUAL.md, Decisions); move to a registered domain before a wide launch |
| SEC-R6 | LOW | HR2, HR10 | `CLAUDE.md:42-43`; `MANUAL.md:67`; `reviews/sprint_7/commit-map-2026-10-14.txt:5` | `attest-archive` and `attest-archive-2` hold everything the clean-ups removed. Only one MANUAL.md sentence keeps them private, and CLAUDE.md's go-public rule names neither | Name both in CLAUDE.md's rule as never public or transferred, and set a date to delete them |

#### SEC-R1 (LOW, HR2, HR10): the record's guard lets three kinds of path inside the repository through

**Where.**

- `extension/tests/tools/capture-refake-people.ts`:
  - `:195-196`, `REPOSITORY`, the repository's path as the module's URL gives it;
  - `:216-222`, the check: `path.relative(REPOSITORY, path.resolve(record)).startsWith('..')`;
  - `:227-229`, every page rewritten in place, then the record written at `:235` with `{ mode: 0o600 }`.
- `extension/tests/unit/tools/capture-refake-people.spec.ts:128-133`: one path inside (`extension/tests/people.json`), and none.
- `docs/adapters.md:425`: `--record "$TMPDIR/people.json"`.

**What happens.** Measured on this Mac with Node's `path`, and with `writeFile` in the scratchpad. The tool itself was not run, since it reads the capture key.

1. **A name that starts with two dots.** `--record <repository>/..people.json` passes: its relative path, `..people.json`, starts with `..`. The file lands in the repository's root, which `.gitignore` does not cover, so `git add -A` commits it.
2. **Another case.** `--record /Users/…/documents/attest/people.json` passes, and so does `…/ATTEST/extension/people.json`: `path.relative` compares case by case, and this Mac's APFS volume does not, so the file lands in the repository.
3. **A symlink.** A path through a symlink into the repository passes, since nothing resolves real paths. `writeFile` also follows a symlink at the record's own name.
4. **The mode.** `writeFile`'s `mode` applies only when it creates the file. Measured: over an existing file of mode 644, the record stays 644.
5. **The order.** The pages are written before the record. When the record cannot be written (a folder that does not exist, or `$TMPDIR` unset, so `/people.json`), every page is already re-faked and the mapping is lost.

The record maps every old fake to its new one. Committed, it would put back in the public repository the old fakes that the history rewrite removed, each confirmable with the public seed (SEC-L2). The tool has done its work, and Decisions [7.close] says its records were deleted, so this needs the tool again and a slip: LOW.

**Fix.**

- Resolve the record's folder with `fs.realpath`, and compare it with the repository's real path, case-folded where the file system ignores case. Or refuse whenever `git -C <folder> rev-parse --show-toplevel` succeeds.
- Read the relative path as `rel === '..' || rel.startsWith('..' + path.sep)`, never a bare prefix.
- Create the record exclusively (`wx`) without following a link (`O_NOFOLLOW`), and refuse an existing file.
- Write the record first, then the pages.
- Add the four cases to the spec: `..x` at the root, the repository in another case, a symlink, an existing file.

#### SEC-R2 (LOW): Pages publishes the whole repository beside the policy

**Where.**

- GitHub Pages: the legacy build of `main` at `/` (`gh api repos/Poojan6216/attest/pages`). There is no `_config.yml` and no `.nojekyll`.
- `extension/src/config-manifest.ts:19` and `launch/store-listing.md:81`: the manifest's homepage and the store's privacy policy URL are this site's `/attest/PRIVACY`.
- `MANUAL.md:69`; Decisions [7.2] (`Decisions.md:1708`).

**What happens.**

- A legacy build runs Jekyll over the whole tree and publishes every file outside dot and underscore folders, about 1,700 tracked files. Static HTML is served as it is.
- Among them are 64 fixture pages under `extension/tests/fixtures/pages/{gmail,gcal,muse}/`:
  - 41 are titled as Gmail and 18 as Calendar;
  - 51 hold a form, and 59 link to `accounts.google.com`;
  - 25 are the founder's own Gmail and Calendar pages, re-faked.
- They are live pages at `https://poojan6216.github.io/attest/extension/tests/fixtures/pages/…`, on the policy's origin and under its path. This is derived from the settings and Jekyll's defaults; no page was fetched, by this review's rules.
- None holds a password field, and none outside `_harness/` (which Jekyll leaves out) holds a script, so no page can collect or run anything.
- The risk is to the policy. Pages that copy Google's mail and calendar on a host that is not Google's are what phishing classifiers flag. A Safe Browsing flag on that origin would put a warning in front of the policy the store requires and the manifest links. Search engines would also index the captures as pages.

**Fix.**

- Publish the policy alone, at the same address (`/attest/PRIVACY`). The safer way is a Pages workflow, its actions pinned by SHA, that uploads only the rendered policy. A `_config.yml` whose `exclude` leaves only `PRIVACY.md` also works, but a new top-level folder would be published until someone adds it to the list.
- Add a test, or a step in that workflow, that fails when the site holds anything but the policy.

#### SEC-R3 (LOW, HR10): no secret scanning and no private report route on the public repository

**Where.**

- `gh api repos/Poojan6216/attest`: `secret_scanning`, `secret_scanning_push_protection`, `secret_scanning_validity_checks` and `secret_scanning_non_provider_patterns` are all `disabled`.
- `private-vulnerability-reporting`: `enabled: false`.
- No `SECURITY.md`. `PRIVACY.md:173` sends people to public issues, and to the private contact for anything private.

**What happens.**

- The founder pushes to `main` directly; the ruleset lets admins bypass. Day to day, the project handles what must never be pushed: a model key for the own-key path, and Railway's `MONGO_URL`.
- Nothing on the repository scans a push, or the history, for one. GitHub's partner scanning and the push protection on the founder's own account may still apply, but they are not this repository's settings, and they cover no other pusher.
- Someone who finds a vulnerability sees no private route on GitHub. The route they see is a public issue.

**Fix.**

- Turn on secret scanning, push protection, validity checks and non-provider patterns, all free for a public repository.
- Turn on private vulnerability reporting, and add a `SECURITY.md` that names it and the private contact.
- These are settings, so they go in MANUAL.md, or to the agent on the founder's word.

#### SEC-R4 (LOW, HR9): the release's tag and zip can be changed after the fact

**Where.**

- Both rulesets target `~DEFAULT_BRANCH`; none targets tags.
- `gh api repos/Poojan6216/attest/immutable-releases`: `enabled: false`. The release v0.1.0 reports `immutable: false`.
- `actions/permissions`: `allowed_actions: all`, `sha_pinning_required: false`.
- `MANUAL.md:72` tells the founder to upload "that same zip (it is attached to the release)". Decisions [7.8] (`Decisions.md:1709`) says the release notes give its SHA-256.

**What happens.**

- Any token with write access can delete `v0.1.0` and point it elsewhere, or replace the release's zip. The SHA-256 in the notes can be edited in the same call, so it is no check against whoever changes the asset. Only `sprints/sprint_7.md:26`, on protected `main`, keeps the original.
- Every workflow and the setup action pin each action by SHA today, but only by convention. A later change could name a tag or a branch, and the setting allows any action from anywhere.
- Only the founder can write today, so either needs his token or a slip: LOW.

**Fix.**

- Add a ruleset on `refs/tags/v*`: no deletion, no update, no force-push. Creating a tag stays allowed.
- Turn on immutable releases for every later release.
- Limit Actions to the three owners used (`actions`, `pnpm`, `astral-sh`), and require SHA pinning.

#### SEC-R5 (LOW, HR1): the one telemetry host is a name the founder holds only while Railway's service keeps it

**Where.**

- `extension/src/config-network.ts:22`, and so the CSP's `connect-src` in every build from v0.1.0 on.
- Decisions [7.0] (`Decisions.md:1698`), which chose Railway's address over a custom domain.
- `telemetry-api/README.md:48`.

**What happens.**

- `attest-production-5149.up.railway.app` is a name in Railway's shared domain. The founder holds it while his service keeps it as its domain.
- Railway lets a project pick its own free name under `up.railway.app`. Once this one is freed, anyone can take it: the service or the project deleted, or the domain removed or renamed, say in a move to a custom domain.
- From then on, every installed build that names it, with the option on, sends its usage numbers there each day: the install id, the counts, the versions and the date.
- The extension cannot tell. The CSP allows a name, not a key, and whoever holds the name answers its own CORS.
- Decisions [7.0] records that a move to a custom domain needs a new version. It does not record that the old name must then stay held for as long as any install still runs a version that names it.
- It needs the founder to give the name up: LOW.

**Fix.**

- Write it down in MANUAL.md and Decisions: never delete the Railway service, nor remove or rename its domain, while any version naming it may still be installed. A move to a new domain keeps the old one answering (a 410, or the same API) until then.
- Before a wide launch, move to a domain the founder registers and renews, so the name stays his whatever the host.

#### SEC-R6 (LOW, HR2, HR10): the two private archives hold everything the clean-ups removed, and no agent rule keeps them private

**Where.**

- `CLAUDE.md:42-43`, "Going public": its rule names "the repository" and the two clean-ups, both now done.
- `MANUAL.md:67`: "keep `Poojan6216/attest-archive` private". `attest-archive-2` is named only as staying private.
- `reviews/sprint_7/commit-map-2026-10-14.txt:5` tells every reader the archive exists.

**What happens.**

- What each archive holds, by Decisions [7.close]:
  - `attest-archive`: the history before the rewrite. That is the capture files with the old fakes (each confirmable with the public seed, SEC-L2), the trace with this Mac's paths, the founder's university address in every author and committer field, and twelve pull request refs.
  - `attest-archive-2`: the university address in every commit.
- Both are private today: `private: true`, no fork (read).
- One visibility change or transfer of either undoes the clean-up, and nothing an agent reads forbids it. CLAUDE.md's rule is spent now that both items are ticked, and it names neither archive.

**Fix.**

- Extend CLAUDE.md's "Going public" rule: never make `attest-archive` or `attest-archive-2` public, never transfer them, and never push their history anywhere public.
- Decide when they can be deleted (the commit map already keeps every old id), and put that date in MANUAL.md.

### Notes (not security gaps)

- **Railway's PR environments** cannot be read from here. With the repository public, a fork's pull request must never be built with the project's variables (`MONGO_URL`). Nothing read shows such environments on: GitHub lists only Railway's production environment. Confirming they are off is a one-line check in Railway.
- **`ALLOWED_EXT_IDS` is empty.** So v0.1.0's usage numbers cannot be delivered until the store gives the item its id, as Decisions [7.0] says. No security effect.
- **The e2e launcher passes `env: { ...process.env, TZ }` to the browser** (`extension/tests/e2e/support/extension.ts:187-192`). Playwright's default environment is the same `process.env`, so nothing new reaches the browser.
- **The license change** has no security effect.

### Commands run

- `git log --oneline 4f5d3c2..HEAD`, `git diff --stat`, and the diffs of every changed code, config and tool file. `git status` at the start and before writing.
- The checklist's network grep over `extension/src` and `extension/entrypoints`, with EventSource, importScripts, WebTransport and RTCPeerConnection added. The `eval(`, `new Function(` and remote `import(` greps.
- On the zip:
  - `shasum -a 256`, then `unzip` into a new empty scratch folder, and `diff -rq` with `extension/.output/chrome-mv3/`;
  - the manifest printed;
  - `fetch(`, `eval(`, `Function(` and `import(` greps, and every URL, across the bundles, pages and stylesheet;
  - every source map's sources listed, and their contents compared with `git show 088cc7f:<path>` (420 equal, 0 different);
  - home paths, key shapes and the founder's names searched in every file, maps included.
- `pnpm audit:manifest extension/.output/attest-0.1.0.zip`: OK. `pnpm audit --prod`: no known vulnerabilities.
- In `telemetry-api/`:
  - `uv run pip-audit`: no known vulnerabilities;
  - `uv lock --check`, `uv export --locked --no-dev`, `uv tree --no-dev`;
  - ruff, `ruff format --check`;
  - `mypy app tests scripts`: no issues in 34 files;
  - `pytest`: 278 passed.
- `eslint --max-warnings 0` on the seven changed extension files and on `scripts/audit-manifest.ts`: exit 0.
- `vitest run` on four specs: capture-refake-people, audit-manifest, the telemetry facts and manifest-hosts. 68 passed, with `ATTEST_CAPTURE_KEY_FILE` pointed at a scratch path so nothing could read the capture key.
- Node's `path.relative` on the guard's edge cases, and `fs.promises.writeFile` over an existing file and through a symlink, in the scratchpad (SEC-R1).
- `git grep` on HEAD, every match counted:
  - key and token shapes, credential file names, absolute paths;
  - the founder's names and addresses, and the email domains outside the fixtures;
  - in the fixture pages: addresses, titles, forms, scripts and links, by shape, never printed.
- The history:
  - every reachable blob (5,055) searched for home paths and the founder's address;
  - the seven trace zips unzipped and searched;
  - the author, committer and tagger emails listed;
  - four original ids asked of the public repository.
- `gh api`, read only:
  - the repository and its rulesets;
  - Actions: the token's permissions, approval of forks' PRs, allowed actions, and the counts of secrets and variables;
  - the environments, Pages and its latest build;
  - private vulnerability reporting, immutable releases and vulnerability alerts;
  - collaborators, forks and pull requests;
  - the release and its assets;
  - the jobs of CI run 38675724976;
  - the two archives' visibility.

**Counts: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 6 LOW** (SEC-R1 to SEC-R6).
