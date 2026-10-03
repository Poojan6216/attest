# Sprint 1 — Security

Role: agents/security_reviewer.md. Range reviewed: `937c333..0067c80` (Sprint 0 close to the last Sprint 1 task). Each review was checked by an independent adversarial verifier that re-ran the evidence and tried to refute every gap; verdicts are inline (CONFIRMED, RESIZED with the new severity, or REFUTED).

## Security review

This is the read-only Sprint 1 security review the workflow started. It wrote nothing in the repo. Probe scripts are in the scratchpad at review1/security/.

Scope: every file in 937c333..0067c80 (330 files), checked against agents/security_reviewer.md and the focus list.

Result: 7 gaps. 3 CRITICAL, 2 MEDIUM, 2 LOW.

- **SEC-1 (CRITICAL, Hard Rule 4, live).** Grading depends on the JS engine's Unicode tables (NFKC, toLowerCase, \p{} classes). Unicode 16 outlined digits U+1CCF0–9 turn an observation from PARTIAL 0.8434 into VERIFIED 0.899. Node 22.14, which runs `attest replay`, has Unicode 16.0. Chrome 120, the minimum, predates it. So replay, or a Chrome upgrade, can report false mismatches.
- **SEC-2 (CRITICAL, Hard Rule 4, latent).** The features memos key policy parts by object identity. A policy mutated in place is scored from stale values. grade() never checks the "loaded, frozen policy" precondition in §3.
- **SEC-3 (CRITICAL, Hard Rule 2, latent).** counterparty and merchant accept any text up to their caps, newlines and control characters included. redact.project kept a multi-line body with an SSN. Nothing can exploit this before the Sprint 2 adapters, but the guard should exist before they write.
- **SEC-4 (MEDIUM, Hard Rule 5).** loadPolicy accepts a rule that concludes VERIFIED, or NOT_FOUND, without the evidence conditions. grade() then returned VERIFIED FINAL with no candidate.
- **SEC-5 (MEDIUM, Hard Rules 5 and 6).** grade() trusts the caller's candidates. A calendar event made an email claim VERIFIED FINAL. A row from 3 days earlier gave PARTIAL FINAL.
- **SEC-6 (LOW, Hard Rule 10).** ReasonTextError puts an unvalidated reason code into its message.
- **SEC-7 (LOW, Hard Rule 10).** `attest replay` prints raw export keys, terminal escape sequences included.

Clean:
- No network calls in extension/src or entrypoints.
- Manifest, CSP and permissions unchanged.
- No eslint-disable added.
- No new dependencies.
- `pnpm audit --prod` is clean from the repo root and from extension/.
- The policy allowlist change (rowKeyHash) is logged in Decisions.md.
- src/core imports only zod and the policy JSON, and has no clock, randomness or Intl.
- Exact-number score comparisons hold up.
- Reason params and signals are closed vocabularies.
- Every UNASKED receipt carries 'likely'.
- Replay output carries ids and hashes only.
- __proto__ keys in an export are rejected or dropped, and nothing is polluted.
- check-docs refuses paths outside the repo.

