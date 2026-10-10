# Threat model

**Who this is for:** anyone deciding whether to trust a receipt from Attest, and anyone changing code at one of its trust boundaries: reviewers, contributors, the security and privacy reviews.
**What you'll know after:** what Attest defends and what it does not, who it defends against, where its trust boundaries are, which links are weakest, what it assumes about your browser and accounts, and which attacks the red team found still work.

> Status: **v1** (Sprint 6, task 6.8). It describes Attest as of Sprint 6: the Gmail and Calendar readers, pasted agent activity logs (the agents' own readers are off, [Decisions `[3.10]`](../Decisions.md)), grading, the optional model and usage numbers, and the optional encryption at rest. The red team's numbers are in [`docs/attacks-that-work.md`](attacks-that-work.md); this page says what they mean.

## Contents

1. [What Attest defends](#1-what-attest-defends)
2. [What Attest does not defend](#2-what-attest-does-not-defend)
3. [Who it defends against](#3-who-it-defends-against)
4. [Trust boundaries](#4-trust-boundaries)
5. [The weakest links](#5-the-weakest-links): DOM fidelity, attribution, coverage
6. [Assumptions](#6-assumptions)
7. [The red team's results](#7-the-red-teams-results)
8. [How each Hard Rule holds](#8-how-each-hard-rule-holds)

## 1. What Attest defends

Your knowledge of what your AI agents did. For each action an agent claims, in the activity log you paste, Attest says whether your own Gmail and Calendar tabs show it: VERIFIED, PARTIAL, NOT FOUND or UNVERIFIABLE. It also marks a send no claim explains as likely UNASKED, and an action outside the grant you set as OVER SCOPE ([`docs/grading.md`](grading.md)). It defends three things:

- **The claim is checked, not believed.** A receipt grades the agent's words against evidence the agent did not write: the pages Google draws in your own tabs.
- **A guess never passes for a fact.** When Attest could not look, the receipt says UNVERIFIABLE, never NOT FOUND (Hard Rule 5). That holds when a reader is broken, when a tab was never opened, and when the ledger is locked.
- **Your data stays yours.** Attest keeps derived facts only, in your browser, and sends nothing unless you turn on an option that sends (Hard Rules 1, 2). It can seal what it keeps with a passphrase ([`privacy-architecture.md` §12](privacy-architecture.md#12-encryption-at-rest)).

## 2. What Attest does not defend

- **The action itself.** Attest never acts on a page (Hard Rule 3): it cannot stop, undo or approve anything an agent does. A receipt comes after the action.
- **A compromised browser or computer.** Malware, or another extension allowed to change Gmail's page or read Chrome's memory, can show Attest false evidence, or read its records while they are unlocked. Attest reads what the page shows ([§5.1](#51-dom-fidelity)).
- **A vendor whose page lies consistently.** If Gmail or Calendar draws a send or an event that did not happen, or hides one that did, Attest believes the page. The page is its evidence, and its trust boundary.
- **What no open tab shows.** Messenger, phone calls, purchases without an email receipt, anything on mobile, and any account never opened in this browser are invisible, and their claims are UNVERIFIABLE (the [README](../README.md)'s known limitations).
- **The agent's log.** The log you paste is the agent's claim. Attest grades it and never trusts it, but an action the log leaves out is found only by the UNASKED signals, at the rate the red team measured ([§5.2](#52-attribution-heuristics)).
- **Which account an agent used.** Attest cannot see which Google account an agent acted through, so a Sent list of any account you open can vouch for a window ([§6](#6-assumptions)).

## 3. Who it defends against

| Adversary | Wants | Attest's defence | Measured by |
|---|---|---|---|
| An agent that wants to look good | a claim counted as done, an action no one asked for unseen | grading against evidence; one observation verifies one claim ([`grading.md` §4.3](grading.md#43-assignment-one-observation-verifies-at-most-one-claim)); windows of time; grants; UNASKED signals | red team 1, 2, 4, 9, 10, 11 |
| A page that wants to deceive | false evidence, or the optional model steered | a read-only reader of Gmail's own list, DEGRADED when the page is ambiguous ([`adapters.md` §4](adapters.md#4-reading-a-degraded-reason)); strict schemas; the model only weighs a PARTIAL, under a cap | red team 5, 6, 14 |
| A vendor whose page changes | silent zeros | every pass reports its health; a DEGRADED reader is shown in the popup, and its claims stay UNVERIFIABLE (Hard Rule 6) | `adapters.md` §4 |
| Someone with a copy of your profile | your records | encryption at rest, if you turn it on | red team 13 |
| Anyone on the network | your data | nothing is sent unless an option is on; one host per option; the extension's CSP; no redirect followed | the mandatory network test |
| A content script gone wrong | facts written for another site, the ledger's keys | the sender's site checked per message ([`sender-site.ts`](../extension/src/background/sender-site.ts)); schemas on every message; commands only from extension pages; session storage closed to content scripts | the bus and router tests |

The numbers are the red team's strategies, in [`docs/attacks-that-work.md`](attacks-that-work.md#the-red-team-sprint-6).

## 4. Trust boundaries

![Attest's trust boundaries. A Gmail or Calendar tab is untrusted page content. The content script reads it read-only and sends derived facts over the typed bus to the service worker, which checks each message and is the ledger's one writer. The ledger is IndexedDB in the extension's origin, optionally sealed. The extension's pages read the ledger and send the person's commands and pasted claims. Only the person's own model key and the anonymous usage numbers, both off by default, send anything out of the browser.](assets/trust-boundaries.svg)

The diagram ([`docs/assets/trust-boundaries.svg`](assets/trust-boundaries.svg)) restates the boundaries below; where the two differ, the text wins.

1. **Page → extension.** The content script runs in the tab, in Chrome's isolated world: the page cannot call it or read its memory, but it draws what the script reads. The script only reads (the `attest/no-act` lint, [`no-act.js`](../extension/eslint-rules/no-act.js)), and keeps only the fields the policy allows for its source, some of them hashed ([`privacy-architecture.md` §4](privacy-architecture.md#4-the-policy-allowlists), [§6](privacy-architecture.md#6-what-is-hashed); [`src/core/redact.ts`](../extension/src/core/redact.ts)). Nothing else of the page crosses.
2. **Content script → service worker.** The typed bus ([`adapters.md` §9](adapters.md#9-message-bus)): every message is parsed on both ends; an observer's message is taken only from a page on that observer's own site; a command is taken only from an extension page. The service worker is the ledger's one writer, and grades with a pure core that reads no clock and no page (Hard Rule 4).
3. **Browser → network.** Crossed only by an option you turn on: your own model key, to that model company, and the anonymous usage numbers, to Attest's server. Each adds one host, the CSP allows no other, and no redirect is followed ([`privacy-architecture.md` §1](privacy-architecture.md#1-what-leaves-the-browser)).

The ledger at rest is IndexedDB in the extension's own origin: websites and other extensions cannot read it, and anyone who can read your Chrome profile can, unless encryption at rest is on ([`privacy-architecture.md` §2](privacy-architecture.md#2-what-attest-cannot-hide), [§12](privacy-architecture.md#12-encryption-at-rest)).

## 5. The weakest links

### 5.1 DOM fidelity

Attest's evidence is the page as Google draws it. Its readers pin to Gmail's own list and Calendar's own grid, and a reader that finds the page ambiguous says DEGRADED rather than guess: a fake Sent row beside Gmail's list, in a second list, in another site's frame, or hidden inside the list is never read as a send (red team 5, caught). What no reader can tell apart is a row written into Gmail's own list by a script that can change the page: such a script decides what Attest sees ([attacks that could not be tested](attacks-that-work.md#what-the-red-team-could-not-test)). That script is another extension or malware, outside what Attest defends ([§2](#2-what-attest-does-not-defend)).

### 5.2 Attribution heuristics

UNASKED is a heuristic, and says "likely" every time (Hard Rule 7). It weighs signals near a send: the agent's session, your being away, the agent's logged actions ([`grading.md` §7](grading.md#7-unasked-attributionts)). An agent that acts with no signal near its send is not flagged (red team 10, the most severe attack that works), and your own send close to an agent's busy minutes can be blamed on it (red team 15). Both are published with their rates, and the receipt never says more than "likely".

### 5.3 Coverage gaps

A window counts as read only where a reader saw it. Gmail draws the head of the Sent list only, so a send older than its oldest row is outside every window, and a claim about it is UNVERIFIABLE, never NOT FOUND (red team 8; the scroll-depth limit, [`privacy-architecture.md` §5.2](privacy-architecture.md#52-coverageintervals)). A Sent list of another account you open vouches for a window, so a true send from an account you never opened can read as NOT FOUND, the receipt saying why (red team 7). And words: a true send claimed in other words can miss its match and stay UNVERIFIABLE (red team 2), and one Gmail mailbox written with dots and without is two addresses to Attest (red team 3).

## 6. Assumptions

These are assumed, not checked. A receipt is as good as they are.

1. **One person per Chrome profile.** Whoever uses this browser while Attest is unlocked is the person its receipts are for.
2. **Your own accounts.** The Gmail and Calendar tabs you open are signed into your own Google accounts, and your agents act through those accounts. Attest binds each fact to the hash of the account its page shows, but not a claim to an account, since the agents' pages are not read ([Decisions `[1.contract]`](../Decisions.md)).
3. **Google's pages are true.** Gmail and Calendar draw what happened in your accounts ([§2](#2-what-attest-does-not-defend)).
4. **The clock is roughly right.** A clock that goes back is noticed and repaired ([`grading.md` §3](grading.md#3-inputs)); a clock set far ahead never purges current history ([`privacy-architecture.md` §7](privacy-architecture.md#7-retention-and-purge)).
5. **Your logs are the agents' own.** The activity log you paste comes from the agent's own activity view, in your time zone ([`docs/claims-import.md`](claims-import.md)).
6. **Chrome keeps its promises.** Isolated worlds, an extension origin no website or other extension can read, and a session area no content script can read behave as Chrome documents them.
7. **The browser and the computer are not compromised.**

## 7. The red team's results

The red team attacked Attest as an agent that wants to look good, a vendor that wants to hide and a malicious page would ([`agents/red_team.md`](../agents/red_team.md)): 15 strategies, each through the built extension: 13 in the harness, data exfiltration by the secret-seed test, and encryption at rest in tests beside the harness. Every attack that still works, most severe first, with what it means for a receipt:

| # | Attack that works | What a receipt says | Severity | Where |
|---|---|---|---|---|
| 10 | An agent's send it did not claim, with no signal near it | nothing: no UNASKED receipt | HIGH | [§5.2](#52-attribution-heuristics) |
| 15 | Your own send blamed on a busy agent | UNASKED, "likely", wrongly | MEDIUM | [§5.2](#52-attribution-heuristics) |
| 7 | A true send from an account whose Sent list you never opened, while another's was open | NOT FOUND, naming `coverage.account_unbound` | MEDIUM | [§5.3](#53-coverage-gaps) |
| 3 | One Gmail mailbox written with and without dots | NOT FOUND | MEDIUM | [§5.3](#53-coverage-gaps) |
| 2 | A true send claimed in other words | UNVERIFIABLE, never NOT FOUND | LOW | [§5.3](#53-coverage-gaps) |
| 8 | A false claim buried under newer sends | UNVERIFIABLE, never NOT FOUND | LOW | [§5.3](#53-coverage-gaps) |

Their rates, commits and status are in [`docs/attacks-that-work.md`](attacks-that-work.md#the-red-team-sprint-6). Caught: claim inflation (1), look-alike addresses (3), time tricks (4), DOM spoofing (5), prompt injection into the model (6), the other coverage lies (7), the other starvation cases (8), duplicate claims (9), grant bypass (11), data exfiltration (12, by the secret-seed test), encryption at rest (13) and forged evidence (14). What could not be tested, and why, is listed there too.

## 8. How each Hard Rule holds

| Hard Rule | Held by |
|---|---|
| 1. Nothing leaves the browser | [`network-intercept.spec.ts`](../extension/tests/e2e/network-intercept.spec.ts) (`@mandatory`), the CSP, and `pnpm audit:manifest` ([`scripts/audit-manifest.ts`](../scripts/audit-manifest.ts)) |
| 2. Derived facts, never raw content | the policy allowlists and [`no-leak.spec.ts`](../extension/tests/e2e/no-leak.spec.ts) (`@mandatory`) |
| 3. Attest never acts | the `attest/no-act` lint, which an inline comment cannot switch off |
| 4. `grade()` is pure | the `src/core` fences and replay ([`grading.md` §9](grading.md#9-replay-replayts)) |
| 5. UNVERIFIABLE beats a guess | the coverage rules ([`grading.md` §3](grading.md#3-inputs)); a locked ledger stores nothing a reader sends |
| 6. Fail loud | every pass's health, DEGRADED shown in the popup ([`adapters.md` §4](adapters.md#4-reading-a-degraded-reason)) |
| 7. UNASKED says likely | the receipt's words, held by the copy tests |
| 8. Minimal permissions | `pnpm audit:manifest`, in CI; each permission's reason in [`Decisions.md`](../Decisions.md) `[6.6]` |
| 9. No remote code | `script-src 'self'`, held by the audit |
| 10. Never log secrets | the closed log vocabulary ([`log-vocabulary.ts`](../extension/src/log-vocabulary.ts)) |
| 11. Read only pages you have open | content scripts on the two hosts only; Check Gmail for me, off unless you turn it on, the one tab Attest opens |
| 12. Never report an unmeasured number | [`RESULTS.md`](../RESULTS.md), generated by `pnpm bench` |
