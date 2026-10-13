# Sprint 6 — Tech review

**Role:** agents/tech_reviewer.md (read-only).
**Scope:** everything Sprint 6 changed: tasks 6.0 to 6.9 and the 46 Decisions entries [6.0] to [6.9] (Decisions.md:1606-1651).
**Range:** `3091d86..8065826` (HEAD). 22 commits, 172 files, +16,327 / −307. Of that, `extension/src` and `extension/entrypoints` are 64 files (+2,102 / −55), and `extension/tests` 70 files (+12,993 / −131).

**What I ran:**
- `git log`, `git diff` and `git show` over the range; reading files; `grep`, `wc`.
- Two read-only Node scripts in the scratchpad, over the built output in `extension/.output/`:
  - a copy of `tests/e2e/built-bundle.spec.ts` `startLoad` (gzip level 9 per file, then summed);
  - a source-map decoder that attributes each built byte to its source.
- One read-only Node script over the 13 `expected.json` files under `extension/tests/fixtures/attacks/`, counting expectations that can pass with no receipt.

**Not run:** builds, `pnpm lint`, `pnpm typecheck`, unit tests, e2e tests, benches, Playwright. End-to-end tests with timing gates were running on this machine. Nothing in the repository was written except this file.

**The built output changed during the review.**
- Bundle figures below come from the production build present when the review started (built 2026-10-10 16:35, after `7d32572`).
- At 16:51 on 2026-10-12 another process rebuilt `extension/.output/` in development mode:
  - Preact's development JSX, with absolute source paths from the developer's machine;
  - `dexie.js` instead of `dexie.min.js`.
- I did not find which process built it, and it is not a change in the range.
- Note for QA and the close: `tests/e2e/built-bundle.spec.ts` does not fail on development JSX or absolute paths in shipped files. A release built with a stray `NODE_ENV` would ship them.

**Files QA added during this review are out of scope.** These files appeared untracked while I worked and are not in the range:
- `extension/tests/property/seal.property.spec.ts`
- `extension/tests/unit/background/keep-awake.spec.ts`
- `extension/tests/unit/crypto/job.spec.ts`
- `extension/tests/unit/ledger/crypto-writes.spec.ts`
- `extension/tests/unit/ui/locked-pages.spec.ts`

Where one of them bears on a gap, the gap says so.

## Summary

**Gaps: 16. None HIGH, 5 MEDIUM, 11 LOW.**

**What passes:**
- **Core purity.** No file under `src/core`, `src/observers`, `src/adapters`, `entrypoints/content` or `policy/` changed. The red team needed no grading fix: Decisions [6.1] records that inflation is caught by the one-to-one assignment, so `candidates.ts` gained no `consumed` rule.
- **One writer.**
  - The crypto state's writers (`ledger/crypto-writes.ts`, `ledger/crypto-job.ts`) and the pages' key copy (`writeSessionKeys`, `clearSessionKeys`) are fenced from pages (`eslint-rules/fences.js` `PAGE_RESTRICTED_IMPORTS`). Five probes prove it (`tests/unit/lint/fences-pages.spec.ts:49-53`).
  - Pages only read `meta` and session memory, and set their own in-memory keyring.
- **The bus.**
  - The five commands are strict Zod schemas in the union (`src/bus/crypto-commands.ts`). They are page-only through `PAGE_COMMAND_RESULTS`, and their answers are parsed as `CryptoResult`.
  - The new `locked` ack is in `AckCode` and docs/adapters.md.
  - The session copy of the keys is parsed with Zod before use (`src/crypto/session.ts:17-18`).
- **The middleware's Dexie semantics hold.**
  - All six `DBCoreTable` operations are wrapped. Locked, each fails whole, a count and a key read included.
  - The cursor wrapper reads `key`, `primaryKey` and `value` from the cursor itself, and `cursor.spec.ts` proves it on a strict-receiver stand-in. Methods reached through the prototype work, because Dexie 4.4.6 binds `continue` and `advance` to the real cursor (`node_modules/dexie/dist/dexie.mjs:3454-3458`).
  - `update`, `modify` and `bulkUpdate` read through `getMany` and write whole values with a `put` (`dexie.mjs:2352-2470`), so an updated row is sealed again. `middleware.spec.ts:168-174` covers it.
  - Sealing is synchronous, so no transaction ends in the middle of an upsert.
  - No sealed table has an outbound or auto-increment key (`src/ledger/db.ts` `STORES_V*`), so the AAD built from `extractKey` is the same when a row is sealed and when it is opened.
- **Resumability of an interrupted job.**
  - Each step writes its rows and the job's place in one transaction (`src/ledger/crypto-job.ts:47-66`).
  - During a change, `crypto.previous` is sealed under the new key, so the new passphrase alone finishes the change after a restart. `crypto-commands.spec.ts` "resumes after a restart interrupted it" covers it.
  - Commands run one at a time, and "never derives two keys" covers it. The exceptions are TECH-2 and TECH-6.
- **The Node built-in fence.** Its regex is now anchored at the start of the import name (`fences.js:108`), so `../crypto/keyring` passes. It is tested in four scopes, bare, with a subpath, with `node:` and capitalised (`fences-scopes.spec.ts:284`). See TECH-9 for the modules it does not list.
- **The red-team harness.**
  - Fixtures are parsed with strict Zod before anything launches, and a missing folder throws.
  - Severity is computed, not written by hand.
  - 135 of the 138 expectations carry a `count` or a `minVerified`, so a case whose claim never imports cannot pass silently. The three without are the time-trick pastes the preview refuses, as Decisions.md:1612 records.
  - `redteam-guard.spec.ts` bars CRITICAL in ten strategies, and HIGH in grant bypass, on every e2e run.
