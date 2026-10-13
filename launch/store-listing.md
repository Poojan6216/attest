# Chrome Web Store listing (draft)

**Purpose:** the text and pictures of Attest's Chrome Web Store listing, ready to paste and upload. Started 2026-10-10 (sprint_6 6.6) with the permission justifications; 6.7's privacy pre-review ([`reviews/sprint_6/privacy.md`](../reviews/sprint_6/privacy.md)) added the single purpose, the Limited Use disclosure, the audience and the privacy form's draft answers; 2026-10-13 (sprint_7 7.4) added the name, the summary, the description, the category, the screenshots and the promo tile, and re-checked the data answers against the code.

## Name and summary

The store takes both from the manifest the build makes ([`extension/wxt.config.ts`](../extension/wxt.config.ts)), so they are written there, and a test holds this file to them.

- **Name:** Attest — receipts for your AI agents
- **Summary** (132 characters at most): Checks what your AI agents say they did against your own Gmail and Calendar tabs. Nothing is sent unless you opt in.
- **Category:** Productivity → Tools
- **Language:** English

## Description

In the launch engineer's order: the privacy line, the single purpose, what it checks, then what it cannot do, which is `build_spec.md` §11.

Nothing leaves your browser unless you turn on an option that sends. Attest reads your Gmail and Google Calendar tabs on your computer, keeps what it finds in your browser, and never clicks, types or sends anything on a page. Two options send something, both off until you turn them on: your own Anthropic or OpenAI key, for a second opinion on partial matches, and anonymous daily usage numbers, counts only.

Attest checks what your AI agents say they did against your own Gmail and Google Calendar tabs, and keeps a graded receipt for each claim, in your browser.

Paste an agent's activity log (Meta Muse, ChatGPT and Dots, Claude) into Attest's side panel. Attest compares each claim with what it saw in your Gmail Sent folder, the receipt emails you open and your Calendar, and grades it: Verified, Partial, Not found, Over scope (outside the grant you set for that agent) or Unverifiable. A send nobody claimed, made while an agent was working or you were away, is marked Unasked, likely agent. Every receipt shows its evidence, alerts tell you when one needs a look, and a weekly digest sums up each agent's week.

What Attest cannot do. It sees only tabs you have open: actions inside Messenger, phone calls, purchases without an email receipt and anything on your phone are invisible to it, and those receipts say Unverifiable. "Likely agent" is the strongest claim it makes, since it cannot prove who pressed send. Vendor pages change; when a reader stops matching, Attest marks it degraded and tells you. It does not read your AI agents' own pages, as their makers' terms forbid it, so you paste their logs. Desktop Chrome only. The attacks that still work against it are published with their rates in the project's docs/attacks-that-work.md.

## Screenshots and promo tile

Made by `pnpm record-screenshots` on the built extension and saved test pages with invented names ([`scripts/record-screenshots.ts`](../scripts/record-screenshots.ts)); before each one, the page's text is searched for every seeded secret and every address in it must be at a reserved example domain. Each screenshot is 1280×800 with its caption at the foot.

| File | Shows | Caption |
|---|---|---|
| [`screenshots/1-receipts.png`](screenshots/1-receipts.png) | The popup: the email Verified, the event Not found, a vendor send Unasked, likely agent | Today’s receipts: what each agent said it did, against your own Gmail and Calendar tabs. |
| [`screenshots/2-receipt-detail.png`](screenshots/2-receipt-detail.png) | The side panel's detail of the Unasked receipt, with its evidence | Each receipt shows its evidence, and says “likely” when it cannot prove who acted. |
| [`screenshots/3-grants.png`](screenshots/3-grants.png) | The options page's grant for Muse, saved | Grants say what each agent may do; a claim outside them is marked Over scope. |
| [`screenshots/4-degraded.png`](screenshots/4-degraded.png) | The popup's degraded banner for the Gmail Sent reader | When a page changes and a reader stops matching, Attest says so instead of going quiet. |
| [`screenshots/5-digest.png`](screenshots/5-digest.png) | The weekly digest | The weekly digest: what each agent claimed, and what Attest found. |

