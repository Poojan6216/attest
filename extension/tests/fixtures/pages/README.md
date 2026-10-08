# Observer fixtures: Gmail and Google Calendar

**Who this is for:** whoever writes or repairs the Gmail and Calendar observers (sprint 2 tasks 2.2, 2.3, 2.5, 2.7), and whoever labels a new capture.
**What you'll know after:** what each fixture shows, what an observer must produce from it, and how to write `labels.json` for a new one.

## Status

The founder's first real captures (6 October 2026, `pnpm capture --vendor gmail` and `pnpm capture --vendor gcal`; see `docs/adapters.md` §6, the capture, label, test and version loop) are in `gmail/2026-10-06/` (8 pages) and `gcal/2026-10-06/` (9 pages), labelled like the rest. The four receipt pages captured that day were held out: their bodies kept names, order numbers, a referral link and, inside compressed click links, the founder's address (security re-review). They were captured again on 7 October 2026 with the stricter sanitiser, every real value the reading found checked against the live page and faked: `gmail/2026-10-07/` (7 receipt and newsletter pages), with `gcal/2026-10-07/` (a week with an invitation open) from the same session (MANUAL.md). The loader reads only the `gmail/` and `gcal/` folders, so a capture under any other vendor name is never checked. The hand-written structural stand-ins named `synthetic-*.html` (the `2026-10-03` folders), modelled on the Gmail and Google Calendar web DOM as best known before the captures, stay as regression cases for the edge cases a real capture rarely contains, and for the receipt kinds the founder's mail does not hold (Facebook Marketplace, OpenTable) or that no capture holds yet (an Amazon order or shipping notice: the founder's account has none). `gmail/2026-10-07/` also holds one hand-written page, `synthetic-sent-draft-first.html` (task 2.10).

Everything here is a test fixture, never live data:

- Every person and personal address is fake (`@example.com`, `@example.org`, `@example.net`).
- Vendor sender addresses are kept real (`@stripe.com`, `@amazon.com`, `@facebookmail.com`, `@opentable.com`, `@instacart.com`, `@uber.com`, `@t.shopifyemail.com`), because the receipt parsers match senders. The founder's `@` check (`docs/adapters.md` §6.3) is for captures, not for `synthetic-*` files. The capture sanitiser keeps sender domains in the receipt-parser registry (`src/observers/gmail/receipts/selectors.json`) with a fake local part, and a business's display name beside them (a `+tag` machine sender, or a name holding a registry brand; never at `facebookmail.com`), so real receipt captures stay parseable, and the `@` check accepts those domains.
- Class names and `:id`s are random **per file**. An extractor that passes one fixture and fails another of the same view is anchored on a class. Anchor on `role`, `aria-*`, `data-*`, text landmarks and structure only.
- Each fixture holds exactly three seeded secrets from `tests/fixtures/secrets/seeded.json`, in visible text (drawn on screen, not only in screen-reader text), each wrapped in an element with `data-attest-seeded="<id>"`. They sit where real secrets sit (snippets, message bodies, addresses, event locations, an open event dialog), never in a field an extractor should read. A copy may also sit in hidden text the page carries anyway: a Gmail row's visually hidden summary, a Calendar chip's accessible label (where the location is, next to the title and times an extractor does read). `url_with_token` is never used, because `tests/unit/tools/capture-url.spec.ts` (SECURITY-2) forbids a token query in any committed fixture.

## The files

`gmail/2026-10-03/` (25 fixtures):

| Fixture | View | What it tests |
|---|---|---|
| `synthetic-sent-page-1.html` | Sent list, head (Newer disabled) | 10 rows, 11 observations: two recipients on one row, mixed-case address, `(no subject)`, a subject over 80 code points, an emoji subject, U+202F before AM/PM |
| `synthetic-sent-page-2.html` | Sent list, rows 11 to 20 | Rows 9 and 10 of page 1 again (same ids and fields): dedup by contentHash; not the head of the list, so rows and health OK but no coverage |
| `synthetic-sent-thread.html` | Opened sent thread | No list on the page: gmail.sent IDLE `not_sent_list`, no coverage |
| `synthetic-drafts.html` | Drafts | Negative: rows look sent but are drafts. IDLE `not_sent_folder` |
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