- **Performance.**
  - 6.4's gates are e2e tests, and the measured numbers are in Decisions.md:1625-1626.
  - The export reads in pages.
  - The two new query paths use primary keys: `readCryptoState` reads `meta` by key prefix, and the job pages by primary key.
- **Sizes.** No changed file is over 400 lines. Closest: `src/config.ts` 399, `src/log-vocabulary.ts` 396, `src/bus/messages.ts` 394 (by `wc`; lint was not run).
- **The threat model's test can fail.** `tests/unit/docs/threat-model.spec.ts:47-50` removes a row from a copy and expects the failure.

## Bundle size

The popup was measured on the production build, the content scripts on the development rebuild. The other entrypoints would need a build, which the constraints rule out.

| Entrypoint | Start gzip (B) | Budget | Sprint 5 tech review |
|---|---|---|---|
| popup | 123,227 (the test's method, on the 2026-10-10 production build). QA's e2e: 123,312 | 125,000: **pass, about 1.7 KB left** | 115,079 |
| content-scripts/gmail.js | 70,908 (on the development rebuild; content scripts hold no JSX) | 75,000: pass | 70,760 |
| content-scripts/gcal.js | 65,954 (same) | 75,000: pass | 65,667 |

**What Sprint 6 put in the popup's start load.** Raw bytes, attributed from the 2026-10-10 build's source maps:

| Source | Raw bytes |
|---|---|
| `@noble/ciphers/aes.js` | 3,612 |
| `@noble/ciphers/utils.js` | 3,112 |
| `@noble/ciphers/_polyval.js` | 1,889 |
| `src/crypto/middleware.ts` | 1,799 |
| `src/ui/UnlockForm.tsx` | 1,208 |
| `src/crypto/seal.ts` | 1,157 |
| `src/ledger/crypto-state.ts` | 968 |
| `src/crypto/session.ts` | 887 |
| `src/ui/LockedNotice.tsx` | 319 |
| `src/crypto/bytes.ts` | 300 |
| `src/crypto/keyring.ts` | 216 |
| `src/config-crypto.ts` | 176 |
| **Total** | **15,643** (about 6.6 KB gzipped) |

Gzipped on their own:
- the cipher and `seal.ts`: about 4.1 KB;
- the unlock prompt: about 0.8 KB.

For a ledger that was never encrypted, the cipher, `seal.ts`, the session reader and the unlock prompt never run. Only the state check and the middleware's early returns do (TECH-1).

## Checklist

| Item | Status | Finding |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint rule) | verified clean (lint not re-run) | No file under src/core changed in the range. |
| Entrypoints are thin | verified clean | `entrypoints/background.ts` adds two calls, `holdKeysHere()` and `onUnlocked(catchUpAfterUnlock)`. The page changes wire state; the Encryption forms are components over one hook. |
| Adapters and observers are pure over Document | verified clean | Untouched. |
| Cross-context messages typed in src/bus and Zod-validated | verified clean (LOW notes) | Typed and page-only. A locked ledger is answered as a failure for three commands (TECH-8). The leak check is vacuous for three near-misses (TECH-13). |
| Policy values from policy/default.json | verified clean | No threshold, window or weight added. |
| Layering fences, one writer | GAP (LOW) | Writers are fenced from pages. `src/crypto` runs in the worker but is fenced as page code (TECH-9). |
| No `any`, no `as unknown as`, no unexplained `!` | verified clean | Two assertions among the added lines: `as DBCoreCursor` on `Object.create` (`middleware.ts:115`), and `as Record<string, unknown>` after a type check (`scripts/audit-manifest.ts:93`). |
| No hardcoded hosts, ids or URLs | verified clean | Constants are in `src/config-crypto.ts`. The audit writes its two hosts out on purpose, so a widened config cannot pass its own check (`scripts/audit-manifest.ts:34-37`). |
| No duplicate selector logic | verified clean | No selector changed. Other duplication is in TECH-14. |
| No TODO or FIXME without a task | verified clean | None among the added lines. |
| Errors typed, with context, never swallowed | **GAP** | `LedgerError('locked' \| 'unreadable')` is typed. But: a stalled job is invisible (TECH-2); a failed reload keeps the keys (TECH-6); silent `undefined`s read as a wrong passphrase (TECH-7); the locked state is logged as an error (TECH-8). |
| Functions ≤ 60 lines, files ≤ 400 lines | verified by `wc` only | Lint not run. Three files are within 6 lines of the cap: `config.ts` 399, `log-vocabulary.ts` 396, `messages.ts` 394. |
| Naming conventions | verified clean | kebab-case files. One component per `.tsx`: UnlockForm, LockedNotice, nine Encryption components, DigestCoverage. |
| No clock, randomness or model in src/core | verified clean | `getRandomValues` is in `src/crypto/bytes.ts` only. |
| Ids from hashes where idempotency matters | verified clean | Key ids and salts are random by design. |
| Timestamps ISO with offset; money in cents | verified clean | Nothing new stored. |
| Dexie indexes for every query path | verified clean | See Summary. |
| Ledger reads paginated; no `toArray` on unbounded tables | verified clean | The job reads 200 rows a step; `readCryptoState` reads at most nine keys. |
| Content scripts debounce DOM observation | verified clean (LOW note) | A new e2e test checks batching under churn. Its rate assertion is half its title (TECH-13). |
| Service worker does no work on onStartup beyond alarms | verified clean (note) | `holdKeysHere` makes one storage call at each start. Keep-awake pings every 20 s while unlocked, by design (Decisions.md:1631). |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | partly verified (MEDIUM) | Popup 123,227 B: under the 150 KB ceiling and 1.7 KB under its own budget (TECH-1). Other entrypoints not built. |
| New messages, tables, fields and grades documented | verified clean (LOW notes) | adapters.md has the five commands, the `locked` ack and the drops. privacy-architecture §5.6 has `crypto.*`, and §12 has encryption. Inaccuracies are in TECH-15. |
| Decisions.md entry for every unspecified choice | GAP (LOW) | 46 entries. TECH-16 lists what has none. |
| CHANGELOG updated under Unreleased | GAP (LOW) | Six Sprint 6 lines. None for the 6.9 notice, and one is inaccurate (TECH-15). |
| Tests follow the build_spec §6 layout | GAP (LOW) | `extension/tests/redteam/` is new and outside the layout (TECH-16). |
| telemetry-api | not touched | No file under `telemetry-api/` changed. |

