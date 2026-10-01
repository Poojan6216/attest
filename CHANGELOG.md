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
