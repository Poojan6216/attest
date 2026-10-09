# Sprint 3 — Security review

Role: agents/security_reviewer.md. Range: `git diff 19697ef HEAD` (Sprint 2 close to `8ab40c9`): 25 commits, 175 files, 74 of them source under `extension/src` and `extension/entrypoints`. Done this sprint: 3.2 and 3.10 to 3.17. Tasks marked BLOCKED(MANUAL) are not gaps. `5b51aaf` is a Dependabot bump of three dev dependencies.

**How.** Read-only. I read every Sprint 3 source file against the checklist and ran the checklist's commands. I played the new background paths through the repository's own modules in scratch probes (tsx and fake-indexeddb, `scratchpad/s3sec/`). I changed nothing in the shared tree except this file.

**Verdict: 6 gaps.** 0 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW.

The three most serious gaps end the same way: a FINAL receipt says an agent "likely" did something the person did themselves. The wording of Hard Rule 7 holds: every UNASKED receipt says "likely" and names its signals. The problem is the evidence underneath. In SEC-1 and SEC-3 the evidence is false. In SEC-2 one fact is counted twice.

**What held under every probe.**

- **Hard Rule 1.** The network grep over `src` and `entrypoints` finds nothing. The build the e2e run made from HEAD has no fetch, XHR, beacon, WebSocket, EventSource, importScripts, eval or Function constructor. The manifest asks for two hosts, with no `externally_connectable` and no `web_accessible_resources`. Both @mandatory network tests passed this sprint. The 5-minute session, which pastes through the side panel, made 0 attributed requests.
- **Hard Rule 2 on the paste path.** Only claims and instants cross the bus: `claims.import` is strict and refuses a `text` field. The pasted text lives in side-panel state only, is never logged, and the preview renders it as text nodes. In 20,000 structured random pastes, no claim broke the 80-unit `subjectHint` cap or the `counterparty` cap, and the parser never threw. The secret-seed test pasted every seed and passed, as did its negative control.
- **Hard Rule 3.** `attest/no-act` covers all of `src/adapters/**`, `paste.ts` included, with zero disables. The only `.focus()` calls in the range move focus between Attest's own side-panel and options elements.
- **Hard Rules 8 and 9.** The permissions are storage, alarms and sidePanel. `idle` is optional and requested inside the click (Decisions [3.14]). The CSP is unchanged. Every entry imports `src/setup.ts` first, so Zod never probes `new Function`.
- **Hard Rule 10.** The new events are in LOG_EVENTS. The fields they log are agent ids, codes, counts and ISO instants. Nothing from a paste reaches a log call.
- **Dependencies.** `pnpm audit --prod` is clean. Dexie, Preact and Zod are unchanged.

## Gaps

| #     | Sev    | Rule     | Where                                                                    | Gap                                                                                                                                     |
| ----- | ------ | -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-1 | HIGH   | HR5, HR7 | extension/src/ledger/activity.ts:56, :70-71                              | A time away left open when Chrome exits is later stretched over hours the person spent at the computer                                  |
| SEC-2 | MEDIUM | HR7, HR5 | extension/src/adapters/paste.ts:220-233                                  | One pasted entry fires two UNASKED signals, so it alone reaches the 0.6 threshold                                                       |
| SEC-3 | MEDIUM | HR5, HR7 | extension/src/ledger/clock-guard.ts:72-81, :158-175                      | A clock repair keeps the times away and session pings stamped while the clock ran ahead                                                 |
| SEC-4 | LOW    | HR2, HR7 | extension/entrypoints/sidepanel/components/ActivityForm.tsx:30-31        | The paste flow says it keeps only claims. It also keeps every entry's minute, including entries it lists as "Not imported"              |
| SEC-5 | LOW    | HR2      | docs/privacy-architecture.md:193, :100; PRIVACY.md:82                    | The privacy docs miss two meta keys, give the wrong schema version, and overstate what turning away detection off deletes               |
| SEC-6 | LOW    | HR6, HR10 | extension/entrypoints/options/components/AwayDetection.tsx:22-24, :32-35, :41-43; extension/entrypoints/sidepanel/use-paste-flow.ts:137-139 | Four new catches drop the error without a log line |