## Gaps

### TECH-1 (MEDIUM): the popup's start load is 1.7 KB under its budget, and about 5 KB of it is encryption code that a ledger without encryption never runs

**Where:**
- `extension/src/ledger/migrations.ts:39` and `:186-192`: every `openLedger` installs the sealing middleware, statically imported.
- `extension/src/crypto/middleware.ts:28` imports `seal`, `open` and `isSealed` from `./seal`.
- `extension/src/crypto/seal.ts:8` imports `gcm` from `@noble/ciphers/aes.js`.
- `extension/src/ledger/shared.ts:18-19` imports the session reader and the keyring loader.
- `extension/entrypoints/popup/components/Popup.tsx:1` and `:35`: `LockedNotice`, and with it `UnlockForm`, is a static import.
- `extension/tests/e2e/built-bundle.spec.ts:198-201`: the budget, 125,000 B.

**What is wrong:**
- The popup's start load grew by about 8.1 KB this sprint: 115,079 B at the Sprint 5 review, 123,227 B now (QA's e2e: 123,312 B). That is 8.1 of the 9.9 KB the budget left.
- About 6.6 KB of the growth is encryption (table above).
- Encryption is opt-in and off by default (Decisions.md:1637). For a ledger never encrypted, none of the cipher runs:
  - `sealRow` returns early unless `ring.sealing` (`middleware.ts:77`);
  - `openRow` returns a row with no `sealed` field as it is (`middleware.ts:91`);
  - the unlock prompt renders only for `status === 'locked'`.
- Deferrable: noble's three modules and `seal.ts`, about 4.1 KB gzipped; the unlock prompt, about 0.8 KB. `session.ts` and `bytes.ts` are needed only for a guarded ledger too.

**Why it matters:** The budget sits about 10% above the popup's size, "so its next growth is a decision, not a drift" (`built-bundle.spec.ts:198-199`). The next popup feature now fails the gate, or the budget rises to make room for code most installs never execute.

**Fix:**
1. Move `isSealed` into a module with no cipher.
2. Have `loadKeyring` (`src/ledger/crypto-state.ts:81-86`) load `./seal` with `import()` when the state is guarded, and keep `seal` and `open` on the keyring, so the middleware calls them synchronously.
3. A sealed row met before a codec is loaded fails `locked`, as it does today with no key held.

   Nothing changes inside transactions:
   - `getLedger` awaits `loadKeyring` before any read (`shared.ts:63-65`);
   - the worker's `hold` loads it before any write (`src/background/crypto.ts:89`).
4. Load `LockedNotice` with `import()` when the popup's state turns `locked`, as `UnlockForm` already loads the bus (`UnlockForm.tsx:8-11`).
5. Keep the budget. Add an assertion in `built-bundle.spec.ts` that no `@noble` source is in the popup's start load.

### TECH-2 (MEDIUM): a sealing job that fails for any reason but the lock stops for good while the ledger stays unlocked, and the options page still says it is running

**Where:**
- `extension/src/background/crypto.ts:243-253` (`resumeCryptoJob`): a failure is logged `crypto.job_failed` and `job` is cleared. Nothing schedules another try.
- `resumeCryptoJob` is called only by the four commands (`crypto.ts:144`, `:163`, `:195`, `:212`).
- `crypto.ts:139`, `:188`, `:206`: turning on, changing and turning off answer `busy` while `crypto.job` is in `meta`.
- `extension/src/ledger/crypto-job.ts:41-67`: a step that throws leaves the job and its place in `meta`.
- `extension/entrypoints/options/components/EncryptionSection.tsx:32` and `:40-42`; `CryptoJobLine.tsx:18-19`.

**What is wrong:**
- A step can fail for reasons other than the lock:
  - a sealed row that does not open (`unreadable`);
  - a quota error or another IndexedDB error;
  - a connection closed under it.

  `runJob` ends, and the job stays recorded.
- Nothing resumes it while the ledger stays unlocked: no alarm and no retry. An unlock resumes it (`crypto.ts:163`), but the person is already unlocked, so no page offers one.
- The options page goes on saying "Sealing your records: table N of 9. You can keep using Attest meanwhile."
- It hides Lock now while a job is recorded: `EncryptionControls` renders only when `status.job === undefined`. So the one manual way to resume, lock then unlock, has no button, and the popup has none either.
- Change and Turn off answer "Attest is still rewriting your records. Try again when it has finished." It never finishes until Chrome restarts the worker and the person unlocks.
- The failure is logged at error and shown nowhere.