`gmail/2026-10-06/` (8 real captures, America/New_York, read on 6 Oct 2026 between 15:31 and 15:33):

| Fixture | View | What it tests |
|---|---|---|
| `sent-list-1.html` | Sent list, head (Newer disabled) | 50 rows: 40 conversations (a message count shown: no row); 10 one-message rows (2 with one id, 8 with an older thread id and no count), one sent only to the account (no row: the account is never a counterparty): 9 observations; the window starts after the newest conversation |
| `sent-list-2.html` | Sent list, page 2 | 33 conversations and 17 one-message rows (7 with one id, 10 with an older thread id and no count), 2 of them only to the account: 15 observations; Gmail repeats 30 rows of page 1 here, 7 of them observations (the dedup fact); not the head: health OK, no coverage |
| `sent-list-last.html` | Sent list, last page | 8 one-message rows; the shown `Older` control disabled, on this page only; rows from earlier years show a numeric date (`11/25/25`) |
| `drafts.html` | Drafts | Empty in this account: IDLE `not_sent_folder` |
| `inbox.html` | Inbox | 50 rows: IDLE `not_sent_folder`, nothing read |
| `second-account-sent.html` | Sent, `/mail/u/1/` | Second account; 17 conversations (no row) and 33 one-message rows, every one with an older thread id and no count: 33 observations; a window that starts after the newest conversation; a note after the address in the account label |
| `sent-thread.html` | Opened sent thread | No list: IDLE `not_sent_list`; the account's own message: no receipt |
| `sent-thread-with-reply.html` | Opened conversation | Three messages, two collapsed (no message key): no receipt |

`gmail/2026-10-07/` (7 real captures, America/New_York, read on 7 Oct 2026 between 18:41 and 19:35, each opened from a search, so no folder is selected and `gmail.sent` is IDLE `not_sent_folder`; and one synthetic Sent list):

| Fixture | View | What it tests |
|---|---|---|
| `receipt-stripe.html` | Opened message | Stripe receipt whose total labels sit in tables of their own beside the amounts (a row holding a row, read when exactly two of its cells hold text): one purchase |
| `receipt-instacart.html` | Opened message | "Total charged" with the items subtotal, tip and fees around it: one purchase at the charged total |
| `receipt-uber.html` | Opened message | A thread of two: a charge summary that says it is not a payment receipt (refused by its text, gmail.receipt 1.4.0), then the trip receipt: one purchase |
| `receipt-shopify.html` | Opened message | Totals in "Rs.", a sign several currencies share: no currency is guessed, DEGRADED `receipt.amount_missing`, no row |
| `receipt-generic-order.html` | Opened message | A sender outside the registry; the only amount is a fee in a sentence, on no total line: no receipt |
| `newsletter-prices-1.html` | Opened message | Negative: a promotion with a price in the subject and a discount in the body |
| `newsletter-prices-2.html` | Opened message | Negative: a sale with a promo code for everyone |
| `synthetic-sent-draft-first.html` | Sent list, head, the whole list | Task 2.10: two mails composed as drafts first (thread id older than the message id, no count shown) are rows, one with two recipients; a one-id mail is a row; a draft-first mail sent only to the account gives none; two conversations with a count (3 and 2) give none, and the window starts a minute after the newer |

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

`gcal/2026-10-06/` (9 real captures, America/New_York, the week of Sun 4 to Sat 10 Oct 2026, read on 6 Oct between 15:52 and 15:56):

