# Chrome Web Store listing (draft)

**Purpose:** the text of Attest's Chrome Web Store listing, ready to paste. Started 2026-10-10 (sprint_6 6.6) with the permission justifications; 6.7's privacy pre-review ([`reviews/sprint_6/privacy.md`](../reviews/sprint_6/privacy.md)) added the single purpose, the Limited Use disclosure, the audience and draft answers to the privacy practices form; Sprint 7.4 writes the rest (name, the 132-character summary, the description, the category, the screenshots and the promo tile, from `agents/launch_engineer.md`).

## Permission justifications

One line each, for the listing's "Why" field. Each matches the manifest the build makes, which `pnpm audit:manifest` checks in CI ([`scripts/audit-manifest.ts`](../scripts/audit-manifest.ts)), and its entry in [`Decisions.md`](../Decisions.md) (`[6.6]`).

| Permission | Why Attest asks for it |
|---|---|
| `storage` | Keeps Attest's install id and, while you have saved one, your own model key on this computer, closed to the pages you visit. |
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
- **Data the developer collects:** none by default. With the anonymous usage numbers on (off by default): one payload a day of counts about the day before (receipts by grade and agent, readers on, hours checked), the extension and Chrome versions, the date and a random, resettable install id; no address, name, subject, amount or page ([`docs/privacy-architecture.md` §11](../docs/privacy-architecture.md#11-anonymous-usage-numbers)).
- **Data sent to a third party you choose:** with your own model key on (off by default), for a claim still checking with a partial match: the claim's kind, counterparty, short subject, amount and time, and the same for the one email or event it partly matched, go to Anthropic or OpenAI, whichever company the key is for, under that company's terms ([§10](../docs/privacy-architecture.md#10-the-optional-model)). Attest's maker receives none of it. Whether the form counts this as collection, and under which categories (personally identifiable information, personal communications, financial information, website content), is the founder's call when filling it in; the cautious answer declares them, as sent only with the user's own key, opt-in.
- **Certifications:** Attest does not sell or transfer user data outside the approved uses, does not use or transfer it for anything but its single purpose, and does not use or transfer it to decide creditworthiness or for lending.
- **Privacy policy URL:** not set yet. `PRIVACY.md` needs a public address first (MANUAL.md, Sprint 6).
