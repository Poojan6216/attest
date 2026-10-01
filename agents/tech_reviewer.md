# Role: Technical Reviewer — Attest — Run end of every sprint

Review code quality and architecture of everything touched this sprint. Output to `reviews/sprint_<N>/tech.md` as a numbered gap list with file:line and severity. Do not fix; `sprint_closer.md` fixes.

## Checklist

### Architecture boundaries
- [ ] `src/core` imports nothing from `chrome`, DOM, Dexie, or `src/adapters`; verified by an ESLint `no-restricted-imports` rule, not by eye
- [ ] Entrypoints are thin: no business logic in `background.ts` or any `*.content.ts`; they call modules
- [ ] Adapters/observers are pure over `Document`; no storage, no bus access inside `extract()`
- [ ] All cross-context messages typed in `src/bus/` and Zod-validated; no ad-hoc `chrome.runtime.sendMessage` with untyped objects
- [ ] Policy values read from `policy/default.json`; no thresholds, windows, or weights hardcoded

### Code quality
- [ ] No `any` outside `tests/`; no `as unknown as`; no `!` non-null assertions without a comment
- [ ] No hardcoded hosts, ids, or URLs; constants in `src/config.ts`
- [ ] No duplicate selector logic across adapters; shared helpers in `src/adapters/base.ts` / `src/observers/base.ts`
- [ ] No TODO/FIXME without a linked sprint task or `Decisions.md` entry
- [ ] Errors are typed (`class AdapterError extends Error`), carry context, never swallowed
- [ ] Functions ≤ 60 lines; files ≤ 400 lines; split otherwise
- [ ] Naming: `camelCase` TS, `PascalCase` components/types, `kebab-case` files, `UPPER_SNAKE` constants

### Determinism and data
- [ ] `grade()` and friends: no `Date.now`, `Math.random`, `crypto.getRandomValues`, or model call inside `src/core` (grep + lint rule)
- [ ] Ids derived from content/inputs hashes where idempotency matters; ULIDs only for genuinely new events
- [ ] All timestamps ISO 8601 with offset; all money integer cents + currency
- [ ] Dexie: indexes exist for every query path used (type+time bucket, counterparty token, agent+date); no full-table scans in hot paths

### Performance
- [ ] Ledger reads paginated in UI; no `toArray()` on unbounded tables
- [ ] Content scripts debounce DOM observation (MutationObserver with batching); no per-mutation extraction
- [ ] Service worker does no work on `onStartup` beyond re-registering alarms
- [ ] Bundle size per entrypoint reported; popup < 150 KB gzipped

### Consistency and docs
- [ ] Every new bus message, table, policy field, or grade documented in `docs/grading.md` or `docs/adapters.md`
- [ ] `Decisions.md` has an entry for every unspecified choice made this sprint
- [ ] CHANGELOG updated under Unreleased
- [ ] Tests follow the layout in `build_spec.md §6`

### Telemetry-api (when touched)
- [ ] Routers thin; validation in schema; storage in `store.py`
- [ ] Type hints complete; `ruff` + `mypy --strict` clean
