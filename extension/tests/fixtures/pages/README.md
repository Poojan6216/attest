# Observer fixtures: Gmail and Google Calendar

**Who this is for:** whoever writes or repairs the Gmail and Calendar observers (sprint 2 tasks 2.2, 2.3, 2.5, 2.7), and whoever labels a new capture.
**What you'll know after:** what each fixture shows, what an observer must produce from it, and how to write `labels.json` for a new one.

## Status

Tasks 2.1 and 2.4 are `BLOCKED(MANUAL)` until the founder captures real pages with `pnpm capture --vendor gmail` and `pnpm capture --vendor gcal` (see `docs/adapters.md`; the loader reads only the `gmail/` and `gcal/` folders, so a capture under any other vendor name is never checked). Until then every file here is a hand-written structural stand-in named `synthetic-*.html`, modelled on the Gmail and Google Calendar web DOM as best known in October 2026. When real captures arrive they go in their own date folder beside these, labelled the same way. The synthetic files stay as regression cases for the edge cases a real capture rarely contains.

Everything here is a test fixture, never live data:

- Every person and personal address is fake (`@example.com`, `@example.org`, `@example.net`).
- Vendor sender addresses are kept real (`@stripe.com`, `@amazon.com`, `@facebookmail.com`, `@opentable.com`, `@instacart.com`, `@uber.com`, `@t.shopifyemail.com`), because the receipt parsers match senders. So the founder's `@` check in `docs/adapters.md` does not apply to `synthetic-*` files. The capture sanitiser keeps sender domains in the receipt-parser registry (`src/observers/gmail/receipts/selectors.json`) with a fake local part, and business display names beside them (never at `facebookmail.com`), so real receipt captures stay parseable.
- Class names and `:id`s are random **per file**. An extractor that passes one fixture and fails another of the same view is anchored on a class. Anchor on `role`, `aria-*`, `data-*`, text landmarks and structure only.
- Each fixture holds exactly three seeded secrets from `tests/fixtures/secrets/seeded.json`, in visible text (drawn on screen, not only in screen-reader text), each wrapped in an element with `data-attest-seeded="<id>"`. They sit where real secrets sit (snippets, message bodies, addresses, event locations, an open event dialog), never in a field an extractor should read. A copy may also sit in hidden text the page carries anyway: a Gmail row's visually hidden summary, a Calendar chip's accessible label (where the location is, next to the title and times an extractor does read). `url_with_token` is never used, because `tests/unit/tools/capture-url.spec.ts` (SECURITY-2) forbids a token query in any committed fixture.

## The files

`gmail/2026-10-03/` (25 fixtures):

| Fixture | View | What it tests |
|---|---|---|
| `synthetic-sent-page-1.html` | Sent list, head (Newer disabled) | 10 rows, 11 observations: two recipients on one row, mixed-case address, `(no subject)`, a subject over 80 code points, an emoji subject, U+202F before AM/PM |
| `synthetic-sent-page-2.html` | Sent list, rows 11 to 20 | Rows 9 and 10 of page 1 again (same ids and fields): dedup by contentHash; window ends at the newest row |
| `synthetic-sent-thread.html` | Opened sent thread | No list on the page: gmail.sent DEGRADED `not_sent_list`, no coverage |
| `synthetic-drafts.html` | Drafts | Negative: rows look sent but are drafts. DEGRADED `not_sent_folder` |
| `synthetic-inbox.html` | Inbox | Negative: an "Alex, me (2)" thread and a receipt row with an amount in its snippet |
| `synthetic-sent-account-2.html` | Sent, `/mail/u/1/` | Coverage belongs to the second account; addresses only in `title` and `data-hovercard-id` |
| `synthetic-sent-dst-auckland.html` | Sent, Pacific/Auckland | DST edge: 1:45 AM (+12:00) and 3:10 AM (+13:00) on Sun 27 Sep 2026 |
| `synthetic-sent-midnight.html` | Sent, read at 00:30 | No time title on two rows: "11:58 PM" and "Yesterday, 11:47 PM" resolve to Fri 2 Oct |
| `synthetic-sent-time-unresolved.html` | Sent | A row whose only time is "Oct 1": no observation for it, DEGRADED `redact.missing_occurred_at`, `window.unknown`, no coverage |
| `synthetic-receipt-stripe.html` | Opened message | Stripe one-off receipt, purchase.made |
| `synthetic-receipt-stripe-subscription.html` | Opened message | Stripe plan switch, subscription.changed |
| `synthetic-receipt-amazon.html` | Opened message | Order Total, not subtotal or tax |
| `synthetic-receipt-marketplace-listing.html` | Opened message | "Your listing is live", listing.posted; a $5.00 boost upsell is not the price |
| `synthetic-receipt-opentable.html` | Opened message | Prepaid reservation; the reservation time is not occurredAt |
| `synthetic-receipt-instacart.html` | Opened message | Total with fees, tip and tax |
| `synthetic-receipt-uber.html` | Opened message | Total first, breakdown after |
| `synthetic-receipt-shopify.html` | Opened message | Store order via Shopify; total carries `USD` |
| `synthetic-receipt-generic-order-confirmation.html` | Opened message | Generic positive (sender has "order") |
| `synthetic-receipt-generic-bakery.html` | Opened message | Generic positive (subject says receipt) |
| `synthetic-receipt-generic-booking-cad.html` | Opened message | Generic positive, `CA$95.00` is CAD |
| `synthetic-receipt-generic-order-eur.html` | Opened message | Generic positive, `€42,50` is 4250 EUR |
| `synthetic-receipt-negative-newsletter.html` | Opened message | Negative: prices, no order or receipt words |
| `synthetic-receipt-negative-promo-order.html` | Opened message | Negative: "Order now" subject with prices |
| `synthetic-receipt-negative-shipping.html` | Opened message | Negative: "order … has shipped", no amount |
| `synthetic-receipt-negative-no-currency.html` | Opened message | Negative: receipt subject, numbers, no currency |

