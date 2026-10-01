# Attest

[![ci](https://github.com/Poojan6216/attest/actions/workflows/ci.yml/badge.svg)](https://github.com/Poojan6216/attest/actions/workflows/ci.yml)

Receipts for your AI agents.

Attest is a Chrome extension that checks what your AI agents (Meta Muse, ChatGPT and Dots, Claude) said they did against evidence in your own Gmail and Google Calendar tabs, and gives every task a graded receipt: verified, partial, not found, unasked, over scope, or unverifiable. It runs entirely in your browser and never acts on any page. **Attest cannot see everything.** It sees only what is in tabs you have open: actions inside Messenger, phone calls, purchases without an email receipt, and anything on your phone are invisible to it, and those receipts say UNVERIFIABLE. When it flags something you did not ask for, it says "likely agent", because it cannot prove who pressed send. Vendor pages change; when an adapter stops matching, Attest marks it DEGRADED and tells you instead of going quiet. Desktop Chrome only.

> **Status:** pre-release. Sprint 0 (scaffold and the two mandatory tests). Nothing is read from any page yet. There is no store listing.

## Known limitations

These are documented, not bugs to be fixed (from `build_spec.md` §11):

- Attest sees only what is in open tabs. Actions inside Messenger, phone calls by an agent, purchases without an email receipt, and anything on mobile are invisible. The receipt says UNVERIFIABLE.
- Attribution of UNASKED actions is a heuristic. "Likely agent" is the strongest claim Attest ever makes.
- Vendor UIs change. Adapters will break. Health checks make breakage loud; they do not make it rare.
- Reading a vendor's activity page is reading their UI. Each vendor's terms are read before store submission and the reading is recorded in `Decisions.md`. If a vendor's terms forbid it, that adapter ships disabled with a note.
- Dots requires a Pro tier. Until a Dots fixture exists, the Dots adapter is built against the ChatGPT surface and flagged.
- Desktop Chrome only. Muse is mobile-first; phone-only users are not served in v1.
- The optional on-device model depends on your Chrome and hardware. When it is unavailable, Attest is rules-only and says so.

## Nothing leaves your browser

Attest makes no network requests. This is enforced by a test, `extension/tests/e2e/network-intercept.spec.ts` (tagged `@mandatory`), that records every request the extension makes during a scripted session and fails the build if any host is contacted.

## Develop

Requires Node 22 (`.nvmrc`) and pnpm.

```sh
pnpm install
pnpm build        # → extension/.output/chrome-mv3/
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

Load `extension/.output/chrome-mv3/` in `chrome://extensions` with Developer mode on and "Load unpacked".

## License

Apache-2.0. See `LICENSE`.
