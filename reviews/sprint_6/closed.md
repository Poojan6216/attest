# Sprint 6 — Close

Role: agents/sprint_closer.md. Inputs, in this folder: `qa.md` (6 gaps: QA-1 fixed by the QA review itself, 5 open), `security.md` (10 gaps), `tech.md` (16 gaps), `privacy.md` (5 gaps, the 6.7 pre-review), and the red team's results in `docs/attacks-that-work.md`. The reviews read `8065826`; they and QA's tests are committed as `10566db`. Range closed: `10566db` to HEAD. Every gap is fixed in code, or, where only the founder can act, in MANUAL.md with its exact steps. Nothing was fixed by weakening a test, a Hard Rule, a lint rule, a threshold, a gate or an allowlist; where a test pinned the old behaviour, the change is the stricter one, said in its commit and in Decisions.md. Every `[6.close]` entry in Decisions.md records a decision the close made. Where two reviews raised one gap, it is fixed once and listed once, with both names.

One finding is new, from measuring SEC-1: the profile's files read without Chrome held what the rows were before encryption was turned on. By the red team's scale (agents/red_team.md rule 4: a data leak) that is CRITICAL, so it is listed first, though the security review weighed it MEDIUM.

## FIXED IN CODE

Severity order; Hard Rules 1 to 4 first, whatever the review wrote.

### CRITICAL

1. **SEC-1, red-team strategy 13: a copy of the profile held the rows as they were before encryption.**
   - **Measured** with a reader of Chrome's LevelDB files written for it (the log's records joined, every table block uncompressed, each value searched as Latin-1 and as UTF-16LE). At `8065826`: with two sends, 4 of 4 values readable after sealing; at 5,000 sends, 1,200 to 2,400 left after sealing, partly through Chrome's own undo log, and still there after the browser closed. Delete all data left 1,200 of 5,000 sends in files Chrome had not removed, and a small ledger whole.
   - **Changed:** the ledger lives in a storage bucket of its own (`navigator.storageBuckets`, Chrome 122 and later), `ledger-` and a generation, named in `chrome.storage.local`; Chrome keeps a bucket's IndexedDB in a folder of its own and deletes the folder whole with the bucket. Once a job has sealed every row (turned on, or a new passphrase), the service worker copies every row as stored into the next bucket's ledger, counts it, names that bucket, and deletes the one before. While it runs, reads and writes wait (a hold in the worker, a session mark for the pages). A stop before the naming leaves the ledger as it was and the rebuild due; a stop after leaves the bucket before, which the next start deletes. Delete all data deletes every ledger bucket. A ledger an earlier build kept in the default store is moved into the bucket at the first start. The minimum Chrome becomes 122.
   - **Why a bucket, not the first fix:** `a25e6c5` deleted and remade the database, with a small database around each deletion so that Chrome compacted the deleted rows away. The full end-to-end run then failed once: Chrome compacts a deleted database on a thread of its own after the deletion has answered, and LevelDB skips that compaction's flush when another write is queued at the same moment, so the rows stayed in a live file for good. Reproduced in 5 runs of 12 with four browsers at once; never with one. Deleting a bucket leaves nothing to compact.
   - **Measured after (`6dffbef`):** 0 of 4 values with two sends; 0 of 5,000 sends at once, ten seconds later and after the browser closed, sealing and rebuilding in 2.9 s; no row under the old key after a new passphrase in 36 runs of 36 with four and six browsers at once, read the moment the change ended; Delete all data 0 of 5,000 at once. `navigator.storage.estimate()` counts a bucket's data (measured), so the 50 MB gate still measures the ledger; uninstalling deletes the bucket's folder (measured).
   - **Code:** `extension/src/ledger/place.ts` (new), `rebuild.ts`, `rebuild-mark.ts`, `shared.ts` (the hold; a connection Chrome closes is forgotten and never reopened), `migrations.ts`, `crypto-writes.ts`, `crypto-state.ts`; `extension/src/background/rebuild.ts`, `crypto.ts`, `settings.ts`; `extension/entrypoints/background.ts`; the options page's `RebuildLine.tsx`; `src/config-manifest.ts` (Chrome 122).
   - **Tests:** `tests/unit/ledger/rebuild.spec.ts` (every table's rows and keys copied as stored over more than a page, a stop at each step settled at the next start, a half-made bucket never trusted, a copy that fails or counts wrong refused, a ledger from the default store moved), `tests/unit/background/rebuild.spec.ts` (the hold, the page mark, a page's connection closed with its bucket never reopened, a failed copy, a failed deletion of the bucket before, the start); nine mutations each caught. `tests/unit/storage-buckets-setup.ts` gives the unit run buckets of fake-indexeddb. `tests/e2e/redteam-encryption.spec.ts` and `tests/e2e/options-settings.spec.ts` read the profile's files, buckets' folders included (`tests/e2e/support/profile-files.ts`), every value found before encryption as the proof the reading works.
   - **Docs:** privacy-architecture §5, §7 and §12 ("Chrome's own copies", the disk itself, uninstalling), PRIVACY.md 0.9, the threat model, attacks-that-work strategy 13 with its numbers before each fix, the CHANGELOG, Decisions `[6.close]` (the bucket design, Chrome 122, the hold).

