# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). `0.1.0` is the first store release.

## [Unreleased]

### Added

- WXT + Manifest V3 + Preact + Tailwind scaffold with TypeScript strict, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; strict extension CSP and no host permissions.
- Workspace commands, run from the repository root: `pnpm dev`, `pnpm build`, `pnpm build:release`, `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` and `pnpm e2e`.
- Lint fences: `attest/no-act` (no clicks, events, DOM writes, navigation or network in anything that reads a vendor page), `src/core` purity (no impure imports, globals, clock or randomness), `attest/top-level-listeners` (MV3), and `console` only in `src/log.ts`. Inline disables have no effect in fenced scopes.
- `src/log.ts`, the only logger: prints identifiers and shapes, never free-form strings.
- Test rails: Vitest + fast-check, Playwright loading the real build in Chromium, a localhost fixture server, and `pnpm bench` generating `RESULTS.md`.
- Two `@mandatory` E2E tests: nothing leaves the browser (5-minute session, NetLog attribution, negative controls) and no seeded secret leaks into export, IndexedDB, storage, console or network.
- Ledger: Dexie schema v1 (eight tables), typed repositories, idempotent upserts, migrations and a deterministic export.
- Typed message bus with Zod validation on both ends.
- `policy/default.json` and a pure, frozen policy loader.
- `pnpm capture`: a read-only fixture capture tool with a PII sanitiser.
- Options page shell with a resettable install id; `PRIVACY.md` v0.
- Service worker wiring: bus, install handler, retention alarm scheduling.
- CI on GitHub Actions.
- The grading core (`src/core`): pure functions that compare an agent's claims with what your Gmail and Calendar tabs showed and issue one receipt per claim: VERIFIED, PARTIAL, NOT FOUND, UNASKED, OVER SCOPE or UNVERIFIABLE. Scores are exact fractions, so no rounding ever decides a grade, and every number comes from `policy/default.json`. Attest says NOT FOUND only after every relevant tab was seen over the whole claim window and the grace period passed; with less to go on, the receipt says UNVERIFIABLE.
- Normalisation of addresses, names, subjects, amounts and vendor-relative times ("2:03 PM", "Yesterday"). A look-alike address (a dotless `ı`, a `xn--` domain) is flagged, never treated as the real one.
- Redaction: an observation keeps only the fields the policy allows for its source, and is named by a hash of that content.
- One-to-one matching: one sent email or calendar event verifies at most one claim.
- Receipt states: PENDING (shown as "checking"), FINAL and USER_OVERRIDDEN. An override to VERIFIED or NOT FOUND sits beside the computed grade, never replaces it, and can be undone; the screens that set one arrive in Sprint 4.
- UNASKED receipts for actions no claim explains, when attribution signals (an agent session, you being idle, an agent's signature, its activity log) point to an agent. They always say "likely".
- Scope checks: an action type outside the grant, a counterparty outside the allowlist, one purchase or the rolling total over the spend ceiling, and permissions an agent holds beyond the ones you declared.
- Replay: `pnpm attest replay <export.json>` re-derives every stored receipt from its stored inputs and lists each mismatch ([docs/grading.md §9](docs/grading.md#replay-procedure)). The extension's own export carries those inputs from Sprint 2.6/3.6; until then replay runs on synthetic ledgers.
- [docs/grading.md](docs/grading.md): the grading contract, with every grade, rule, feature and window, the receipt state diagram, the replay procedure and worked examples.
- 98 golden scenarios ([extension/tests/golden/](extension/tests/golden/)) with hand-computed expectations, property tests for determinism, redaction and replay, a test that runs `src/core` with every clock, randomness, time-zone, locale, timer and network global poisoned, and perf gates for candidate lookup and batch grading (5,000 claims against 50,000 observations; measured numbers in [RESULTS.md](RESULTS.md)).
- `pnpm check-docs`, run by `pnpm lint`: every relative link, anchor, quoted `pnpm` script and policy rule id in the docs must exist (a `cd` inside a subshell `( … )` ends with it); docs/grading.md §15 must document every key of the golden file format; no Markdown file may hold an absolute path from one machine; and Decisions.md entries from the Sprint 1 close on say what was decided, not how the work was organised.
- `pnpm test:coverage`: `src/core` coverage, failing below 95% of lines. CI runs it.
- `pnpm test:poison`: every core, golden and property test runs with every clock, randomness, time-zone, locale, timer and network global poisoned before `src/core` loads, and fails on any impure call, any changed built-in, or less than 95% of `src/core`'s lines run. CI runs it. What the purity checks cannot catch is listed in [docs/grading.md §14](docs/grading.md#14-deviations-from-build_spec-7-all-in-decisionsmd-sprint-1).

### Changed

- The logger prints only a closed vocabulary of event names and values, plus ULIDs, hashes, ISO timestamps and versions; any other text prints as its length, long numbers as a placeholder, and non-standard error names as `Error`. Every log call names a literal event and literal keys (lint rule `attest/log-call`).
- Lint fences now cover all extension code: no network API outside the two Sprint 5 files, no web storage, IndexedDB only in the ledger, no console aliasing, no Node, runtime messaging only through the bus, no DOM in service-worker code, and inline disables have no effect anywhere. `attest/no-act` also catches indirect calls, destructuring, reflection, DOM insertion, resource loading, and the vendor page's storage; `attest/core-determinism` keeps `src/core` free of clocks, randomness, time zones and locales.
- Stored and bus schemas cap the length of every free-text string and array.
- The no-leak test searches a compact form of every secret (and percent- and base64-decoded text), uses partial-leak canaries for every seed and three identifier-shaped seeds, and also reads web storage, CacheStorage, page storage and cookies.
- The capture sanitiser removes query strings and token fragments from text, `data-*` attributes, `<meta content>` and relative URLs, not only from links.
- On install or update, the install id and the alarms are handled independently; Chrome updates no longer restart the purge countdown.
- Routine bus drops (`no_handler`) and broadcasts nobody hears are logged at debug.
- Timestamps the extension stamps carry the local time-zone offset.
- The toolbar tooltip reads "Attest: receipts for your AI agents".
- CI actions are pinned to commit SHAs, the build artifact uploads again, and CI checks that every `@mandatory` test ran and passed.
- The ledger and the message bus use the grading core's schemas, so stored rows and messages are checked by the same types grading reads.
- `pnpm test` also runs the perf gates, one at a time; `pnpm bench` exits with an error when a gate fails and records the commit and Node version with each result.
- Text is read the way Unicode 15.0 (Chrome 120, the oldest Chrome Attest supports) reads it, on every engine, so a receipt grades and replays the same in every supported Chrome and in Node.
- A policy is refused when one of its rules concludes a grade without the evidence that grade needs (for example a VERIFIED rule with no match at the verified threshold), and grading refuses any policy the loader did not produce.
- A spend claim (a purchase or a subscription change) with no currency counts toward the rolling spend ceiling: two $30 purchases against a $50 ceiling make the second OVER SCOPE, with or without a currency on either.
- Evidence counts only when it comes from a source the policy reads for that kind of action: a row from another source neither verifies a claim nor produces an UNASKED receipt.
- A counterparty, merchant or subject must be one line. An observed row whose allowed field fails its check, or is held by a getter, a setter or a prototype rather than as plain data, is refused whole, never stored without that fact (from Sprint 2 the observer then reports DEGRADED); the ledger also refuses an observation holding a field its source may not store.
- The ledger never rewrites a claim or observation it stores. Seeing it again changes nothing; a sighting earlier than the stored one that arrives late is refused (from Sprint 2 the observer then reports DEGRADED), and so is a claim or observation that differs from the stored one under the same hash, rather than keeping either silently. A claim read again by a newer extractor that reads it the same way is the same claim.
- A new claim or observation is stamped no earlier than the moment it is stored and after the last grading run, and each grading run records its time before it reads, strictly after the run before it. So replay rebuilds every grading from exactly the rows it read.
- Health reports carry reason codes such as `selector.missing`, never page text, and adapter, observer and extractor ids are short tokens. A request's conversation id is the vendor's own id, never a title or a line of the chat, and each granted scope and allowlist entry is one line.
- A purchase never counts as its own earlier spend under the rolling spend ceiling: the same purchase read twice (an activity view shown again seconds later) is one claim, counted once.
- A claim too vague to match, or a calendar claim with no event time, is never called NOT FOUND, whatever order a policy puts its rules in; a policy whose partial-match threshold is 0 is refused, and so is one whose UNASKED threshold is 0, since an accusation must rest on a signal that counts.
- An override changes only the gradings that start after it, and a claim overridden to VERIFIED keeps its evidence: no other claim can take that email or event. Replay rebuilds each grading exactly as it ran.
- Undoing an override keeps it in the receipt's history with the time it was undone, so the gradings made while it stood still replay. If another claim took the evidence meanwhile, the evidence stays with that claim.
- Text holding half of a broken character pair (a lone surrogate) reads as the replacement character U+FFFD on every engine, so removing an invisible mark can never join two halves into a character the text did not hold.
- `pnpm attest replay` escapes control and invisible characters from the export, and from the file name it echoes, line breaks included, before it prints them, so a crafted file or file name cannot drive your terminal or forge an output line.
- Lint: `src/core` may import only its own modules, `zod` and the policy file, and may not use `WeakRef`, `FinalizationRegistry` or `Temporal`, read `.constructor`, parse text with `new Date(text)`, or turn a date into text through the host's time zone (`date.toString()`, `String(date)`). No shipped file may hold an ambient `declare`, which could hide a real global from these rules. The Unicode fence reads the syntax tree of every file under `src/core`, not its text, and refuses case-insensitive patterns that fold beyond ASCII, a backreference under `i`, and inline modifier groups. `src/core` may also not read an error stack or `import.meta`, use `Atomics` or `SharedArrayBuffer`, use reflection beyond `Reflect.get`, `Reflect.has` and `Reflect.isExtensible`, call `.call`, `.apply` or `.bind`, or stack type assertions. Every test's timeout is checked as the test runs.

### Removed

- The unused `ulidx` dependency, and Vite's module-preload polyfill (it contained a `fetch`).

