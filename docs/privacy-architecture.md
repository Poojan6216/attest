# Privacy architecture

**Who this is for:** anyone deciding whether to trust Attest with their Gmail and Calendar, and anyone changing what Attest stores: reviewers, contributors, the privacy and security reviews.
**What you'll know after:** what leaves the browser (nothing, unless you turn on an option that sends), what each observer reads and what it keeps, every ledger table and field, what each stored fact means, what is hashed and what that does and does not hide, how long things are kept, what the export holds, what the optional model sees and where it runs, and what the opt-in usage numbers send.

> Status: **v3** (Sprint 6, task 6.5: encryption at rest, [§12](#12-encryption-at-rest); v2 was Sprint 5, task 5.9, v1 Sprint 2, task 2.9). It describes Attest as of Sprint 6.5: the Gmail and Calendar readers, pasted agent activity logs (the agent readers are off, [§1](#1-what-leaves-the-browser)), grading, the options page, the optional model ([§10](#10-the-optional-model)) and the opt-in usage numbers ([§11](#11-anonymous-usage-numbers)). With both of those off, the extension makes no network request at all. The store-facing summary is [`PRIVACY.md`](../PRIVACY.md).

## Contents

1. [What leaves the browser](#1-what-leaves-the-browser)
2. [What Attest cannot hide](#2-what-attest-cannot-hide)
3. [What is read, and what is kept](#3-what-is-read-and-what-is-kept)
4. [The policy allowlists](#4-the-policy-allowlists): every allowlisted field, per source
5. [Every ledger table and field](#5-every-ledger-table-and-field)
6. [What is hashed](#6-what-is-hashed)
7. [Retention and purge](#7-retention-and-purge)
8. [The export](#8-the-export)
9. [Logs](#9-logs)
10. [The optional model](#10-the-optional-model): what it sees, where it runs, your own key
11. [Anonymous usage numbers](#11-anonymous-usage-numbers): what is sent, where, how often, how to stop, with a real payload
12. [Encryption at rest](#12-encryption-at-rest): optional; what it seals, where the key lives, what it does and does not protect

## 1. What leaves the browser

Nothing, unless you turn on your own model key or the anonymous usage numbers (below). Attest has no account and no remote code (Hard Rules 1, 9).

- **No network allowlist.** `NETWORK_ALLOWLIST` in [`extension/src/config.ts`](../extension/src/config.ts) is empty: no host may be contacted whatever you chose. `allowedHosts` adds exactly one host for each option you turn on: the telemetry host while the usage numbers are on, the model company's while your own key is on. With both off it is empty.
- **Anonymous usage numbers, off unless you turn them on (since Sprint 5.7).** Turned on in the options page's Privacy section, the service worker sends one payload a day, about the day before, to the one telemetry host (`TELEMETRY_HOST`), and records the day so it never goes twice ([`src/telemetry/send.ts`](../extension/src/telemetry/send.ts)). The payload is counts, yes-or-no values, enum words, the install id, the versions and the date, and its schema allows no other string ([`src/telemetry/schema.ts`](../extension/src/telemetry/schema.ts), held equal to the server's). The options page shows exactly what the next send holds. Until the server is deployed, the host is a name under `.invalid`, which never resolves, and the store build refuses to be made with it. [§11](#11-anonymous-usage-numbers) describes it in full, with a payload the real builder made.
- **Two host permissions, both read-only.** The manifest ([`extension/wxt.config.ts`](../extension/wxt.config.ts)) asks for `https://mail.google.com/*` and `https://calendar.google.com/*`, so the content scripts can read those pages in tabs the user opened, plus `storage`, `alarms`, `scripting` (since Sprint 4.5: the readers' content scripts are registered at runtime, so one you turn off is unregistered; it reaches no other host), `notifications` (since Sprint 4.6: an alert when a receipt ends NOT_FOUND, UNASKED or OVER_SCOPE, shown on this device by Chrome and your operating system, naming no counterparty, amount or subject: [§5.15](#515-alerts)) and `sidePanel` (the build adds the last one for the side panel). No AI agent's site is asked for: Meta's, OpenAI's and Anthropic's terms forbid collecting data from their sites by automated means, so those readers are off (`AGENT_READERS` in [`extension/src/config.ts`](../extension/src/config.ts); Decisions [3.10]). Attest never fetches from those hosts or any other: no Gmail API, no OAuth, no background tab. The one tab Attest may open is your Gmail Sent folder, pinned and in front of you, and only if you turn on Check Gmail for me ([§3](#3-what-is-read-and-what-is-kept)); it needs no `tabs` permission, and the manifest has none.
- **Your own model key, off unless you turn it on (since Sprint 5.4).** With an Anthropic or OpenAI key saved and turned on in the options page's Model section, and Chrome's on-device model not on and ready, Attest asks that company's official endpoint (`api.anthropic.com` or `api.openai.com`, nothing else) about each claim still checking with a partial match: the claim's kind, counterparty, short subject, amount and time, and the same for the one sent email or event it matched ([`src/intel/input.ts`](../extension/src/intel/input.ts)), with your key in the request's header. Never a page, never what you asked an agent. The company keeps what it receives under its own terms. Each claim is asked once ([§5.17](#517-modelanswers)); the answer can only move a partial match toward verified ([`docs/grading.md` §5.4](grading.md#54-the-models-score-model-raisets-v119)). Chrome's on-device model, when on, runs on this computer and sends nothing. [§10](#10-the-optional-model) has what each sees and where it runs.
- **A test enforces it.** [`extension/tests/e2e/network-intercept.spec.ts`](../extension/tests/e2e/network-intercept.spec.ts) (`@mandatory`) loads the built extension, opens the Gmail Sent, receipt and Calendar fixtures with the shipped content scripts running, reloads them for five minutes, and fails on any request from the extension outside the allowlist. Its negative control proves it catches a request from the service worker, an extension page and a page.
- **A second test hunts for leaks.** [`extension/tests/e2e/no-leak.spec.ts`](../extension/tests/e2e/no-leak.spec.ts) (`@mandatory`) plants three known secrets in the fixture pages (in message bodies, snippets, event locations) and checks that none reaches the ledger export, IndexedDB, extension storage, the console or the network.

## 2. What Attest cannot hide

Limitations first.

- **The ledger is encrypted only if you turn encryption on.** It is an IndexedDB database in your Chrome profile on disk. Other websites and other extensions cannot read it (it belongs to Attest's own origin), but anyone or anything that can read your Chrome profile can, unless you turn on encryption at rest in the options page ([§12](#12-encryption-at-rest)). Even then, ids, hashes, dates, action types, grades and states stay readable, because Attest finds its records by them; and anyone using this browser while Attest is unlocked sees what you see.
- **A hash is not a secret.** Attest stores some values only as SHA-256 hashes ([§6](#6-what-is-hashed)), so a casual reader of the ledger or an export does not see them. A hash of a value someone can guess (an email address, a calendar named "Family") can be confirmed by hashing the guess. Hashing hides; it does not encrypt.
- **Some content is stored in clear, because matching needs it.** A recipient address, a merchant name, an amount, the first 80 characters of a subject, and for Calendar the first guest address of every event in a range you looked at; its other guests are kept only as one-way keys ([§5.4](#54-calendarsnapshots)). These are the facts a claim is checked against.
- **The export holds everything the ledger holds** ([§8](#8-the-export)). Treat an export file like the ledger itself.
- **The content script sees the whole page.** It runs inside the Gmail or Calendar tab you opened, so the page's text is in its memory while a pass reads it, as it is in Gmail's own. What it keeps from a pass is only what this document lists; the rest is dropped before anything crosses to the service worker (Hard Rule 2).

## 3. What is read, and what is kept

Each observer reads one vendor page in a tab you opened, and only while you have it open (Hard Rule 11), with one exception you choose: Check Gmail for me, below. How each one reads its page is in [`docs/adapters.md` §8](adapters.md#8-the-observers).

| Observer | Reads | Keeps (in a row) | Never reads into a field |
|---|---|---|---|
| `gmail.sent` | The Sent list: each row's recipients, subject and time | One row per recipient other than you: the address, the subject (80 characters), the minute sent, a hash of Gmail's row id | The snippet, the message body, display names, your own address, other folders |
| `gmail.receipt` | Every expanded message of a conversation you opened: its sender, subject and date; the body only of a message whose sender and subject make it a receipt candidate, and only to find the total line | One row per receipt: merchant, amount, currency, subject (80 characters), date, a hash of Gmail's message id | The rest of the body (items, addresses, card digits), any message that is not a receipt |
| `gcal.event` | The visible days, each event chip's label (start, end, title, calendar, guests), the calendar list | One row per event first seen, created, changed or removed: title (80 characters), start, one guest address, a hash of the event key; and the range's snapshot ([§5.4](#54-calendarsnapshots)) | Locations, conference links, descriptions, response status |

**A pasted activity log** (Sprint 3.13). The side panel reads the text you paste in the panel itself ([`paste.ts`](../extension/src/adapters/paste.ts)) and sends the service worker only the claims it found (the fields of [§5.8](#58-claims)) and the minutes the log names ([§5.11](#511-activity)); the text is dropped when the preview closes, and is never stored, logged or sent. The paste box has spell check off, so Chrome's enhanced spell check never sends it to Google.

**Away detection** (Sprint 3.14, off unless you turn it on in the options page). With the optional `idle` permission, Chrome tells the service worker when you go away (no input for a minute, or the screen locked) and when you are back; the ledger keeps the start and end of each time away ([§5.11](#511-activity)) and nothing else. Turning it off gives the permission back and deletes every interval.

**Auto-check Gmail** (Sprint 4.9; "Check Gmail for me" in the options page's Adapters, off unless you turn it on; flag `ATTEST_AUTO_CHECK_GMAIL`). This is the one exception to Hard Rule 11: the one time Attest opens a page itself. When it is on and the Gmail reader is on, after each grading batch (every 5 minutes) the service worker looks for an `email.sent` claim whose receipt has been PENDING, with no mark of yours, for half its grace (`graceMin` / 2, 15 minutes in the shipped policy) since Attest read it, while no Gmail tab has shown Attest your Sent folder since then (no `gmail.sent` coverage ping synced after the claim was read). Then it opens `https://mail.google.com/mail/u/0/#sent` in one new tab, pinned and active in the window you are using: never in the background. It waits, trying again at the next batch, while Chrome's last focused window does not have the focus (another app is in front, the screen is locked) or is minimised, and, while away detection is on, while Chrome says you are idle or the screen is locked (security review SEC-2). The Gmail reader reads that tab as it reads any Gmail tab you open, and never acts on it (Hard Rule 3). One tab serves every claim due at that moment; after it, no tab opens for `graceMin` (30 minutes), and a claim that was due when a tab opened never opens another, so each claim opens at most one. The popup says why the tab opened, for whose claims, until that 30 minutes ends; the ledger keeps when, until when, how many claims and whose ([§5.6](#56-meta)), written only after the tab opened. `chrome.tabs.create` with a URL and `chrome.windows.getLastFocused` need no permission: the manifest has no `tabs` permission ([`src/background/auto-check.ts`](../extension/src/background/auto-check.ts); [`extension/tests/e2e/auto-check.spec.ts`](../extension/tests/e2e/auto-check.spec.ts) runs it on the built extension, off and on).

Attest does not run in incognito windows (the manifest says `"incognito": "not_allowed"`): an incognito Gmail or Calendar tab is never read, so nothing from it reaches the ledger, which lives in your regular profile and outlives the incognito session.

Every observer also reads the signed-in account's address, and keeps only its hash ([§6](#6-what-is-hashed)). While a tab is open, the observer notes the instant of your last key press, pointer move, scroll or touch in it (never which key, where, or on what), and sends one yes/no with each coverage ping: whether there was input in the last minute ([§5.3](#53-coverage)).

The route from page to disk has two checks. In the content script, `redact.project()` ([`src/core/redact.ts`](../extension/src/core/redact.ts)) builds each row from the fields the policy allows for its source and nothing else. In the service worker, `upsertObservation()` refuses any row `project()` could not have returned: a field outside the allowlist, a self-chosen `contentHash`, a `sightedAt` ([`docs/grading.md` §10](grading.md#10-ids-and-hashes-hashts)). Every message on the way is a strict Zod schema, so an extra field is an error, not a passenger ([`docs/adapters.md` §9](adapters.md#9-message-bus)).

## 4. The policy allowlists

`allowlistedFields` in [`policy/default.json`](../policy/default.json) names, for each observation source, the only fields a row of that source may store. Six are content fields a page supplies (`counterparty`, `merchant`, `amountCents`, `currency`, `subjectHint`, `occurredAt`). Two are derived markers the code computes, never copies from the page (`rowKeyHash`, `contentHash`). `occurredAt` is required in every list. The fields every row has whatever its source (`id`, `source`, `type`, `observedAt`, `sightedAt`) are computed by `project()` or the ledger and are never in an allowlist ([§5.1](#51-observations)).

`pnpm check-docs` (`scripts/check-docs-allowlist.ts`) fails when a field the policy allowlists has no row below, or a row below names a field the policy does not allowlist.

### 4.1 Allowlist: `gmail.sent`

| Allowlisted field | What it holds | Where it comes from |
|---|---|---|
| `counterparty` | One recipient's email address, exactly as Gmail shows it (case kept), on one line, at most 320 characters. A row with three recipients gives three rows. Never a display name, and never the signed-in account's own mailbox, in any spelling Gmail delivers to it (any case, a `+tag`, dots in a Gmail address): it is left out of the recipients, so an email sent only to yourself gives no row, and Attest then cannot check a claim about it (the claim stays UNVERIFIABLE, never NOT FOUND). | The recipient element's `email` attribute, else its `title` |
| `subjectHint` | The subject on one line, cut to its first 80 Unicode code points. Absent when the subject is empty or Gmail's `(no subject)`. | The row's subject cell; the snippet beside it is never read |
| `occurredAt` | The minute the message was sent, ISO 8601 with the offset in force at that instant. | The time cell's absolute `title`, else its label or text resolved against the pass's own instant |
| `rowKeyHash` | SHA-256 of Gmail's id for the row. It tells two identical sends apart and makes the same row read twice one row. The id itself is not stored. | `data-legacy-last-message-id` |
| `contentHash` | SHA-256 of the row's source, type, content fields above and `rowKeyHash`. The row's identity: its `id` is derived from it. | Computed by `project()` |

### 4.2 Allowlist: `gmail.receipt`

| Allowlisted field | What it holds | Where it comes from |
|---|---|---|
| `merchant` | The business the receipt is from, on one line, at most 120 characters: Amazon, Uber, Instacart or Facebook Marketplace by name; the restaurant named in an OpenTable subject; the sender's display name for Stripe, a Shopify store and the generic parser. | The parser's canonical name, the subject, or the sender's display name; never body text |
| `amountCents` | The charged total in integer minor units (cents for USD); for a Marketplace listing, the listing price. Absent only where the receipt states none (a Stripe cancellation without an amount). | The message's total line (`Total`, `Order total`, `Amount paid`, …), never a subtotal or a line item |
| `currency` | The ISO 4217 code of that amount (`USD`, `CAD`, `EUR`). A bare `$` is USD. | The amount's symbol or code |
| `subjectHint` | The message subject on one line, first 80 code points. Absent for `(no subject)`. | The conversation's subject heading |
| `occurredAt` | When the message was sent, to the minute. Never a date in the body (a delivery date, a reservation time). | The message's date cell: its `title`, else its `alt`, else its text |
| `rowKeyHash` | SHA-256 of Gmail's message id: two receipts in one conversation stay two rows. | `data-legacy-message-id` |
| `contentHash` | SHA-256 of the row's source, type, content fields and `rowKeyHash`; the row's identity. | Computed by `project()` |

### 4.3 Allowlist: `gcal.event`

| Allowlisted field | What it holds | Where it comes from |
|---|---|---|
| `subjectHint` | The event title on one line, first 80 code points. Absent for `(No title)`. | The chip's accessible label and its drawn title |
| `occurredAt` | The event's start, ISO 8601 with offset; local midnight for an all-day event. For an updated event, its new start. | The chip's accessible label, read in the browser's zone |
| `counterparty` | One guest address: the first guest in ASCII-lowercase order with your own address left out (any case or `+tag`), and none at all on a page that names no account, where yours could be any of them; for an update that added guests, the first guest added. Absent when the event has no guest addresses. One row per event, never one per guest. | The `Guests:` part of the chip's label |
| `rowKeyHash` | SHA-256 of the event key, which is itself SHA-256 of Calendar's `data-eventid`. That id is base64 of the event id and the calendar id, and a primary calendar's id is its owner's address, so the id never leaves the page. | `data-eventid`, hashed twice |
| `contentHash` | SHA-256 of the row's source, type, content fields and `rowKeyHash`. A created and a deleted row of one event differ (the type is hashed). | Computed by `project()` |

## 5. Every ledger table and field

The ledger is one IndexedDB database, `attest`, in a storage bucket of its own (`ledger-` and a number, since the Sprint 6 close; [§12](#12-encryption-at-rest), Chrome's own copies), opened through Dexie only inside `extension/src/ledger/` ([`db.ts`](../extension/src/ledger/db.ts), schema version 11 in [`migrations.ts`](../extension/src/ledger/migrations.ts)). Every row is written through a strict Zod schema and read back through one: a row that fails is skipped (logged by id only) and never shown. Some tables add derived **index fields** to each row so IndexedDB can answer range queries; they are computed from the row's own fields, stripped on every read, and never exported ([`index-fields.ts`](../extension/src/ledger/index-fields.ts)). With encryption at rest on ([§12](#12-encryption-at-rest)), a row of the nine tables that hold content is stored as the fields IndexedDB keys and indexes it by, its index fields, and `sealed`, every other field below sealed together; it reads back exactly as listed.

Outside IndexedDB, `chrome.storage.local` holds at most four keys, and since Sprint 5.3 only Attest's own pages and service worker can read it, never a content script (`setAccessLevel` `TRUSTED_CONTEXTS`, set at every start of the service worker, [`src/background/byo.ts`](../extension/src/background/byo.ts)): `attest.installId` (a random version-4 UUID, [`install-id.ts`](../extension/src/ledger/install-id.ts); it identifies nothing about you, is never logged, and only the opt-in usage numbers use it, [§11](#11-anonymous-usage-numbers)); and, only while you have saved your own model key, `attest.byoKey`, the key, and `attest.byoVendor`, its company ([§10](#10-the-optional-model)): never logged, never in the ledger, so never in an export, and deleted by Forget my key and by Delete all data. While encryption at rest is on, the key is kept sealed under the ledger's key ([§12](#12-encryption-at-rest)). And `attest.ledgerBucket`, from the Sprint 6 close, the name of the storage bucket the ledger is in, `ledger-` and a number, which says nothing about you ([§12](#12-encryption-at-rest); [`src/ledger/place.ts`](../extension/src/ledger/place.ts)). Your choices about what Attest may read or open, the page readers you turned off and the flags you set, are kept in the ledger's meta ([§5.6](#56-meta); [`src/ledger/consent.ts`](../extension/src/ledger/consent.ts)), where no script on a Gmail or Calendar page can reach them. Sprints 4.5 and 4.9 kept them in `chrome.storage.local` (`attest.readersOff`, `attest.flags`), which content scripts can write; an update moves them into the ledger once and removes those keys ([`src/background/consent-move.ts`](../extension/src/background/consent-move.ts); security review SEC-3). A reader that is off has no content script registered, so a page you open is not read, and what a tab opened before sends is not stored. `chrome.storage.session` (memory Chrome empties when the browser closes, which no content script can read: Chrome's default for this area, which Attest never widens) holds at most four keys: `attest.idleSession`, while away detection is on, `true` once this browser session has started watching, so a time away that the previous session left open is closed at what was confirmed, never stretched over the next day ([`src/background/idle.ts`](../extension/src/background/idle.ts)); and `attest.openReceipt`, from Sprint 4.6, the id of the receipt a clicked alert asked the side panel to open ([`src/background/alerts.ts`](../extension/src/background/alerts.ts)); and `attest.ledgerKeys`, from Sprint 6.5, while encryption at rest is on and the ledger is unlocked: the key its rows are sealed with, derived from your passphrase (during a passphrase change, the one before as well), which the service worker writes when you unlock and clears at its every start, so Attest's pages read the ledger without waking it, and a restart of the service worker locks it ([§12](#12-encryption-at-rest); [`src/crypto/session.ts`](../extension/src/crypto/session.ts)). It is kept in memory, never in the profile, never logged and never exported. And `attest.ledgerRebuild`, from the Sprint 6 close, `true` only while the service worker rebuilds the ledger into its next storage bucket after a job sealed every row, so Attest's pages wait to read until the rows are there ([§12](#12-encryption-at-rest); [`src/ledger/rebuild-mark.ts`](../extension/src/ledger/rebuild-mark.ts)).

### 5.1 `observations`

What the observers saw: one row per distinct fact. Written only by the service worker, only through `upsertObservation`. Key `id`; `contentHash` is unique.

| Field | Meaning |
|---|---|
| `id` | Derived from `contentHash` (`idFromHash`), so one fact has one id. |
| `source` | `gmail.sent`, `gmail.receipt` or `gcal.event`. |
| `type` | `email.sent`, `purchase.made`, `subscription.changed`, `listing.posted`, `calendar.created`, `calendar.updated` or `calendar.deleted`. |
| `counterparty`, `merchant`, `amountCents`, `currency`, `subjectHint`, `occurredAt` | The content fields, each present only where the source's allowlist names it ([§4](#4-the-policy-allowlists)). |
| `rowKeyHash`, `contentHash` | The derived markers ([§4](#4-the-policy-allowlists), [§6](#6-what-is-hashed)). |
| `observedAt` | When the ledger stored the row: no earlier than the observer's sighting, the writer's clock, and 1 ms after the last grading batch. It decides which grading batches read the row. Never changed once stored. |
| `sightedAt` | Present only when the ledger stored the row later than the observer saw it: the instant of that sighting. Set by the ledger only. |

Index field: `timeBucket` (the hour of `occurredAt`). Schema v4 dropped the v1 `counterpartyTokens` index and removed its field from every stored row ([`src/ledger/migrations.ts`](../extension/src/ledger/migrations.ts)).

### 5.2 `coverageIntervals`

What each observer saw, and when: the spans grading reads to tell "not there" from "not looked at" (Hard Rule 5). One row per merged interval; a pass that overlaps or touches a stored interval of the same group (observer, source, account, `allCalendars`, `changesSince`, and first-look marker or not) is merged into it.

It also holds **first-look markers** ([`src/ledger/first-look.ts`](../extension/src/ledger/first-look.ts)): for each Calendar event stored as a first sighting (an event a pass could not compare with an earlier view, or a change it noticed too late to say when it happened), one entry whose window is the event's start instant, with the observer id, the account hash (none for a page without one), `allCalendars`, and the sighting instant as both `lastSyncAt` and `changesSince`. No new field: the start instant is already in the event's observation row. A marker keeps an event that was already there from ever reading as something an agent did ([`docs/grading.md` §7](grading.md#7-unasked-attributionts)).

**The scroll-depth limit.** A Gmail Sent window reaches back only as far as the rows Gmail draws at the head of the list: 50 by default, 100 at Gmail's largest page. It starts a minute after the oldest row drawn, since the list may go on ([`docs/grading.md` §3](grading.md#3-inputs)), and an older page of the list gives rows but never a window. So a send older than the head's oldest row is outside every window from then on, and a claim about it is UNVERIFIABLE, never NOT FOUND: an agent that sends fifty emails after a false claim pushes the claim's minute off the head and out of NOT FOUND's reach. Measured by the red team's observer starvation ([`docs/attacks-that-work.md`](attacks-that-work.md)).

When the computer's clock goes back (a jump forward that came back, or a step back), the service worker deletes every interval and marker synced after the clock's new time, before it stores anything else ([`src/ledger/clock-guard.ts`](../extension/src/ledger/clock-guard.ts)): a span stamped by a clock that was ahead never vouches for anything.

| Field | Meaning |
|---|---|
| `observerId`, `source` | Which observer and source saw it. |
| `lastSyncAt` | The latest pass that reported this span. |
| `windowStart`, `windowEnd` | The span seen. For Gmail Sent, the head of the list up to the pass; for a receipt, the single instant of that message; for Calendar, whole visible days. |
| `accountHash` | SHA-256 of the signed-in account's address ([§6](#6-what-is-hashed)); absent when the page showed none. |
| `allCalendars` | Calendar only: every listed calendar was shown. |
| `changesSince` | Calendar only, set by the ledger: since when that view had compared every snapshot of the range, so a change in `[changesSince, lastSyncAt]` would have been seen ([`docs/adapters.md` §8.3](adapters.md#83-gcalevent)). Never earlier than the clock floor (`clockFloorAt`, [§5.6](#56-meta)). |

Index fields: `accountKey` (the account hash, or empty), `startMs`, `endMs`, `syncMs` (the instants in epoch milliseconds), `kind` (`point` for a single instant, `span` otherwise) and `lenMs` (`endMs` − `startMs`), which let a read stop at the intervals that can reach the window it asks about. They hold nothing the stored fields do not.

### 5.3 `coverage`

The latest coverage ping of each observer and account, as the observer posted it. Key `[observerId+accountKey]`.

| Field | Meaning |
|---|---|
| `observerId`, `source`, `accountHash`, `lastSyncAt`, `windowStart`, `windowEnd`, `allCalendars` | As in `coverageIntervals`, for the latest pass only. |
| `userActive` | Whether you pressed a key, pointed, scrolled or touched in that tab in the minute before the pass. Only this yes/no is stored; nothing about the input. Sprint 3.5 reads it for activity; grading's coverage never does. |

Index field: `accountKey`. A latest ping synced after the clock's time is deleted when the clock goes back (§5.2).

### 5.4 `calendarSnapshots`

For each Calendar observer, account and visible range, the last snapshot of that range: what the service worker compares the next pass with, to find created, changed and deleted events. Key `[observerId+accountHash+range]`. A snapshot is stored only for a page whose account is known.

**This table holds more than an observation's allowlist.** It keeps every event in a range you looked at, whether or not anything happened to it, with its end and all-day flag, its first guest's address (a deletion's row names it) and, for each of up to 200 guests, only a one-way key: SHA-256 of the address, ASCII-lowercased, enough to tell that the guest list changed, never who is on it. It is not governed by `allowlistedFields`, which covers observation rows; it is governed by its own strict schema ([`src/observers/gcal/snapshot.ts`](../extension/src/observers/gcal/snapshot.ts), [`src/ledger/calendar-snapshots.ts`](../extension/src/ledger/calendar-snapshots.ts)). It is needed because a deletion can only be seen by comparing with what was there, and a changed guest list is an update.

| Field | Meaning |
|---|---|
| `observerId`, `accountHash`, `range` | Whose snapshot: the observer, the account's hash, and `<first day>/<last day>` of the range. |
| `snapshot` | The comparison base: the latest snapshot, plus the events of the previous base it lacked but could not vouch were gone (it hid a day behind "N more" or named a calendar twice, and the event's calendar is shown), plus any event it lacked that waits for a second absence (below). So this table can hold an event the latest pass did not show. |
| `updates` | Per event of the base, the `calendar.updated` rows its range reported in the current churn window: the event `key`, `since` (the first of them) and `count`. At most 20 a day are stored per event ([grading.md §3](grading.md#3-inputs), *Update rows per event*). |
| `pending` | Events of the base missing from one complete snapshot: each event `key`, `since` (that snapshot's read instant) and `baseAt` (the read instant of the snapshot it was compared with, so a deletion noticed long after it happened is never blamed on whoever was active when it was noticed; absent in a record stored before Sprint 2 wave E). A second absence confirms the deletion; the event coming back clears it. |

The snapshot's own fields:

| Field | Meaning |
|---|---|
| `format`, `observer`, `version` | The stored format (2; a record stored in the page form, format 1, is read as format 2 and rewritten by its range's next pass), `gcal.event`, and the selectors version it was read under. A snapshot of another version is never compared with a new one. |
| `readAt` | When the pass read the page. |
| `baselineAt` | Since when this range's changes have been followed without a break. |
| `days` | Each visible day: its `date` (`YYYY-MM-DD`) and `complete` (false when events hid behind "N more"). |
| `calendars` | Each listed calendar: `key` (SHA-256 of its name), `shown`, and `ambiguous` when two calendars share a name. |
| `events` | Each event: `key` (SHA-256 of `data-eventid`), `calendar` (its calendar's key), `subjectHint` (title, 80 code points), `occurredAt` (start), `endAt`, `allDay`, `days` (the days its chips sit in), `firstGuest` (the first guest's address, your own left out), `guestKeys` (SHA-256 of each guest's address, ASCII-lowercased, ascending; up to 200) and `guestCount`. |

Index field: `readMs` (`readAt` in epoch milliseconds, for the purge). A record read after the clock's time is deleted when the clock goes back (§5.2), so its range is compared with nothing next time.

### 5.5 `adapterHealth`

The latest health of each observer (and of an agent adapter, taken only from its own site, once its reader may run): what the popup's banner will show (Hard Rule 6). Key `adapterId`.

| Field | Meaning |
|---|---|
| `adapterId`, `version` | The observer and its selectors version. |
| `status` | `OK`, `IDLE` or `DEGRADED`. IDLE: the page is not one the observer reads (another Gmail folder, no conversation open), neither OK nor broken; it replaces only nothing, an IDLE, or the report of its own tab, never another tab's OK or DEGRADED (sprint_2 2.11; the tab is known only in the service worker's memory, never stored). |
| `reasons` | Reason codes such as `not_sent_folder` or `selector.missing.row`: codes only, never page text ([`docs/adapters.md` §4](adapters.md#4-reading-a-degraded-reason)). |
| `checkedAt` | When the pass ran that wrote it. A report that repeats the stored one (same status, reasons and version) is written again only once the stored one is a minute old (`OBSERVER_HEALTH_REFRESH_MS`); a change is written at once. A report checked after the service worker's clock is refused, and one stored while the clock ran ahead is repaired when the clock comes back. |

### 5.6 `meta`

Small facts about the ledger itself. Key `key`.

| Field | Meaning |
|---|---|
| `key` | A developer-chosen token. Today: `lastEvaluatedAt`, the instant of the last grading batch, written from Sprint 3.6; `storedWrites`, how many facts the ledger has stored, and `gradedWrites`, that count as the last grading batch that graded found it: a batch with no receipt still checking and no fact stored since skips (Sprint 3 close); `heldPending`, from the Sprint 4 close, how many receipts still checking the last graded batch kept without grading them (an unclaimed action's receipt that holds a mark you undid, which no batch grades until a new fact arrives), so they do not stop that skip; `clockHighWater`, the latest instant the ledger stored a sighting, a sync, a snapshot read at or a health check since the clock last went back; `clockFloorAt`, written when the clock went back: the instant before which no Calendar view is recorded as following changes ([`src/ledger/clock-guard.ts`](../extension/src/ledger/clock-guard.ts)); `lastImportAt.<agent>`, the instant the service worker stored that agent's last pasted import, which counts as the agent's adapter sync for UNASKED finality ([`docs/grading.md` §7](grading.md#7-unasked-attributionts)); `idleOpen`, while Chrome says you are away, the id of that time away (a SHA-256 hash, [`src/ledger/activity.ts`](../extension/src/ledger/activity.ts)); `clockRepair.<ms>`, one per time the clock went back, from Sprint 3.17: the span of instants that may have been stamped while it ran ahead, `<from>/<to>`, which grading reads ([`src/ledger/clock-repairs.ts`](../extension/src/ledger/clock-repairs.ts); [`docs/grading.md` §3](grading.md#3-inputs)); `purgeTrustedAt`, the instant the last retention purge trusted ([§7](#7-retention-and-purge)); `alertsMuted.<agent>`, from Sprint 4.4: `true` when you muted that agent's alerts in the settings, saved with its grant; `retentionDays`, from Sprint 4.5: the retention window you chose, 30, 90 or 180 ([§7](#7-retention-and-purge); [`src/ledger/settings.ts`](../extension/src/ledger/settings.ts)); `readerOff.<reader>`, from the Sprint 4 close: `true` while you have that page reader (`gmail`, `gcal`) off, absent while it is on, and `flag.<flag>`: `true` or `false` for each feature flag you can set (`flag.ATTEST_AUTO_CHECK_GMAIL`; from Sprint 5, `flag.ATTEST_MODEL`, `flag.ATTEST_MODEL_BYO` and `flag.ATTEST_TELEMETRY`), both [`src/ledger/consent.ts`](../extension/src/ledger/consent.ts); from Sprint 4.9, the last time Check Gmail for me opened your Gmail Sent folder ([§3](#3-what-is-read-and-what-is-kept)): `autoCheckAt`, when; `autoCheckUntil`, 30 minutes later, before which no other tab opens and until which the popup says why it opened; `autoCheckClaims`, for how many claims; `autoCheckAgents`, whose (agent ids joined by commas) ([`src/ledger/auto-check-record.ts`](../extension/src/ledger/auto-check-record.ts)); `telemetrySentDay`, from Sprint 5.7: the last day the opt-in telemetry sent, `YYYY-MM-DD`, written once the server took it, so a day the server took is not sent again ([`src/ledger/telemetry-sent.ts`](../extension/src/ledger/telemetry-sent.ts)); `crypto.*`, from Sprint 6.5, while encryption at rest is on, or being turned on or off; turned off, every one is deleted ([§12](#12-encryption-at-rest); [`src/ledger/crypto-state.ts`](../extension/src/ledger/crypto-state.ts)): `crypto.sealing`, `true` while it is on; `crypto.keyId`, the current key's random id (12 hex digits); `crypto.salt`, this install's random salt for your passphrase, and `crypto.iterations`, the rounds of PBKDF2 that turn the two into the key; `crypto.check`, a short fixed text sealed with that key, which tells a right passphrase from a wrong one before any row is read; during a passphrase change, `crypto.previous`, the key before, sealed under the new one, with its id, so the new passphrase alone finishes the change after a restart; and, while rows are being sealed, sealed again under a new passphrase, or opened for good, `crypto.job` (`seal`, `reseal` or `unseal`), `crypto.jobTable`, the table it is in, and `crypto.jobAfter`, the key of the last row it rewrote there, so the job resumes where it stopped. Never the passphrase, never a key in the clear. Instants, counts, ids, that yes or no, that number of days, those agent ids, that day, and that salt, check and job only, never content. |
| `value` | A string of at most 256 characters, a number or a boolean. |

### 5.7 `requests`

Empty until Sprint 3: what you asked an agent, read from the agent's own page. Key `id`.

| Field | Meaning |
|---|---|
| `id` | Derived from the hash of the agent, conversation, text hash and time. |
| `agent` | `muse`, `chatgpt`, `dots` or `claude`. |
| `conversationId` | The agent's own id for the conversation, a token. |
| `textHint` | The first 200 characters of your request, for display. **This is your own text, stored in clear.** |
| `textHash` | SHA-256 of the whole request text. |
| `ts` | When you sent it. |

Index field: `date` (the local date of `ts`).

### 5.8 `claims`

What an agent says it did, read from an activity log you paste into the side panel (since Sprint 3.13; the readers of the agents' own pages are off, [`Decisions.md`](../Decisions.md) `[3.10]`). Key `id`; `rawHash` is unique.

| Field | Meaning |
|---|---|
| `id`, `rawHash` | `rawHash` is SHA-256 of the agent, the kind of page, the agent's row id hash, the claim text and its time; `id` is derived from it. |
| `agent`, `requestId` | Which agent, and the request it answered when known. |
| `type` | The claimed action type. |
| `counterparty`, `amountCents`, `currency`, `subjectHint` | What the agent said it did it to or with: an address or a name, an amount, a subject (80 code points). |
| `claimedAt`, `claimedAtPrecision`, `claimedAtEnd` | When the agent says it acted, and to what precision (minute, hour, day). |
| `targetAt` | For a calendar claim, the event start it names. |
| `observedAt` | When Attest read the claim: the instant you pasted the log. |
| `sourceKind` | Where the claim came from: `activity_view` for a pasted log. Chat, notification and settings belong to the page readers, which are off. |
| `extractor` | Which reader made it (`import.<agent>` for a pasted log), its `version`, and the pattern's `confidence`. |

Index field: `date`.

### 5.9 `grants`

What you allow each agent to do. Until the options page lets you declare it (Sprint 4), the service worker writes a default grant for each of the four agents before it stores your first import: every action type, no allowlist, no spending limit and no declared access, so your first receipts are grades rather than all OVER SCOPE ([`default-grants.ts`](../extension/src/background/default-grants.ts)). It never replaces a grant you set. Key `agent`.

| Field | Meaning |
|---|---|
| `agent` | The agent. |
| `allowedTypes` | The action types you allow. |
| `counterpartyAllowlist` | Domains or addresses it may act towards. |
| `spendCeilingCents`, `spendCurrency` | Its spending limit, if any. |
| `declaredScopes` | The access you say it has. |
| `observedScopes` | The access the vendor's settings page shows (Sprint 3.7). |
| `accounts` | Hashes of the accounts that belong to this agent, per source. |
| `updatedAt` | When you last changed it. |

### 5.10 `receipts`

Written by the grading batch since Sprint 3.13: the grade for each claim, each unclaimed action, each undeclared permission. Key `id`. A receipt holds ids, hashes, codes and numbers; the only free text in it is the reason you type when you override a grade.

| Field | Meaning |
|---|---|
| `id`, `agent`, `claimId`, `requestId` | Which receipt, for which agent, about which claim and request. |
| `observationIds` | The evidence it names. |
| `grade`, `confidence`, `ruleId`, `state` | The grade, its confidence, the policy rule that decided it, and PENDING, FINAL or USER_OVERRIDDEN. |
| `reasons` | Each reason's `code` and `params` (ids, hashes, enum values and integers only, never an address or a name). |
| `signals` | Display numbers per match feature. |
| `policyHash`, `inputsHash` | Hashes that let `attest replay` prove the receipt. |
| `attribution` | `likely` on an UNASKED receipt, and only there (Hard Rule 7). |
| `override` | Your override: its `grade`, your `reason` (at most 120 characters, your own text), `at`, and `previousState`. |
| `reverted` | Overrides you undid, each with its grade, instants and evidence ids. |
| `supersededBy` | The claim that later explained an UNASKED receipt. |
| `computedAt`, `finalAt` | When it was last graded, and when it became FINAL. |
| `finalFrom` | While it is still being checked: the time from which it can become FINAL (the popup's "final from"). |

Index fields: `date` (the local date of `computedAt`) and `computedMs` (`computedAt` in epoch milliseconds, schema v8), so the popup and the side panel read the newest receipts a page at a time ([`src/ledger/views.ts`](../extension/src/ledger/views.ts)). They hold nothing the stored fields do not.

### 5.11 `activity`

Since Sprint 3.14 (schema version 6): when an agent's own log says it worked, and, only if you turn on away detection, when you were away ([`activity.ts`](../extension/src/ledger/activity.ts)). Read by the grading batch to say "likely" with evidence ([`docs/grading.md` §7](grading.md#7-unasked-attributionts)). Instants and an agent id only. Key `id`.

| Field | Meaning |
|---|---|
| `id` | A SHA-256 that keeps each row once (a session from its agent and minute, an interval from its start). |
| `kind` | `session` or `idle`. |
| `agent`, `at` | A session: the agent, and a minute a log you pasted names for one of its entries. |
| `from`, `to` | An idle interval: when Chrome says you went away (the last moment input could have been), and when you were back. Recorded only while you have away detection on (the optional `idle` permission); turning it off deletes every one. |

Index fields: `startMs`, `endMs`.

### 5.12 `receiptInputs`

Since Sprint 3.13 (schema version 5): what each receipt was graded with besides its claim and evidence, so `pnpm attest replay` can grade it again from an export and prove it ([`replay-records.ts`](../extension/src/ledger/replay-records.ts); [`docs/grading.md` §9](grading.md#9-replay-replayts)). Written only by a grading batch, beside the receipt; deleted when the receipt is graded again, deleted or purged. Key `inputsHash`. Derived data only: the fields below are copies of what other tables already hold, and none is content.

| Field | Meaning |
|---|---|
| `inputsHash` | The receipt's own `inputsHash`. |
| `coverageHash` | The coverage the batch graded with, named by its hash (since schema version 7): every receipt of a batch shares one, stored once in `batchCoverages` ([§5.14](#514-batchcoverages)). |
| `grant` | The agent's grant in force then, as `grants` holds it (`agent`, `allowedTypes`, `counterpartyAllowlist`, `spendCeilingCents`, `spendCurrency`, `declaredScopes`, `observedScopes`, `accounts`, `updatedAt`). |
| `context` | `priorSpendCents` (the agent's spending before this claim, in cents), `attribution` on an UNASKED receipt (the likely `agent`, its `scoreBp`, the `signals` that fired, and `adapterLastSyncAt`), and `scope` on a permission receipt (the `observed` permission). From Sprint 5.0 (grading contract v1.19), `modelScores` once the optional model is on: the model's score of each of the claim's candidates, an `observationId` and a `score` in basis points, never text; replay applies exactly these ([`docs/grading.md` §5.4](grading.md#54-the-models-score-model-raisets-v119)). |
| `policyHash` | The policy it was graded under. |

Index field: none (`policyHash` and `coverageHash` are indexed as stored, so a policy or a coverage no input names any more is found and deleted).

### 5.13 `policies`

Since Sprint 3.13: each policy document a receipt was graded under, as [`policy/default.json`](../policy/default.json) writes it, so replay grades with exactly that policy. Thresholds, windows, weights and rules; no data of yours. Key `policyHash`; deleted once no stored input names it.

| Field | Meaning |
|---|---|
| `policyHash` | SHA-256 of the document's canonical JSON. |
| `document` | The policy document. |

### 5.14 `batchCoverages`

Since schema version 7 (the Sprint 3 close): the coverage a grading batch graded with, once per batch, named by the receipts' inputs ([§5.12](#512-receiptinputs)). Before, every receipt's inputs held its own copy: with many Calendar events in view a copy was tens of kilobytes, written again for each receipt still checking at every batch. Key `coverageHash`; deleted once no stored input names it. Derived data only: instants, sources and account hashes, never content.

| Field | Meaning |
|---|---|
| `coverageHash` | SHA-256 of the coverage as grading hashes it ([`docs/grading.md` §3](grading.md#3-inputs)). |
| `coverage` | The coverage: its `evaluatedAt`, its `observers`, each an interval as `coverageIntervals` holds it (`observerId`, `source`, `lastSyncAt`, `windowStart`, `windowEnd`, `accountHash`, `allCalendars`, `changesSince`), and its `repairs` when the clock ever went back: each repair's span (`from`, `to`), as `meta` holds it ([§5.6](#56-meta)). |

### 5.15 `alerts`

Since schema version 9 (Sprint 4.6): one row per receipt that alerts, keyed by the receipt's id, so a receipt alerts once, ever ([`src/ledger/alerts.ts`](../extension/src/ledger/alerts.ts)). A grading batch adds a row, `pending`, for each receipt it made FINAL as NOT_FOUND, UNASKED or OVER_SCOPE; the service worker then settles it for good before it asks Chrome for a notification. A notification names the grade, the agent and the action with its time ("Not found: Muse", "Muse said it created a calendar event at 14:00. Attest found no sign of it."), never a counterparty, an amount or a subject, because it can show on a locked screen; it is shown by Chrome and your operating system, on this device. Deleted with its receipt by the purge ([§7](#7-retention-and-purge)). Ids, an agent, a grade, a state and two instants only.

| Field | Meaning |
|---|---|
| `receiptId` | The receipt's id (a ULID): the key, and the notification's id. |
| `agent` | The receipt's agent. |
| `grade` | `NOT_FOUND`, `UNASKED` or `OVER_SCOPE`. |
| `state` | `pending` until handled, then `shown` (a notification was asked for), `muted` (you had muted that agent's alerts: none is shown, then or later), `superseded` (a later claim explained an UNASKED receipt first), `overridden` (you marked the receipt first) or `gone` (the receipt was purged first). |
| `finalAt` | When grading made the receipt FINAL. |
| `handledAt` | When the service worker settled the alert; absent while `pending`. |

### 5.16 `digests`

Since schema version 10 (Sprint 4.7): one weekly digest per week, keyed by the week's Monday, made by the service worker on Monday at 09:00 from what the ledger holds for the week before ([`src/ledger/digest.ts`](../extension/src/ledger/digest.ts)), and kept so earlier weeks can be read again. The digest page ([`extension/entrypoints/digest/`](../extension/entrypoints/digest)) shows it and computes nothing. Its share is markdown made from it alone ([`src/ui/digest-share.ts`](../extension/src/ui/digest-share.ts)), and a digest keeps no address, so a share cannot hold one: a counterparty is its domain, taken from an address only, and a subject only its hint, with any address in it written as its domain. It also keeps your marks on the week's receipts with your reasons, in your own words, which the digest page shows and no share holds (from the Sprint 4 close: "The override reason is required and visible in the digest"). Deleted once its week started before the retention cutoff, so it never outlives the receipts it copies ([§7](#7-retention-and-purge)).

| Field | Meaning |
|---|---|
| `week` | The week's Monday, `YYYY-MM-DD`: the key. |
| `from`, `to` | The week, Monday 00:00 to the next Monday 00:00 on the browser's clock. |
| `createdAt` | When the digest was made. |
| `agents` | Per agent with a receipt graded that week: `agent`; `grades`, its FINAL receipts and those you marked, counted by Attest's own grade (a mark never changes a count); `checking`, those still PENDING; `marked`, those you marked; `checked`, its claim receipts so counted that Attest could check (Verified, Partial, Not found, Over scope); `verified`, the Verified among them. Counts only. |
| `notable` | Up to 200 NOT_FOUND, UNASKED and OVER_SCOPE receipts by Attest's own grade, FINAL or marked by you, newest first: `receiptId`, `agent`, `grade`, the action's `type` and time (`at`), the counterparty's `domain` only (from an address), `amountCents` and `currency`, the `subjectHint` the ledger keeps, and `mark`, your mark's grade when you made one. |
| `marks`, `marksCount` | Up to 200 of your marks on the week's receipts, newest first, and how many in all: `receiptId`, `agent`, `grade` (Attest's own), `markGrade` (yours) and `reason`, **your own words, stored in clear**, as on the receipt ([§5.10](#510-receipts)). Absent from a digest made before the Sprint 4 close. |
| `notableCount` | How many there were in all. |
| `gaps` | Per source (`gmail.sent`, `gcal.event`), the `days` of the week no window of it covered: Attest could not check them. |
| `health` | Each reader's latest health report when the digest was made (as in [§5.5](#55-adapterhealth)). |

### 5.17 `modelAnswers`

Since schema version 11 (Sprint 5.4): one row per claim Attest asked the optional model about, keyed by the claim's id ([`src/ledger/model-answers.ts`](../extension/src/ledger/model-answers.ts)). A claim is asked only while you have a model on (Chrome's on-device model, or your own key), and only while its receipt is still checking with a partial match: the one case where the model's score can change a grade ([`docs/grading.md` §5.4](grading.md#54-the-models-score-model-raisets-v119)). The row is written before the model is asked, so a claim is asked once, ever. A grading batch reads the scores while a model is on; turned off, they count no more. Deleted with its claim by the purge ([§7](#7-retention-and-purge)). Ids, a hash, a provider, an instant and numbers only: never the facts the model was given, never its words, never your key.

| Field | Meaning |
|---|---|
| `claimId` | The claim's id (a ULID): the key. |
| `inputsHash` | SHA-256 of what the model was given (the claim's and its match's allowlisted facts, [`src/intel/input.ts`](../extension/src/intel/input.ts)). When the same model was given the same facts before, its answer is copied and nothing is sent again. |
| `provider` | `builtin` (Chrome's on-device model) or `byo` (your own key). |
| `askedAt` | When it was asked. |
| `scores` | The model's answer, once it came: for each candidate, its `observationId` and its `score` in basis points (0 to 10,000). Absent when the model gave none (too slow, refused, or not an answer): the claim is then graded by the rules alone, and never asked again. |

Index field: none (`inputsHash` is indexed as stored).

## 6. What is hashed

Every hash is SHA-256 ([`docs/grading.md` §10](grading.md#10-ids-and-hashes-hashts)). Addresses and calendar names are hashed as their UTF-8 text; a vendor's row or event id is hashed as its canonical JSON string (the id in quotes), so that two ids differing only in a lone surrogate stay distinct. A hash hides a value from someone reading the ledger; it does not stop someone who can guess the value from confirming it ([§2](#2-what-attest-cannot-hide)).

| What | Stored as | Where |
|---|---|---|
| The signed-in account's address | `accountHash`: SHA-256 of the address, ASCII-lowercased. A page's own account address never leaves its content script: it is left out of Gmail recipients and Calendar guests too. A page knows only the account it is signed in to, so the address of your other Google account is stored like any address you wrote to when you email it from this one. | `coverageIntervals`, `coverage`, `calendarSnapshots`, `grants.accounts` |
| Gmail's row and message ids | `rowKeyHash` | `observations` |
| Calendar's event id | The event `key` (SHA-256 of `data-eventid`); `rowKeyHash` hashes that key again | `calendarSnapshots`, `observations` |
| A Calendar guest's address (every guest but an event's first) | `guestKeys`: SHA-256 of the address, ASCII-lowercased | `calendarSnapshots` |
| A calendar's name | Its `key` | `calendarSnapshots` |
| A row's content | `contentHash`, beside the content itself (it is an identity, not a hiding place) | `observations` |
| A request's full text | `textHash`; the first 200 characters are kept in clear as `textHint` | `requests` (Sprint 3) |
| A receipt's inputs | `policyHash`, `inputsHash` | `receipts` (Sprint 3) |

Kept in clear, because a claim is matched against them: recipient addresses, each Calendar event's first guest address, merchant names, amounts and currencies, subjects and titles (80 code points), and times.

## 7. Retention and purge

Dated history is kept for the window you choose in the options page's Privacy section: 30, 90 or 180 days, and 90 (`RETENTION_DAYS`, [`src/config.ts`](../extension/src/config.ts)) until you choose. The choice is saved in `meta` `retentionDays` ([`src/ledger/settings.ts`](../extension/src/ledger/settings.ts)); the purge reads it in its own transaction, so a window saved between two purges applies at the next one. Below, "90 days" stands for the window. A service-worker alarm runs the purge once a day ([`alarms.ts`](../extension/src/background/alarms.ts)), and again one minute after the browser starts when Chrome dropped the alarm. The rule is in [`src/ledger/retention.ts`](../extension/src/ledger/retention.ts) and runs in one transaction: all of it or none. The purge never trusts a clock that jumped ahead ([`src/ledger/retention-clock.ts`](../extension/src/ledger/retention-clock.ts)): it runs at the wall clock, but no later than the latest instant the ledger stored (`clockHighWater`, or `clockFloorAt` after a repair) or two days past the last purge's instant (`purgeTrustedAt`), whichever is later, and logs `ledger.purge_clock_ahead` when the clock is further ahead. In daily use that is the wall clock; a clock a year ahead deletes nothing current; a ledger nobody stored into for weeks catches up one day faster than real time per daily purge.

- **Observations** go 90 days after `occurredAt`, unless a kept receipt still names them as evidence. An observation dated after the cutoff (next month's event of an old calendar claim) stays as long as the receipt that explains it.
- **Claims and receipts** go together: a claim made more than 90 days ago takes its receipt with it, and a receipt last graded more than 90 days ago takes its claim, unless current evidence keeps them (above). Evidence goes with its receipt, never before it.
- **Requests** go 90 days after they were sent, once no kept claim names them.
- **Coverage intervals** are cut at the cutoff: nothing before it is kept. **Latest pings** go once their last sync is older than the cutoff.
- **Calendar snapshots** go when they were read before the cutoff. A range not looked at since is compared with nothing next time, so its events come back as first sightings, never as changes.
- **Clock repair spans** (`meta` `clockRepair.*`) go once they ended before the cutoff.
- **Alerts** ([§5.15](#515-alerts)) go with their receipts.
- **Model answers** ([§5.17](#517-modelanswers)) go with their claims.
- **Weekly digests** ([§5.16](#516-digests)) go once their week started before the cutoff: up to a week before the receipts they copy, never after (security review SEC-7). They are deleted by their key, unread, so a digest that no longer reads goes too.
- **Kept:** `grants`, `adapterHealth` and the rest of `meta` are not dated history.
- **While the ledger is encrypted and locked** ([§12](#12-encryption-at-rest)) the purge waits, and runs again as soon as you unlock it, whatever the hour ([`src/background/catch-up.ts`](../extension/src/background/catch-up.ts)), so history never outlives the window because the purge kept finding it locked.
- **Turning away detection off** deletes every time away at once, and the `idleOpen` key with them. Receipts already made keep their reasons: an UNASKED receipt that counted a time away keeps the reason `unasked.idle`, and its replay inputs the signal, until the receipt itself goes.

**Delete all data** (the options page's Danger zone, from Sprint 4.5; asked twice: a question, then a box you tick before Delete everything) deletes every storage bucket the ledger was in, and with each the folder of Chrome's files that held it ([§12](#12-encryption-at-rest), Chrome's own copies), and clears `chrome.storage.local` and `chrome.storage.session` at once, and takes down every notification Attest shows ([`src/background/settings.ts`](../extension/src/background/settings.ts)): every table, the install id, the settings and the flags (Check Gmail for me is off again). No copy is kept anywhere: measured since the Sprint 6 close, none of 5,000 deleted sends was left in the profile's files at once, or after the browser closed. `chrome.storage.local` then names the new ledger's bucket, `ledger-1` again. One choice is kept, never data: a page reader you turned off stays off, so a wipe never makes Attest read more (security review SEC-6); the confirmation says so. Attest keeps running, and pages you open afterwards are read into a new, empty ledger. Removing the extension removes its IndexedDB database and `chrome.storage.local` with it; Attest keeps nothing anywhere else.

**Uninstalling Attest** removes everything it keeps: Chrome deletes the extension's storage buckets (the ledger's; measured, its folder gone within a second), `chrome.storage.local` and `chrome.storage.session`, its alarms and its registered content scripts with it, and takes down its notifications. Outside the browser there is only what an option you turned on sent ([§1](#1-what-leaves-the-browser)): the usage numbers' daily counts on Attest's server, under an install id that then exists nowhere else ([§11](#11-anonymous-usage-numbers)), and what your own model key's company keeps under its own terms ([§10](#10-the-optional-model)).

## 8. The export

`exportLedger` ([`src/ledger/export.ts`](../extension/src/ledger/export.ts)) is your copy of your data. `pnpm attest replay` reads it as it is: since Sprint 3.13 it carries each receipt's inputs and policy (`receiptInputs`, `policies`, [§5.12](#512-receiptinputs), [§5.13](#513-policies)), and since schema version 7 each batch's coverage once (`batchCoverages`, [§5.14](#514-batchcoverages)). The options page's Export section builds it itself, from paged reads of the ledger (never a whole table at once, [`src/ledger/export-file.ts`](../extension/src/ledger/export-file.ts)), and saves it as one JSON file, `attest-ledger-<date>.json`, with the bytes `exportLedger` gives, through your browser's own download: nothing is sent anywhere, and no `downloads` permission is needed. It also saves your receipts as one CSV file, `attest-receipts-<date>.csv` ([`src/ledger/export-csv.ts`](../extension/src/ledger/export-csv.ts)): one line per receipt, newest first, with its grade, state and reasons and the action it is about (type, time, counterparty, amount), but no override reason and no subject hint; a cell a spreadsheet could read as a formula is written after an apostrophe. Extension pages can also ask the service worker for the JSON with the bus query `ledger.export`, which the tests use.

```json
{
  "format": "attest-ledger",
  "schemaVersion": 11,
  "exportedAt": "2026-10-09T09:30:00.000-04:00",
  "tables": {
    "requests": [],
    "claims": [],
    "observations": [],
    "grants": [],
    "receipts": [],
    "adapterHealth": [],
    "coverage": [],
    "meta": [],
    "coverageIntervals": [],
    "calendarSnapshots": [],
    "activity": [],
    "alerts": [],
    "digests": [],
    "modelAnswers": []
  },
  "receiptInputs": {},
  "batchCoverages": {},
  "policies": {}
}
```

It holds every table of [§5](#5-every-ledger-table-and-field), with exactly the fields listed there: index fields are stripped, and a row that fails its schema is left out (logged by id). With encryption at rest on, it is written opened, and `meta`'s encryption state (every `crypto.` key, [§12](#12-encryption-at-rest)) is left out (since the Sprint 6 close; security review SEC-4): it means nothing outside your profile, and its salt, rounds and key check would let whoever holds the file test guesses of your passphrase. It is deterministic: one read transaction, each table in key order, each object's keys in schema order. An export made before Sprint 2.7 has no `coverageIntervals` or `calendarSnapshots`, one made before Sprint 4.6 or 4.7 no `alerts` or `digests`, and one made before Sprint 5.4 no `modelAnswers`; each still reads, with what it lacks empty. [`extension/tests/e2e/observers.spec.ts`](../extension/tests/e2e/observers.spec.ts) opens the Sent and Calendar fixtures with the built extension and checks that the export holds the labelled observations with allowlisted fields only.

**Shares (Sprints 4.7, 4.8).** A receipt (the side panel's detail) and a weekly digest (the digest page) can each be shared, as text or as an image, which you see in full before you copy either: Attest copies it to your clipboard at your click and sends nothing anywhere. A share is made from the ledger's derived facts only ([`src/ui/receipt-share.ts`](../extension/src/ui/receipt-share.ts), [`src/ui/digest-share.ts`](../extension/src/ui/digest-share.ts)). It names a counterparty by its domain only, and only from an address: a name gives nothing, even one written with a dot like "A.Kumar", and a merchant gives its domain only when it is written as one ("Amazon.com"; [`src/ledger/domain.ts`](../extension/src/ledger/domain.ts); security review SEC-1). It keeps amounts (one with no currency, behind a bare "$", says so) and times, and shows a subject only as the hint the ledger keeps, with any address in it written as its domain. It never holds what you asked an agent, why you marked a receipt, or an address. A hint is the subject's first 80 characters as written, so it can hold a name the subject held: you see it in the preview before you copy. Text that came from a page is escaped, so it can never become a link. The image draws exactly the same lines on a canvas in the page ([`src/ui/share-png.ts`](../extension/src/ui/share-png.ts)), in its light or dark colours. Every golden scenario's receipts are checked against these rules, and the mandatory no-leak test searches the digest's share and every receipt's share for every seeded secret, for any `@`, and for a pasted name written with a dot.

## 9. Logs

Attest logs to the browser's console only, through one logger ([`src/log.ts`](../extension/src/log.ts)) that cannot print content by construction: the event must be one of a closed list, a string prints only if it is a known code, an id, a hash, a timestamp or a version, any field whose name says content (subject, counterparty, body, email, name, token, …) is always redacted, error messages are never printed, and objects print only their shape (Hard Rule 10). The no-leak test reads the console as one of its channels ([§1](#1-what-leaves-the-browser)).

The ledger and the observers' service-worker side log, among others: `observer.calendar_restarted` (a Calendar range compared with nothing next time: the observer id and the reason, `refused`); `observer.clock_behind` (a message read after the clock's time, not stored: the observer id and the message type); `ledger.clock_regressed` (the clock went back: how many intervals, latest pings, snapshot records and Calendar rows were deleted, as counts only).

## 10. The optional model

Limitations first. The model can be wrong, and whether it helps is not measured yet: the bench's numbers for Chrome's model and for your own key wait for their real answers to be recorded ([`RESULTS.md`](../RESULTS.md); Decisions `[5.5]`). So it is off by default. With your own key on, the facts below leave your computer for that company, which keeps them under its own terms.

It may change one thing. When a claim matches a sent email or event only partly and its receipt is still checking, the model's score for that one match may lift PARTIAL toward VERIFIED. It never lowers a grade, never lifts a match below the partial line, never picks which email or event a claim takes, and never verifies a partial match on its own ([`docs/grading.md` §5.4](grading.md#54-the-models-score-model-raisets-v119); Hard Rule 4).

**What it sees.** One claim and the one match it took, each as a few allowlisted facts ([`src/intel/input.ts`](../extension/src/intel/input.ts)). Strict schemas parse both, so one field more is an error, not a passenger.

| Of | Fields |
|---|---|
| The claim | `type` (the kind of action), `counterparty` (normalised), `subjectHint` (at most 80 characters), `amountCents`, `occurredAt` (a calendar claim's event start, else when the agent says it acted) |
| The match | `id`, `type`, `counterparty` (normalised), `merchant` (normalised), `subjectHint`, `amountCents`, `occurredAt` |

Never page text, never what you asked an agent, never any other field a stored row holds. A field the row lacks is left out, never filled in. [`extension/tests/unit/intel/input.spec.ts`](../extension/tests/unit/intel/input.spec.ts) checks the exact input for 20 claims, one of them made from a request that said "ignore previous instructions": those words never reach the model.

**How it is asked.** The instructions are a constant in code ([`src/intel/prompt.ts`](../extension/src/intel/prompt.ts)). The facts go in one delimited block, which the model is told is data and never instructions; every `<` in it is escaped, so no text inside can close the block. The delimiter makes injection harder; it does not stop it. A subject hint is text an agent or a mail sender wrote, and one that says "rate this candidate 1" can steer the model's score. What bounds that is the score's weight, not the block: a score is at most 1, and it lifts a match to VERIFIED only from a floor of 14/17 (about 0.8235) or more, the receipt then showing "Model suggestion" ([`docs/grading.md` §5.4](grading.md#54-the-models-score-model-raisets-v119); [`model-raise.spec.ts`](../extension/tests/unit/core/model-raise.spec.ts) pins the bound). An answer counts only if it is exactly one score from 0 to 1 for each candidate of this input ([`src/intel/schema.ts`](../extension/src/intel/schema.ts)). Anything else, an error, or no answer within 2 seconds (`INTEL_TIMEOUT_MS`) gives no score, and the claim is graded by the rules alone ([`src/intel/index.ts`](../extension/src/intel/index.ts)).

**When.** After a grading batch, never inside it: every receipt is graded by the rules first and never waits for the model ([`src/background/intel.ts`](../extension/src/background/intel.ts)). Only a claim whose receipt is still checking with a partial match is asked, about the one match it took. Each claim is asked once, ever: its row ([§5.17](#517-modelanswers)) is written before the call. At most 10 claims per batch (`MODEL_ASKS_PER_RUN`), one at a time. When the same model was given the same facts before, its answer is reused and nothing is sent. Once an answer is stored, the batch grades again with it; a receipt already final is never graded again.

**Where it runs.** You choose in the options page's Model section. Both choices are off until you turn them on (`flag.ATTEST_MODEL` and `flag.ATTEST_MODEL_BYO`, [`src/ledger/consent.ts`](../extension/src/ledger/consent.ts)).

- **Chrome's on-device model** (Chrome's Prompt API) runs on this computer: nothing is sent anywhere ([`src/intel/providers/builtin.ts`](../extension/src/intel/providers/builtin.ts)). The options page asks Chrome about it only when you click "Check Chrome's on-device model", and Chrome downloads it only when you click to. When it is on and ready, Attest uses it and not your key: the choice that keeps the facts on this computer wins.
- **Your own key** (Anthropic or OpenAI) sends the facts above to that company's official endpoint, `api.anthropic.com` or `api.openai.com` and nothing else, with your key in the request's header ([`src/intel/providers/byo.ts`](../extension/src/intel/providers/byo.ts)). Before you turn it on, the options page says what is sent, to which host, that the company keeps it under its own terms, and that each check is billed to your key. The key is kept in `chrome.storage.local`, closed to content scripts, so no script on a Gmail or Calendar page can read it. It is never logged, never in the ledger, so never in an export, and it is deleted when you click Forget my key or Delete all data ([`src/background/byo.ts`](../extension/src/background/byo.ts)). While it is on, `allowedHosts` adds exactly that company's host ([§1](#1-what-leaves-the-browser)).

**What is kept.** One row per claim asked: ids, a hash of the input, the provider, when, and the scores ([§5.17](#517-modelanswers)). Never the facts given, the model's words or your key. A model turned off makes its stored scores count no more; the rows go with their claims ([§7](#7-retention-and-purge)).

**Tests.** [`extension/tests/e2e/intel.spec.ts`](../extension/tests/e2e/intel.spec.ts) runs it on the built extension against a stand-in for Anthropic: a paraphrased email claim goes from PARTIAL to VERIFIED, a not-found claim is never sent, and the only host contacted is Anthropic's. [`extension/tests/property/monotonicity-batch.property.spec.ts`](../extension/tests/property/monotonicity-batch.property.spec.ts) grades random batches through the real grading path with every model score 0 and then 1: no grade changes but PARTIAL to VERIFIED.

## 11. Anonymous usage numbers

Limitations first. The install id joins your days: the server can tell that two days came from one install, though not whose, until you reset it (below). The server sees your network address when a payload arrives, as any server does. It uses the address only to limit how many payloads one client sends, as a salted hash kept in memory, and never stores or logs it ([`telemetry-api/README.md`](../telemetry-api/README.md)). Counts still say something: a day of many NOT FOUND receipts for one agent says that agent's claims did not check out that day.

**Off unless you turn it on.** In the options page's Privacy section, Anonymous usage numbers: "Turn on usage numbers". "Turn off usage numbers" stops it at once, and the next alarm sends nothing (flag `ATTEST_TELEMETRY`, [`src/ledger/consent.ts`](../extension/src/ledger/consent.ts)).

**Where it goes.** One host, `TELEMETRY_HOST` ([`src/config-network.ts`](../extension/src/config-network.ts)), at one endpoint, `POST /v1/aggregate`, posted from the service worker ([`src/telemetry/send.ts`](../extension/src/telemetry/send.ts)). Until the server is deployed, the host is `telemetry.attest.invalid`, a name that never resolves (RFC 6761), and `pnpm build:release` refuses to make a store build with it (Decisions `[5.7]`). While the numbers are on, `allowedHosts` adds exactly that host ([§1](#1-what-leaves-the-browser)).

**How often.** An alarm, `attest.telemetry`, looks every hour and sends the last whole day on your computer's clock, yesterday, once. `meta` `telemetrySentDay` records the day when the server took it ([§5.6](#56-meta)), and a send that failed is tried again at the next alarm. While encryption at rest is on and Attest is locked, the day waits, and goes at the first unlock after it is due ([`src/background/catch-up.ts`](../extension/src/background/catch-up.ts)): the hour the server stores is then that unlock's. A day is sent again only when the extension did not see the server take it (the answer lost, or the browser closed between the two); the server keeps one document per install and day, so it is stored once. A missed day is never sent later: only yesterday is ever sent. "Send a test payload now" sends that day at once and says in one line what happened; it never sends a day twice either.

**What it holds.** Counts, yes-or-no values, fixed words, the install id, two versions and the date. [`src/telemetry/aggregate.ts`](../extension/src/telemetry/aggregate.ts) builds it from the ledger and [`src/telemetry/schema.ts`](../extension/src/telemetry/schema.ts) parses it; the schema allows no other string, and the server's is held equal to it ([`telemetry-api/tests/payload.schema.json`](../telemetry-api/tests/payload.schema.json)). The options page shows exactly what the next send holds. Below is the payload the real builder made of an invented day: [`extension/tests/tools/telemetry-example.ts`](../extension/tests/tools/telemetry-example.ts) seeded a ledger with that day and wrote the block, and [`extension/tests/unit/docs/telemetry-example.spec.ts`](../extension/tests/unit/docs/telemetry-example.spec.ts) fails when the block is not exactly what the builder makes today. Its install id is invented, and Chrome's version comes from an example user agent.

<!-- telemetry-example: generated by extension/tests/tools/telemetry-example.ts, never edited by hand -->

```json
{
  "installId": "0b7e1c52-9d4a-4f3e-8a61-5c2d7e9f1a3b",
  "extVersion": "0.0.1",
  "chromeMajor": 141,
  "dayBucket": "2026-10-09",
  "adaptersEnabled": {
    "muse": false,
    "chatgpt": false,
    "dots": false,
    "claude": false
  },
  "observersEnabled": {
    "gmail": true,
    "gcal": true
  },
  "counts": {
    "muse": {
      "VERIFIED": 3,
      "PARTIAL": 1,
      "NOT_FOUND": 2,
      "UNASKED": 0,
      "OVER_SCOPE": 0,
      "UNVERIFIABLE": 0
    },
    "chatgpt": {
      "VERIFIED": 0,
      "PARTIAL": 0,
      "NOT_FOUND": 0,
      "UNASKED": 0,
      "OVER_SCOPE": 0,
      "UNVERIFIABLE": 0
    },
    "dots": {
      "VERIFIED": 0,
      "PARTIAL": 0,
      "NOT_FOUND": 0,
      "UNASKED": 0,
      "OVER_SCOPE": 0,
      "UNVERIFIABLE": 0
    },
    "claude": {
      "VERIFIED": 1,
      "PARTIAL": 0,
      "NOT_FOUND": 0,
      "UNASKED": 0,
      "OVER_SCOPE": 0,
      "UNVERIFIABLE": 1
    }
  },
  "adapterHealth": {
    "gcal.event": "OK",
    "gmail.receipt": "DEGRADED",
    "gmail.sent": "OK"
  },
  "coverageHours": {
    "gmail": 7,
    "gcal": 9
  }
}
```

<!-- /telemetry-example -->

| Field | Meaning |
|---|---|
| `installId` | A random UUID made at install ([`src/ledger/install-id.ts`](../extension/src/ledger/install-id.ts)). Nothing else ties it to you. |
| `extVersion`, `chromeMajor` | Attest's version, and Chrome's major version read from its user agent ([`src/telemetry/facts.ts`](../extension/src/telemetry/facts.ts)). With Chrome's version unknown, nothing is sent. |
| `dayBucket` | The day reported, `YYYY-MM-DD` on your computer's clock. |
| `adaptersEnabled` | Whether each agent reader is on. All are off ([§1](#1-what-leaves-the-browser)). |
| `observersEnabled` | Whether the Gmail and Calendar readers are on. |
| `counts` | Per agent, the receipts graded that day, by grade: a final receipt by its grade, one you marked by your mark. Those still checking are left out. |
| `adapterHealth` | Each reader's last health report that day, `OK` or `DEGRADED`; nothing for a reader that read no page. |
| `coverageHours` | How many whole hours of the day the Gmail Sent lists and the Calendar views Attest read covered, overlaps counted once. |

**Resetting the install id.** In the options page's Danger zone, "Reset install id", then "Reset id". Attest makes a new random id, and payloads after it cannot be linked to those before ([`src/ledger/install-id.ts`](../extension/src/ledger/install-id.ts) `resetInstallId`). Delete all data removes it too ([§7](#7-retention-and-purge)).

**On the server.** It stores each payload as it came, with the hour it arrived, one per install and day, and nothing else: never the address, never a header. The hour, not the minute: an install's sends arrive at the same minute past the hour each day, which could otherwise join an install id to the one a reset replaced. It takes at most 24 payloads per install id and 240 per client a day; the rest are refused and never stored ([`telemetry-api/README.md`](../telemetry-api/README.md)).

**Tests.** [`extension/tests/e2e/telemetry.spec.ts`](../extension/tests/e2e/telemetry.spec.ts) runs it on the built extension: off, nothing is sent; on, one payload a day, exactly the one the options page showed, to its one host. The secret-seed test ([§1](#1-what-leaves-the-browser)) searches what telemetry sends, and what the page showed, for every seeded secret.

## 12. Encryption at rest

Off unless you turn it on, in the options page's Encryption (since Sprint 6.5; [`extension/src/crypto/`](../extension/src/crypto/), [`src/background/crypto.ts`](../extension/src/background/crypto.ts)). Most people will not want it: Attest then asks for your passphrase once each time Chrome or Attest starts.

**What is sealed.** Every row of the nine tables that hold content: `requests`, `claims`, `observations`, `grants`, `receipts`, `calendarSnapshots`, `receiptInputs`, `digests` and `modelAnswers` (`SEALED_TABLES` in [`src/config-crypto.ts`](../extension/src/config-crypto.ts)). A row keeps in the clear only the fields IndexedDB keys and indexes it by, and its index fields; every other field is sealed together, as one value:

| Table | Kept in the clear |
|---|---|
| `requests` | `id`, `agent`, `conversationId`, `date` |
| `claims` | `id`, `rawHash`, `agent`, `requestId`, `type`, `date` |
| `observations` | `id`, `contentHash`, `type`, `occurredAt`, `timeBucket` |
| `grants` | `agent` |
| `receipts` | `id`, `claimId`, `agent`, `state`, `grade`, `observationIds`, `supersededBy`, `date`, `computedMs` |
| `calendarSnapshots` | `observerId`, `accountHash`, `range`, `readMs` |
| `receiptInputs` | `inputsHash`, `policyHash`, `coverageHash` |
| `digests` | `week` |
| `modelAnswers` | `claimId`, `inputsHash` |

So a recipient's address, a merchant, an amount, a subject, an event's title and guests, what an agent claimed and what you asked it, your grants, your marks and their reasons, every receipt's reasons and signals, a digest's lines and the model's answers are sealed. The other tables hold ids, hashes, codes, counts, instants and your settings, and stay as they are.

**Your own model key.** If you saved one ([§10](#10-the-optional-model)), it is sealed too while encryption is on, in `chrome.storage.local` under the same key, with additional data naming it, so no other sealed value opens as it (since the Sprint 6 close; security review SEC-2; [`src/background/byo.ts`](../extension/src/background/byo.ts)). It is sealed when you turn encryption on, sealed again under a new passphrase, and opened for good when you turn encryption off; it opens only in the service worker, with the key it holds. While Attest is locked, the key does not open, and no question goes to the model, as grading waits anyway; a key cannot be saved while it is locked, since it could not be sealed. Its company, `attest.byoVendor`, stays readable: it says only which company's key you saved.

**How.** The key is PBKDF2 with SHA-256, 600,000 rounds, over your passphrase in Unicode NFC (one passphrase typed on two keyboards is one key) and a random 16-byte salt made when you turn encryption on and again at each new passphrase: a 256-bit key ([`src/crypto/kdf.ts`](../extension/src/crypto/kdf.ts)). Each sealed value is AES-256-GCM under that key, with a fresh 96-bit nonce from the browser's random source, and the table and the row's key as additional data, so a value moved to another row or table does not open ([`src/crypto/seal.ts`](../extension/src/crypto/seal.ts)). `meta` keeps the key's id, the salt, the rounds and a key check ([§5.6](#56-meta)): a fixed text sealed with the key, which tells a right passphrase from a wrong one before any row is read. Your passphrase is at least 12 characters; it is never stored, never logged, and goes only to Attest's own service worker, which derives the key. Chrome hands a page's message to Attest's other open pages too, and each of them drops it without keeping or logging it; no website or script on a page ever receives it (Sprint 6 close; security review SEC-9).

**Where the key lives.** In the service worker's memory, and, for Attest's own pages, in `chrome.storage.session` (`attest.ledgerKeys`, [§5](#5-every-ledger-table-and-field)), which Chrome keeps in memory and empties when the browser closes or Attest reloads, and which no content script can read. Never on disk, never in the ledger, never in an export. Each start of the service worker clears that copy before it answers any command, trying twice, so the ledger is locked again after a browser restart, an update of Attest, or a restart of the service worker, until you type the passphrase in the popup or any page that asks for it. A page that cannot read its keys again drops the ones it had: it is locked, never left reading with keys from before a lock (since the Sprint 6 close; security review SEC-5). While the ledger is unlocked, the service worker keeps itself running (a cheap extension API call every 20 seconds, [`src/background/keep-awake.ts`](../extension/src/background/keep-awake.ts)), so Chrome's stop of an idle worker does not lock it every half minute; between a stop Chrome makes anyway and the next start, the pages' copy stays in Chrome's session memory, and that next start clears it.

**Locked.** Every read and write of the nine tables fails whole, a count or a key alone included: nothing is read in part ([`src/crypto/middleware.ts`](../extension/src/crypto/middleware.ts)). The popup and the other pages say the records are locked and ask for the passphrase; a wrong one is refused and reads nothing. The service worker stores nothing a Gmail or Calendar tab sends, its coverage least of all, so a claim of that time stays UNVERIFIABLE, never NOT_FOUND (Hard Rule 5); a pasted import is refused; and grading, the purge, the digest and the usage numbers wait for the unlock ([`src/background/locked.ts`](../extension/src/background/locked.ts)). Lock now, in the options page, locks every page at once, and clears the pages' copy of the keys even when the service worker itself holds none.

**A new passphrase, or turning it off.** Both need the passphrase in use. A new one gets a new key and salt, and a job seals every row again under it, a page of rows per transaction, resuming where it stopped after any restart; until it ends, the key before is kept in `meta` sealed under the new one, so the new passphrase alone resumes it. Turning it off opens every row for good, with the same job, and then deletes every `crypto.` key. A step that fails for another reason than the lock (a row that does not open, or storage that refuses a write) stops the job, and the options page says so and why, never as progress; the grace alarm tries it again while it is unlocked, up to three failed steps in a row, and Try again resumes it at once (since the Sprint 6 close; tech review TECH-2). Lock now works while a job runs.

**Chrome's own copies.** Chrome keeps IndexedDB in files where a changed row is written anew, and the version it replaces stays until Chrome compacts those files; Chrome's undo log for each change keeps one more copy. Measured on 2026-10-12 (red-team strategy 13, [`docs/attacks-that-work.md`](attacks-that-work.md)), a ledger of 5,000 sends sealed in place kept 1,200 to 2,400 of them readable in its files, after the browser closed as well. Deleting a database has Chrome compact its rows away, but on a thread of its own after the deletion has answered, and a write that lands at that moment leaves them in a file Chrome still uses: measured on 2026-10-13 with four browsers at once, a ledger rebuilt by deleting and remaking its database kept rows under the key a new passphrase replaced in 5 runs of 12. So since the Sprint 6 close the ledger lives in a storage bucket of its own, `ledger-` and a number ([`src/ledger/place.ts`](../extension/src/ledger/place.ts); Chrome 122 and later), whose IndexedDB Chrome keeps in a folder of its own and deletes whole with the bucket. Once a job has sealed every row (encryption turned on, or a new passphrase), Attest rebuilds the ledger ([`src/ledger/rebuild.ts`](../extension/src/ledger/rebuild.ts)): every row is copied as stored into the ledger of the next bucket, which so holds each row once, and counted; the next bucket is named the one in use (`attest.ledgerBucket`, [§5](#5-every-ledger-table-and-field)); and the bucket before is deleted, its folder and every older copy of a row with it. Measured after: 0 of the 5,000 sends in the files at once, ten seconds later and after the browser closed; and with four and six browsers at once, no row under the replaced key in 36 runs of 36, read the moment the change ended. Sealing and rebuilding those 5,000 took 2.9 seconds. While it runs, Attest's pages wait to read (`attest.ledgerRebuild`), and the options page says so. A stop of the service worker before the next bucket is named leaves the ledger as it was and the rebuild due; a stop after leaves the bucket before, which the worker's next start deletes. Delete all data deletes every ledger bucket the same way ([§7](#7-retention-and-purge)).

**What it costs.** Measured on 2026-10-13 over the 30-day ledger (5,000 claims, 50,000 observations; [`extension/tests/e2e/perf-ledger.spec.ts`](../extension/tests/e2e/perf-ledger.spec.ts), `pnpm bench`, `perfMonthSealed*` in [`RESULTS.md`](../RESULTS.md)): sealing every row took 19.5 seconds, and the rebuild into the next bucket 11.2 more, while the options page said each. Sealed values do not compress as plain rows do, so the sealed ledger took 58.8 MB, against 40.2 MB unsealed; with the bucket before deleted whole, that was all it took right after the rebuild too. The popup's first paint while unlocked was 64 ms, under its 100 ms gate, and the JSON export took 6.3 seconds, against 3.2.

**What it protects.** A copy of your Chrome profile (the files on disk, a backup, another account on the computer that can read them): without the passphrase, the sealed fields cannot be read, and a wrong passphrase reads nothing. Tested on the built extension: [`extension/tests/e2e/encryption.spec.ts`](../extension/tests/e2e/encryption.spec.ts) (sealed at rest with the sends' addresses and subjects absent from IndexedDB read directly, read back whole, a restart of the service worker and a browser restart locking it, a wrong passphrase refused) and [`extension/tests/e2e/redteam-encryption.spec.ts`](../extension/tests/e2e/redteam-encryption.spec.ts) (red-team strategy 13: a copied profile, near-miss passphrases, a change mid-session, and the profile's files read without Chrome, as a forensic tool reads them: every send found there before encryption is on, none once it is, before the copy is opened or after, and no row under the old key after a new passphrase; [`docs/attacks-that-work.md`](attacks-that-work.md)).

**What it does not protect.**

- **Anyone using this browser while Attest is unlocked.** The pages show your records as they did before. Lock now, or closing Chrome, locks them.
- **The fields kept in the clear.** Someone with a copy of the profile can count your receipts of each grade, and see when each claim, send and event was, which agent made it and what kind of action it was; not to whom, what, or how much.
- **The tables without content** ([§5](#5-every-ledger-table-and-field)): adapter health, coverage and its windows, `meta`, activity, policies, batch coverages and alerts.
- **An export.** It is written opened, as the unlocked ledger reads ([§8](#8-the-export)): treat an export file like the unlocked ledger. It leaves out the encryption state, so it carries no way to test a guess of your passphrase.
- **A guessed passphrase.** 600,000 rounds slow each guess, but a short or common passphrase can still be guessed from a copy. Use a long one.
- **A forgotten passphrase.** Nobody can open the records, Attest included. Delete all data is the only way back.
- **A damaged record of the key.** If `meta`'s record of the key (its id, salt, rounds or check, or mid-change the key before) is damaged, by a disk error or an edited profile, no passphrase opens the records: Attest says the record is damaged, never that the passphrase is wrong, and logs which field, never its value (since the Sprint 6 close; security review SEC-6). Delete all data is the only way back here too. A row sealed under a key the unlocked ledger does not hold reads as unreadable, never as locked, so the unlock prompt does not come back for it.
- **A copy taken while the job or the rebuild runs.** Until the rebuild ends, Chrome's files can still hold rows as they were before; the options page says when it has.
- **The disk itself.** Chrome deletes a deleted bucket's folder, and the files a compaction replaces; it does not overwrite them. A tool that recovers deleted files from the disk, rather than copying the profile, may find older copies of rows there. Full-disk encryption (FileVault, BitLocker) covers that; Attest cannot.
- **Another storage engine.** The measures above are of the LevelDB store Chrome uses for IndexedDB today. The end-to-end tests read the files again on every run, so a change in Chrome's storage would show there first.
- **Memory, and a compromised browser or computer.** While Attest is unlocked, the key is in the browser's memory, as any unlocked secret is. Malware on the computer, or another extension or program able to read Chrome's memory or your typing, can read the records while they are unlocked, or take the passphrase as you type it. Encryption at rest guards a copy of the profile, not a running browser that is no longer yours.