**Why it matters:**
- Turning encryption off, or changing the passphrase, can be blocked indefinitely behind a progress line that is false (Hard Rule 6).
- Decisions [6.5] (Decisions.md:1634) says lock and unlock work while a job runs.

**Fix:**
- Resume from the grace alarm when the ledger is unlocked and a job is recorded but none is running, with a bounded number of tries.
- Record a failed step in `meta`: the error's name, never a value. CryptoJobLine then says the job stopped, with a "Try again" button.
- Show Lock now while a job runs, since the worker accepts it.
- Test both cases: a step that throws once is retried, and one that always throws (`unreadable`) shows as stopped, not as progress.

QA's untracked `tests/unit/crypto/job.spec.ts` "fails a step whole on a row that does not open" covers the step, not what follows it.

### TECH-3 (MEDIUM): the Unasked notice describes 6 of the 18 sends the red team measured as missed; the other 12 had an agent active within ten minutes

**Where:**
- `extension/src/ui/labels.ts:119-120` (`UNASKED_LIMIT`), and its comment at `:114-117`.
- It is shown at `entrypoints/sidepanel/components/TimelineFiltersForm.tsx:54` and `entrypoints/digest/components/DigestCoverage.tsx:25`.
- The measurement: `extension/tests/fixtures/attacks/unasked-evasion/expected.json`, `docs/attacks-that-work.md:15` and Decisions.md:1651.

**What is wrong:**
- The notice reads: "Attest marks a send as likely Unasked only when an agent was active near it, so a send with no agent activity near it is never flagged."
- The comment above it says the attack that works is "a send … with no agent activity near it".
- A reader takes the converse: an unclaimed send near an agent's activity would be flagged.
- Strategy 10's fixture measured the opposite for most misses. Every missed send was made 60 minutes before the run, three cases per group:

| Missed group | Agent activity near the send |
|---|---|
| `no-agent-activity-near` | none within ten minutes |
| `person-away-only` | none; the person was away |
| `one-agent-line-after` | a logged line 1 minute after |
| `one-agent-claim-before` | a claimed action 1 minute before |
| `two-agent-lines-near` | logged lines 4 minutes before and 6 minutes after |
| `claimed-send-beside-it` | a claimed send 1 minute before, a logged line 5 minutes after |

- So 12 of the 18 misses had an agent active within ten minutes.
- The rule (docs/grading.md §7) needs the agent's signals together to reach `unasked.threshold`. In this grid one signal never did.
- `tests/unit/sidepanel/filters-unasked.spec.ts` checks that the notice is shown, not what it says.

**Why it matters:**
- UNASKED evasion is the one HIGH accepted rather than fixed (Decisions [6.9]), and this sentence is its mitigation: 6.9's Done-when asks for "a UI notice where the user could be misled".
- A person who knows their agent was busy around a send, and sees no Unasked receipt, is told by this sentence that Attest would have flagged it.

**Fix:**
- Word the notice from the measured rule. For example: "Attest marks a send as likely Unasked only when several signs of an agent's activity meet near it. One agent action near a send, or none, is not enough, so many sends an agent makes without claiming them are never flagged."
- Correct the comment at `labels.ts:114-117`.
- Pin the sentence in a copy test, beside the fixture's groups.

### TECH-4 (MEDIUM): the manifest audit reads only the keys it names, so a wildcard optional host and a CSP with no `default-src` both pass

**Where:**
- `scripts/audit-manifest.ts:44-51` (`FORBIDDEN_KEYS`), `:91-117` (`auditManifest`), `:65-88` (`cspProblems`); its header at `:13-15`.
- `extension/wxt.config.ts:138` (`EXTENSION_PAGES_CSP`): `script-src 'self'; object-src 'none'; connect-src …`, with no `default-src`. The built manifest says the same.
- `extension/tests/unit/tools/audit-manifest.spec.ts:36-124`: no case for either.
- `docs/threat-model.md:44`, `:57`, `:106`, `:113-114`.

**What is wrong:**
- **`optional_host_permissions` is never read.** It is an MV3 key, absent from `FORBIDDEN_KEYS` and not checked like `host_permissions`.
  - `{ "optional_host_permissions": ["<all_urls>"] }` passes the audit.
  - The extension could then ask for every host at run time with `permissions.request`.
  - 6.6's Done-when, "adding `tabs` or a wildcard host fails CI", holds for `host_permissions` only.
- **"CSP strict" is checked directive by directive.** The audit requires `script-src 'self'`, `object-src 'none'` and an allowlisted `connect-src`, and flags `unsafe`, `*`, `data:`, `blob:` and bare schemes in any directive present. It does not require `default-src`.
  - With none, `img-src`, `style-src`, `font-src`, `media-src` and `frame-src` are unrestricted.
  - So an extension page may load an image, a stylesheet or a frame from any host.
  - The CSP Attest builds today has no `default-src`.
- **The threat model overstates the CSP.** It says each option "adds one host, the CSP allows no other" (`threat-model.md:57`). That holds for `connect-src` only.
- The audit also does not pin `incognito: 'not_allowed'` (Decisions [2.close] S3).

**Why it matters:** The threat model (`:106`, `:113-114`) and the store listing name `pnpm audit:manifest` as what holds the manifest to Hard Rules 1, 8 and 9. A key the audit does not read is a key nothing holds.

**Fix:**
- Fail on any `optional_host_permissions`, or apply the host check to it.
- Require `default-src 'none'` or `'self'`. Add it to `EXTENSION_PAGES_CSP` with the sources the pages need, and check that the share image still draws.
- Check the manifest's top-level keys against an allowlist rather than a denylist, and pin `incognito`.
- Add the three cases to `audit-manifest.spec.ts`, and reword `threat-model.md:57`.