### SEC-1 (HIGH): a time away that never closes

**What happens.** Away detection is opt-in (3.14). When Chrome reports `idle` or `locked`, Attest opens an interval and names it in `meta` as `idleOpen`. When Chrome reports `active`, it extends that interval to that instant. Two pieces of code make this go wrong:

- While `idleOpen` is set, `openIdle` stores nothing (`activity.ts:56`).
- `closeIdle` extends whatever interval `idleOpen` names to the return instant (`activity.ts:70-71`).

Only an `active` report or turning the feature off clears the marker.

`idle.onStateChanged` fires only when the state changes, and a new browser session starts from active. So when Chrome exits while the screen is locked or the person is idle, the return is never reported. That happens on a shutdown from the lock screen, an overnight OS update, a forced relaunch or a crash. The next browser session then starts with the stale marker:

- Its first break is not recorded.
- When the person comes back from that break, last night's interval is stretched to that instant, across every hour they worked in between.

**Evidence.**

- Probe `idle-stale.mts`, using the real `recordIdleState` and ledger. The screen locks at 17:00 local on 6 October, Chrome restarts, Chrome reports idle at 12:01 on 7 October and active at 12:45. The ledger then holds one interval, 6 Oct 17:00 → 7 Oct 12:45, and the lunch break is not stored. Control: the same lock with Chrome running and the person back at 17:30 gives 17:00 → 17:30.
- Probe `idle-unasked.mts` uses the §2 demo ledger with one change: the person is at the computer and sends the vendor email themselves at 14:03, then steps away from 14:20 to 14:30.
  - Control: NOT_FOUND and VERIFIED, no UNASKED.
  - With a lock the evening before: one interval, 5 Oct 17:00 → 6 Oct 14:30. The vendor row is **UNASKED, FINAL, likely Muse**, on `unasked.session` and `unasked.idle`.
- Decisions [3.14] says an interval that is never closed "keeps only what was confirmed". The code stretches it instead.

**Why it matters.** grading.md §7 holds `userIdle` to "positive evidence only". Here the evidence is false: the person was working. Any send of their own inside the stretched span becomes a final receipt saying an agent likely sent it, if a pasted log entry falls within 10 minutes of it. The trigger is ordinary: the person locks the screen at the end of the day, then the machine shuts down.

**Fix.**

- Keep the open marker in `chrome.storage.session` instead of IndexedDB `meta`. That storage survives a worker restart but not a browser restart, and it needs no new permission. Alternatively, clear `idleOpen` on `runtime.onStartup` without touching the interval, so it keeps its confirmed `to`.
- After a browser start, an `idle` or `locked` report always opens a new interval.
- Test: locked, browser restart, idle, active gives two intervals, the first ending at the lock instant. The probe's day then grades no UNASKED.

### SEC-2 (MEDIUM): one pasted entry counts as two signals

**What happens.** On the paste path, a single pasted claim supplies two signals:

- Every timed entry's minute becomes a session ping, "a claim or not" (`paste.ts:220-233` `activeAtOf`, stored at `claims-import.ts:72`).
- Every pasted claim is also an activity-log entry (`grading.ts:139`, `:156`).
- `activityLogAdjacent` fires for any entry of the agent within ±2 minutes. Only a claim of the orphan's own type nearby suppresses it, and the entry's type is not read (`attribution.ts:16-18`; grading.md §7).

So one pasted claim at minute m gives `agentSessionActive` (0.4) and `activityLogAdjacent` (0.4) to any orphan of another type within ±2 minutes of m. That is 0.8, over the 0.6 threshold, with no idle data and no signature.

**Evidence.** Probe `one-entry.mts` uses the §2 demo ledger. Muse's paste holds only its calendar entry at 14:02, and away detection is off. Both Gmail sends, at 14:02 and 14:03, become **UNASKED, FINAL, likely Muse**, on `unasked.session` and `unasked.adjacent`. Both signals come from that one entry. The paste tests miss this because in the demo, the email claim suppresses adjacency for the email rows (`unasked-paste.spec.ts`, "the session alone accuses no one").

