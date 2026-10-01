# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). `0.1.0` is the first store release.

## [Unreleased]

### Added

- WXT + Manifest V3 + Preact + Tailwind scaffold with TypeScript strict, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Strict extension CSP (`script-src 'self'; object-src 'none'`) and no host permissions.
- Popup, side panel and options page shells.
- `src/log.ts`, the only logger, which prints identifiers and shapes and never free-form strings.