### MEDIUM

2. **SEC-2: with encryption on, the person's own model key stayed in the clear.** Sealed under the ledger's key in `chrome.storage.local` while encryption is on, sealed again under a new passphrase, opened for good when it is turned off; brought in line after every change of the keys; a save refused while locked. `extension/src/background/byo.ts`, `src/crypto/seal.ts` (`sealText`); `tests/unit/background/byo-sealed.spec.ts` (three mutations caught).
3. **SEC-3 / TECH-4: the manifest audit passed a looser manifest.** It checks the manifest's keys against the ones Attest uses (an optional host, `chrome_settings_overrides` and any other fail), requires incognito `not_allowed` and the build's own Chrome 120 (one constant, `src/config-manifest.ts`), and holds every CSP directive but `connect-src` and `img-src` to `'self'` or `'none'`; `pnpm build:release` audits its zip. The shipped CSP gains `default-src 'self'`, `img-src 'self' blob:` and `form-action 'none'`. `scripts/audit-manifest.ts`, `extension/wxt.config.ts`; `tests/unit/tools/audit-manifest.spec.ts` (a test per hole, a zip read), the share image, unlock and CSP end-to-end tests.
4. **TECH-1: the popup's start load was 694 B under its budget, 4.4 KB of it a cipher a plain ledger never runs.** The cipher loads only for a ledger that may hold sealed rows, `isSealed` lives apart from it, the unlock prompt loads when the popup first finds the ledger locked; the service worker, which Chrome forbids `import()`, provides the cipher from its own import. 124,306 B → 119,970 B. `src/crypto/cipher.ts`, `sealed.ts`, `src/ui/use-loaded.ts`; `tests/unit/crypto/cipher.spec.ts`, `tests/e2e/built-bundle.spec.ts` (no cipher code in the popup's start load).
5. **TECH-2: a job that failed stopped for good while the page showed progress.** A failed step is recorded (`unreadable` or `storage`, and a count); the grace alarm retries it while unlocked, up to `MAX_JOB_TRIES` failures in a row; the page says it stopped and why, with Try again (a new page command, `crypto.resume`); Lock now shows during a job. `src/background/crypto.ts`, `alarms.ts`, `src/ledger/crypto-writes.ts`, the options page; `tests/unit/background/crypto-job-retry.spec.ts` (a real row that does not open), the bus tests.
6. **SEC-8 / TECH-3: the Unasked notice understated what Unasked misses.** It states the rule as measured: two different signs must meet near a send. `src/ui/labels.ts`; pinned in `tests/unit/copy.spec.ts`.
7. **TECH-5 / QA-3: four sealed tables never round-tripped.** Every table of `SEALED_TABLES`, taken from the list itself, round-trips and refuses a moved value; the job pages 450 Calendar snapshots with an array as its place; the e2e seals and reads back a Calendar week. `tests/unit/crypto/sealed-tables.spec.ts`, `job.spec.ts`, `tests/e2e/encryption.spec.ts`.
8. **QA-2: the paint gate measured a development build.** Every test and bench builds through one helper with `NODE_ENV=production`; the bundle test fails a build with development JSX or this machine's paths. `tests/tools/build-extension.ts`, `tests/e2e/built-bundle.spec.ts`.

