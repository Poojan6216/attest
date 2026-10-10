# Attest

[![ci](https://github.com/Poojan6216/attest/actions/workflows/ci.yml/badge.svg)](https://github.com/Poojan6216/attest/actions/workflows/ci.yml)

Receipts for your AI agents.

Attest is a Chrome extension that checks what your AI agents (Meta Muse, ChatGPT and Dots, Claude) said they did against evidence in your own Gmail and Google Calendar tabs, and gives every task a graded receipt: verified, partial, not found, unasked, over scope, or unverifiable. It runs in your browser, sends nothing unless you turn on an option that sends, and never acts on any page. **Attest cannot see everything.** It sees only what is in tabs you have open: actions inside Messenger, phone calls, purchases without an email receipt, and anything on your phone are invisible to it, and those receipts say UNVERIFIABLE. When it flags something you did not ask for, it says "likely agent", because it cannot prove who pressed send. Vendor pages change; when an adapter stops matching, Attest marks it DEGRADED and tells you instead of going quiet. Desktop Chrome only.

> **Status:** pre-release, Sprint 6. Attest reads your Gmail Sent folder, receipt emails you open and Google Calendar, only in tabs you have open, and keeps what it finds in your browser. It does not read your AI agents' pages: their makers' terms do not allow it, so those readers are off. Instead you paste an agent's activity log into Attest's side panel, and Attest grades each action the log claims against your Gmail and Calendar. The popup shows today's receipts; the side panel's timeline shows every receipt with its evidence, and lets you mark one; the options page sets each agent's grant, turns each reader off or on, sets how long history is kept, exports it and deletes it. A receipt that ends Not found, Unasked or Over scope raises an alert, a weekly digest sums up each week, and a receipt or a week can be shared as text or an image. Attest opens a tab itself only if you turn on Check Gmail for me: then, when an agent says it sent an email that no Gmail tab has shown, it opens your Sent folder once, pinned and in front of you ([PRIVACY.md](PRIVACY.md)). Two options send something, both off until you turn them on: your own Anthropic or OpenAI key, for a model's second opinion on partial matches, and anonymous usage numbers. A third option, also off by default, encrypts what Attest keeps with a passphrase ([what it protects and what it does not](docs/privacy-architecture.md#12-encryption-at-rest)). Attest has been attacked on purpose, and some attacks still work, at the rates [docs/attacks-that-work.md](docs/attacks-that-work.md) measures: above all a send an agent made without claiming it (UNASKED evasion), and a true send claimed in other words (paraphrase drift). There is no store listing.

## Known limitations

These are documented, not bugs to be fixed (from `build_spec.md` §11):

- Attest sees only what is in open tabs. Actions inside Messenger, phone calls by an agent, purchases without an email receipt, and anything on mobile are invisible. The receipt says UNVERIFIABLE.
- Attribution of UNASKED actions is a heuristic. "Likely agent" is the strongest claim Attest ever makes.
- Vendor UIs change. Adapters will break. Health checks make breakage loud; they do not make it rare.
- Reading a vendor's activity page is reading their UI. Each vendor's terms are read before store submission and the reading is recorded in `Decisions.md`. If a vendor's terms forbid it, that adapter ships disabled with a note.
- Dots requires a Pro tier. Until a Dots fixture exists, the Dots adapter is built against the ChatGPT surface and flagged.
- Desktop Chrome only. Muse is mobile-first; phone-only users are not served in v1.
- The optional on-device model depends on your Chrome and hardware. When it is unavailable, Attest is rules-only and says so.

## Nothing leaves your browser unless you turn it on

With every option off, as Attest starts, it makes no network requests. This is enforced by a test, `extension/tests/e2e/network-intercept.spec.ts` (tagged `@mandatory`), that records every request the extension makes during a scripted session and fails the build if any host is contacted. Two options send something, and each adds exactly one host while it is on:

- **Your own model key** (Options, Model): a claim's kind, recipient, short subject, amount and time, and the same for the email or event it partly matched, go to Anthropic or OpenAI, whichever the key is for. Never a page, never what you asked an agent.
- **Anonymous usage numbers** (Options, Privacy): once a day, counts about the day before go to Attest's telemetry server. No address, name, subject or amount.

The extension's content security policy lets it reach those hosts and no other, a redirect's target included. Every page says which option is on. The full account is in [PRIVACY.md](PRIVACY.md) and [docs/privacy-architecture.md](docs/privacy-architecture.md).

## Develop

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
pnpm e2e
pnpm bench          # perf gates → RESULTS.md; exits 1 when a gate fails
```

Load `extension/.output/chrome-mv3/` in `chrome://extensions` with Developer mode on and "Load unpacked".

## License

Apache-2.0. See `LICENSE`.
