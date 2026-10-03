# Sprint 1 — Tech

Role: agents/tech_reviewer.md. Range reviewed: `937c333..0067c80` (Sprint 0 close to the last Sprint 1 task). Each review was checked by an independent adversarial verifier that re-ran the evidence and tried to refute every gap; verdicts are inline (CONFIRMED, RESIZED with the new severity, or REFUTED).

## Part 1: extension/src/core and the contract

Technical review, part 1 of 2: extension/src/core and its contract, Sprint 1 (937c333..0067c80). I wrote nothing in the tree. All probes ran in the foreground from my scratch directory (scratchpad/review1/tech-core/), and no background jobs are left running.

Overall, src/core is in very good shape. It lints clean and has no import cycles. All 61 files are within 400 lines (the largest, schema.ts, is exactly 400), and all 775 functions are within 60 lines (the longest, grade.ts judge, is 58). It has no any, no `as unknown as` and no `!`. Every non-0/1 numeric literal is either in an exempt file or caught by the no-policy-literals test. Scoring is exact. Every module-level memo re-checks every input it was computed from. Most of the contract matches the code line by line: §3 gradeBatch, §4.3 assignment and ties, §5.3 exact scoring, §6.1 coverage and caps, §7 attribution and finality anchors, §8 state events, §9 compared fields, §10 hashes, and §15 reason order. The known item about the exported graceElapsed wrapper is VERIFIED CLEAN: the wrapper and the condition compute the same thing.

Two CRITICAL gaps, both on Hard Rule 4:
- TECH-C1: replay disagrees with gradeBatch about what an orphan is. replay-batch.ts:89 also requires the observation's own source to be listed for its type. That contradicts §3 and Decisions [1.v14-core]. A probe confirmed it: gradeBatch issues an UNASKED FINAL receipt, a case batch-orphans.spec.ts:114 already expects, and replay then reports that receipt as an `orphan: uncovered` mismatch. The tests miss it because attest-world always derives the source from the type.
- TECH-C2 (latent: nothing imports it today): the src/core purity fence is a denylist. A probe showed `import { nowIso } from '../clock'` passes both lint and the core tsc build, and so do WeakRef and FinalizationRegistry.

MEDIUM:
- TECH-C3: a spend claim with no currency is never checked against the cumulative ceiling. Two $30 claims against a $50 USD ceiling make the second OVER_SCOPE with USD, but not without a currency (probe output). The §6.1 text contradicts itself here.
- TECH-C4: five §4.1/§10 rules each have two or three implementations; C1 is one that already diverged.

LOW:
- TECH-C5: dead or duplicate exports.
- TECH-C6: batch-scoped caches keyed by only part of their input.
- TECH-C7: three untyped RangeErrors.
- TECH-C8: no lint gate for file size, function size or `as unknown as`. This is how receipt.spec.ts (462 lines) and normalize.property.spec.ts (475 lines) slipped through.
- TECH-C9: grading.md signatures and wording drifted from the code.
- TECH-C10: §15 omits the golden fields added in v1.4.
- TECH-C11: the §10 rawHash formula exists only in test code.
- TECH-C12: CHANGELOG.md has no Sprint 1 entry.
- TECH-C13: gradeBatch silently drops the cumulative check when activity.claims omits the claims being graded (probe output).