| Fixture | Diff against | Expected |
|---|---|---|
| `week-before.html` | none | one event (a reservation Google added from Gmail); 3 of 9 calendars ticked |
| `week-list-not-loaded.html` | none | the calendar lists drawn but empty: still drawing, health OK, nothing read |
| `week-after.html` | week-before | one `calendar.created` (the test event, 7 Oct 15:00, no guests) |
| `week-edited.html` | week-after | one `calendar.updated` (moved to 17:00) |
| `week-deleted.html` | week-edited | one `calendar.deleted` |
| `month.html` | none | DEGRADED `event.unreadable`: month view's events cannot be placed on days yet |
| `second-calendar-on.html` | week-deleted | none (Tasks ticked, no event this week) |
| `second-calendar-off.html` | second-calendar-on | none (Tasks unticked) |
| `week-other-calendar.html` | second-calendar-off | none (a calendar under "Other calendars" ticked) |

`gcal/2026-10-07/` (1 real capture, America/New_York, read on 7 Oct 2026 at 19:58):

| Fixture | Diff against | Expected |
|---|---|---|
| `week-invited.html` | none | two events: an invitation from the founder's second account ("Needs RSVP"), whose details dialog is open over the grid and is not a chip, and the account's own reservation ("Accepted"); the week grid lists no guest, so neither has attendees (a known limit, `docs/adapters.md` §8.3) |

Event titles and calendar names are kept in the Calendar captures (the founder agreed for titles); names, addresses and amounts are faked everywhere.

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

**What the real pages showed (captures of 2026-10-06).** The selected folder's link has `tabindex="0"`, the time span's `title` and `aria-label` are absolute, an opened message's date has U+202F before AM/PM, and `data-datekey` decodes as above. Where they differ from the model:

- Gmail repeats each list row's recipients and subject anchor, ids included, in a `display: none` summary for screen readers inside the recipients cell. Only what the row shows is read.
- Most Sent rows are conversations: their thread, last and last non-draft ids differ, and their time is their newest message's. They give no row (grading contract v1.13).
- A row from an earlier year shows a numeric date (`11/25/25`, month first); the `title` stays absolute.
- An opened message's `data-legacy-message-id` sits on an element inside its `role="listitem"`, not on the item; a collapsed message carries none.
- A message opened from a search selects no folder in the nav (its page fact has no `folder`).
- The Calendar list is native `input type="checkbox"` elements labelled by `aria-label`; ticking one changes only its `checked` property, which the capture tool writes into the copy. The lists are drawn empty and fill about 9 s after the grid, and only while the tab is shown.
- A week chip's spoken label reads `<time>, <title>, <calendar>, [Accepted, ](Location: … | No location), <date>`; the event the account created has no reply word.
- A month chip is an element carrying `data-eventid` around a `role="button"`, outside any `data-datekey` cell; its day is named only by a heading's text.
- The capture keeps each element's computed styles inline and none of the page's stylesheets (a Gmail page carries about 4 MB of them).
- A redacted text is also replaced wherever else it appears: "Google", alone as a sender's name in the hidden summaries the capture redacted, reads "Glade yonder" throughout the Gmail pages, the account switcher's label included. No reader reads those words.

## `labels.json`

One file per folder, keyed by fixture file, in the capture tool's format (`tests/tools/capture-output.ts`):

```json
{ "<name>.html": { "capturedAt": "2026-10-03", "selectorsVersion": null, "seededSecrets": ["…", "…", "…"], "expected": [ … ], "notes": "…" } }
```

`expected` is a list of facts, each with a `kind`. The schema is `tests/unit/fixtures/fixture-labels.ts`. `selectorsVersion` names the selectors the facts were checked against: one `<observer>@<version>` for every observer whose `selectors.json` lists the folder in `fixtures`, sorted and separated by a space (`gmail.receipt@1.3.0 gmail.sent@1.2.0`: both Gmail observers read every Gmail page). When an observer's `selectors.json` version changes, re-check its fixtures and update every label of its folders (`docs/adapters.md` §5); `tests/unit/observers/fixture-selector-versions.spec.ts` fails until then.