Known items, from a security angle:
- The over-limit test files are confirmed: receipt.spec.ts is 462 lines and normalize.property.spec.ts is 475.
- CHANGELOG [Unreleased] has no Sprint 1 entry.
- Neither has security impact.
- The Hard Rule 2 redaction property test has a 60 s timeout. It took 4.9 s.
- no-policy-literals.spec.ts guards Hard Rule 4 and runs under the 5 s default. It took 1.8 s. Whether that counts as flaky is QA's call.

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| HR1: grep fetch(/XMLHttpRequest/sendBeacon/WebSocket in extension/src and extension/entrypoints returns only src/telemetry/send.ts | PASS | `grep -rn "fetch(\\|XMLHttpRequest\\|navigator.sendBeacon\\|WebSocket" extension/src extension/entrypoints` returns no matches. send.ts does not exist until Sprint 5. src/core imports only 'zod' and '../../../policy/default.json'. |
| HR1: network-intercept E2E ran this sprint with a one-host (or zero) allowlist | N/A | Not re-run by Security, per the machine-etiquette rule (no `pnpm e2e`). Sprint 1 changed no entrypoint, manifest or network code. The integration report says the 27 E2E tests passed, including the @mandatory network test. |
| HR1: no remote img/fonts/CDN in entrypoint HTML or CSS | N/A | No entrypoints/, HTML or CSS file is in `git diff --name-only 937c333..0067c80`. |
| HR1/HR8: no externally_connectable, webRequest or declarativeNetRequest in the manifest | PASS | wxt.config.ts is not in the range. It still declares permissions ['storage','alarms'], host_permissions [] and CSP "script-src 'self'; object-src 'none'". |
| HR2: every Observation/Claim crossing the bus went through redact.project() | N/A | No adapter or observer exists yet (Sprint 2–3). bus/messages.ts now uses the strict core schemas (Claim, Observation, HealthReport). redact.project is the only constructor of an Observation in core. |
| HR2: policy/default.json allowlist change logged in Decisions.md | PASS | The range adds rowKeyHash to allowlistedFields for gmail.sent, gmail.receipt and gcal.event. It is logged in Decisions.md lines 268 ([1.contract], Observation gains rowKeyHash), 375, 412 and 413 ([1.2], computed only from ctx.rowKey, never read from raw). |
| HR2: secret-seed test green across IndexedDB, console, export, telemetry | N/A | E2E not re-run (etiquette). The core redaction property test (1,000 examples, seeded secrets in dropped fields) was re-run and passed in 4,924 ms, with an explicit 60 s timeout (redact.property.spec.ts:59, 384). It does not seed secrets inside allowlisted fields: see SEC-3. |
| HR2: no field over the length caps (textHint ≤ 200, subjectHint ≤ 80; every string and array capped) | PASS | Checked against schema.ts SCHEMA_LIMITS: TEXT_HINT 200, SUBJECT_HINT 80, COUNTERPARTY 320, MERCHANT 120, CONVERSATION_ID 128, ID 64, ITEM 120, override.reason 120, REASONS 32, LIST 200, BATCH 500, ACCOUNTS 32, GRADING_INPUT 10,000. Reason params are closed per code (schema-checks.ts:236 REASON_PARAM_KINDS: ulid, sha256, enums and integers only). Receipt signals are closed to 9 keys (signalProblems). The caps limit length only, not content: see SEC-3. |
| HR2: exports and share use the redacted projection; replay reports and CLI output carry no content | PASS | export.ts parses every row with the strict schema; Sprint 1 only sorts record keys (reasons.params, accounts). The replay report holds ids, hashes, grades, rule ids, states and timestamps; signals and reasons are shown as SHA-256 (replay-compare.ts:80-84). Errors are reported as name:code only (replay.ts:183-186). The CLI's error path is the exception: see SEC-7. |
| HR2: no path from raw text into a Receipt | PASS | Claim has no text field, only rawHash. The receipt id comes from a hashed subject. The scope subject string only feeds a hash; the receipt keeps scopeHash. buildReceipt (receipt.ts:122-143) copies only ids, enums, numbers and hashes. |
| HR3: attest/no-act lint enabled on vendor-reading code; zero disables | PASS | `git diff 937c333..0067c80 \| grep '^+.*eslint-disable'` finds nothing. No eslint config, adapter or content-script file is in the range. |
| HR3: no .click/.submit/dispatchEvent/.value=/.focus on vendor DOM; no chrome.tabs to vendor hosts; no executeScript with string code | N/A | Sprint 1 is pure core: no DOM, no chrome.* (core tsconfig has no DOM types; grep for chrome./window./globalThis in src/core matched only comments and a local variable named window). |
| HR8: permissions subset of {storage, alarms, sidePanel, notifications, offscreen}; host_permissions exact; optional permissions in a gesture | PASS | Unchanged this sprint: wxt.config.ts:18-19 permissions ['storage','alarms'], host_permissions []. No optional permissions yet. |
| HR9: CSP strict; no eval / new Function / import(URL) | PASS | CSP unchanged (wxt.config.ts:20-21). `git diff 937c333..0067c80 \| grep '^+.*(innerHTML\|eval(\|new Function\|import()'` finds only a comment in policy.ts. Zod parses in redact.ts and policy.ts use jitless: true. |
| Input handling: page text never used as selector, message type, policy key or model instruction | PASS | Policy is build-time data (policy.ts imports the JSON). Reason codes, signal names and rule ids are closed or regex-checked. The only vendor text that reaches grading as a key is context.scope.observed, and it only feeds the receipt-id hash. |
| Input handling: optional model input from allowlisted fields | N/A | Model feature is Sprint 5; modelScore is never applicable (features.ts applies()). |
| Input handling: bus messages Zod-parsed on receive | PASS | messages.ts members are strict objects over the core schemas. listen.ts and send.ts are unchanged; they parse on both ends (Sprint 0). |
| Input handling: stored and imported data Zod-parsed on read; no prototype pollution | PASS | Repo reads use readRows with the core schemas. The replay CLI parses the export with strict schemas (attest-snapshot.ts ReplayExport). Probe E: '__proto__' at the top level or in tables is rejected ('Unrecognized key'). In receiptInputs and policies it is dropped by Zod's record parser. ({}).polluted stays null. |
| Input handling: extracted strings rendered with text nodes, never innerHTML | N/A | No UI in Sprint 1. |
| Storage: Dexie version bumped when tables change; migration tested | PASS | db.ts and migrations.ts are not in the range. The receipts index set is unchanged: [agent+date] now reads the Receipt's own agent field (index-fields.ts diff), not a separate computed one. The stored Receipt shape changed (structured reasons). The project is pre-release, and old rows fail parse and are skipped by readRows. |
| Storage: encryption (AES-GCM, PBKDF2 ≥ 600k); wipe; install id | N/A | Not touched in Sprint 1 (encryption Sprint 6; wipe and install-id unchanged). |
| HR10: src/log.ts is the only logger; no raw objects logged | PASS | src/core has no console.* and no log import (grep). log.ts is not in the range. The Node tools (attest-cli.ts, bench/core.ts, check-docs.ts) print with console because they are not part of the extension. |
| HR10: no PII or content in error strings | GAP | Every core error carries only its code (super(`grade: ${code}`), `batch:`, `redact:`, `state: code (from STATE)`, `candidates:`, `canonicalJson:`, `ratio:`, `window:`, `scope:`, `normalize:`). PolicyError JSON-quotes keys. Exceptions: reason-text.ts:260 (SEC-6) and attest-snapshot.ts:69 (SEC-7). |
| HR10/HR6: no bare catch {}; every catch handled with context | PASS | src/core/scope.ts:150 `catch { return null; }` is a fallback. buildRun returns null, then priorSpendCents re-reads the same prior and throws the same NormalizeError, so the failure stays loud. Core may not log (it is pure). The other core catches re-throw unknown errors (replay.ts:214/328, punycode.ts:148, normalize-relative.ts:315). |
| Telemetry-api: extra='forbid', rate limits, endpoints, secrets, pip-audit | N/A | telemetry-api is not touched in the range. |
| Dependencies: pnpm audit --prod run | PASS | `pnpm audit --prod` in the repo root prints 'No known vulnerabilities found'. The same command in extension/ prints the same, and so does a full `pnpm audit` in the root. |
| Dependencies: no new dependency without a Decisions.md line | PASS | The package.json diffs add scripts only (test:perf, check-docs, and lint/test chaining). No lockfile is in the range. CI moved pnpm/action-setup from v4.3.0 to v5.0.0, still pinned to a SHA (Dependabot #8, as Decisions [0.close] planned). Decisions.md line 232 still names v4.3.0: a stale record, not a new dependency. |
| Dependencies: vendor terms re-read if an adapter changed | N/A | No adapter changed. |
| HR4: src/core imports nothing impure (sprint Gate grep) | PASS | `grep -rnE 'Date\.now\|Math\.random\|crypto\.getRandomValues\|fetch\(\|performance\.now\|new Date\(\)' extension/src/core` exits 1. The non-relative imports in src/core are only zod and policy/default.json. |
| HR4: no floating point in decisions | PASS | ratio.ts Number fast paths check every running value against MAX_SAFE_INTEGER, with BigInt fallback (weightedFractionOf 228-252, compareScores 296-304). compareFractions forms no product. Policy weights are compared only as integer basis points (policy.ts bp). |
| HR4: no iteration-order dependence on Map, Set or object keys | PASS | Outputs are sorted by id. uniqueRows keeps the canonical-JSON-smallest row (receipt-hash.ts:64-73). canonicalJson sorts keys. Grant and coverage sets are sorted before hashing. The replay property test 'reports the same thing whatever the order of claims, observations and receipts' passed (5,780 ms). |
| HR4: no Intl, locale, time zone or engine-dependent data | GAP | No Intl, toLocale* or localeCompare. ISO parsing uses core's own parser; schema-checks' Date-based instantMs agreed with it on every schema-valid probe (probe2). test:tz runs two time zones. GAP: the Unicode tables are engine-dependent (SEC-1). |
| HR4: module-level memo/WeakMap caches never return a value for a different input | GAP | Claim and observation memos compare field values (features-observed.ts matches(), candidates-time.ts, conditions-coverage.ts entryInstants, receipt-hash.ts refHash), and the in-place-edit property test passed (3,078 ms). memoHash compares the full shape (hash.ts:150-187). A structurally equal but different object is a WeakMap miss, so it is recomputed. UNIFORM_WHENS caches only frozen rules. GAP: CLAIM_PLANS and CLAIM_PAIRS key policy parts by identity (SEC-2). |
| HR5/HR7: grade() cannot return VERIFIED without evidence, or UNASKED without 'likely' | GAP | UNASKED always carries attribution 'likely' (receipt.ts:139, and the schema-receipt invariant). An UNASKED outcome on a claim throws GradeError('unasked_with_claim'). Claim-less grades are forced to default_unverifiable unless UNASKED or OVER_SCOPE (grade.ts:118-121). GAP: a policy rule (SEC-4) or a caller's candidate list (SEC-5) can produce VERIFIED FINAL without matching evidence. |
| HR6: malformed input fails loud | PASS | Typed errors throw for bad ISO (NormalizeError), non-finite numbers (HashError), unsafe ranges (RatioError, WindowError, ScopeError), agent mismatch and claim-less subject (GradeError), and duplicates or missing grants (BatchError). Replay turns throws into 'error' mismatches labelled name:code. |
| Replay CLI: path handling, INIT_CWD, files outside the repo, resource exhaustion | PASS | attest-cli.ts:94-96 reads path.resolve(INIT_CWD ?? cwd, file), the one file the operator names, and writes nothing. It is a Node dev tool, not shipped. Note: readFile loads the whole file, LedgerExport tables have no max, and replay rebuilds one batch per computedAt group, so a crafted export can use lots of memory and time. It only affects the operator's own run. The terminal-output issue is SEC-7. |
| scripts/check-docs.ts: no path traversal outside the repo | PASS | resolveTarget (check-docs.ts:109-115) returns null for '..' and absolute escapes, and the result is reported as 'points outside the repository'. check-docs.spec.ts:100 covers '../../../../../../../../etc/hosts'. The script reads only docs/*.md, README.md, PRIVACY.md, package.json and policy/default.json. |
| Known items (security lens): file sizes, CHANGELOG, test timeouts, graceElapsed, features-golden, §15 fields | PASS | Confirmed: receipt.spec.ts is 462 lines and normalize.property.spec.ts is 475 (`wc -l`). CHANGELOG [Unreleased] lists only Sprint 0 items. No security impact. Hard Rule guard tests: redact.property has a 60 s timeout (it took 4.9 s). no-policy-literals.spec.ts (the Hard Rule 4 guard) uses the 5 s default and took 1.8 s while other reviewers were running; flakiness is QA's call. graceElapsed, features-golden and §15 are tech/QA items with no security impact. |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **SEC-1** [CRITICAL] Grading depends on the engine's Unicode version, so the same inputs grade differently on another Chrome or under Node replay → `extension/src/core/normalize-text.ts:231`
   - Rule: Hard Rule 4 (grade() pure and deterministic; replay reproduces every receipt forever)
   - Detail: Several readers call String.prototype.normalize('NFKC') and toLowerCase() and use \p{L}/\p{N}/\p{M}/\p{Cf} regex classes: subjectTokens (normalize-text.ts:231), name() and nameTokens (185), counterparty, amount (normalize-amount.ts:189), resolveRelative (normalize-relative.ts:132) and stop words (features-content.ts:64). Their results come from the JS engine's Unicode/ICU tables. Unicode 16.0 (September 2024) assigned new characters with compatibility decompositions. One example is OUTLINED DIGIT ZERO–NINE (U+1CCF0–U+1CCF9): category Nd, NFKC gives 0–9. On an engine whose tables predate them, they are unassigned: NFKC leaves them unchanged and they split tokens. The extension's minimum_chrome_version is 120 (December 2023), which predates Unicode 16.0. `pnpm attest replay` runs on Node 22.14, which has Unicode 16.0. So the same claim and observation can get different tokens, scores and grades depending on the engine. Replaying an export graded in an older Chrome reports grade mismatches that look like tampering, and a Chrome upgrade does the same inside the extension. Nothing records which Unicode version graded a receipt, and neither docs/grading.md nor Decisions.md names this limit.
   - Evidence: `node -p process.versions.unicode` gives 16.0 (Node v22.14.0, ICU 76.1). wxt.config.ts:17 sets minimum_chrome_version: '120'. Probe A1: subjectTokens('Invoice ' + U+1CCF1 U+1CCF0) gives ["10","invoice"]. Probe4 (scratchpad review1/security/probe4.ts): claim subject 'Q3 report 2026'; observation subject 'Q3 report ' + outlined 2026, sent 20 minutes after the claim. Under Unicode 16 it is VERIFIED, score 0.899. The same row with those digits read as unassigned (emulated with U+1CCFA, still Cn in Unicode 16) is PARTIAL, score 0.8434. The subject tokens are ["2026","q3","report"] and ["q3","report"]. The grade differs at 20 and 25 minutes after the claim. `grep -niE 'unicode version|icu' Decisions.md docs/grading.md` finds nothing.
   - Suggested fix: Pin grading to a baseline Unicode version, starting with the oldest supported Chrome's (15.0). Generate a static table in src/core of the code points assigned after the baseline. Make every text reader treat those code points as unreadable, the way bidi overrides are refused today: a subject gets no tokens; amount, relative time and name return null. Add a property test that each reader gives the same output whether those code points are read as Nd/L or as Cn. Write the baseline into docs/grading.md §10, §11 and §14 and into Decisions.md. When the baseline moves, treat it like a policy-version change, so replay never mis-reports older receipts. If the full fix is deferred, at least record the engine's Unicode version in each receipt's inputs, and have replay report an engine mismatch instead of a grade mismatch.
   - Verification: **CONFIRMED**. Reproduced on real engines, not by emulation:
     - I bundled core grading with esbuild (verify-security/browser-probe.ts) and ran it with Playwright (run-browser.cjs).
     - Chromium 123.0.6312.4 (above minimum_chrome_version '120', wxt.config.ts:17): NFKC(U+1CCF1) stays "𜳱", \p{Nd} is false, subjectTokens gives ["q3","report"]. At 20 min: PARTIAL FINAL, score 0.8434. At 25 min: PARTIAL FINAL, 0.8119.
     - Chrome for Testing 153: NFKC gives "1", tokens ["2026","q3","report"]. At 20 min: VERIFIED FINAL, 0.899. At 25 min: VERIFIED FINAL, 0.8674.
     - Node 22.14 (Unicode 16.0) matches Chrome 153.
     - Both engines produce the same receipt id 0KJ4W5G5EF77CCE15RRVCDC8CK and the same inputsHash (1f75152fe1f2… at 20 min). So replay of a Chrome-123 export under Node reports a grade mismatch on unchanged inputs.
     
     Line refs verified:
     - normalize-text.ts:231 (subjectTokens NFKC+toLowerCase) and :185
     - normalize-amount.ts:189
     - normalize-relative.ts:132
     - features-content.ts:64
     
     No Unicode baseline in docs or Decisions. Decisions.md:470 itself depends on an engine count ("Node reports 749 NFKC-stable \p{No} code points"). Hard Rule 4 says "same receipt, forever" (build_spec.md:102).

2. **SEC-2** [CRITICAL] Feature memos key policy parts by object identity, so an unfrozen policy mutated in place is scored from stale values → `extension/src/core/features.ts:167`
   - Rule: Hard Rule 4 (grade() pure and deterministic); Hard Rule 6 (fail loud on a broken precondition)
   - Detail: claimPlan() caches a claim's plan while policy.windows, policy.normalize.stopWords, policy.featuresByType[type] and policy.bp.features are the same objects (Object.is) (features.ts:166-182). CLAIM_PAIRS does the same for windows and commonDomains (features.ts:309-317). A policy edited in place keeps those identities, so grade() returns signals and scores computed under the old values, with the same policyHash. docs/grading.md §3 requires 'the loaded, frozen policy', and loadPolicy deep-freezes. But grade(), gradeOrphan(), gradeClaim(), gradeBatch(), features() and pairScorer() never check it. conditions.ts uniformWhens(), by contrast, caches only frozen rules. No production caller passes an unfrozen policy today: the type is DeepReadonly, so mutation needs a cast. Seven test files build policies by spreading DEFAULT_POLICY. The comment at features.ts:20-21, 'Every memo is used only while every input it was computed from is unchanged', is false in this case. Exploitability is latent; the severity follows the Hard Rule 1–4 rule.
   - Evidence: Probe B (scratchpad review1/security/probe.ts) uses policy = {...DEFAULT_POLICY, windows: {...DEFAULT_POLICY.windows}}. First grade: PARTIAL, timeProximity 0.1364, score 0.7601. After setting policy.windows.afterClaimMin = 10 on the same object, grade again: PARTIAL, timeProximity 0.1364, score 0.7601 (stale). A fresh object with afterClaimMin 10: timeProximity 0, score 0.7222. Object.isFrozen(DEFAULT_POLICY.windows) is true.
   - Suggested fix: Fail loud on a policy that was not loaded. In loadPolicy, add each result to a module-private WeakSet. At the top of grade(), gradeOrphan(), gradeClaim(), gradeBatch(), features() and pairScorer(), throw GradeError('policy_not_loaded') (BatchError in batch) when the policy is not in it. At minimum, refuse a policy whose parts are not frozen. Move test fixtures to loadPolicy({...doc, ...}). Add a unit test that repeats the in-place mutation above and expects the throw. Fix the features.ts header comment.
   - Verification: **CONFIRMED**. Re-ran probe B with the same result:
     - before: PARTIAL 0.7601
     - mutated in place to afterClaimMin 10: PARTIAL 0.7601 (stale)
     - fresh object: 0.7222
     
     No cast is needed. verify-security/sec2-nocast.ts does `const windows = {...DEFAULT_POLICY.windows}; const policy: Policy = {...DEFAULT_POLICY, windows}; windows.afterClaimMin = 10;`. `npx tsc -p` with the extension's strict tsconfig exits 0, and a negative control errors as expected. The mutated grade stays 0.7601.
     
     It is broader than the memo:
     - A fresh, never-mutated hand-built policy (afterClaimMin 10) scores 0.7222.
     - Its receipt carries DEFAULT_POLICY.policyHash (true) and the same inputsHash 36ffb075265f as the 45-minute grade.
     - The reason: policyHash and bp are plain fields copied by the spread (policy.ts:82-87, 146-147).
     
     So any Policy-typed object not built by loadPolicy mis-stamps receipts, and replay against the stored policy would mismatch. docs/grading.md:58 requires a loaded, frozen policy; grade() never checks it.
     
     The reviewer's line ref is right: features.ts:167 is the CLAIM_PLANS inputs list. Latent: every production policy comes from loadPolicy.

3. **SEC-3** [CRITICAL] Allowlisted text fields accept any text, including multi-line message bodies, so counterparty and merchant can carry raw content → `extension/src/core/schema.ts:182`
   - Rule: Hard Rule 2 (derived facts, never raw content); checklist: SECURITY-4 caps from Decisions [0.close]
   - Detail: These fields are plain z.string().max() with no content check: Observation.counterparty (schema.ts:182, ≤ 320), Observation.merchant (183, ≤ 120) and Claim.counterparty (148, ≤ 320). redact.project keeps an allowlisted value whenever it passes that field schema (redact.ts:126-130). So a buggy extractor or a compromised content script can store up to 320 characters of an email body, line breaks and control characters included, as a 'counterparty'. It then reaches IndexedDB, the export and the contentHash. Decisions [0.close] (SECURITY-4) says the caps exist so 'an extractor bug or a compromised content script cannot push a whole email body through counterparty'. A 320-character cap still lets a paragraph through. A counterparty is an address or a display name (§5.1), and neither ever holds a line break or a control character. The redaction property test seeds secrets only in dropped fields, so it cannot catch this. No adapter exists yet, so it is latent. The gate should exist before Sprint 2's observers write rows.
   - Evidence: Probe D (scratchpad review1/security/probe.ts): project('gmail.sent', {counterparty: 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120. Thanks', subjectHint: 'x', occurredAt: ...}, ..., DEFAULT_POLICY) returned an Observation whose counterparty is exactly that text, newline included.
   - Suggested fix: In schema.ts, reject \p{Cc}, U+2028 and U+2029 in counterparty, merchant and subjectHint, on both Claim and Observation. In redact.project, keep counterparty only when normalize.counterparty() reads it as an address, or as a name of a few tokens, and drop it otherwise. Add multi-line and control-character cases to redact-adversarial.spec.ts. Make the redaction property test also seed a secret inside an allowlisted field and assert it is dropped.
   - Verification: **CONFIRMED**. Re-ran probe D. project('gmail.sent', {counterparty: 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120. Thanks', ...}) returns that exact text as counterparty.
     
     The schema has no content check:
     - schema.ts:148 Claim.counterparty
     - schema.ts:182-183 Observation.counterparty and merchant
     These are only z.string().max().
     
     redact.ts keptValue keeps any value that passes the field schema. The redaction property test codifies this. Its header (redact.property.spec.ts:15-16) says "every allowlisted valid own value is kept exactly", and SMUGGLED (lines 175-182) seeds secrets only as invalid or non-allowlisted values.
     
     Limits on scope:
     - Latent: nothing writes observations until Sprint 2.7.
     - subjectHint carries up to 80 code points of free text by Hard Rule 2's own design, so rejecting \p{Cc}/U+2028/U+2029 and requiring an address or short name narrows the channel but does not close it.
     - The Sprint 2 secret-seed E2E stays the primary control.
     - Severity is pinned CRITICAL because it touches Hard Rule 2.

4. **SEC-4** [LOW (reviewer: MEDIUM)] loadPolicy accepts rules that conclude VERIFIED, PARTIAL or NOT_FOUND without the evidence conditions, and grade() obeys them → `extension/src/core/policy-schema.ts:237`
   - Rule: Hard Rule 5 (UNVERIFIABLE beats a guess)
   - Detail: The Rule refinement checks only that PENDING sits on the rule with id 'pending' (policy-schema.ts:237-245). policy-checks.ts adds no check on outcomes. A rule {when: {graceElapsed: true}, then: 'VERIFIED'} therefore loads, and grade() returns VERIFIED FINAL with no candidate. The same goes for NOT_FOUND without coverage 'full', which breaks Hard Rule 5's core promise. grade.ts already overrides the policy for claim-less grades ('whatever rule a policy wrote for it ... Hard Rule 5', grade.ts:113-121), so the code does not fully trust policy, but the claim path has no such guard. Policy is build-time data today. But replay loads policy documents from an export, and a future policy edit would pass with no warning.
   - Evidence: Probe C: loadPolicy(the default document with {id:'evil', when:{graceElapsed:true}, then:'VERIFIED'} as the first rule) succeeded. grade(claim, [], grant, policy, coverage, {priorSpendCents:0}) returned ["VERIFIED","evil",[],[{"code":"match.none","params":{}}],"FINAL"].
   - Suggested fix: Add cross-field checks to policy-checks.ts:
     - A rule whose then is VERIFIED must name bestScoreGte 'verified'.
     - A PARTIAL rule must name bestScoreGte.
     - A NOT_FOUND rule must name coverage 'full', graceElapsed true and bestScoreLt 'partial'.
     The shipped rules already satisfy these. Assert the same in grade() and throw GradeError as a second guard. Add one loader test per outcome.
   - Verification: **RESIZED** to LOW. The probe reproduces: the 'evil' rule {when:{graceElapsed:true}, then:'VERIFIED'} loads and grades VERIFIED FINAL with observationIds []. policy-schema.ts:237 checks only PENDING placement. But this is defense-in-depth, not a live Hard Rule 5 break:
     - Policy is build-time data (build_spec.md:132, "policy/default.json, versioned"). Nothing in build_spec lets a user edit rules.
     - Contract §6 (docs/grading.md:123) says first match wins in policy order, so the loader conforms.
     - §8's receipt invariants (docs/grading.md:201) do not require observationIds for VERIFIED.
     - The shipped policy's Hard Rule 5 behaviour is pinned by golden scenarios 04-not-found-after-grace and 05-gmail-never-synced-in-window.
     - Replay loads an export's policies only after each hashes to its key (attest-snapshot.ts loadPolicies). It uses them only to reproduce receipts graded with them, and a forger who controls the export controls those receipts anyway.
     
     The suggested loader checks are still cheap hardening.

5. **SEC-5** [LOW (reviewer: MEDIUM)] grade() trusts its caller's candidate list: a wrong-type or out-of-window observation can make a claim VERIFIED, FINAL → `extension/src/core/grade.ts:258`
   - Rule: Hard Rule 5 (UNVERIFIABLE beats a guess); Hard Rule 6 (fail loud)
   - Detail: grade() drops only candidates first seen after evaluatedAt (grade-best.ts:118-126 visibleInputs). It never checks that a candidate:
     - has the claim's type;
     - comes from a source policy.sourcesByType lists for that type;
     - has an occurredAt inside the claim window.
     gradeBatch and replay retrieve candidates correctly, so nothing exploits this today. But grade is exported and documented as the decision function, and the Sprint 3 background is its next caller. A FINAL receipt is never regraded, so one caller bug leaves a permanent false VERIFIED.
   - Evidence: Probe3 (scratchpad review1/security/probe3.ts). An email.sent claim given a gcal.event calendar.created observation with the same counterparty, subject and minute returned ["VERIFIED","verified","FINAL",1,{..."score":1}]. The same claim given a gmail.sent row from 3 days before the claim returned ["PARTIAL","partial","FINAL",1,{"timeProximity":0,..."score":0.7222}].
   - Suggested fix: In grade(), throw GradeError('foreign_candidate') for any candidate whose type differs from claim.type, whose source is not in policy.sourcesByType[claim.type], or whose occurredAt lies outside claimWindow(claim, policy). Use the same predicates as candidates.ts. Throwing rather than filtering keeps inputsHash and candidatesHash semantics unchanged. Add unit tests for both probe cases.
   - Verification: **RESIZED** to LOW. probe3 reproduces both cases:
     - a wrong-type candidate: VERIFIED FINAL, score 1
     - a candidate 3 days out of window: PARTIAL FINAL, 0.7222
     grade.ts:258 visibleInputs filters only by time.
     
     But the contract makes this a caller precondition, not a reachable path:
     - docs/grading.md:53: "gradeBatch is the only path from the background to receipts ... grade alone is used by tests and replay."
     - docs/grading.md:56: candidates = "observations for this claim after assignment."
     - Replay rebuilds candidates through the batch rebuild (replay.ts:7-13; grade call at replay.ts:311).
     - The only other core callers go through gradeClaim and gradeOrphan, with candidates retrieved by the batch (batch-grade.ts:205, batch.ts:224).
     
     The review's "the Sprint 3 background is its next caller" contradicts §3. What remains is an unchecked precondition (Hard Rule 6 hardening).

6. **SEC-6** [LOW] ReasonTextError copies an unvalidated reason code into its message → `extension/src/core/reason-text.ts:260`
   - Rule: Hard Rule 10 (never log secrets); checklist: no PII in error strings
   - Detail: reasonText() accepts unparsed reasons; its doc says 'a stored row read back, a reason from an imported ledger'. For an unknown code it throws ReasonTextError('unknown_code', reason.code), and the message becomes 'reason text unknown_code: <code>', with any text and no length cap. Every other core error carries its code only; grade-error.ts and redact.ts say 'Messages carry the code only, never a value'. When the Sprint 4 UI logs or shows this error, a corrupted or imported row's text reaches the log or the screen.
   - Evidence: Probe3: reasonText({code: 'Priya Patel <priya@company.com> door code 4417', params: {}}) threw a message equal to "reason text unknown_code: Priya Patel <priya@company.com> door code 4417".
   - Suggested fix: For an unknown code, throw ReasonTextError('unknown_code') with an empty detail, or only the code's length. Keep detail only for validated ReasonCodes, as at line 112. Extend reason-text.spec.ts:224 to assert the message does not contain the input.
   - Verification: **CONFIRMED**. reason-text.ts:260 does `throw new ReasonTextError('unknown_code', reason.code)`, and the constructor (line 87) builds `reason text ${code}: ${detail}`. ReasonLike.code is typed `string` (line 97). The doc at lines 92-94 invites unparsed input: a stored row read back, or a reason from an imported ledger. probe3 reproduces the message "reason text unknown_code: Priya Patel <priya@company.com> door code 4417". reason-text.spec.ts:224-226 only checks /unknown_code/. Stays LOW: stored and exported rows are strict-parsed, and the Reason schema closes the codes, so only a caller that skips parsing reaches this.

7. **SEC-7** [LOW] attest replay prints raw keys from the export, including terminal escape sequences → `extension/tests/tools/attest-snapshot.ts:69`
   - Rule: Hard Rule 10; checklist: no PII in error strings (replay CLI output)
   - Detail: describeIssues() joins Zod issue paths with String() and prints Zod's default messages. Zod puts an unrecognized key or an invalid record key into the path and the message verbatim. A crafted export, for example one attached to a bug report, can therefore set the terminal title, clear the screen, or print a fake 'all receipts reproduced' line on the operator's stderr. The SnapshotError doc comment (line 52) says messages 'name paths and problems, never values', but keys are values from the file. policy-errors.ts formatPath already JSON-quotes such keys; this path does not use it.
   - Evidence: Crafted export (scratchpad review1/security/esc-export.json) with the top-level key "\u001b]0;pwned\u0007\u001b[2J\u001b[31mFAKE: all receipts reproduced\u001b[0m" and the receiptInputs key "\u001b[32mkey-in-path\u001b[0m". Running `npx tsx tests/tools/attest-cli.ts replay <file> 2>&1 | od -c` shows the raw bytes '033 ] 0 ; p w n e d \a 033 [ 2 J 033 [ 3 1 m F A K E ...' and 'receiptInputs.033[32mkey-in-path033[0m: Invalid key in record'.
   - Suggested fix: Format paths with policy-errors.ts formatPath. Replace Zod's unrecognized_keys and invalid_key messages with 'unknown key' and 'invalid key', as describeIssue does, so no key text is echoed. Alternatively, escape every non-printable character before io.err. Add an attest-cli.spec.ts case with an ESC character in a key, asserting the output contains no \u001b.
   - Verification: **CONFIRMED**. `npx tsx tests/tools/attest-cli.ts replay verify-security/esc-export.json 2>&1 | od -c` prints raw bytes: `receiptInputs.033[32mkey-in-path033[0m: Invalid key in record`, then `Unrecognized key: "033]0;pwned\a033[2J033[31mFAKE: all receipts reproduced033[0m"`. The cause is attest-snapshot.ts:69, which joins issue.path with String() and uses Zod's default messages. The SnapshotError doc (line 52) promises "never values". By contrast, PolicyError JSON-escapes the same input: my policyerr.ts probe shows `["\u001b[31mX\u001b[0m"]: unknown key`, so the fix pattern already exists. Node dev tool only, so LOW.

### TESTS WRITTEN

- scratchpad/review1/security/probe.ts (scratch probe: Unicode tokens, unfrozen-policy memo, VERIFIED-rule policy, counterparty free text, __proto__ export keys; not added to the repo)
- scratchpad/review1/security/probe2.ts (scratch probe: core vs Date-based ISO parsing agreement)
- scratchpad/review1/security/probe3.ts (scratch probe: wrong-type/out-of-window candidates, ReasonTextError message)
- scratchpad/review1/security/probe4.ts (scratch probe: grade flip from Unicode-version-dependent subject tokens)
- scratchpad/review1/security/esc-export.json (scratch crafted export for the CLI escape test)

### ADVERSARIAL VERIFICATION

Adversarial check of the Sprint 1 security review. I wrote nothing in the repo and started no background jobs. Every probe is in scratchpad/review1/verify-security/. The tree now shows 4 changed or untracked test files (features-golden.spec.ts, policy-hash.spec.ts, golden/timezones.spec.ts, property/conditions-grace.property.spec.ts). Other reviewers running at the same time made them, not me.

Verdicts:
- 5 of 7 gaps confirmed: SEC-1, SEC-2, SEC-3, SEC-6, SEC-7.
- 2 resized from MEDIUM to LOW: SEC-4 and SEC-5.
- 1 new gap found (SEC-V1, CRITICAL, latent).
- 1 checklist status corrected.

- SEC-1 (CRITICAL) is now proven in a real browser, not just emulated. I ran the same core code in Chromium 123, which is above the extension's minimum Chrome 120, and in Chrome 153. Both runs used the same inputs and produced the same receipt id (0KJ4W5G5EF77CCE15RRVCDC8CK) and the same inputsHash. Chrome 123 grades the receipt PARTIAL FINAL at 0.8434. Chrome 153 grades it VERIFIED FINAL at 0.899, and so does Node 22.14. Because the inputsHash matches, replay would report a grade mismatch, not an input change.
- SEC-2 (CRITICAL) is worse than reported. Strict TypeScript allows the bug with no cast. A policy built by hand, even one never edited after creation, carries DEFAULT_POLICY's policyHash and the same inputsHash while scoring differently. The root cause is that grade() accepts any object typed Policy. The stale memo is one symptom.
- SEC-3 (CRITICAL, latent) is confirmed. The redaction property test even requires this behaviour.
- SEC-4 → LOW. The policy is fixed at build time, not user data. The contract (§6) says rules apply in policy order. Golden scenarios 04 and 05 lock the shipped policy's Hard Rule 5 behaviour. Replay checks that each export policy hashes to its own key.
- SEC-5 → LOW. Contract §3 (docs/grading.md:53) says gradeBatch is the only path from the background to receipts. grade() alone is for tests and replay, and replay rebuilds candidates itself. The review's claim that the Sprint 3 background will call grade() contradicts the contract.
- SEC-6 and SEC-7 (LOW) are confirmed.

New gap SEC-V1 (CRITICAL, latent, Hard Rule 2): the bus and ledger write schemas accept an Observation that project() would never produce. It can carry fields the source's allowlist does not name, and a contentHash that does not match its content.

Re-checked and still PASS:
- No ReDoS: every core normalizer took 35 ms or less on 20,000-character adversarial input.
- PolicyError messages never echo raw values, including terminal escape sequences.
- Zod 4.6.5 skips __proto__ keys in records (zod/v4/core/schemas.js:1039, 1092).
- In-place edits to the coverage or the grant are not served from a stale memo.
- The pinned pnpm/action-setup SHA fc06bc12… matches upstream refs/tags/v5.0.0^{} (git ls-remote).
- The scope.ts:150 catch fallback re-throws through priorSpendCents.

Gaps the verifier found that the review missed:

1. **SEC-V1** [CRITICAL] The bus and ledger write schemas accept Observations that redact.project() would never produce: wrong fields for the source and a self-chosen contentHash → `extension/src/ledger/repo.ts:147`
   - Rule: Hard Rule 2 (per-source allowlist); checklist: 'Every Observation/Claim crossing the bus went through redact.project()' and 'All bus messages Zod-parsed on receive'
   - Detail: Sprint 1 switched the bus (src/bus/messages.ts ObserverObservationsMessage) and the ledger writer (repo.ts upsertObservation) to the core Observation schema. That schema allows every content field for every source. Its only cross-field check is id = idFromHash(contentHash) (schema-checks.ts:145-150).
     
     So a buggy observer or a compromised content script can do two things that project() prevents:
     - Store fields its source's allowlist does not name. The policy allows gcal.event only [subjectHint, occurredAt, counterparty, rowKeyHash, contentHash], yet the ledger accepts merchant, amountCents and currency on a gcal.event row.
     - Choose its own identity. Any contentHash passes as long as the id derives from it. redact.ts promises "a row cannot choose its own identity", but that holds only inside project(), which runs in the sending context.
     
     The repo.ts header, rewritten this sprint (line 8), says "Strict schemas reject unknown keys, so nothing outside the allowlist reaches disk (Hard Rule 2)". That is false at the per-source level the policy defines. Replay checks contentHash later (replay-compare.ts:101 contentHashOf; Decisions.md:727), but only for observations a receipt is graded with, and long after the write.
     
     Sprint 2.7 (sprints/sprint_2.md:25) plans only "background validates (Zod), upserts". Its Done-when checks honest fixtures only, so it would inherit this gap. Latent: no handler writes bus observations yet.
   - Evidence: Probe verify-security/bus-allowlist.ts builds {source:'gcal.event', type:'calendar.created', merchant:'door code 4417 SSN 078-05-1120', amountCents:7805, currency:'USD', subjectHint:'Q3 sync', occurredAt, observedAt, contentHash: sha256Hex('anything at all'), id: idFromHash(that hash)}. Output:
     - allowlist gcal.event: ["subjectHint","occurredAt","counterparty","rowKeyHash","contentHash"]
     - ledger Observation schema (the one parseInput uses at repo.ts:147): true
     - BusMessage observer.observations: true
     - project() on the same row keeps only contentHash,id,observedAt,occurredAt,source,subjectHint,type, and its contentHash differs from the forged one (false).
   - Suggested fix: Add a pure core check, for example observationIntegrityProblems(observation, policy) in redact.ts. It should:
     - reject any content key not in policy.allowlistedFields[source]
     - recompute contentHash with the function already pinned to project() (contentHashOf / hashCanonical minus id, observedAt and contentHash)
     - reject on mismatch
     Call it in repo.ts upsertObservation, before the write, with LedgerError('invalid_input'). Make Sprint 2.7's background handler call it too, logging and dropping on failure. Fix the repo.ts:8 comment. Add a unit test with the forged gcal.event row above, expecting a rejection.

Checklist corrections:

- 'HR2: every Observation/Claim crossing the bus went through redact.project()' should be GAP (latent), not N/A. Sprint 1 rewired src/bus/messages.ts and src/ledger/repo.ts to the core Observation schema. The receiving side cannot tell a projected observation from a hand-built one: a gcal.event row with merchant, amountCents and a self-chosen contentHash parses on the bus and at the ledger write. See SEC-V1.

### COMMANDS RUN

- `git diff --name-only 937c333..0067c80; git diff --stat` → 330 files, +53,983/−998: Sprint 1 range enumerated. The working tree was clean.
- `grep -rn "fetch(\|XMLHttpRequest\|navigator.sendBeacon\|WebSocket" extension/src extension/entrypoints` → no matches: Hard Rule 1 grep is clean.
- `git diff 937c333..0067c80 -- policy/default.json package.json extension/package.json .github/workflows/ci.yml` → allowlist adds rowKeyHash; package.json changes are scripts only; pnpm/action-setup v4.3.0 → v5.0.0 (pinned to a SHA): Each change checked against Decisions.md (lines 232, 268, 375, 412, 413).
- `pnpm audit --prod (repo root); pnpm audit --prod (extension/); pnpm audit (root)` → No known vulnerabilities found (all three): Dependency audit is clean.
- `grep -rnE 'Date\.now|Math\.random|crypto\.getRandomValues|fetch\(|performance\.now|new Date\(\)' extension/src/core; list non-relative imports in src/core` → no matches; imports are zod and policy/default.json only: Sprint Gate purity check passes.
- `git diff 937c333..0067c80 | grep '^+.*eslint-disable'; ... | grep '^+.*(innerHTML|eval(|new Function|import()'` → no disables; only a comment mentions new Function: Hard Rule 3 and Hard Rule 9 surface is clean.
- `npx tsx scratchpad/review1/security/probe.ts (from extension/)` → A1 tokens ["10","invoice"]; B stale memo (0.1364 vs 0); C VERIFIED with no evidence; D counterparty kept a multi-line SSN text; E __proto__ rejected or dropped, no pollution: Evidence for SEC-1, SEC-2, SEC-3 and SEC-4; prototype-pollution check passes.
- `npx tsx scratchpad/review1/security/probe2.ts` → core instantMs and the Date-based schema instantMs agree on every schema-valid timestamp: No ISO-parsing determinism gap.
- `npx tsx scratchpad/review1/security/probe3.ts` → wrong-type candidate VERIFIED FINAL; out-of-window PARTIAL FINAL; ReasonTextError message echoes the input: Evidence for SEC-5 and SEC-6.
- `npx tsx scratchpad/review1/security/probe4.ts` → 20 min: Unicode 16 VERIFIED 0.899 vs older-engine view PARTIAL 0.8434: Evidence for SEC-1: a grade-level flip.
- `npx tsx tests/tools/attest-cli.ts replay scratchpad/review1/security/esc-export.json 2>&1 | od -c` → raw ESC/OSC sequences printed to stderr: Evidence for SEC-7.
- `node -p "process.versions.unicode"; grep minimum_chrome_version extension/wxt.config.ts` → Unicode 16.0 (Node v22.14.0, ICU 76.1); minimum_chrome_version '120': Evidence for SEC-1.
- `npx vitest run (9 targeted files: redact property, adversarial and fields; no-policy-literals; schema-limits; features-memo unit and property; attest-cli; reason-text)` → 9 files, 334 tests passed in 12.19 s: Hard Rule 2 and Hard Rule 4 guard tests are green.
- `npx vitest run (redact.property, no-policy-literals, features-memo.property, replay.property, replay-tamper.property) --reporter=verbose` → all passed; redact property 4,924 ms (60 s timeout); no-policy-literals 1,803 ms (5 s default); replay 1,000×10,000 took 86,870 ms: Timing evidence for the known-item timeout question.

