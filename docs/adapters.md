# Adapters and observers

**Who this is for:** whoever adds, repairs or reviews an Attest observer or adapter: the code that reads a vendor page the user has open and turns it into facts.
**What you'll know after:** the observer contract, what one pass posts and in what order, what every DEGRADED reason code means, how a page becomes a labelled, versioned fixture, and how to repair a selector that broke.

> Status: **v1.1** (Sprint 2, task 2.9; Sprint 3.0 adds [§10](#10-agent-adapters), the agent adapter skeleton and its claim patterns). It covers the three observers that ship in Sprint 2 (`gmail.sent`, `gmail.receipt`, `gcal.event`) and the fixture capture tool. The agent adapters (Muse, ChatGPT/Dots, Claude) arrive in Sprint 3 under the same contract (`build_spec.md` §7). **Every fixture so far is synthetic:** the founder's real captures are `BLOCKED(MANUAL)` ([`sprints/sprint_2.md`](../sprints/sprint_2.md) 2.1, 2.4), and the live smoke run (2.8) has not happened. So every accuracy figure in [`RESULTS.md`](../RESULTS.md) is measured on hand-built pages (its `gmailSentRealFixtures` row says so), and every DOM detail marked "best knowledge" below is still to be checked on a live page.

What and how the ledger stores what these observers send is in [`docs/privacy-architecture.md`](privacy-architecture.md). How a receipt is graded from it is in [`docs/grading.md`](grading.md).

## Contents

1. [What an observer cannot see](#1-what-an-observer-cannot-see)
2. [The observer contract](#2-the-observer-contract)
3. [One pass](#3-one-pass): what runs, what is posted and in what order, the acknowledgements, and when no coverage is posted by design
4. [Reading a DEGRADED reason](#4-reading-a-degraded-reason): every reason code
5. [`selectors.json` and versions](#5-selectorsjson-and-versions)
6. [The fixture loop: capture, label, test, version](#6-the-fixture-loop-capture-label-test-version)
7. [Repairing a broken selector](#7-repairing-a-broken-selector)
8. [The observers](#8-the-observers): `gmail.sent`, `gmail.receipt`, `gcal.event`
9. [Message bus](#9-message-bus)
10. [Agent adapters](#10-agent-adapters): the contract, one pass, how a sentence becomes a claim, and the skeleton's reasons

## 1. What an observer cannot see

Limitations first (Hard Rule 5: Attest never says "all clear" about something it could not see).

- **Only a tab the user has open** (Hard Rule 11). No Gmail API, no OAuth, no background tab, no scrolling the page for the user. A page Chrome prerenders is not read until the user opens it ([`base.ts`](../extension/src/observers/base.ts)).
- **Only the view the page draws.** Gmail and Calendar keep earlier views in the DOM, hidden. The Gmail Sent and Calendar observers read only the shown `role="main"` region; a hidden one is never read, and two shown ones are DEGRADED. The receipt observer is the exception ([§8.2](#82-gmailreceipt)).
- **Gmail Sent: only the head of the list vouches for a span.** The newest page (`#sent`, `Newer` off) writes coverage. Every older page gives evidence but no coverage, because in conversation view a send can be listed on an earlier page under a later reply's date ([§8.1](#81-gmailsent)).
- **Gmail Sent: a row that holds more than one message cannot be timed.** Its time is the newest message's, which may be a reply the user received. Such a row gives no row, and the head's window starts after it (grading contract v1.13), so a send inside a conversation is UNVERIFIABLE, never NOT FOUND; a mail composed as a draft first is told from a conversation by Gmail's message count (v1.15, [§8.1](#81-gmailsent)). How many rows a real list gives no row is measured in Sprint 6.4.
- **Receipts: only an opened message, and it vouches only for itself.** A receipt pass covers the instant of each message it parsed and nothing around it, so receipts never make a claim's coverage full: Attest never says NOT FOUND about a purchase ([`grading.md` §6.1](grading.md#61-conditions)). Only senders in the parser registry, or mail the generic rule accepts, are read.
- **Calendar: only whole visible days.** A day that hides events behind "N more" is not covered. A calendar switched off hides its events, and coverage then says so (`allCalendars: false`). A range longer than six weeks, a page in another time zone than the browser, and chip labels not in English are DEGRADED, not guessed.
- **Calendar: a first look cannot show what changed.** The first time Attest sees a range it can only report what is there. Changes (updated, deleted) are found by comparing two snapshots of the same range, so a change made before Attest first looked is never seen ([§8.3](#83-gcalevent)).
- **Who did it is never observed.** An observer records what happened in the user's own Gmail and Calendar. Whether an agent likely did it is grading's question, and the answer is always "likely" (Hard Rule 7, [`grading.md` §7](grading.md#7-unasked-attributionts)).

## 2. The observer contract

The contract is [`extension/src/observers/types.ts`](../extension/src/observers/types.ts). An observer is `build_spec.md` §7's `Adapter<RawRow>` plus what coverage needs. One observer reads one source and writes one coverage stream; a content script that reads two sources (Gmail's Sent list and an opened receipt) runs two observers.

| Member | What it is |
|---|---|
| `id`, `vendor`, `version` | Short tokens (`ComponentId`: letters, digits, `.`, `_`, `+`, `-`; no space, no `@`). `version` is the observer's `selectors.json` version ([§5](#5-selectorsjson-and-versions)). |
| `hosts` | Exact match patterns, a subset of `OBSERVER_HOSTS` in [`src/config.ts`](../extension/src/config.ts): `https://mail.google.com/*` or `https://calendar.google.com/*`. Never a wildcard (Hard Rule 8). |
| `source` | `gmail.sent`, `gmail.receipt` or `gcal.event`. |
| `health(doc, ctx)` | Runs first, every pass: OK; IDLE with 1 to 32 reason codes when the page is not one the observer reads (another Gmail folder, no conversation open: neither OK nor broken); or DEGRADED with 1 to 32 reason codes. IDLE and DEGRADED mean nothing is extracted and no coverage is written. `ctx` is the pass's (below); most observers read only the page, and the Calendar one times its run of busy passes with it, so the run goes on while the pass is DEGRADED `page.busy` ([§4.4](#44-gcalevent-reasons)). |
| `extract(doc, ctx)` | The raw rows the page shows (`RawRow`, below). Pure over the DOM. `ctx.observedAt` is the pass instant, `ctx.offsetAt` the browser's UTC offset function. |
| `account(doc)` | The signed-in account's address as the page shows it, or null. Only its hash leaves ([§2.2](#22-the-account-hash)). |
| `visibleWindow(doc, ctx)` or `visibleWindows(doc, ctx)` | Exactly one of the two. What the pass saw whole, as ISO 8601 instants with an offset. `visibleWindows` may answer `[]`: a clean pass that asserts no coverage by design. Null: the observer should know and cannot, so the pass is DEGRADED `window.unknown`. |
| `allCalendars(doc)` | `gcal.event` only: true when every calendar the page lists is shown. Null is DEGRADED `calendars.unknown`. |
| `snapshot(doc, ctx)` | `gcal.event` only: the range's snapshot ([`snapshot.ts`](../extension/src/observers/gcal/snapshot.ts)), or null while the grid is still drawing. |
| `attributes` (optional) | Every attribute a read of the page depends on: the ones its selectors match on (`selectorAttributes` in [`batch.ts`](../extension/src/observers/batch.ts)) and the ones it reads. The content script's one watcher observes only these and `class`, `hidden`, `style`; absent, every attribute is watched. Each Gmail and Calendar observer names its own, and a test changes every attribute it does not name on every fixture page and finds no read changed. |

`assertObserver` ([`base.ts`](../extension/src/observers/base.ts)) checks all of this when the content script starts, before any page is read, and throws `ObserverError('invalid_observer')` on a bad definition: a developer error fails loud.

Every member is pure over the DOM and read-only (Hard Rule 3): it reads attributes, text and computed style, and never writes the DOM, dispatches an event, focuses, scrolls, navigates or fetches. The lint rule `attest/no-act` covers all of `extension/src/observers/**` and `extension/entrypoints/content/**`, and [`tests/e2e/no-input-events.spec.ts`](../extension/tests/e2e/no-input-events.spec.ts) runs the shipped content scripts on the fixtures and records zero input events. Text on a vendor page is data: it never becomes a selector, a policy, a message type or an instruction (`agents/adapter_engineer.md` rule 6).

### 2.1 Raw rows and redaction

A `RawRow` is `{ type, rowKey?, fields }`. `type` must be one the policy reads from this observer's source (`policy.sourcesByType`); `rowKey` is the vendor's own row id when the page shows one; `fields` holds the row's content as plain own data properties.

`redact.project()` ([`src/core/redact.ts`](../extension/src/core/redact.ts)) turns a raw row into an `Observation`. It keeps only the fields `policy.allowlistedFields[source]` names ([`policy/default.json`](../policy/default.json)), computes `id`, `source`, `type`, `observedAt`, `rowKeyHash` and `contentHash` itself, and refuses a row whose allowlisted value fails its schema rather than cut or drop it. Anything else in `fields` never leaves the content script (Hard Rule 2). What each allowlisted field holds is described per source in [`docs/privacy-architecture.md` §4](privacy-architecture.md#4-the-policy-allowlists).

Two rules every extractor follows:

- **One line.** A counterparty, merchant or subject hint must be one line, or `project()` refuses the row (`redact.invalid_field`). Vendor cells wrap names and subjects, so extractors pass every name and subject through `oneLine()` ([`src/observers/text.ts`](../extension/src/observers/text.ts)) first, which collapses each run of white space to one space and trims the ends. Any other control character is kept, so the row is still refused: text holding one is not a name.
- **80 code points.** A subject hint is cut to its first 80 Unicode code points (`clampSubjectHint`; a surrogate pair is one code point and is never split). Every other string must already fit its cap, because a cut address or merchant would name someone else.

### 2.2 The account hash

Coverage belongs to one account, because grading counts accounts per source and checks them against the grant ([`grading.md` §6.1](grading.md#61-conditions)). The address never leaves the content script: `accountHashOf` ([`src/observers/account.ts`](../extension/src/observers/account.ts)) reads it through `normalize.email` (display name and angle brackets dropped), ASCII-lowercases it, and sends the SHA-256 of that text. So `Priya@Example.com` in Gmail and `priya@example.com` in Calendar are one account, while a lookalike address hashes as another.

- `account()` is read only when the pass has a window or a snapshot to post. A Sent page past the head, a Gmail list view and a Calendar page still drawing never turn DEGRADED because an account switcher was half drawn.
- Null (the page shows no account): coverage is sent without an account hash, and grading caps it at partial. Gmail Sent's `health()` requires the account, so that observer never sends account-less coverage.
- A value that is not one email address: DEGRADED `account.invalid`. A reader that throws: `account.threw`.

## 3. One pass

### 3.1 When a pass runs

A content script does little more than `startObservers(observers, { post: postAcked })`. The Gmail one starts its two observers together, so the tab has one MutationObserver, one activity tracker and one page-sync tracker for both; the Calendar one ([`gcal.content.ts`](../extension/entrypoints/content/gcal.content.ts)) also adds the hash of the account its pass read to that pass's `calendar.snapshot` ([`gcal/script.ts`](../extension/src/observers/gcal/script.ts)); the Calendar observer itself posts no rows of its own on a page whose account is known ([§8.3](#83-gcalevent)). The skeleton ([`base.ts`](../extension/src/observers/base.ts)) watches the page's DOM (the tree, the text, and only the attributes its observers read plus `class`, `hidden` and `style`, so a hover or focus change that touches only other attributes starts no pass; one that changes `class` or `tabindex` still does, and how often real pages are read is measured in Sprint 6.4) and runs a pass `OBSERVER_DEBOUNCE_MS` after the last mutation of a burst, never later than `OBSERVER_MAX_WAIT_MS` after its first (both in [`src/config.ts`](../extension/src/config.ts)). The first pass runs one debounce after start, or, on a prerendered page, one debounce after the user opens it. A visible Calendar tab is also read at least once a minute (`OBSERVER_HEARTBEAT_MS`) and again whenever it becomes visible, so a quiet tab's comparison base stays fresh ([§8.3](#83-gcalevent)); a hidden tab is read when its page changes, and once more when the page comes back online, resumes or wakes ([§3.5](#35-when-no-coverage-is-posted-by-design)); a Gmail tab has no heartbeat. Passes of one observer run one at a time ([`serial.ts`](../extension/src/observers/serial.ts)). The skeleton stops only when the extension context is gone (a post refused `context_invalidated`, or no runtime id), never on WXT's `ctx.onInvalidated`, which the page itself can fire.

### 3.2 What a pass decides

Each pass reads the clock once (`runPass` in [`base.ts`](../extension/src/observers/base.ts)): that instant is the pass instant. `planPass` ([`plan.ts`](../extension/src/observers/plan.ts)) then runs, over one synchronous read of the page, `health()` → `extract()` → `project()` on each row → the windows, `allCalendars()`, the snapshot and `account()` ([`coverage.ts`](../extension/src/observers/coverage.ts)). It never throws; every failure is a reason code. The result is one of:

| Plan | Health posted | Rows posted | Coverage posted |
|---|---|---|---|
| `OK` | OK | every row `project()` accepted | one `coverage.ping` per window, and the Calendar snapshot when the account is known |
| `OK_NO_COVERAGE` | OK | every row `project()` accepted | none, by design ([§3.5](#35-when-no-coverage-is-posted-by-design)); a Calendar snapshot is still posted when the account is known |
| `IDLE` | IDLE, with reasons: the page is not one the observer reads ([§4](#4-reading-a-degraded-reason)) | none | none |
| `DEGRADED` | DEGRADED, with reasons | every row `project()` accepted (none when `health()` or `extract()` failed) | none |

Every row goes through `project()`, and a row it refused does not stop the rows it accepted from being posted: they are evidence. It does void the pass's coverage, because a refused row is not evidence of absence (Hard Rule 5). The pass still reads its windows after a refusal, so the health report names every reason (`redact.missing_occurred_at` and `window.unknown` together, for example).

### 3.3 What a pass posts, in order

Each message is posted only after the service worker answered the previous one:

1. **`adapter.health`**: OK, IDLE or DEGRADED with reason codes, stamped with the observer's id, version and the pass instant. Every pass reports its health (Hard Rule 6); an IDLE pass posts nothing else.
2. **`observer.observations`**: the accepted rows, at most 500 per message, each with `observedAt` = the pass instant. Never `sightedAt`: only the ledger sets that ([`grading.md` §10](grading.md#10-ids-and-hashes-hashts)).
3. **`coverage.ping`**, one per window the pass saw, each naming the observer's `source`, the account hash, `lastSyncAt` = the pass instant, the window, `allCalendars` for Calendar, and `userActive` (whether the user pressed a key, pointed, scrolled or touched in the tab in the last minute; it feeds Sprint 3.5 activity, never coverage). An observer never sends `changesSince`: the ledger sets it ([§8.3](#83-gcalevent)).
4. **`calendar.snapshot`**: the Calendar observer's snapshot of the range it read, after the coverage, only for a clean pass whose account is known.

The content scripts post through `postAcked` ([`src/bus/send.ts`](../extension/src/bus/send.ts)), which rejects when the service worker answers `{ ok: false, code }` or the message never arrives. A rejected post ends the pass: nothing after it is sent, so coverage never follows rows that were not stored. If any message of the pass fails its bus schema (a bug), the pass posts only a DEGRADED `message.invalid` health report.

### 3.4 Acknowledgements

The service worker answers every `adapter.health`, `observer.observations`, `coverage.ping` and `calendar.snapshot` with a `BusAck` ([`src/bus/messages.ts`](../extension/src/bus/messages.ts)): `{ ok: true }` once it stored what the message carries, or `{ ok: false, code }` with one closed code.

| Code | When |
|---|---|
| `invalid_input` | A row the ledger refused (a field outside its source's allowlist, a self-chosen `contentHash`, a `sightedAt`, an unknown observer, a source the observer does not read); a ping that cannot be what it says (a Gmail window ending after its sync, a Sent window not ending at its sync, a receipt window wider than one instant, a Calendar window shorter than a day less an hour or longer than 42 days and an hour); a snapshot that disagrees with its own pass's pings; a health report naming an observer the extension does not have; and any observer message from a page that is not on that observer's site ([`sender-site.ts`](../extension/src/background/sender-site.ts): logged `observer.wrong_site`, and the named observer is not turned DEGRADED, since another site's page cannot vouch for its health either way). |
| `id_conflict` | A different fact under a `contentHash` the ledger already holds. |
| `late_sighting` | A sighting of a stored row earlier than the stored one (a second tab's pass that landed late); a Calendar snapshot read at or before the stored one of its range. |
| `refused` | Coverage, or a snapshot, of a pass whose rows were refused. |
| `clock_behind` | A row sighted, a ping synced, a snapshot read or a health report checked after the service worker's clock: the clock went back between the read and the answer. Nothing of the message is stored and the observer is not DEGRADED; its next pass is read on the clock as it is ([§3.6](#36-what-the-service-worker-does-with-a-pass)). Logged as a warning, `observer.clock_behind`. |
| `failed` | The service worker could not store it (the ledger did not open, or a bug such as a policy object `loadPolicy` did not return). Logged at error as `bus.handler_failed`. |
| `reader_off` | The person turned this observer's page reader off in the options page (sprint_4 4.5; [`src/background/readers.ts`](../extension/src/background/readers.ts)): a tab opened before keeps the script it had until it is reloaded. Nothing of the message is stored, the observer is not DEGRADED, and the content script stops its observers (`postAcked` rejects with `BusError('reader_off')`; [`src/observers/base.ts`](../extension/src/observers/base.ts)). Logged at debug, `observer.reader_off`. |

A Gmail message with several refusals reports the worst, in the order `invalid_input`, `id_conflict`, `late_sighting`. A Calendar pass, and a Calendar message from a page with no account, is stored all or none and answers the first refusal's code ([§3.6](#36-what-the-service-worker-does-with-a-pass)). A refused row turns the observer DEGRADED with a `ledger.<code>` reason ([§4.5](#45-reasons-the-service-worker-sets)); a late Calendar snapshot and a message answered `clock_behind` do not, because nothing is wrong with the page.

### 3.5 When no coverage is posted by design

These passes are healthy (OK, never DEGRADED) and post no coverage, because the page does not show a span Attest could vouch for:

- **A Sent page past the head of the list** (`#sent/p2`, or `Newer` enabled). Its rows are posted.
- **An opened conversation in which nothing parsed as a receipt.** `gmail.receipt` health is OK: it read the messages and nothing is wrong. A Gmail view with no conversation open is not read at all: `gmail.receipt` is IDLE `no_conversation` there, and `gmail.sent` is IDLE on every view that is not the Sent list ([§4](#4-reading-a-degraded-reason)).
- **A Calendar grid still drawing**: `aria-busy="true"` on the main region, on a shown grid in it, or on an ancestor of either, or a shown `role="progressbar"` inside the main region (one in the side panel does not count). Nothing is read: no rows, no window, no snapshot. The attribute change that ends the drawing triggers the next pass. A page that has looked busy through 5 minutes of passes is DEGRADED `page.busy` (§4.4) until a pass finds it drawn.
- **A Calendar page whose every visible day hides events behind its own "N more"**: no whole day was seen. Its snapshot is still posted, so the stored record knows those days were hidden.

In each case the observer's `visibleWindows()` answers `[]`. An answer of null is different: it means the observer should know what it saw and cannot, and the pass is DEGRADED `window.unknown`.

Separately, the skeleton posts no coverage for a page that is offline or catching up ([`lifecycle.ts`](../extension/src/observers/lifecycle.ts)): while the browser reports the page offline, and after it comes back (online again, resumed after the tab was frozen, shown again after 5 minutes hidden, or awake after the machine slept) for each observer's first pass and every pass within 30 seconds (`PAGE_RESYNC_MS`). Such a pass posts its health (OK) and its rows, but no coverage ping and no Calendar snapshot. When the 30 seconds are up the skeleton asks for a pass, so coverage resumes on a quiet page. A page that is online but cannot reach its server still reports itself online ([`attacks-that-work.md`](attacks-that-work.md)).

### 3.6 What the service worker does with a pass

The handlers are in [`src/background/observer-messages.ts`](../extension/src/background/observer-messages.ts), [`src/background/calendar-pass.ts`](../extension/src/background/calendar-pass.ts) and [`src/background/calendar-rows.ts`](../extension/src/background/calendar-rows.ts). One observer's messages are handled one at a time, in arrival order, whichever tab sent them. A ping is recorded as a coverage interval ([`src/ledger/coverage.ts`](../extension/src/ledger/coverage.ts)) and kept as the latest ping of its observer and account.

- **Gmail rows** of one message are stored in one readwrite transaction, with the clock guard, each through `upsertObservation(db, row, policy)`, which refuses any row `project()` could not have returned. A refusal is decided before the write, so one refused row does not stop the rest, but it does stop that pass's coverage. A health report that repeats the stored one is written again only once the stored one is a minute old (`OBSERVER_HEALTH_REFRESH_MS`).
- **A Calendar pass is stored all or none** ([`grading.md` §3](grading.md#3-inputs)). Its rows, the first-look marker of each first sighting (below), the snapshot record, its windows and the latest pings are written in one readwrite transaction (`inCalendarPass` in [`src/ledger/first-look.ts`](../extension/src/ledger/first-look.ts)). The first refusal aborts that transaction: nothing of the pass is stored, the pass is answered with that refusal's code, and the observer is DEGRADED. A worker stopped half way leaves nothing either. Then the range's stored snapshot record is dropped, so the next pass is a first look at a new instant ([§8.3](#83-gcalevent)).
- **Calendar passes with a known account** post no rows: the service worker derives them from the stored snapshot ([§8.3](#83-gcalevent)).
- **A Calendar page with no account** posts its rows itself, every one a first sighting. They are stored the same way, all or none, each with a marker that has no account. Its pings come after them and are recorded only if the rows were stored.
- **The clock.** A message is written at the service worker's clock, the one the content scripts read too ([`clock-guard.ts`](../extension/src/ledger/clock-guard.ts)). A row sighted, a ping synced or a snapshot read after that clock was read before the clock went back: nothing of the message is stored and it is answered `clock_behind`, so no coverage window, marker or snapshot record is ever stored with an instant after the clock that stored it. Before anything is stored, the service worker checks the clock against the latest instant the ledger stored (its high water: every new row's and claim's sighting, every window's sync, every snapshot record's read, every health report's check). If the clock is below it, the clock went back (a jump forward that came back, or a step back for good), and the ledger repairs itself in one transaction, logged once as `ledger.clock_regressed` with counts only:
  - every coverage window and marker synced after the clock is deleted, so it never vouches for hours its passes did not see, and no later pass is merged into it;
  - every latest ping synced after the clock is deleted;
  - an observer's own health report checked after the clock is deleted, and a DEGRADED the service worker set is stamped again at the clock, its reasons kept;
  - every Calendar snapshot record read after the clock is deleted, so its range's chain restarts;
  - every Calendar row first seen after the clock that no grading batch has read is deleted, so the next pass derives it again, first seen now, with its marker. A row a batch read stays as stored (replay needs it), and a sighting earlier than its stored one is then a no-op, never `late_sighting`: a jump forward no longer locks a range out until real time catches up;
  - the **clock floor** becomes that high water. No Calendar window is recorded as following changes from before it: a window whose `changesSince` is below it is recorded with `changesSince` at the floor, or without one while the pass was read before it. A chain that restarts after a step back therefore never says it followed changes from an instant earlier than one already stamped before the step (a claim, a pass).

**First-look markers.** A Calendar row carries no account and no pass. Without a marker, an event that was already on the calendar could sit inside a span that another view (another account, or the same account's other range) was following for changes. It would then read as a change Attest saw happen, and could be reported as UNASKED (Hard Rule 7). So the ledger stores every first sighting with a **first-look marker**, in the same transaction as the row. A first sighting is an event its pass could not compare with an earlier view: the first look at a range, a calendar switched on, a day that was hidden, an event that began before the visible range, or any row from a page with no account. A creation or an update that another range's stored view (any account) already held in its new state, read after this range's base and before this pass, is one too: the change happened before that read, not at this pass ([`calendar-seen.ts`](../extension/src/background/calendar-seen.ts)). So is a change **noticed late**: a creation or an update whose comparison base (the range's stored snapshot) was read more than the narrowest attribution window before this pass, and a deletion whose first absence was compared with such a base ([`calendar-step.ts`](../extension/src/background/calendar-step.ts) `staleChangeMs`: the smallest of `unasked.windows` `sessionMin`, `idleMin` and `adjacentMin`, two minutes under the shipped policy). Attribution reads a change's first sighting ([`grading.md` §7](grading.md#7-unasked-attributionts)); a change made at any time since an older base could lie outside the windows it reads there, and whoever was active when Attest looked again would be named for it. The marker is a `gcal.event` coverage entry:

| Field | Value |
|---|---|
| observer and account | those of the pass (none for a page without an account) |
| window | the row's `occurredAt`, a single instant |
| `lastSyncAt` and `changesSince` | the row's first sighting |
| `allCalendars` | true only if every calendar the pass listed was shown and named once |

The orphan rule's part (b) reads it as a view that found the row already there, so the row is never an orphan. This holds even when the pass's windows left out the event's day or its start, or when the pass recorded no window at all. A marker never makes a row an orphan through part (a), because it compared nothing before its own sync. It never makes coverage full either: a single instant never contains a claim window. A marker is never merged with a pass's window (in [`coverage-merge.ts`](../extension/src/ledger/coverage-merge.ts) it is a merge group of its own). Only a row the ledger inserted gets a marker: a re-sighting of a stored row changes nothing.

## 4. Reading a DEGRADED reason

Each observer's latest health report is one row of the `adapterHealth` table: `adapterId`, `version`, `status`, `reasons`, `checkedAt`. The popup banner that shows it arrives in Sprint 4. Until then, read it in the DevTools console of the extension's options page (an extension page may ask the service worker; a content script may not):

```js
chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'health.list' } }, (result) =>
  console.log(JSON.stringify(result.data, null, 2)),
);
```

A reason is a code, never page text (Hard Rules 2, 10). How to read one:

- **The user is somewhere else: IDLE, not DEGRADED.** `not_sent_folder` and `not_sent_list` mean the Sent list is not the view shown, and `no_conversation` that no conversation is open for the receipt reader. Nothing is broken, so the report is IDLE, and coverage is none (Hard Rule 5). The ledger stores an IDLE report where nothing is stored, over an IDLE, and over the report of its own tab (the tab moved off the page it reported, so that status no longer stands), never over another tab's report and never over a DEGRADED the service worker set. So a tab on another folder never replaces the status a Sent tab gave, OK or DEGRADED, a page that broke stays DEGRADED while other tabs show other folders (sprint_2 2.11: the live smoke's second Gmail tab flipped it), and a one-pass `view.mismatch` clears when its tab moves on (third review, QA-L8). The stored `checkedAt` is when a page the observer reads last reported, so the popup can say when Gmail Sent was last checked; after a service-worker restart no tab is known, and an IDLE replaces nothing but an IDLE until one reports.
- **The page changed.** `selector.missing.<landmark>` and `selector.ambiguous.<landmark>` name the landmark the observer could not find, or found twice. Several Calendar codes (`event.unreadable`, `range.invalid`) mean the same. Repair it ([§7](#7-repairing-a-broken-selector)).
- **The user's settings differ from what the observer reads.** `time_zone.mismatch`, `time_zone.ambiguous` and `range.too_long` (a year view) are fixed by changing a setting or the view, not the code.
- **A bug.** `*.threw`, `*.invalid`, `extract.foreign_type` and `message.invalid` mean the observer answered outside its contract. One exception: `account.invalid` on Calendar can also mean the account switcher's label ends with no address, which is the page changing.
- **The service worker refused what the pass sent.** `ledger.<code>`.

A DEGRADED pass writes no coverage, so whatever it could not see grades as UNVERIFIABLE, never as NOT FOUND.

### 4.1 Pass reasons

Any observer can give these ([`plan.ts`](../extension/src/observers/plan.ts) `PASS_REASONS`).

| Code | Meaning |
|---|---|
| `health.threw` | `health()` threw. A bug in the observer. |
| `health.invalid` | `health()` answered something that is not OK, or IDLE or DEGRADED with 1 to 32 reason codes (a sentence, page text). A bug. |
| `extract.threw` | `extract()` threw. For receipts: a message a parser claimed has a date that names no single minute (`ReceiptError('time_unresolved')`), so no time is guessed. For Calendar: the page changed between `health()` and `extract()`, or a stored snapshot is of another range (`GcalError`). |
| `extract.invalid` | `extract()` returned something that is not a list of raw rows. None of its rows is trusted. |
| `extract.foreign_type` | A row of a type the policy does not read from this observer's source (`policy.sourcesByType`). |
| `redact.invalid_field` | `project()` refused a row: an allowlisted value failed its schema (a name on two lines, a merchant over 120 characters, a number written as text), or was held by a getter or a prototype. |
| `redact.missing_occurred_at` | A row with no valid `occurredAt`. Gmail Sent: a row whose time names only a day (`Oct 1`), or a row that holds more than one message. |
| `redact.invalid_argument` | A bad source or row context (a `rowKey` that is not a string). A bug. |
| `redact.threw` | `project()` threw something other than its own `RedactError`. A bug. |
| `account.threw` | `account()` threw. |
| `account.invalid` | `account()` returned something that is not one email address (on Calendar, an account switcher whose label holds no address in brackets). |
| `window.threw` | The window reader threw. |
| `window.unknown` | The observer should know what it saw and cannot: a Sent head with a row whose time is unknown, or a Calendar page whose "N more" control sits in no day, so its layout is unknown. |
| `window.invalid` | A window that is not two ISO instants with an offset, or ends before it starts. |
| `window.future` | A Gmail window that ends after the pass instant. A list of what already happened cannot have been seen past the moment it was read. A receipt opened seconds after it arrived, on a device whose clock runs behind Google's, can show this until the next pass. |
| `calendars.threw` | `allCalendars()` threw. |
| `calendars.unknown` | The calendar list could not be read, so a calendar switched off could not be told from a deleted event. |
| `calendars.invalid` | `allCalendars()` answered something that is not true or false. |
| `snapshot.threw` | The Calendar snapshot reader threw. No coverage and no snapshot. |
| `message.invalid` | A message of this pass failed its bus schema. The pass posts only this health report. A bug. |

`clock.invalid` (the clock gave no ISO instant) is never posted: without an instant there is no health report to stamp. It appears only in the pass's own result, for tests.

### 4.2 `gmail.sent` reasons

From [`sent-page.ts`](../extension/src/observers/gmail/sent-page.ts) and [`health.ts`](../extension/src/observers/gmail/health.ts) (`SENT_HEALTH_REASONS`).

| Code | Meaning |
|---|---|
| `location.not_gmail` | The page address is not on `https://mail.google.com`. |
| `not_sent_folder` | IDLE: the view is not the Sent list (Drafts, Inbox, a label, a search, settings). |
| `not_sent_list` | IDLE: Sent with a conversation open, or the preview pane showing one. |
| `view.mismatch` | The route says Sent but the nav's selected folder or the document title names another folder: Gmail is between views and may still show the previous one, or the page changed so that a Sent list reads as another folder. DEGRADED, so one that lasts is loud (sprint_2 2.11; `not_sent_folder` before gmail.sent 1.4.0). |
| `selector.missing.main`, `selector.ambiguous.main` | No shown `role="main"`, or two. |
| `selector.missing.grid`, `selector.ambiguous.grid` | No shown `role="grid"` in it, or two. |
| `selector.missing.row` | The grid has no rows. An empty Sent folder cannot be told from a list still loading, so neither is read as "nothing sent". |
| `selector.missing.subject`, `selector.ambiguous.subject` | A row without one subject anchor carrying `data-legacy-last-message-id`, or with two. |
| `selector.missing.cell` | The subject anchor is not inside one of the row's grid cells. |
| `selector.missing.recipient` | No recipient element (`email` or `data-hovercard-id`) in a cell before the subject. |
| `selector.missing.time` | No element with a `title` or `aria-label` in a cell after the subject. |
| `row.recipient_invalid` | A recipient's `email` attribute (else `title`) is not an address. The markup changed; the observer does not guess which attribute is right. |
| `selector.missing.account`, `selector.ambiguous.account` | No account address in the banner, or two different ones (an account chooser is open). |

A row that cannot be read structurally makes the whole page DEGRADED: skipping it would report its send as absent (Hard Rule 5).

### 4.3 `gmail.receipt` reasons

From [`receipts/health.ts`](../extension/src/observers/gmail/receipts/health.ts) (`RECEIPT_HEALTH_REASONS`). Only an opened conversation is read, and only it can be DEGRADED; every other view is IDLE.

| Code | Meaning |
|---|---|
| `no_conversation` | IDLE: no conversation is open (a list, settings, anything else). Nothing to read, neither OK nor broken (sprint_2 2.11; OK before gmail.receipt 1.5.0). |
| `selector.missing.main` | The address names a conversation and the page shows no `role="main"`. |
| `selector.ambiguous.main` | A conversation is open and Gmail shows two `role="main"`: which one the user sees cannot be told. |
| `selector.missing.subject` | No subject heading (`h2[data-legacy-thread-id]`). |
| `selector.missing.message` | No message items (`role="listitem"` with `aria-expanded`; the message key `data-legacy-message-id` sits on the item or, as real Gmail draws it, on an element inside it). |
| `selector.missing.sender` | An expanded message without its sender element. |
| `selector.missing.date` | An expanded message without its date cell. |
| `selector.ambiguous.account` | A conversation is open and the banner names two different accounts (an account chooser is open): whose mail is the user's own, and whose coverage this is, cannot be told. |
| `receipt.amount_missing` | A platform parser recognises a receipt (its sender and subject kind) whose amount is required, and finds no total line. |
| `receipt.amount_ambiguous` | Lines with the chosen total label disagree. The total is not guessed. |

The generic parser never makes a pass DEGRADED: mail it does not accept is simply not a receipt, and so is a stranger's message whose display name, subject or amount a row could not carry, or whose date names no single minute.

### 4.4 `gcal.event` reasons

From [`gcal/read.ts`](../extension/src/observers/gcal/read.ts) (`GCAL_REASONS`). A Calendar page that is still drawing is OK and not read, until it has looked busy for too long (`page.busy`).

| Code | Meaning |
|---|---|
| `selector.missing.main`, `selector.ambiguous.main` | No shown `role="main"`, or two. |
| `selector.missing.grid` | No shown grid in it (the schedule view has none). |
| `selector.missing.calendar_list` | No calendar list in the side panel, so a calendar switched off could not be told from a deleted event. |
| `range.invalid` | No visible day, a day key that is not a date, or days that are not consecutive. |
| `range.too_long` | More than six weeks of days (a year view draws a grid per month and no events). |
| `time_zone.mismatch` | The page's `GMT-04`-style hint matches the browser's offset on none of the visible days. Calendar writes times in its own zone setting, and its daylight-saving rules are not on the page. Change Calendar's zone or the browser's. |
| `time_zone.ambiguous` | Two zone hints (Calendar's secondary time zone) and only one matches the browser. Labels are written in the primary zone, which the page does not mark. |
| `event.unreadable` | An event chip whose label is not in a shape the reader knows, whose chips disagree, that sits in no visible day, or whose label starts after every day its chips sit in. |
| `event.calendar_hidden` | A chip on a calendar the list says is off: the list cannot be trusted. |
| `event.time_ambiguous` | A start or end that a daylight-saving change skips or repeats. |
| `event.too_many` | More than 500 events (the chips of one event count once): more than one bus batch can carry. |
| `page.busy` | The page has looked busy (`aria-busy="true"`, or a progress bar in the main region) through 5 minutes of passes, none more than two minutes after the one before: nothing is read, and a page that never stops looking busy is never OK with no coverage (Hard Rule 6). A pass that finds the page drawn clears it. |

One unreadable chip makes the whole pass DEGRADED: no rows and no coverage. A refused chip is not evidence that an event is absent.

### 4.5 Reasons the service worker sets

When the ledger refuses a row a pass sent, or a Calendar pass holds an update back, the service worker turns that observer DEGRADED itself, with `ledger.<code>` reasons ([`src/ledger/health.ts`](../extension/src/ledger/health.ts)):

| Code | Meaning |
|---|---|
| `ledger.invalid_input` | A row, ping or snapshot the service worker refused as malformed or impossible ([§3.4](#34-acknowledgements)). |
| `ledger.id_conflict` | A row that differs from the stored row with the same `contentHash`. |
| `ledger.late_sighting` | A row sighted earlier than the stored copy of it. The stored row is unchanged: a batch may already have graded with it ([`grading.md` §10](grading.md#10-ids-and-hashes-hashts)). |
| `ledger.event_churn` | A Calendar event was updated more than 20 times in a day: its further `calendar.updated` rows that day were not stored. The pass's other rows, its snapshot and its windows (without `changesSince`) were stored, and it was answered `{ok: true}` ([`grading.md` §3](grading.md#3-inputs), *Update rows per event*). |

Such a report stays until a later pass of the same observer has a message fully stored with no refusal. An OK report from the observer in the meantime does not clear it, because its rows have not been accepted yet. A DEGRADED report from the observer is stored with the `ledger.*` reasons kept beside its own. A pass that posts only its health clears nothing.

## 5. `selectors.json` and versions

Each observer keeps every selector, attribute name and label word it reads in one versioned file, checked with strict Zod when its module loads:

- `gmail.sent`: [`extension/src/observers/gmail/selectors.json`](../extension/src/observers/gmail/selectors.json)
- `gmail.receipt`: [`extension/src/observers/gmail/receipts/selectors.json`](../extension/src/observers/gmail/receipts/selectors.json), which also holds the sender registry, the subject kinds and the total labels of each parser
- `gcal.event`: [`extension/src/observers/gcal/selectors.json`](../extension/src/observers/gcal/selectors.json)

Rules (`agents/adapter_engineer.md` rule 3):

- Selectors anchor on `role`, `aria-*`, `data-*`, text landmarks and structure. **Never a class name**: Gmail's are randomised and rotate. The synthetic fixtures give every file its own random classes. The `gmail.sent` tests also rewrite every class attribute on a page and expect an identical pass ([`sent-health.spec.ts`](../extension/tests/unit/observers/gmail/sent-health.spec.ts)), and the receipt tests build their pages with fresh random class names.
- **Bump `version` whenever the reader changes**: a selector, a pattern, or what a pass reports for a page (sprint_2 2.11 bumped both Gmail readers for IDLE). The observer's `version` is that value, so every health report and every observation message names it. A change to the `fixtures` list alone names no new reader and keeps the version (Decisions `[2.1]`, 2026-10-07).
- **Record the version with the fixture folder it was checked against** in `Decisions.md`, in the same change.
- Each `selectors.json` names its observer and the fixture folders its version was checked against (`fixtures`). A fixture's labels record, as `selectorsVersion`, the version of every observer that lists its folder, each written `<observer>@<version>`, sorted and separated by a space (`gmail.receipt@1.2.0 gmail.sent@1.1.0`: both Gmail observers read every Gmail page). [`fixture-selector-versions.spec.ts`](../extension/tests/unit/observers/fixture-selector-versions.spec.ts) fails when a label names another version.
- A Calendar snapshot carries the selectors version it was read under. A stored snapshot of another version is never compared with a new one: the first pass after an upgrade reports every event as a first sighting, no changes, and starts a new run of followed changes ([§8.3](#83-gcalevent)).

## 6. The fixture loop: capture, label, test, version

Every observer is written and tested against sanitised saved pages in `extension/tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/`, never against a live page (`agents/adapter_engineer.md` rule 1). The loop:

1. **Capture** the page from your own Chrome with `pnpm capture` ([§6.1](#61-start-a-capture-ready-chrome), [§6.2](#62-capture)).
2. **Review** the output yourself before committing it ([§6.3](#63-review-before-you-commit-founder-checklist), [§6.4](#64-what-the-sanitiser-cannot-catch)).
3. **Label** it: what the observer must produce from it ([§6.5](#65-label)).
4. **Test and measure**: the observer's tests, the label checks and the bench ([§6.6](#66-test-and-measure)).
5. **Version and record**: bump the selectors version and write the `Decisions.md` entry ([§6.7](#67-version-and-record)).

### 6.1 Start a capture-ready Chrome

The capture tool attaches to a Chrome you are already running, over the Chrome DevTools Protocol on `127.0.0.1`.

Chrome 136 and later refuse `--remote-debugging-port` on your default profile. Use a dedicated profile folder, and sign in to the vendor in it once:

```sh
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.attest-capture-profile"

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.attest-capture-profile"
```

Then, in that window:

1. Sign in to the vendor (first time only; the profile remembers it).
2. Open the exact page you want as a fixture, scrolled to what the observer needs.
3. Close any open compose window or draft. Text you are typing into an editor is part of the page and would be captured.
4. Close tabs you do not need. Fewer tabs means less chance of capturing the wrong one.

While the debugging port is open, any program on this machine can control that Chrome profile. Quit that Chrome when you are done capturing.

### 6.2 Capture

From the repo root (or from `extension/`):

```sh
# The first web page open in that Chrome
pnpm capture --vendor muse --name activity

# A specific tab, with the real names and free-text cells you know are on the page
pnpm capture --vendor gmail --name sent-list \
  --tab mail.google.com \
  --names "Priya Raman,Daniel Okafor" \
  --redact-selector '<css for the subject cell>' \
  --redact-selector '<css for the snippet cell>'
```

| Option | Default | What it does |
|---|---|---|
| `--vendor`, `--name` | required | Folder and file name. Lowercase letters, digits and `-` only. Observer fixtures go under `gmail` or `gcal`: the label checks read only those two folders. |
| `--tab <text>` | first web page | Capture the one tab whose URL contains `<text>`. Fails if none or several match. |
| `--names <a,b>` | none | Real names to replace everywhere, whole and word by word, in any case. |
| `--redact-selector <css>` | none | Replace the text and labels (`title`, `aria-label`, `alt`, …) of matching elements with fake phrases. Repeatable. |
| `--seed <secret>` | the capture key | Key for every fake value and for which secrets are injected; same key, same fixture. Left out, the capture key file is used (`~/.config/attest/capture-key`: 32 random bytes made on first use, owner-only, never printed or committed). A seed given here must be a secret of at least 32 characters: a public word is refused (security review SEC-L2). |
| `--date <yyyy-mm-dd>` | today (local) | The date folder. |
| `--cdp <url>` | `http://127.0.0.1:9222` | Must be on this machine. |
| `--out-root <dir>` | `extension/tests/fixtures/pages` | Where fixtures go. |
| `--keep-selector <css>` | none | Areas a redacted text is never replaced in elsewhere: a redacted text also replaces the same text anywhere on the page, which turns a hidden summary's dates into every row's date. Names, emails, amounts and addresses are still replaced inside. Repeatable. |
| `--force` | off | Overwrite an existing fixture and its `labels.json` entry. Without it the tool refuses. |

It writes `extension/tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/<name>.html` and adds an entry to `labels.json` beside it (other entries are left untouched):

```json
{ "<name>.html": { "capturedAt": "<yyyy-mm-dd>", "selectorsVersion": null, "seededSecrets": ["…", "…", "…"], "expected": [], "notes": "" } }
```

The tool prints the tab's address (without its query or fragment), the output path, and counts of what it replaced and removed. It never prints page content.

#### What the tool does to your browser

Nothing you can see. It attaches without Playwright's default overrides (no focus or media emulation), reads one tab, and disconnects without closing anything. In the page it reads the DOM and computed styles and builds the fixture from a copy in an inert document. The copy carries each element's critical computed styles inline (`display` and `visibility`, which every reader's shown-check uses, plus position, colours and flex or grid layout) and none of the page's own stylesheets: a real Gmail page carries about 4 MB of them, from which a test DOM takes over a second to compute one element's style (capture of 2026-10-06). It never clicks, types, scrolls, focuses, navigates or changes the live page. `tests/e2e/capture-tool.spec.ts` checks this on every run: the live page must be byte-identical afterwards, with zero DOM mutations, zero events and zero network requests.

#### What the sanitiser does

[`extension/tests/tools/sanitize.ts`](../extension/tests/tools/sanitize.ts):

- **Removes what runs or fetches:** scripts, `noscript`, frames, `object`/`embed`, `template`, `<base>`, every `<link>`, `meta http-equiv`, comments, every `on*` attribute, and `javascript:`/`vbscript:`/`data:text/html` URLs.
- **Removes every external resource:** `src`, `srcset`, `poster`, `background`, `ping`, `attributionsrc` and external SVG `href`s. Every image is dropped, including avatars and `data:` images, because a picture can be personal. In CSS, every `url(…)` except `#fragment` becomes `none`, as does every `image-set(…)` and every function whose name is written with an escape (`\75 rl(…)`), which Chrome still fetches. Every at-rule (`@import`, `@font-face`, `@media`, …) is dropped. The same `url(…)` rule applies to SVG attributes Chrome fetches from (`fill`, `stroke`, `mask`, `clip-path`, `marker-*`, `cursor`, …). The critical layout styles are already copied onto each element from the live page.
- **Drops session secrets:** the `value` of hidden inputs (CSRF and session tokens), `nonce` attributes, and `<meta name="csrf-token">`-style tags.
- **Removes tokens from URLs everywhere:** in links (`href`, `action`, `cite`, and the `data-saferedirecturl`, `data-url`, `data-href`, `data-link` attributes vendors keep links in) to the captured page's own host it keeps the path and a plain `#fragment` and drops `user:password@`. A link to any other host keeps only its scheme and host, read as Chrome reads it (backslashes, a single slash or a tab in the scheme change nothing), because another site's link carries what it is about in its path: Uber's compressed click links held the recipient's address, and Google Maps links the trip's addresses (capture of 2026-10-06). A link to the page's own host is kept as written only in a plain form (relative, or `https://`). Any other scheme keeps only its scheme (a `tel:` or `sms:` number, a `geo:` place), except `mailto:`, whose address is faked like any address; a link that does not parse is dropped. A web address written as text or in any other attribute is cut the same way (a referral link printed in a receipt), with or without its scheme (`meet.google.com/qrs-tuvw-xyz` keeps `meet.google.com/`); a namespace (`xmlns`) is left alone. In every link, text node and attribute value (other `data-*`, `<meta content>`, visible text, relative URLs) it drops query strings (`?token=…`, a bare `?session=…`, percent-encoded `%3Ftoken%3D…`) and any fragment that carries parameters (`#access_token=…`, the `?compose=…` of `#inbox?compose=…`).
- **Replaces personal data with seeded fakes:** emails (at `@example.com`, `@example.org` or `@example.net`), including accented ones and two forms a search for `@` cannot see: percent-encoded (`lena%40corp.io` in a search link) and inside base64 ids (Google Calendar event ids carry the calendar owner's address, sometimes short: `<name>@m` for a Gmail address, as in the capture of 2026-10-06), which are re-encoded with the fake, the short form kept. Also phone numbers, card numbers (groups of four, or Amex 4-6-5), money amounts (same currency and format), street addresses, `--names`, display names next to an email (`Name <email>`, `Name (email)` as in the account button, or `name`/`title`/`aria-label` on an element that carries an email), and `--redact-selector` text. The same real value always gets the same fake within one capture, so labels stay consistent.
- **Fakes the card endings, order numbers, codes and postal addresses a receipt labels** ([`capture-rows.ts`](../extension/tests/tools/capture-rows.ts); review of the receipt captures, 2026-10-07, where each of these was real in the output: a pattern sees one text at a time, and receipts put the words in one element and the value in the next). A text that is only a card's last 4 or 5 digits, in a table row that holds no other row and whose words or an image's alt text name a payment method, a card, a card brand or an ending (Stripe: `Payment method` | a card brand's logo, then a dash and the last four digits). Every word of 4 or more characters with a digit beside an order-number or code label (a shorter one is left, `Ticket 3 of 4`): in the value cells of a row whose first cell is the label (`Invoice number`), in the next element with text after any element whose whole text is the label (Instacart's `Copy code:` span, Spotify's `Invoice ID` row above its value), or after the label in the same text (a shop's `Code ABCDE12FG3HI`, `Order Confirmation #1ABCDEF`; values invented). An order number or code is faked in its own shape and the fake replaces it wherever it stands alone on the page, in text and attributes, also where a `<wbr>` splits it (Gmail breaks a long word with one). Every text of the element after an address label (`Shipping address`, `Billing address`, `Ship to`) becomes a neutral phrase: Shopify writes an Indian address there, which the street-address pattern does not know. Amounts written `Rs.` are faked like any amount. A Google Meet code (`abc-defg-hij`, the key to a meeting) is faked wherever a text or label names Meet.
- **Keeps receipt senders parseable (the registry-domain rule).** An address whose domain is in the receipt-parser registry (`RECEIPT_SENDER_DOMAINS`, from [`receipts/selectors.json`](../extension/src/observers/gmail/receipts/selectors.json): `stripe.com`, `amazon.com`, `facebookmail.com`, `opentable.com`, `instacart.com`, `uber.com`, `shopifyemail.com`) or a subdomain of one keeps its domain, with a fake local part: the parsers read only the domain, and a local part can name a person or carry a per-recipient token. A lookalike address (any non-ASCII code point) is never kept. The display name beside a kept address is kept only for a business sender at a registry domain that allows it (never `facebookmail.com`, which relays people's mail): a machine sender with a `+tag` (Stripe, Shopify: the name is the merchant the parser reads), or a name holding a registry brand token (`Amazon.com`, `Uber Receipts`). Every other name, a person who works at a registry domain included, is faked, and `--names` always wins.
- **Turns any other `@` into `＠`** (U+FF20, the full-width at sign), so a search for `@` finds only fake addresses and kept registry senders.
- **Fakes with a key.** Every fake is HMAC(key; kind, original) in the original's shape ([`capture-fakes.ts`](../extension/tests/tools/capture-fakes.ts), [`capture-key.ts`](../extension/tests/tools/capture-key.ts)). With the public seed the tool once defaulted to (`attest`), each fake was an unkeyed hash of its original: anyone with the repository could run candidates through the faker and recover a card ending, an amount or an order number, and confirm a guessed name or address (security review SEC-L2, 2026-10-08). The key stays outside the repository; the tool's own tests use fixed public seeds over invented values only.
- **Fakes what the rules above still let through** (SEC-L3, SEC-L4): an id after the other labels of one text (`Tracking number …`, `Booking reference: …`, `Membership ID …`, `Ticket number …`); on a Google Calendar page, every Meet-shaped code, also where nothing names Meet; every block of a postal address after its label, up to the next heading, label, table or amount (at most six); and every UUID in an attribute (a trip's map image is named after one), never in Gmail's `data-legacy-*` ids.
- **Keeps** `role`, `aria-*`, `data-*`, `id`, `class` and structure, because observers anchor on them (a UUID inside one is faked, above).
- **Injects three secrets** from `extension/tests/fixtures/secrets/seeded.json` as visible `data-attest-seeded` elements in the main landmark. The no-leak test checks they never reach storage, logs or exports.

### 6.3 Review before you commit (founder checklist)

From `agents/adapter_engineer.md`, plus two mechanical checks:

- [ ] Captured from a real session, by the founder, on the date in the folder name
- [ ] Sanitised: names, emails, amounts and subjects replaced by deterministic fakes; `seeded.json` values injected for the leak test (`seededSecrets` in `labels.json` lists which)
- [ ] A `labels.json` entry beside the HTML with the expected extraction output ([§6.5](#65-label))
- [ ] Vendor terms re-read on capture day, with a note in `Decisions.md`
- [ ] The `@` check: `grep -oE '@[A-Za-z0-9.-]+' <fixture>.html | sort -u` prints only `@example.com`, `@example.org`, `@example.net`, and receipt-sender domains of the registry above or their subdomains (`@stripe.com`, `@t.shopifyemail.com`). For every registry address, read the display name beside it: a person whose name happens to hold a brand token is kept, and only you can spot it.
- [ ] Opened from the fixture server and read top to bottom, with DevTools' Network tab showing nothing but `127.0.0.1`:

```sh
cd extension && pnpm exec tsx tests/tools/serve-fixtures.ts
# then open http://127.0.0.1:4173/<vendor>/<yyyy-mm-dd>/<name>.html
```

- [ ] No value read from the page (or from the sanitiser's output while a rule was missing) is written anywhere else: not in a test, a code comment, a doc, Decisions.md or a commit message. Describe it by kind and length, and give a test an invented value of the same shape (security review SEC-L1, 2026-10-08: card digits, receipt, invoice and order numbers, codes and two Meet codes had been copied from the receipt captures into the sanitiser's tests and docs; they were replaced, and the unpushed commits that held them were rewritten before anything was pushed).

If anything personal is left, re-capture with more `--names` or `--redact-selector` and `--force`. Do not hand-edit a fixture to fix it, because the next capture would bring it back.

**Re-faking a committed capture.** A capture faked with the public seed is re-faked without its originals by [`capture-refake.ts`](../extension/tests/tools/capture-refake.ts): the value rules run again over the committed page with the capture key, so every amount, card number or ending, phone number, street address, address block, labelled id or code, Meet code and attribute UUID becomes a keyed fake of its old fake, the same everywhere on the page. Emails, names and redacted phrases stay (their old fakes only confirm a guess), and so do the seeded secrets. `--also <value>` names a value no rule finds (a number whose label the capture already faked), and `--record <file>` writes what replaced what, outside the repository only (the old fakes in it are reversible). Then update the labels from the record and run the fixture tests:

```sh
cd extension && pnpm exec tsx tests/tools/capture-refake.ts --record "$TMPDIR/refake.json" <fixture.html>…
```

The synthetic `synthetic-*` files were written by hand, not captured, and keep the real sender addresses the receipt parsers match ([`extension/tests/fixtures/pages/README.md`](../extension/tests/fixtures/pages/README.md)). The `@` check applies to captures.

### 6.4 What the sanitiser cannot catch

It only finds what has a pattern, or what you tell it about. You have to read the output.

- **Names it was not told about** that do not sit next to an email: greetings ("Hi Daniel"), signatures, names inside subjects, snippets and message text. Learning "Daniel Okafor" from his address does not cover a lone "Daniel" elsewhere on the page. Pass names with `--names` (then every part is replaced everywhere), or cover the cell with `--redact-selector`.
- **Subjects, snippets, chat text and any other free text.** These have no pattern. Use `--redact-selector` on those cells.
- **Numbers without formatting:** a phone written `5415550187`, a card written `4111111111111111`, account and order numbers (but those a label names, above), national ID numbers, dates of birth. Formatted phone numbers and card numbers in groups (spaces or dashes) are caught.
- **Addresses that do not look like "number + street name + Street/Ave/Lane…"**: PO boxes, most non-US formats, or a city and postcode on their own.
- **Amounts without a currency symbol or code.**
- **Identifiers inside the page's own link paths or plain `#fragments`** (for example thread ids). Query strings and parameter fragments are dropped everywhere, and another host's link or written address keeps only its host; the page's own paths and plain fragments are kept. A token written into one of the page's own path segments (`/share/<token>/…`) is not recognised.
- **Data in other encodings:** emails that are hex-encoded, double percent-encoded or inside compressed or encrypted blobs, emails written in a non-Latin script (only their `@` is neutralised), and names or phone numbers inside any encoding (only plain, percent-encoded and base64 emails are decoded). Names inside CSS (`content: "…"`) are not replaced either.
- **A person's name beside a registry sender** when it holds a brand token (an employee called "Amazon Smith" at `amazon.com`).
- **Content it does not capture at all:** shadow DOM, iframes, and values typed into form fields. Text in an open editor is captured, so close drafts first.

It can also over-replace. A name it learned that is also an everyday word (a contact named "Mark" turns "Mark as read" into a fake name) is replaced everywhere. A one-word sender such as `Google <no-reply@google.com>` is only replaced inside its own element, so vendor names in the interface survive, unless the same word is also a redacted text: a `--redact-selector` text is replaced wherever else it appears, outside `--keep-selector` areas. In the captures of 2026-10-06 "Google", alone as a sender's name in Gmail's hidden row summaries (redacted), reads "Glade yonder" on every Gmail page, the account switcher's "Google Account:" included; no observer reads those words. If an observer needs interface text that was replaced, re-capture without that name in `--names`, or keep its area with `--keep-selector`, then check the output again.

### 6.5 Label

Write the page's entry in the `labels.json` beside it: the page facts (view, time zone, read instant, account, live URL), the health each observer must report, every observation it must produce, every coverage window it may report, and for Calendar the events and the expected diff. The format, the field rules and the coverage rules per source are in [`extension/tests/fixtures/pages/README.md`](../extension/tests/fixtures/pages/README.md); the schema is `extension/tests/unit/fixtures/fixture-labels.ts`.

Label from the page, never from the observer's output: the labels are what the accuracy numbers are measured against (Hard Rule 12).

### 6.6 Test and measure

```sh
cd extension && pnpm exec vitest run tests/unit/fixtures tests/unit/observers
pnpm bench
```

- `tests/unit/fixtures/fixture-labels.spec.ts` checks each label parses, binds to its page, holds its seeds, and is one `project()` returns unchanged. `tests/unit/fixtures/fixture-pages.spec.ts` re-reads every fact from the page with independent reference readers, so a label that drifts from its page fails.
- `tests/unit/observers/**` runs each observer over the fixtures and its adversarial cases.
- `pnpm bench` runs each observer over every labelled fixture (`bench/observers/gmail.ts`, `bench/observers/receipts.ts`, `bench/observers/gcal.ts`), writes `bench/results/*.json` and regenerates [`RESULTS.md`](../RESULTS.md). Never hand-edit either; quote `RESULTS.md` (Hard Rule 12).
- `pnpm e2e` builds the extension and runs its shipped content scripts on the fixtures in Chromium, including the export and no-leak checks.

### 6.7 Version and record

If the selectors or the reader changed: bump `version` in the observer's `selectors.json`, update the labels' `selectorsVersion`, and add one `Decisions.md` line naming the observer, the new version and the fixture folder it was checked against ([§5](#5-selectorsjson-and-versions)). Commit the fixture, its labels, the code, the regenerated results and the decision together.

### 6.8 Tests that cover the capture tool

- `extension/tests/unit/tools/sanitize.spec.ts`: every strip and neutralise rule, structure kept, seeds injected and visible, determinism, no network, and the final rule that every `@` belongs to a fake domain or a kept registry sender
- `extension/tests/unit/tools/capture-pii.spec.ts`: every personal-data class (including percent-encoded and base64-hidden emails, and card numbers), name learning, `--redact-selector`, kept registry senders, and how fakes are generated
- `extension/tests/unit/tools/capture-url.spec.ts`: query strings and parameter fragments removed from links, `data-*`, `<meta content>`, text and relative URLs; the inert window never runs a script
- `extension/tests/unit/tools/capture-css.spec.ts`, `capture-args.spec.ts`, `capture-output.spec.ts`: CSS neutraliser, command-line arguments, and `labels.json` handling
- `extension/tests/e2e/capture-tool.spec.ts`: a real Chromium over CDP. It checks the live page stays untouched, the fixture renders from the fixture server with zero outside requests, and the `pnpm capture` command works under `tsx`. Run it with `cd extension && pnpm exec playwright test tests/e2e/capture-tool.spec.ts` (no extension build needed).

## 7. Repairing a broken selector

Vendors change their pages. A selector that stops matching must show up as a DEGRADED report with a reason, never as a silent zero (Hard Rule 6). To repair one:

1. **Read the reason** ([§4](#4-reading-a-degraded-reason)). `selector.missing.<landmark>` names what the observer could not find. Make sure the cause is the page, not the user's view or settings.
2. **Capture the broken page** into a new date folder with `pnpm capture` ([§6.2](#62-capture)). Keep the old fixtures: they are regression cases for the old page, which some users will still see for a while.
3. **Label it** with the health and facts the observer should produce ([§6.5](#65-label)).
4. **Watch it fail**: run the observer's tests with the new fixture and see the reason you are fixing. A fix that never failed proves nothing.
5. **Fix `selectors.json`, or the reader if the structure changed.** Anchor on `role`, `aria-*`, `data-*` and structure only. When old and new pages must both be read, read both, and keep each fixture's expected result.
6. **Bump the version and record it** ([§6.7](#67-version-and-record)). Run `pnpm bench` and commit the regenerated results.

Never, to make a DEGRADED go away: anchor on a class name, skip a row that does not read, guess a time or an amount, widen a coverage window, or loosen `health()` so it passes a page the extractor cannot fully read. Each of these turns a loud failure into a silent wrong answer (Hard Rules 5, 6).

## 8. The observers

### 8.1 `gmail.sent`

[`src/observers/gmail/`](../extension/src/observers/gmail/): `sent-observer.ts`, `sent-page.ts`, `extract.ts`, `sent-time.ts`, `account.ts`, `route.ts`. Content script: [`gmail.content.ts`](../extension/entrypoints/content/gmail.content.ts).

**What it reads.** The Sent list, only when it is the view Gmail shows. Gmail's own route decides the view (the URL fragment from `doc.URL`: `#sent` is page 1, `#sent/p2` page 2, `#sent/<id>` an open conversation); the nav's selected folder and the document title can only refuse it (DEGRADED `view.mismatch`). Any other view is IDLE (`not_sent_folder`, `not_sent_list`): not a Sent list, so a second Gmail tab never flips the Sent tab's status. Then exactly one shown `role="main"` and one shown `role="grid"` in it. In each row: the subject anchor (`data-legacy-last-message-id`), the recipients in the cells before it (`email`, else `title`), and the time element in a cell after it. It never reads the snippet or the screen-reader summary of the row.

**Rows.** One `email.sent` row per recipient: `counterparty` (the address as read, case kept), `subjectHint` (one line, 80 code points; none for an empty subject or `(no subject)`) and `occurredAt`. The account's own mailbox is left out of the recipients in any spelling Gmail delivers to it (any case, a `+tag`, dots in a Gmail address; [`own-address.ts`](../extension/src/observers/own-address.ts)), as the Calendar reader leaves it out of guests, so it leaves the page only as a hash. A claim naming the account can then match no row, so a row that names the account narrows the window like a conversation row (below): such a claim is UNVERIFIABLE, never NOT FOUND (the first real Sent page held a send to the account; grading contract v1.14). `rowKey` is `data-legacy-last-message-id`, so the same row read on two pages is one observation and two identical sends stay two. Only the subject anchor and recipients a row shows are read: real Gmail repeats both in a summary it keeps hidden for screen readers (capture of 2026-10-06).

**Time.** The time element's `title` (absolute), else its `aria-label`, else its text, each resolved against the pass instant in the browser's zone; the first that reads as a time decides. Only a minute is a send time. A row is timed only when what the list shows says it holds one message: its last message is its last non-draft one (`data-legacy-last-message-id` = `data-legacy-last-non-draft-message-id`), Gmail shows no message count after its recipients (a shown element after the last recipient, in the recipients' cell, whose whole text is a count: `patterns.messageCount`), and either its thread id (`data-legacy-thread-id`) is that id too or the list draws counts at all (some row of it shows one). Gmail draws a count for every conversation of two messages or more, and a mail composed as a draft first keeps the draft's older id as its thread id, so on a list that draws counts a missing count says one message (live smoke of 2026-10-07: 51 of the 158 rows on the real Sent pages of 2026-10-06; `gmail.sent` 1.3.0). Any other row whose ids are all there is a conversation of several messages (a reply, a draft on it, a count beside it): it gives no row, because its time is its newest message's, and the coverage below starts after it. A count beside a row whose ids are one id contradicts them, and that row is not timed either. A list that draws no count anywhere is read by its ids alone. A row missing an id, or with one not in Gmail's legacy form (16 lowercase hex digits on every captured id; `patterns.legacyId` in selectors.json), is refused (DEGRADED), so a change of the ids' markup or form is loud.

**Coverage.** Only the head of the list (route page 1, no shown enabled `Newer` control) asserts a window, ending at the pass instant (`windowEnd = lastSyncAt`). It starts at the oldest row's minute only when the page provably ends the list (it shows an `Older` control and every one is disabled). While the list may go on (an enabled `Older`, or none seen), it starts one minute later: Gmail shows a send's minute only, so a send in that minute that is older than the oldest row is on the next page, where the pass never looked. The rows of that minute are still observations. The window also starts no earlier than one minute after the newest conversation row, and the newest row that names the account: the user's sends in them were made by then, and no claim can be matched to them (grading contracts v1.13, v1.14). A list whose shown minutes go up anywhere down the page vouches for no window (DEGRADED `window.unknown`): the window rests on the list being newest first. A head with no whole minute left asserts no window. Any other Sent page asserts none, by design. The service worker refuses a `gmail.sent` ping whose window does not end at its sync.

**Account.** The shared Google-account reader ([`google-account.ts`](../extension/src/observers/google-account.ts)), used by all three observers: the last `(<address>)` in a banner label, in any display language (a second signed-in account can carry a note after it: capture of 2026-10-06); two different addresses are `selector.ambiguous.account`. Required by `health()`.

**Known limits.** A send in a conversation of several messages is never an observation, and the window starts after the newest such conversation: on the first real Sent page that was 40 rows of 50, so a claim about a reply sent in a thread is UNVERIFIABLE, never NOT FOUND (Hard Rule 5). A list whose rows are all single mails composed as drafts first draws no count to tell them by: they read as conversations, so they give no row, never a wrong one. Gmail's second page can repeat rows of the first (capture of 2026-10-06: 30 of its 50 rows): a row read on two pages is one observation (`rowKey`), and a page past the head writes no coverage. While the list may go on, the head gives up its oldest row's minute: a claim about a send in that minute is not covered by that pass (UNVERIFIABLE on it alone, never NOT FOUND; Hard Rule 5). `Newer` and `Older` are found by their English labels: in another display language neither is seen, so the route alone decides the head and its window always starts a minute late. Confirmed on real pages (capture of 2026-10-06): `Older` carries `aria-disabled="true"` on the last page and on no other, the time span's `title` is the absolute time, and the message count is a shown sibling of the last recipient (repeated in the hidden summary, which is not read). The live smoke (2026-10-07) read the live Sent list OK, so the nav's selected-folder signal did not refuse it.

Measured by `bench/observers/gmail.ts`; the numbers are in [`RESULTS.md`](../RESULTS.md) under `gmail-sent`.

### 8.2 `gmail.receipt`

[`src/observers/gmail/receipts/`](../extension/src/observers/gmail/receipts/): `index.ts`, `message.ts`, `classify.ts`, `parser.ts`, `amounts.ts`, one file per parser. Same content script as `gmail.sent`.

**What it reads.** An opened conversation, in the one `role="main"` Gmail shows ([`shown.ts`](../extension/src/observers/shown.ts), the rule all three observers read with: a view Gmail keeps hidden is never read; two shown are `selector.ambiguous.main`): the address names a thread (read by [`route.ts`](../extension/src/observers/gmail/route.ts), so a compose window over it still names it), or a shown `role="main"` holds the subject heading or a message item. A message item is a `role="listitem"` with a message key (`data-legacy-message-id`) on it or, as real Gmail draws it, on an element inside it, or with `aria-expanded`; a list inside a message (attachment chips) has neither. Only expanded messages. Each message's sender decides its parser:

- a sender whose domain is in the registry (`stripe.com`, `amazon.com`, `facebookmail.com`, `opentable.com`, `instacart.com`, `uber.com`, `shopifyemail.com`, or a subdomain) is read only by that platform's parser, and only when its subject matches one of the platform's receipt kinds in `selectors.json`; its other mail (shipping notices, promotions, unpaid invoices) is ignored;
- any other sender goes to the generic parser, which needs all of: an order or receipt trigger (the sender address contains "order", or the subject says order, receipt or confirmation), a display name that is plain Latin text of at most 120 characters (no other script, no letter that can pass for an ASCII one, no invisible character: a look-alike "Аmazon" with a Cyrillic А is refused before the brand check), no refusal marker in the subject (reply or forward, promotions, cart reminders, unpaid or pending, shipping, refunds, returns, cancellations, updates), no registry brand in the sender's name or domain, an unambiguous amount on a total line, and a subject and amount a row can carry;
- mail from the signed-in account itself, a sender that is not one address, and a lookalike address (non-ASCII or `xn--`) get no parser. The display name never chooses a parser.

The body is read only for a message whose sender and subject already make it a receipt candidate, to find the total line and, for a kind that lists `refuseText`, the words that make it no receipt: Uber sends a charge summary under the trip's subject that says "This is not a payment receipt" before the trip receipt, and only the receipt is a purchase (gmail.receipt 1.4.0; the live smoke of 2026-10-07 had recorded both). Only the amount leaves the parser.

**Total lines.** A table row whose first cell with text is the label and whose other cells hold exactly one amount, or a one-cell line `<label>[:] <amount>`. A row that holds other rows is page layout, unless exactly two of its cells hold text: Stripe wraps each label in a table of its own beside its amount (`["", Total, "", $12.34, ""]`, the shape of the capture of 2026-10-07, amount invented; 1.4.0). An amount whose currency is ambiguous is not read (`Rs.` is the rupee of five countries: a Shopify order from India is `receipt.amount_missing`, Hard Rule 5).

**Rows.** One row per receipt message: `purchase.made`, `subscription.changed` or `listing.posted`, with `merchant`, `amountCents`, `currency`, `subjectHint` and `occurredAt` (the message's date, never a date in the body). `rowKey` is `data-legacy-message-id`, so two receipts threaded together stay two.

**Coverage.** One window per message a platform parser read (a registry sender), the single instant of its date (`windowStart = windowEnd`). It asserts only that this message was read. Two receipts dated in the same minute give one ping. A generic receipt (any other sender) posts none: anyone can send one, so it is evidence for a claim and never coverage, and a platform receipt dated in the same minute as a generic one of the same pass posts none either, so its point never holds the stranger's row. A list view, or a conversation with nothing parsed, asserts none. The service worker refuses a `gmail.receipt` ping wider than one instant.

**Account.** The shared Google-account reader, as for `gmail.sent`: any display language; two different addresses where a conversation is open are `selector.ambiguous.account`. The user's own mail (any case, a `+tag`, Gmail's dots) gets no parser. Without an address the ping carries no account hash, which grading caps, the platform parsers still match only registry domains, and the generic parser reads nothing, because the user's own message cannot be told apart and Gmail writes the account's address as its sender name. A list item inside a message (an email's own markup can carry `role` and `aria-expanded`) is part of that message, never a message of its own.

**Known limits.** Each message is read under its own conversation's subject heading. Rows carry no parser, so the point of a registry receipt read in another pass can still hold a generic receipt dated in the same minute and make it an orphan ([`attacks-that-work.md`](attacks-that-work.md)). A merchant whose display name is not plain Latin text is missed by the generic parser, never misread. A bare `$` is read as USD, so a non-US shop that writes a bare `$` through the generic parser is read in the wrong currency; only US storefront domains are in the registry. Subject kinds and total labels are English. A receipt opened within seconds of arriving, on a device whose clock runs behind Google's, reports `window.future` until the next pass.

Measured by `bench/observers/receipts.ts`; the numbers are in [`RESULTS.md`](../RESULTS.md) under `receipts`.

### 8.3 `gcal.event`

[`src/observers/gcal/`](../extension/src/observers/gcal/): `observer.ts`, `pass-read.ts` (one read of the page per pass), `read.ts`, `page.ts`, `label.ts`, `health.ts`, `extract.ts`, `pass.ts`, `script.ts`, `snapshot.ts`, `days.ts`, `diff.ts`. Content script: [`gcal.content.ts`](../extension/entrypoints/content/gcal.content.ts). Service worker side: [`calendar-pass.ts`](../extension/src/background/calendar-pass.ts), [`calendar-step.ts`](../extension/src/background/calendar-step.ts), [`calendar-own.ts`](../extension/src/background/calendar-own.ts), [`calendar-churn.ts`](../extension/src/background/calendar-churn.ts), [`calendar-window.ts`](../extension/src/background/calendar-window.ts), [`calendar-seen.ts`](../extension/src/background/calendar-seen.ts), [`calendar-rows.ts`](../extension/src/background/calendar-rows.ts). Ledger side: [`first-look.ts`](../extension/src/ledger/first-look.ts), [`coverage-merge.ts`](../extension/src/ledger/coverage-merge.ts), [`clock-guard.ts`](../extension/src/ledger/clock-guard.ts).

**What it reads.** The one shown `role="main"` and the shown grids in it, read together (a week may split into an all-day grid and a timed one): the visible days (`data-datekey`), the event chips (`role="button"` with `data-eventid`, or, in month view, an element with `data-eventid` around its button) and their accessible labels (start, end, title, calendar, guests), the "N more" controls, the calendar list in the side panel (`role="checkbox"` with `aria-checked`, or, as real Calendar draws it, native checkboxes read by their live ticked state; while one labelled list is drawn empty the page never says every calendar is shown), the page's `GMT±hh` zone hint, and the account. It never reads an event's location, conference details or response status into a field.

**The snapshot.** Each clean pass builds a snapshot of the visible range ([`snapshot.ts`](../extension/src/observers/gcal/snapshot.ts)): the days and whether each was seen whole, the calendars (as SHA-256 of their names) and whether each is shown, and per event its key (SHA-256 of `data-eventid`), its calendar's key, title, start, end, all-day flag, days, guest addresses (the account left out) and guest count. The service worker stores it in a smaller form: per event the first guest's address (a deletion's row names it) and, for every guest, only SHA-256 of the address, ASCII-lowercased, which is all a comparison needs ([`privacy-architecture.md` §5.4](privacy-architecture.md#54-calendarsnapshots)). Calendar's `data-eventid` itself never leaves the page: it is base64 of the event id and the calendar id, and a primary calendar's id is the owner's address.

**Who makes the rows.** A content script cannot read the ledger, so it never holds the range's previous snapshot.

- **Account known (the normal case):** the content script posts no rows of its own. It posts its health, its coverage pings and its snapshot (with the account hash), and the service worker derives every row from the step between the stored snapshot of that range and account and the new one. Otherwise every new tab would post each event as new, and an event edited while no Calendar tab was open would come back as a creation of its new state.
- **No account on the page:** nothing is compared. The pass posts every visible event as a first sighting, and coverage without an account, which grading caps. The service worker stores those rows all or none, each with a first-look marker that has no account ([§3.6](#36-what-the-service-worker-does-with-a-pass)).

**Rows.** One row per event, never one per guest. `subjectHint` is the title (none for `(No title)`), `occurredAt` the start (local midnight for an all-day event), `counterparty` one guest address: the first in ASCII-lowercase order with the account's own mailbox left out (any case, a `+tag`), or, for an update that added guests, the first one it added; none on a page that names no account, where the account could be any guest. The step from the stored record to a new snapshot gives:

- **first sightings**, as `calendar.created` rows: every event the stored snapshot could not have seen (the first look at a range, a calendar switched on, a day that was hidden behind "N more"). Each is stored with its first-look marker ([§3.6](#36-what-the-service-worker-does-with-a-pass)), so an event already on the calendar is never reported as UNASKED. This includes an event that began before the visible range or sits on a hidden day, which lies in none of the pass's windows. A creation or an update below is stored as a first sighting too when another range's stored view (a week and its month, or another account) already held the event in its new state, read after this range's stored snapshot and before this pass: the change happened before that read, so this pass is not when it was first seen, and an agent active at this pass must not be named for it. The view that saw it first reported it itself. A change noticed late is one too: a creation or an update compared with a stored snapshot read more than two minutes (the narrowest attribution window of the policy) before this pass, or a deletion whose first absence was compared with such a snapshot. It may have been made at any time since that snapshot, so this pass is no instant to name anyone at ([§3.6](#36-what-the-service-worker-does-with-a-pass));
- **`calendar.created`**: an event new on a calendar the stored snapshot showed and named once, when that snapshot saw every day of the range whole;
- **`calendar.updated`**: an event whose start, end, all-day flag, title, calendar or guest set changed;
- **`calendar.deleted`**: an event absent from **two consecutive complete snapshots** (a complete snapshot saw every day of its range whole and names each calendar once). The first absence is kept in the stored record as pending; the second confirms it, and the row is first seen at the first absence. The event coming back clears it. A snapshot that is not complete vouches for no absence.

**Coverage and `changesSince`.** One ping per run of whole visible days, from local midnight of its first day to local midnight after its last, with `allCalendars`. The service worker holds a pass's pings until its snapshot arrives (at most `CALENDAR_PASS_HOLD_MS` in [`src/config.ts`](../extension/src/config.ts)). Before it stores anything it checks the pings against the snapshot: a ping of another account, or a window outside the range or reaching a day the snapshot hid, refuses the whole pass (`invalid_input`, DEGRADED `ledger.invalid_input`). Otherwise it stores, in one readwrite transaction, the rows (each first sighting with its marker), the snapshot record and the windows, or nothing at all ([§3.6](#36-what-the-service-worker-does-with-a-pass)). It sets `changesSince`, which grading reads to decide whether a change claim was fully covered and whether a row can accuse an agent ([`grading.md` §3](grading.md#3-inputs), [§6.1](grading.md#61-conditions)):

| The pass | Its windows are recorded |
|---|---|
| complete, nothing pending | with `changesSince` = the first `readAt` of the unbroken run of complete snapshots of this range, account, selectors version and shown calendars (a first look starts a run at its own instant) |
| complete, an absence waiting for confirmation | not at all: no batch may read "every change was seen" while a deletion is unreported (its first sightings still get their markers) |
| not complete (a hidden day, a calendar named twice) | without `changesSince`: it covers what was there, not what changed |

After the clock went back, no window follows changes from before the clock floor ([§3.6](#36-what-the-service-worker-does-with-a-pass)): a `changesSince` below it is raised to it, and a pass read before it records its windows without `changesSince`.

A snapshot read at or before the stored one of its range (another tab's pass that landed late) is skipped: `late_sighting`, no coverage, not DEGRADED.

The ledger unites two Calendar windows only when they synced at one instant, or the earlier-synced window lies inside the later-synced one ([`coverage-merge.ts`](../extension/src/ledger/coverage-merge.ts)). Grading counts a Calendar entry towards a calendar claim's full coverage only if it synced after the claim's grace, so a union that carried a newer week's sync over an older week would say a day was seen later than it was: a false NOT_FOUND for an event created there in between.

**When a range's chain restarts.** The range's next pass is a first look (every event a first sighting with a marker, its windows following changes from that pass on, or from the clock floor) in two cases:

- **A record read after the service worker's clock.** The clock jumped forward and then back, or stepped back for good. The clock guard deletes the record with everything else stored after the clock, and logs `ledger.clock_regressed` ([§3.6](#36-what-the-service-worker-does-with-a-pass)). Without it, every pass of the range would be skipped as late until real time passed that instant, or a window synced in the future would vouch for hours nobody looked.
- **A refused pass.** The service worker drops the range's record and logs `observer.calendar_restarted`, reason `refused`. Without the restart, a row derived again from the same record by every pass would refuse every later pass. One such row is a deletion that another range's chain stored first, under a later first sighting.

A restart loses only what the dropped record was waiting for. A deletion that was pending is not reported, and changes since the last stored pass come back as first sightings: a missed UNASKED, never a false one. A row first seen while the clock was ahead is deleted and derived again unless a grading batch already read it; one a batch read keeps its first sighting, its earlier re-sightings change nothing, and the clock floor keeps it from reading as a change any later window followed.

**Known limits.** The week grid's event labels never list guests (live smoke and the invitation week of 2026-10-07: "2pm to 2:30pm, Attest invite test, <calendar>, Needs RSVP, No location, October 8, 2026"), so no Calendar row names a counterparty: a calendar claim is matched on its title and time, never on a guest. A month view that shows an event is DEGRADED `event.unreadable` for now: real Calendar draws a month's events outside the day cells, naming each day only through a heading's text, so the reader cannot place them on their days yet (a month with no event is read); an event id the page shows that no chip reads always makes the pass DEGRADED rather than leaving the event out while a window vouches for its day (capture of 2026-10-06). The side panel's calendar lists fill in seconds after the grid, and only while the tab is shown; until then the page reads as still drawing (OK, no coverage). Chip labels are read in English only. The browser's zone must match Calendar's. An event moved from one visible range to another is a creation in one and, after two absences, a deletion in the other, never an update: snapshots are stored per range. Rows carry no account, so a real change first seen at the same instant as a first sighting whose event starts at the same instant is blocked by that sighting's marker. That is a missed UNASKED, never a false one. A change compared with a snapshot read more than two minutes earlier is a first sighting and never UNASKED. Since v1.12 every Calendar change is stored as a first sighting with its marker, so no Calendar row is UNASKED until real pages show which facts say the account organises an event and owns its calendar (Sprint 6.4: the live smoke of 2026-10-07 could not read them, the week grid's labels name no guest) ([`grading.md` §3](grading.md#3-inputs), *Changes the account did not make*). A visible Calendar tab is read at least once a minute (`OBSERVER_HEARTBEAT_MS`, [§3.1](#31-when-a-pass-runs)) and again when it becomes visible; a hidden tab is read only when its page changes, so a change pushed to a tab hidden for longer than two minutes is a first sighting: once Calendar UNASKED returns, a missed one, never a false one. Within two minutes a change is anchored at the pass that reports it. A page with no account stores no snapshot, so its earlier sighting of a new state does not move a change to a first sighting. The clock: a jump forward that came back before anything was stored and before any batch ran leaves instants that are no longer in the future when next looked at, and the wall clock alone cannot tell them from real ones; a grading batch must run the clock guard before it records its instant (Sprint 3.6). A Calendar pass refused for several rows answers only the first refusal's code, because the transaction stops there. A location that contains the text `, Guests:` can feed the guest reader; this is open for the red team (Sprint 6). The live smoke (2026-10-07) found `aria-busy` cleared once a week was drawn: no `page.busy` stayed (a page that kept it is DEGRADED `page.busy` after 5 minutes of passes). A collapsed "My calendars" section was not captured (Sprint 6.4): if collapsing removes its checkboxes from the DOM, a calendar switched off there would be unlisted and `allCalendars` would read true. Calendar has no IDLE yet (sprint_2 2.11 gave one to both Gmail readers): a tab on a view the reader does not read (settings, a search) is DEGRADED `selector.missing.*`, and month view is DEGRADED `event.unreadable`, so beside a week tab the stored `gcal.event` health follows whichever tab posted last. Telling those views apart needs captures of them (Sprint 6.4).

Measured by `bench/observers/gcal.ts`; the numbers are in [`RESULTS.md`](../RESULTS.md) under `gcal`.

## 9. Message bus

Content scripts never touch the ledger. They post derived facts to the service worker over the typed bus in `extension/src/bus/` (`send`, `sendChecked`, `postAcked`, `query`, `listen`), and nothing else may call `runtime.sendMessage`, `onMessage`, `tabs.sendMessage` or `connect` (lint fence). Every message is one member of the Zod union in `src/bus/messages.ts`: strict objects, every string and array length-capped (`SCHEMA_LIMITS` in `src/core/schema.ts`). `send()` refuses an invalid message before it leaves; `listen()` parses on receipt and drops anything else.

| Type | Sender | Receiver | Payload | Response |
|---|---|---|---|---|
| `adapter.health` | content script (adapter or observer) | service worker | `health`: `AdapterHealth` (id and version as `ComponentId` tokens, OK, IDLE or DEGRADED, reason codes such as `selector.missing.row` (never page text), checkedAt) | `BusAck`: `{ ok: true }` once stored (sprint_2 2.7); `invalid_input` for an observer the extension does not have or a page on another site; `clock_behind` for a report checked after the service worker's clock |
| `adapter.claims` | content script (agent adapter) | service worker | `adapterId`, `version`, `requests`: `Request[]`, `claims`: `Claim[]` (at most 500 each) | acknowledgement |
| `adapter.scope` | content script (agent adapter, on a settings page) | service worker | `adapterId`, `version`, `snapshot`: `ScopeSnapshot` (`agent`; `scopes`, as the page names them, one line each, at most 200 of 120 code units; `observedAt`) | acknowledgement; Sprint 3.7 sets the agent's `observedScopes` from it |
| `observer.observations` | content script (Gmail or Calendar observer) | service worker | `observerId`, `version`, `observations`: `Observation[]` (at most 500) | `BusAck`: `{ ok: true }` when every row was stored, else `{ ok: false, code }`: for Gmail rows the worst of `invalid_input`, `id_conflict`, `late_sighting`; Calendar rows are stored all or none, each first sighting with its first-look marker, and a refusal answers the first refused row's code; `clock_behind` when a row was sighted after the service worker's clock (nothing stored, not DEGRADED) |
| `coverage.ping` | content script (observer) | service worker | `ping`: `CoveragePing` (observer id, source, account hash, sync time, window, `allCalendars` for Calendar, user active; never `changesSince`). A Sent window must end at its sync, a receipt window is one instant, and a Calendar window must span from a day less an hour to 42 days and an hour, and, with an account, lie on whole days of its pass's snapshot. | `BusAck` (`refused` for a pass whose rows were refused, `invalid_input` for a window the observer cannot have seen or a page on another site, `clock_behind` for one synced after the service worker's clock) |
| `calendar.snapshot` | content script (Calendar observer) | service worker | `observerId`, `snapshot`: `CalendarSnapshot` (`src/observers/gcal/snapshot.ts`), `accountHash?` (the hash of the page's account, added by the Calendar content script) | `BusAck` (`late_sighting` for a snapshot read at or before the stored one, not DEGRADED; `invalid_input` for one that disagrees with its pass's pings; `refused` for one whose pass had a refused row; `clock_behind` for one read after the service worker's clock, not DEGRADED) |
| `ui.query` | extension page only (popup, side panel, options) | service worker | `query`: `{ kind: 'ledger.export' }` or `{ kind: 'health.list' }` | a `ui.result` of the same kind |
| `ui.result` | service worker | the page that asked (as its response) | `kind` and `ok: true` with `data`, or `ok: false` with `error` (`unknown_query`, `handler_failed`, `unavailable`) | none |
| `ledger.changed` | service worker | open extension pages | `tables` (1 to 11 ledger table names), `at` | acknowledgement; nobody listening is normal |
| `claims.import` | extension page only (the side panel's Add agent activity, sprint_3 3.13) | service worker | `agent`, `claims`: `Claim[]` (1 to 500), each one the paste parser read for that agent (extractor `import.<agent>`, an activity view, no request); `activeAt` (at most 10,000 instants): the minutes the log's timed entries name, stored as the agent's session pings (sprint_3 3.14); never the pasted text ([`claims-import.md`](claims-import.md)) | `{ ok: true, received, added }` once every claim is stored and a grading batch has run (`added`: the claims that were new, so a log pasted twice adds 0), or `{ ok: false, code }` (`id_conflict`, `invalid_input`, `failed`) |
| `receipt.event` | extension page only (the side panel's receipt detail, sprint_4 4.3) | service worker | `receiptId`; `event`: `{ kind: 'override', grade, reason }` (`VERIFIED` or `NOT_FOUND`, and the person's reason, at most 120 characters with at least one visible, stored on the receipt and never logged) or `{ kind: 'revert' }` ([`grading.md`](grading.md) §8; `src/ledger/user-events.ts`) | `{ ok: true }` once the event is stored, stamped inside the transaction that writes it, or `{ ok: false, code }` (`not_found`, `refused` when the state machine refuses it, `evidence_taken` for a revert whose evidence another claim's receipt now holds, `failed`) |
| `grant.save` | extension page only (the options page's Grants, sprint_4 4.4) | service worker | `grant`: what a person chose for one agent (`GrantChoices`: allowed actions, recipient domains or addresses, spend ceiling with its currency, declared access), never what Attest observed (`observedScopes`, `accounts`) nor a stamp, which the schema refuses; `alertsMuted`: whether that agent's alerts are muted. The service worker keeps what Attest observed from the stored grant and stamps `updatedAt` on its own clock, after the last grading batch | `{ ok: true }` once the grant is stored and a grading batch has regraded the agent's open receipts under it (a FINAL receipt never changes), or `{ ok: false, code }` (`invalid_input`, `failed`) |
| `retention.save` | extension page only (the options page's Privacy, sprint_4 4.5) | service worker | `days`: 30, 90 or 180 (`RETENTION_CHOICES`), how long Attest keeps dated history. Stored in ledger meta `retentionDays`; the daily purge reads it | `{ ok: true }` once stored, or `{ ok: false, code: 'failed' }` |
| `reader.toggle` | extension page only (the options page's Adapters, sprint_4 4.5) | service worker | `reader`: `gmail` or `gcal` (`READERS`); `on`. The choice is kept in `chrome.storage.local` (`attest.readersOff`), and the reader's content script is registered or unregistered at once (`chrome.scripting`) | `{ ok: true }` once the choice is stored and the registrations follow it, or `{ ok: false, code: 'failed' }` |
| `ledger.wipe` | extension page only (the options page's Danger zone, sprint_4 4.5, asked twice) | service worker | nothing. The service worker deletes the ledger's database and clears `chrome.storage.local` | `{ ok: true }` once both are empty (every table then announced changed), or `{ ok: false, code: 'failed' }` |

Since Sprint 2.7 the service worker also handles the four observer messages (`src/background/observer-messages.ts`, `src/background/calendar-pass.ts`) and answers each with a `BusAck`. A content script posts through `postAcked` (`src/bus/send.ts`), which rejects on `{ ok: false }` or a transport failure, so the observer stops the pass and never posts coverage after a refused row. A DEGRADED the service worker sets (reasons `ledger.<code>`) stays until a later clean pass of the same observer is fully accepted. Adapters (3.6) add their handlers there.

**Drops** (`bus.dropped`, logged with the reason and, when it is one of ours, the type; never the payload): `foreign_sender` (not this extension, or an orphaned context), `malformed` (fails the schema, unknown types included), `untrusted_context` (`ui.query`, `claims.import`, `receipt.event`, `grant.save`, `retention.save`, `reader.toggle` or `ledger.wipe` from a content script), each a warning; `no_handler` (this context does not handle that type, routine wherever several pages listen), at debug.

**Send failures** (`bus.send_failed`, the message resolves `undefined`): `no_receiver`, `port_closed`, `context_invalidated`, `send_failed`, each a warning, except `no_receiver` for a broadcast (`ledger.changed`), which is expected when no page is open and logged at debug. An invalid outgoing message is never sent: `send()` rejects with `BusError('invalid_outgoing')`. `sendChecked()` (acknowledged messages) never resolves `undefined`: it rejects with the transport code, or `invalid_reply` when the answer is not a `BusAck`; `postAcked()` also rejects with `refused` on `{ ok: false }` (logged at debug as `bus.refused`).

## 10. Agent adapters

Sprint 3.0 adds the skeleton every Muse, ChatGPT/Dots and Claude adapter runs ([`src/adapters/base.ts`](../extension/src/adapters/base.ts)) and the tables that read an agent's sentences ([`src/adapters/patterns.ts`](../extension/src/adapters/patterns.ts)). **Every agent reader is off** (`AGENT_READERS` in [`src/config.ts`](../extension/src/config.ts); Decisions [3.10]): Meta's, OpenAI's and Anthropic's terms forbid collecting data from their sites by automated means, so no agent host is in the manifest and no agent content script ships, and the options page says why. The Muse adapter ([`src/adapters/muse/`](../extension/src/adapters/muse/)) is kept, tested on the hand-built pages of `tests/fixtures/pages/muse/`, for the day Meta permits it; its host is known (`https://muse.ai/*`). Agent pages are captured by hand (Chrome's Save Page), never by driving the browser. An agent page gives Requests (what the user asked), Claims (what the agent says it did) and, on a settings page, a scope snapshot (what the agent may reach). It gives no Observations and no coverage: those come only from the observers.

### 10.1 The contract

| Member | Rule |
|---|---|
| `id`, `vendor`, `version` | `ComponentId` tokens, as an observer's ([§2](#2-the-observer-contract)). |
| `agent` | `muse`, `chatgpt`, `dots` or `claude`. |
| `hosts` | Exact match patterns of that agent in `AGENT_HOSTS` ([`src/config.ts`](../extension/src/config.ts)); Dots runs on ChatGPT's. A host enters the manifest only with the content script that reads it, and only while its reader is on (`AGENT_READERS`): none is (Hard Rule 8; Decisions [3.10]). |
| `health(doc, ctx)` | As an observer's: OK, IDLE or DEGRADED with reason codes, never page text. |
| `extract(doc, ctx)` | One `AgentRead` ([`types.ts`](../extension/src/adapters/types.ts)): the conversation's vendor id or null, its turns (`role`, `text`, `time` as the page shows it, optional `rowKey`), the activity entries (`text`, `time`, optional `rowKey`), and a settings page's `scopes` (null on any other page). Pure over the DOM: if a claim is not rendered, it is not read. |
| `attributes` (optional) | As an observer's. |

### 10.2 One pass

The skeleton runs on the observer skeleton's loop (`startPasses` in [`src/observers/base.ts`](../extension/src/observers/base.ts)): the same batching, prerender rule and stop when the extension is gone ([§3.1](#31-when-a-pass-runs)). Each pass reads the clock once and posts, one message at a time and each after the last was answered: `adapter.health`; then `adapter.claims`, at most 500 Requests and 500 Claims per message, none when the page holds neither; then, on a settings page whose pass was clean, `adapter.scope`, each scope one line and once. A post that rejects ends the pass.

What becomes what ([`claims.ts`](../extension/src/adapters/claims.ts)):

- A user turn is a Request: the SHA-256 of its one-line text, a hint of its first 200 code units, and its time, with the id [`docs/grading.md`](grading.md) §10 defines. A page without a conversation id gives no Requests.
- Each sentence of an agent turn (`sourceKind: chat`) and each activity entry (`activity_view`) that the pattern tables read as a claim is a Claim, linked to the conversation's last Request before it. Its `rawHash` and id are §10's, so a sentence re-rendered is one claim and the same words at another time are another.
- A turn's time is the page's: an ISO 8601 instant, written again in the user's offset, or vendor-relative text ("2:03 PM", "Yesterday") resolved against the pass instant. A turn whose time is missing, unreadable or after the pass gives nothing: a claim at a guessed time could end NOT_FOUND (Hard Rule 5). The pass is then DEGRADED `time.unknown` and still posts what it did read.
- A claim's counterparty is the address its sentence names, else the capitalised words of a name; its subject hint is a quoted or captured subject, at most 80 code units; its amount comes from core `amount()`, and a bare `$` keeps its cents and no currency (the grant's `spendCurrency` reads it). A calendar claim has no `targetAt` until a vendor adapter reads the event's own time, so it grades `no_target` until then.

### 10.3 How a sentence becomes a claim

`classify(agent, sentence)` holds one sentence to the agent's table ([`pattern-tables.ts`](../extension/src/adapters/pattern-tables.ts)). Rules first, never a guessed type:

| The sentence | Becomes |
|---|---|
| asks, offers, plans or drafts, and names an action ("Should I send…", "I'll create…", an approval card) | `other`, confidence 0.2 |
| refuses, or reports a step still under way ("I couldn't…", "Sending email…") | no claim |
| matches patterns of one ActionType | that type, confidence 0.7 to 0.9, with what the pattern captured |
| matches patterns of two types | `other`, confidence 0.4 |
| says it acted without saying how, or names an action outside the ActionTypes (an RSVP, a share) | `other`, confidence 0.3 |
| anything else, or longer than 400 code units | no claim |

A sentence wrongly read as an action can end in a NOT_FOUND against the agent, so the tables err toward losing a claim, never toward inventing one: their tests check that no labelled sentence is ever typed as an action it is not. The corpora are invented until real transcripts exist (`tests/fixtures/patterns/`); measured accuracy on captured pages arrives with 3.8.

### 10.4 Reasons the adapter skeleton gives

Beside the reasons an adapter's `health()` names, a pass can be DEGRADED with these (`ADAPTER_REASONS`):

| Reason | Meaning |
|---|---|
| `health.threw`, `health.invalid` | As an observer's ([§4.1](#41-pass-reasons)). |
| `extract.threw` | `extract()` threw. |
| `extract.invalid` | `extract()` returned something that is not an `AgentRead`. |
| `claims.threw` | Building the Requests and Claims threw: a bug. |
| `time.unknown` | A turn or entry that held a Request or a Claim shows no time the skeleton reads, or one after the pass. What was read is still posted; no scope snapshot is. |
| `claim.invalid` | A Request or a Claim failed its schema: a bug, never expected. What else was read is still posted. |
| `message.invalid` | A message of the pass failed its bus schema: only this health report is posted. |

### 10.5 `muse.chat` reasons

| Reason | Status | Meaning |
|---|---|---|
| `view.unread` | IDLE | The page shows no conversation, activity view or connected apps (a business dashboard, a help page): nothing to read, nothing wrong. |
| `selector.missing.conversation_id` | DEGRADED | A conversation shows no id: its Requests cannot be named. |
| `selector.missing.message_text` | DEGRADED | A message has no text element: Muse changed how it draws one. |
| `selector.missing.entry_summary` | DEGRADED | An activity entry has no summary. |
| `selector.missing.app` | DEGRADED | A connected app has no name or no switch. |

Every Muse selector is synthetic until the captures; a capture that changes one bumps `selectors.json`'s version ([§5](#5-selectorsjson-and-versions)).

