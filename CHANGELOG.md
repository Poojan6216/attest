# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). `0.1.0` is the first store release.

## [Unreleased]

### Added

- WXT + Manifest V3 + Preact + Tailwind scaffold with TypeScript strict, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; strict extension CSP and no host permissions.
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

### Removed

- The unused `ulidx` dependency, and Vite's module-preload polyfill (it contained a `fetch`).