- **Small promo tile** (440×280): [`promo-tile.png`](promo-tile.png), the icon, the name and "Receipts for your AI agents".
- **Icon** (128×128): `extension/public/icon/128.png`, rendered from [`extension/assets/icon.svg`](../extension/assets/icon.svg) by `pnpm render-icons`.

## Permission justifications

One line each, for the listing's "Why" field. Each matches the manifest the build makes, which `pnpm audit:manifest` checks in CI ([`scripts/audit-manifest.ts`](../scripts/audit-manifest.ts)), and its entry in [`Decisions.md`](../Decisions.md) (`[6.6]`).

| Permission | Why Attest asks for it |
|---|---|
| `storage` | Keeps Attest's install id and, while you have saved one, your own model key on this computer, closed to the pages you visit; and, in Chrome's session memory, which empties when the browser closes, the key of an encrypted ledger while it is unlocked. |
| `alarms` | Runs Attest's checks on a schedule: grading, the daily purge of old history, the weekly digest and the opt-in usage numbers. |
| `scripting` | Starts and stops the Gmail and Calendar readers when you turn each one on or off in the settings. |
| `notifications` | Shows one alert on this computer when a receipt ends Not found, Unasked or Over scope; it never names a person, an amount or a subject. |
| `sidePanel` | Opens the timeline of receipts in Chrome's side panel. |
| `idle` (optional) | Asked for only when you turn on away detection: knowing you were away from the computer helps tell an agent's action from yours. |
| `https://mail.google.com/*` | Reads your Gmail Sent folder and the receipt emails you open, in tabs you have open, to check what your agents say they sent or bought. |
| `https://calendar.google.com/*` | Reads the Google Calendar views you open, to check the events your agents say they created or changed. |

## Single purpose

Attest checks what your AI agents say they did against your own Gmail and Google Calendar tabs, and keeps a graded receipt for each claim, in your browser.

Every feature serves it: the readers of your Gmail and Calendar tabs gather the evidence; the side panel takes your agents' activity logs and shows the receipts; alerts, the weekly digest and shares report receipts; the grants say what each agent may do; the optional model and the anonymous usage numbers, both off by default, help grade and measure grading; encryption at rest, export and Delete all data look after what the receipts are made from.

## Limited Use

Data read from your Gmail and Calendar tabs, and from the activity logs you paste, is used only to make your receipts. It is stored in your browser, never sold, never used for advertising, credit or any other purpose, never used to train a model, and never transferred, except by an option you turn on that sends: your own model key (a few facts about one claim, to the AI company your key is for) and the anonymous usage numbers (counts only). The privacy policy says the same, under "Limited Use" ([`PRIVACY.md`](../PRIVACY.md)).

## Audience

Adults who use AI agents with their own Gmail and Google Calendar. Not directed at children.

## Privacy practices form (draft answers; the founder certifies them)

- **Single purpose:** the sentence above.
- **Permissions:** the table above.
- **Remote code:** no. The extension's pages run only its own scripts (`script-src 'self'`), checked by `pnpm audit:manifest`.
- **Data the developer collects:** none by default. With the anonymous usage numbers on (off by default): one payload a day of counts about the day before (receipts by grade and agent, which readers are on and whether each is working or degraded, hours checked), the extension and Chrome versions, the date and a random, resettable install id; no address, name, subject, amount or page ([`docs/privacy-architecture.md` §11](../docs/privacy-architecture.md#11-anonymous-usage-numbers)).
- **Data sent to a third party you choose:** with your own model key on (off by default), for a claim still checking with a partial match: the claim's kind, counterparty, short subject, amount and time, and the same for the one email or event it partly matched, with Attest's id for it and, for a purchase, the merchant, go to Anthropic or OpenAI, whichever company the key is for, under that company's terms ([§10](../docs/privacy-architecture.md#10-the-optional-model)). Attest's maker receives none of it. Whether the form counts this as collection, and under which categories (personally identifiable information, personal communications, financial information, website content), is the founder's call when filling it in; the cautious answer declares them, as sent only with the user's own key, opt-in.
- **Certifications:** Attest does not sell or transfer user data outside the approved uses, does not use or transfer it for anything but its single purpose, and does not use or transfer it to decide creditworthiness or for lending.
- **Privacy policy URL:** not set yet. `PRIVACY.md` needs a public address first (MANUAL.md, Sprint 6).