### TECH-5 (MEDIUM): no test in the range seals, opens or pages a row of `calendarSnapshots`, `digests` or `modelAnswers`, including the one sealed table with a compound key

**Where:**
- `extension/tests/unit/background/crypto-fixtures.ts:17` and `:29-35`: `SEALED_STORES` and `seedLedger` cover requests, claims, observations, receipts and grants.
- `extension/tests/unit/crypto/middleware.spec.ts:77-83`: the same five.
- `extension/tests/e2e/encryption.spec.ts:36` and `redteam-encryption.spec.ts:46`: `openSent` stores Gmail rows only. There is no Calendar page, digest or model answer, so the read-back (`encryption.spec.ts:50`) compares those tables while they are empty.
- The code these paths run:
  - `extension/src/crypto/middleware.ts:63-72`: `aadOf` from `extractKey`.
  - `extension/src/ledger/crypto-job.ts:22-38`, `:49`, `:54`: `placeOf`, `where(':id').above(after)`, and `getByKeyPath` over the key path.
  - `extension/src/ledger/db.ts:100-101`: `calendarSnapshots` is keyed by `[observerId+accountHash+range]`.

**What is wrong:**
- `calendarSnapshots` is the only sealed table with a compound primary key. Each of these runs its array path, and no test in the range runs any of them:
  - its AAD is the JSON of an array;
  - its place in a job is an array, parsed back by `placeOf`;
  - the job pages it with `above(array)`.
- `digests` and `modelAnswers` are only checked to refuse reads while locked (`middleware.spec.ts:216-217`). They are never sealed and read back.
- Paging by `SEAL_JOB_PAGE` (200 rows a step) never runs on more than one row per table in the range.
- QA's untracked `job.spec.ts` pages `SEALED_TABLES` but names none of the three tables.

**Why it matters:**
- 6.5's Done-when asks for round-trip tests, and the gate asks that encryption "round-trips and fails closed".
- A slip on the array path would make every Calendar snapshot `unreadable` once encryption is on, so Calendar grading would fail with it. The job would then stop on that table, silently (TECH-2).

**Fix:**
- Seed one row of every table in `SEALED_TABLES`, derived from that list so a tenth table is covered by construction. Check each is sealed at rest and reads back equal.
- Run the job over more than `SEAL_JOB_PAGE` Calendar snapshots, so an array place is written and resumed.
- In the e2e test, open the synthetic Calendar week before turning encryption on.

### TECH-6 (LOW): three paths leave keys in use after a lock, or keep a locked worker awake

**Where:**
- `extension/src/ledger/shared.ts:49-61`, with `extension/src/ledger/crypto-state.ts:81-86`.
- `extension/src/background/crypto.ts:172-180`, with `:70-76`.
- `extension/src/background/crypto.ts:86-93`, `:218-223`, `:243-253`.

**What is wrong:**
- **A failed reload keeps the old keys.**
  - `loadKeyring` sets the keyring only after reading both `meta` and the session's keys.
  - If either read throws, `reloadKeyring` logs `ledger.keyring_reload_failed` at warn, and the page keeps the keyring it had.
  - After a lock, that page still opens sealed rows. The middleware's header promises "Fail closed, never partly" (`middleware.ts:9`).
- **Lock does nothing when the worker holds no key.**
  - `onCryptoLock` clears only `if (held.current !== undefined)`, and answers `{ ok: true }` either way, so the options page says "Locked.".
  - The pages' copy can outlive the worker's keys: the clear at each start is fire-and-forget, and only logged when it fails (`crypto.ts:73-75`).
  - In that case Lock now says "Locked." while every page stays unlocked.
- **A job's end changes the keys outside the one-at-a-time queue.**
  - `jobDone` calls `hold` from the job, not through `oneAtATime`.
  - `hold` chooses keep-awake from its argument (`keys.current`), not from `held` after the load.
  - A Lock now that lands as a re-seal job ends can finish first. The job's `hold` then calls `keepAwake()` on a locked worker, which pings every 20 s until the next lock or unlock.
  - The same race between an unlock and the end of an unseal job leaves a key in `held`, and in session memory, for a ledger that is no longer encrypted.

**Why it matters:** Lock now is the one control the docs give against someone using the browser (`docs/privacy-architecture.md:595`, `EncryptionStatement.tsx:25-26`). It should not report success while a context still holds a key. Each path needs an error or unlucky timing, hence LOW.

**Fix:**
- Set the keyring to locked (`{ sealing: true, guarded: true }`, no keys) before `loadKeyring` reads, so a failed reload fails closed.
- Have `onCryptoLock` always clear the session copy and reload.
- Run `jobDone` through `oneAtATime`, and derive keep-awake from `held` after the load.

### TECH-7 (LOW): a malformed key record reads as a wrong passphrase or as a lock, and nothing is logged at warn or error

**Where:**
- `extension/src/background/crypto.ts:106-119` (`keyFor`) returns `undefined` silently for each of these:
  - a missing salt, key id, check or round count;
  - a round count outside 600,000 to 6,000,000;
  - a salt that is not base64.
- `:155-159`: unlock logs `crypto.unlock_refused` at info and answers `wrong_passphrase`. Change and turn off (`:189-190`, `:207-208`) answer it with no log at all.
- `:160`: a `crypto.previous` that does not unwrap becomes `undefined`, with no log. Rows sealed under the key before then fail `locked` (`middleware.ts:93-94`), and the job logs `crypto.job_paused` at info (`:246`).

