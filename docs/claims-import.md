# Claims by paste or import

**Who this is for:** whoever builds or reviews how Attest gets an agent's claims now that it reads no agent's site.
**What you'll know after:** why claims come from a log the person pastes, what Attest does with the pasted text, and the tasks that build it.

> Status: **v1 design** (8 October 2026; Decisions `[3.11]`). It replaces Sprint 3's live reading of agent pages, which Meta's, OpenAI's and Anthropic's terms forbid (Decisions `[3.10]`), with a path that needs no vendor's permission. If a vendor permits reading later, its reader is still in `extension/src/adapters/` and can be switched on beside this path.

## 1. The idea

An agent shows the person what it did: Muse keeps an activity log beside every chat, ChatGPT's agent mode lists its steps, and Claude shows each connector action in the thread. The person selects that log, copies it, and pastes it into Attest. Attest turns each reported action into a claim, checks it against the person's own Gmail Sent folder and Google Calendar as it does today, and issues receipts.

Attest never visits, reads or loads the agent's site: it has no host permission and no content script for any agent (`AGENT_READERS` in [`extension/src/config.ts`](../extension/src/config.ts)). Copying from a page you are reading and pasting into another app is ordinary use of your own screen. This is not legal advice; the vendors' terms and the reading of them are in `Decisions.md` `[3.10]`.

## 2. The flow

1. In the side panel, the person chooses **Add agent activity**, picks the agent (Muse, ChatGPT or Claude) and pastes.
2. Attest parses the text in the side panel itself, nowhere else ([§3](#3-parsing-a-pasted-log)).
3. It shows a preview: each claim it read (type, who or what, time) and each line it could not use and why, such as "no time" or "a proposal, not an action".
4. The person confirms. The side panel sends the claims, never the text, to the service worker as a `claims.import` message; the service worker stores and grades them ([§5](#5-storing-and-grading)).
5. The pasted text is dropped as soon as the preview closes. It is never stored, logged or sent anywhere (Hard Rules 1, 2 and 10).

## 3. Parsing a pasted log

The parser is pure and has no DOM: text in, an `AgentRead` out, the same shape an agent adapter returns ([`extension/src/adapters/types.ts`](../extension/src/adapters/types.ts)). From there the existing claim builder ([`claims.ts`](../extension/src/adapters/claims.ts)) and pattern tables ([`patterns.ts`](../extension/src/adapters/patterns.ts)) do what they already do: one claim per reported action of an ActionType, at most one `other` for an entry that reports none, ids and `rawHash` per [`docs/grading.md`](grading.md) §10. So pasting the same log twice adds nothing new.

- **Entries.** A log is read as entries of one to three lines: an optional title, the sentence that says what was done, and then a time on a line of its own, as Muse's activity log shows them. A line that starts with a time and a separator ("4:33 PM · Sent the invoice") is an entry by itself, as a list of steps shows one. A day heading ("Today", "Yesterday", a weekday, or a date such as "Oct 6" or "Tuesday, October 6") applies to the entries under it until the next heading. A blank line ends an entry.
- **Times.** A time ("4:33 pm", "16:33") is read in the person's time zone on the day its heading names, at minute precision; a time that names its own day ("Yesterday, 4:33 pm", "5 minutes ago") is read as written. An entry under a day heading with no time of its own is read at day precision. A time anywhere else in a line ("for Friday at 12:30 pm", "9:00 - 9:30") is part of the text, never the entry's time. The day comes only from the paste, because a claim at a guessed time could end NOT_FOUND (Hard Rule 5):
  - a time with no day heading above it is shown as **no day**, and so is a time under a heading that names a period or a date in digits ("Earlier", "Previous 7 days", "10/6/2026"); the person can copy the day heading with the entries;
  - an entry with neither a time nor a heading, an entry right above a day heading (that day could be its own time or the next section's heading), and a time after the paste are shown as **no time**.

  Neither is imported. A time that happened twice as the clocks went back is read as its whole day.
- **The moment of the paste.** "Today", "4:33 pm" and "5 minutes ago" are read against the moment of the paste, so a log is pasted soon after it is copied. The preview shows each claim's date and time before the person confirms.
- **What each entry claims** is decided by the pattern tables: "Sent the invoice to sam@example.com" is an email sent; "Should I book it?" or "Waiting for your approval" is a proposal (`other`); "Searched for flights" is no claim.
- **Kind and provenance.** Every imported claim has `sourceKind: activity_view` and extractor `import.<agent>` with the parser's version. Its confidence is the pattern's.
- **Limits.** At most 100,000 characters per paste and `SCHEMA_LIMITS.BATCH` claims per import. A longer paste is refused with a message saying so, never cut silently.

## 4. Privacy and security

- The paste box is in the side panel, an extension page. No content script, no host permission and no network are involved, and the network-intercept test still holds.
- Only claims cross to the service worker, as a strict Zod schema (`claims.import`, accepted from extension pages only, as `ui.query` is). The claim fields are the ones a claim already has: type, counterparty, a subject hint of at most 80 characters, amount, times and hashes.
- Logging names events and counts only, never the text (Hard Rule 10). A secret-seed test pastes the seeded secrets and finds none in storage, logs or exports.

## 5. Storing and grading

The service worker stores each claim (`upsertClaim`), builds candidates from the Gmail and Calendar observations already in the ledger, grades with `gradeBatch` and stores the receipts. A PENDING receipt is finalised by the grace alarm, and orphan observations become UNASKED receipts (`attribution.ts`). This is the background wiring Sprint 3.6 planned, now fed by imports instead of a content script. Agent session pings are not available without reading the agent's site, so `agentSessionActive` never fires and UNASKED attribution rests on the other signals.

## 6. What this path does not do (yet)

- **Requests** (what the person asked) are not imported: an activity log shows what was done, not what was asked.
- **Scope snapshots** (connected apps) come from settings pages, which are not read. Pasting the connected-apps list is a later addition.
- **File import** of a vendor's own export comes when a vendor offers an export.

## 7. Tasks

| Task | What | Done when |
|---|---|---|
| 3.11 | The paste parser: text → `AgentRead` → claims, with the rules of §3 | Unit and property tests over invented logs of each agent's shape: entries, headers, times, proposals and chatter; re-pasting adds no claim; a time after the paste and a log over the limit are refused |
| 3.12 | The side panel's **Add agent activity**: paste, preview, confirm | Component tests for every preview state; keyboard and screen-reader labels; the text is gone once the preview closes |
| 3.13 | `claims.import` and the service worker: store, grade, receipts, grace alarm, UNASKED | Unit tests per step; a service worker stopped mid-grace still finalises (the 3.6 rule) |
| 3.14 | End to end | In the built extension, pasting the §2 demo's log with the Gmail Sent and Calendar fixtures gives exactly VERIFIED, NOT_FOUND (after a simulated grace) and UNASKED; the no-leak test covers the paste |