`gcal/2026-10-03/` (8 fixtures, America/New_York, week of Sun 4 to Sat 10 Oct 2026 unless noted):

| Fixture | Diff against | Expected diff |
|---|---|---|
| `synthetic-gcal-week-before.html` | none | none |
| `synthetic-gcal-week-after-create.html` | week-before | one `calendar.created` (Design review with Priya, Thu 1pm) |
| `synthetic-gcal-week-unchanged.html` | week-after-create | none |
| `synthetic-gcal-week-after-edit.html` | week-unchanged | one `calendar.updated` (moved to 3pm) |
| `synthetic-gcal-week-after-delete.html` | week-after-edit | one `calendar.deleted` (Investor call) |
| `synthetic-gcal-week-two-calendars.html` | week-after-delete | no change: its two events are first sightings (allCalendars true) |
| `synthetic-gcal-week-family-hidden.html` | week-two-calendars | none: the Family calendar was switched off |
| `synthetic-gcal-month-november.html` | none | none. Month view across the US DST change (Sun 1 Nov), a day with "2 more" hidden events, an open event dialog |

Every week fixture also holds an event that crosses midnight (two chips, one `data-eventid`: one event), a recurring instance (its id carries `_<UTC instant>`), an all-day event, and a title with a comma.

## What the pages model

**Gmail.** `<title>` is `Sent - <account> - Gmail` (`Drafts - …`, `Inbox (3) - …`; an opened message shows its subject). The left `role="navigation"` holds one link per folder (`a[href$="#sent"]`, `aria-label`, `title`); the selected folder's link has `tabindex="0"`, the others `-1`. The account switcher is `[role="banner"] a[aria-label^="Google Account:"]`, whose label ends with `(<account email>)`. In `role="main"` the list toolbar has the range ("1–10 of 24") and the `Newer` and `Older` buttons (`role="button"`, `aria-disabled="true"` when off; `Newer` off means the head of the list). The list is a `table[role="grid"]` of `tr[role="row"]`, and in each row:

- the name cell (`td[role="gridcell"]`) holds a visually hidden summary of the whole row, snippet included, then `To: ` and one span per recipient with `email`, `name` and `data-hovercard-id` (on the second account, `title` and `data-hovercard-id` only);
- the subject cell holds the subject in a span with `data-thread-id`, `data-legacy-thread-id`, `data-legacy-last-message-id` and `data-legacy-last-non-draft-message-id`, then the snippet in a sibling span (the snippet is not the subject);
- the time cell holds a span with the absolute `title` ("Sat, Oct 3, 2026, 9:41 AM") and the visible text ("9:41 AM" today, "Oct 2" earlier) as `aria-label` and text.

An opened conversation has `h2[data-legacy-thread-id]` (the subject) and a `role="list"` of `role="listitem"` messages with `data-message-id` and `data-legacy-message-id`. Each message has the sender span (`email`, `name`), the date span (`title` and `alt` absolute, text like "Fri, Oct 2, 4:17 PM (18 hours ago)"), `to me` (or the recipients), then the email's own body markup.

