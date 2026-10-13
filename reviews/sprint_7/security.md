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
