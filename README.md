# Attest

[![ci](https://github.com/Poojan6216/attest/actions/workflows/ci.yml/badge.svg)](https://github.com/Poojan6216/attest/actions/workflows/ci.yml)

Receipts for your AI agents.

**Who this is for:** anyone deciding whether to install Attest, and anyone who wants to build it or check its claims.
**What you'll know after:** what Attest checks and what it cannot see, how to install it, what it sends and when, how well it does, which attacks still work, and how to contribute.

Attest is a Chrome extension that checks what your AI agents (Meta Muse, ChatGPT and Dots, Claude) said they did against evidence in your own Gmail and Google Calendar tabs, and gives every task a graded receipt: verified, partial, not found, unasked, over scope, or unverifiable. It runs in your browser, sends nothing unless you turn on an option that sends, and never acts on any page. **Attest cannot see everything.** It sees only what is in tabs you have open: actions inside Messenger, phone calls, purchases without an email receipt, and anything on your phone are invisible to it, and those receipts say UNVERIFIABLE. When it flags something you did not ask for, it says "likely agent", because it cannot prove who pressed send. It does not read your AI agents' own pages, because their makers' terms do not allow it: you paste an agent's activity log into Attest instead. Vendor pages change; when a reader stops matching, Attest marks it DEGRADED and tells you instead of going quiet. Dots requires a Pro tier, so a pasted Dots log is read with ChatGPT's phrases until a real one has been seen. The optional on-device model depends on your Chrome and your computer; without it, Attest grades by its rules alone and says so. Desktop Chrome 122 or later only.

**Attacks that still work.** Attest has been attacked on purpose, and 6 of the 13 attack strategies in its red-team harness still win in some cases: worst, an agent's send it never claimed goes unflagged in 18 of 25 cases. Every attack, its rate and why it works: [docs/attacks-that-work.md](docs/attacks-that-work.md). What Attest defends and what it does not: [docs/threat-model.md](docs/threat-model.md).

![The demo, in six captioned frames: you ask Muse to email Priya the Q3 deck and put a review on the calendar; Muse's activity log is pasted into Attest's side panel; Attest reads the Gmail Sent folder and the Calendar week, saved test pages with invented names; the popup shows the email Verified, the event Not found and a send to a vendor nobody asked for Unasked, likely agent; the weekly digest sums up the week.](launch/demo.gif)

The demo runs on saved test pages with invented names, and is remade by `pnpm record-demo`.

## Install

- **Chrome Web Store:** not listed yet. This line will link to the listing once it is published.
- **From source** (Node 22 and pnpm): `pnpm install`, then `pnpm build`. In `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `extension/.output/chrome-mv3/`. Open a Gmail Sent folder or a Google Calendar week in a tab, paste an agent's activity log into Attest's side panel ("Add agent activity"), and the popup shows the receipts.

## Nothing leaves your browser unless you turn it on

With every option off, Attest makes no network request. Two tests enforce it on every build, both tagged `@mandatory`, and CI fails if either does not run and pass:

- [`extension/tests/e2e/network-intercept.spec.ts`](extension/tests/e2e/network-intercept.spec.ts), "nothing leaves the browser": records every request the extension makes during a scripted session and fails if any host outside an empty allowlist is contacted.
- [`extension/tests/e2e/no-leak.spec.ts`](extension/tests/e2e/no-leak.spec.ts), "no seeded secret leaks": plants invented secrets in the pages Attest reads and searches the export, IndexedDB, storage, the console and the network for them.

Two options send something, each off until you turn it on, and each adds exactly one host while it is on:

- **Your own model key** (Options, Model): a claim's kind, recipient, short subject, amount and time, and the same for the email or event it partly matched, with Attest's id for it and, for a purchase, the merchant, go to Anthropic or OpenAI, whichever the key is for. Never a page, never what you asked an agent.
- **Anonymous usage numbers** (Options, Privacy): once a day, counts about the day before, a random install id, the versions and the date go to Attest's telemetry server, which publishes totals across all installs a month at a time, never one install's. No address, name, subject or amount.

The extension's content security policy lets it reach those hosts and no other, a redirect's target included, and every page says which option is on. A third option, also off by default, seals what Attest keeps about your messages and events with a passphrase ([what it protects and what it does not](docs/privacy-architecture.md#12-encryption-at-rest)). The full account: [PRIVACY.md](PRIVACY.md) and [docs/privacy-architecture.md](docs/privacy-architecture.md).

## What it checks

Each claim an agent makes is matched against what Attest saw in your Gmail and Calendar tabs, and the receipt carries the evidence. The grades ([docs/grading.md §2](docs/grading.md#2-grades-and-states)):

| Grade | Means | Never means |
|---|---|---|
| Verified | Evidence Attest saw itself matches the claim. | That the agent told the truth in any wider sense. |
| Partial | Some evidence matches, not enough to verify; the receipt names what matched and what did not. | A soft fail. |
| Not found | Every relevant reader saw the whole window of the claim, after a grace period, and nothing matched. | "Not found yet": with part of the window unseen, the grade is never Not found. |
| Unasked (likely agent) | An action happened that no claim explains, and signs say an agent likely did it. | Proof of who did it. |
| Over scope | The claimed action is outside the grant you gave the agent: its kind, who it was for, or how much it spent. | That the action was harmful. |
| Unverifiable | Attest could not see enough to judge: no reader for that kind of action, a tab not open over the window, or a claim too vague to match. | Anything about the agent. |

A receipt waits as Pending until the grace period has passed, and you can mark any receipt yourself; your mark is kept beside Attest's grade, never in place of it.

## What it cannot see

These are limits of the design, documented rather than fixed (`build_spec.md` §11):

- Attest sees only what is in open tabs. Actions inside Messenger, phone calls by an agent, purchases without an email receipt, and anything on mobile are invisible. The receipt says UNVERIFIABLE.
- Attribution of UNASKED actions is a heuristic. "Likely agent" is the strongest claim Attest ever makes.
- Vendor UIs change. Readers will break. Health checks make breakage loud; they do not make it rare.
- Reading a vendor's activity page is reading their UI. Each vendor's terms were read and recorded in `Decisions.md`; Meta's, OpenAI's and Anthropic's forbid automated collection, so the readers of agents' pages ship off, and you paste an agent's log instead.
- Dots requires a Pro tier. Until a Dots fixture exists, the Dots reader is built against the ChatGPT surface and flagged.
- Desktop Chrome only. Muse is mobile-first; phone-only users are not served in v1.
- The optional on-device model depends on your Chrome and hardware. When it is unavailable, Attest is rules-only and says so.

## Results

Measured by `pnpm bench` on one Mac (Chrome 153), each number copied from [`RESULTS.md`](RESULTS.md), which the bench generates and CI holds to its result files. The readers are measured on saved pages labelled by hand; the pasted logs and the action phrases on invented text.

| What | Result | Limit |
|---|---|---|
| Gmail Sent reader (`gmail-sent`) | 108 of 108 labelled sends read, 324 of 324 fields right | 95% |
| Calendar reader (`gcal`) | 67 of 67 labelled events found, 0 spurious, 335 of 335 fields right | 95% |
| Receipt emails (`receipts`) | field accuracy 1 on every kind of receipt saved; 7 of 7 emails that are not receipts left unread | every labelled receipt exact, no other email read |
| Pasted activity logs (`paste`) | 111 of 111 fields right over 4 invented logs | 95% |
| Action phrases (`patterns`) | 0.9559 of 68 Muse sentences given the right kind of action, 0.9552 for each other agent, 0 wrong actions | 90% |
| Grading (`core`) | 5000 claims against 50000 observations in 1446.9 ms of CPU | 2000 ms |
| Popup (`popup`) | first paint 60 ms over 5000 receipts | 100 ms |
| A month of use (`perf`) | 40208677 bytes in Chrome, popup first paint 60 ms | 50000000 bytes, 100 ms |
| Gmail Sent pass (`perf`) | 776.2 ms over 10000 rows | 2000 ms |
| Red team (`redteam`) | 131 cases in 13 strategies; 6 strategies still win | none |

The optional model is not measured yet (`intelBuiltinMeasured` is false): its numbers need Chrome's on-device model on a real machine.

## Attacks that still work

From the red-team harness in `RESULTS.md` (`redteam`); [docs/attacks-that-work.md](docs/attacks-that-work.md) gives each case, why it works, and whether it is accepted or deferred.

| Strategy | Cases won | Severity |
|---|---|---|
| UNASKED evasion: a send the agent never claimed | 18 of 25 | HIGH |
| Paraphrase drift: a true send claimed in other words | 7 of 12 | LOW |
| UNASKED false accusation: your own send flagged | 6 of 25 | MEDIUM |
| Coverage lies: another account's Sent list | 1 of 7 | MEDIUM |
| Counterparty: one Gmail mailbox spelled two ways | 1 of 17 | MEDIUM |
| Observer starvation | 1 of 5 | LOW |

No strategy produced a false Verified.

## Prior art

Each of these stops short of checking an agent's claim against evidence from your own accounts ([`build_spec.md` §3](build_spec.md#3-prior-art--who-is-already-here-and-exactly-where-they-stop)):

- **Vendor activity views** (Dots, Muse, Claude's task log) show what their own agent says it did. None checks against the world, and none sees another vendor's agent.
- **Gateway ledgers** (PortEden, Langfuse, LangSmith, Braintrust) see the tool calls routed through them. Consumer agents do not route through a third party.
- **Pre-action gates** (Snitch, Bylaw, Muse Sentinel, Dots Custom Rules) decide before an action, inside one vendor. They do not verify the outcome.
- **Log-integrity tools** (Agent Auditor) prove a log was not altered, not that it is true.
- **Data-collection scanners** (Norton's AI Data Checker, CoreLock) show what an AI app can collect, not what an agent did.
- **Developer verifiers** (Archal) check coding agents' work, for developers, in one harness.

Attest compares an agent's claim with evidence from your own Gmail and Calendar, across vendors, with the evidence on the receipt, and without any server seeing your data. It is a witness, not a guard: it never stops an action.

## How it works

![Attest's trust boundaries. A Gmail or Calendar tab is untrusted page content. The content script reads it read-only and sends derived facts over the typed bus to the service worker, which checks each message and is the ledger's one writer. The ledger is IndexedDB in the extension's origin, optionally sealed. The extension's pages read the ledger and send the person's commands and pasted claims. Only the person's own model key and the anonymous usage numbers, both off by default, send anything out of the browser.](docs/assets/trust-boundaries.svg)

The Gmail and Calendar readers run as content scripts, read-only (a lint rule forbids any click, event, write or request in them), and send derived facts, never a page, to the service worker. The service worker grades with a pure, deterministic core ([docs/grading.md](docs/grading.md)) and is the one writer of the ledger, an IndexedDB database in a storage bucket of its own. The popup, side panel and options page read the ledger. Where each fact goes and how long it is kept: [docs/privacy-architecture.md](docs/privacy-architecture.md).

## Contributing

Requires Node 22 (`.nvmrc`) and pnpm.

```sh
pnpm install
pnpm build        # → extension/.output/chrome-mv3/
pnpm lint
pnpm typecheck
pnpm test           # unit, property, golden, then the serial perf gates
pnpm test:coverage  # src/core coverage; fails below 95% lines
pnpm test:coverage:observers  # src/observers and src/adapters; fails below 85% lines
pnpm test:coverage:ui         # src/ui and the four pages; fails below 70% lines
pnpm e2e            # end to end on the built extension, the perf gates last and alone
pnpm bench          # perf gates → RESULTS.md; exits 1 when a gate fails
pnpm build:release  # the store zip, checked; needs unzip and the deployed telemetry host
pnpm record-demo    # launch/demo.gif; needs ffmpeg
pnpm record-screenshots  # the store's five screenshots and its promo tile
pnpm render-icons   # extension/public/icon/ from extension/assets/icon.svg
```

The telemetry API, in `telemetry-api/`, has its own commands, the monthly report's among them ([telemetry-api/README.md](telemetry-api/README.md)).

- **Capture a page as a fixture:** `pnpm capture --vendor <gmail|gcal> --name <name>` saves an open page with its personal values replaced; review it before you commit ([docs/adapters.md §6](docs/adapters.md#6-the-fixture-loop-capture-label-test-version)).
- **Add or repair a reader:** every reader has its `selectors.json`, health check, extractor and labelled fixtures, and a bench number ([docs/adapters.md §2](docs/adapters.md#2-the-observer-contract), [§7](docs/adapters.md#7-repairing-a-broken-selector)).
- **Change grading:** the rules live in `policy/default.json` and the golden scenarios in `extension/tests/golden/` ([docs/grading.md](docs/grading.md)).

## License

Apache-2.0. See `LICENSE`.