**Google Calendar.** `<title>` is `Google Calendar - Week of October 4, 2026` (or `- November 2026`). The banner has the range text ("October 2026"), the view switcher (`aria-label="Week, open Change view menu"`) and the account switcher. The side panel (`role="complementary"`) holds a mini-month `role="grid"`, **outside** `role="main"`, and the calendar list (`role="list"`, items with `role="checkbox"`, `aria-checked`, `aria-label` = calendar name). The main `role="grid"` has `role="columnheader"` day headers (`data-datekey` and a hidden full date) and `role="gridcell"` days (`data-datekey`). Event chips are `role="button"` with `data-eventid` (base64url of `<event id> <calendar id>`) and `data-eventchip`. A chip's accessible text is its text outside the `aria-hidden="true"` part:

```
10am to 10:30am, Weekly sync, Avery Founder, Accepted, Location: …, Guests: alex.rivera@example.com, October 5, 2026
All day, Founder offsite, Avery Founder, October 9, 2026
October 7, 2026 at 11:30pm to October 8, 2026 at 12:30am, Late deploy window, Avery Founder, Accepted, Guests: …
```

The `aria-hidden` part shows the title, a short time and, on a chip whose event has a location, a location line (in the week fixtures that line holds a seeded secret). Locations hold commas, so take the title from the visible part's first line or parse the label from both ends; never take the visible part's whole text.

**Best knowledge, verify on the first real capture:** the selected-folder signal in Gmail's nav, the `aria-label` on Gmail's time span, U+202F in time titles, the `data-datekey` encoding (`((year - 1970) << 9) | (month << 5) | day`), the `Location:` and `Guests:` segments of the chip text (the sprint expects attendee emails in the label; the live page may not carry them), the range heading's markup, and whether hidden "N more" events are absent from the DOM. Live smoke (2.8) records what differs.

## `labels.json`

One file per folder, keyed by fixture file, in the capture tool's format (`tests/tools/capture-output.ts`):

```json
{ "<name>.html": { "capturedAt": "2026-10-03", "selectorsVersion": null, "seededSecrets": ["…", "…", "…"], "expected": [ … ], "notes": "…" } }
```

`expected` is a list of facts, each with a `kind`. The schema is `tests/unit/fixtures/fixture-labels.ts`.

| `kind` | Fields | Meaning |
|---|---|---|
| `page` | `vendor`, `view`, `folder?`, `synthetic`, `timeZone`, `readAt`, `account`, `liveUrl`, `defaultDollar?` | Exactly one, first. `timeZone` is the IANA zone time text is read in. `readAt` is the instant of the pass: its `observedAt` and the reference for relative times. `account` is the switcher's address (the observer hashes it). `liveUrl` is the address the page stands for (serve with its `#fragment` when an observer reads `location`). `defaultDollar` is what a bare `$` means. |
| `health` | `observer`, `status`, `reasons` | The status the observer reports for this page **after its pass**: DEGRADED by `health()` (nothing extracted) or by a row the pass could not read (the other rows still listed). Reason codes used: `not_sent_folder`, `not_sent_list`, `redact.missing_occurred_at`, `window.unknown`; gmail.sent health can also give `location.not_gmail`, `selector.missing.*` / `selector.ambiguous.*` (main, grid, row, subject, cell, recipient, time, account) and `row.recipient_invalid`. |
| `observation` | `source`, `type`, `counterparty?`, `merchant?`, `amountCents?`, `currency?`, `subjectHint?`, `occurredAt`, `rowKey?`, `parser?`, `confidence?` | One row as `redact.project()` keeps it: the extractor passes the content fields as `raw` and `{ type, observedAt: readAt, rowKey }` as context. |
| `coverage` | `source`, `account`, `windowStart`, `windowEnd`, `allCalendars?` | A window the pass may report as seen. None when the pass is DEGRADED. |
| `dedup` | `with`, `shared` | How many of this fixture's observations project to the same contentHash as observations of `with`. |
| `event` | `rowKey`, `calendar`, `subjectHint`, `occurredAt`, `allDay`, `attendees` | Calendar: one event visible in the snapshot. |
| `diff` | `from`, `observations` | Calendar: what the snapshot diff emits when `from` was the previous snapshot of this range and this page is the current one. |

Field rules:

