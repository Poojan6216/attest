# Sprint 2 — Security

Role: agents/security_reviewer.md. Range reviewed: `60bca2d..1e54fd9` (Sprint 1 close to the last Sprint 2 commit). Each review was checked by an independent refuting verifier that re-ran the evidence; verdicts are inline (CONFIRMED, RESIZED with the new severity, or REFUTED). Real-page captures and the live smoke (tasks 2.1, 2.4, 2.8) are BLOCKED(MANUAL) and are not gaps.

## Security review

Sprint 2 security review (read-only, full depth) of git diff 60bca2d..1e54fd9. 12 gaps: 0 CRITICAL, 1 HIGH, 6 MEDIUM, 5 LOW. Hard Rules 1, 3 (Attest's own code), 4 and 10 held under every probe: no network call in source or the built bundles, exactly two host permissions, no web_accessible_resources or externally_connectable, lint fences green with zero disables, core purity gate green, the logger prints no page text, pnpm audit clean, no new dependency. The gaps: (1) HIGH: changes other people make on the user's Calendar (auto-added invites, an organiser's reschedule or cancel, shared or subscribed calendars) are stored as changes the account made, so in Sprint 3 they can come out as UNASKED. (2) MEDIUM: calendarSnapshots stores and exports every guest address of every viewed event, more than the diff needs. (3) MEDIUM: a vendor page can detect Attest through WXT's start-up event and stop the observers without anything being reported. (4) MEDIUM: a health report stamped while the clock was ahead keeps the stored health stuck. (5) MEDIUM: the retention purge trusts the wall clock, so a clock jump forward deletes current history. (6) MEDIUM: any stranger can plant a purchase, because a look-alike name like 'Аmazon' (Cyrillic А) passes the impersonation check. (7) MEDIUM: a regex on email subjects slows quadratically and runs on Gmail's main thread. Plus 5 LOW gaps: account-less Calendar windows have no size limit, no incognito decision, a Calendar page that stays 'busy' reports OK forever, no cap on stored rows per edited event, and a list of checks for the live smoke. Each gap has evidence from code or a scratch probe, and a concrete fix.

# Sprint 2 — Security review

**Range:** `git diff 60bca2d..1e54fd9` (342 files; 114 under extension/src, entrypoints, scripts, bench).

**How:** read-only. I read every source file in the range against agents/security_reviewer.md, built the extension and ran probes in a scratch copy (`scratchpad/s2rev/security/`). I changed nothing in the shared tree.

**Verdict: 12 gaps.** 0 CRITICAL, 1 HIGH, 6 MEDIUM, 5 LOW.

These held under every probe:
- **Hard Rule 1.** No network call in source. The built `gmail.js`, `gcal.js` and `background.js` hold no fetch, XHR, beacon, WebSocket, EventSource, Image or Audio. The manifest asks for exactly the two hosts. There are no `web_accessible_resources`, no `externally_connectable`, no `onMessageExternal` and no ports.
- **Hard Rule 3, in Attest's own code.** The `no-act` lint is green on content scripts and observers, with zero `eslint-disable`. Attest never dispatches an event, writes the DOM, focuses, scrolls or navigates. The listeners are passive and read only `isTrusted`.
- **Hard Rule 4.** The `src/core` lint and the purity gate (114 tests) pass.
- **Hard Rule 10.** Logs carry codes, ids and counts only. Every error class has a code-only message.
- **Dependencies.** `pnpm audit` is clean. No dependency changed.

## Gaps

| ID | Sev | Rule | Where | Gap |
|---|---|---|---|---|
| SEC-1 | HIGH | HR7, HR5 | extension/src/background/calendar-step.ts:205 | Other people's Calendar changes are stored as the account's own, so they can be UNASKED |
| SEC-2 | MEDIUM | HR2 | extension/src/observers/gcal/snapshot.ts:64 | calendarSnapshots stores and exports every guest of every viewed event |
| SEC-3 | MEDIUM | HR6, privacy | extension/entrypoints/content/gmail.content.ts:27 | A page can detect Attest and stop it through WXT's start-up event, with nothing reported |
| SEC-4 | MEDIUM | HR6 | extension/src/background/observer-messages.ts:133 | Health stamped while the clock was ahead gets stuck; any observer id is accepted |
| SEC-5 | MEDIUM | HR5, HR4 | extension/src/background/alarms.ts:32 | The purge trusts the wall clock; a jump forward deletes current history |
| SEC-6 | MEDIUM | HR5, HR7 | extension/src/observers/gmail/receipts/generic.ts:34 | Any stranger can plant a purchase; a look-alike name passes the impersonation check |
| SEC-7 | MEDIUM | HR3, input handling | extension/src/observers/gmail/receipts/selectors.json:147 | A regex on stranger-written subjects slows quadratically, on Gmail's main thread |
| SEC-8 | LOW | HR5 | extension/src/background/observer-messages.ts:247 | A Calendar window with no account has no size limit |
| SEC-9 | LOW | HR11, HR2 | extension/wxt.config.ts:47 | No incognito decision |
| SEC-10 | LOW | HR6 | extension/src/observers/gcal/page.ts:76 | A Calendar page that stays "busy" reports OK forever |
| SEC-11 | LOW | storage | extension/src/observers/gcal/diff.ts:165 | No cap on rows from repeated edits of one event |
| SEC-12 | LOW | HR2, HR5 | MANUAL.md:20 | Checks the live smoke must make that synthetic fixtures cannot |

### SEC-1 (HIGH): Calendar changes made by other people
**What happens.** The Calendar observer never reads who organises an event or who owns a calendar. `label.ts` drops the response status on purpose, and `SnapshotCalendar` keeps only `{key, shown, ambiguous}`.

**Evidence.**
- Any event that appears, moves or disappears between two passes less than 2 minutes apart is stored as a change with no first-look marker (`calendar-step.ts:205`).
- The existing test proves it: `calendar-pass.spec.ts:67`, "a later pass reports the change, with no marker".
- grading.md §7 (v1.9 to v1.11, written this sprint) makes exactly such a row an orphan: the only Calendar row that can be UNASKED.

**Why it matters.** Many Calendar changes are someone else's:
- an invitation Google adds automatically (the default is "from everyone");
- an organiser who reschedules or cancels;
- an event on a colleague's shared calendar, or on a subscribed calendar, shown in the grid.

When an agent session is active and the user is idle (0.4 + 0.3 is at least 0.6), Sprint 3 would show "likely <agent> created / updated / deleted <event>" for something the account never did. Any stranger can trigger this with an invite. The wave D/E simulator never modelled changes by other people. attacks-that-work.md does not list this.

**Fix.**
- Until the facts below exist, store every Calendar change as a first sighting with its marker. That means a missed UNASKED, never a false one.
- Then add two derived booleans to the snapshot, confirmed on the live page:
  - the account organises the event (from the label's RSVP or organiser text, best knowledge);
  - the account owns the calendar (the side panel's "My calendars" versus "Other calendars").
- Store changes on anything else as first sightings.
- Add simulator and golden cases for invites, reschedules and shared-calendar edits.

### SEC-2 (MEDIUM): the snapshot keeps more than the diff needs
**What happens.** The `calendar.snapshot` bus message, its IndexedDB record and the ledger export keep, for every event in every range viewed in the last 90 days: the title (up to 80 characters), start, end, all-day flag, days and up to 200 guest addresses. The policy lets a `gcal.event` observation keep one counterparty.

**Evidence.**
- Stored guests are only ever compared (`diff.ts:89-90`, `diff.ts:105-106`, `calendar-seen.ts:37`). The one exception is the first guest of a deleted event (`diff.ts:172`).
- Probe on `synthetic-gcal-week-before.html`: the record holds `jordan.lee@example.com` and `sam.chen@example.net`. The observation holds only `jordan.lee@`. So `sam.chen@` lives only in the snapshot and the export.
- The service-worker schema accepts any one-line text of up to 320 characters as a guest (`snapshot.ts:64`), not only an address.
- `privacy-architecture.md:36` says the guest addresses are kept "because matching needs it". The code does not use them for matching.

**Fix.**
- Store `firstGuest` in clear plus the sorted SHA-256 of each ASCII-folded guest, and compare the hashes.
- Require each guest to satisfy `email(g)?.address === g` at the boundary.
- Correct privacy-architecture.md.
- Consider leaving calendarSnapshots out of a replay or share export.

### SEC-3 (MEDIUM): WXT's start-up event can be read and forged by the page
**What happens.** `noScriptStartedPostMessage` removes only the `postMessage`. WXT still dispatches `CustomEvent('<runtime.id>:<entrypoint>:wxt:content-script-started', {detail: {contentScriptName, messageId}})` on `document`, and listens for the same name.

**Evidence.**
- `node_modules/wxt/dist/utils/content-script-context.mjs:167-168` (dispatch) and `183-186` (listener).
- The built `gmail.js` holds `${pc?.runtime?.id}:gmail:…`.
- A matching event from anyone else calls `notifyInvalidated()`. Both content scripts wire that to `handle.disconnect` (`gmail.content.ts:27`, `gcal.content.ts:68`).
- DOM events are shared with the page, and Chrome passes a page-made `detail` to the isolated world as a structured clone.

**Why it matters.** Any main-world script on either host can:
- learn that Attest is installed, because the store id is public;
- stop every observer in the tab by dispatching the event.

The scripts that can do this include Google's own code, another extension, an agent extension acting in the tab, or an XSS. Nothing reports the stop. Stored health keeps its last value, usually OK. The comments at `gmail.content.ts:22` and `gcal.content.ts:62` ("must not post a message the vendor page can read") and Decisions [2.7] ("no user data") overstate the protection.

**Fix.**
- Do not disconnect on `ctx.onInvalidated`. Disconnect only when a post fails with `context_invalidated`, or when `browser.runtime.id` is gone.
- Remove the fingerprint with a pnpm patch to WXT, or accept it in Decisions.md.
- Add an E2E test that dispatches the forged event and asserts the observers keep posting.
- Fix the two comments and the Decision.

### SEC-4 (MEDIUM): stuck health after a clock move
**What happens.** `onHealth` has no clock check. Rows, pings and snapshots do (`clock_behind`). `recordOwnHealth` drops any report older than the stored one (`health.ts:72`). `guardClock` repairs coverage, records and rows, but never `adapterHealth`.

**Evidence (probe).**
- An OK report with checkedAt 2027-10-03 was stored while the clock read 2027.
- After the clock went back to 2026, a DEGRADED report (`selector.missing.grid`) was answered `{ok:true}` but not stored. The stored row still says OK, checkedAt 2027.
- A DEGRADED the ledger sets is stamped at the later of the two instants, so it sticks the same way.
- `onHealth` also stored a report for adapter id `muse` sent by a content script. It accepts any id and does not check that the sending tab is on that observer's host.

**Fix.**
- Refuse a report whose checkedAt is after `ctx.now()`.
- Refuse ids that are not in OBSERVER_SOURCES, and reports from a tab on another observer's host.
- Make the clock repair also reset `adapterHealth` rows checked after now.
- Add a test for each.

### SEC-5 (MEDIUM): the purge on a clock that jumped forward
**What happens.** `runRetentionPurge` passes `nowIso()`, and `cutoffOf` returns now minus 90 days with no bound (`retention.ts:103`). Chrome alarms fire by wall-clock time, and the startup path purges 1 minute after start.

**Evidence (probe).** One stored row, then `purgeExpired({now: '2027-10-03T14:00-04:00'})`: observations went from 1 to 0, with cutoff 2027-07-05T18:00Z. Every claim, receipt, observation, interval and record before that cutoff goes too, for good.

**Fix.**
- Keep `lastPurgeCutoff` in meta and let each run advance the cutoff by at most about 2 days.
- Or bound the cutoff by the clock high water.
- Log and skip a purge whose clock is far ahead.
- Test with a clock one year ahead.

### SEC-6 (MEDIUM): planted purchases
**What happens.** The generic parser accepts any non-registry sender whose mail has an order-style subject and a total line. Its impersonation check compares ASCII brand words with `nameTokens(displayName)`, which does not fold look-alike characters.

**Evidence (probe).**
- `'Аmazon'` (Cyrillic А) `<orders@shop-deals.example>`, subject "Your order confirmation", "Order total $499.00": an OK pass, a `purchase.made` with merchant `Аmazon` and amountCents 49900, and a coverage point.
- The ASCII control "Amazon" is refused.
- The 0.6 confidence is never sent or stored (`parser.ts:42`, Decisions [2.3]). Observations carry no parser id. So a stranger's mail counts like an Amazon receipt: it can be an orphan, or support a false claim.
- attacks-that-work.md does not list this.

**Fix.**
- Reduce the display name to its look-alike skeleton (Unicode TR #39), or refuse a name that mixes scripts, before the brand check.
- Decide in the contract whether generic receipts may be orphans or more than PARTIAL. This needs a field.
- Add an attacks-that-work.md row.

### SEC-7 (MEDIUM): quadratic subject regex
**What happens.** The first alternative of `refuseSubject`, `\d+\s*%\s*off\b`, is unanchored. On a long run of digits it costs O(n²). It runs on every opened non-registry message whose subject says order, receipt or confirmation (`generic.ts:45`), 3 times per pass, with passes every 0.5 to 2 seconds while Gmail's page changes.

**Evidence.**
- The regex alone: 10,000 digits 432 ms; 50,000 digits 13.5 s; 100,000 digits 42.5 s.
- A whole pass: 2,000 digits 20 ms; 8,000 digits 253 ms; 16,000 digits 905 ms.
- How bad this is depends on the longest subject Gmail draws in the heading (see SEC-12).

**Fix.**
- Use `\d\s*%\s*off\b`. It matches the same subjects in linear time.
- Cut the subject to about 1,000 code points before any regex.
- Add a perf test.

### SEC-8 (LOW): Calendar windows with no account
**What happens.** `pingProblem` limits Gmail windows only. A `gcal.event` ping without an account is recorded directly.

**Evidence (probe).** A forged window from 1990 to 2090 was accepted `{ok:true}` and stored. The real reader never exceeds 42 days. Grading caps account-less coverage, so there is no NOT_FOUND. But the window still counts for grace, and through orphan rule (b) it blocks Calendar orphans.

**Fix.** Refuse windows longer than 43 days, or not on local midnights, with `invalid_input`.

### SEC-9 (LOW): incognito
**What happens.** The manifest has no `incognito` key, so Chrome's default "spanning" applies. No code checks `sender.tab.incognito`, and there is no Decision. If the user allows Attest in incognito, facts read from incognito tabs go into the persistent ledger.

**Fix.** Set `incognito: 'not_allowed'` and pin it in `built-bundle.spec.ts`, or drop messages from incognito tabs. Log the choice and say it in PRIVACY.md.

### SEC-10 (LOW): a page that stays busy
**What happens.** `pageBusy` matches `aria-busy` on any ancestor, or any shown progress bar in the main region. While it matches, the pass reports health OK and reads nothing (`health.ts:18`, `observer.ts:64`, `observer.ts:80`, `observer.ts:86`). No time limit exists, so a page that never stops being busy is a silent zero.

**Fix.** After about 5 minutes of busy passes, report DEGRADED `page.busy`.

### SEC-11 (LOW): rows per event
**What happens.** Every distinct state of an event is a new contentHash, so every edit a pass sees is a new `calendar.updated` row.

**Why it matters.** An outsider who organises an invited event and edits it by script, while the user's Calendar tab is visible, can add tens of thousands of rows a day. They are kept for 90 days, all in the same time bucket, which also slows candidate reads in Sprint 3.

**Fix.** Merge repeated updates to one event within a short window, or cap rows per event per day and report DEGRADED `event.churn` past the cap.

### SEC-12 (LOW): checks for the live smoke (2.8)
The synthetic fixtures cannot show these. Each needs a look at the real pages.
1. The text of `[data-legacy-last-message-id]` is the subject only, with no snippet and no attachment names. Otherwise up to 80 characters of body text land in `subjectHint`.
2. Every recipient element carries an `email` attribute. Otherwise the reader falls back to `title`, where a display name shaped like an address would be read as the recipient.
3. Gmail shows times in the browser's time zone. Gmail has no zone check; Calendar does.
4. An undone or scheduled send never shows in the Sent list as a sent row.
5. When the mouse hovers a row, the time element is still the date, not an action button.
6. The Calendar chip's Guests list holds addresses, not display names. Also check what the fallback title takes when a chip has no `aria-hidden` part.
7. What the label says for an invited event versus one the account organises, and how the side panel separates own calendars from others (needed for SEC-1).
8. `aria-busy` and progress bars clear on a quiet page (SEC-10).
9. A forged WXT event from DevTools stops the observers (SEC-3).
10. The longest subject Gmail draws in the conversation heading (SEC-7).

## Checklist
| Item | Status | Evidence |
|---|---|---|
| Network grep finds only telemetry | PASS | The grep finds nothing (telemetry is not written yet). The bundle grep is clean too. |
| Network-intercept E2E, allowlist empty | N/A | QA runs E2E. I reviewed the spec: ALLOWLIST is `[]` (`network-intercept.spec.ts:37`), and routed fixtures are exempt only by exact URL (`network-guard.ts:106`). |
| No remote img, fonts or CDN | PASS | Built HTML is local only. The only URL in the CSS is the Tailwind licence comment. |
| No externally_connectable, webRequest or DNR | PASS | Built manifest permissions are storage, alarms and sidePanel. |
| Every Observation goes through redact.project | PASS | At the edge in `plan.ts:167`, and in the service worker in `calendar-pass.ts:104`. `assertProjected` refuses anything else. The snapshot is covered by SEC-2. |
| policy allowlist unchanged | PASS | `git diff` on `policy/` is empty. |
| Secret-seed E2E | N/A | QA runs it. I reviewed the spec: it opens the vendor fixtures and checks IndexedDB (calendarSnapshots included), the export, the console and the network. |
| Length caps | PASS | subjectHint is at most 80 everywhere; the schemas cap everything else. |
| Export uses the redacted projection | GAP | SEC-2 |
| no-act lint, zero disables | PASS | eslint exits 0; no `eslint-disable` in any of these scopes. |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | Only WXT's own CustomEvent, see SEC-3. |
| No tabs.create, tabs.update or executeScript | PASS | The grep is empty. |
| Permissions, hosts, CSP, no remote code | PASS | The manifest matches; `setup.ts` turns Zod's code generation off (jitless). |
| Optional permissions | N/A | None requested. |
| Page text never becomes a selector, type or key | PASS | Selectors are static JSON; titles and calendar names are compared as text, never compiled into a regex. |
| Bus messages Zod-parsed on receive | PASS | `listen.ts:159-167`. Semantic gaps are SEC-4 and SEC-8. |
| Stored data parsed on read | PASS | `readRow` and `readRows` everywhere. |
| No innerHTML | PASS | The grep is empty. |
| Dexie versions and migrations tested | PASS | v2 and v3, with their specs passing. |
| Encryption, wipe, install id | N/A | Not touched this sprint. |
| log.ts is the only logger, no PII | PASS | The logger allowlists values; error messages are codes only. |
| No bare catch | PASS | Logged exception: Decisions [2.0] turns failures into DEGRADED codes, and the `no-empty` lint rule holds. |
| Telemetry-api | N/A | Not touched. |
| pnpm audit --prod | PASS | Clean from the root and from extension/. |
| New dependency logged | PASS | The lockfile is unchanged. |
| Vendor terms | N/A | Deferred to 3.10 (open question at Decisions.md:58). |
| Clock guard cannot be abused to delete data | PASS | Its inputs never go past the service worker's clock. The purge is another matter: SEC-5. |
| Purge is consistent | PASS | One transaction; markers are cut with their rows by window. |

## Probes (scratch, not committed)
- `tests/unit/secprobe/receipts-probe.spec.ts`: the look-alike name is accepted; pass timings.
- `tests/unit/secprobe/background-probe.spec.ts`: health stays stuck; the unknown id is stored; the century-long window is stored; the purge deletes current rows.
- `tests/unit/secprobe/gcal-probe.spec.ts`: the snapshot holds every guest; the row holds one.
- `redos.mjs`: regex timings.

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| HR1: network grep (fetch/XMLHttpRequest/sendBeacon/WebSocket) in extension/src and entrypoints | PASS | grep -rn over extension/src extension/entrypoints returned nothing (exit 1); scratch `wxt build` then token grep of content-scripts/gmail.js, gcal.js and background.js: no fetch(, XMLHttpRequest, sendBeacon, WebSocket, EventSource, importScripts, new Image, new Audio |
| HR1: network-intercept E2E ran, allowlist exactly zero hosts | N/A | QA owns E2E runs. Spec reviewed: ALLOWLIST = [] (tests/e2e/network-intercept.spec.ts:37); vendor fixtures exempted by exact routed URL only (support/network-guard.ts:106); 5-min session now opens the Gmail Sent, receipt and Calendar fixtures |
| HR1: no remote img/fonts/CDN in entrypoint HTML or CSS | PASS | Built popup/options/sidepanel.html reference only /chunks and /assets; the only URL in the CSS is the Tailwind licence comment |
| HR1/HR8: no externally_connectable, webRequest, declarativeNetRequest, web_accessible_resources; no onMessageExternal/onConnect | PASS | Built manifest permissions ['storage','alarms','sidePanel'], host_permissions exactly mail.google.com and calendar.google.com, no WAR; grep for onMessageExternal\|onConnect\|window.addEventListener('message') empty |
| HR1/HR3: message channels a vendor page can reach (postMessage, DOM events, WXT handshake) | GAP | postMessage is off (noScriptStartedPostMessage). WXT still dispatches and listens for '<runtime.id>:<entrypoint>:wxt:content-script-started' on document (content-script-context.mjs:167-186); the page can detect Attest and forge it to stop the observers (SEC-3) |
| HR2: every Observation crossing the bus went through redact.project() | PASS | Content scripts project in plan.ts:167; the service worker projects Calendar rows it derives in calendar-pass.ts:104; upsertObservation assertProjected refuses rows project() could not produce. The calendar.snapshot message crosses unprojected by design (SEC-2) |
| HR2: policy/default.json allowlist unchanged or logged | PASS | git diff 60bca2d..1e54fd9 -- policy/ is empty |
| HR2/HR10: secret-seed test (no-leak.spec.ts) ran green across IndexedDB, console, export, telemetry | N/A | QA runs E2E. Spec reviewed: it opens synthetic-sent-page-1, synthetic-receipt-amazon and synthetic-gcal-week-before at vendor URLs, waits for rows from all three sources, and checks the export, every IndexedDB database (calendarSnapshots included), chrome.storage, web storage, console and network |
| HR2: length caps (subjectHint <= 80, textHint <= 200) | PASS | Observation subjectHint oneLineText(80); SnapshotEvent subjectHint oneLineText(80); merchant 120, counterparty 320; arrays capped (500 events, 200 guests, 42 days) |
| HR2: exports and share use the redacted projection, never the raw row | GAP | export.ts:49,113 export calendarSnapshots whole: every viewed event with up to 200 guest addresses, end and all-day (SEC-2) |
| HR3: attest/no-act enabled on entrypoints/content, src/adapters, src/observers; zero disables | PASS | eslint-rules/fences.js ACT_SCOPES; `npx eslint entrypoints/content src/observers src/background src/bus src/ledger --max-warnings 0` exit 0 (scratch); grep eslint-disable over those scopes is empty |
| HR3: no .click/.submit/dispatchEvent/.value=/.focus on vendor DOM | PASS | Built gmail.js/gcal.js hold no click/focus/scroll/appendChild/setAttribute/createElement/innerHTML; the only dispatchEvent is WXT's own CustomEvent (SEC-3). Activity listeners are passive and capture, and read only isTrusted; the MutationObserver never reads records |
| HR3/HR11: no chrome.tabs.create/update, no scripting.executeScript | PASS | grep chrome.tabs\|browser.tabs\|executeScript\|scripting. over src and entrypoints is empty; prerendered pages are not read (base.ts:336-357) |
| HR8: permissions subset and host_permissions exact | PASS | wxt.config.ts:47-48; built manifest pinned by tests/e2e/built-bundle.spec.ts and tests/unit/manifest-hosts.spec.ts |
| HR8: optional permissions requested in a user gesture | N/A | No optional permissions |
| HR9: CSP script-src 'self'; object-src 'none'; no remote code | PASS | Built manifest CSP exact; grep eval(/new Function/import( finds only comments; setup.ts sets z.config({jitless:true}) |
| Input: page text never used as selector, message type, policy key or instruction | PASS | Selectors are static JSON (gcal selectors.json, receipts selectors.json); label.ts escapes only JSON words; titles and calendar names are compared with startsWith, never compiled; message types are literals |
| Input: a hostile Gmail/Calendar page cannot make an observer misreport, crash the service worker or exhaust storage | GAP | Misreport: SEC-1 (third-party Calendar changes), SEC-6 (look-alike or stranger receipts). Main-thread freeze: SEC-7. Storage growth: SEC-11. Service-worker crash: none found (handlers are caught in listen.ts deliver; schemas cap sizes) |
| Input: a forged content-script message cannot write rows it should not, poison coverage or break replay | GAP | Rows: PASS (assertProjected; snapshot rows projected in the service worker). Replay: PASS (insert-only rows; replay reads stored coverage). Coverage: an account-less gcal window has no size limit (SEC-8). Health: no clock, id or sender check (SEC-4) |
| Input: all bus messages Zod-parsed on receive; unknown dropped and logged | PASS | listen.ts:159-167 (foreign sender, malformed, untrusted context, no handler); strict schemas in bus/messages.ts |
| Input: stored data Zod-parsed on read | PASS | readRow/readRows for calendar records, coverage intervals (readInterval), pings and health; corrupt rows are skipped and logged by id |
| Input: HTML rendering uses text nodes, never innerHTML | PASS | grep innerHTML\|outerHTML\|insertAdjacentHTML\|dangerouslySetInnerHTML over src and entrypoints is empty |
| Storage: Dexie version bumped when tables change; migration tested | PASS | migrations.ts v2 (coverageIntervals, receipt indexes) and v3 (calendarSnapshots); tests/unit/ledger/migrations-v2.spec.ts and migrations-v3.spec.ts pass (scratch run) |
| Storage: purge consistent; the clock guard cannot be abused to delete data | GAP | The purge runs in one transaction and cuts markers with their rows by window (PASS). The guard triggers only below the high water, and every stored instant is checked against the service worker clock (PASS). But the purge itself trusts the wall clock: a jump forward deletes current history (SEC-5) |
| Storage: encryption, wipe, install id | N/A | Not implemented or not touched this sprint (no wipe path exists yet; install id unchanged) |
| HR10: src/log.ts the only logger; no content logged | PASS | The new log events (observer.refused, clock_behind, coverage_refused, snapshot_skipped, calendar_restarted, ledger.clock_regressed) carry codes, ids and counts; describeError prints name, code and length only; the observer error classes have code-only messages |
| HR10: no bare catch {}; every catch logs with context | PASS | Catch blocks in plan.ts and coverage.ts turn failures into DEGRADED reason codes under the logged Decisions [2.0] ('the skeleton logs nothing; every failure becomes a DEGRADED code'); base.ts:249 relies on postAcked/sendChecked logging bus.send_failed or bus.refused; lint no-empty holds |
| HR6: DEGRADED is visible; no silent zero | GAP | SEC-3 (a forged event stops the observers silently), SEC-4 (health stuck after a clock move), SEC-10 (busy forever is OK with no coverage) |
| HR7: UNASKED only for actions Attest saw the account take | GAP | SEC-1: Calendar changes by other people are orphan-eligible (calendar-step.ts:205; calendar-pass.spec.ts:67) |
| HR11/privacy: incognito handling decided | GAP | No incognito manifest key, no sender.tab.incognito check, no Decision (SEC-9) |
| Telemetry-api checks | N/A | telemetry-api not touched this sprint |
| Dependencies: pnpm audit --prod; new highs or criticals | PASS | pnpm audit --prod from root and extension/: 'No known vulnerabilities found'; full pnpm audit is also clean |
| Dependencies: no new dependency without a Decisions.md line | PASS | git diff 60bca2d..1e54fd9 -- pnpm-lock.yaml extension/package.json is empty; the root package.json changed only the pre-push hook command |
| Vendor terms re-read if an adapter changed | N/A | Google terms reading deferred to Sprint 3.10 by the logged open question (Decisions.md:58; sprint_3.md 3.10; MANUAL.md Sprint 3) |
| HR4: grade() pure and deterministic (core changes this sprint) | PASS | `npx eslint src/core` exit 0; tests/unit/core/core-purity.spec.ts 114 passed (scratch); no localeCompare, Intl, Date or random in the changed core files |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **SEC-1** [HIGH] Changes other people make on the user's Calendar are stored as changes the account made, so they can be UNASKED → `extension/src/background/calendar-step.ts:205`
   - Rule: Hard Rule 7 (no false accusation; grading.md §7 'Attest accuses an agent of an action only when it saw the action happen'), Hard Rule 5; checklist: hostile Calendar page cannot make an observer misreport
   - Detail: The Calendar observer reads no organiser, response status or calendar ownership. label.ts:9-10 drops the response status on purpose, and SnapshotCalendar keeps only {key, shown, ambiguous}. Any event that appears, moves or disappears between two passes under 2 minutes apart is stored as a change with no first-look marker (calendar-step.ts:205; diff.ts:133, 165, 172). Under grading.md §7 (v1.9 to v1.11, changed this sprint), that is exactly an orphan: the only Calendar row that can be UNASKED. Many such changes are made by someone else: an invitation Google adds automatically (default 'from everyone'), an organiser's reschedule or cancellation, an event on a colleague's shared or a subscribed calendar shown in the grid. When an agent session is active and the user is idle (0.4 + 0.3 >= 0.6), which is routine during a long agent task, Sprint 3 will show 'likely <agent> created/updated/deleted <event>' for an action the account never took. Any stranger can trigger it by sending an invite. The wave D/E simulator modelled only the account's own views. attacks-that-work.md does not list it.
   - Evidence: tests/unit/background/calendar-pass.spec.ts:67 'a later pass reports the change, with no marker': event b, new one minute after the first look, is stored as calendar.created with markers() holding only a's first-look marker. docs/grading.md:234 'A Calendar row is an orphan only if it is a change a view followed'. label.ts:9-10 'The rest (response status, location, conference text) is never read into a field'. snapshot.ts:49-53 SnapshotCalendar = {key, shown, ambiguous}.
   - Suggested fix: Until ownership is known, store every Calendar change as a first sighting with its marker: never a Calendar UNASKED, which is the 'missed, never false' direction. Then add two derived booleans to the snapshot, confirmed on the live page in 2.8: the account organises the event (label RSVP or organiser text, best knowledge) and the account owns the calendar (side panel 'My calendars' versus 'Other calendars'). In calendar-step, store changes on events or calendars the account does not own as first sightings. Add simulator and golden cases for third-party invites, reschedules, cancellations and shared-calendar edits, and an attacks-that-work.md row until done.
   - Verification: **CONFIRMED**. Reproduced in sec-verify/extension/tests/unit/zzverify/sec1-thirdparty.spec.ts. Pass 1 (12:00) had event a. Pass 2 (12:01) added 'Invitation from a stranger' on the main calendar and 'Dentist (colleague)' on a second calendar that is shown. Stored first-look markers: 1 (only a's). Core coveredObservations at 12:05 returned both new events as orphan candidates. attribute() with a chatgpt session at 11:57 and an idle interval 11:50-12:05 returned {agent: chatgpt, scoreBp: 7000, signals: [agentSessionActive, userIdle]}, over the 0.6 threshold. This is not an accepted limit. attacks-that-work.md has no row for it. adapters.md §1 ('who did it is never observed') covers user versus agent, not changes the account never made. The same path likely also catches events Google itself adds while the tab is open; the live smoke can confirm that. HIGH stands, given grading.md §7 'never a false one'.

2. **SEC-3** [MEDIUM] A vendor page can detect Attest and silently stop its observers through WXT's start-up CustomEvent → `extension/entrypoints/content/gmail.content.ts:27`
   - Rule: Hard Rule 6 (fail loud); privacy (Hard Rule 1 spirit: nothing about the user reaches the vendor); checklist: message channels a vendor page can reach
   - Detail: noScriptStartedPostMessage removes only the window.postMessage. WXT's ContentScriptContext still dispatches CustomEvent('<runtime.id>:<entrypoint>:wxt:content-script-started', {detail:{contentScriptName, messageId}}) on document (node_modules/wxt/dist/utils/content-script-context.mjs:167-168; name from internal/custom-events.mjs:16). It also listens for that name: an event whose detail.contentScriptName matches and whose messageId is not its own calls notifyInvalidated() (lines 178-186). Both content scripts wire that to handle.disconnect (gmail.content.ts:27, gcal.content.ts:68). DOM events are shared with the page, and Chrome hands a page-made CustomEvent's detail to the isolated world as a structured clone. So any main-world script on mail.google.com or calendar.google.com that knows Attest's public store id can (a) listen and learn Attest is installed and running, and (b) dispatch the event to stop every observer in the tab. Such scripts include Google's code, another extension, an agent extension acting in the tab, or an XSS. Nothing reports the stop: the stored health keeps its last value (usually OK) and coverage just ends. The comments at gmail.content.ts:22 and gcal.content.ts:62, and Decisions [2.7] ('no user data'), overstate the protection.
   - Evidence: Scratch build content-scripts/gmail.js: `function Qy(e){return`${pc?.runtime?.id}:gmail:${e}`}` ... `stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}}))` and `listenForNewerScripts(){let t=e=>{e instanceof CustomEvent&&this.verifyScriptStartedEvent(e)&&this.notifyInvalidated()};document.addEventListener(...)`; main: `for(let t of[Jy,ty]){let n=I_(t,{post:gh});e.onInvalidated(n.disconnect)}`.
   - Suggested fix: Do not tear the observers down on ctx.onInvalidated. Disconnect only when the extension context is really gone: a post failing with BusError 'context_invalidated', or browser.runtime.id undefined. Remove the fingerprint with a pnpm patch of wxt that skips stopOldScripts/listenForNewerScripts when noScriptStartedPostMessage is set, or accept and document it in Decisions.md and attacks-that-work.md. Add an E2E test that dispatches the forged event from the page and asserts the observers keep posting. Correct the two comments and Decisions [2.7].
   - Verification: **CONFIRMED**. Reproduced in real Chromium with my scratch build of HEAD (sec-verify/probes/sec3-forged-event.mjs; synthetic Sent page routed at mail.google.com). A main-world listener added before load received {"contentScriptName":"gmail","messageId":"5l8dqy9kd5l"}. A control DOM change moved gmail.sent health and ping from 23:45:38.528 to 23:45:41.043. After the page sent the forged event, two DOM changes 3 s apart started no pass: health and ping stayed at 23:45:41.043, status OK. One sub-claim is wrong: Decisions [2.7] says the event carries 'no input event and no user data', which is true. Only the code comments (gmail.content.ts:22, gcal.content.ts:62) suggest the handshake is invisible to the page. MEDIUM stands because Sprint 3's adapter content scripts use the same WXT handshake on agent-vendor pages. There a silent stop is Hard Rule 6's 'silently producing zero claims', by a party red_team.md treats as an adversary.

3. **SEC-4** [MEDIUM] A health report stamped while the clock was ahead freezes the observer's health, and any observer id is accepted → `extension/src/background/observer-messages.ts:133`
   - Rule: Hard Rule 6 (fail loud, never cry wolf); checklist: forged content-script message
   - Detail: onHealth has no clock check, unlike rows, pings and snapshots (clock_behind). recordOwnHealth drops any report older than the stored one (src/ledger/health.ts:72), and guardClock repairs coverage, pings, records and rows but not adapterHealth. After the clock moves back, every honest report is acknowledged but ignored until real time passes the stored checkedAt. A stored OK then hides a real DEGRADED. A DEGRADED the ledger set is stamped at later(input.at, current.checkedAt) (health.ts:113), and clearLedgerDegraded needs a later checkedAt, so it sticks too (cry wolf). onHealth also stores any ComponentId as adapterId and does not tie a report to the sending tab's host, so a Gmail tab can write Calendar health, and distinct ids grow adapterHealth and state.ownHealth without bound.
   - Evidence: Scratch probe tests/unit/secprobe/background-probe.spec.ts: OK report checkedAt 2027-10-03T13:59 stored with the worker clock at 2027; then with the clock at 2026-10-03T14:00, a DEGRADED report (selector.missing.grid) gives ack={"ok":true} and stored={"adapterId":"gmail.sent","status":"OK","reasons":[],"checkedAt":"2027-10-03T13:59:00-04:00"}. A content-script report for 'muse' is stored: {"adapterId":"muse","status":"OK",...}.
   - Suggested fix: In onHealth, refuse (clock_behind, logged) a report whose checkedAt is after ctx.now(). Refuse adapter ids not in OBSERVER_SOURCES (Sprint 3 extends the list). Refuse a report whose sender.url host is not one of that observer's hosts. In clock-guard repair, delete or re-stamp adapterHealth rows checked after now. Add a unit test for each.
   - Verification: **CONFIRMED**. Reproduced in sec-verify/extension/tests/unit/zzverify/sec4-5-8.spec.ts. An OK report with checkedAt 2027-10-03T13:59 was stored. A Gmail row sighted in 2027 raised the high water. guardClock then ran at 2026-10-03T14:00. A DEGRADED report (selector.missing.grid) at 13:59:30 got {ok:true}, but the stored row still says OK, checkedAt 2027. A 'muse' report from a content script was stored. Caveats: health stays stuck only as long as the clock step was big (no amplification), and the id and host half needs a buggy or compromised content script. MEDIUM is still fair: the v1.11 clock-safety contract repairs every other stored instant, and adapterHealth is the one it misses.

4. **SEC-5** [MEDIUM] The retention purge trusts the wall clock: a forward clock jump deletes current history for good → `extension/src/background/alarms.ts:32`
   - Rule: Hard Rule 5 / Hard Rule 4 (evidence and receipts kept for replay); checklist: storage, clock guard cannot be abused to delete data
   - Detail: runRetentionPurge passes nowIso(), and cutoffOf returns now - 90 days with no sanity bound (src/ledger/retention.ts:103). Chrome alarms fire by wall-clock time, and on browser start a dropped purge is due 1 minute later. If the clock is more than 90 days ahead when the alarm fires (a user who moved the date, a misconfigured NTP, a machine booting with a wrong clock), every claim, receipt, observation, coverage interval and Calendar record dated before the future cutoff is deleted in one transaction. Nothing restores it when the clock comes back. The clock guard added this sprint protects coverage against backward jumps only.
   - Evidence: Scratch probe background-probe.spec.ts: one gmail.sent row stored, then purgeExpired(db, {now:'2027-10-03T14:00:00-04:00'}) gives `purge before=1 after=0 report={"cutoff":"2027-07-05T18:00:00.000Z","claims":0,"receipts":0,"observations":1,...}`.
   - Suggested fix: Keep `lastPurgeCutoff` in meta and let each run advance the cutoff by at most about 2 days past it, or bound the cutoff by the clock high water (min(now, highWater + 1 day) - 90 d). Log and skip (e.g. purge.clock_ahead) when now is far beyond the latest stored instant. Add a test with a clock one year ahead that deletes nothing current.
   - Verification: **CONFIRMED**. Reproduced: purgeExpired with now 2027-10-03T14:00-04:00 removed a row sighted 2026-10-03 (before=1, after=0, cutoff 2027-07-05T18:00Z). alarms.ts:32 passes nowIso() with no bound. The trigger is rare: the clock must be more than 90 days ahead when the daily or start-up alarm fires. But the loss is silent (the purge logs nothing) and permanent. It also wipes first sightings, which reopens the path Decisions [2.6-verify] rule 3 closed: an event re-sighted 'now' can verify a re-read old 'created' claim. MEDIUM stands. The Hard Rule 4 tag is weak, because kept receipts still replay.

5. **SEC-6** [MEDIUM] Any stranger can plant a purchase: a look-alike display name passes the impersonation check, and generic receipts count as fully as platform ones → `extension/src/observers/gmail/receipts/generic.ts:34`
   - Rule: Hard Rule 5 and Hard Rule 7 (no false evidence or accusation); checklist: fake receipt senders, homoglyph senders
   - Detail: The generic parser accepts mail from any non-registry sender whose subject says order, receipt or confirmation and that has a total line. Its stated impersonation guard (header item 4) compares ASCII brand tokens (amazon, uber, ...) with nameTokens(display name), which does not fold look-alike characters. So 'Аmazon' with a Cyrillic А passes, and the merchant shown later is the stranger's display name. The declared confidence 0.6 is never sent or stored (parser.ts:38-42; Decisions [2.3]), and an Observation carries no parser identity. A stranger's email is therefore the same evidence as a real platform receipt: it can be an orphan (UNASKED 'likely agent purchase at Аmazon $499') or support a false purchase claim. Not in docs/attacks-that-work.md.
   - Evidence: Scratch probe tests/unit/secprobe/receipts-probe.spec.ts: From name 'Аmazon' <orders@shop-deals.example>, subject 'Your order confirmation', body row 'Order total | $499.00' gives planPass status OK, observations [{source:'gmail.receipt', type:'purchase.made', merchant:'Аmazon', amountCents:49900, currency:'USD', subjectHint:'Your order confirmation'}], coverage point 2026-10-02T16:17:00-04:00. The same mail with ASCII 'Amazon' gives 0 observations.
   - Suggested fix: Before the brand check, reduce the display name to a Unicode TR #39 look-alike skeleton, or refuse a generic receipt whose display name mixes scripts or holds non-ASCII letters. Decide in the contract whether a generic receipt can be an orphan or more than PARTIAL; carrying the parser kind needs an allowlist field and a Decisions entry. Add an attacks-that-work.md row and a red-team case (Sprint 6).
   - Verification: **CONFIRMED**. Reproduced in sec-verify/extension/tests/unit/zzverify/sec6-7.spec.ts. 'Аmazon' (U+0410) <orders@shop-deals.example> gives planPass OK: purchase.made, merchant 'Аmazon', 49900 USD, with a point coverage window. ASCII 'Amazon' is refused, and so is fullwidth 'Ａmazon' (NFKC folds it). nameTokens('Аmazon') = ['аmazon']. The homoglyph part is narrower than stated. A stranger needs no homoglyph: 'Best Buy' also gives purchase.made 49900. And merchantMatch would not pair Cyrillic 'Аmazon' with a Latin 'Amazon' claim, so the homoglyph mostly misleads the person reading. The real gap is that dropping the 0.6 prior (Decisions [2.3]) makes stranger mail full evidence that can also be an orphan. attacks-that-work.md does not list it.

6. **SEC-2** [LOW (reviewer: MEDIUM)] calendarSnapshots keeps and exports every guest address of every viewed event, more than the diff needs → `extension/src/observers/gcal/snapshot.ts:64`
   - Rule: Hard Rule 2 (derived facts, allowlisted fields; sprint rule 'REDACT AT THE EDGE'); checklist: exports use the redacted projection
   - Detail: For every event in every range viewed in the last 90 days, the calendar.snapshot message, its IndexedDB record and the ledger export (export.ts:49,113) keep: title (up to 80), start, end, all-day, days and up to 200 guest addresses. The gcal.event allowlist keeps one counterparty. The stored guests are only compared (diff.ts:89-90, 105-106; calendar-seen.ts:37), except the first guest of a deleted event (diff.ts:172), so hashes would serve for all but one. The service-worker schema accepts any one-line text of up to 320 characters as a guest (snapshot.ts:64), not only an address, so a buggy or compromised content script could store up to 200 x 500 free-text strings per range. docs/privacy-architecture.md:36 says guest addresses are kept 'because matching needs it', which is not what the code does. 'attest replay' never reads this table, yet the export carries it.
   - Evidence: Scratch probe tests/unit/secprobe/gcal-probe.spec.ts on synthetic-gcal-week-before.html: snapshot events=6, multiGuest=[{"s":"Late deploy window","g":["jordan.lee@example.com","sam.chen@example.net"],"end":"2026-10-08T00:30:00-04:00"}]; observation rows=[["Weekly sync","alex.rivera@example.com"],["Investor call","morgan.patel@example.com"],["Late deploy window","jordan.lee@example.com"]]. sam.chen@example.net exists only in the snapshot and the export.
   - Suggested fix: In the stored record keep per event `firstGuest` (in clear) and `guestKeys` (sorted SHA-256 of each ASCII-folded address) instead of `guests`, and compare keys in diff.ts and calendar-seen.ts. Refine SnapshotEvent so each guest must satisfy email(g)?.address === g. Correct privacy-architecture.md §1 and §5.4. Consider a replay or share export without calendarSnapshots, keeping the full table only in a 'download all my data' export.
   - Verification: **RESIZED** to LOW. Re-ran sec-verify/extension/tests/unit/zzverify/sec2.spec.ts. Snapshot guests: alex.rivera@, morgan.patel@, jordan.lee@, sam.chen@example.net. The rows carry the first three only. A free-text guest passes CalendarSnapshotMessage. But the design is disclosed with a reason: PRIVACY.md:47 ('its guests' email addresses, so Attest can later tell which events were created, changed or deleted') and privacy-architecture.md §5.4. It is logged in Decisions [2.5] (snapshot schema) and [2.9]. Every value is a derived fact of an allowlisted kind and stays local, so no Hard Rule 2 breach and no CRITICAL. The free-text point is not special to snapshots: Observation.counterparty uses the same oneLineText(320) schema (core/schema.ts:148). What is left: guests stored in clear where sorted hashes plus the first guest would do, and privacy-architecture.md:36 crediting it to 'matching'.

7. **SEC-7** [LOW (reviewer: MEDIUM)] Quadratic regex on stranger-controlled email subjects runs on Gmail's main thread → `extension/src/observers/gmail/receipts/selectors.json:147`
   - Rule: Hard Rule 3 spirit (Attest must not degrade the vendor page); checklist: input handling of hostile pages
   - Detail: The first alternative of generic.refuseSubject, `\d+\s*%\s*off\b`, is unanchored, so on a run of n digits with no '%' it backtracks O(n^2). It runs on the subject of every opened message from a non-registry sender whose subject says order, receipt or confirmation (generic.ts:45). That happens three times per pass (health, extract, windows), and passes repeat every 0.5 to 2 s while Gmail's DOM changes. Content scripts share the page's main thread, so a stranger's email 'Your order 1111...' freezes the user's Gmail tab while it is open. How bad it is depends on the longest subject Gmail draws in the conversation heading (live smoke, SEC-12).
   - Evidence: node redos.mjs (refuseSubject compiled 'iu' as selectors.ts does): 1,000 digits 2.5 ms; 10,000 digits 432 ms; 50,000 digits 13,548 ms; 100,000 digits 42,541 ms. Whole planPass in happy-dom (receipts-probe.spec.ts): 2,000 digits 20 ms; 8,000 digits 253 ms; 16,000 digits 905 ms per pass.
   - Suggested fix: Write the alternative as `\d\s*%\s*off\b` (same matches, linear time). Cut the subject (and any page text matched by a selectors regex) to about 1,000 code points before matching. Add a perf test: a 100,000-digit subject classifies in under 50 ms.
   - Verification: **RESIZED** to LOW. Re-measured with sec-verify/probes/redos.mjs, on the joined 'iu' regex as compileAny builds it. Timings: 998 digits 2.2 ms, 10,000 digits 110 ms, 20,000 digits 445 ms. The rewrite \d\s*%\s*off\b gives the same results on sample subjects and takes 0.8 ms at 10,000. Whole pass (zzverify/sec6-7.spec.ts): 998 digits 7 ms, 10,000 digits 314 ms, 20,000 digits 1,241 ms. The quadratic cost is real. But the harm needs Gmail to draw a subject of 10,000+ characters, which nothing measured shows (the reviewer defers that to SEC-12 item 10). At the RFC 5322 one-line limit the cost is negligible. LOW until the live smoke shows such a subject renders. The one-character fix still stands.

8. **SEC-8** [LOW] The service worker records an account-less Calendar window of any length → `extension/src/background/observer-messages.ts:247`
   - Rule: Hard Rule 5; checklist: a forged content-script message cannot poison coverage
   - Detail: pingProblem bounds only Gmail windows. A gcal.event ping without accountHash skips the snapshot check (the windowInRange check applies only to held pings, line 289) and is recorded directly. The real reader never exceeds 42 days, so only a buggy or compromised content script can send a longer one. Grading caps account-less coverage, so there is no NOT_FOUND. But the entry counts for grace, and an entry without changesSince synced at or after a row's first sighting blocks Calendar orphans (orphan rule b) over its whole span.
   - Evidence: Scratch probe background-probe.spec.ts: onCoveragePing with {observerId:'gcal.event', source:'gcal.event', lastSyncAt:'2026-10-03T13:00-04:00', windowStart:'1990-01-01T00:00-05:00', windowEnd:'2090-01-01T00:00-05:00', allCalendars:true} gives ack {"ok":true}; stored interval accountKey '', startMs 631170000000, endMs 3786930000000.
   - Suggested fix: In pingProblem, refuse (invalid_input) a gcal.event window longer than MAX_RANGE_DAYS + 1 days or one not starting and ending at a local midnight. Add a unit test.
   - Verification: **CONFIRMED**. Reproduced in sec-verify/extension/tests/unit/zzverify/sec4-5-8.spec.ts. An account-less gcal.event ping for 1990-01-01 to 2090-01-01 got {ok:true} and was stored (accountKey '', startMs 631170000000, endMs 3786930000000). pingProblem (observer-messages.ts:247) bounds Gmail windows only. It needs a buggy or compromised content script, and grading caps account-less coverage, so LOW stands.

9. **SEC-9** [LOW] No incognito decision: incognito Gmail and Calendar facts would go to the persistent ledger → `extension/wxt.config.ts:47`
   - Rule: Hard Rule 11 and Hard Rule 2 (privacy expectations); checklist: permissions and manifest
   - Detail: The manifest has no `incognito` key (MV3 default 'spanning'), no code checks sender.tab.incognito, and no Decision covers it. If a user allows Attest in incognito, observations, coverage pings and Calendar snapshots read in incognito tabs are written to the regular profile's IndexedDB and outlive the incognito session.
   - Evidence: grep -rni incognito over extension/src, extension/entrypoints, wxt.config.ts, Decisions.md, docs/privacy-architecture.md and PRIVACY.md returns nothing; the built manifest has no incognito key.
   - Suggested fix: Set manifest `incognito: 'not_allowed'` and pin it in tests/e2e/built-bundle.spec.ts, or drop observer messages whose sender.tab.incognito is true. Log the decision in Decisions.md and state it in PRIVACY.md.
   - Verification: **CONFIRMED**. grep -rni incognito over extension/src, extension/entrypoints, wxt.config.ts, Decisions.md, docs/, PRIVACY.md, build_spec.md, sprints/ and agents/ finds nothing. The manifest of my scratch build has no incognito key, so Chrome's default (spanning) applies. It only matters after the user allows Attest in incognito. LOW stands.

10. **SEC-10** [LOW] A Calendar page that stays 'busy' is reported OK with no coverage forever → `extension/src/observers/gcal/page.ts:76`
   - Rule: Hard Rule 6 (silently producing zero is a bug of the worst kind)
   - Detail: pageBusy is true when aria-busy='true' sits on main, a shown grid, or any ancestor of either (closest), or when a shown progress bar is inside main. Then health is OK and nothing is read (health.ts:18; observer.ts:64, 80, 86). There is no time limit. If Calendar leaves aria-busy on a wrapper or keeps a progress bar in main (the selectors are best knowledge only), the observer reports OK and writes nothing indefinitely. docs/adapters.md lists aria-busy clearing as a live-smoke check, but the code has no fallback if it never clears.
   - Evidence: page.ts:73-78 `if ([main, ...gridsOf(main)].some((el) => el.closest(S.busy) !== null)) return true; return shownOnly(main.querySelectorAll(S.progress)).length > 0;`; health.ts:18 `if (pageBusy(doc)) return { status: 'OK' };`
   - Suggested fix: Count consecutive busy passes per page. After a bound (e.g. 5 minutes or 10 passes) report DEGRADED 'page.busy' (add it to GCAL_REASONS and docs/adapters.md §4.4). Add a test.
   - Verification: **CONFIRMED**. page.ts:76-77 and health.ts:18 are as quoted. This is partly documented. adapters.md §8.3 Known limits says 'a page that kept it would stay OK while reading nothing' and asks the live smoke to check it. Decisions [2.7-observers] logs busy as OK, to avoid crying wolf on navigation. That covers today's markup, not a later Calendar change, which is exactly the case Hard Rule 6 is about. A time bound fits the logged reason, so LOW stands.

11. **SEC-11** [LOW] One event an outsider organises can add a stored row per edit, with no cap → `extension/src/observers/gcal/diff.ts:165`
   - Rule: Checklist: a hostile Calendar page cannot exhaust storage
   - Detail: Each distinct state of an event (title, start, guests) has its own contentHash, so every edit a pass sees is a new calendar.updated row (a first sighting with a marker interval when stale). Suppose an organiser edits an invited event by script, with a distinct title each time, while the user's Calendar tab is visible and passing every 0.5 to 2 s. That adds up to about 43k-170k rows a day, kept for 90 days, all in one [type+timeBucket] while the start stays put. This also slows candidate reads for claims near that time in Sprint 3 batches. No per-event or per-day bound exists.
   - Evidence: diff.ts:165 emits calendar.updated for any change of start, end, all-day, subject, calendar or guests; upsertObservation inserts every new contentHash; no cap exists in calendar-step.ts or calendar-pass.ts.
   - Suggested fix: Coalesce updates to one event key within a short window (keep the first and last state per minute), or cap stored rows per event key per day and report DEGRADED 'event.churn' past the cap. Test with 1,000 scripted edits.
   - Verification: **CONFIRMED**. Mechanism reproduced in sec-verify/extension/tests/unit/zzverify/sec11.spec.ts. 60 passes a minute apart, each with a new title for one event, stored 60 rows (59 calendar.updated). Each one is a change a view followed, so each can also be an orphan (SEC-1). The real rate depends on how fast Calendar pushes an organiser's edits into an open tab, which has not been measured. LOW stands.

12. **SEC-12** [LOW] Live smoke (2.8) must check facts the synthetic fixtures cannot show → `MANUAL.md:20`
   - Rule: Hard Rules 2 and 5; brief: report what synthetic fixtures cannot cover and the live smoke must check
   - Detail: The 2.8 item says only 'open your real Gmail Sent and Calendar for 10 minutes'. These checks need the real pages: (1) the text of [data-legacy-last-message-id] is the subject only, with no snippet and no attachment names, else up to 80 characters of body text enter subjectHint; (2) every To-column recipient element carries `email`, else the `title` fallback can read an address-shaped display name as the recipient; (3) Gmail times are in the browser's zone (no zone check exists for Gmail); (4) an undone or scheduled send never appears as a Sent row; (5) on row hover the time element is still the date, not an action button; (6) the Calendar chip's Guests segment lists addresses, not display names, and the no-drawn-part fallback title never takes the location; (7) what the label and side panel show for invited events and for other people's calendars (SEC-1); (8) aria-busy and progress bars clear on a quiet page (SEC-10); (9) a forged WXT event from DevTools stops the observers (SEC-3); (10) the longest subject Gmail draws in the conversation heading (SEC-7).
   - Evidence: Synthetic fixtures put the snippet and seeds in siblings by construction (Decisions [2.1/2.4] 'never in a field the extractor reads'); sent-page.ts:141-148 falls back to `title`; sent-time.ts:37 resolves with the browser offset; Decisions [2.1/2.4] marks the label, guest and selector details as 'best knowledge, to verify on the first real capture'.
   - Suggested fix: Add these ten checks as a written checklist to the MANUAL.md 2.8 item and to docs/adapters.md §8, with the expected result and the DEGRADED code or Decision to log for each.
   - Verification: **CONFIRMED**. MANUAL.md:20 is the bare 2.8 line, and the brief asked for exactly this list. Three corrections. Item 9 is already settled: the Chromium probe for SEC-3 shows the forged event stops the observers, so no live check is needed. Item 8 is already a live-smoke item in adapters.md §8.3. Item 4 is worded wrong: a scheduled send does land in Sent at its scheduled time, as a real send. Only an undone send never appears.

### TESTS WRITTEN

- scratchpad/s2rev/security/extension/tests/unit/secprobe/receipts-probe.spec.ts (scratch probe: look-alike 'Аmazon' display name accepted as a generic purchase; quadratic subject cost per pass)
- scratchpad/s2rev/security/extension/tests/unit/secprobe/background-probe.spec.ts (scratch probe: health stuck after a clock move; unknown adapter id stored; 100-year account-less gcal window stored; purge with a clock one year ahead deletes current rows)
- scratchpad/s2rev/security/extension/tests/unit/secprobe/gcal-probe.spec.ts (scratch probe: the Calendar snapshot keeps every guest while the observation keeps one)
- scratchpad/s2rev/security/redos.mjs (scratch timing of generic.refuseSubject on long digit runs)

### ADVERSARIAL VERIFICATION

I re-checked all 12 gaps myself in a scratch copy: scratchpad/s2rev/sec-verify/. The probe tests are in extension/tests/unit/zzverify/ and the scripts in probes/. I also ran a real Chromium probe for SEC-3 against my own build of HEAD. The shared tree is untouched (git status is empty).

Result: 10 gaps confirmed at the reviewer's size, 2 resized down (SEC-2 and SEC-7), none refuted.

- **SEC-1 (HIGH) reproduces end to end.** Two passes ran one minute apart. Between them, a stranger's invite appeared on the main calendar and a colleague's event appeared on a second calendar that is shown. Both became orphan candidates in core coveredObservations. attribute() then scored chatgpt at 7000 bp (agent session plus idle), above the 6000 bp threshold.
- **SEC-3 (MEDIUM) reproduces in Chromium with the shipped build.** A main-world script on the page saw WXT's start-up event and its detail. After the page sent a forged copy, DOM changes started no more passes, and the stored health stayed OK.
- **SEC-2 resized to LOW.** What the snapshot stores is told to users in PRIVACY.md:47 and explained, with a reason, in privacy-architecture.md §5.4. It is logged in Decisions [2.5] and [2.9]. Every value is a derived fact and stays local, so it breaks no Hard Rule.
- **SEC-7 resized to LOW.** The regex is quadratic. But a 998-character subject (the RFC line limit) costs about 2 ms, or 7 ms per pass. The harm needs Gmail to draw a 10,000+ character subject, and nobody has shown that it does.

**Two LOW misses:**
- SEC-V1: the service worker never checks which site an observer message came from. A complete Calendar pass sent from a Gmail tab was stored.
- SEC-V2: a stranger's display name over 120 characters makes gmail.receipt DEGRADED. That contradicts Decisions [2.3]. It also drops the coverage of a real receipt in the same conversation.

**One checklist status is wrong:** the export item should be PASS, not GAP.

**Hard Rules 1–4 and 10 also held under my own checks:**
- The source grep and the built-bundle grep find no network calls.
- The content scripts use no page storage (no IndexedDB, localStorage or cookies).
- eslint over the sprint's code exits 0 with no disables.
- Core purity, manifest and handler tests pass (151 tests).

Gaps the verifier found that the review missed:

1. **SEC-V1** [LOW] The service worker never checks which site an observer message came from → `extension/src/background/router.ts:69`
   - Rule: Checklist: a forged content-script message cannot write rows or poison coverage (the threat model of the Sprint 1 carry-forward SEC-V1); Hard Rule 5
   - Detail: The service worker checks only that an observer id matches its source (OBSERVER_SOURCES). onObservations is not even given the sender (router.ts:69). onCoveragePing and onCalendarSnapshot use the sender only as a key for held pings (observer-state.ts senderKey). So a buggy or compromised Gmail content script can write a whole Calendar pass: rows, a snapshot record, coverage windows and first-look markers. A Calendar script can do the same for Gmail. SEC-4 asked for a host check on adapter.health only.
   - Evidence: sec-verify/extension/tests/unit/zzverify/secv-sender.spec.ts. The sender was {url: 'https://mail.google.com/mail/u/0/#inbox', tab 3}. onCoveragePing with a gcal.event week ping returned {ok:true}. onCalendarSnapshot with a week holding event a and the account hash returned {ok:true}. Stored: rows=1, records=1, intervals=2.
   - Suggested fix: Pass the sender to every observer handler. Work out which observers serve sender.url's origin from OBSERVER_HOSTS. Refuse any adapter.health, observer.observations, coverage.ping or calendar.snapshot whose observer id that origin does not serve. Use invalid_input and log only the observer id. Add a test for each of the four types: a Gmail-tab sender posting gcal.event, and a Calendar-tab sender posting gmail.sent.

2. **SEC-V2** [LOW] A stranger's long display name makes the receipt observer DEGRADED and drops a real receipt's coverage → `extension/src/observers/gmail/receipts/generic.ts:49`
   - Rule: Hard Rule 6 (fail loud, never cry wolf; Decisions [2.3]: 'The generic parser never makes a pass DEGRADED'); Hard Rule 5
   - Detail: The generic parser uses the sender's display name as the merchant, with no length or one-line check. project() refuses a merchant longer than SCHEMA_LIMITS.MERCHANT (120) with RedactError('invalid_field'). The whole pass is then DEGRADED (redact.invalid_field) and posts no coverage. So anyone can send an 'order confirmation' with a total line and a From name of 121+ characters. While the user has it open, gmail.receipt reports DEGRADED. A real receipt in the same opened conversation keeps its row but loses its coverage point, so it can no longer be an orphan.
   - Evidence: sec-verify/extension/tests/unit/zzverify/secv-longname.spec.ts. Name 'S' x120: status OK, 1 observation. Name 'S' x121: DEGRADED ['redact.invalid_field'], 0 observations. A conversation with a real 'Real Shop' receipt plus a stranger's 130-character name: DEGRADED, 1 observation, coverage null.
   - Suggested fix: In generic.ts, return NOT_A_RECEIPT when the display name is not one clean line of at most SCHEMA_LIMITS.MERCHANT code points, as the generic parser's header promises. Platform parsers keep failing loud. Add unit tests for 120 and 121 characters, and one where a real receipt in the same conversation keeps its coverage point.

Checklist corrections:

- HR2 'exports and share use the redacted projection, never the raw ledger row': GAP should be PASS. export.ts:95-115 reads every table through readRows with its strict schema and strips index fields. calendarSnapshots holds derived facts disclosed in PRIVACY.md:47 and privacy-architecture.md §5.4. What that table should keep is SEC-2's storage question (now LOW), not an export defect.
- 'Input: a forged content-script message cannot write rows it should not, poison coverage or break replay': stays GAP. It should also cite SEC-V1: rows, pings and snapshots are not tied to the sender's site, while SEC-4 named health only.
- 'HR6: DEGRADED is visible; no silent zero': stays GAP. Add SEC-V2 for the opposite failure: a stranger's mail makes gmail.receipt report DEGRADED when nothing is wrong.
- 'HR1/HR3: message channels a vendor page can reach': the GAP is now confirmed in real Chromium with the shipped build (sec-verify/probes/sec3-forged-event.mjs), not only from the bundle text. SEC-12 item 9 therefore needs no live check.
- 'HR3: no .click/.submit/dispatchEvent/.value=/.focus on vendor DOM': PASS holds only as a logged exception (Decisions [2.7], WXT's CustomEvent). The note should say the one dispatch can be read and forged by the page (SEC-3).

### COMMANDS RUN

- `git log --oneline 60bca2d..1e54fd9; git diff --stat 60bca2d..1e54fd9` → 15 commits, 342 files: 114 source files under extension/src, extension/entrypoints, scripts and bench; policy/, eslint rules and the lockfile unchanged
- `grep -rn "fetch(\|XMLHttpRequest\|navigator.sendBeacon\|WebSocket" extension/src extension/entrypoints` → no output (exit 1): No network call in source; src/telemetry/send.ts does not exist yet
- `npx wxt build (scratch copy) + token grep of .output/chrome-mv3/content-scripts/{gmail,gcal}.js and background.js` → no network tokens; only WXT's own document CustomEvent dispatch and a guarded postMessage: Built manifest: permissions storage/alarms/sidePanel, host_permissions exactly the two hosts, CSP strict, no web_accessible_resources; gmail.js holds `${pc?.runtime?.id}:gmail:wxt:content-script-started` and e.onInvalidated(n.disconnect)
- `pnpm audit --prod (root and extension/); pnpm audit (root)` → No known vulnerabilities found (all three): git diff of pnpm-lock.yaml and extension/package.json is empty
- `npx eslint entrypoints/content src/observers src/background src/bus src/ledger --max-warnings 0; npx eslint src/core --max-warnings 0 (scratch)` → exit 0 both: grep eslint-disable over those scopes is empty
- `npx vitest run tests/unit/manifest-hosts.spec.ts tests/unit/observers/no-act.spec.ts tests/unit/bus tests/unit/background/observer-messages.spec.ts tests/unit/ledger/clock-guard.spec.ts tests/unit/ledger/migrations-v3.spec.ts tests/unit/ledger/migrations-v2.spec.ts (scratch)` → 174 tests passed; 1 suite failed only by scratch layout: tests/unit/bus/docs.spec.ts ENOENT for docs/adapters.md, which was not copied into the scratch tree; not a product failure
- `npx vitest run tests/unit/core/core-purity.spec.ts (scratch)` → 114 passed: Core purity gate green for this sprint's src/core changes
- `npx vitest run tests/unit/secprobe/receipts-probe.spec.ts (scratch)` → 3 passed; probe facts recorded: Cyrillic 'Аmazon' → purchase.made merchant 'Аmazon' amountCents 49900 with a coverage point; ASCII 'Amazon' refused; pass time 2,000 digits 20 ms, 8,000 253 ms, 16,000 905 ms
- `node redos.mjs (scratch)` → quadratic: refuseSubject on 'Your order '+digits: 1,000 → 2.5 ms; 10,000 → 432 ms; 50,000 → 13,548 ms; 100,000 → 42,541 ms
- `npx vitest run tests/unit/secprobe/background-probe.spec.ts (scratch)` → 4 passed; probe facts recorded: Health stuck at OK (checkedAt 2027) after a DEGRADED report at 2026 acked ok; 'muse' health stored; account-less gcal window 1990-2090 stored; purgeExpired with now 2027-10-03 deleted the 1 current observation (cutoff 2027-07-05T18:00Z)
- `npx vitest run tests/unit/secprobe/gcal-probe.spec.ts (scratch)` → 1 passed: Snapshot 'Late deploy window' guests [jordan.lee@example.com, sam.chen@example.net]; observation counterparty jordan.lee@example.com only


## Re-review of the real-capture work (2026-10-06)

**Scope.** The same eight commits, including the 21 sanitized captures and their labels, which had not been pushed. Two passes: the captures as committed, then the 17 kept after cleaning, with a decoder sweep (plain text, entities, JavaScript escapes, percent-decoding, base64 and base64url at four offsets, zlib, raw deflate and gzip, to depth 3). No personal value is written here.

| ID | Severity | Finding |
|---|---|---|
| SEC-R1 | critical | The founder's real address and Uber rider id inside Uber's click links in `receipt-uber.html` (path segments base64url of a zlib-compressed query, `@` written `%40`). |
| SEC-R2 | high | The trip's pickup and drop-off addresses in Google Maps link paths in the same receipt. |
| SEC-R3 | high | A phone number in a `tel:` link in `sent-thread.html` (redacted text, link kept; the `%20` hid it from the phone pattern). |
| SEC-R4 | medium | `receipt-amazon.html` was a birthday gift-card email from a company, not a shipping notice: birth day and month, and likely the employer. |
| SEC-R5 | medium | The Inbox tab previews (kept in the DOM on every Gmail page) were not redacted: a bank's offer, job alerts, a recruiter's name. |
| SEC-R6 | medium | Receipt bodies kept a Stripe receipt link token, a private person's name with an order number, card endings, a referral link and code, an order id, a shopper's and a driver's first names. |
| SEC-R7 | low | The own-address rule compared exact lowercase strings: a `+tag`, Gmail's dots and `googlemail.com` passed. |
| SEC-R8 | low | On a page that names no account, the generic receipt parser took the account's address (Gmail's sender name for its own mail) as a merchant, and Calendar stored guests unfiltered. |
| SEC-R9 | low | Any `role="listitem"` with `aria-expanded` counted as a message, one inside an email's own markup included. |
| SEC-R10 | low | Activity in any thread after a claimed send moves every later window past it: a false claim stays UNVERIFIABLE (safe, but an attack that works), not yet in docs/attacks-that-work.md. |
| SEC-R11 | low | The link trimmer read URLs with a regex: backslash, single-slash, tab-in-scheme and similar forms kept their path. |
| SEC-R12 | medium | Web addresses outside link attributes (visible text, `data-src`) kept their paths, the form the receipt's referral link took. |
| SEC-R13 | low | The new deep leak test missed short calendar ids, `<wbr>`-split blobs, truncated deflate, JavaScript escapes, and unlabelled or other-vendor captures. |
| SEC-R14 | low | The card-ending pattern was quadratic on long mask runs and missed several real formats. |
| SEC-R15 | low | A display name kept four digits from a real handle; a Google One price in rupees hints at the billing region; a recipient shown as "US". |

**Checked and clean (second pass).** In the 17 kept pages and both labels files, every address is a fake or a registry sender with a fake local part, the founder's name, username and address appear in no layer, the only short calendar id is the fake account's, and nothing of the four removed receipts remains anywhere in the working tree. The new regexes run in linear time; the no-act, logging and bus rules hold.