Left to part 2 (tests): the fragility of features-golden.spec.ts and the Vitest timeouts.

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| Architecture: src/core imports nothing from chrome, DOM, Dexie or src/adapters, enforced by an ESLint no-restricted-imports rule | PASS | eslint.config.js:129-167 CORE_RESTRICTED_IMPORTS (no-restricted-imports bans dexie, preact, ulidx, wxt, wxt/*, webextension-polyfill, node:*, crypto, the regex (^\|/)(adapters\|observers\|ledger\|bus\|ui\|telemetry\|crypto\|intel\|background\|entrypoints)(/\|$) at :158, and log). :229-258 CORE_RESTRICTED_GLOBAL_NAMES (no-restricted-globals plus no-restricted-properties on window/globalThis/self: chrome, browser, window, document, navigator, fetch, crypto, Intl, setTimeout, performance, console, …). Both are applied at :435-445 with attest/core-determinism; noInlineConfig is set by the APP block. DOM globals are also blocked by src/core/tsconfig.json lib [ES2023]: my tsc probe gave 'Cannot find name DOMParser / BroadcastChannel'. tests/unit/lint/fences.spec.ts:56-99 proves the fences. src/core imports only './*', 'zod' and policy/default.json (grep). `npx eslint src/core --max-warnings=0` is clean. |
| Architecture: src/core cannot reach a wall clock or a GC-dependent primitive through any import or global (Hard Rule 4) | GAP | TECH-C2: a fence probe through the real config showed `import { nowIso } from '../clock'`, '../setup', '../config', '../log-vocabulary', `new WeakRef({}).deref()` and `new FinalizationRegistry()` produce no lint error in src/core/probe.ts, and the clock import also passes tsc with the core tsconfig. |
| Architecture: entrypoints thin; adapters pure; bus messages typed | N/A | No entrypoint or adapter code this sprint (out of scope until Sprint 2-3). The bus and ledger edits (messages.ts, repo.ts, types.ts, export.ts) belong to part 2. |
| Policy values read from policy/default.json; no thresholds, windows or weights hardcoded | PASS | tests/unit/core/no-policy-literals.spec.ts allows only 0 and 1 in src/core outside 5 named exemptions (sha256, base32, punycode, units, schema) and only policy/default.json as a JSON import. Grep finds no host, URL or agent literal outside the schema.ts:96 AgentId enum. replay.ts:131 BUCKET_MINUTES = 1 is index tuning (Decisions [1.3]), not policy. |
| No any outside tests; no `as unknown as`; no unexplained `!` | PASS | grep finds 0 of each in src. any: @typescript-eslint/no-explicit-any at eslint.config.js:351. !: @typescript-eslint/no-non-null-assertion at :352. The only cast is policy.ts:105 (`as Record<…>` over Object.fromEntries). `as unknown as` has no lint rule (TECH-C8). |
| No hardcoded hosts, ids or URLs | PASS | grep for http(s)://, '.com' and agent literals in src/core finds only the schema.ts:96 enum. |
| No TODO/FIXME without a linked task | PASS | grep for TODO, FIXME, XXX, eslint-disable, @ts-ignore and @ts-expect-error in src/core: 0 hits. |
| Errors are typed, carry context, never swallowed | GAP | 16 typed classes with codes: BatchError, CandidatesError, GradeError, HashError, IdError, IllegalTransitionError, NormalizeError, PolicyError, PunycodeError, RatioError, ReasonTextError, RedactError, ScopeError, WindowError, AttributionError, plus PolicyError issues. All 5 catch sites rethrow or fall back to a function that rethrows (scope.ts:150 falls back to priorSpendCents). Three untyped RangeErrors remain (TECH-C7). |
| Functions ≤ 60 lines, files ≤ 400 lines (measured by script) | PASS | A TypeScript-AST script (scratch fnlen.mjs) measured 775 functions in src/core: 0 over 60. The longest is grade.ts:185 judge at 58, then sha256.ts:57 rounds at 41 and batch.ts:273 gradeBatch at 39. `wc -l` on 61 files: the largest are schema.ts 400, sha256.ts 397, replay.ts 388, ratio.ts 386, attribution.ts 385. Outside core (part 2): tests/unit/core/receipt.spec.ts is 462 lines and tests/property/normalize.property.spec.ts is 475; nothing gates either (TECH-C8). |
| Complexity hot spots (beyond the checklist) | PASS | Ad-hoc `eslint --rule complexity:12`: sha256.ts:57 rounds 27 (FIPS rounds), conditions.ts:273 ruleMatches 25 (a flat && chain, one clause per condition), conditions-scope.ts:123 amountAboveCeiling 20, normalize-time.ts:246 fastInstantMs 19 (pinned to the general path by normalize-time.property.spec.ts:154), features-parts.ts:70 valueInto 18. All are flat or algorithmic, so I filed no gap. |
| Naming: camelCase, PascalCase types and classes, kebab-case files, UPPER_SNAKE constants | PASS | All 61 core files are kebab-case. Classes (CandidateTable, BatchEvidence, Score, Timeline, ReplayBatch, RowScorer) are PascalCase. Module constants are UPPER_SNAKE (CLAIM_KEYS, VISIBLE_COVERAGE, REASON_CODES, …). |
| Determinism: no Date.now, Math.random, crypto.getRandomValues or model call in src/core (grep plus lint rule) | PASS | CORE_RESTRICTED_SYNTAX at eslint.config.js:282-305 (Date.now, new Date(), Date(), Math.random, getRandomValues, randomUUID, dynamic import). attest/core-determinism (eslint-rules/core-determinism.js) bans local-time and locale methods and Date/Math aliasing. Grep finds 0. The probe confirmed localeCompare → attest/core-determinism and Intl → no-restricted-globals. Gap: TECH-C2. |
| Module-level caches keyed by the full input | PASS | Every module-level WeakMap re-checks all of its inputs: candidates-time.ts:19-28 (text), conditions-coverage.ts:105-127 (3 texts), scope.ts:66-74 (text), window.ts:130-142 (claimedAt, precision, end), features.ts:160-180 CLAIM_PLANS (13 inputs, covering every field computeFacts reads), features.ts:305-317 CLAIM_PAIRS (plan, windows, commonDomains: all fillParts reads), features-observed.ts:160/117-127 (7 fields plus stopWords), features-content.ts:55-66 (contents), conditions.ts:314-324 (only when frozen), grade-best.ts:63-87 (evaluatedAt, observers, entries, lastSyncAt), receipt-hash.ts:146-224 (full shape / 3 fields). Batch-scoped caches keyed by only part of their input: TECH-C6. |
| Ids derived from content or input hashes; ULIDs only for new events | PASS | receipt.ts:53-55 receiptId comes from the subject. redact.ts:174-176 sets id = idFromHash(contentHash). schema-checks.ts:141 enforces Claim.id = idFromHash(rawHash). ulidx is banned in core (eslint.config.js:134). base32.ts:44-64 writes 2 zero bits plus 128 bits as 26 Crockford characters. The §10 rawHash formula has no core implementation (TECH-C11). |
| Timestamps ISO 8601 with offset; money integer cents plus currency | PASS | The IsoTs schema and normalize-time.ts:286-299 instantMs throw on offset-less text. AmountCents is int, 0 to 1e12. Currency is /^[A-Z]{3}$/. Amounts are summed in BigInt (conditions-scope.ts:167, scope.ts:118-120). |
| No import cycles in src/core (§13: dependencies point downward) | PASS | A DFS over the './x' imports of all 61 core files printed 'no import cycles'. |
| Dexie indexes; paginated reads; debounced observers; onStartup; bundle size | N/A | Sprint 2+ and UI work; there is no such code in src/core. |
| Contract §3 gradeBatch (signature, outputs, grant in force, late inputs, output order) | PASS | batch.ts:273-311 matches §3 and §13: 7 parameters, Promise<{receipt, inputs}[]>, claims with observedAt > evaluatedAt dropped (:129-133), grantsInForce latest updatedAt ≤ evaluatedAt with ambiguous/missing throws (batch-grants.ts:20-40), duplicate_claim and claim_fixed checks (:136-151), output sorted by id with duplicate_receipt (:255-261). |
| Contract §3 orphans: batch and replay agree | GAP | TECH-C1: batch-orphans.ts:121-134 follows §3 literally; replay-batch.ts:89 adds `sourcesByType[type].includes(source)`. Probe: batch [UNASKED, unasked, FINAL]; replay mismatches [{field: 'orphan', replayed: 'uncovered'}]. |
| Contract §4.3 assignment and ties | PASS | candidates-assign.ts:44-51 orders pairs by score descending (exact compareRatio), then claimedAt ms, then claim id, then observation id. Fixed pairs come first and are checked one-to-one (:54-67). Taken observations are never assigned (:94). exclusiveCandidates (:106-117) equals CandidateTable.visibleTo (batch-table.ts:123-133). The best-candidate tie goes to the lower id in both grade (grade-best.ts:129-136) and batch (batch-grade.ts:154-167). |
| Contract §5.3 exact scoring | PASS | ratio.ts:228-257 weightedFractionOf checks every running value ≤ 2^53−1 (all terms are non-negative, so overflow is always detected). compareFractions (:322-343) forms no products. BigInt fallback (:136-153, :268-276). Thresholds are compared via ratioGteBasisPoints and fractionGteBasisPoints. Display values come only from toDisplay and toDisplayOf and are never compared. |
| Contract §6.1 coverage, eligibility and caps | PASS | conditions-coverage.ts:135-146 entryCaps (calendars_hidden, multiple_accounts and no_account only when unbound; bound and absent → ineligible; no_parser only on gmail.receipt), :149-169 account count over visible entries, :210-239 per-source level then combined, :199-208 closed-interval union. Matches §6.1 rows 131-133 and the account paragraph at :146. |
| Contract §6.1 spend ceilings | GAP | TECH-C3 and TECH-C9: grading.md:137 says 'Same guard as amountAboveCeiling' but adds currency = spendCurrency; conditions-scope.ts:166 follows the parenthetical (Decisions 526). Probe: with USD the second $30 claim is OVER_SCOPE over_ceiling_cumulative; with no currency it is UNVERIFIABLE no_coverage. |
| Contract §7 attribution and UNASKED finality anchor | PASS | attribution.ts:331-334 anchors on observedAt for calendar.* and occurredAt otherwise; conditions-finality.ts:86 uses the same anchor. Ties go to higher score, then more signals, then lower agent id (:305-312). userIdle needs one covering interval, cut at evaluatedAt (attribution-index.ts:85-88). Adjacency is suppressed only by assignable claims (:188-208). |
| Contract §8 finality table and state events | PASS | conditions-finality.ts:94-121 matches every §8 row (VERIFIED on end + grace; PARTIAL/NOT_FOUND on graceElapsed; OVER_SCOPE immediate unless candidate-dependent; claim-intrinsic or source-less immediate; others by finalizeUnverifiableHours). grade.ts:160-182 recomputes the no-candidate case as Decisions 662 says. state.ts:109-129 refusal codes match §8 (regrade_superseded, subject_mismatch, regrade_stale, regrade_not_unasked, invalid_event). |
| Contract §9 replay compared fields | PASS | replay-compare.ts:27-44 COMPARED_FIELDS is exactly the §9 list. computedPart compares an overridden receipt on previousState and drops the lifecycle reasons (:58-77). contentHash is checked for each graded observation (replay.ts:291-304). |
| Contract §10 ids and hashes | PASS | receipt-hash.ts:261-265 inputsHash = canonical {claim, candidatesHash, grantHash, policyHash, coverageHash, context} with attribution.signals sorted. candidatesHash is Merkle-style over refHash in id order (:231-245, batch-table.ts:102-117). Set-like arrays are sorted and de-duplicated (:106-144). hash.ts:86-102 canonicalJson (-0 → 0, NaN throws). The contentHash formula is implemented twice (TECH-C4). |
| Contract §15 reason codes and emission order | PASS | schema-checks.ts:181-211 REASON_CODES is in §15 table order. receipt.ts:93-99 orders by group: rule, allowlist, coverage, match. grade-reasons.ts: allowlist.unchecked only when not applicable and not OVER_SCOPE (:182-185); cap codes only when the rule names coverage: partial (:156); account_unbound only on NOT_FOUND (:161); never_completed replaces grace.waiting (:135); match.* only on claim receipts (:170-178). |
| Known item: exported graceElapsed wrapper drifted from the condition | PASS | VERIFIED CLEAN. conditions-coverage.ts:302-309 computes everySourceSynced(eligibleCoverage(claim, grant, coverage, policy), graceSyncMs(claim, policy)). The condition at conditions.ts:237-241 plus graceValue at :262-264 computes syncedSources(eligibleCoverage(…visibleCoverage…), graceSyncMs).every(elapsed). sourceEntries (:156-158) filters syncMs ≤ evaluatedMs itself, so raw and visible coverage give identical entries, account counts included. The same holds for coverageLevel (:256-263). Both wrappers are §13 exports used only by tests. |
| Known item: docs/grading.md §15 documents every golden field added in v1.4 | GAP | TECH-C10: grep in grading.md finds assertIds 0, attributionScore 0, '"inputs"' 0, input.grade 0. These fields are documented only in tests/golden/README.md, which §15 never references. |
| Known items: test files over 400 lines, Vitest timeouts, features-golden.spec.ts fragility | N/A | These are part 2 and QA scope. I confirmed the sizes: tests/unit/core/receipt.spec.ts is 462 lines and tests/property/normalize.property.spec.ts is 475 (wc -l). The missing gate behind them is TECH-C8. |
| Duplicate implementations pinned together by tests | GAP | Pinned: spendIndex ≡ priorSpendCents (tests/property/scope.property.spec.ts), fast ≡ general instantMs (normalize-time.property.spec.ts:154), batch evidence ≡ grade (batch-tables.spec.ts plus the perf gate). Not pinned: coveredOrphan ≢ coveredObservations (TECH-C1), the contentHash pair and the 3x representative/order rules (TECH-C4), and SIGNAL_REASON/attributionReasons vs SIGNAL_CODES (TECH-C5). |
| Decisions.md has an entry for every unspecified choice | PASS | Entries tagged [1.contract], [1.batch] 575, [1.v14-core] 656-662, [1.9] 728, [1.5] 513-526 and [1.7] 557 cover the choices reviewed here. Decision 661 (orphans 'whatever sources the policy lists') is contradicted by replay-batch.ts:89 (TECH-C1). |
| CHANGELOG updated under Unreleased | GAP | TECH-C12: `git log --oneline 937c333..0067c80 -- CHANGELOG.md` is empty, and [Unreleased] at CHANGELOG.md:5 lists only Sprint 0 work. |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **TECH-C1** [CRITICAL] Replay rejects UNASKED receipts that gradeBatch issues for an observation whose source is not listed for its type → `extension/src/core/replay-batch.ts:89`
   - Rule: Hard Rule 4 (replay must reproduce every receipt); contract §3 orphans; Decisions [1.v14-core] 2026-10-02 entry 661
   - Detail: Two implementations of the §3 orphan rule have diverged. gradeBatch uses batch-orphans.ts:121-134/165-178: an orphan is any observation of a type with sources, inside a window of its own source, 'whatever sources the policy lists for its type' (Decisions 661, and the test batch-orphans.spec.ts:114 expects UNASKED in that case). Replay's coveredOrphan (replay-batch.ts:88-93) adds `if (!policy.sourcesByType[observation.type].includes(observation.source)) return false;` and its comment reads 'one of them its own'. A receipt that gradeBatch produces and stores therefore can never be reproduced: replay reports field 'orphan', replayed 'uncovered'. The code is wrong on the replay side; §3 and the batch agree. The replay property test never exercises this because tests/tools/attest-world.ts:127 always derives the source from the type (sourceOf(fields.type)). Reachability: Schema.Observation does not tie type to source, and the batch already has a test that produces such a receipt.
   - Evidence: Probe scratch/review1/tech-core/probe/orphan-source.probe.mts: an observation from gmail.sent typed purchase.made, gmail.sent coverage, muse session plus idle. Output: `batch receipts: [ [ 'UNASKED', 'unasked', 'FINAL' ] ]` then `replay: {"receipts":1,"reproduced":0,"mismatches":[{"receiptId":"7QCZZ6327KESVDW3169NV130PR","field":"orphan","stored":"5ZSREDV1DV7MTDWM0VN2ZC2PFJ","replayed":"uncovered"}]}`. `npx vitest run tests/unit/core/replay.spec.ts tests/unit/core/replay-compare.spec.ts tests/unit/core/batch-orphans.spec.ts` gives 35 passed, so the gap is untested.
   - Suggested fix: Make one predicate the only definition. Export from batch-orphans.ts `isOrphanCandidate(observation, windows: ReadonlyMap<ObservationSource, readonly Interval[]>, policy, atMs)` that returns `policy.sourcesByType[observation.type].length > 0 && inWindows(windows.get(observation.source) ?? [], atMs)`. Use it in keepSeen and in replay-batch.ts coveredOrphan, and delete the `.includes(observation.source)` line and the 'one of them its own' wording. Add a replay test that replays the exact ledger of batch-orphans.spec.ts:114 (gcal.event row typed email.sent) and expects 0 mismatches. Let attest-world emit a small share of rows whose source is not listed for their type so the 1,000 × 10,000 replay property covers it.
   - Verification: **CONFIRMED**. Reproduced. I copied the probe to verify-tech-core/orphan-source.probe.mts and ran `npx tsx` from extension/. Output: `batch receipts: [ [ 'UNASKED', 'unasked', 'FINAL' ] ]` then `replay: {"receipts":1,"reproduced":0,"mismatches":[{..."field":"orphan",..."replayed":"uncovered"}]}`. replay-batch.ts:89 reads `if (!policy.sourcesByType[observation.type].includes(observation.source)) return false;`. batch-orphans.ts keepSeen (:126-138) checks only the observation's own source window, as do §3 (grading.md:53), Decisions.md:661 and batch-orphans.spec.ts:114-124. The only caller is replay.ts:270 (orphanCall). tests/tools/attest-world.ts:127 sets `source: sourceOf(fields.type)`, so the replay property test never reaches this case. The three suites pass (35/35). build_spec.md:102 (Hard Rule 4) says 'Replaying the ledger must reproduce every receipt exactly', so CRITICAL is right.

2. **TECH-C2** [CRITICAL] The src/core purity fence is a denylist: '../clock', '../setup', '../config', WeakRef and FinalizationRegistry pass lint and the core tsc build → `extension/eslint.config.js:129`
   - Rule: Hard Rule 4 (src/core: no clock, deterministic); tech checklist 'src/core imports … verified by an ESLint no-restricted-imports rule'
   - Detail: CORE_RESTRICTED_IMPORTS (eslint.config.js:129-167) lists the impure layers by name (regex at :158: adapters|observers|ledger|bus|ui|telemetry|crypto|intel|background|entrypoints, plus log). It does not cover src/clock.ts, which reads the wall clock (`nowIso()` → `new Date()`, `getTimezoneOffset`), nor src/setup.ts, src/config.ts or src/log-vocabulary.ts. A core file can therefore read the clock one import away, and src/core/tsconfig.json (lib ES2023) does not stop it either, because clock.ts uses only ES APIs. CORE_RESTRICTED_GLOBAL_NAMES (:229-258) also omits WeakRef and FinalizationRegistry, whose results depend on garbage collection. Latent: today src/core imports only './*', 'zod' and policy/default.json (grep), so no receipt is affected yet.
   - Evidence: Fence probe (scratch/review1/tech-core/probe/fence.probe.mjs, ESLint API with the real config and the same overrides as tests/unit/lint/fences.spec.ts) on src/core/probe.ts: `"import { nowIso } from '../clock';" => (none)`, `'../setup' => (none)`, `'../config' => (none)`, `'../log-vocabulary' => (none)`, `"export const t = new WeakRef({}).deref();" => (none)`, `"new FinalizationRegistry(() => 1)" => (none)`; control: `'../ledger/db' => no-restricted-imports`. `npx tsc -p probe/tsc/tsconfig.json` (extends src/core/tsconfig.json) reports only DOMParser and BroadcastChannel and accepts the clock import.
   - Suggested fix: Replace the denylist with an allowlist for src/core: a no-restricted-imports pattern `{ regex: '^(?!\\./[a-z0-9-]+$|zod$|\\.\\./\\.\\./\\.\\./policy/default\\.json$)', message: 'src/core imports only ./core modules, zod and policy/default.json (Hard Rule 4).' }`. Keep the named bans for clearer messages. Add 'WeakRef' and 'FinalizationRegistry' to CORE_RESTRICTED_GLOBAL_NAMES. Add fences.spec.ts cases for '../clock', '../config' and WeakRef.
   - Verification: **CONFIRMED**. Reproduced with verify-tech-core/fence.mjs, which uses the ESLint API with the real eslint.config.js on src/core/zz-probe.ts. `import { nowIso } from '../clock'` → (none). '../config' → (none). '../setup' → (none). `new WeakRef({}).deref()` → (none). `new FinalizationRegistry(...)` → (none). Controls: '../ledger/db' and '../log' → no-restricted-imports; `Date.now()` → no-restricted-syntax plus attest/core-determinism. src/clock.ts:21-23 `nowIso()` calls `new Date()`. src/core/tsconfig.json has no rootDir and lib ES2023, so tsc accepts the import too. Tests do not cover it either: no-policy-literals.spec.ts:202-209 checks only JSON imports. The reviewer's full probe adds that `new Date('…').toString()` and `String(new Date(…))` also pass lint in core. That is a known limit, logged in Decisions.md:227 [0.close], with a CI time-zone run as the fallback (ci.yml:50 test:tz). Its reason, 'cannot be told apart without types', no longer fits: eslint.config.js:327-335 already runs strictTypeChecked with projectService. All of this is latent: grep shows src/core imports only './*', 'zod' and policy/default.json. eslint.config.js is Sprint 0 code, but the Sprint 1 gate ('src/core imports nothing impure (lint + grep test)') depends on it, and it guards Hard Rule 4, so it stays CRITICAL.

3. **TECH-C3** [LOW (reviewer: MEDIUM)] A spend claim with no currency counts toward the per-claim ceiling but never toward the cumulative ceiling → `extension/src/core/conditions-scope.ts:166`
   - Rule: Contract §6.1 amountAboveCeiling / cumulativeAboveCeiling consistency; §6.3
   - Detail: amountAboveCeiling counts a claim amount whose currency is absent as spendCurrency (conditions-scope.ts:132-133, §6.1 row at grading.md:136). cumulativeAboveCeiling returns not-applicable unless claim.currency === spendCurrency (:166). grading.md:137 calls this 'Same guard as amountAboveCeiling' but then adds 'currency = spendCurrency', so the contract contradicts itself. The code follows the parenthetical, as logged in Decisions 526 ('read literally'). As a result, any number of currency-less purchases stays under the cumulative ceiling, while the same purchases in USD do not. priorSpendCents still computes and hashes a sum for such claims (scope.ts:111, counting only earlier currency-less claims) that no condition ever reads. Neither side is wrong against the other: the contract text needs one definition.
   - Evidence: Probe scratch/review1/tech-core/probe/cumulative.probe.mts: grant ceiling 5000 USD, two $30 purchase.made claims, both in activity.claims. Output: `currency=USD: second $30 claim -> OVER_SCOPE over_ceiling_cumulative priorSpendCents 3000` and `currency=undefined: second $30 claim -> UNVERIFIABLE no_coverage priorSpendCents 3000`.
   - Suggested fix: Contract v1.6: define 'counted in spendCurrency' once (the currency is absent or equals spendCurrency) and use it for the Amount, for cumulativeAboveCeiling's guard and for priorSpendCents, which then sums priors counted in spendCurrency and needs the grant's spendCurrency. Rewrite grading.md:137 without 'Same guard as'. Change conditions-scope.ts:166 and scope.ts:111 to match, and add a golden scenario with two currency-less $30 claims against a $50 ceiling. If the literal reading is kept instead, list the evasion in docs/attacks-that-work.md and fix the 'Same guard' wording.
   - Verification: **RESIZED** to LOW. The behaviour reproduces. verify-tech-core/cumulative.probe.mts gives `currency=USD: … OVER_SCOPE over_ceiling_cumulative priorSpendCents 3000` and `currency=undefined: … UNVERIFIABLE no_coverage priorSpendCents 3000`. The contract also contradicts itself. grading.md:137 says 'Same guard as amountAboveCeiling', yet amountAboveCeiling's guard (:136) accepts an amount in any currency. §6.3 (:161) defines a currency-less sum ('a claim without a currency counts only earlier claims without one'), and §6.1 then never reads it. The risk is overstated, though. The core normaliser never produces an amount without a currency: `Money.currency` is required (normalize-amount.ts:21-25). verify-tech-core/amount.mts gives `"$30" => null`, `"US$30" => {minor:3000,currency:'USD'}` and `"30" => null`. Only a hand-built Claim can reach the currency-less branch today. Adapters arrive in Sprint 3. The code follows the parenthetical as logged in Decisions.md:526, and no Hard Rule is broken (the output is UNVERIFIABLE, not VERIFIED). What remains is a contract-wording defect plus a dead §6.3 branch: LOW. Fix the wording in grading.md:137 and :161, and when Sprint 3.2 lands, decide whether a claim amount may ever lack a currency.

4. **TECH-C4** [LOW (reviewer: MEDIUM)] Five §4.1/§10 rules are implemented two or three times; one pair (TECH-C1) already diverged → `extension/src/core/replay-compare.ts:101`
   - Rule: Tech review: duplicated logic between the batch and grade/replay paths that could diverge (Hard Rule 4)
   - Detail: (1) The §10 contentHash is computed by redact.ts:168-174 (`{source, type, ...content, rowKeyHash?}`) and recomputed by replay-compare.ts:101-103 (everything but id, observedAt and contentHash). The two agree only because the Observation schema holds exactly those fields today. Adding any field to Observation makes every replay report contentHash mismatches, or lets an edit to the new field go unnoticed. (2) The §4.1 representative of a contentHash is written three times: candidates.ts:54-60 preferA, batch-retrieve.ts:62-68 prefer, batch-orphans.ts:81-87 preferred. (3) The candidate order is written three times: candidates.ts:86-92, batch-retrieve.ts:71-77, batch-orphans.ts:96-102. (4) The calendar.created first-seen bound is written twice: candidates.ts:76-79 and batch-retrieve.ts:174-181. (5) Interval merging is written twice: batch-retrieve.ts:84-96 and batch-orphans.ts:50-64. compareText is defined 9 times. Only the batch retrieval is pinned to candidates(), indirectly through the replay property test; the orphan copies and the contentHash pair are pinned by nothing.
   - Evidence: `grep -n "^function compareText\|function prefer\|function preferred\|function preferA\|function mergedIntervals\|function mergeIntervals\|calendar.created'" src/core/*.ts` lists the copies above. `grep -rln contentHashOf tests` shows only replay-compare.spec.ts, which never checks it against project().
   - Suggested fix: Create one internal module (for example core/order.ts) exporting compareText, compareNumbers, representative(a, b), compareCandidates, mergeIntervals and firstSeenFromMs, and import it from candidates.ts, batch-retrieve.ts and batch-orphans.ts. In redact.ts export `hashedContent(observation)` (the exact object project hashes) and use it in contentHashOf. Add a property test that contentHashOf(project(...)) === project(...).contentHash for random rows of every source.
   - Verification: **RESIZED** to LOW. Items 2-5 are real. preferA (candidates.ts:54), prefer (batch-retrieve.ts:62) and preferred (batch-orphans.ts:81) are identical. compareSightings, compareGroups and compareKeyed are identical. The calendar.created first-seen bound appears at candidates.ts:76-79 and batch-retrieve.ts:174-181. mergeIntervals (batch-orphans.ts:50) and mergedIntervals (batch-retrieve.ts:84) duplicate each other. compareText is defined in 9 files (grep -c). Item 1's evidence is wrong. The review says the contentHash pair is 'pinned by nothing' and that replay-compare.spec.ts 'never checks it against project()'. In fact replay-compare.spec.ts:25-58 ('contentHashOf is the §10 content hash project() computes') asserts `contentHashOf(observation) === observation.contentHash` for project() rows of gmail.sent, gmail.receipt and gcal.event, with and without rowKey. That test would fail if Observation gained a field project() does not hash. The batch retrieval is also pinned to candidates() by the 1,000 × 10,000 replay property. The one copy that diverged is already filed as TECH-C1. The rest are identical today, so this is a maintainability finding: LOW.

5. **TECH-C5** [LOW] Dead exports, including a second UNASKED-reason implementation that the tests pin instead of the real one → `extension/src/core/attribution.ts:380`
   - Rule: Tech review: dead code; duplicated logic
   - Detail: attribution.ts:113 SIGNAL_REASON and :380 attributionReasons are used nowhere in src. Receipts are built from grade-reasons.ts:48 SIGNAL_CODES and :96-100, a separate copy of the same map and logic, while tests/unit/core/attribution.spec.ts:280-297 tests the unused copy. Also dead (no reference in src or tests besides the definition): features-content.ts:158 merchantMatchOf, whose comment claims 'a property test pins this to merchantMatchName' although no test references it; ratio.ts:307 scoreGteBasisPoints; units.ts:12 CENTS_PER_UNIT.
   - Evidence: Per-export reference scan (grep -rlw over src and entrypoints, excluding the defining file): attribution.ts SIGNAL_REASON (tests:0), attributionReasons (tests:1), features-content.ts merchantMatchOf (1 occurrence in its own file, tests:0), ratio.ts scoreGteBasisPoints (1 occurrence, tests:0), units.ts CENTS_PER_UNIT (1 occurrence, tests:0).
   - Suggested fix: Delete SIGNAL_REASON and attributionReasons, or make grade-reasons.ts import SIGNAL_REASON and build the UNASKED reasons with attributionReasons so there is one copy, then point attribution.spec.ts at it. Delete merchantMatchOf, scoreGteBasisPoints and CENTS_PER_UNIT, or add the property test the merchantMatchOf comment promises.
   - Verification: **CONFIRMED**. `grep -rnw` over extension/src, entrypoints, tests, scripts and bench: SIGNAL_REASON is used only at attribution.ts:113/382. attributionReasons is defined at attribution.ts:380 and used only by tests/unit/core/attribution.spec.ts:280-297. Receipts use the separate SIGNAL_CODES map (grade-reasons.ts:48, :98). merchantMatchOf (features-content.ts:158), scoreGteBasisPoints (ratio.ts:307) and CENTS_PER_UNIT (units.ts:12) each appear only at their definition. The comment at features-content.ts:156 says 'a property test pins this to merchantMatchName', but no test names either function. My own scan of every src/core export found no other fully dead value exports. The other unreferenced names are types, or are used inside their own file.

6. **TECH-C7** [LOW] Three untyped RangeErrors in core → `extension/src/core/batch-table.ts:137`
   - Rule: Tech checklist: errors are typed and carry context
   - Detail: batch-table.ts:137 (`candidate table: no such row`) and sha256.ts:162 and :176 (`sha256: write after hex()`) throw plain RangeError with no code. Every other core error is a typed class with a code. Replay's errorLabel (replay.ts:183-186) would report these only as 'RangeError'.
   - Evidence: `grep -n RangeError src/core/*.ts` → batch-table.ts:137, sha256.ts:162, sha256.ts:176.
   - Suggested fix: Add a CoreInvariantError (code: 'no_such_row' | 'write_after_digest') or reuse BatchError and HashError with new codes.
   - Verification: **CONFIRMED**. `grep -n RangeError src/core/*.ts` finds batch-table.ts:137 `throw new RangeError('candidate table: no such row')` and sha256.ts:162 and :176 `throw new RangeError('sha256: write after hex()')`. Every other core throw is a coded class. replay.ts:183-186 errorLabel would print only 'RangeError'. All three are guards against programmer error and no input reaches them, so LOW is right.

7. **TECH-C8** [LOW] No lint gate for file length, function length or `as unknown as` → `extension/eslint.config.js:351`
   - Rule: Tech checklist: functions ≤ 60 lines, files ≤ 400 lines; no `as unknown as`
   - Detail: Nothing enforces the 400-line file limit, the 60-line function limit or the `as unknown as` ban: there is no max-lines or max-lines-per-function rule and no selector for double assertions. src/core passes today (largest file 400, longest function 58, 0 double casts), but two Sprint 1 test files already exceed the file limit unnoticed.
   - Evidence: `grep -rIl -e max-lines -e maxLines -e MAX_LINES extension/eslint.config.js extension/tests extension/eslint-rules scripts .github` returns nothing. The fence probe shows `x as unknown as string` in src/core → (none). wc -l: tests/unit/core/receipt.spec.ts 462, tests/property/normalize.property.spec.ts 475.
   - Suggested fix: Add `'max-lines': ['error', { max: 400 }]` and `'max-lines-per-function': ['error', { max: 60 }]` for src/** and tests/** (exempt generated fixtures). Add a no-restricted-syntax entry for `TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']` with the message 'no as unknown as'. Split the two oversized spec files.
   - Verification: **CONFIRMED**. I searched for max-lines, maxLines, MAX_LINES, max_lines and TSAsExpression across eslint.config.js, eslint-rules, tests, scripts, .github and both package.json files: nothing. verify-tech-core/fence.mjs shows `x as unknown as string` in src/core → (none). Of all Sprint 1 .ts/.mjs/.js files, only two are over 400 lines: tests/property/normalize.property.spec.ts (475, ending at line 475) and tests/unit/core/receipt.spec.ts (462). Using fnlen.mjs, I found 0 functions over 60 lines in src/core (775), scripts (59), bench (68), tests/tools (257), src/ledger (88) and src/bus (23). Only the file-size limit has been breached so far.

8. **TECH-C9** [LOW] grading.md wording and signatures drifted from the code → `docs/grading.md:136`
   - Rule: Consistency and docs: docs/grading.md is the source of truth
   - Detail: (a) The §6.1 amountAboveCeiling row (:136) says 'within the guard it is true or false' and later 'Otherwise not applicable'. The code (conditions-scope.ts:144-152) and Decisions 513 take true/false, so the closing sentence is wrong. (b) §8 (:188) gives `isFinalizable(outcome, claim, coverage, context, policy)` and §13 (:338) gives `isFinalizable({outcome, ruleId, claim, grant, coverage, context, candidateDependent, policy})`. The code (conditions-finality.ts:35-53) takes `rule` (not ruleId) plus `orphan` and the optional `eligible`. Here the doc is stale, not the code.
   - Evidence: grading.md:136 '… the candidate case finalises like PARTIAL). Otherwise not applicable. |'. conditions-finality.ts:38 `readonly rule: PolicyRule | null;`, :41 `readonly orphan: Observation | null;`.
   - Suggested fix: Change ':136 Otherwise not applicable' to 'Otherwise false'. Update §8 and §13 to the FinalityInput shape {outcome, rule, claim, orphan, grant, coverage, context, candidateDependent, policy, eligible?}.
   - Verification: **CONFIRMED**. grading.md:136 says 'within the guard it is true or false' and ends with 'Otherwise not applicable.' conditions-scope.ts:144-152 returns `value: exceeded || mismatchCurrency !== undefined` inside the guard, so the result is false, not null. grading.md:188 gives `isFinalizable(outcome, claim, coverage, context, policy)`, and :338 gives `isFinalizable({outcome, ruleId, claim, grant, coverage, context, candidateDependent, policy})`. The real FinalityInput (conditions-finality.ts:35-53) has `rule: PolicyRule | null`, `orphan: Observation | null` and an optional `eligible`. It is re-exported from conditions.ts:58, as §13 requires. Only the doc is stale.

9. **TECH-C10** [LOW] §15 omits the golden fields added in v1.4, although files must be 'written from this document alone' → `docs/grading.md:358`
   - Rule: Consistency and docs; known item 'docs/grading.md §15 may not document every golden field added in v1.4'
   - Detail: §15 (:358-418) documents name, covers, mode, policyPatch, the input lists, fixed, and expect {ref, grade, ruleId, state, observationRefs, score, reasonCodes, reasonParams}. The schema (tests/golden/scenario-schema.ts:263-372) also accepts notes; events (override, supersede, regrade with rejected and deleted); assertIds; input.grade (GradeCall: claim, candidates, agent, priorSpendCents, scope); claim text, rowKey, observedAt and sourceKind; observation rowKey and observedAt; grant ref and updatedAt; coverage observerId; and expect scope, agent, attributionScore, override, previousState, supersededBy and inputs. These appear only in tests/golden/README.md, which §15 never links.
   - Evidence: grep -c in docs/grading.md: assertIds 0, attributionScore 0, '"inputs"' 0, input.grade 0. The same terms are present in extension/tests/golden/README.md (3, 3, 1, 1).
   - Suggested fix: Add the missing fields to the §15 jsonc example and the defaults list, or state in §15 that tests/golden/README.md is the normative file format and link it. Have scripts/check-docs.ts fail when a key of scenario-schema.ts Scenario is named in neither file.
   - Verification: **CONFIRMED**. Counts of each term in docs/grading.md vs tests/golden/README.md: assertIds 0/3, attributionScore 0/3, '"inputs"' 0/1, input.grade 0/1, '"events"' 0/1. The golden files rely on these fields: assertIds is used in 6 files, attributionScore in 17, events in 5 and inputs in 4. scenario-schema.ts:266-273 defines GradeCall (claim, candidates, agent, priorSpendCents, scope). §15 (grading.md:358-360) says files are 'written from this document alone' and never links the README.

10. **TECH-C12** [LOW] CHANGELOG [Unreleased] has nothing for Sprint 1 → `CHANGELOG.md:5`
   - Rule: Tech checklist: CHANGELOG updated under Unreleased
   - Detail: Sprint 1 added the grading core (gradeBatch, grade, state machine, attribution, scope, replay), the attest replay CLI, the golden suite and docs/grading.md, but [Unreleased] lists only Sprint 0 work.
   - Evidence: `git log --oneline 937c333..0067c80 -- CHANGELOG.md` prints nothing. CHANGELOG.md:7-20 'Added' covers only the scaffold, fences, logger, ledger, bus, policy loader, capture, options and CI.
   - Suggested fix: Add Sprint 1 lines under Added: deterministic grading core (receipts, exact scoring, state machine, UNASKED attribution, scope and spend checks), `pnpm attest replay`, 94 golden scenarios, the docs/grading.md reference and docs check, and the grading perf gate.
   - Verification: **CONFIRMED**. `git log --oneline 937c333..0067c80 -- CHANGELOG.md` prints nothing. CHANGELOG.md:5-20 [Unreleased] 'Added' lists only Sprint 0 items: the scaffold, fences, logger, test rails, ledger, bus, policy loader, capture, options, service worker and CI. Nothing mentions grading, replay, golden scenarios or docs/grading.md.

11. **TECH-C13** [LOW] gradeBatch silently skips the cumulative ceiling when activity.claims omits the claims being graded → `extension/src/core/batch.ts:291`
   - Rule: Hard Rule 6 (fail loud); contract §3 (activity.claims holds every claim)
   - Detail: §3 makes the caller put every claim, the PENDING ones included, into activity.claims. gradeBatch builds the spend history only from activity.claims (batch.ts:291-295, 303) and never checks that the graded `claims` are in it. A caller that passes PENDING claims only in `claims` gets no over_ceiling_cumulative and no adjacency suppression, with no error. priorSpendCents already de-duplicates by id, so adding the graded claims to the history cannot double-count.
   - Evidence: Probe scratch/review1/tech-core/probe/cumulative-history.probe.mts: two $30 USD claims against a 5000 USD ceiling, activity.claims = []. Output: `currency=USD: second $30 claim -> UNVERIFIABLE no_coverage priorSpendCents 0`. The same claims listed in activity.claims give OVER_SCOPE over_ceiling_cumulative 3000.
   - Suggested fix: In gradeBatch, build `history` as the union of the seen activity.claims and the seen graded claims (dedupe by id, keep the uniform copies). Alternatively throw BatchError('claim_not_in_activity') when a graded claim is missing from activity.claims. Add a test for each.
   - Verification: **CONFIRMED**. Reproduced. verify-tech-core/cumulative-history.probe.mts gives `currency=USD: second $30 claim -> UNVERIFIABLE no_coverage priorSpendCents 0` with activity.claims = []. batch.ts:290-293 builds `history` only from `claimsSeenBy(activity.claims, …)`, and :303 `spendIndex(read.claims, policy)` reads only that history. Nothing checks that the graded claims are listed in it. splitFixed (:135-151) checks only for duplicate and fixed claims. §3 (grading.md:53) puts the burden on the caller ('activity.claims, which holds every claim'). The receipt is UNVERIFIABLE, not VERIFIED, so this is a missing precondition check: LOW.

12. **TECH-C6** [LOW] Batch-scoped caches ignore part of their inputs after the first call → `extension/src/core/batch-table.ts:123`
   - Rule: Tech review: caches whose keys are not the full input
   - Detail: CandidateTable.visibleTo(row, claimId, assignment, taken) caches the exclusion on its first call (:129) and ignores `assignment` and `taken` on every later call. BatchEvidence.grantHash, shared and eligible (batch-grade.ts:85-91, 110-120, 123-131) are keyed by grant.agent, not by the grant object. Both are correct only under invariants nothing asserts: the assignment is final before the first visibleTo call, and there is one grant per agent per batch (grantsInForce). A future caller, such as a regrade pass reusing a table or a test building BatchEvidence by hand, would get stale answers silently.
   - Evidence: batch-table.ts:129 `const exclusion = (this.#exclusion ??= exclusionOf(this.rows, assignment, taken));`. batch-grade.ts:86 `const held = this.#grantHashes.get(grant.agent); if (held !== undefined) return held;`.
   - Suggested fix: Bind the assignment once with `table.exclusionFor(assignment, taken)`, returning an object with visibleTo(row, claimId), or store the assignment and taken references and throw a typed error if a later call passes different ones. Key the BatchEvidence maps by the Grant object (Map<Grant, …>), or check `held.grant === grant` on a hit.
   - Verification: **REFUTED**. I could not reach a stale answer. CandidateTable.visibleTo has one call site, batch-grade.ts:142, which always passes batch.assignment and batch.taken. Both are built once in gradeBatch (batch.ts:301-305) and are read-only after that. BatchEvidence is constructed only at batch.ts:305, and no test builds it by hand (grep `new BatchEvidence` in src and tests). Its grants come from grantsInForce (batch-grants.ts:20-34), which throws BatchError('ambiguous_grant') rather than allow two grants for one agent. So the claim that 'nothing asserts' the invariant is wrong for the grant key. I also checked the third batch cache the review did not mention, `eligible` (batch-grade.ts:123-131). Its key, eligibilityKey (conditions-coverage.ts:176-180), covers every claim input eligibleCoverage reads: claim.type, plus the parser flag that only gmail.receipt entries use. This is a hypothetical risk from future callers, with no failure scenario, and the reviewer filed it under a rule that is not in agents/tech_reviewer.md.

13. **TECH-C11** [LOW] The §10 claim rawHash and Request.id formulas exist only in test code → `extension/tests/golden/build.ts:94`
   - Rule: Tech checklist: ids derived from content hashes (one implementation per rule)
   - Detail: §10 (grading.md:236) defines rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash|null, text, claimedAt truncated to its precision unit in its own offset})) and Request.id. No src/core function computes either: the only implementation is tests/golden/build.ts:94-104 (with truncateIso from tests/golden/time.ts), plus three inline copies in tests/golden/loader.spec.ts:64, 213 and 267. The truncation is DST-sensitive, which is exactly the pure logic that belongs in core. Sprint 3 adapters will otherwise write a fourth copy that the golden suite never checks.
   - Evidence: `grep -rn rawHash src/core/*.ts` shows only schema fields and checks (schema.ts:144/170, schema-checks.ts:131-141, batch.ts:94/121). `grep -rn 'rawHash = hashCanonical' tests` finds build.ts:97 and loader.spec.ts.
   - Suggested fix: Add `claimRawHash({agent, sourceKind, rowKeyHash, text, claimedAt, claimedAtPrecision})`, `claimId(...)` and `requestId({agent, conversationId, textHash, ts})` to src/core (hash.ts or a new ids.ts) with unit tests, including DST days. Make build.ts and loader.spec.ts call them.
   - Verification: **REFUTED**. The fact is right. No src/core function computes rawHash (grep finds only schema fields and checks), and test helpers compute it: tests/golden/build.ts, tests/unit/core/demo-ledger.ts:151-156 and tests/unit/core/scope-grade.spec.ts:34. But this work is out of Sprint 1 scope. sprints/sprint_3.md:15 (task 3.2) owns 'rawHash over the normalised claim text for dedup'. §10 says the adapter computes the normalised text. The §13 export table (grading.md:325-345) names no core function for rawHash or Request.id. In Sprint 1, Claim ids only need to match idFromHash(rawHash), and schema-checks.ts:141 enforces that. The proposed core helper is a good input for 3.2, not a Sprint 1 gap.

### TESTS WRITTEN

- scratchpad/review1/tech-core/fnlen.mjs (TypeScript-AST measure of every function's length; scratch only)
- scratchpad/review1/tech-core/probe/orphan-source.probe.mts (gradeBatch then replay of an orphan whose source is not listed for its type; reproduces TECH-C1)
- scratchpad/review1/tech-core/probe/fence.probe.mjs (src/core lint fences through the real eslint.config.js; TECH-C2, TECH-C8)
- scratchpad/review1/tech-core/probe/tsc/probe.ts (core tsconfig accepts '../clock', WeakRef, FinalizationRegistry; TECH-C2)
- scratchpad/review1/tech-core/probe/cumulative.probe.mts (cumulative ceiling with and without a claim currency; TECH-C3)
- scratchpad/review1/tech-core/probe/cumulative-history.probe.mts (cumulative ceiling with activity.claims empty; TECH-C13)

### ADVERSARIAL VERIFICATION

I checked all 13 gaps against the tree and wrote nothing in it. My probes ran in the foreground from scratchpad/review1/verify-tech-core/ (orphan-source.probe.mts, cumulative*.probe.mts, fence.mjs, fence-full.mjs, amount.mts, fnlen.mjs). I started no background jobs and left none running.

Results: 8 confirmed, 3 resized, 2 refuted.
- Confirmed: TECH-C1 and TECH-C2 (CRITICAL); TECH-C5, C7, C9, C10, C12 and C13 (LOW).
- Resized: TECH-C3 from MEDIUM to LOW. The core amount normaliser never gives an amount without a currency, so nothing in core can produce a currency-less spend claim today. The contract wording is still contradictory.
- Resized: TECH-C4 from MEDIUM to LOW. The copies are real, but the one copy that diverged is already TECH-C1. Part of the evidence is also wrong: replay-compare.spec.ts:25-58 does pin contentHashOf to project().
- Resized: TECH-C8 stays LOW. It is real, and the only Sprint 1 files over 400 lines are the two known test files.
- Refuted: TECH-C6. Both caches are built once per gradeBatch, and grantsInForce enforces one grant per agent, so no input can reach a stale answer.
- Refuted: TECH-C11. Claim rawHash belongs to Sprint 3.2, and §13 names no core export for it.

Spot checks of the PASS items held up:
- No function in src/core, scripts, bench, tests/tools, ledger or bus is over 60 lines.
- Every §13 export exists.
- COMPARED_FIELDS matches §9.
- The graceElapsed wrapper matches the condition.
- eligibilityKey covers every claim input that eligibleCoverage reads.
- All 93 policy keys appear in grading.md.
- no-policy-literals and the fence tests pass (22 tests).

The review left out two checklist items: "documented in grading.md" and "tests follow the layout". Both pass, and I list them as corrections. I found no new substantiated gap. The review's own fence probe also shows that `new Date(x).toString()` and `String(new Date(x))` pass lint in src/core. That is a logged Sprint 0 choice ([0.close]) with a CI time-zone run as the fallback, and core uses neither today, so I added it to TECH-C2's evidence instead of filing it as a gap.

Checklist corrections:

- 'Duplicate implementations pinned together by tests' (GAP): the evidence says the contentHash pair is not pinned. That is wrong. tests/unit/core/replay-compare.spec.ts:25-58 asserts contentHashOf(project(...)) === project(...).contentHash for gmail.sent, gmail.receipt and gcal.event rows, with and without rowKey. Remove the contentHash pair from the 'Not pinned' list. The status stays GAP for TECH-C1 and the unpinned orphan-order copies.
- 'Module-level caches keyed by the full input' (PASS): drop the pointer to TECH-C6, which I refuted (single construction site at batch.ts:305; grantsInForce enforces one grant per agent). I also checked the third batch cache the review left out. BatchEvidence.eligible is keyed by grant.agent plus eligibilityKey (conditions-coverage.ts:176-180), and that key covers every claim input eligibleCoverage reads. PASS without qualification.
- 'Ids derived from content or input hashes; ULIDs only for new events' (PASS): drop the pointer to TECH-C11. Computing claim rawHash belongs to Sprint 3.2 (sprints/sprint_3.md:15), and §13 names no core export for it.
- 'Contract §6.1 spend ceilings' (GAP): keep it as GAP for the contract wording only, at LOW. Every amount from normalize-amount.ts amount() carries a currency (Money.currency is required; a bare '$30' returns null), so nothing in core can produce a currency-less spend claim today.
- Missing item 'Every new bus message, table, policy field, or grade documented in docs/grading.md or docs/adapters.md': the review did not list it. It PASSES. A key walk over policy/default.json (changed by 153 lines this sprint) found all 93 key names in docs/grading.md. The Sprint 1 diff to src/bus/messages.ts adds no message type; it only switches the imports to core/schema.ts.
- Missing item 'Tests follow the layout in build_spec.md §6': the review did not list it. It PASSES. tests/unit/test-layout.spec.ts:30-38 pins VITEST_INCLUDE to tests/{unit,property,golden} and perf gates to tests/perf/**/*.perf.spec.ts. tests/perf is logged in Decisions.md:650 [1.perf], and CLAUDE.md lists tests/golden.
- 'Functions ≤ 60 lines, files ≤ 400 lines' (PASS): this holds beyond src/core. fnlen.mjs finds 0 functions over 60 lines in scripts (59), bench (68), tests/tools (257), src/ledger (88) and src/bus (23). Only tests/property/normalize.property.spec.ts (475) and tests/unit/core/receipt.spec.ts (462) exceed 400 lines among the Sprint 1 code files.

### COMMANDS RUN

- `git diff --name-only 937c333..0067c80` → OK: Sprint 1 file list: 61 src/core files, the golden suite, property and perf tests, tools, docs and scripts.
- `cat agents/tech_reviewer.md; read docs/grading.md §1-§16; read the src/core modules (batch*, grade*, conditions*, candidates*, attribution*, scope, replay*, receipt*, hash, base32, ratio, state, features*)` → OK: Checklist and contract read; code compared with the contract line by line.
- `wc -l src/core/*.ts; find tests src -name '*.ts' | xargs wc -l | awk '$1>400'` → PASS for core: 61 core files, the largest schema.ts at 400. Over 400 outside core: tests/unit/core/receipt.spec.ts 462, tests/property/normalize.property.spec.ts 475.
- `node scratch/fnlen.mjs src/core 60 (also src/ledger, src/bus)` → PASS: 775 core functions, 0 over 60 lines; the longest is grade.ts:185 judge at 58. Ledger and bus: 0 over.
- `npx eslint src/core --max-warnings=0` → PASS: No errors or warnings (26 s).
- `npx eslint src/core --rule '{complexity:12,max-depth:4,max-params:6}' -f json` → INFO: Hot spots: sha256 rounds 27, ruleMatches 25, amountAboveCeiling 20, fastInstantMs 19, valueInto 18; gradeBatch has 7 params (contract-fixed).
- `grep for any, 'as unknown as', non-null '!', TODO/FIXME, eslint-disable, hosts, Date.now, Math.random in src/core` → PASS: 0 hits for each.
- `node scratch/probe/fence.probe.mjs (ESLint API, real config)` → GAP: '../clock', '../setup', '../config', '../log-vocabulary', WeakRef, FinalizationRegistry and `as unknown as` are not flagged in src/core; '../ledger/db', Intl, localeCompare and any are flagged.
- `npx tsc -p scratch/probe/tsc/tsconfig.json (extends src/core/tsconfig.json)` → PARTIAL: DOMParser and BroadcastChannel rejected (lib ES2023); the clock import, WeakRef and FinalizationRegistry accepted.
- `npx tsx scratch/probe/orphan-source.probe.mts` → FAIL (confirms TECH-C1): gradeBatch: UNASKED FINAL; replay: 0/1 reproduced, mismatch field 'orphan', replayed 'uncovered'.
- `npx tsx scratch/probe/cumulative.probe.mts` → CONFIRMS TECH-C3: USD: OVER_SCOPE over_ceiling_cumulative; no currency: UNVERIFIABLE no_coverage.
- `npx tsx scratch/probe/cumulative-history.probe.mts` → CONFIRMS TECH-C13: activity.claims empty: priorSpendCents 0, no cumulative OVER_SCOPE.
- `npx vitest run tests/unit/core/replay.spec.ts tests/unit/core/replay-compare.spec.ts tests/unit/core/batch-orphans.spec.ts` → PASS (35/35): Passes because the existing suites never exercise the TECH-C1 divergence.
- `node import-cycle DFS over src/core './x' imports` → PASS: No import cycles.
- `export-usage scan (grep -rlw per export over src, entrypoints and tests)` → GAP: Dead in src: SIGNAL_REASON, attributionReasons, merchantMatchOf, scoreGteBasisPoints, CENTS_PER_UNIT (TECH-C5).
- `git log --oneline 937c333..0067c80 -- CHANGELOG.md` → GAP: Empty: no Sprint 1 CHANGELOG entry (TECH-C12).
- `grep -c of golden v1.4 fields in docs/grading.md and tests/golden/README.md` → GAP: assertIds, attributionScore, inputs and input.grade are absent from grading.md and present in README (TECH-C10).

## Part 2: tests, tools, CI, docs and logs

Technical review, part 2 of 2: everything in the Sprint 1 range (937c333..0067c80) outside extension/src/core. I wrote nothing in the shared tree. Probes and mutants ran only in my scratch mirror (scratchpad/review1/tech2/). The one background job I started was a targeted vitest run, and it has finished.

Overall the test infrastructure is strong:
- All 94 golden scenarios carry hand computations, and every expected score appears in its notes.
- No commit changed an expectation without also changing its notes. The golden files were committed (f936621) before grade() existed (15176d3).
- The golden runner is mutation-tested against broken expectations and broken receipts.
- Property oracles are independent: plain greedy, BigInt arithmetic, Node crypto, and fast-path vs reference.
- The ids snapshot is byte-compared and written only by an explicit script.
- CI runs the perf pass (through root `pnpm test`), test:tz and check-docs (through `pnpm lint`).
- Decisions.md is complete, and the Progress Log has a line for every task 1.0 to 1.11.

Test runs:
- Property, golden, docs and tools: 1,682/1,682 passed.
- Core unit: 3,628/3,628 passed.
- Lint rules: 245/245 passed.
- Load average during the runs was 23 to 151.

13 gaps (TECH-R1 to TECH-R13):
- **CRITICAL (TECH-R1):** the Gate's grep test for clocks, randomness and fetch in src/core does not exist. Lint enforces the rule and src/core is clean today, but the Gate names the test and it touches Hard Rule 4.
- **MEDIUM:**
  - TECH-R2: nothing measures or enforces the Gate's core coverage of 95% or more.
  - TECH-R3: heavy tests run on Vitest's 5 s default. One took 4,088 ms under load, and timeout constants are inconsistent.
  - TECH-R4: features-golden.spec.ts gives a false failure on a valid regrade scenario (proven with a probe).
  - TECH-R5: docs/grading.md §15 omits about 15 golden format fields.
- **LOW:**
  - Two test files are over 400 lines (TECH-R6, TECH-R7).
  - 12 describe callbacks are over 60 lines, against this sprint's own stated rule (TECH-R8).
  - CHANGELOG has no Sprint 1 entry (TECH-R9).
  - 321 lines of helpers are duplicated across test files (TECH-R10).
  - The graceElapsed unit tests target an export only tests use (TECH-R11).
  - RESULTS.md was measured before the v1.4 grading changes and gates on a different clock than the test (TECH-R12).
  - Decisions.md carries workflow residue: verdicts, absolute machine paths and stale lines (TECH-R13).

The known items checked out as follows:
- receipt.spec.ts (462 lines) and normalize.property.spec.ts (475) are over the limit.
- The CHANGELOG is empty for Sprint 1.
- The timeouts are real and load-related.
- features-golden is fragile.
- §15 is incomplete.
- The graceElapsed wrapper has not drifted. It is equivalent today, but production never calls it.

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| Files <= 400 lines (Sprint 1 files outside src/core; TS compiler API scan of 162 .ts files) | GAP | Over 400: extension/tests/property/normalize.property.spec.ts 475, extension/tests/unit/core/receipt.spec.ts 462 (TECH-R6, TECH-R7). Every other file is at or under 400; the largest are checks.spec.ts 395, checks.ts 390, scenario-schema.ts 386, attest-world.ts 380. |
| Functions <= 60 lines (functions, arrows, methods, it() callbacks) | PASS | The AST scan found no function, helper, method or it() callback over 60 lines in tests/**, scripts/check-docs*.ts, bench/**, src/ledger or src/bus. The only spans over 60 are describe() containers (next item). |
| describe() containers <= 60 lines (the standard this sprint adopted in Decisions [1.policy], [1.5], [1.7], [1.v14-core], [1.11]) | GAP | 12 over 60 lines, the largest batch-inputs.spec.ts:95 (131 lines) (TECH-R8). Sprint 0 tech review did not count describes, so this is LOW. |
| No any / as unknown as / unexplained ! in tools, scripts, bench, ledger, bus | PASS | grep over scripts/check-docs*.ts, bench/*.ts, src/ledger, src/bus and tests/tools/attest-*.ts: no hits. The Sprint 1 test diff adds 0 `as unknown as`. |
| No TODO/FIXME without a task | PASS | grep TODO\|FIXME\|XXX over scripts, bench, tests/golden, tests/tools/attest-*, tests/perf, tests/property, tests/unit/core and tests/unit/docs: none. |
| Errors typed, carry context, never swallowed (CLI, loader, check-docs) | PASS | SnapshotError(code) in attest-snapshot.ts and GoldenLoadError(code, detail) in load.ts. attest-cli.ts:96-105 catches only SnapshotError and rethrows anything else. replay.ts:316-333 turns grade errors into 'error' mismatches. check-docs exits 0/1/2. |
| Naming: kebab-case files, camelCase, UPPER_SNAKE constants | PASS | Every new file is kebab-case (v13-rules-evidence.ts, attest-snapshot.ts, check-docs-markdown.ts, ...). Constants use UPPER_SNAKE (LISTED_MISMATCHES, IDS_SNAPSHOT, GATE_MS, VITEST_PERF_INCLUDE). |
| Tests follow build_spec §6 layout | PASS | tests/golden is in CLAUDE.md's layout. tests/perf is logged in Decisions [1.perf] (line 650). tests/unit/test-layout.spec.ts pins VITEST_INCLUDE and VITEST_PERF_INCLUDE and checks that every perf file is *.perf.spec.ts. bench/core.ts is logged in Decisions [1.3] (line 447). |
| CI runs the perf pass the Gate needs | PASS | ci.yml:45-46 runs root `pnpm test`, which is `pnpm --dir extension run test && pnpm --dir extension run test:perf` (package.json). vitest.perf.config.ts runs serially in one fork. Not yet proven on a GitHub runner, because nothing has been pushed (MANUAL). |
| CI runs test:tz | PASS | ci.yml:49-50 runs `pnpm --dir extension run test:tz`, which covers core, property and golden under Pacific/Kiritimati and America/St_Johns. |
| CI runs check-docs | PASS | Root lint ends `&& pnpm check-docs` (package.json). ci.yml runs `pnpm lint`. `npx tsx scripts/check-docs.ts` printed: check-docs: OK (4 files, 123 relative links, 13 pnpm commands, 14 rule ids). |
| CI or any script enforces the Gate's 'core coverage >= 95%' | GAP | grep -i coverage over package.json, extension/package.json, vitest*.config.ts and ci.yml finds only the devDependency @vitest/coverage-v8. There is no script, no threshold and no CI step (TECH-R2). |
| Gate: 'grep test for Date.now\|Math.random\|crypto.getRandomValues\|fetch' over src/core | GAP | Every test reference to these patterns is an ESLint probe on a synthetic snippet (tests/unit/lint/fences.spec.ts:79-85, rules.spec.ts:80-96, fences-scopes.spec.ts:245-247). No test reads src/core. src/core is clean today (my grep: no hits) (TECH-R1). |
| Golden expectations hand-computed, not generated from the implementation | PASS | 94/94 scenarios have notes. Every expected score string appears in its notes (python check: 0 missing). In the 4 golden commits (f936621, 98a7b6f, 73cb59c, ad6cb88), no modified file changed `expect` without also changing `notes`. f936621 (golden) precedes 15176d3 (grade()). No script writes scenario expectations; the only writer is write-ids.ts. |
| __snapshots__/ids.json cannot hide a regression | PASS | scenarios.spec.ts:337-341 compares the file byte for byte with formatIds(scenarioIds()) and never rewrites it. It is written only by `pnpm exec tsx tests/golden/write-ids.ts`. Receipt ids are computed by the loader from the documented K formula, independent of core. inputsHash is restated independently in receipt.spec.ts:179-197 with node:crypto. canonicalJson and sha256Hex have known-answer vectors (hash.spec.ts:12-28, 141-158). |
| Golden runner proven to fail on wrong expectations and wrong receipts | PASS | golden.spec.ts:66-161 runs 8 expectation mutations plus evidence, params, override, supersede, missing or extra receipt, computedAt, finalAt, agent, claimId, policyHash, attribution and schema mutations, and each one is reported. runner-v14.spec.ts covers inputs and events. |
| No tautological tests (re-implementing the code under test) | PASS | The oracles are independent: candidates-assign.property.spec.ts:70-100 (a plain greedy with BigInt-safe cross-multiplication), scope.property.spec.ts (spendIndex vs priorSpendCents), hash.property (BigInt and Node crypto), redact-golden.spec.ts (project() vs the loader's own §10 hashing in build.ts). One trivial case: hash.spec.ts:209 calls idFromHash twice on the same input. That is harmless, not a gap. |
| Assertions that cannot fail | PASS | The AST scan over every Sprint 1 spec found no it() without an assertion, no expect(true), no length >= 0, and one same-sides toBe (hash.spec.ts:209, a determinism check). The toBeDefined calls are narrowing guards before real assertions. |
| Fragile tests (features-golden.spec.ts for future regrade scenarios) | GAP | Scratch probe 95-regrade-new-evidence.json passes golden.spec, grade-golden, redact-golden and batch-determinism, but features-golden fails: 'expected null to be 1/1' (TECH-R4). |
| Per-test timeouts on heavy tests | GAP | policy-hash.spec.ts:113 took 4,088 ms with no timeout (load ~100-150). hash.property.spec.ts:25 took 1,893 ms with none. 1,119 of 1,214 measured tests rely on the 5 s default. PROPERTY_TIMEOUT_MS is defined in 6 files as 30 s or 60 s (TECH-R3). |
| Helpers duplicated across test files | GAP | The AST scan found identical top-level helpers in 2 to 7 files each: issuePaths x6, entry x4, claimOf/obsOf x3, activity x3, issuesOf x3, ... That is 321 duplicated lines (TECH-R10). |
| Exported graceElapsed wrapper vs conditions | GAP | It has not drifted: it is equivalent to Conditions.graceElapsed() today. But production never calls it (grep), and its 5 tests still pass when the production method is mutated (TECH-R11). |
| docs/grading.md documents every rule id, and the docs check passes | PASS | check-docs: OK, 14 rule ids found as code spans. |
| docs/grading.md §15 documents the golden file format | GAP | §15 (lines 358-419) has 0 mentions of events, regrade, rejected, deleted, assertIds, notes, rowKey, inputs, previousState, supersededBy, attributionScore, allCalendars, adapterSyncs or input.grade, and no link to tests/golden/README.md (TECH-R5). |
| docs/assets/receipt-states.svg present and tested | PASS | tests/unit/docs/receipt-states-svg.spec.ts passed in my targeted run (part of 1,682/1,682). |
| CHANGELOG updated under Unreleased | GAP | `git diff 937c333..0067c80 -- CHANGELOG.md` is empty. [Unreleased] (CHANGELOG.md:5) lists only Sprint 0 items (TECH-R9). |
| Decisions.md has an entry for every unspecified choice this sprint | PASS | 504 Sprint 1 entries. Spot-checked choices are all logged: CLI exit codes, INIT_CWD and the 20-line list ([1.9] 720); the serial perf pass and CPU median ([1.perf] 650); bench workload ([1.3] 447); explicit ids-snapshot script ([1.golden] 494); check-docs in lint ([1.11] 757); 600 s replay timeouts ([1.9] 723). Quality of entries: see TECH-R13. |
| build_spec.md Progress Log: one plain-English line per task 1.0-1.11 | PASS | Lines for 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10 and 1.11 are all present, plus 1.v14 and 1.golden. The 1.3 line's 289.6 ms matches the d15081e bench JSON (a later run re-measured 298.8). |
| Hard Rule 12: committed numbers describe the code at HEAD | GAP | bench/results/core-2026-10-02.json and RESULTS.md were last written in c5805d9. 1af0a41 and 36fe223 then changed batch.ts, batch-grade.ts, grade.ts and attribution.ts (17 core files, +1,282/-227). Receipt counts are unchanged (5845/1883/1073/844, re-counted on HEAD), but no timing at HEAD is committed (TECH-R12). |
| Perf gates: correctness asserted, not just speed | PASS | grading.perf.spec.ts:134-158 asserts one receipt per claim, one-to-one evidence and real VERIFIED/NOT_FOUND/UNASKED counts. It checks every 50th receipt against grade() over brute-force candidates and every 50th claim-less receipt against its stored inputs, and requires all runs to be identical, before the CPU check. |
| attest CLI: boundary validation, output holds no content | PASS | attest-snapshot.ts parses the input with a strict ReplayExport schema (LedgerExport.extend) and loadPolicy, checks each policy hash against its key, and lists at most 10 Zod issues, paths and messages only. attest-cli.ts prints ids, hashes, grades and counts. Exit codes are documented in docs §9 and pinned by attest-cli.spec.ts (passed). |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **TECH-R1** [CRITICAL] The Gate's grep test over src/core for clocks, randomness and fetch does not exist → `sprints/sprint_1.md:44`
   - Rule: Hard Rule 4 (grade() pure and deterministic); sprint_1.md Gate item 'lint + grep test for Date.now|Math.random|crypto.getRandomValues|fetch'
   - Detail: The Sprint 1 header (sprint_1.md:5) and Gate (line 44) both require a grep test that enforces the clock and randomness ban on the real src/core tree. Only the ESLint side exists: tests/unit/lint/* prove that attest/core-determinism and no-restricted-globals fire on synthetic snippets. No test reads the actual files in src/core. src/core is clean today and `pnpm lint` enforces the rule, so there is no violation. But the independent second check the Gate names is missing. A lint config regression (a misspelled glob, a rule scoped away from a new file, an override block) would then go unnoticed by `pnpm test`.
   - Evidence: `grep -rn "Date.now\|Math.random" tests/unit tests/property tests/golden` → hits only in tests/unit/lint/rules.spec.ts:80-96 and fences-scopes.spec.ts:245-247 (synthetic code). `grep -rln getRandomValues tests/unit` → only tests/unit/lint/fences.spec.ts:82 (synthetic). `grep -rnE "Date\.now|Math\.random|getRandomValues|\bfetch\b|new Date\(\)" src/core` → no output (clean today). Decisions.md has no entry replacing the grep test with the lint rule (line 227 adds the rule but keeps no such waiver).
   - Suggested fix: Add extension/tests/unit/core/core-purity.spec.ts. Walk src/core/**/*.ts and strip comments and string literals (or use the TS scanner). Assert there are no matches for /\bDate\.now\b|\bMath\.random\b|\bgetRandomValues\b|\bfetch\s*\(|new\s+Date\s*\(\s*\)|\bperformance\.now\b/. Add a negative control: the same matcher must flag a fixture string holding each pattern. Also assert that the walk saw at least N files, so a wrong path cannot pass vacuously.
   - Verification: **CONFIRMED**. Reproduced. No test reads the real src/core files for these patterns.
     - `grep -rn 'Date.now|Math.random|getRandomValues' extension/tests` finds only lint probes on virtual files: rules.spec.ts:80-96, fences.spec.ts:79-82 and fences-scopes.spec.ts:244-252.
     - Every spec that reads files from disk and mentions src/core does something else: no-policy-literals scans for numeric literals; policy, redact.property and golden/load read data.
     - src/core is clean today: `grep -rnE "Date\.now|Math\.random|getRandomValues|\bfetch\b|new Date\(\)|performance\.now" extension/src/core` returns nothing (61 entries in src/core).
     - No Decisions.md entry waives the test (`grep -n -i "grep test" Decisions.md` returns nothing). sprint_1.md:5 and :44 both name it.
     
     One correction to the rationale: a misspelled src/core glob would NOT go unnoticed. fences.spec.ts:78-85 and fences-scopes.spec.ts:241-254 lint a virtual 'src/core/probe.ts' through the real eslint.config.js and expect no-restricted-syntax and attest/core-determinism. What really escapes is a per-file override or ignores entry that names an existing core file. The Gate item is still unmet, and it guards Hard Rule 4, so it stays CRITICAL under the brief's rule.

2. **TECH-R3** [MEDIUM] Heavy tests rely on Vitest's 5 s default and come close to it under load; timeout constants are scattered and inconsistent → `extension/tests/unit/core/policy-hash.spec.ts:113`
   - Rule: qa_tester rule 10 (flaky = failing); tech_reviewer code quality (no scattered magic values)
   - Detail: These tests have no per-test timeout and are measurably heavy:
     - policy-hash.spec.ts:113 ('changes when any single value changes')
     - hash.property.spec.ts:25 and :36 (5,000 runs)
     - normalize.property.spec.ts:288 and :329 (5,000 runs)
     - ratio.property.spec.ts:122 (20,000 runs), :145 and :156 (10,000 runs), :188, :202
     - scope.property.spec.ts:53 and :65
     - no-policy-literals.spec.ts:170 and :175
     - batch-determinism.spec.ts:102 and :130
     The Sprint 0 lint specs (tests/unit/lint/*, 25 tests, none with a timeout) reached 2,172 ms in the same conditions. This is load-related: each test passes alone, and Decisions.md:428 records full-suite failures that were all '5-second default timeout under load average about 100'. Where timeouts exist they are ad hoc: PROPERTY_TIMEOUT_MS is redefined in 6 files as 30_000 or 60_000, and literals of 30_000, 60_000, 120_000 and 600_000 plus COMPILE_TIMEOUT_MS and TIMEOUT_MS are used. Decisions [1.5] (line 523) says 'Each property has a 300 s timeout', but no 300_000 exists in tests/.
   - Evidence: Measured with `npx vitest run tests/unit/core --maxWorkers=3 --reporter=json` (load average 95 → 151). Durations: policy-hash.spec.ts:113 4,088 ms; no-policy-literals.spec.ts:170 1,848 ms; batch-determinism.spec.ts:130 1,645 ms and :102 1,357 ms, all with timeout NONE. From the targeted property run (load average 23 → 64): hash.property.spec.ts:25 1,893 ms; normalize.property.spec.ts:288 1,029 ms; ratio.property.spec.ts:188 708 ms, all NONE. The AST tally over the measured files is 1,119 NONE, 35 × 60_000, 23 × PROPERTY_TIMEOUT_MS, 8 × 600_000, 4 × TIMEOUT_MS, 3 × COMPILE_TIMEOUT_MS, 2 × 30_000 and 1 × 120_000. `grep -rn "PROPERTY_TIMEOUT_MS =" tests` finds state-grace-full, policy-shape, state-grace, state.property and normalize-time.property (30_000) and features.property and features-memo.property (60_000).
   - Suggested fix: Set one suite-wide `testTimeout` (e.g. 60_000) in extension/vitest.config.ts. A timeout guards against hangs; it is not an assertion, so this weakens nothing. Delete the per-file PROPERTY_TIMEOUT_MS, TIMEOUT_MS and COMPILE_TIMEOUT_MS constants and the 30_000/60_000 literals. Keep explicit values only above the default (the 600_000 replay properties and the perf config). Correct Decisions [1.5] line 523.
   - Verification: **CONFIRMED**. Reproduced in my mirror at 0067c80, load average 120-136. These tests have no per-test timeout:
     - policy-hash.spec.ts:113: 2,878 ms
     - hash.property.spec.ts:25: 2,599 ms
     - no-policy-literals.spec.ts: 2,066 ms
     - ratio.property: 1,708 ms
     
     The failures are real and load-related:
     - Decisions.md:428 records full-suite failures that were all '5-second default timeout under load average about 100'.
     - The concurrent QA reviewer's uncommitted edit adds `}, 60_000)` to policy-hash.spec.ts:113 with the comment 'over 5 s under machine load (QA Sprint 1 review)'.
     
     Corrections to the evidence:
     - (1) 'no 300_000 exists in tests/' is wrong: tests/property/grade.property.spec.ts:49 has `const PROPERTY_TIMEOUT_MS = 300_000;`. Decisions [1.5] line 523 is accurate for task 1.5's property and should not be 'corrected'.
     - (2) PROPERTY_TIMEOUT_MS is defined in 11 files, not 6: 30_000 in five, 60_000 in five and 300_000 in one, plus TIMEOUT_MS, COMPILE_TIMEOUT_MS and ZONE_TIMEOUT_MS.
     - (3) Decisions.md:614 explains why the 60_000 literal is used: Prettier keeps the compact call layout only for a literal.
     
     The severity is right: flaky = failing (qa_tester rule 10), and a timeout breaks the `pnpm test` pre-push hook.

3. **TECH-R4** [MEDIUM] features-golden cross-check 2 checks post-event expectations against candidates seen at the initial evaluatedAt, so a valid regrade scenario fails falsely → `extension/tests/unit/core/features-golden.spec.ts:118`
   - Rule: Test quality: fragile tests (brief item); qa_tester rule 10
   - Detail: ownCandidates() keeps only observations with observedAt <= loaded.evaluatedAt (line 118), the scenario's first grading instant. But loaded.expected holds the receipt after the scenario's events, including a regrade at a later evaluatedAt (README 'events'; scenarios 93 and 94). Evidence first seen between the two instants is exactly what a regrade exists for. A scenario that exercises it gives best = null while the correct expectation has a score, so the test fails although the golden runner and the core agree. Check 1 (lines 147-153) has the opposite weakness: it ignores observedAt and the calendar.created first-seen rule. Today it passes only because no single-claim scenario has a later-seen observation that outscores the expected one.
   - Evidence: In the scratch mirror I added 95-regrade-new-evidence.json, a copy of 93's shape. o1 has observedAt 14:40. The first grading at 14:30 gives c1 UNVERIFIABLE/pending. The regrade at 14:45 gives VERIFIED 1/1 FINAL, and the notes hold the hand computation. Results: golden.spec.ts '95-regrade-new-evidence.json' ✓; grade-golden, redact-golden and batch-determinism pass; scenarios/checks/v14-rules pass except the expected ids.json diff and one mirror-only agents/ path. features-golden.spec.ts fails: `× 95-regrade-new-evidence.json c1: best over its own candidates ... AssertionError: expected null to be '1/1'` at features-golden.spec.ts:169.
   - Suggested fix: In scoredClaims(), find the last applied (non-rejected) regrade event for the ref. Filter candidates and the first-seen rule by that event's evaluatedAt instead of loaded.evaluatedAt. Skip deleted or overridden subjects whose score comes from an earlier grading, or take the instant from the receipt's computedAt. Apply the same observedAt <= instant filter and the calendar first-seen rule in check 1, or restrict check 1 to scenarios without events. Add the probe scenario (or an equivalent) to the suite so the case stays covered.
   - Verification: **CONFIRMED**. Reproduced in a clean mirror (`git archive 0067c80`) using tech2's probe 95-regrade-new-evidence.json.
     - Command: `npx vitest run tests/golden/golden.spec.ts tests/unit/core/features-golden.spec.ts -t 95-regrade`.
     - golden.spec passes the scenario.
     - features-golden fails with 'AssertionError: expected null to be '1/1'' at features-golden.spec.ts:169, because ownCandidates() filters by loaded.evaluatedAt (line 118), not by the regrade's evaluatedAt.
     
     Not handled in the range. A concurrent reviewer's uncommitted shared-tree edit (`git diff extension/tests/unit/core/features-golden.spec.ts`) adds gradedAt() and uses it, but that is not in 0067c80.
     
     It stays MEDIUM because the test oracle contradicts the §8 regrade semantics and will block valid scenarios.

4. **TECH-R2** [LOW (reviewer: MEDIUM)] Nothing measures or enforces the Gate's src/core coverage of 95% or more → `extension/vitest.config.ts:13`
   - Rule: sprint_1.md Gate 'core coverage >= 95%'; qa_tester rule 8; brief: does CI run everything the gate needs
   - Detail: @vitest/coverage-v8 is installed, but no vitest config has a coverage block or thresholds, and no script runs `vitest --coverage`. CI has no coverage step. The Gate's coverage item is therefore checked only when someone runs coverage by hand. A later change that drops core coverage below 95% passes CI.
   - Evidence: `grep -n -i coverage package.json extension/package.json extension/vitest.config.ts extension/vitest.perf.config.ts .github/workflows/ci.yml` → only extension/package.json:38 "@vitest/coverage-v8": "5.0.3". The test block of extension/vitest.config.ts (lines 13-19) has include, environment, mockReset and restoreMocks only.
   - Suggested fix: Add `coverage: { provider: 'v8', include: ['src/core/**'], thresholds: { lines: 95 } }` to vitest.config.ts behind a `test:coverage` script (`vitest run --coverage`). Run it in CI, either as its own step or by making the 'Unit + property tests' step use it, and report the number in RESULTS.md or the QA output.
   - Verification: **RESIZED** to LOW. The absence is real: `grep -n -i coverage package.json extension/package.json extension/vitest*.ts .github/workflows/ci.yml` finds only the devDependency at extension/package.json:38.
     
     But "nothing measures" is overstated:
     - Coverage works on demand. Sprint 0 QA measured it this way (reviews/sprint_0/qa.md:29, 204).
     - qa_tester.md:25 (rule 8) asks QA to report the number at sprint end, which is when the Gate is evaluated.
     - I measured it at 0067c80 in my mirror (`vitest run tests/unit/core tests/property tests/golden --coverage --coverage.include='src/core/**'`, 4,954 tests passed): Lines 98.41% (3095/3145), Statements 97.35%, Branches 91.58%, Functions 99.09%. The Gate's 95% holds.
     - No tech_reviewer.md item requires a CI threshold.
     
     What remains is only a guard against later regressions, so LOW.

5. **TECH-R5** [LOW (reviewer: MEDIUM)] docs/grading.md §15 omits most golden file fields added in v1.2-v1.4 and does not point to tests/golden/README.md → `docs/grading.md:360`
   - Rule: tech_reviewer 'Every new ... documented in docs/grading.md'; docs/grading.md is the contract ('written from this document alone')
   - Detail: §15 says each scenario is 'written from this document alone'. But its format block and bullets cover only the v1.1 shape: name, covers, mode, policyPatch, input {evaluatedAt, claims, observations, grants, coverage, activity, fixed}, expect {ref, grade, ruleId, state, observationRefs, score, reasonCodes}, plus claimedAtEnd and reasonParams. scenario-schema.ts accepts much more, and the runner gives it meaning:
     - `events` (override, supersede, regrade, with `rejected` and `deleted`)
     - `assertIds` and `notes`
     - claim and observation `rowKey`, claim `observedAt`/`sourceKind`/`text`
     - grant `ref`/`updatedAt`/`accounts`, coverage `allCalendars`/`observerId`
     - activity `adapterSyncs`/`claims`
     - `input.grade` (mode grade)
     - expect `scope`, `agent`, `attributionScore`, `override`, `previousState`, `supersededBy`, `inputs`
     Only tests/golden/README.md documents these, and §15 never links it.
   - Evidence: `sed -n 358,419p docs/grading.md | grep -c <key>`: "events" 0, regrade 0, "rejected" 0, "deleted" 0, assertIds 0, "notes" 0, rowKey 0, inputs 0, previousState 0, supersededBy 0, attributionScore 0, allCalendars 0, adapterSyncs 0, input.grade 0. `grep -n "golden/README" docs/grading.md` → none. Fields are defined in tests/golden/scenario-schema.ts:179-368.
   - Suggested fix: Extend the §15 jsonc block and bullets to match tests/golden/README.md 'File format' (events and their regrade/rejected/deleted semantics, assertIds, notes, rowKey, input.grade, the expect lifecycle fields and inputs, grants in force), or make the README normative and link it from §15. Add a test (in scenarios.spec.ts or worked-examples.spec.ts) that every key of the Scenario schema appears as a code span in §15 or the linked README.
   - Verification: **RESIZED** to LOW. The omission is real. `sed -n 358,419p docs/grading.md | grep -c` gives 0 for events, regrade, rejected, deleted, assertIds, notes, rowKey, previousState, supersededBy, attributionScore, allCalendars and adapterSyncs, and there is no link to tests/golden/README.md.
     
     It is overstated as a contract gap:
     - The event semantics (regrade, override, supersede, regrade_stale, regrade_superseded, rejected-event rules) are specified in §8 (docs/grading.md:186-213; 7 mentions of 'regrade').
     - The JSON encoding is fully specified in tests/golden/README.md:35-115 ('File format'; events at :104, assertIds at :110).
     - tech_reviewer.md:36 asks for bus messages, tables, policy fields and grades to be documented, not the test file format. I checked: all 93 keys in policy/default.json appear in docs/grading.md.
     
     What is wrong is §15's claim 'written from this document alone' plus the missing link. That is documentation accuracy, so LOW.

6. **TECH-R6** [LOW] receipt.spec.ts is 462 lines → `extension/tests/unit/core/receipt.spec.ts:1`
   - Rule: tech_reviewer 'files <= 400 lines; split otherwise'
   - Detail: The file was 323 lines at 15176d3. The two perf commits pushed it over: 414 at 25dd3d0 and 462 at c5805d9. Its describe blocks split naturally: receiptId (93-156), inputsHash (157-222), memoisation 'remembered per object' (223-283), set-like arrays (284-329), uniqueById, reasons and buildReceipt (330-462).
   - Evidence: `wc -l extension/tests/unit/core/receipt.spec.ts` → 462. Line counts by commit (git show <c>:path | wc -l): 15176d3 323, d9303df 323, 25dd3d0 414, c5805d9 462, 0067c80 462.
   - Suggested fix: Move the hash-memoisation and set-like-array blocks (lines 223-329) to a new receipt-hash.spec.ts. Put the shared inputs()/canonicalParts helpers in a non-spec helper module (see TECH-R10) so the two files do not copy them.
   - Verification: **CONFIRMED**. `git show 0067c80:extension/tests/unit/core/receipt.spec.ts | wc -l` gives 462. The 400-line limit was applied to test files in Sprint 0 (reviews/sprint_0/tech.md:34 scanned extension/tests), so this is a real gap. A scan of every .ts file in `git diff --name-only 937c333..0067c80` finds only this file and normalize.property.spec.ts over 400.

7. **TECH-R7** [LOW] normalize.property.spec.ts is 475 lines → `extension/tests/property/normalize.property.spec.ts:1`
   - Rule: tech_reviewer 'files <= 400 lines; split otherwise'
   - Detail: The file grew from 372 lines to 475 in c5805d9, when the 'ASCII path equals the general folding' and 'dot-atom equals splitting on dots' reference properties (lines 275-339) were added for the perf pass.
   - Evidence: `wc -l` → 475. By commit: 02e5c53 284, 9b68181 361, d9303df 372, c5805d9 475, 0067c80 475.
   - Suggested fix: Move the two reference-equivalence describes (lines 275-339) and their arbitraries into normalize-reference.property.spec.ts.
   - Verification: **CONFIRMED**. `git show 0067c80:extension/tests/property/normalize.property.spec.ts | wc -l` gives 475. Same precedent as TECH-R6.

8. **TECH-R8** [LOW] 12 describe callbacks in Sprint 1 test files exceed 60 lines, against the standard this sprint's Decisions say was met → `extension/tests/unit/core/batch-inputs.spec.ts:95`
   - Rule: tech_reviewer 'Functions <= 60 lines', as this sprint applied it to describe callbacks (Decisions.md:366, 523, 563, 571, 676, 703, 771)
   - Detail: The Sprint 0 tech review did not count describe containers. This sprint chose to count them: Decisions [1.v14-core] (line 676) says 'every function or describe <= 60 lines', and [1.11] (line 771) says 'Long describe callbacks were split'. 12 remain over 60, 11 of them in files created this sprint. Either split them or record the exception once.
   - Evidence: TS compiler API scan (measure.cjs in my scratch dir):
     - 131 batch-inputs.spec.ts:95
     - 103 batch-orphans.spec.ts:88
     - 88 no-policy-literals.spec.ts:130
     - 84 conditions-finality.spec.ts:140
     - 78 batch-visibility.spec.ts:87
     - 78 conditions.spec.ts:131
     - 75 demo.spec.ts:58
     - 73 hash.spec.ts:53
     - 66 state-grace-full.spec.ts:134
     - 65 conditions-scope.spec.ts:72
     - 63 state-grace.spec.ts:79
     - 61 receipt.spec.ts:157
     All files are under tests/unit/core.
   - Suggested fix: Split each over-long describe into two topic describes, as Decisions [1.policy] did. Or add one Decisions entry stating that describe containers are exempt (the Sprint 0 precedent) and stop claiming otherwise in later entries.
   - Verification: **CONFIRMED**. My own TS-AST scan (desc.cjs) over all 222 Sprint 1 .ts files reproduces exactly the same 12 describe callbacks over 60 lines (131 batch-inputs.spec.ts:95 down to 61 receipt.spec.ts:157) and finds 0 non-describe functions over 60.
     
     The Decisions claims are contradicted by their own commits:
     - [1.5] Decisions.md:523 says 'Long describe blocks were split to stay at or under 60 lines', yet conditions.spec (78), conditions-finality (84), conditions-scope (65) and receipt.spec (61) were all added in 15176d3, the task 1.5 commit.
     - [1.v14-core] Decisions.md:676 says 'every function or describe <= 60 lines', yet batch-inputs (131) and batch-visibility (78) were added in 1af0a41.
     
     no-policy-literals' describe was already 76 lines at 937c333 (Sprint 0). LOW is right because Sprint 0's tech review did not count describes (reviews/sprint_0/tech.md:35).

9. **TECH-R9** [LOW] CHANGELOG [Unreleased] has nothing for Sprint 1 → `CHANGELOG.md:5`
   - Rule: tech_reviewer 'CHANGELOG updated under Unreleased'
   - Detail: Sprint 1 shipped:
     - the pure grading core: schemas, normalisation, redaction, candidates, features, grade, the state machine, UNASKED attribution, scope and spend, gradeBatch
     - the golden suite
     - perf gates and the serial perf pass
     - replay and `pnpm attest replay`
     - `pnpm check-docs` in lint
     - docs/grading.md v1
     - ledger types replaced by the core schemas
     None of it is in the changelog.
   - Evidence: `git diff 937c333..0067c80 -- CHANGELOG.md` → empty. CHANGELOG.md:5-37 lists only Sprint 0 items (scaffold, lint fences, logger, test rails, mandatory E2E, ledger, bus, policy, capture, options, CI).
   - Suggested fix: Add Sprint 1 bullets under [Unreleased] → Added (grading core modules, 94 golden scenarios, property and perf gates, `pnpm attest replay`, `pnpm check-docs`, docs/grading.md v1 with the state diagram) and → Changed (ledger and bus use src/core/schema types; `pnpm test` also runs the serial perf pass; `pnpm lint` runs check-docs).
   - Verification: **CONFIRMED**. `git diff --stat 937c333..0067c80 -- CHANGELOG.md` is empty. CHANGELOG.md:5-37 lists only Sprint 0 items. Mitigation: Sprint 0 also updated the changelog only in its close commit (892d160), so the closer can fix this in the normal flow.

10. **TECH-R12** [LOW] RESULTS.md predates the v1.4 grading changes, records no commit, and gates on wall time while the test gates on CPU → `bench/core.ts:385`
   - Rule: Hard Rule 12 (never report an unmeasured number); bench/core.ts header 'the gates measure what this bench measures'
   - Detail: bench/results/core-2026-10-02.json and RESULTS.md were last written in c5805d9. After that, 1af0a41 and 36fe223 changed the grading hot path (batch.ts, batch-grade.ts, batch-orphans.ts, grade.ts, attribution.ts and 12 more core files). The Progress Log line [1.v14] reports the HEAD gate as 1.38 s CPU, but RESULTS.md shows gradingMedianMs 1006.5 (wall) and gradingCpuMedianMs 1257.9 from older code. The result file has no commit SHA, so a reader cannot tell which code a number describes. The bench also decides gradingGatePassed on the wall median (line 385, and gatePassed at line 352), while tests/perf gates on the CPU median of 3 (Decisions [1.perf]). The same gate is computed two ways.
   - Evidence: `git log --format='%h %s' 937c333..0067c80 -- bench/results/core-2026-10-02.json RESULTS.md` → c5805d9, d15081e only. `git diff --stat c5805d9 0067c80 -- extension/src/core` → 17 files, +1282/-227. Receipt counts are stable: my scratch script bench-counts.mts on HEAD printed {"gradingReceipts":5845,"gradingVerified":1883,"gradingNotFound":1073,"gradingUnasked":844}, identical to RESULTS.md. Only the timings are stale. bench/core.ts:385 `gradingGatePassed: gradingMedianMs < GATE_MS` (wall).
   - Suggested fix: Re-run `pnpm bench` at sprint close and commit the result. Add the git commit SHA (passed in by run_bench.ts, which may shell out to git since bench is not core) and the node version to every result file. Compute gatePassed and gradingGatePassed from the CPU medians, matching the test gate, and say so in the RESULTS.md table.
   - Verification: **CONFIRMED**. - `git log 937c333..0067c80 -- bench/results RESULTS.md` gives only c5805d9 and d15081e.
     - After c5805d9, 1af0a41 changed 12 core files on the hot path, and `git diff --stat c5805d9 0067c80 -- extension/src/core` gives 17 files, +1282/-227.
     - bench/core.ts:352 `gatePassed: lookupMedianMs < GATE_MS` and :385 `gradingGatePassed: gradingMedianMs < GATE_MS` gate on the wall median.
     - tests/perf/grading.perf.spec.ts:157 gates on medianCpuMs, and Decisions.md:650 [1.perf] says 'CPU (stricter than wall) stays the metric', so the bench contradicts a logged decision.
     
     Correction to the fix: the node version is already in every result (bench/core.ts:353 `node: process.version`; RESULTS.md shows 'node | v22.14.0'). Only the commit SHA and the CPU-based gate flags are missing.

11. **TECH-R13** [LOW] Decisions.md carries workflow residue: verdicts, file lists, absolute machine paths and stale statements → `Decisions.md:780`
   - Rule: CLAUDE.md 'Decisions.md → every unspecified decision, dated, with the reason and the Hard Rule it protects'
   - Detail: Sprint 1 added 504 entries. Mixed in with real decisions are:
     - verification verdicts ('Verdict PASS' or 'Verdict FAIL' at 542, 616, 630, 683, 732, 772)
     - lists of files touched (429, 459, 636, 780)
     - absolute local paths (~/..., scratchpad) at 429, 458, 459, 548, 780
     - a list of out-of-ownership needs (779)
     - statements later events contradicted: 770 says 'Until the root script and CI wiring exist', but 757 added both; 232 still says pnpm/action-setup is pinned at v4.3.0, but ci.yml now pins the v5.0.0/v4.4.0 SHA (Dependabot 1bfdaf1)
     About 160 Sprint 1 entries name no Hard Rule or role rule. That makes the decision record harder to use, and the machine paths will be public when the repo opens (MANUAL Sprint 7).
   - Evidence: `grep -n -E "Verdict (PASS|FAIL)|Files changed by this verification|/private/tmp|~" Decisions.md` → lines 429, 458, 459, 542, 548, 616, 630, 636, 683, 772, 780. A heuristic count of Sprint 1 entries with no 'HR n', 'Hard Rule', 'n/a' or role-rule tag gives 160 of 504. Line 770 vs 757 as quoted. Line 232 vs .github/workflows/ci.yml:29 `pnpm/action-setup@fc06bc12... # v5.0.0` (gh api tags: v5.0.0, v5, v4.4.0).
   - Suggested fix: Move the verdicts, file lists and scratch paths into reviews/sprint_1/ (or delete them; git history keeps them). Strike or amend the stale lines with a dated follow-up entry. Add the Hard Rule (or 'none') to entries that lack one. Add a short check (in check-docs) that rejects absolute local paths in committed Markdown.
   - Verification: **CONFIRMED**. `grep -n -E "Verdict (PASS|FAIL)|Files changed by this verification|/private/tmp|~" Decisions.md` hits lines 429, 458, 459, 542, 548, 616, 630, 636, 683, 772 and 780.
     - My heuristic count finds 158 of 504 Sprint 1 entries with no HR, Hard Rule or role tag.
     - Lines 770 and 757 contradict each other as quoted.
     - Line 772 ('Verdict FAIL … tsc on tests/tsconfig.json fail') is also stale: `npx tsc --noEmit -p tests/tsconfig.json` in my 0067c80 mirror exits clean.
     
     Correction: line 232 is a dated 2026-10-01 [0.close] entry that was true when written. The SHA changed in Sprint 1 through Dependabot commit 1bfdaf1 (4.3.0 → 4.4.0; the same SHA is tagged v5.0.0). The fix is a dated follow-up entry, not an edit to the old one.

12. **TECH-R10** [LOW] 321 lines of identical test helpers are copied across Sprint 1 spec files → `extension/tests/unit/core/schema.spec.ts:270`
   - Rule: Test quality: helpers duplicated across test files; tech_reviewer 'shared helpers'
   - Detail: Decisions [1.7] and [1.contract-v1.2-impl] give the reason 'spec files do not import each other'. But a spec can import a non-spec helper module, as the suite already does with tests/golden/build.ts, tests/unit/core/demo-ledger.ts and tests/unit/ledger/fixtures.ts. The copies drift risk: for example, PROPERTY_TIMEOUT_MS is 30 s in five files and 60 s in two (TECH-R3), and the grade() test harness `run` exists in 17 variants.
   - Evidence: AST scan (dupes.cjs) of identical top-level helper bodies:
     - issuePaths ×6 (schema.spec.ts:270, schema-grading:245, schema-reasons:178, schema-receipt:279, schema-cross-checks:221, ledger/storage-shapes:61)
     - entry ×4 (grade.spec:71, grade-rules:73, grade-reasons:69, grade-adversarial:71)
     - claimOf ×3 and obsOf ×3 (grade.spec:44/57, grade-rules:46/59, grade-reasons:42/55)
     - activity ×3 (attribution*.spec)
     - issuesOf ×3 (policy-errors*, policy-shape)
     - gcd ×2 (golden/runner.ts:54, golden/scenario-schema.ts:163)
     Total: 321 duplicated lines beyond the first copy.
   - Suggested fix: Create tests/unit/core/support/{grade-harness.ts, schema-issues.ts, attribution-fixtures.ts, policy-edit.ts} (non-spec modules) and tests/golden/math.ts for gcd. Import them from the specs, and update the Decisions entries that justify the copies.
   - Verification: **REFUTED**. The duplication exists: the 6 issuePaths bodies are byte-identical (md5 46dcd7f3… ×6), and gcd appears in golden/runner.ts:54 and scenario-schema.ts:163.
     
     It is still not a gap under the brief:
     - It is a choice logged with reasons: Decisions.md:306 [1.0] ('importing one spec from another would re-register its tests'), :540 [1.6] and :563 [1.7] ('Helpers are duplicated because spec files do not import each other (Decisions [1.0] precedent)').
     - It breaks no Hard Rule or contract.
     - The checklist's duplication rule (tech_reviewer.md:17) covers adapter selector logic and adapters/base.ts, not test helpers.
     - The drift example (PROPERTY_TIMEOUT_MS 30 s vs 60 s) is not a copied helper; those are deliberate per-file values.
     - The copies are identical today, so no drift exists.
     
     An optional tidy-up at most.

13. **TECH-R11** [LOW] The graceElapsed unit tests target a wrapper export production never calls → `extension/tests/unit/core/conditions.spec.ts:210`
   - Rule: Test quality: tests must exercise the production path
   - Detail: src/core/conditions-coverage.ts:302 exports graceElapsed(claim, grant, coverage, policy). conditions.ts:54 re-exports it, but grading never calls it. grade() and gradeBatch use the Conditions.graceElapsed() method (conditions.ts:237-241), which can take a batch-shared `eligible` (batch-grade.ts:128). The wrapper is equivalent today, so nothing has drifted. Still, the 5 tests in the 'graceElapsed: the observers synced after the whole window' describe (conditions.spec.ts:210-245) cannot catch drift in the production method.
   - Evidence: `grep -rn graceElapsed src entrypoints | grep -v src/core/conditions\|grade-reasons\|policy-schema` → no output: no production caller. Mutant in the scratch mirror: Conditions.graceElapsed() switched from graceSyncMs to verifiedSyncMs (dropping the afterClaimMin bound). `vitest run conditions.spec.ts -t "graceElapsed: the observers"` → 5 passed. The mutant is caught elsewhere by 8 tests: golden 43 and 73, grade-golden 43 and 73, grade-adversarial 'graceElapsed from a sync at end(p,t)+after...', and three state-grace tests.
   - Suggested fix: Rewrite those 5 cases to build a Conditions (or call grade()) and assert on c.graceElapsed() or the ruleId. Then remove the wrapper export, or make Conditions.graceElapsed() delegate to it so there is one implementation. Coordinate with the part 1 core reviewer, who owns the export.
   - Verification: **REFUTED**. (1) The wrapper is not test-only API. docs/grading.md:338 (§13 Module contracts) lists `graceElapsed(claim, grant, coverage, policy)` as a conditions.ts export, and the doc is the source of truth. The suggested fix of removing the export would break the contract.
     
     (2) The wrapper tests do cover production logic. Both the wrapper (conditions-coverage.ts:302-309) and Conditions.graceElapsed() (conditions.ts:237-241) compose the same graceSyncMs and syncedSources helpers. I mutated the shared graceSyncMs in mirror2 (`if (isCalendarType(claim.type) || graceMs > 0) return graceMs;`, which drops the afterClaimMin bound used by production). Running `vitest run tests/unit/core/conditions.spec.ts -t graceElapsed` then fails 'non-calendar: needs a sync ≥ end + afterClaimMin (14:48), inclusive'.
     
     (3) Only the method's 3-line memoised composition is outside these 5 tests, and the reviewer's own evidence shows 8 other tests kill a mutant there.
     
     No drift and no untested path, so not a gap.

### TESTS WRITTEN

- Nothing was written in the shared tree.
- Scratch probe scenario (not committed): scratchpad/review1/tech2/95-regrade-new-evidence.json. It proves TECH-R4.
- Scratch mutant (not committed): Conditions.graceElapsed() switched to verifiedSyncMs in the mirror at scratchpad/review1/tech2/mirror. It proves TECH-R11.
- Scratch analysis scripts: measure.cjs (file and function sizes), timeouts.cjs (per-test timeouts), dupes.cjs (duplicated helpers), weak.cjs (weak assertions), bench-counts.mts (bench receipt counts on HEAD). All in scratchpad/review1/tech2/.

### ADVERSARIAL VERIFICATION

I checked all 13 tech-rest gaps (TECH-R1 to R13) against commit 0067c80. All my probes, mutants and the coverage run used scratch mirrors exported with `git archive 0067c80` under scratchpad/review1/verify-tech-rest/. I wrote nothing in the shared tree.

Verdicts:
- **Confirmed (8):** R1 CRITICAL, R3 MEDIUM, R4 MEDIUM, R6 LOW, R7 LOW, R8 LOW, R9 LOW, R12 LOW, R13 LOW.
- **Resized (2):**
  - R2 MEDIUM → LOW. src/core coverage at 0067c80 is 98.41% lines, 97.35% statements and 91.58% branches, so the Gate's 95% holds today. Only a regression threshold is missing.
  - R5 MEDIUM → LOW. The event semantics are in §8, and the file encoding is in tests/golden/README.md. Only §15's "written from this document alone" claim and a missing link are wrong.
- **Refuted (2):**
  - R10: the duplicated helpers are a choice logged with reasons in Decisions.md:306, 540 and 563. They break no Hard Rule or contract, and the duplication rule in tech_reviewer.md:17 covers adapter selector logic only.
  - R11: graceElapsed(claim, grant, coverage, policy) is the documented §13 contract export (docs/grading.md:338). Its tests do catch a mutant in the graceSyncMs helper that production shares.

Corrections inside confirmed gaps:
- R3: the claim that "no 300_000 exists in tests/" is wrong. grade.property.spec.ts:49 has it, and PROPERTY_TIMEOUT_MS is defined in 11 files, not 6.
- R12: the bench result already records the node version (bench/core.ts:353).
- R13: line 232 was true on its own date.
- R1: a misspelled src/core glob would already fail the lint fence tests, which lint a virtual src/core/probe.ts through the real config.

One new gap (TECH-VR1): features-golden.spec.ts breaks score ties by occurredAt. §8 breaks them by observation id. A probe scenario passes golden.spec and grade-golden but fails features-golden.

Note: a concurrent reviewer has uncommitted edits in the shared tree to features-golden.spec.ts (fixing R4 and VR1) and to policy-hash.spec.ts (adding a 60 s timeout, part of R3). They are not in 0067c80, so these gaps still stand for the sprint range.

Gaps the verifier found that the review missed:

1. **TECH-VR1** [MEDIUM] features-golden breaks score ties by occurrence time, but §8 breaks them by observation id, so its cp.* check fails falsely on valid scenarios → `extension/tests/unit/core/features-golden.spec.ts:94`
   - Rule: Test quality: fragile tests and oracles that contradict the contract (brief item 'features-golden.spec.ts may be fragile'); docs/grading.md §8 'grade's best candidate is the highest exact score, ties broken by observation id'; qa_tester rule 10
   - Detail: best() (lines 94-104) sorts candidates by (occurredAt instant, id) and keeps the first top score. Its comment says this matches how 'grade() orders them (§3)'.
     
     §8 v1.3 and grade-best.ts `beats` (lines 129-136) say otherwise: equal scores go to the lower observation id, whatever the occurrence order. Golden 82 was written to pin exactly this difference.
     
     Check 2 then compares the cp.* reason codes of the wrong candidate with the receipt's cp.* codes. Any valid scenario with tied best candidates that differ in cp.* codes will fail. That happens when the later-occurring candidate has the lower id and carries a different cp code, for example a +tag address and a same-domain address with equal scores. Today the suite passes only because no tied scenario has differing cp codes: in golden 82 both tied observations carry the same address.
     
     TECH-R4 covers the evaluatedAt filter in the same file, not this tie-break.
   - Evidence: I wrote the probe 97-tie-b.json (saved in scratchpad/review1/verify-tech-rest/) and ran it in a clean `git archive 0067c80` mirror.
     
     The probe:
     - c1 priya@company.com 'Q3 deck' at 14:02.
     - o1 priya+news@company.com at 14:03 (cp.plus_tag).
     - o2 raj@company.com at 14:02 (no cp code).
     - Both candidates score 11/18 (tp 1, ce 0, cd 1, subject 1).
     - The expectation, from §8's tie by id, is o1, PARTIAL, 11/18, reasonCodes [match.best, cp.plus_tag].
     
     Result of `npx vitest run tests/golden/golden.spec.ts tests/unit/core/features-golden.spec.ts tests/unit/core/grade-golden.spec.ts -t 97-tie-b`: 3 passed, 1 failed.
     - golden.spec and grade-golden accept the expectation.
     - features-golden check 2 fails with 'AssertionError: expected [] to deeply equal [ 'cp.plus_tag' ]' at features-golden.spec.ts:170, because best() picked o2, which occurred earlier.
     
     The companion probe (times swapped) confirms that grade() chose the higher-occurring, lower-id candidate: golden.spec reported 'c1 observationIds: expected ["o1"], got ["o2"]'.
     
     The committed code at 0067c80 reads: line 94 `/** The highest score; among equal scores the first by (occurredAt instant, id), as grade() orders them (§3). */` and line 97 `(a, b) => instantMs(a.occurredAt) - instantMs(b.occurredAt) || (a.id < b.id ? -1 : 1)`. A concurrent reviewer's uncommitted shared-tree edit changes this to sort by id, which corroborates the defect, but it is not in the sprint range.
   - Suggested fix: In best(), order candidates by observation id only (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`) and keep the first strictly higher score, as grade-best.ts `beats` does. Fix the comment to cite §8 ('ties broken by observation id'). Add a golden scenario like 97-tie-b, with tied best candidates that differ in cp.* codes and whose lower id occurred later, with assertIds pinning the id order, so the cross-check is exercised.

Checklist corrections:

- 'Exported graceElapsed wrapper vs conditions' is marked GAP and should be PASS. graceElapsed(claim, grant, coverage, policy) is the §13 contract export (docs/grading.md:338). Its tests kill a mutant in the graceSyncMs helper that production shares (conditions.spec.ts 'non-calendar: needs a sync ≥ end + afterClaimMin' fails in mirror2). See TECH-R11.
- 'Helpers duplicated across test files' is marked GAP and should be PASS (logged choice). Decisions.md:306, :540 and :563 record the duplication with reasons, and tech_reviewer.md:17 limits the duplication rule to adapter selector logic. See TECH-R10.
- 'Fragile tests (features-golden.spec.ts)' is GAP but incomplete. Besides the evaluatedAt filter (TECH-R4), best() at features-golden.spec.ts:94-97 breaks ties by occurredAt instead of observation id (§8). Probe 97-tie-b gives a false failure. See TECH-VR1.
- 'CI or any script enforces the Gate's core coverage >= 95%' is GAP, but the evidence implies the Gate is unverified. Measured at 0067c80 in my mirror (4,954 tests passed): src/core Lines 98.41% (3095/3145), Statements 97.35%, Branches 91.58%, Functions 99.09%. The Gate holds; only a CI threshold is missing (LOW).
- 'Per-test timeouts on heavy tests' is GAP and stays GAP, but part of its evidence is wrong. A 300_000 timeout exists: tests/property/grade.property.spec.ts:49 `const PROPERTY_TIMEOUT_MS = 300_000;`. PROPERTY_TIMEOUT_MS is defined in 11 files, not 6.
- 'docs/grading.md §15 documents the golden file format' is GAP but oversized. The event semantics are in §8 (docs/grading.md:186-213), and the encoding is in tests/golden/README.md:35-115. Only the 'written from this document alone' claim and the missing link are wrong (LOW).
- Not checked by the reviewer: 'Bundle size per entrypoint reported; popup < 150 KB gzipped' (tech_reviewer.md:33). Status PASS, measured with gzip -9 from extension/.output/chrome-mv3, built 13:28. That build predates commits 1af0a41 and 36fe223, so the figures are approximate. popup ≈ 14.9 KB gzipped (popup chunk 375 B + wxt plugins 5,749 + jsxRuntime 4,695 + CSS 4,011); options ≈ 41.7 KB; background.js 40,952 B. Sprint 1 made ledger and bus import src/core/schema, and the popup stays about 10x under budget.
- Not checked by the reviewer: 'Every new … policy field … documented in docs/grading.md' (tech_reviewer.md:36). The reviewer checked rule ids only. Status PASS: a script walking policy/default.json finds all 93 keys present in docs/grading.md.
- Not checked by the reviewer: 'No hardcoded hosts, ids, or URLs' (tech_reviewer.md:16) for the non-core Sprint 1 code. Status PASS: `grep -n "https\?://"` over scripts/check-docs*.ts, bench/*.ts, tests/tools/attest-*.ts, src/ledger/*.ts and src/bus/*.ts finds nothing.
- 'No any / as unknown as / unexplained !' is PASS, and it holds more broadly than the reviewer scanned. A TS-AST scan of all 222 Sprint 1 .ts files, including tests and src/core, finds 0 NonNullExpression, 0 `any` and 0 `as unknown as`.
- 'Functions <= 60 lines' is PASS and confirmed over all 222 Sprint 1 .ts files, including src/core: 0 non-describe functions over 60.

### COMMANDS RUN

- `git diff --name-only 937c333..0067c80 | grep -v '^extension/src/core'` → OK: Lists the Sprint 1 files outside core: ci.yml, Decisions, RESULTS, bench/*, build_spec, docs/grading.md, docs/assets, extension package.json, src/bus and src/ledger, 94 golden JSON files plus golden infra, tests/perf, tests/property, tests/tools/attest-*, tests/unit/**, vitest.perf.config.ts, root package.json, policy, scripts/check-docs*, sprint files.
- `node measure.cjs files.txt (TS compiler API over 162 Sprint 1 .ts files outside core)` → 2 files > 400, 12 describe callbacks > 60, 0 functions > 60: normalize.property.spec.ts 475, receipt.spec.ts 462. Describes are listed in TECH-R8.
- `git show <commit>:<file> | wc -l over the Sprint 1 commits` → Growth traced: receipt.spec.ts went 323 → 414 (25dd3d0) → 462 (c5805d9). normalize.property.spec.ts went 372 → 475 (c5805d9).
- `npx vitest run tests/property tests/unit/core/no-policy-literals.spec.ts tests/unit/test-layout.spec.ts tests/unit/docs tests/unit/tools tests/golden --maxWorkers=3 --reporter=json` → 1,682 passed / 0 failed in 76.8 s; load average 23 → 64: Slowest: replay.property 49.7 s, grade.property 16.9 s and 12.2 s (all with timeouts). Heaviest without a timeout: hash.property.spec.ts:25 1,893 ms; normalize.property.spec.ts:288 1,029 ms.
- `npx vitest run tests/unit/core --maxWorkers=3 --reporter=json` → 3,628 passed / 0 failed; load average 95 → 151: Without a timeout: policy-hash.spec.ts:113 4,088 ms; no-policy-literals.spec.ts:170 1,848 ms; batch-determinism.spec.ts:130 1,645 ms and :102 1,357 ms.
- `npx vitest run tests/unit/lint --reporter=json` → 245 passed / 0 failed; load average ~55: Sprint 0 files with no timeouts. Max 2,172 ms (fences-scopes.spec.ts, fetch/sendBeacon test).
- `node timeouts.cjs over property, unit/core, golden, docs and tools specs` → 1,119 NONE; 35×60_000; 23×PROPERTY_TIMEOUT_MS; 8×600_000; 4×TIMEOUT_MS; 3×COMPILE_TIMEOUT_MS; 2×30_000; 1×120_000: PROPERTY_TIMEOUT_MS is defined in 6+ files as 30_000 or 60_000.
- `node dupes.cjs over Sprint 1 test .ts files` → 321 duplicated helper lines: issuePaths ×6, entry ×4, claimOf/obsOf ×3, activity ×3, issuesOf ×3, gcd ×2, ...
- `node weak.cjs over Sprint 1 spec files` → No assertion-free test; 1 same-sides toBe (hash.spec.ts:209); toBeDefined only as narrowing guards: No gap raised.
- `python3 golden provenance check over git history (expect changed without notes) and over the notes` → 0 violations: 94/94 scenarios have notes; every expected score appears in its notes. f936621, 98a7b6f, 73cb59c and ad6cb88 never changed expect without notes.
- `npx tsx scripts/check-docs.ts` → exit 0: check-docs: OK (4 files, 123 relative links, 13 pnpm commands, 14 rule ids).
- `sed -n 358,419p docs/grading.md | grep -c <field> for 14 golden fields` → 0 for every v1.2-v1.4 field: events, regrade, rejected, deleted, assertIds, notes, rowKey, inputs, previousState, supersededBy, attributionScore, allCalendars, adapterSyncs, input.grade.
- `grep -n -i coverage package.json extension/package.json extension/vitest*.config.ts .github/workflows/ci.yml` → Only the @vitest/coverage-v8 devDependency: No coverage script, threshold or CI step.
- `grep -rn 'Date.now|Math.random|getRandomValues' tests/; grep -rnE 'Date\.now|Math\.random|getRandomValues|\bfetch\b|new Date\(\)' src/core` → Tests: only ESLint synthetic probes. src/core: clean: No grep test over the real src/core tree (TECH-R1).
- `Scratch mirror: vitest run golden.spec, features-golden, grade-golden, redact-golden, batch-determinism, scenarios, checks, v14-rules with probe 95-regrade-new-evidence.json` → Only features-golden fails ('expected null to be 1/1'): The golden runner accepts the scenario. The other failures are the expected ids.json diff and one mirror-only agents/ path.
- `Scratch mirror: mutate Conditions.graceElapsed() to verifiedSyncMs; vitest run conditions.spec -t 'graceElapsed: the observers'; vitest run tests/unit/core tests/golden` → Wrapper tests 5/5 pass; the mutant is killed by 8 other tests: Killed by golden 43 and 73, grade-golden 43 and 73, grade-adversarial, and state-grace ×3. The other failures are mirror environment artifacts (docs, entrypoints, prettier).
- `npx tsx bench-counts.mts (HEAD workload counts, no timing, no writes)` → {gradingReceipts 5845, Verified 1883, NotFound 1073, Unasked 844}: Identical to RESULTS.md. Its timings come from c5805d9, before 1af0a41 and 36fe223 changed 17 core files.
- `git log --format='%h %s' 937c333..0067c80 -- bench/results/core-2026-10-02.json RESULTS.md` → c5805d9, d15081e: RESULTS.md was not regenerated after the v1.4 core changes.
- `gh api repos/pnpm/action-setup/tags (filter SHA fc06bc12...)` → v5.0.0, v5, v4.4.0: The ci.yml comment is correct; Decisions.md:232 is stale (v4.3.0).
- `git status --short (end of review)` → Only `?? extension/tests/golden/timezones.spec.ts`: That file is not mine (another concurrent reviewer). I wrote nothing in the tree.