| `kind` | Fields | Meaning |
|---|---|---|
| `page` | `vendor`, `view`, `folder?`, `synthetic`, `timeZone`, `readAt`, `account`, `liveUrl`, `defaultDollar?` | Exactly one, first. `timeZone` is the IANA zone time text is read in. `readAt` is the instant of the pass: its `observedAt` and the reference for relative times. `account` is the switcher's address (the observer hashes it). `liveUrl` is the address the page stands for (serve with its `#fragment` when an observer reads `location`). `defaultDollar` is what a bare `$` means. |
| `health` | `observer`, `status`, `reasons` | The status the observer reports for this page **after its pass**: IDLE by `health()` for a page it does not read (`not_sent_folder`, `not_sent_list`; nothing extracted), DEGRADED by `health()` (nothing extracted) or by a row the pass could not read (the other rows still listed). DEGRADED reason codes used: `redact.missing_occurred_at`, `window.unknown`, `receipt.amount_missing` (a total in `Rs.`, real capture of 2026-10-07) and `event.unreadable` (the real Calendar month view); gmail.sent health can also give `location.not_gmail`, `view.mismatch`, `selector.missing.*` / `selector.ambiguous.*` (main, grid, row, subject, cell, recipient, time, account) and `row.recipient_invalid`. |
| `observation` | `source`, `type`, `counterparty?`, `merchant?`, `amountCents?`, `currency?`, `subjectHint?`, `occurredAt`, `rowKey?`, `parser?`, `confidence?` | One row as `redact.project()` keeps it: the extractor passes the content fields as `raw` and `{ type, observedAt: readAt, rowKey }` as context. |
| `coverage` | `source`, `account`, `windowStart`, `windowEnd`, `allCalendars?` | A window the pass may report as seen. None when the pass is DEGRADED. |
| `dedup` | `with`, `shared` | How many of this fixture's observations project to the same contentHash as observations of `with`. |
| `event` | `rowKey`, `calendar`, `subjectHint`, `occurredAt`, `allDay`, `attendees` | Calendar: one event visible in the snapshot. |
| `diff` | `from`, `observations` | Calendar: what the snapshot diff emits when `from` was the previous snapshot of this range and this page is the current one. |

Field rules:

- `occurredAt`: ISO 8601 with the offset the page's zone has at that instant. Gmail rows use the time cell's `title`, else the relative text resolved at `readAt` (`normalize.resolveRelative`). A text that resolves only to a day gives no observation. Receipts use the opened message's date `title`, never a date in the body. Calendar events use the event start, local midnight for an all-day event.
- `subjectHint`: whitespace collapsed to one space and trimmed, then the first 80 code points (what `project()` stores). Gmail's `(no subject)` gives no `subjectHint`.
- `counterparty`: the address exactly as read (case kept, `normalize.email()` compares later). The account's own mailbox is never one, in any spelling Gmail delivers to it (it leaves the page only as a hash). One observation per recipient but the account (Gmail; a send only to the account gives none, and the window starts after it as after a conversation); one per event (Calendar), naming the event's first guest in ASCII-lowercase order (the account left out), or none; an update that added guests names the first guest it added.
- `rowKey`: Gmail list rows use `data-legacy-last-message-id`, labelled only for a row that holds one message (its thread, last and last non-draft ids are one id; a conversation row has no fact); opened messages use `data-legacy-message-id`; Calendar uses `data-eventid` as written, and its observer's row key is SHA-256 of it (core `hashRowKey`), so a Calendar observation fact projects with `rowKey = hashRowKey(rowKey)` (`tests/unit/observers/gcal/gcal-fixtures.ts` `expectedObservation`).
- Receipts: `merchant` is the business the user dealt with. A platform parser uses its canonical name (`Amazon`, `Uber`, `Instacart`, `Facebook Marketplace`). Stripe, Shopify and the generic parser use the sender's display name (for Shopify, the store), OpenTable the restaurant named in the subject. `amountCents` is the charged total in integer minor units, with `currency` in ISO 4217, shown in the message on a line that names it (`Total`, `Order total`, `Amount paid`, `Amount charged`, `Total charged`); a `listing.posted` carries the listing price. `parser` names the parser that must claim the message, and `confidence` is 0.6 for `generic`.
- Coverage, Gmail Sent: only the head of the list (`#sent`, `Newer` disabled) has a coverage fact, ending at `lastSyncAt`. It starts at its oldest visible row's minute when every `Older` control shown is disabled (the list ends on this page), else at the minute after it: a send in that minute older than the oldest row would be on the next page, unseen (`synthetic-sent-page-1.html` starts at 17:56). It starts no earlier than the minute after the newest conversation row, and after the newest row that names the account: no claim can be matched to their sends (`sent-list-1.html` starts at 09:56 on 17 Sept). A later page has none, though its rows are facts and its health is OK: in conversation view a send from its span can be listed on page 1 under a later reply's date (sprint_2 2.7). A Drafts, Inbox or opened-message page covers nothing for Sent.
- Coverage, receipts: an opened message a platform parser claims (a registry sender) has one `gmail.receipt` coverage fact whose `windowStart` and `windowEnd` are both its `occurredAt`. It says only that this message was read, nothing about the other mail around it (sprint_2 2.7). A generic receipt has none (anyone can send one: it is evidence, never coverage), and neither has a registry receipt dated in the same minute as a generic one on the same page. A page with nothing parsed has none.
- Coverage, Calendar: from 00:00 of the first visible day to 00:00 after the last, with a day that hides events behind "N more" left out (two windows, each its own coverage ping). `allCalendars` is true only when every calendar in the list is checked. A page whose every day hides events behind its own "N more", and a grid still drawing (`aria-busy="true"` or a progress bar in the main region), have no coverage fact, and their health is OK (sprint_2 2.7).
- Diffs compare events by `data-eventid`, only within calendars visible in both snapshots. An event that appears or disappears because its calendar was switched on or off is neither created nor deleted.

Fixtures are independent: only fixtures joined by a `dedup` or `diff` fact share a mailbox or calendar.

## Checks

`tests/unit/fixtures/fixture-labels.spec.ts` runs with `pnpm test`. It checks that every `labels.json` parses and names exactly the HTML beside it. It checks that each listed seed is in the page's text and that no seed or canary appears in any label string. It checks that each observation fact is one `project()` returns unchanged under `policy/default.json`, and that each fact binds to its page (row ids, addresses, subjects, event chips, the account switcher). Finally it checks that coverage only follows an OK pass, and that dedup and diff facts agree with the facts they compare. Observer tests and benches read labels through `loadVendor`, `loadLabels` and `projectArgs` from the same module.

