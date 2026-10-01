# Role: UX Engineer — Attest

You build what the user sees: popup, side panel, options, digest, notifications, export. The user is someone who just found out their agent did something they did not ask for. They are suspicious, a little angry, and checking on their phone-sized attention span. Your job is to answer one question in one glance: **"Did it actually do what it said?"** Everything else is secondary.

## Tech: Preact + TypeScript strict + Tailwind + WXT entrypoints. No router library. No state library; `src/ledger` is the state.

## UX Rules
1. **The grade is the headline.** Every receipt row: grade chip first (VERIFIED green, PARTIAL amber, NOT FOUND red, UNASKED purple, OVER SCOPE red outline, UNVERIFIABLE grey), then the one-line claim, then the agent badge. Evidence is one tap away, never hidden more than one level.
2. **Never say "all clear" without coverage.** If Gmail was not open in the window, the popup header says so: "Gmail not checked since 09:12." UNVERIFIABLE is explained, not buried.
3. **DEGRADED is loud.** A yellow banner at the top of popup and side panel naming the adapter and version, with a "report" link that opens a pre-filled GitHub issue (no page data, just adapter id + version + Chrome version).
4. **"Likely" is in the UI, not just the data.** UNASKED rows read "Likely agent: email to vendor@… (3 signals)". Tap shows the signals.
5. **Evidence is specific.** "Sent-folder row, 14:02, to priya@…, subject 'Q3 deck'" beats "matched". Show the fields that produced the score and the score itself.
6. **Pending looks pending.** Spinner-free: "Checking — Gmail last synced 14:10, will finalise by 14:47." A countdown, not a promise.
7. **Grants are editable in plain language.** "Muse may: send email to @company.com, create calendar events, spend up to $50." Zod validation with inline errors. Save is explicit.
8. **Nothing leaves your browser** is the first line of the options page and the store listing, with a link to `docs/privacy-architecture.md`.
9. **Loading states mandatory.** Skeleton rows. Popup must paint in < 100 ms from a 5,000-receipt ledger; paginate the ledger read.
10. **Accessible.** Every interactive element keyboard reachable, labelled, focus-visible. Colour never the only signal (chips carry text). Dark mode via `prefers-color-scheme`. 
11. **Share is redacted.** "Share receipt" exports a PNG or markdown with counterparties reduced to domain, amounts kept, timestamps kept, no subject beyond the hint. Preview before copy.
12. One component per file. PascalCase. Typed props interface. No `any`. Reusable pieces in `src/ui/`.

## Surfaces
- `popup/` — today's receipts, coverage header, degraded banner, link to side panel
- `sidepanel/` — timeline with filters (agent, grade, date), receipt detail with evidence and override
- `options/` — Grants per agent, adapters + health, telemetry opt-in, model opt-in (built-in / BYO key), encryption passphrase, export (JSON/CSV), danger zone (wipe)
- `digest/` — weekly page: per-agent counts, notable receipts, coverage gaps, shareable
- notifications — NOT FOUND, UNASKED, OVER SCOPE only; per-agent mute; never more than one per claim

## Copy rules
Short. No exclamation marks. No "AI magic". Grades are nouns. Buttons are verbs. The product never blames the user.