**What is wrong:**
- A corrupted `meta`, or a future bug in `crypto-writes.ts`, makes the right passphrase read "That passphrase does not open your records", for good.
- A bad `crypto.previous` makes the ledger read as locked right after a successful unlock, and the prompt comes back.
- Neither is logged above info, and the person's likely next step is Delete all data.

**Fix:**
- Tell a malformed key record apart from a passphrase that does not give the key. Log `crypto.key_record_invalid` at error, naming the field, never its value, and answer `failed`.
- Log a failed unwrap at error, and refuse the unlock rather than unlock half the ledger.

### TECH-8 (LOW): a locked ledger is still reported as a failure in the side panel's detail, the usage numbers and three worker commands

**Where:**
- `extension/entrypoints/sidepanel/use-timeline.ts:203-205` (a receipt's detail) and `:179-180` (load more): a `locked` error is logged `sidepanel.read_failed` at error and shown as a failure.
- `extension/entrypoints/options/use-telemetry-view.ts:36-41` folds `locked` into `null`. `components/TelemetryPreview.tsx:10` words that "Attest cannot build the numbers on this browser."
- `extension/src/background/telemetry.ts:36-39`: "Send a test payload now" while locked logs `telemetry.handler_failed` at error and answers `failed`.
- `extension/src/background/router.ts:98-107` with `:117-132`: only `claims.import` and the four observer messages get `lockedAck`. `grant.save` and `receipt.event` meet the middleware's `locked`, and `src/bus/listen.ts:165-166` logs that `bus.handler_failed` at error.

**What is wrong:**
- Sprint 6 made "a locked ledger is no failure" the rule in four places:
  - `src/ui/use-ledger-read.ts:36-39`;
  - `entrypoints/popup/use-popup-view.ts:64-66`;
  - the timeline's list (`use-timeline.ts:151-153`);
  - the export (`export-ledger.ts:69-71`).
- Decisions.md:1632 says every page that reads content says the records are locked and offers the unlock.
- The paths above were missed:
  - a receipt open in the side panel when the person presses Lock now reads again (keyring reload, then `onLedgerChanged`), logs an error, and shows a read failure instead of the unlock prompt;
  - an alert clicked while locked does the same.

**Why it matters:** Error-level logs for an expected state hide real failures (Hard Rule 6). The usage-numbers line tells the person their browser cannot do something it can.

**Fix:**
- Send the detail and load-more catches through the same `isLedgerLocked` branch, with one helper (TECH-14).
- Give the preview a locked state ("Unlock your records to see the numbers").
- Answer `locked`, logged at info, from the worker for every page command that touches a sealed table, for instance by mapping `LedgerError('locked')` in `listen.ts`.

### TECH-9 (LOW): src/crypto runs in the service worker but is fenced as page code

**Where:**
- `extension/eslint.config.js:245-246`: a Sprint 0 block, `files: ['src/crypto/**'], rules: appGlobals({ indexedDB: true, console: false, dom: true })`.
- `extension/eslint-rules/fences.js:35-53` (`WORKER_SCOPES`): neither `src/crypto/**` nor `src/config-crypto.ts`.
- `extension/eslint-rules/fences.js:69` (`DEXIE_ALLOWED`) with `eslint.config.js:232-233`: the only import fence src/crypto gets is the Node one.
- `extension/eslint-rules/fences.js:92-108` (`NODE_BUILTINS`).

**What is wrong:**
- **The worker runs all of src/crypto**, and `config-crypto.ts`: `background/crypto.ts` imports bytes, kdf, keyring, seal and session, and `migrations.ts` imports the middleware.
  - The src/crypto block allows DOM globals (`dom: true`) and raw `indexedDB`, and no block puts these files under `WORKER_DOM`.
  - So a `document` in `keyring.ts` lints clean and fails only at run time in the worker.
  - This is the class the Sprint 5 close fixed for `src/telemetry/**` (Sprint 5 tech review, TECH-1).
- **src/crypto has no layering fence.** It goes through Dexie and needs no `indexedDB`. Nothing stops it importing `src/ui` or `src/background`, which the ledger it sits below may not (`LEDGER_RESTRICTED_IMPORTS`).
- **`NODE_BUILTINS` names 13 modules.**
  - A bare `zlib`, `events`, `assert`, `querystring`, `string_decoder`, `timers`, `vm`, `dns`, `tls`, `readline` or `perf_hooks` passes; only the `node:` form is caught.
  - Decisions.md:1636 says the fence now matches "every way a Node built-in is imported". That is true for the 13 it lists.

**Fix:**
- Add `src/crypto/**` and `src/config-crypto.ts` to `WORKER_SCOPES`, and make the src/crypto block `appGlobals({ indexedDB: false, console: false, dom: false })`.
- Give src/crypto the ledger's layering pattern.
- Build `NODE_BUILTINS` from `builtinModules` (`node:module`; the config runs in Node), and have `fences-scopes.spec.ts:284` walk that list.

### TECH-10 (LOW): a schema upgrade that writes a sealed table on an encrypted ledger writes in the clear

**Where:**
- `extension/src/ledger/shared.ts:63-65`: `openLedger()`, upgrades included, runs before `loadKeyring`.
- `extension/src/crypto/keyring.ts:28-29`: every context starts `OPEN` (`sealing: false, guarded: false`).
- `extension/src/crypto/middleware.ts:76-77`: `sealRow` passes a row through unless `ring.sealing`.
- Decisions.md:1635.

**What is wrong:**
- Decisions [6.5] says such an upgrade "fails closed and the ledger does not open".
- That holds for reads: a sealed row read before the keyring loads fails `locked` (`middleware.ts:93-94`).
- It does not hold for writes. During an upgrade the keyring is still `OPEN`, so a migration that adds or rewrites rows of a sealed table without reading them stores them plain on an encrypted ledger. A default grant is one example; a field back-filled with `put` is another.
- Nothing seals those rows later, since the job runs only when encryption is turned on, changed or turned off.

**Fix:**
- Have `openLedger` refuse a migration that writes a sealed table when `meta` says `crypto.sealing`. One way: run every migration in a test against an encrypted-ledger fixture, and fail on any plain row left in a sealed table.
- Correct the Decisions line.

### TECH-11 (LOW): an export of an encrypted ledger carries a verifier for the passphrase

**Where:**
- `extension/src/ledger/export.ts:141` and `extension/src/ledger/export-file.ts:121`: every `meta` row is exported.
- `extension/tests/e2e/encryption.spec.ts:52-54`: the read-back expects `crypto.sealing`, `crypto.keyId`, `crypto.salt` and `crypto.check` in the export.
- `docs/privacy-architecture.md:598`, and §8.

**What is wrong:**
- With encryption on, an export holds the salt, the round count and the key check, which is a fixed text sealed under the key. During a change it also holds `crypto.previous`.
- Together they let anyone holding the file test passphrases offline, at PBKDF2's pace.
- The export is written opened, so this reveals nothing more of the records. It reveals a way to guess the passphrase itself, which people reuse.
- The docs say to treat an export "like the unlocked ledger", not like a passphrase.

**Fix:**
- Leave `crypto.*` out of both exports (in an opened export the state means nothing), drop the e2e expectation, and record the choice in Decisions.
- Or say it plainly in §8 and §12.

### TECH-12 (LOW): what encryption costs at a month of use is not measured

**Where:**
- `extension/tests/e2e/support/perf-ledger.ts:49-77`: the 30-day ledger is written into IndexedDB directly, below Dexie and the middleware.
- `extension/tests/e2e/perf-ledger.spec.ts:30-55` and `bench/perf.ts:61-90` never turn encryption on.
- `extension/src/crypto/seal.ts:2-8`: AES-GCM in JavaScript (`@noble/ciphers`), chosen over WebCrypto because sealing must stay inside the transaction (Decisions.md:1629).
- `extension/src/crypto/middleware.ts:110-115`: the cursor's `value` getter opens the row on every read.

**What is wrong:**
- 6.4's gates were measured before 6.5 landed: `8acde80` precedes `122d527`. The re-measure at `8065826` ran with encryption off.
- With encryption on, every read of a sealed row decrypts in JavaScript. noble's own README puts its AES-GCM at about 1/60 of WebCrypto's throughput.
- None of these has been measured with encryption on:
  - the popup's first paint over a sealed month (gate 100 ms);
  - the worker's grading batch over sealed observations;
  - the export;
  - how long the job takes to seal a month's rows, about 60,000 at 200 a transaction, while change and turn off answer `busy`.
- The cursor getter decrypts again on each read of `value`. Dexie reads it twice per row in a filtered iteration (`dexie.mjs:2047-2066`). No `src` read filters a sealed table today.
- No number is claimed, so Hard Rule 12 holds. The gap is an opt-in mode of the product with no measurement.

**Fix:**
- Run `perf-ledger` once with encryption on: seed through Dexie with the keyring set, or let the job seal the month.
- Record the numbers as `perfMonthSealed*` in RESULTS.md, with the job's duration, and gate the popup's paint as on the unsealed ledger.
- Cache the opened value per cursor position.

### TECH-13 (LOW): tests that cannot fail the way their titles say

**Where and what:**
- **Three of the five malformed encryption commands carry no secret.**
  - `extension/tests/unit/bus/harness.ts:364`, `:367` and `:368`: `crypto.enable` with `'short'`, `crypto.change` with twelve spaces, `crypto.disable` with `''`.
  - `tests/unit/bus/round-trip.spec.ts:178` checks only `not.toContain(SECRET)`, so for these three a drop that logged the payload would still pass.
  - No test of the worker's commands searches its logs for the passphrase either (`crypto-commands.spec.ts`, `crypto-locked.spec.ts`), though Hard Rule 10 and Decisions.md:1633 say it is never logged.
- **The near-miss loop can pass on the previous attempt's message.**
  - In `extension/tests/e2e/redteam-encryption.spec.ts:55-59`, after the first wrong passphrase, the refusal and the locked text are already on the page.
  - So attempts two to five are asserted before their own answers arrive.
  - A near miss that unlocked would show up only as the next `unlockIn` timing out, a misleading failure.
- **The batching test asserts half the rate its title gives.** `extension/tests/e2e/observer-skeleton.spec.ts:229` says "under 100 DOM changes a second", while `:256` asserts more than 300 changes in 6 s, which is 50 a second.
- **The e2e at-rest read keeps its own list of the sealed tables.**
  - `extension/tests/e2e/support/encryption.ts:14-25` writes the nine names out, its comment says, because "the page evaluates this alone".
  - But the list is passed to `page.evaluate` as an argument (`:86`), so it could be `SEALED_TABLES`, and `config-crypto.ts` imports nothing.
  - A tenth sealed table would go unchecked at rest.

**Fix:**
- Put `SECRET` in each encryption near-miss: a passphrase past 1,024 characters made from it, or an extra field. Add one worker test that captures logs over enable, a wrong unlock, change and disable, and searches them for each passphrase.
- Wait for each attempt's own answer: "Unlocking…" appearing and going, or a count of `crypto.unlock_refused`.
- Assert at least 500 changes, or retitle the test.
- Import `SEALED_TABLES`.

### TECH-14 (LOW): duplicated logic

**Where and what:**
- `SessionKeys` (`src/crypto/session.ts:20-23`) repeats `HeldKeys` (`src/crypto/keyring.ts:14-19`).
- `src/background/crypto.ts:246` re-implements `isLedgerLocked` (`src/ledger/errors.ts:78-79`).
- The "a locked ledger is no failure" catch is written four times, and missed where TECH-8 lists:
  - `src/ui/use-ledger-read.ts:36-39`;
  - `entrypoints/popup/use-popup-view.ts:64-66`;
  - `entrypoints/sidepanel/use-timeline.ts:151-153`;
  - `entrypoints/options/export-ledger.ts:69-71`.
- The encryption fixtures exist twice: `tests/unit/crypto/middleware.spec.ts:64-83` defines the same five rows, `CONTENT` list and seed as `tests/unit/background/crypto-fixtures.ts:10-35`.
- Raw IndexedDB writes exist three times:
  - `tests/e2e/support/redteam-setup.ts:66-94` `writeAway` repeats `tests/e2e/support/demo-flow.ts:39-61` `writeAway`;
  - `perf-ledger.ts:49-77` `putRows` is the general form of both.
- The perf gates are written twice: `bench/perf.ts:35-38`, and `tests/e2e/perf-gmail.spec.ts:15-18` with `tests/e2e/perf-ledger.spec.ts:26-29`.
  - The median is computed twice too: `bench/perf.ts:43-46` and `perf-gmail.spec.ts:26-27`.
  - `perf-bench.spec.ts` pins the bench's constants only, so CI's gate and RESULTS.md's can drift apart.
- `pnpm bench` builds the extension three times: `bench/popup.ts:49`, `bench/redteam.ts:62` and `bench/perf.ts:93`. Each discards the build's output (`stdio: 'ignore'`), so a failed build never says why.
- `TimedPass` is declared in `tests/e2e/support/sent-pass-harness.ts:15-21`, and again as a schema in `perf-gmail.ts:28-34`.

**Fix:**
- Keep one `HeldKeys`, and use `isLedgerLocked` everywhere.
- Add one helper that classifies a read's error as `locked` or `failed`, and logs only the second.
- Keep one encryption-fixtures module and one `putRawRows(target, store, rows)` support helper.
- Put the gates in one module that the bench and the specs import.
- Add one `buildExtensionOnce()` in `bench/` that prints the build's output when it fails.
- Type the schema from the harness's `TimedPass` with `satisfies`.

### TECH-15 (LOW): doc, CHANGELOG and copy lines that do not match the code

**Where and what:**
- **"While it is locked, Attest reads and stores nothing."**
  - This is in `PRIVACY.md:90`, and `CHANGELOG.md:75` makes the same claim ("while it is locked, it reads and stores nothing").
  - The readers keep reading: a pass reads the whole page (`src/observers/base.ts:239`) before its first post, and a `locked` answer only ends the posting (`:244-248`).
  - Calendar's heartbeat reads again even when nothing changed (`base.ts:267`).
  - `docs/privacy-architecture.md:587` says it correctly: the worker stores nothing. Pausing the readers while locked would also save the work.
- **The options page's link "What encryption protects"** goes to `#2-what-attest-cannot-hide` (`entrypoints/options/components/EncryptionStatement.tsx:34`). The section that answers it is §12 (`#12-encryption-at-rest`), which `PRIVACY.md:90` links.
- **The CSP sentence** in `docs/threat-model.md:57` holds for `connect-src` only (TECH-4).
- **The store listing's `storage` line** (`launch/store-listing.md:11`) leaves out session memory, where an unlocked ledger's key is kept for the pages. Decisions.md:1640 names it, and 6.6's Done-when wants the two to agree.
- **No CHANGELOG line for 6.9.** Commit `7d32572` adds a sentence to the side panel and the weekly digest, and changes no CHANGELOG.
- **The §12 table of fields kept in the clear** (`docs/privacy-architecture.md:569-579`) is computed from the schema at run time (`src/crypto/middleware.ts:41-49`). No test holds the table to it, as `META_KEYS` is held (`tests/unit/docs/privacy-architecture.spec.ts:174`). A new index would leave a field in the clear without the doc saying so.

**Fix:** Correct each line. Add a docs test that derives the fields kept in the clear for each sealed table from `STORES_V*` and `INDEX_FIELDS`, and compares them with the §12 table.

### TECH-16 (LOW): Decisions entries missing for choices made in the range

**What has no entry:**
- The audit's floor is Chrome 114 (`scripts/audit-manifest.ts:43`), while the manifest asks for 120 (`extension/wxt.config.ts:169`). The script's header explains 114. No Decision says why the audit allows less than the build.
- `extension/tests/redteam/` is a test directory outside build_spec §6's layout: unit, property, e2e, fixtures and tools (build_spec.md:221-231). Decisions [6.0] names its files, not the change to the layout.
- The options page hides Lock now while a job runs (`EncryptionSection.tsx:40`), though the worker accepts it (Decisions.md:1634).
- `crypto.lock` answers `ok` without clearing anything when the worker holds no key (`src/background/crypto.ts:174`).
- Exports keep `crypto.*` (TECH-11).

**Why it matters:** CLAUDE.md asks for every unspecified decision, dated, with its reason and the Hard Rule it protects.

**Fix:** One line each, or change the code where TECH-2, TECH-6 or TECH-11 already asks it.