`tests/unit/fixtures/fixture-pages.spec.ts` re-reads every fact from its page with the reference readers in `tests/unit/fixtures/fixture-page-read.ts` (times through `normalize.resolveRelative` in the page fact's `timeZone`, so the result is the same in any machine zone). The observers' accuracy numbers are measured against these labels, so a label that drifts from its page fails here:

- each seed has a marked copy drawn on screen (no ancestor `hidden`, `display: none` or clipped by a 1px rule), and no seed is listed twice;
- the live URL is on the vendor's host; a Gmail page's selected folder, `/mail/u/<n>/` path and view match its page fact;
- Gmail Sent: every row is labelled with exactly its recipients but the account, its subject and the minute its time names, or it is a conversation and has no fact, or it cannot be timed to the minute, has no fact, and the pass is DEGRADED `redact.missing_occurred_at` (`window.unknown`, no coverage); a row's visible time agrees with its title (a clock today, a date before); the window starts as the coverage rule above says and ends at `lastSyncAt` exactly when `Newer` is disabled;
- receipts: message id, subject, date `title`, an amount the message shows on a total line (any line for `listing.posted`), and the merchant the rule above names;
- Calendar: each event's start (local midnight when all day), guests and calendar match its chip label, on a checked calendar; the coverage windows are exactly the visible days minus any "N more" day, and none on a DEGRADED page or one still drawing (`stillDrawing`); `allCalendars` is true exactly when every calendar is checked; each diff lists exactly the changes the two snapshots' event facts imply (by `data-eventid`, calendars checked in both, one observation per event).

The readers parse the page model above. When a real capture shows a different shape (the chip label's wording, the time span, where the total sits), update the reader in the same change as the observer, and record the difference in Decisions.md with the capture's date (the live smoke of 2026-10-07 recorded its own under `[2.8]`).

## Resolved questions

- The capture sanitiser keeps sender domains in the receipt-parser registry (fake local part) and business display names, so real receipt captures stay parseable (2.3).
- `gmail.receipt` on a list view reports IDLE `no_conversation`, reads nothing and posts no coverage (2.3, 2.11), so no Gmail view keeps a yellow banner up for an observer with nothing to read, and a list tab never hides another tab's DEGRADED.
- A Sent page past the head of the list reports its rows, health OK and no coverage; an opened receipt reports one point of coverage at its own date (2.7). Every reason code a health fact can name is listed in `docs/adapters.md` §4.
- The generic receipt rule is tightened: a trigger, no refusal marker (promotions, cart reminders, orders still to confirm), an unambiguous total line, and no impersonation of a registry merchant (`src/observers/gmail/receipts/`). Every labelled negative stays unparsed.

## Agent fixtures: Muse (synthetic only)

`muse/2026-10-08/` holds five hand-written pages (sprint 3.1). Muse's web DOM is not known: the founder has not captured it yet and its web address is not confirmed (`MANUAL.md`), so this structure is **invented**, not modelled on a real page, and every Muse selector (`src/adapters/muse/selectors.json`) reads it until the captures replace both. The conventions above hold: fake people and addresses, class names random per file, three seeded secrets per page in visible text, each in its `data-attest-seeded` element, set where an adapter must never read (a quoted email body, an approval card's address and card number, an entry's details, the account section).

| Fixture | View | What it tests |
|---|---|---|
| `synthetic-conversation.html` | Conversation | Five requests, each answered with one action the reply claims (email, calendar event, purchase, listing, text message); "Done!" makes no claim of its own beside the action it opens; times from each message's `datetime`; a bare `$` keeps its cents and no currency |
| `synthetic-activity.html` | Activity view | Terse entries with times only as shown ("10:15 AM", "Yesterday" at day precision); a search is no claim; a draft is `other` |
| `synthetic-settings.html` | Connected apps | The five apps switched on are the scopes, in page order; one switched off is not |
| `synthetic-approval.html` | Conversation | Muse asks before it buys: one `other` claim from the chat at the proposal confidence, never `purchase.made` |
| `synthetic-business.html` | Business dashboard | Negative: a page Muse does not read, IDLE `view.unread` |

Their `labels.json` follows `tests/unit/fixtures/agent-labels.ts`: a `page` fact (vendor, agent, view, time zone, `readAt`; `liveUrl` once the host is known), one `health` fact for the adapter, then `request` facts (hint and time), `claim` facts (the sentence, type, fields, time, precision and source kind) and, on a settings page, one `scopes` fact. `tests/unit/fixtures/agent-fixtures.spec.ts` checks every page against its label (each hint and sentence is shown, each seed is drawn on screen and carried by no label, no labelled time is after `readAt`); `tests/unit/adapters/muse/muse-fixtures.spec.ts` holds the Muse adapter to them.

