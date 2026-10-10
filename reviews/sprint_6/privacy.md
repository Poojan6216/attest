# Sprint 6 — Privacy pre-review (6.7)

Role: agents/privacy_reviewer.md, run in full as the store's reviewer and a privacy regulator would read Attest. Range: the tree at `6373626` (6.6) and the fixes this pre-review made, listed below. Read: the built manifest (`pnpm audit:manifest`), `PRIVACY.md`, `docs/privacy-architecture.md`, `README.md`, `launch/store-listing.md`, the options page, the extension's runtime dependencies (`@noble/ciphers`, `dexie`, `preact`, `zod`), and the four vendors' terms, re-read on 2026-10-10 (Decisions `[6.7]`).

**Verdict: NOT READY.** Nothing in the code blocks the store. Four things outside it do, and none of them can be done by the agent: a public address for the privacy policy, a public link to the source, the founder's certification of the privacy practices form (with how the own-key option is declared), and the screenshots, which are Sprint 7.4's. Each is in MANUAL.md (Sprint 6, and the Sprint 7 items it points to) or in Sprint 7's tasks.

## GAPS

1. [BLOCKER] The privacy policy has no public URL: the repository is private by the founder's choice, and GitHub Pages from a private repository needs a paid plan → `launch/store-listing.md` "Privacy policy URL", MANUAL.md (Sprint 6, and Sprint 7: make `Poojan6216/attest` public, enable GitHub Pages) → Chrome Web Store: a privacy policy is required for an item that handles user data.
2. [BLOCKER] No public link to the source for the listing ("no obfuscated code; the public repo is linked"): the build is minified with source maps, not obfuscated, but the repository is private → MANUAL.md, the same decision → Chrome Web Store code readability; agents/privacy_reviewer.md.
3. [BLOCKER] The privacy practices form is the founder's to certify. The draft answers are in `launch/store-listing.md`; one is a judgment only the account owner can make: whether the own-key option, which sends a claim's counterparty, short subject, amount and time to the AI company the person's key is for (never to Attest's maker), counts as collection. The draft recommends declaring it, as sent only with the user's own key, opt-in → MANUAL.md (Sprint 6) → Chrome Web Store User Data policy, disclosure.
4. [MAJOR] OpenAI's Terms of Use could not be re-read this sprint: openai.com answers 403 to an automated fetch and the web archive was unreachable. The reading of 2026-10-08 stands, and the ChatGPT reader stays off whatever the terms now say → MANUAL.md (re-read in a browser before submission) → agents/privacy_reviewer.md, "each vendor's terms re-read this sprint".
5. [BLOCKER for submission] Screenshots with fixture data only do not exist yet → sprint_7 7.4 (already its task: `launch/screenshots/` from fixture pages) → Chrome Web Store listing; agents/privacy_reviewer.md "screenshots show no real names, emails, or amounts".

## Fixed in this pre-review

Each was a gap when the pre-review began; each is fixed in the tree and checked.

- **Retention while the ledger is locked.** The purge waits while encrypted and locked, and a person who unlocks only after the daily alarm fires would never see it run: history could outlive the window chosen. Each unlock now runs the purge, the due digest and the usage numbers once, each idempotent ([`src/background/catch-up.ts`](../../extension/src/background/catch-up.ts), [`catch-up.spec.ts`](../../extension/tests/unit/background/catch-up.spec.ts); `docs/privacy-architecture.md` §7).
- **Limited Use.** No statement said what the data read is used for and never used for. Now in [`PRIVACY.md`](../../PRIVACY.md) (version 0.7, "Limited Use") and in the listing draft.
- **Single purpose and audience.** Stated in one sentence each in the listing draft, with every feature mapped to the purpose.
- **Encryption's limits.** The privacy architecture said what encryption at rest protects and that the passphrase opens a copy; it now says plainly that a compromised browser or computer can read the records while unlocked, or take the passphrase as it is typed (§12).
- **Uninstall.** The privacy architecture now says what uninstalling removes, and what stays outside the browser only if an option that sends was on (§7). `PRIVACY.md` said so already.
- **Export while locked.** It said "Could not export the ledger. Try again."; it now says the records are locked and to unlock them first ([`ExportSection.tsx`](../../extension/entrypoints/options/components/ExportSection.tsx), [`export-ledger.spec.ts`](../../extension/tests/unit/options/export-ledger.spec.ts)).
- **README honesty.** The status said Sprint 5; it now says Sprint 6, names the encryption option with a link to what it protects, and names the attacks that still work, UNASKED evasion and paraphrase drift, with a link to their measured rates.
- **Policy version.** `PRIVACY.md` gained the encryption paragraph in 6.5 without a new version; 0.7 records it.

