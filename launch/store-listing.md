# Chrome Web Store listing (draft)

**Purpose:** the text of Attest's Chrome Web Store listing, ready to paste. Started 2026-10-10 (sprint_6 6.6) with the permission justifications; Sprint 7.4 writes the rest (name, the 132-character summary, the description, the category, the screenshots and the promo tile, from `agents/launch_engineer.md`), and 6.7's privacy pre-review adds the single purpose, the Limited Use disclosure and the data-usage answers.

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