### LOW

9. **SEC-4 / TECH-11:** exports leave the encryption state out; a secret-seed test with encryption on searches every channel and the closed profile's files for the passphrase and the key (`tests/e2e/no-leak-encrypted.spec.ts`; its control checked by hand to catch both).
10. **SEC-5 / TECH-6:** locking fails closed: a keyring locked while read and after a failed read, Lock now always clears, the start's clear heads the command queue and is tried twice, a job's end takes its turn, keep-awake follows the keys held (`tests/unit/background/crypto-fail-closed.spec.ts`, five mutations caught).
11. **SEC-6 / TECH-7:** a damaged key record is answered `damaged` and logged at error by its field, never as a wrong passphrase; a key before that does not unwrap refuses the unlock whole; a row under a key not held while unlocked is `unreadable`, not `locked` (`tests/unit/background/crypto-damaged.spec.ts`, the rounds' bounds included).
12. **SEC-7 / TECH-10:** an upgrade of an encrypted ledger runs with the keyring locked, so it cannot write a sealed row in the clear (`tests/unit/ledger/migrations-sealed.spec.ts`); the Decisions line corrected.
13. **SEC-9 / TECH-15:** the passphrase's route, "stores nothing while locked", the README's claim, §11's timing, the options link, the store listing's storage line and 6.9's CHANGELOG line corrected; §12's table held to the middleware (`tests/unit/docs/sealed-fields.spec.ts`).
14. **SEC-10:** `@noble/ciphers`' size (3,828 B gzipped), audit (Cure53 at 1.0.0, September 2024) and timing trade recorded; build_spec §5's row amended.
15. **TECH-8:** a locked ledger is no failure in the side panel's detail and older receipts, the usage numbers or a page command.
16. **TECH-9:** src/crypto fenced as worker code below the ledger; the Node built-ins banned are every module Node ships.
17. **TECH-12 / QA-4:** a sealed month measured, its paint gated (64 ms; sealing 19.5 s, the rebuild 11.2 s, 58.8 MB, in `RESULTS.md`); the rebuild reads pages whole; the cursor opens each row once.
18. **TECH-13 / QA-5 / QA-6:** malformed encryption commands carry the secret; the logs searched for every passphrase; each near miss checked on its own answer; the sealed tables from the code; the batching test's title what it holds.
19. **TECH-14:** logic written once (keys, the locked check, a page's read failure, fixtures, the raw writer, the perf gates, the build).
20. **TECH-16:** the `tests/redteam/` layout recorded; the other entries answered by the changes.

Also run: `pnpm audit --prod`, which the security review could not run offline: no known vulnerabilities.

## MANUAL ACTION REQUIRED

The privacy pre-review's five gaps (6.7), each already in MANUAL.md, "During Sprint 6" and "Sprint 7":

1. [ ] A public address for the privacy policy → decide when to make `Poojan6216/attest` public, then enable GitHub Pages; put the URL in `launch/store-listing.md`.
2. [ ] A public link to the source for the store's reviewers → the same decision.
3. [ ] Certify the privacy practices form, including how the own-key option is declared → `launch/store-listing.md` holds the draft answers.
4. [ ] Re-read OpenAI's Terms of Use in a browser before submission.
5. [ ] Screenshots with fixture data → sprint_7 7.4.

## ACCEPTED AS KNOWN LIMITATION

1. **UNASKED evasion (strategy 10)** → 18 of 25 missed (72%), HIGH → accepted in 6.9, Decisions `[6.9]`, docs/attacks-that-work.md; its notice now states the measured rule (SEC-8).
2. **Deleted files on the disk itself** → Chrome deletes a deleted bucket's folder, and the files a compaction replaces, without overwriting them; a tool that recovers deleted files from the disk may find older copies → Decisions `[6.close]`, privacy-architecture §12, the threat model.
3. **A sealed month's storage** → 58.8 MB against 40.2 MB plain (`pnpm bench`, `perfMonthSealedStorageBytes`), as ciphertext does not compress; the 50 MB gate stays the ledger's as it ships, unencrypted → Decisions `[6.close]` (TECH-12), §12.
4. **A ledger an earlier build kept in Chrome's default store** → moved into the bucket at the first start and deleted there, compacted as Chrome manages, which can leave older copies in the default store's files; no released build kept the ledger there → Decisions `[6.close]`.

## VERIFIED CLEAN

**VERIFIED CLEAN.** Every gap of the three reviews is fixed in code and tested, or, where only the founder can act (the privacy pre-review's five), in MANUAL.md with its exact steps; none of the reviews' gaps is accepted. The new finding, a copy of the profile holding the rows as they were before encryption, is fixed and measured, also under load. The full suite ran last, on the committed tree (Verification).

Full suite: unit 544 files, 11,290 tests passed and 7 skipped by design (the candidate index's implementation-only cases); the perf gates 9/9; e2e 104/104, the `@mandatory` tests among them; bench green (11 benches, every gate); telemetry-api 114/114; lint, typecheck and `check-docs` clean; `pnpm audit --prod` finds no known vulnerability.

## Test expectations changed with the behaviour they describe

- After Delete all data, `chrome.storage.local` holds one key, the name of the new ledger's bucket, the first again (`settings.spec.ts`, `settings-edges.spec.ts`, `byo-edges.spec.ts`, `grace-upkeep.spec.ts`, `options-settings.spec.ts`; SEC-1).
- A test that reads or writes the ledger's rows itself opens the ledger in its bucket (`crypto-commands.spec.ts`, `crypto-job-retry.spec.ts`, `tests/unit/crypto/raw-store.ts`; in the browser, `tests/e2e/support/ledger-place.ts` and every helper that opens it); an open that fails is made to fail in the bucket (`get-ledger.spec.ts`, `retention-alarm.spec.ts`, `alarms.spec.ts`); the leak collector reads every bucket's databases, named `<bucket>:<name>` (`channels.ts`, `no-leak.spec.ts`); the profile scan reads the buckets' folders (`profile-files.ts`); a page's connection open during Delete all data is closed, never reopened (`settings.spec.ts`).
- The rebuild's tests describe the bucket design: no copy is put back, so a failed restore no longer exists to test; a failed copy, a copy that counts wrong and a failed deletion of the bucket before do (`tests/unit/ledger/rebuild.spec.ts`, `tests/unit/background/rebuild.spec.ts`).
- The manifest audit's floor is Chrome 122, and a Chrome 121 manifest fails it (`audit-manifest.spec.ts`).
- The built bundle's CSP pins hold the new directives (`built-bundle.spec.ts`; SEC-3), the Unasked notice is pinned as measured (`copy.spec.ts`; SEC-8), and `Try` is a verb a button may start with (`copy.spec.ts`; TECH-2).

## Verification

On a quiet machine, the code at `6dffbef`, the strategy 13 record at `17a39e4` (docs only), and its bench results committed with this close:

- `pnpm lint` (ESLint, Prettier, `check-docs`) and `pnpm typecheck`: pass.
- `pnpm test`: 544 files, 11,290 tests passed, 7 skipped (the same 7 as at the Sprint 5 close); the perf gates 6 files, 9 tests.
- `pnpm test:coverage`: src/core lines 99.38%, statements 98.83%, branches 93.15%, functions 99.78% (gate 95%); observers and adapters lines 99.03%; UI lines 96.11%; `pnpm test:poison` 6,371 passed, core lines 99.27%; `test:tz` 6,598 passed and 7 skipped in each of Pacific/Kiritimati and America/St_Johns.
- `pnpm e2e` at `6dffbef`: 104 passed, the `@mandatory` tests among them, red-team strategy 13 both ways. The failure that the close's first full run found (rows under the old key after a new passphrase, under load) is the reason for the bucket design: measured since, 0 runs of 36 with four and six browsers at once.
- telemetry-api: `uv run pytest` 114 passed.
- `pnpm bench` at `17a39e4` (RESULTS.md, Chrome 153), every gate passed: the 30-day ledger 40.2 MB (gate 50 MB), its popup's first paint 72 ms and sealed 64 ms (gate 100); sealing it 19.5 s and the rebuild 11.2 s more, 58.8 MB sealed; the Gmail Sent pass 676.1 ms over 10,000 rows (gate 2,000); the red team's 13 harness strategies over 131 cases, the same counts as before the close (6 still work, none critical).

Commit: `chore(sprint-6): close 31 review gaps`