## CONFIRMED

### Chrome Web Store policy
- Single purpose: one sentence in `launch/store-listing.md`; every feature serves it (the listing maps each).
- Permission justifications: one line per permission in the listing draft and in Decisions `[6.6]`; the manifest asks for exactly those (`pnpm audit:manifest`, in CI).
- No obfuscated code: the build is Vite's minified output with source maps beside it; no `eval`, no remote code (`script-src 'self'`, held by the audit and the CSP tests).
- No remote code, no CDN, no analytics, no crash reporter: four runtime dependencies, none of them a service.

### What is stored, where
- `docs/privacy-architecture.md` lists every table and field, its allowlist and its retention, held to the code by `privacy-architecture.spec.ts` and `doc-pins.spec.ts`; the sealed tables and what each keeps in the clear are in §12.
- Retention: the daily purge by alarm (`retention-alarm.spec.ts`, `retention.spec.ts`), and now after each unlock.
- Optional encryption documented honestly: what it seals and what it leaves readable, where the key lives, that it guards a copy of the profile without the passphrase, not a running browser that is no longer the person's and not a copy with the passphrase (§12; red-team strategy 13 in `docs/attacks-that-work.md`).
- Uninstall: Chrome removes the extension's storage; documented in `PRIVACY.md` and §7; Delete all data exists and is tested, also while encrypted and locked (`crypto-locked.spec.ts`).

### What leaves (nothing, unless turned on)
- The mandatory network test and the secret-seed test pass on this tree (`network-intercept.spec.ts`, `no-leak.spec.ts`, 100 of 100 end-to-end tests at 6.5).
- Telemetry: opt-in, off by default; the payload's schema and a real payload in §11; the install id random and resettable ("Reset install id").
- Own model key: documented in §10 and `PRIVACY.md`; the options page's Model section says what is sent and to whom (`ByoStatement`).
- Chrome's built-in model: on-device, sends nothing (§10).
- The "Report on GitHub" issue carries the adapter's id and version and the Chrome major version only (`reportUrl`, `src/ui/receipt-labels.ts`).

### Third parties and vendors
- Meta, Anthropic and Google's terms re-read on 2026-10-10, unchanged in the clauses that decided Sprint 3.10 (Decisions `[6.7]`); OpenAI's, gap 4.
- Gmail and Calendar are read in the person's own tabs, as the person: no Google API, no OAuth scope (§1).
- No data broker, no analytics, no crash reporter SDK.

### User rights
- Export (JSON and CSV) works and is complete (`export-ledger.spec.ts`, `export.spec.ts`); while locked it says to unlock first.
- Delete all data works and is complete, kept choices aside (`settings.spec.ts`, `crypto-locked.spec.ts`).
- Every opt-in has its opt-out beside it: the usage numbers, the own key ("Forget my key"), the on-device model, away detection, Check Gmail for me, each page reader, encryption (turn off).
- Not directed at children: the listing's audience says so; no age-specific feature.

### Honesty of copy
- The privacy line on every page says nothing leaves the browser while every option that sends is off, and names the option that sends while one is on (Sprint 5 close, SEC-1), backed by the network test; the README and the listing say "unless you turn it on"; "verified" is defined as matched independent evidence (`docs/grading.md`).
- The known limitations of build_spec §11 are the README's first section.

## STORE-READINESS VERDICT

**NOT READY.** Blocking, all outside the code: gaps 1 to 3 (MANUAL.md, Sprint 6), gap 5 (sprint_7 7.4), and gap 4 before submission (MANUAL.md). When the repository's visibility is decided and the founder has certified the form, a re-run of this review on the release zip (sprint_7 7.7) can say READY.