**Why it matters.** Decisions [3.13] relies on UNASKED needing "more than one" signal at 0.6. With a page reader, a session ping meant the agent's tab was open, which is a separate fact. On the paste path, one fact counts twice. Suppose the person sends their own email a minute after their agent books a meeting. The receipt says the agent likely sent it, and its two signals look like corroboration.

**Fix.** This needs a founder decision, logged in Decisions.md and grading.md §7.

- Proposed rule: a session ping and an activity entry that come from the same pasted entry score once, at the larger weight, so one entry alone never reaches the threshold. The §2 demo still gives UNASKED under this rule: the session ping (0.4) plus idle (0.3).
- Test: an orphan of another type within 2 minutes of one pasted claim, with no idle data, gives no UNASKED.

### SEC-3 (MEDIUM): the clock repair keeps future activity

**What happens.** Activity rows raise the clock high water (`activity.ts:36`, the 3.5 carry-forward), so a clock that ran ahead does trigger a repair. But the repair only deletes or re-stamps:

- coverage and pings;
- Calendar records and unread Calendar rows;
- health reports.

That list is `guardTables` and `repair` (`clock-guard.ts:72-81`, `:158-175`). Times away and session pings stamped in the future stay.

**Evidence.** Probe `clock-activity.mts`. With the clock a day ahead, Attest stores a time away from 16:00 to 16:30Z on 7 October and a pasted session minute at 16:20Z. Then `guardClock` runs at the real time, 18:00Z on 6 October. It logs `ledger.clock_regressed` and keeps one repair span, but both rows remain.

**Why it matters.** When real time reaches 16:00 on 7 October, those rows say the person was away and Muse was working. A send of the person's own at 16:25 then gets both signals, 0.7: UNASKED, likely Muse. The clock guard exists to stop exactly this kind of future evidence (grading.md §3, Clock safety).

**Fix.**

- In `repair`, delete activity rows that start after now, cut a time away that ends after now at now, and clear `idleOpen` if its row went.
- Add `db.activity` to `guardTables`.
- Receipts already graded keep their attribution in `receiptInputs.context`, so replay is not affected.
- Test: after the probe's sequence, no activity remains after now.

### SEC-4 (LOW): what the paste flow says it keeps

**What happens.** The two screens describe less than Attest keeps:

- The form says Attest "keeps only the claims it finds, never the text" (`ActivityForm.tsx:30-31`).
- The preview lists every entry that is not a claim under "Not imported (n)", with "Nothing Attest checks." (`PastePreview.tsx:43-53`, `paste-labels.ts:90`).

Each of those entries' minutes is still stored as the agent's session ping (`paste.ts:220-233`). `paste-active.spec.ts:22-42` shows it: "Searched for flights to Denver" at 2:05 pm gives the 14:05 ping.

**Why it matters.** The minutes are derived facts and PRIVACY.md names them, so no content leaks. But the person confirms the import on a screen that says these entries are not imported. Those same minutes are the evidence that SEC-1 and SEC-2 turn into "likely <agent>".

**Fix.**

- Form: "keeps the actions it finds and the times of the log's entries, never the text".
- Preview: say how many entry times will be kept as times the agent was working. Label a timed entry that is not a claim "not a claim; its time is kept".
- A component test for each.

### SEC-5 (LOW): the privacy docs lag the code

1. `docs/privacy-architecture.md:193` (§5.6 `meta`) names `lastEvaluatedAt`, `clockHighWater`, `clockFloorAt`, `clockRepair.<ms>` and `purgeTrustedAt`. It does not name:
   - `lastImportAt.<agent>`, the instant of each paste (`claims-import.ts:41`);
   - `idleOpen`, the id of the open time away (`activity.ts:21`, `:59`).

   `tests/unit/docs/privacy-architecture.spec.ts` checks table fields, not meta keys, so it still passes.
2. `docs/privacy-architecture.md:100` says schema version 5. The ledger is version 6, as `migrations.ts` and §5.11 of the same doc say.
3. `PRIVACY.md:82` says turning away detection off "deletes every time away it kept". `forgetIdle` does delete the intervals. But FINAL UNASKED receipts keep the reason `unasked.idle` for 90 days, and so do their exported replay inputs (`userIdle` in `context.attribution.signals`). Each of those still says the person was away around that receipt's time.

**Fix.**