- `occurredAt`: ISO 8601 with the offset the page's zone has at that instant. Gmail rows use the time cell's `title`, else the relative text resolved at `readAt` (`normalize.resolveRelative`). A text that resolves only to a day gives no observation. Receipts use the opened message's date `title`, never a date in the body. Calendar events use the event start, local midnight for an all-day event.
- `subjectHint`: whitespace collapsed to one space and trimmed, then the first 80 code points (what `project()` stores). Gmail's `(no subject)` gives no `subjectHint`.
- `counterparty`: the address exactly as read (case kept, `normalize.email()` compares later). One observation per recipient (Gmail); one per event (Calendar), naming the event's first guest in ASCII-lowercase order (the account left out), or none; an update that added guests names the first guest it added.
- `rowKey`: Gmail list rows use `data-legacy-last-message-id` (every fixture thread holds one message, so it equals the thread id); opened messages use `data-legacy-message-id`; Calendar uses `data-eventid` as written, and its observer's row key is SHA-256 of it (core `hashRowKey`), so a Calendar observation fact projects with `rowKey = hashRowKey(rowKey)` (`tests/unit/observers/gcal/gcal-fixtures.ts` `expectedObservation`).
- Receipts: `merchant` is the business the user dealt with. A platform parser uses its canonical name (`Amazon`, `Uber`, `Instacart`, `Facebook Marketplace`). Stripe, Shopify and the generic parser use the sender's display name (for Shopify, the store), OpenTable the restaurant named in the subject. `amountCents` is the charged total in integer minor units, with `currency` in ISO 4217, shown in the message on a line that names it (`Total`, `Order total`, `Amount paid`, `Amount charged`, `Total charged`); a `listing.posted` carries the listing price. `parser` names the parser that must claim the message, and `confidence` is 0.6 for `generic`.
- Coverage, Gmail Sent: `windowStart` is the oldest visible row and `windowEnd` the newest visible row, or `lastSyncAt` when the page is the head of the list (`Newer` disabled). A Drafts, Inbox or opened-message page covers nothing. An opened receipt covers nothing either: one message says nothing about the other messages in its span.
- Coverage, Calendar: from 00:00 of the first visible day to 00:00 after the last, with a day that hides events behind "N more" left out (two windows). `allCalendars` is true only when every calendar in the list is checked.
- Diffs compare events by `data-eventid`, only within calendars visible in both snapshots. An event that appears or disappears because its calendar was switched on or off is neither created nor deleted.

Fixtures are independent: only fixtures joined by a `dedup` or `diff` fact share a mailbox or calendar.

## Checks

`tests/unit/fixtures/fixture-labels.spec.ts` runs with `pnpm test`. It checks that every `labels.json` parses and names exactly the HTML beside it. It checks that each listed seed is in the page's text and that no seed or canary appears in any label string. It checks that each observation fact is one `project()` returns unchanged under `policy/default.json`, and that each fact binds to its page (row ids, addresses, subjects, event chips, the account switcher). Finally it checks that coverage only follows an OK pass, and that dedup and diff facts agree with the facts they compare. Observer tests and benches read labels through `loadVendor`, `loadLabels` and `projectArgs` from the same module.

`tests/unit/fixtures/fixture-pages.spec.ts` re-reads every fact from its page with the reference readers in `tests/unit/fixtures/fixture-page-read.ts` (times through `normalize.resolveRelative` in the page fact's `timeZone`, so the result is the same in any machine zone). The observers' accuracy numbers are measured against these labels, so a label that drifts from its page fails here:

- each seed has a marked copy drawn on screen (no ancestor `hidden`, `display: none` or clipped by a 1px rule), and no seed is listed twice;
- the live URL is on the vendor's host; a Gmail page's selected folder, `/mail/u/<n>/` path and view match its page fact;
- Gmail Sent: every row is labelled with exactly its recipients, its subject and the minute its time names, or it cannot be timed to the minute, has no fact, and the pass is DEGRADED `redact.missing_occurred_at` (`window.unknown`, no coverage); a row's visible time agrees with its title (a clock today, a date before); the window ends at `lastSyncAt` exactly when `Newer` is disabled;
- receipts: message id, subject, date `title`, an amount the message shows on a total line (any line for `listing.posted`), and the merchant the rule above names;
- Calendar: each event's start (local midnight when all day), guests and calendar match its chip label, on a checked calendar; the coverage windows are exactly the visible days minus any "N more" day; `allCalendars` is true exactly when every calendar is checked; each diff lists exactly the changes the two snapshots' event facts imply (by `data-eventid`, calendars checked in both, one observation per event).

The readers parse the page model above. When a real capture shows a different shape (the chip label's wording, the time span, where the total sits), update the reader in the same change as the observer, and record the difference with the live smoke (2.8).

## Resolved questions

- The capture sanitiser keeps sender domains in the receipt-parser registry (fake local part) and business display names, so real receipt captures stay parseable (2.3).
- `gmail.receipt` on a list view reports OK, reads nothing and posts no coverage (2.3), so no Gmail view keeps a yellow banner up for an observer with nothing to read.
- The generic receipt rule is tightened: a trigger, no refusal marker (promotions, cart reminders, orders still to confirm), an unambiguous total line, and no impersonation of a registry merchant (`src/observers/gmail/receipts/`). Every labelled negative stays unparsed.