- Name both keys: the values are an instant and a SHA-256 id.
- Correct the version.
- Add one sentence about receipts already made.
- Have the doc test read the meta keys from one exported list.

### SEC-6 (LOW): catches with no log line

- `AwayDetection.tsx:22-24`: if `permissions.contains` fails, the page says away detection is off, which may be false, and nothing is logged.
- `AwayDetection.tsx:32-35` and `:41-43`: if a request or a removal throws or rejects, the page shows "Something went wrong" and nothing is logged.
- `use-paste-flow.ts:137-139`: a rejected import becomes "Could not import the claims. Try again." `importClaims` logs every failure except one, `BusError('invalid_outgoing')` (`send.ts:66`), and that one leaves no trace.

**Fix.**

- Add a `log.warn` with the error to each catch, with the events added to LOG_EVENTS.
- When `contains` fails, show "Attest could not tell whether away detection is on" instead of "off".

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Network grep finds only telemetry | PASS | The grep (`fetch(`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`) over `src` and `entrypoints` exits 1 with no match; telemetry is not written yet. The URL literals in source are the five host match patterns in `config.ts`. |
| Network-intercept E2E, allowlist empty | PASS | e2e.log of the main session's run: "the allowlist asserted here is the allowlist the extension ships" passed; the 5-minute session (side-panel paste included) logged 0 attributed requests and no violations; the negative control caught all 4 canaries. `E2E EXIT 0`, 50 passed. |
| No remote img, fonts or CDN | PASS | `entrypoints/*/index.html` load only `./main.tsx`. The only URL in the built CSS is Tailwind's licence comment. |
| No externally_connectable, webRequest or DNR | PASS | Built manifest (02:01, HEAD): permissions `storage, alarms, sidePanel`, optional `idle`, no `externally_connectable`, no `web_accessible_resources`. |
| Every Observation and Claim goes through redact | PASS | There is no new observation path. Claims go through no `redact.project` (it projects observations by source). They are built from captured fields only (`claims.ts:180-219`) and parsed by the strict `Claim` schema at four boundaries (`claims.ts:271`, `send.ts:65`, `listen.ts:178`, `repo.ts:174`). |
| Policy allowlist unchanged | PASS | `git diff 19697ef HEAD -- policy/` is empty. |
| Secret-seed E2E | PASS | e2e.log: no-leak @mandatory passed (14.7 s), pasting a log that holds every seed; its negative control passed. |
| Length caps | PASS | `subjectHint` is cut to 80 and `counterparty` to 320 (`claims.ts:130-168`), and the schemas cap both. The paste path makes no Requests, so no `textHint`. The fuzz probe ran 20,000 pastes: 0 breaches, 0 throws. |
| Export uses the redacted projection | PASS | `export.ts` writes strict schemas only. The new `activity` table holds instants and agent ids; the replay records hold coverage, grant, context and policy (derived). The doc gaps are SEC-5. |
| no-act lint, zero disables | PASS | `pnpm lint` exits 0. `eslint-disable` appears in none of the 74 files. `src/adapters/*.ts` are helper-fenced (no bus, no `wxt/browser`). |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | The grep finds only `.focus()` on Attest's own elements (`use-paste-flow.ts:129`, `ResetInstallIdControl.tsx:41-42`). |
| No tabs.create, tabs.update or executeScript | PASS | The grep is empty. |
| Permissions ⊆ allowed set | PASS | `storage, alarms, sidePanel`. Optional `idle` is justified in Decisions [3.14]. |
| host_permissions exact | PASS | Gmail and Calendar only. Agent hosts stay out while every reader is off (Decisions [3.0], [3.10]; PRIVACY.md 0.2). The sprint gate's "five hosts" goes to the founder as an amended gate. |
| Optional permission in a gesture, explained | PASS | `AwayDetection.tsx:31` calls `permissions.request` synchronously in the click handler, under a paragraph saying what is kept. |
| CSP | PASS | `script-src 'self'; object-src 'none'`, no unsafe-*. |
| No remote code | PASS | `new Function` appears only in a comment (`policy.ts:148`). The bundle grep is clean. Every entry imports `setup.ts` first (jitless Zod). |
| Page text never a selector, type, key or instruction | PASS | Pasted text is only matched against fixed patterns; the agent comes from a radio enum. Timings at the 100,000-character cap: worst 2.2 s (one-character lines), in the side panel only, so no ReDoS. |
| Model input | N/A | Sprint 5. |
| Bus messages Zod-parsed; unknown dropped and logged | PASS | `claims.import` is strict, its superRefine pins claims to `import.<agent>`, and it is accepted only from extension pages (`listen.ts:181`). `round-trip.spec.ts:208-236` covers the content-script drop and a malformed message. |
| Stored data parsed on read | PASS | `activity.ts` (`readRows`), `replay-records.ts`, `clock-repairs.ts` (`readRow`/`readRows`), and `IsoTs.safeParse` on meta instants. |
| Text nodes only | PASS | No `innerHTML`, `dangerouslySetInnerHTML`, `outerHTML` or `insertAdjacentHTML` in the 74 files. In the bundle they appear only in Preact's runtime. |
| Dexie version bump, migration tested | PASS | v5 (`receiptInputs`, `policies`) and v6 (`activity`). `migrations.spec.ts` pins version 6 and every table; the v3 and v4 upgrade specs open at the shipped version. |
| Encryption | N/A | Not built. |
| Wipe | N/A | Not built. Turning away detection off deletes the intervals (`idle.spec.ts`); see SEC-5 (3). |
| Install id | N/A | Unchanged. The new ids are hashes of agent and minute, or of an interval's start. |
| log.ts only, no PII | PASS | No `console.` in the 74 files. The new events and values are listed above. |
| No bare catch; every catch logs | GAP | SEC-6. |
| Telemetry-api | N/A | Not touched. |
| `pnpm audit --prod` | PASS | "No known vulnerabilities found". |
| New dependency logged | PASS | Only the Dependabot dev bumps (`@types/node`, `eslint`, `typescript-eslint`). |
| Vendor terms | PASS | Decisions [3.10]: four vendors, dated sections; the agent readers are off and no agent content script ships. |
| `onStartup` does only alarms | PASS | `background.ts:24-28`. The idle listener is registered in `main()`, with no ledger work. |
| `permissions.onRemoved` deletes idle data | PASS | `idle.ts:64-71`, tested in `idle.spec.ts`. The open-marker problem is SEC-1. |

## Probes (scratch, not committed)

All in `scratchpad/s3sec/`. Each runs the repository's own modules with tsx (fake-indexeddb for the ledger) and prints grades, instants and counts only.

- `paste-timing.ts`: `readPastedLog` on 30 adversarial pastes at the 100,000-character cap, timed.
- `paste-fuzz.ts`: 20,000 structured random pastes (fast-check, seed 20261009), checked for throws and cap breaches.
- `idle-stale.mts`: SEC-1, the interval.
- `idle-unasked.mts`: SEC-1, the false UNASKED, against a control day.
- `one-entry.mts`: SEC-2.
- `clock-activity.mts`: SEC-3.

## Commands run

- `git log --oneline 19697ef..HEAD`, `git diff --stat 19697ef HEAD`, `git diff 19697ef HEAD -- <each area>` → 25 commits, 175 files; `main` is 15 ahead of `origin/main`.
- `grep -rn "fetch(\|XMLHttpRequest\|navigator.sendBeacon\|WebSocket" src entrypoints` (from `extension/`) → no match.
- Over the 74 Sprint 3 source files: greps for `innerHTML|dangerouslySetInnerHTML|outerHTML|insertAdjacentHTML|document.write`, `.click(|.submit(|dispatchEvent|.focus(|.value =`, `eval(|new Function|import(`, `tabs.(create|update|query)|scripting|executeScript`, `eslint-disable` and `console.` → only the matches named in the checklist.
- The built manifest (two builds: 01:00, and the e2e run's 02:01 build of HEAD) printed. Every built script grepped for network, eval and Function → none.
- `pnpm audit --prod` (repo root) → "No known vulnerabilities found".
- `pnpm lint` (repo root) → exit 0: ESLint and Prettier clean, `check-docs: OK`.
- e2e: the main session's run, log read → 50 passed in 5.1 min, `E2E EXIT 0`; all four @mandatory tests passed.
- The six probes above.
