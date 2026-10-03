# Grading — how Attest decides

**Who this is for:** anyone who wants to know exactly why a receipt says VERIFIED, PARTIAL, NOT FOUND, UNASKED, OVER SCOPE or UNVERIFIABLE, and anyone changing `src/core`.
**What you'll know after:** every grade, every rule in `policy/default.json`, every feature, the windows, the receipt state machine, and how `attest replay` proves a receipt.

> Status: **v1 of the grading reference, on the v1.7 Sprint 1 contract.** The contract was revised after three adversarial reviews (v0: 9 blockers; v1: 7; v1.1: 3; all fixed) and the clarifications raised while implementing waves A–C (schemas, normalisation, policy, golden scenarios, features, redaction, candidates, grade, state, attribution, scope, batch). It was written before the code (sprint 1: "write scenarios first"). Task 1.11 added the contents list, the state-machine diagram (§8), the replay procedure (§9) and the worked examples (§16), and changed no rule, condition, definition or number. The wave D integration then aligned four points with the code and logged them in Decisions.md: UNASKED finality is measured from the same anchor as attribution (§7), a superseded receipt is never regraded (`regrade_superseded`, §8), replay compares every computed receipt field and each observation's `contentHash` (§9), and the §3 and §13 `gradeBatch` signatures match `batch.ts`.
>
> **v1.6** is the Sprint 1 review close (Decisions.md, Sprint 1 close entries). Rules it changed: text is read as Unicode 15.0 reads it, on every engine, and a lone surrogate reads as U+FFFD (§11 *Unicode baseline*, §10, §14 item 8); every grading entry refuses a policy object `loadPolicy` did not return, and the loader refuses a rule that concludes a grade without naming its evidence, and a `thresholds.partial` of 0 bp (§3, §6, §5.3); a score condition (`bestScoreGte`, `bestScoreLt`) is not applicable to a claim that is never scored (§6.1); `grade` refuses a candidate §4.1 could not have returned (`foreign_candidate`, §3); a candidate and an orphan come only from a source the policy lists for the observation's type, by one predicate (`fromRelevantSource`) in `gradeBatch` and `replay`: a row from another source neither verifies a claim nor accuses an agent (§4.1, §3, §9); every pre-assignment carries the batches it is in force in, derived by one rule (`preAssignments`, batch-fixed.ts) for `gradeBatch` and `replay`, and an override releases or takes an observation only in batches evaluated strictly after its `at` (§3, §4.3, §9); a claim with no currency is counted in `spendCurrency` by the cumulative ceiling and by `priorSpendCents` (§6.1, §6.3); a claim never counts its own id in its prior spend (§6.3); `gradeBatch` adds the graded claims `activity.claims` omits to the spend and adjacency history (§3); `project` refuses a row whose allowlisted value fails its field schema or is held by a getter, a setter or a prototype, the ledger refuses a row `project` could not have returned, keeps the earliest `observedAt` of a fact seen twice (v1.7 refuses the earlier sighting instead, below) and refuses a claim or observation that differs from the stored one under the same `rawHash` or `contentHash` in anything but `observedAt` (`id_conflict`), and counterparty, merchant and subject hint are one line (§10, §13); a health reason is a reason code and an adapter, observer or extractor id is a short token, never text (§13). For inputs that met v1.5, grades change only in six cases: a currency-less spend claim whose earlier spend breaks the ceiling (now OVER_SCOPE); a spend claim whose id an earlier-claimedAt copy in the history also holds (its prior spend no longer counts that copy); a row from a source the policy does not list for its type (never a candidate, never an orphan); a claim that is never scored, under a policy that orders a rule naming `bestScoreLt` before the rule that catches such a claim (the shipped order is unaffected: `no_target`, `underspecified` and `no_coverage` come first); text holding a code point that Unicode 15.0 does not assign or that a later version reclassified (now read as Chrome 120 reads it, on every engine); and text in which an invisible or nonspacing mark separates two lone surrogate halves (each half now reads as U+FFFD on every engine, never as the character the halves would form). Wording it corrected to match the code: `amountAboveCeiling` is false, never not applicable, within its guard (§6.1); `isFinalizable` takes one `FinalityInput` object (§8, §13); §13 lists the new modules and their errors; §15 now documents every key of the golden file format; §3 states what the background owes a batch (Sprint 3.6, 4.3).
>
> **v1.7** is the third Sprint 1 review close (Decisions.md, `[1.close-r3]` entries). Rules it changed: the ledger never rewrites a stored claim or observation. An earlier sighting of a stored hash is refused (`late_sighting`), replacing v1.6's keep-the-earliest merge. A new row's `observedAt` is set where it is written, no earlier than the writer's now and after the last recorded batch instant, and a batch records its instant with `recordBatchInstant` before it reads (§3, §10). A claim's `extractor` is not compared under its rawHash (§10). `Request.conversationId` is a vendor id token, and scopes and allowlist entries are one line (§13). Batch instants are strictly increasing: `gradeBatch` refuses a claim pre-assignment from a grading at or after `evaluatedAt` (`stale_evaluated_at`), and `claim_fixed` names only a pre-assignment that has not ended (§3). A revert carries its instant (`revert({at})`) and never erases what a batch saw: the receipt keeps the override in `reverted`, the override stays in force for the batches up to its `revertedAt` (pre-assignments gain `released` spans, and `until` now marks only the end of a reverted override from PENDING), and `regrade` refuses a receipt computed while a reverted override held the subject (`regrade_held`) (§3, §4.3, §7, §8, §9). The policy loader refuses an `unasked.threshold` of 0 bp (§5.3). Grades change for no v1.6 input in a ledger where no override was reverted (no revert caller ships before Sprint 4.3); the ledger and `gradeBatch` now refuse the out-of-order writes and batches that would have made replay fail. Wording it added: what the background owes a batch (§3), what the fences on `src/core` catch and what they cannot (§14 items 8 and 9), and the escaping of the file name `attest replay` echoes (§9).
>
> Where this file and the code disagree, the code is wrong until this file is changed by a reviewed commit. Every deviation from build_spec §7 is listed in §14 and in Decisions.md.

## Contents

1. [The shape of the problem](#1-the-shape-of-the-problem)
2. [Grades and states](#2-grades-and-states)
3. [Inputs](#3-inputs)
4. [Candidates](#4-candidates-candidatests): the window, retrieval, one-to-one assignment
5. [Features and score](#5-features-and-score-featurests): every feature, applicability, the exact score
6. [Rules](#6-rules-gradets-conditions-in-conditionsts): every condition, the default rule order, cumulative spend, reasons
7. [UNASKED](#7-unasked-attributionts): attribution signals, always "likely"
8. [State machine](#8-state-machine-conditionsts-decides-finality-statets-applies-events), with the [diagram](#receipt-state-diagram)
9. [Replay](#9-replay-replayts) and the [replay procedure](#replay-procedure)
10. [Ids and hashes](#10-ids-and-hashes-hashts)
11. [Normalisation](#11-normalisation-normalizets)
12. [Policy keys](#12-policy-keys-version-2): every number in `policy/default.json`
13. [Module contracts](#13-module-contracts-sprint-1)
14. [Deviations from build_spec §7](#14-deviations-from-build_spec-7-all-in-decisionsmd-sprint-1)
15. [Golden scenarios](#15-golden-scenarios-testsgolden): the file format and the ReasonCode table
16. [Worked examples](#16-worked-examples): the 12 mandatory golden scenarios and the §2 demo, with exact arithmetic, and [where each rule fires](#1615-where-each-rule-fires)

## 1. The shape of the problem

An agent **claims** it did something (a `Claim`, read from the agent's own page). The user's own Gmail and Calendar tabs show what actually happened (`Observation`s). Attest matches claims to observations and issues one `Receipt` per claim, plus a receipt for each action nobody claimed that an agent likely did (UNASKED), plus one per permission an agent holds beyond what the user declared.

Everything in `src/core` is a pure function: no clock, no randomness, no I/O, no DOM, no `chrome.*`, no model, no `Intl`, no locale (Hard Rule 4). Time enters only as data (`Coverage.evaluatedAt`). **No grade is ever decided by floating-point arithmetic** (§5.3).

## 2. Grades and states

| Grade | Means | Never means |
|---|---|---|
| VERIFIED | Independent evidence matches the claim with score ≥ `thresholds.verified`. | "The agent told the truth" in any wider sense. Verified = matched independent evidence. |
| PARTIAL | Some evidence matches (score ≥ `thresholds.partial`), not enough to verify. | A soft fail. It names what matched and what did not. |
| NOT_FOUND | Every relevant observer saw the **whole** claim window after the grace period, and nothing matched. | "Not found yet". Before grace, or with partial coverage, the grade is never NOT_FOUND (Hard Rule 5). |
| UNASKED | An action happened that no claim explains, and attribution signals say an agent **likely** did it. | Proof of who did it (Hard Rule 7). Every UNASKED receipt carries `attribution: "likely"`. |
| OVER_SCOPE | The claimed action is outside the user's Grant (type, counterparty, spend), or the agent holds a permission the user did not declare. | That the action was harmful. |
| UNVERIFIABLE | Attest could not see enough to judge: no observer covers the type, the tab was not open over the window, coverage was partial, or the claim is too vague to match. | Anything about the agent (Hard Rule 5). |

States: `PENDING` (still checking), `FINAL`, `USER_OVERRIDDEN` (§8). While the rule outcome is `PENDING`, the receipt's `grade` field holds `UNVERIFIABLE` as a placeholder (it is the only grade that claims nothing), and `ruleId` is `pending`. The UI shows PENDING as "checking", never as a grade, and counts (digest, telemetry) exclude PENDING receipts.

## 3. Inputs

```
grade(claim | null, candidates, grant, policy, coverage, context) → Receipt          (grade.ts)
gradeBatch(claims, index, grants, policy, coverage, activity, fixed) → Promise<{receipt, inputs}[]>   (batch.ts; fixed: {observationId, claimId | null, after, until?, released?}[], null = taken; a pair is in force where after < evaluatedAt ≤ until and evaluatedAt lies in none of its released spans (from, to], §4.3)
```

`gradeBatch` is the **only** path from the background to receipts: it retrieves candidates, scores every eligible pair, assigns observations (§4.3), computes cumulative spend (§6.3) and attribution (§7), then calls `grade` per claim, per orphan and per scope subject (§6.1). `grade` alone is used by tests and replay. `gradeBatch` grades exactly the PENDING `claims` it is given, except that a claim with `observedAt > evaluatedAt` gets no receipt (it is ignored, below); `priorSpendCents` and attribution read `activity.claims`, which holds every claim of the user within retention, FINAL and USER_OVERRIDDEN included. `gradeBatch` also adds every graded claim (first seen by `evaluatedAt`) whose id `activity.claims` does not list, so a caller that omits the PENDING claims still gets the cumulative ceiling and adjacency suppression (§7); an id in both counts once (the `activity.claims` copy), and never toward the claim that holds that id (§6.3). It returns `{receipt, inputs: {grant, context, policyHash}}[]` (coverage is the batch's own) so the caller can store `receiptInputs` for replay, for claim receipts and for the claim-less receipts whose matched rule concludes UNASKED (orphans) or OVER_SCOPE (observed scopes); any other claim-less outcome yields no receipt. The grant in force for an agent is the one with the latest `updatedAt ≤ evaluatedAt`; none, or two at the same instant, throws `BatchError` (`missing_grant`, `ambiguous_grant`). **Orphans** are the observations from a source the policy lists for their type (`policy.sourcesByType[type]`, the relevant sources of §6.1 that §4.1 holds candidates to) whose `occurredAt` lies inside a coverage interval of their own source (with `lastSyncAt ≤ evaluatedAt`), that no claim was assigned and that none is taken. An observation from a source the policy does not list for its type is neither a candidate (§4.1) nor an orphan: evidence the type's coverage never reads neither verifies a claim nor accuses an agent (Hard Rule 5). `gradeBatch` and `replay` decide this with one predicate, `isOrphanCandidate` in `batch-orphans.ts`. `gradeBatch` is blind to stored receipt states: for an orphan whose stored UNASKED receipt is FINAL or USER_OVERRIDDEN, the caller keeps the stored row and discards the regrade. `fixed` is `preAssignments(storedReceipts)` (batch-fixed.ts, §4.3); `gradeBatch` fixes the pairs in force at `evaluatedAt`. It throws `BatchError('claim_fixed')` for a graded claim named by a pair that has not ended by `evaluatedAt` (no `until`, or `until ≥ evaluatedAt`), in force or not. It throws `BatchError('stale_evaluated_at')` for a claim pair whose `after` (a grading of its claim) is at or after `evaluatedAt`: that is a batch stamped at an instant already graded, in which the earlier batch's FINAL evidence would be free again. Taken pairs may start later: an override stamped after `evaluatedAt` but read by the batch. `grade` sets `state` and `finalAt` itself (finality rules live in `conditions.ts`, §8); `state.ts` only applies user and lifecycle events to stored receipts.

- `claim`: the extracted claim, or `null` (UNASKED and scope-diff receipts).
- `candidates`: observations for this claim after assignment. Each must be one §4.1 would return for the claim: of the claim's type, from a source `policy.sourcesByType[claim.type]` lists, with `occurredAt` inside the claim window (a calendar claim without `targetAt` has none), and for `calendar.created` with `observedAt ≥ start(p,t) − beforeClaimMin`. `grade` refuses any other with `GradeError('foreign_candidate')` rather than grading a caller's bug into a FINAL receipt (Hard Rules 5, 6). A candidate with `observedAt > evaluatedAt` is ignored (below), not refused. `grade` sorts them by (`occurredAt` instant, `id`) itself.
- `grant`: the Grant for the claim's agent in force at `coverage.evaluatedAt`.
- `policy`: the loaded, frozen policy: an object `loadPolicy` returned, never a copy, spread, clone or hand-built object (a copy keeps the original's `policyHash` and the parts its memos are keyed on). `grade`, `gradeOrphan`, `gradeClaim`, `gradeBatch`, `features`, `pairScorer`, `RowScorer`, `isAssignable`, `applicableFeatures`, `isUnderspecified`, `attribute`/`attributor`, `replay` (for every policy in the snapshot) and the ledger's `upsertObservation` (§10) throw `PolicyError('policy_not_loaded')` for any other object (Hard Rules 4, 6). Its `policyHash` (SHA-256 of its canonical JSON) is stored on every receipt.
- `coverage = { evaluatedAt: IsoTs, observers: ObserverCoverage[] }`, where

  ```
  ObserverCoverage = { observerId, source: 'gmail.sent' | 'gmail.receipt' | 'gcal.event',
                       lastSyncAt, windowStart, windowEnd, accountHash?, allCalendars? }
  ```
  `windowStart..windowEnd` is the span of time the pass could see. **Observer obligations (Sprint 2):** a coverage entry exists only for an extraction pass whose `health()` was OK, and is written atomically with that pass's observations (Hard Rules 5, 6). A pass in which `project` refused a row (`RedactError`) or the ledger refused an observation (`LedgerError('invalid_input')`) is DEGRADED and writes no coverage entry for its window: a refused row is not evidence of absence (Hard Rules 5, 6). For a newest-first list whose pass saw the head of the list (Gmail Sent, first page), `windowEnd = lastSyncAt`; otherwise `windowEnd` = the newest visible row. A `gmail.receipt` interval asserts that every message in the span from a sender in the receipt-parser registry (`policy.receiptMerchants`) was parsed. A `gcal.event` entry sets `allCalendars: true` only if every calendar was visible.
- `context` (**required**, hashed): `{ priorSpendCents: number, attribution?: Attribution, scope?: { observed: string } }`. `Attribution` carries `adapterLastSyncAt` (the attributed agent's latest adapter sync) so `grade` can decide UNASKED finality.

`Coverage.observers` and each `Activity` list hold at most `SCHEMA_LIMITS.GRADING_INPUT` entries; the ledger readers (Sprint 2.6, 3.5) return the entries that overlap the batch windows. Entries are filtered deterministically before use: coverage entries with `lastSyncAt > evaluatedAt`, observations and claims with `observedAt > evaluatedAt`, adapter syncs with `lastSyncAt > evaluatedAt`, and activity sessions, idle intervals and entries after `evaluatedAt` are ignored, so replay at an earlier instant sees exactly what grading saw.

**Background obligations (Sprint 3.6, 4.3).** The background stamps `evaluatedAt` first. Then, in one IndexedDB readwrite transaction over the claims, observations, receipts and `meta` begun after that stamp, it reads the PENDING claims and the stored receipts, passes `preAssignments(receipts)` as `fixed`, grades, and writes the results; a background that grades outside that transaction reruns the batch with a new `evaluatedAt` whenever a receipt it read changed before its write. Inside that transaction, before it reads anything, the batch records its `evaluatedAt` with `recordBatchInstant(db, evaluatedAt)` (src/ledger/batch-instant.ts). An instant at or before the last recorded one throws `LedgerError('batch_out_of_order')`, and the batch does not run. Claims and observations are stored only through `upsertClaim` and `upsertObservation`, which set `observedAt` where the row is written (§10). So no claim or observation is ever stored with `observedAt` ≤ the `evaluatedAt` of a batch that did not read it, a row sighted before a batch but delivered after it is stored after that batch's instant, and a stored row's `observedAt` never changes: the first stored sighting is kept, a later one changes nothing, and an earlier one that arrives later is refused with `LedgerError('late_sighting')` (§10). An override's `at` is stamped inside the readwrite transaction that writes the override. Batches never run concurrently. Then every override stamped before a batch's `evaluatedAt` is in what that batch read; one stamped at or after it releases or takes nothing in that batch, on either side; a claim overridden from PENDING while a batch ran is left out of it with its stored evidence fixed; and replay rebuilds exactly the batch that ran (Hard Rule 4). Each batch's `evaluatedAt` is strictly after the previous batch's. A revert's instant is stamped inside the readwrite transaction that writes it, like an override's `at`. The background passes a PENDING claim to a batch only when `gradedAt(receipt, evaluatedAt)` (batch-fixed.ts) admits it: a claim whose reverted override is still in force (`revertedAt ≥ evaluatedAt`) is left out like an overridden one. A PENDING claim-less row the batch no longer produces is deleted unless it holds reverted overrides (§8). A superseded row is never regraded.

**Hashes.** `inputsHash` = SHA-256 of the canonical JSON (§10) of `{claim, candidatesHash, grantHash, policyHash, coverageHash, context}`. `candidatesHash` is Merkle-style: each candidate's `refHash` = SHA-256 of the canonical JSON of `{id, contentHash, observedAt}` (computed once per observation, not per receipt), and `candidatesHash` = SHA-256 of the concatenation of the candidates' 32-byte `refHash` digests, in id order (the empty list hashes the empty byte string). It binds exactly the same facts as listing the refs, without re-encoding them for every receipt: where `grantHash` and `coverageHash` are the SHA-256 of the canonical JSON of the grant and of the coverage after every set-like array is sorted and de-duplicated (`coverage.observers`, `grant.allowedTypes`, `counterpartyAllowlist`, `declaredScopes`, `observedScopes`, `accounts` lists), and candidates are de-duplicated by id and sorted by id. A candidate's content is pinned by its `contentHash` (and its id derives from it), so naming it by `{id, contentHash, observedAt}` covers every input exactly; sub-hashes are computed once per batch (and `refHash` once per observation). It is stored and proves replay.

**Receipt id.** Stable per subject, not per input: `id = idFromHash(sha256Hex(canonicalJson(K)))` with `K = {k:'claim', claimId}` for a claim receipt, `{k:'unasked', observationId}` for UNASKED, `{k:'scope', agent, scope}` for a scope-diff receipt. A regrade replaces the PENDING row with the same id (idempotent; same claim → same row). `computedAt = coverage.evaluatedAt`; `finalAt` = the `evaluatedAt` of the first grading that met the FINAL condition.

## 4. Candidates (`candidates.ts`)

### 4.1 Window

Let `t = claimedAt` and `p = claimedAtPrecision` (`minute` | `hour` | `day`; the unit containing `t` in `t`'s own UTC offset).
- `calendar.*`: centred on the claimed event start `targetAt`, not on `claimedAt`: `[targetAt − calendarDays, targetAt + calendarDays]`. A calendar claim without `targetAt` is graded by rule `no_target`.
- every other type: `[start(p,t) − beforeClaimMin, end(p,t) + afterClaimMin]`, where `start(p,t)` is the start of the precision unit containing `t` and `end(p,t) = start(p,t) + unit` (the closed interval `[start, end]`; for minute precision, 14:02:00 → [14:02:00, 14:03:00]). A claim may carry `claimedAtEnd` only with `day` precision, in `(claimedAt, start(p,t) + 25 h]`: then `end(p,t) = claimedAtEnd`. Adapters set `claimedAt` to the unit start for `hour` and `day` precision, written in the offset in which it reads 00:00 (resp. hh:00). Adapters set `claimedAtEnd` for `day` precision to the next local midnight (computed with the injected offset function); the core never relies on `claimedAt` being the unit start (`start(p,t)` is always the start of the unit containing `t`), because a local day is 23 or 25 hours long on a DST change and `start + 24 h` would cut off its last hour (a false NOT_FOUND).

A candidate is an observation of the **same `ActionType`**, from a source the policy lists for that type (`policy.sourcesByType[claim.type]`, the relevant sources of §6.1: evidence the claim's coverage never reads cannot verify it), whose `occurredAt` lies in the window (inclusive). An observation from any other source is never a candidate of the claim (`grade` refuses it, `GradeError('foreign_candidate')`), and it is never an orphan either (§3). For `calendar.created`, a candidate also needs `observedAt ≥ start(p,t) − beforeClaimMin`, comparing the earliest `observedAt` of all observations sharing its `contentHash` (an event already on the calendar before the claim cannot verify "created"). Duplicates by `contentHash` (hence by id) count once: the one with the earliest `observedAt` is kept. Candidates are ordered by (`occurredAt` instant, id, `contentHash`); the schema requires `Observation.id = idFromHash(contentHash)`.

### 4.2 Retrieval

`ObservationIndex` is the only way core reads observations, and every read is bounded in time: `byTypeAndBucket(type, fromMs, toMs)` and `byCounterpartyToken(token, fromMs, toMs)`, both async, both allowed to over-return; `candidates()` filters exactly. Counterparty tokens are the observation's address read through `email()` (never the display name), its domain, and its local-part tokens split on `[._-]` without the `+tag`, all ASCII-lowercased, plus the merchant's name tokens; lookups are exact. An in-memory index ships in core for tests and replay; the Dexie index (Sprint 2.6) passes the same test file.

### 4.3 Assignment: one observation verifies at most one claim

A **batch** = every PENDING claim plus FINAL and USER_OVERRIDDEN claims as fixed pre-assignments (`fixed`: observation → claim, each pair with the batches it is in force in, `after < evaluatedAt ≤ until` and outside its `released` spans `(from, to]`, derived from the stored receipts by `preAssignments` in batch-fixed.ts, the one rule `gradeBatch` and replay share. A claim's pairs are in force only after its receipt's `computedAt`, its last grading. A FINAL receipt fixes its `observationIds`; an override to VERIFIED keeps them, and an override to NOT_FOUND releases them in batches evaluated after its `at` (a `released` span from `at` with no end). A receipt PENDING until an override to VERIFIED fixes its stored `observationIds` from its `computedAt` on as well: every later batch left the claim out after reading the override, and the evidence left free could be taken FINAL by another claim, then found fixed to two claims. One overridden to NOT_FOUND fixes nothing. An overridden UNASKED receipt fixes its observation as taken in batches evaluated strictly after its override's `at` (and its `computedAt`); a FINAL UNASKED receipt does not: its observation stays assignable, and a claim that takes it supersedes it, §7). A reverted override (§8 `reverted`) stays in force for the batches evaluated up to its `revertedAt`. An override from PENDING to VERIFIED fixed its evidence from the later of its grading and the revert before it since that grading, up to its revert (`until`). An overridden UNASKED receipt took its orphan in `(at, revertedAt]`. An override from FINAL to NOT_FOUND released the FINAL evidence in `(at, revertedAt]`. A revert fixes evidence again only if no other claim holds that observation then (batch-fixed-claims.ts). Each claim's spells are kept in the order they begin, a grading before a revert at one instant, then by claim id. A spell that begins at a revert while another claim's kept spell holds the observation is dropped, and released for good. The reverted receipt then shows its computed grade again while another claim holds its evidence, so two receipts name one observation (Sprint 4.3: the revert control says so, or refuses that revert; the measured rate is in Decisions.md). A spell that begins at a grading is never dropped: two that overlap are a corrupt ledger, and `assign` refuses it. A claim pair's `after` is always a grading of its claim. **Only eligible claims take part in assignment:** a claim that is underspecified (§5.2), a calendar claim without `targetAt`, or a claim whose type has no sources is never scored against observations, so a vague claim can neither take evidence from a specific claim nor hide an orphan from UNASKED. Every (eligible claim, candidate) pair is scored (§5). Pairs with score ≥ `thresholds.partial` are assigned greedily, best score first (exact comparison, §5.3); ties break by earlier `claimedAt` instant (epoch ms, never strings), then claim id, then observation id. **One-to-one:** each observation goes to at most one claim and each claim takes at most one observation. Fixed pairs are taken first and never moved (`assign(pairs, policy, fixed, taken)`: `taken` observations are never assigned; fixed pairs that are not one-to-one throw `CandidatesError`; an observation both fixed to a claim and taken stays with that claim and is excluded from every other claim and from the orphans). A claim's candidates for `grade` are its own candidates minus observations assigned to other claims or fixed as taken. Observations assigned to no claim are **orphans** (§7).

## 5. Features and score (`features.ts`)

### 5.1 Features

Each feature value is an exact rational in [0, 1]. Counterparty normalisation is §11.

| Feature | Value |
|---|---|
| `timeProximity` | Δ = the distance in ms from `occurredAt` to the interval `[start(p,t), end(p,t)]` (0 inside it); for calendar, the distance to `targetAt`. `edge` = `beforeClaimMin` on the before side, `afterClaimMin` on the after side, `calendarDays` for calendar. Value 1 when Δ ≤ `toleranceMin`, else `(edge − Δ) / (edge − tolerance)`, all in ms. The loader rejects a policy whose `toleranceMin` is not below every edge. |
| `counterpartyExact` | Claim counterparty is an address: 1 iff the two addresses are **code-point-identical after ASCII-only lowercasing** (no NFC, no NFKC). Identical confusable addresses (any non-ASCII code point or an `xn--` label) score 1 with reason `cp.non_ascii`. If either address is confusable (§11) and they are not identical, the pair is confusable: 0, reason `cp.confusable`. Otherwise a `+tag`-only difference scores 0 with reason `cp.plus_tag` (`cp.confusable` replaces `cp.plus_tag` when both apply). `cp.*` reasons come only from address claims. |
| `counterpartyDomain` | Claim counterparty is an address: 1 iff `counterpartyExact` = 1, or (the domains are identical, neither address is confusable, and (the domain ∉ `policy.commonDomains`, or the addresses differ only by a `+tag`)); else 0. A free-mail domain alone says nothing about identity, but an exact or same-mailbox address still counts. |
| `counterpartyName` | Claim counterparty is a **name** (not an address) with at least one token: 1 iff every token of the normalised name is a token of the observation address's local part, ASCII-lowercased (never NFKC'd) and split on `[._-]` after removing a `+tag`. The display name is never used: it is attacker-controlled. Else 0 (also 0 when the observation has no address). |
| `subjectOverlap` | Jaccard \|A∩B\| / \|A∪B\| of the subject token sets (§11). Not applicable when the **claim** has no tokens; an observation with no tokens scores 0. |
| `amountExact` | Applicable when the claim has `amountCents`. 1 iff `amountCents` are equal **and** both currencies are present and equal; a currency missing on either side scores 0. |
| `merchantMatch` | 1 iff the claim's normalised counterparty equals the observation's normalised merchant; else Jaccard of their name tokens (0 when the observation has none). Merchant text is read through `counterparty()`; text it rejects has no name tokens (claim: not applicable; observation: 0). |
| `modelScore` | Reserved for Sprint 5 (weight 0; never applicable in Sprint 1). |

Observation counterparties are always read through `email()` (§11) before comparison: observers store the address only, but a display-name form that slips through is reduced to its address and never compared by name.

### 5.2 Applicability and identity

`policy.featuresByType[type]` lists the features for a claim type. Applicability is decided by the **claim alone**: a listed feature is dropped when the claim lacks its field or the field has no tokens (and the address/name split above picks exactly one of `counterpartyExact`+`counterpartyDomain` or `counterpartyName`). A missing or empty field on the *observation* scores 0, never "not applicable". So no observation can make a claim easier to match by omitting data.

**Identity.** `policy.identityFeatures[type]` lists the features that say *which* action a claim means (email: counterparty; calendar: subject or counterparty; purchase: amount or merchant). If the type's identity list is non-empty and none of its features is applicable, the claim is **underspecified** ("Done! I've sent the email.") and is graded by rule `underspecified` → UNVERIFIABLE with reason `claim.too_vague`, never matched on time alone.

### 5.3 Exact score

The policy loader converts every weight, threshold and unasked signal weight to integer **basis points** and rejects any value that is not a multiple of 0.0001. Feature values are rationals `pᵢ/qᵢ` with integer numerator and denominator. The score is the rational `S = Σ wᵢ·pᵢ/qᵢ ÷ Σ wᵢ` over applicable features, compared with a threshold `T` (bp) by cross-multiplication in `BigInt`: `S ≥ T ⇔ 10000 · Σ wᵢ·pᵢ·(Q/qᵢ) ≥ T · Σwᵢ · Q`, `Q = Π qᵢ`. Assignment ties compare the same rationals. A `featuresByType` entry whose weights sum to 0 is rejected at load, and so is an `identityFeatures` entry naming a feature of weight 0, so every claim that is not underspecified has Σwᵢ > 0; the loader also rejects a type with sources whose `identityFeatures` list is empty. The loader requires `0 < thresholds.partial < thresholds.verified` in basis points: a score of 0 is no evidence (§2), so a partial threshold of 0 would assign, name as evidence and grade PARTIAL an observation that matches nothing (`thresholds.partial: must be > 0`). Likewise `unasked.threshold` must be at least 1 bp (`unasked.threshold: must be > 0`). UNASKED names its evidence, the signals that fired (§7), so at 0 an attribution whose fired signals weigh nothing would still be 'likely' (Hard Rules 5, 7). `features()` throws `RatioError('zero_weight_sum')` if called on a claim with no weighted applicable feature; callers use it only for assignable claims. Windows are whole minutes, hours or days (integers ≥ 0, safe in ms). A rule may have `then: PENDING` only if its id is `pending`. A rule may conclude a grade only if it names that grade's evidence (§6). `signals.score` and the feature values on a receipt are display numbers rounded to 4 decimals and are **never compared**. Summation order cannot change a grade.

## 6. Rules (`grade.ts`, conditions in `conditions.ts`)

First match wins, in the order written in `policy.rules`. If nothing matches: terminal rule `default_unverifiable` → UNVERIFIABLE. Every receipt names its `ruleId`.

Whatever its place in the order, a rule must name the evidence its grade asserts (§2), and the loader refuses one that does not, with a `PolicyError` line at the rule's path (e.g. `rules[3].when.bestScoreGte: must be "verified" when then is "VERIFIED"`). VERIFIED needs `bestScoreGte: verified`. PARTIAL needs `bestScoreGte` (either threshold). NOT_FOUND needs `graceElapsed: true`, `coverage: full` and `bestScoreLt: partial`. UNASKED needs `unaskedLikely: true`. OVER_SCOPE needs at least one of `observedScopeExceedsDeclared`, `typeNotInGrant`, `counterpartyNotAllowed`, `amountAboveCeiling`, `cumulativeAboveCeiling` set to `true`. UNVERIFIABLE and PENDING need none. The default order (§6.2) already names exactly these (Hard Rules 5, 7).

### 6.1 Conditions

"Relevant sources" = `policy.sourcesByType[claim.type]`. An entry is **eligible** for a claim if its source is relevant, `lastSyncAt ≤ evaluatedAt`, and its account is acceptable: if `grant.accounts[source]` is set, `accountHash` must be in it; if not set, an entry with no `accountHash`, or a source seen with ≥ 2 distinct account hashes, counts at most as `partial` coverage. A `gcal.event` entry without `allCalendars: true` counts at most as `partial`.

| Condition | True when |
|---|---|
| `coverage: 'none'` | No eligible interval overlaps the claim window. A type with no sources (`message.sent`, `other`) is always `none`. For a purchase-like type (its sources are `["gmail.receipt"]`) whose normalised counterparty (`name()`, §11) is not in `policy.receiptMerchants`, whose counterparty text is rejected (§11), or which has no counterparty, coverage is **at most `partial`** (reason `coverage.no_parser`): no parser could have seen the receipt, so Attest can never say NOT_FOUND, but a receipt it did see still verifies. In general the cap applies per entry: for any claim whose type reads `gmail.receipt` and that has no parser, every `gmail.receipt` entry is capped, so a mixed-source type can still be `full` only through its other sources and never through receipts no parser could read (Hard Rule 5). The shipped policy has no mixed-source receipt type. |
| `coverage: 'partial'` | Eligible intervals overlap the window but their union does not contain all of it (or only capped entries contain it). |
| `coverage: 'full'` | The union of eligible, uncapped intervals contains the whole window. With several relevant sources, levels are per source: the claim's coverage is full iff every relevant source is full, none iff every one is none, else partial. |
| `typeNotInGrant` | `claim.type ∉ grant.allowedTypes`. |
| `counterpartyNotAllowed` | `claim.type ∈ policy.allowlistTypes`, `grant.counterpartyAllowlist` is non-empty, and **any** known address — the claim's (if it is an address) and the assigned candidate's (if there is one) — matches no entry. Entries and domains compare after ASCII-only lowercasing; an entry containing `@` is an address and matches only an identical address (§5.1); any other entry is a domain, matching an equal domain or one ending in `.entry`. A confusable address never matches. With no known address at all (the claim's counterparty is not an address, and there is no assigned candidate or it has no address read through `email()`): not applicable (reason `allowlist.unchecked`). |
| `amountAboveCeiling` | Not applicable unless the guard holds: `claim.type ∈ policy.spendTypes`, `grant.spendCeilingCents` is set (then `grant.spendCurrency` is required by schema), and an amount is known (the claim's or the assigned candidate's `amountCents`, in any currency); within the guard it is true or false. A candidate with no currency neither counts toward the Amount nor mismatches. Amount = the larger of the claim's `amountCents` (counted only when it is **counted in `spendCurrency`**: the claim's currency is absent or equals `spendCurrency`) and the assigned candidate's `amountCents` when that candidate's currency equals `spendCurrency`. True if amount > ceiling (reason `ceiling.exceeded`), or if the claim's currency is present and ≠ `spendCurrency`, or the assigned candidate's currency is present and ≠ `spendCurrency`, whatever the claim's currency (reason `ceiling.currency_mismatch`, which replaces `ceiling.exceeded` unless the amount also exceeds the ceiling in `spendCurrency`; the candidate case finalises like PARTIAL). Otherwise false. |
| `cumulativeAboveCeiling` | Not applicable unless `claim.type ∈ policy.spendTypes`, `grant.spendCeilingCents` is set, the claim's `amountCents` is known, and the claim's amount is counted in `spendCurrency` (its currency is absent or equals `spendCurrency`: the same reading as the claim side of the `amountAboveCeiling` Amount). Within the guard, true when `context.priorSpendCents + claim.amountCents > spendCeilingCents` (exact). |
| `observedScopeExceedsDeclared` | (claim null) `context.scope` is set and the observed scope is not in `grant.declaredScopes`. With `context.scope` absent: not applicable. |
| `targetMissing` | `claim.type` is `calendar.*` and `claim.targetAt` is absent. |
| `underspecified` | §5.2. |
| `bestScoreGte: T` | the best candidate's exact score ≥ `thresholds[T]`. Not applicable to a claim that is never scored against observations (§4.3: underspecified, a calendar claim without `targetAt`, a type with no sources). |
| `bestScoreLt: T` | the best candidate's exact score < `thresholds[T]` (true when an assignable claim has no candidates). Not applicable to a claim that is never scored (§4.3), so whatever the rule order, `not_found` and `partial_coverage` never assert that nothing matched a claim nothing was matched against (Hard Rule 5). |
| `graceElapsed` | every relevant source has an eligible entry with `lastSyncAt ≥ end(p,t) + graceMin` and, for non-calendar types, also `≥ end(p,t) + afterClaimMin` (the whole window has had time to happen). Vacuously true for a type with no sources. The clock is the observers' sync time, never a wall clock: Attest says NOT_FOUND only after it actually looked. |
| `unaskedLikely` | (claim null) `context.attribution` is set and its score ≥ `policy.unasked.threshold` (exact, in bp). With `context.attribution` absent: not applicable. |

Eligibility also caps coverage for accounts: the account-hash count is taken over **this source's entries in `coverage.observers`**, and `coverageFor` (Sprint 2.6) must return all of them. A NOT_FOUND graded without `grant.accounts` for that source carries reason `coverage.account_unbound`: if the user only ever opens the wrong account, Attest cannot tell (listed in `docs/attacks-that-work.md`, red-team strategy 7). The Sprint 3 settings-page adapters record the agent's account hash so `grant.accounts` can be filled.

All conditions in one `when` must hold. **Claim-less evaluation:** when `claim` is null, every condition except `unaskedLikely` and `observedScopeExceedsDeclared` is *not applicable*, and a rule with any non-applicable condition does not match; when a claim is present, those two are not applicable. Because VERIFIED, PARTIAL and NOT_FOUND rules must name `bestScoreGte`, `graceElapsed`, `coverage` or `bestScoreLt` (§6), none of them can match a claim-less grade, and an UNASKED rule (which must name `unaskedLikely: true`) can never match a claim.

### 6.2 Default rule order

```
unasked → over_scope_observed → over_scope → over_allowlist → over_ceiling → over_ceiling_cumulative
→ no_target → underspecified → no_coverage → verified → partial → pending → partial_coverage → not_found
```

with `not_found.when = {graceElapsed: true, coverage: 'full', bestScoreLt: 'partial'}`, `pending.when = {graceElapsed: false}`, `partial_coverage.when = {coverage: 'partial', bestScoreLt: 'partial'}`. `no_target` and `underspecified` are claim-intrinsic (a calendar claim without a target has no window to cover), so they come before `no_coverage` and their reason is the accurate one. Over-scope rules read only the claim, the grant and (for amounts and allowlists) the assigned evidence, so they come before `no_coverage`: an agent that claims a $200 purchase against a $50 ceiling is OVER_SCOPE whether or not a receipt email is visible. Hard Rule 5 forbids VERIFIED and NOT_FOUND without sight; it does not forbid OVER_SCOPE on the agent's own claim.

### 6.3 Cumulative spend (`scope.ts`)

`priorSpendCents(claim, claims, policy, spendCurrency?)` sums `amountCents` of the same agent's claims whose type is in `policy.spendTypes` and whose amount is counted in the claim's currency. A missing currency, on the claim or on a prior, reads as `spendCurrency`, the claim's grant's (`gradeBatch` passes it). With `spendCurrency` set, a currency-less claim and a claim in `spendCurrency` count each other, as the §6.1 Amount counts them; with none, a currency-less claim counts only earlier claims without one. Counted claims have `claimedAt` in `[t − windows.spendWindowDays, t]` (days are fixed 24 h) and come strictly **before** the claim in `(claimedAt ms, id)` order; a claim id listed twice counts once; the claim's own id never counts, whatever copy holds it (one claim read at 10:00:10 and again at 10:00:50 has one id, §10, so an earlier copy of it is never its prior spend); the sum is 0 for a type not in `spendTypes`. Amounts are non-negative by schema, so a refund cannot lower it. Two $30 purchases against a $50 ceiling make the second OVER_SCOPE, with or without a currency on either (Hard Rule 5: leaving the currency out never lets spend escape the cumulative ceiling).

### 6.4 Confidence and reasons

Confidence: VERIFIED/PARTIAL: the best score (display). NOT_FOUND: 1. OVER_SCOPE: 1. UNASKED: the attribution score. UNVERIFIABLE: 0.
`reasons` is a list of `{ code: ReasonCode, params }`, where `ReasonCode` is a closed enum in `schema.ts` and params are ids, ISO timestamps from the inputs, rule ids and enum values — never an address, a name, a subject or a formatted local time. The UI renders the words. This keeps receipts deterministic across time zones and locales and keeps PII out of anything shareable.

## 7. UNASKED (`attribution.ts`)

`attribute(orphan, activity, policy)` uses allowlisted data only:

```
Activity = { sessions: {agent, at}[], idle: {from, to}[], entries: {agent, at, type?}[],
             adapterSyncs: {agent, lastSyncAt}[], claims: Claim[] }
```

| Signal | Fires for agent A when |
|---|---|
| `agentSessionActive` | a session ping of A is within ±`unasked.windows.sessionMin` of `occurredAt`. |
| `userIdle` | (agent-independent) one recorded idle interval covers `[occurredAt − idleMin, occurredAt]` (inclusive; intervals are not merged). **Positive evidence only:** missing data never counts as idle. |
| `agentSignature` | the observation's `subjectHint` contains one of `unasked.signatures[A]` (ASCII-only case folding, §11; no NFKC). Bodies are never stored, so footers cannot be read: a documented limit. |
| `activityLogAdjacent` | an activity entry of A is within ±`unasked.windows.adjacentMin`, and no **assignable** (§4.3) claim of A of the observation's type has its precision unit `[start(p,t), end(p,t)]` within ±`adjacentMin` of the anchor (assigned or not; a vague claim cannot suppress the signal). An entry's `type` is informational and not read. |

For `calendar.*` observations the anchor of every window above is the earliest `observedAt` of the observation (when the change was first seen), not `occurredAt` (the event start); for every other type it is `occurredAt`. Each agent is scored separately: its own signals plus `userIdle`, capped at 1, exact in bp. The likely agent is the highest score; ties by number of fired signals (including `userIdle`), then the lowest agent id by UTF-16 code unit. No agent-specific signal fired → no attribution. `unaskedLikely` needs the score ≥ `unasked.threshold` (at least 1 bp, §5.3). Reasons list the attributed agent's fired signals plus `userIdle`, each phrased with "likely". `Attribution.adapterLastSyncAt` is the attributed agent's latest adapter sync. An UNASKED receipt stays PENDING until that sync is `≥ anchor + beforeClaimMin + graceMin` (a later claim may still explain it), or until `evaluatedAt ≥ anchor + finalizeUnverifiableHours`, with the same anchor as the signals (first `observedAt` for `calendar.*`, else `occurredAt`). A PENDING UNASKED that re-evaluates to anything else is deleted, unless it holds reverted overrides (§8). It is then kept as stored, still PENDING until a batch produces it again or a FINAL claim supersedes it, because the batches that ran while an override was in force had its orphan taken. No batch grades such a row, so `finalizeUnverifiableHours` does not finalise it either: the background keeps it, and the UI must not show it as "checking" forever (Sprint 3.6, 4.3; the measured rate is in Decisions.md). A claim that is later assigned an observation with a FINAL UNASKED receipt **supersedes** it (§8): FINAL UNASKED observations stay assignable.

## 8. State machine (`conditions.ts` decides finality; `state.ts` applies events)

`grade()` sets `state` and `finalAt` using `isFinalizable({outcome, rule, claim, orphan, grant, coverage, context, policy, candidateDependent, eligible?})` from `conditions.ts` (`FinalityInput`): `rule` is the matched rule (null for the terminal `default_unverifiable`), `orphan` the observation of a claim-less UNASKED grade (null otherwise), `candidateDependent` whether an OVER_SCOPE outcome rests on the assigned candidate (the rows below), and `eligible`, optional, the claim's eligible coverage when the caller has already computed it. It returns `{final, finalAt?}`, with `finalAt = coverage.evaluatedAt` when final.

| Outcome | FINAL when |
|---|---|
| VERIFIED | an eligible entry of every relevant source has `lastSyncAt ≥ end(p,t) + graceMin` (positive evidence needs no wait for the rest of the window). |
| PARTIAL, NOT_FOUND | `graceElapsed` (the whole window has had time to happen and was seen). |
| OVER_SCOPE from claim-only facts (type, claim amount, claim address, cumulative, observed scope) | immediately. |
| OVER_SCOPE that depended on the assigned candidate (the outcome would not be OVER_SCOPE without that candidate's amount, currency or address) | like PARTIAL: `graceElapsed`, so a better match can still correct it. |
| UNVERIFIABLE by a rule that names `targetMissing` or `underspecified` (the shipped `no_target` and `underspecified`) | immediately. |
| UNVERIFIABLE for a type with no sources (`message.sent`, `other`; with the shipped rules, `no_coverage`) | immediately: nothing can ever cover it. |
| `pending`, `no_coverage`, `partial_coverage`, `default_unverifiable` | `evaluatedAt ≥ end(p,t) + finalizeUnverifiableHours`; a `pending` outcome then finalises as UNVERIFIABLE (ruleId `pending`, reason `coverage.never_completed`), so nothing stays "checking" forever and nothing silently drops out of the counts. |
| UNASKED | §7. |

**Receipt invariants** (enforced by the schema): `override` is present iff `state` is USER_OVERRIDDEN; `finalAt` is present iff the state before any override is FINAL; `grade` is UNASKED iff `attribution` is `likely` and `claimId` is absent; `attribution` and `supersededBy` appear only on UNASKED receipts; an override reason contains a visible character; `override.at ≥ computedAt`; `override.user {grade: override.grade}` is present iff `override` is, and `superseded {claimId: supersededBy}` iff `supersededBy` is, both after every graded reason in §15 order. The schema also requires `Claim.id = idFromHash(rawHash)` beside `Observation.id = idFromHash(contentHash)`. `observationIds` = `[the assigned candidate]` when one is assigned (score ≥ `thresholds.partial`), else `[]`; an UNASKED receipt's is `[its orphan]`; a scope-diff receipt's is `[]`. `grade`'s best candidate is the highest exact score, ties broken by observation id, so `match.best` names the assigned candidate whenever one is assigned, and names the best candidate even below partial. A claim-less `grade` whose matched rule concludes anything but UNASKED or OVER_SCOPE returns rule `default_unverifiable`, FINAL, subject `{k:'unasked', observationId: candidates[0]}` (or `{k:'scope', …}` for a scope subject), `observationIds []`; `gradeBatch` never returns it. A claim-less grade whose only orphan has `observedAt > evaluatedAt` throws `GradeError('claimless_subject')`. On an UNASKED receipt, an override VERIFIED means the user confirms an agent did it; NOT_FOUND means the user says no agent did. An override from PENDING freezes the computed part as it was; overridden receipts are counted by their override grade. Receipt `signals` keys are the §5.1 feature names plus `score`. `reverted` is absent, or holds 1 to `SCHEMA_LIMITS.REASONS` entries, oldest first. Each entry is `{grade, at, revertedAt, previousState, computedAt, observationIds}`, never the override's reason. Rules: `computedAt ≤ at ≤ revertedAt`. Each entry's `at` and `computedAt` are no earlier than the previous entry's `revertedAt` and `computedAt`. A regrade between two entries happens only once the earlier one no longer held the subject. `override.at` is no earlier than the last `revertedAt`. An entry's `computedAt` is no later than the receipt's. While they are equal, its `previousState` is the state before any override and its `observationIds` are the receipt's. Once regraded, the entry was PENDING, and the receipt was not computed while the override held: a claim's `computedAt` > `revertedAt`, an orphan's `computedAt` ∉ (at, revertedAt]. A claim-less receipt's entries hold its own `observationIds`.

`state.ts` applies events to stored receipts and never decides finality:
- `regrade(next)`: PENDING → `next`, where `next` is `grade()`'s receipt for the same subject (same id), PENDING or FINAL, with `next.computedAt ≥ computedAt`; on an UNASKED receipt `next` must be UNASKED (a PENDING UNASKED that re-evaluates to anything else is deleted by the caller, never regraded). On a FINAL or USER_OVERRIDDEN receipt it throws `IllegalTransitionError`: FINAL receipts are never re-graded, and grant changes affect PENDING receipts only. Each precondition is a refusal, never a silent fix: a superseded receipt is never regraded (`regrade_superseded`: its observation is fixed to the superseding FINAL claim, so the caller deletes a PENDING one), another subject is `subject_mismatch`, an earlier `next.computedAt` is `regrade_stale`, an UNASKED receipt to another grade is `regrade_not_unasked`, and a `next` that is not `grade()`'s output (USER_OVERRIDDEN or superseded) is `invalid_event`; all throw `IllegalTransitionError`. The stored `reverted` list is kept. A `next` computed while a reverted override still held the subject is `regrade_held` (a claim: at or before the last `revertedAt`; an orphan: inside `(at, revertedAt]`). A `next` that carries `reverted` is `invalid_event`.
- `override({grade: VERIFIED | NOT_FOUND, reason (required, non-empty), at})`: from PENDING or FINAL → USER_OVERRIDDEN, storing `previousState`; an `at` before `computedAt` or before the last `revertedAt` throws `IllegalTransitionError` (`invalid_event`). The computed `grade` is kept; the override sits beside it, so replay shows an override, never a changed grade.
- `revert({at})`: USER_OVERRIDDEN → `previousState` (Sprint 4.3: overrides are reversible). The override is appended to `reverted` with `revertedAt = at` and the computed part it sat beside; its reason is not kept. `at` is stamped by the caller inside the transaction that writes it; an `at` before `override.at`, or one that is not a timestamp, throws `invalid_event`, and one revert past the cap throws `invalid_result`. A revert never erases what a batch saw (§4.3). A deviation from "terminal" in task 1.6, logged.
- `supersede(claimId)`: only on UNASKED receipts, in any state; sets `supersededBy`, replacing an earlier claim (the same claim changes nothing). The background applies it only once the superseding claim's receipt is FINAL, so an assignment that later changes cannot leave a stale supersession. Superseded receipts are excluded from counts, alerts and the digest.

<a id="receipt-state-diagram"></a>
![Receipt state machine. grade() creates a receipt as PENDING or FINAL, as isFinalizable decides. regrade replaces a PENDING receipt with grade()'s next receipt, PENDING or FINAL. override moves PENDING or FINAL to USER_OVERRIDDEN and stores previousState; revert(at) returns to previousState and keeps the override in reverted. supersede applies to UNASKED receipts in any state: the state is unchanged and supersededBy is set. Any other pair throws IllegalTransitionError.](assets/receipt-states.svg)

The diagram ([`docs/assets/receipt-states.svg`](assets/receipt-states.svg)) restates the rules above; where the two differ, the text wins. Every (state, event) pair, legal or not, is a row of the state table test in [`extension/tests/unit/core/state.spec.ts`](../extension/tests/unit/core/state.spec.ts). Golden scenarios show the events on graded receipts: [56](../extension/tests/golden/56-user-override.json) (override beside a computed NOT_FOUND), [57](../extension/tests/golden/57-unasked-superseded.json) (an UNASKED receipt superseded by a later claim), and [44](../extension/tests/golden/44-finalize-never-completed.json) and [66](../extension/tests/golden/66-unasked-finalised-by-time.json) (receipts that become FINAL only by `finalizeUnverifiableHours`).

## 9. Replay (`replay.ts`)

```
LedgerSnapshot = { claims, observations, receipts, receiptInputs, policies }   // receiptInputs keyed by inputsHash: {coverage, grant, context, policyHash}
replay(snapshot) → Promise<ReplayReport>
```

Replay groups receipts by `computedAt` and processes the groups in order. For each group it rebuilds candidates and the assignment from claims and observations as they were at that instant (`observedAt ≤ computedAt`), with the pre-assignments in force at that instant fixed (§4.3: `preAssignments` of the stored receipts, the rule `gradeBatch` applied), takes coverage, grant and context from `receiptInputs` (they cannot be rebuilt from current state), runs `grade`, and compares every computed field with the stored receipt: `id`, `inputsHash`, `grade`, `ruleId`, `state`, then `agent`, `claimId`, `observationIds`, `requestId`, `confidence`, `reasons`, `signals`, `policyHash`, `attribution`, `computedAt` and `finalAt` (`COMPARED_FIELDS` in `replay-compare.ts`). An UNASKED receipt's observation must be an orphan of the rebuilt batch by §3's rule (the same `isOrphanCandidate`, under the receipt's stored coverage), assigned to no claim and not taken; otherwise the mismatch is `orphan`. `replay` throws `PolicyError('policy_not_loaded')`, before replaying anything, when `policies` holds an object `loadPolicy` did not return. The lifecycle part (`override`, `reverted`, `supersededBy` and their reasons) records events, not grading, and is set aside. Each observation a receipt is graded with is also checked against its `contentHash` (§10), so evidence edited in place is reported (`contentHash`). Overridden receipts are compared on their `previousState`. An override releases or takes an observation only in batches evaluated strictly after its `at`, and a claim overridden from PENDING keeps its stored evidence fixed after its last grading (§4.3). A reverted override stays in force up to its `revertedAt`, and a claim it held is not in the batches it held the claim out of (batch-fixed.ts `heldOutAt`), so a revert never makes a stored receipt unreproducible. The report lists every mismatch. The ledger must therefore store `receiptInputs` (Sprint 2.6/3.6), all of it derived data with no content (Hard Rule 2), keep several coverage intervals per source within retention, and delete a `receiptInputs` row when its receipt is regraded. Replay covers the receipts inside the retention window; the 90-day purge removes receipts together with their evidence and inputs.

<a id="replay-procedure"></a>
**Replay procedure.** To prove the receipts in a ledger:

1. Write the ledger to a JSON file in the replay format. It is the ledger export ([`extension/src/ledger/export.ts`](../extension/src/ledger/export.ts), format `attest-ledger`: the requests, claims, observations, grants, receipts, adapter health, coverage and meta tables, each parsed by its schema) plus the two maps replay needs: `receiptInputs`, keyed by each receipt's `inputsHash`, and `policies`, the policy documents keyed by the `policyHash` each receipt names. [`extension/tests/tools/attest-snapshot.ts`](../extension/tests/tools/attest-snapshot.ts) documents the format and validates every object with its strict schema. The extension's own export does not write `receiptInputs` and `policies` yet: the ledger stores them from Sprint 2.6/3.6, and the export must carry them from then on.
2. From the repo root, run `pnpm attest replay <export.json>`. The root `attest` script runs the extension's `attest` script, [`tests/tools/attest-cli.ts`](../extension/tests/tools/attest-cli.ts) under `tsx`, which builds the `LedgerSnapshot` above from the file and calls `replay(snapshot)` ([`extension/src/core/replay.ts`](../extension/src/core/replay.ts)). A relative path is read from the directory `pnpm` was run in.
3. Read the summary: the receipts and batches replayed, how many were reproduced, how many mismatched, the mismatches by field, and the first mismatches (up to `LISTED_MISMATCHES` in `attest-cli.ts`), each as receipt id, field, stored value and replayed value. A field is one of the compared fields above when the two values differ (signals and reasons are shown as SHA-256 hashes), or says why the receipt could not be graded again (`receiptInputs`, `policy`, `subject`, `orphan`, `contentHash`, `error`); `ReplayReport` and `REPLAY_FIELDS` in `replay.ts` have the exact shape. The output holds ids, hashes, grades, rule ids and states, never content. Text from the export (a key in an error path) is written JSON-quoted, with every control, format, separator, private-use or unassigned character escaped as `\u{…}` ([`tests/tools/printable.ts`](../extension/tests/tools/printable.ts)), so a crafted export cannot drive the terminal. The file name the CLI echoes (the summary's first line, `cannot read …`, `… is not JSON`) and every reported value are escaped the same way, line breaks included, so a file name cannot start an output line of its own. Exit status 0 means every receipt in the file was reproduced, 1 means at least one mismatch, and 2 means bad arguments or a file that does not parse.

A mismatch means a stored receipt cannot be re-derived from its stored inputs: the ledger was changed outside `gradeBatch` and `state.ts`, or `src/core` changed what it decides without a policy or contract change. Either one breaks Hard Rule 4. [`extension/tests/unit/tools/attest-cli.spec.ts`](../extension/tests/unit/tools/attest-cli.spec.ts) runs the command on synthetic ledgers, and on copies with a changed stored grade, a policy filed under the wrong hash and a file that is not JSON.

## 10. Ids and hashes (`hash.ts`)

- **SHA-256** in pure TypeScript (synchronous, runs in Node and the browser), tested against the FIPS 180-4 / NIST vectors and Node's `crypto`. Input is the UTF-8 encoding of the string; a lone surrogate is encoded as U+FFFD (as WHATWG `TextEncoder` does), so wherever two strings must stay distinct they are hashed through `canonicalJson` (which escapes lone surrogates): `rowKeyHash = sha256Hex(canonicalJson(rowKey))`.
- **Canonical JSON**: object keys sorted by UTF-16 code unit; arrays in the given order (callers sort set-like arrays first, §3); `undefined` properties dropped; strings exactly as ES2019 `JSON.stringify`; numbers in JavaScript's shortest round-trip form; `-0` written as `0`; `NaN` and `±Infinity` throw.
- **Ids from hashes**: two zero bits followed by the first 128 bits of the hash, as 26 uppercase Crockford base32 characters (always a valid ULID: first character 0–7). The `Ulid` schema accepts only the uppercase form, so one id has one spelling; every currency is a 3-letter uppercase ISO 4217 code. `Observation.id = idFromHash(contentHash)`; `Claim.id = idFromHash(rawHash)` where `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its precision unit}))` (`text` is the normalised claim text, computed by the adapter; the truncated `claimedAt` is the ISO string of the unit start in `claimedAt`'s own offset, seconds included, milliseconds omitted): three identical "Sent email to Priya" lines at different times stay three claims (red-team strategy 1), while the same line re-rendered on every page load stays one (strategy 9); `Request.id = idFromHash(sha256(canonicalJson({agent, conversationId, textHash, ts})))`, receipt ids per §3.
- **contentHash** (redact.ts) = SHA-256 of canonical JSON of `{source, type, ...the content fields (counterparty, merchant, amountCents, currency, subjectHint, occurredAt) that allowlistedFields[source] names and the row supplies}`, plus `rowKeyHash` (a hash of the vendor's own row id) when the observer has one. `subjectHint` is at most 80 Unicode code points (a surrogate pair counts once); `project` cuts a longer hint on a code-point boundary and hashes the stored text. So the same row seen twice is one observation, a created and a deleted event differ, and two separate identical sends in the same minute stay two. An observation carries one counterparty: a sent row with several recipients yields one observation per recipient (the counterparty is part of the hash). `project` refuses a row whose allowlisted value fails its field schema, or whose allowlisted field is held by a getter, a setter or a prototype rather than as an own data property (never invoked, never read), with `invalid_field` rather than storing it without that fact (Hard Rules 5, 6). Before any ledger write, `upsertObservation(db, observation, policy)` refuses a policy object `loadPolicy` did not return (`PolicyError('policy_not_loaded')`), then runs `observationIntegrityProblems` and refuses with `LedgerError('invalid_input')` a row holding a content field its source's allowlist does not name, or a `contentHash` that is not `contentHashOf` its content. No row reaches disk that `project` could not have returned (Hard Rule 2). A write whose `contentHash` (observations) or `rawHash` (claims) is already stored must be the same fact: one that differs in anything but `observedAt` (and, for a claim, its `extractor`, which is provenance) throws `LedgerError('id_conflict')` and writes nothing (Hard Rule 6). A stored row is never rewritten. A sighting at or after the stored `observedAt` (compared as instants) changes nothing; an earlier one throws `LedgerError('late_sighting')` and writes nothing, because a batch may already have graded with the stored row (§3, §9, Hard Rule 4). A new row is stored with `observedAt` = the latest of its sighting, the writer's now (src/clock.ts) and the last recorded batch instant + 1 ms, read inside the readwrite transaction that writes it (`stampObservedAt`, src/ledger/batch-instant.ts).
- **No id or hash depends on the engine's Unicode.** SHA-256 and canonical JSON work on code units and code points only. Every text-derived value that feeds a score, a hash or a stored field (a folded `name()`, name and subject tokens, stop-word keys, amounts, resolved times) comes from the §11 readers, which read text as Unicode 15.0 does whatever the engine (§11, *Unicode baseline*). So identical inputs give the same `inputsHash`, signals, grade and receipt in every supported Chrome and under replay in Node.

## 11. Normalisation (`normalize.ts`)

- **Addresses.** `email(raw)` extracts the address (a display name `"Priya" <p@x.com>` is dropped), and sets `confusable` from the **raw** extracted address: any code point above U+007F, or a domain label starting with `xn--` in any ASCII case. Addresses are never NFKC-normalised (NFKC turns `𝐩` and fullwidth `ｐ` into `p`); only ASCII `A–Z` are lowercased, by table, never `String#toLowerCase` (which maps `K`, the Kelvin sign, to `k`). Claims and observations store the address exactly as read; comparison happens in `features.ts`. Two addresses compare equal iff they are code-point-identical after ASCII-only lowercasing (no NFC: NFC still folds the Kelvin, Ohm and Angstrom signs); a `+tag` difference is reported, not erased. IDN domains are decoded from punycode for display only.
- **Names.** NFKC, diacritics folded, zero-width and bidi marks removed, whitespace collapsed, lowercased, split into tokens.
- **Amounts.** Integer minor units and ISO currency from `$1,234.50`, `CA$10`, `€9,99`, `USD 10.00`, `¥980`; integer arithmetic only; the minor-unit exponent per currency (USD 2, JPY 0, KWD 3, …) comes from `units.ts`; bare `$` resolves to the caller-supplied default currency; `¥` is JPY (CNY is written `CN¥` or `CNY`); a lone separator that reads both as a decimal point and as a thousands group (`KWD 1.500`) is rejected, not guessed.
- **Subjects.** Read each lone surrogate as U+FFFD (see *Unicode baseline*) → remove zero-width and bidi marks → NFKC → lowercase (final sigma decided as Unicode 15.0 decides it) → split on runs of characters that are not letters, digits or marks (`[^\p{L}\p{N}\p{M}]+` with the Unicode 15.0 classes, see *Unicode baseline*; so a combining mark NFKC cannot compose never splits a word) → drop empty → strip leading `re`, `fw`, `fwd` tokens repeatedly → drop `policy.normalize.stopWords` → set. A subject holding a bidi override or embedding yields no tokens; subjects fold compatibility digits with NFKC deliberately (`Q³` → `q3`): subject overlap is a soft feature that can never verify a claim on its own.
- **Text that displays differently from how it is stored is not read.** A string holding a bidi override or embedding (U+202A, U+202B, U+202D, U+202E), or a `\p{No}` digit (Unicode 15.0's General_Category No: 915 code points, 749 of which NFKC leaves unchanged) that NFKC would turn into a different number (superscripts, subscripts, circled digits, fractions), yields null from `amount` and `resolveRelative` and no name tokens; bidi marks and isolates are only stripped.
- **Vendor-relative times** ("2:03 PM", "Yesterday", "Thu") resolve against a reference instant and an injected UTC-offset function; core never reads a time-zone database. The result carries a precision (`minute` | `hour` | `day`) and the unit's start and end instants. Rules: a weekday name means the most recent such day strictly before the reference day; "N units ago" is the floor range `[ref − (N+1)u, ref − Nu]` at the finest aligned unit that contains it ("N days ago" counts calendar days); a clock time that is skipped or ambiguous on a DST day widens to day precision.
- **Unicode baseline (15.0.0).** Every character property §11 uses is Unicode 15.0's, read from tables generated from the UCD 15.0.0 files (`scripts/gen-unicode-baseline.ts`; sources in `scripts/ucd/15.0.0/`; generated `src/core/unicode-table-*.ts`), never from the JavaScript engine. That covers letters, digits and marks (`\p{L}`, `\p{N}`, `\p{M}` above), `\p{Mn}` (diacritic folding), `\p{No}`, `\p{Cf}` and Default_Ignorable (invisible marks), whitespace (ECMAScript `\s`/`trim()`, and White_Space), and Cased/Case_Ignorable (final sigma). 15.0 is the Unicode of the oldest supported Chrome (minimum_chrome_version 120: ICU 73.1). Every reader treats a code point 15.0 does not assign as unassigned (Cn): it is not a letter, digit, mark, space or invisible mark, and has no compatibility decomposition and no case mapping. So it separates subject and name tokens and belongs to none; `name()` keeps it as written; an amount or time whose digit is one does not parse (`$1` followed by OUTLINED DIGIT ZERO, U+1CCF0, is null); a stop word holding one matches nothing. A code point 15.0 leaves unassigned but already makes Default_Ignorable (U+2065, U+FFF0–U+FFF8, unassigned E0000–E0FFF) is stripped as invisible. A lone surrogate (half of a UTF-16 pair with no partner) reads as U+FFFD, the replacement character it displays as, before any reader removes a character. Removing an invisible or nonspacing mark between two halves never joins them into a character the text did not hold (U+D833, U+200B, U+DCF1 is two U+FFFD, not OUTLINED DIGIT ONE), and `name()` keeps U+FFFD in its place. NFKC and lowercase come from the engine only for 15.0 characters, which Unicode's normalisation and case-pair stability policies freeze. Lowercasing decides final sigma (U+03A3 → ς or σ, SpecialCasing Final_Sigma) from the 15.0 Cased and Case_Ignorable tables, as ICU does, and keeps a 15.0 character that an engine would lowercase into a newer one. The same inputs therefore give the same tokens, scores and grade in every supported Chrome and under `pnpm attest replay` in Node. The baseline never moves for receipts graded under it: moving it changes grading, and would first need the baseline version in each receipt's inputs, with the 15.0 tables kept for replay (Decisions [SEC-1]).

## 12. Policy keys (version 2)

Every number above comes from `policy/default.json` (Hard Rule 4; a test fails the build if a policy value appears as a literal in code). Values marked *chosen* were left open by the spec; each has a Decisions entry. `allowlistedFields[source]` lists the content fields a raw row may supply (`counterparty`, `merchant`, `amountCents`, `currency`, `subjectHint`, `occurredAt`) plus the derived markers `rowKeyHash` and `contentHash`; `occurredAt` is required in every entry, and `id`, `source`, `type` and `observedAt` are never allowed (redact.ts computes them).

```jsonc
{
  "version": 2,
  "windows": { "beforeClaimMin": 2, "afterClaimMin": 45, "graceMin": 30, "calendarDays": 3,
               "toleranceMin": 1, "spendWindowDays": 30, "finalizeUnverifiableHours": 24 },   // last three chosen
  "thresholds": { "verified": 0.85, "partial": 0.5 },
  "features": { "timeProximity": 0.25, "counterpartyExact": 0.35, "counterpartyDomain": 0.15,
                "counterpartyName": 0.25, "subjectOverlap": 0.15, "amountExact": 0.25,
                "merchantMatch": 0.2, "modelScore": 0 },                                       // counterpartyName chosen
  "sourcesByType": {
    "email.sent": ["gmail.sent"],
    "calendar.created": ["gcal.event"], "calendar.updated": ["gcal.event"], "calendar.deleted": ["gcal.event"],
    "purchase.made": ["gmail.receipt"], "subscription.changed": ["gmail.receipt"], "listing.posted": ["gmail.receipt"],
    "message.sent": [], "other": []
  },
  "featuresByType": {
    "email.sent":           ["timeProximity", "counterpartyExact", "counterpartyDomain", "counterpartyName", "subjectOverlap"],
    "calendar.created":     ["timeProximity", "subjectOverlap", "counterpartyExact", "counterpartyDomain", "counterpartyName"],
    "calendar.updated":     ["timeProximity", "subjectOverlap", "counterpartyExact", "counterpartyDomain", "counterpartyName"],
    "calendar.deleted":     ["timeProximity", "subjectOverlap", "counterpartyExact", "counterpartyDomain", "counterpartyName"],
    "purchase.made":        ["timeProximity", "amountExact", "merchantMatch", "subjectOverlap"],
    "subscription.changed": ["timeProximity", "amountExact", "merchantMatch", "subjectOverlap"],
    "listing.posted":       ["timeProximity", "amountExact", "merchantMatch", "subjectOverlap"],
    "message.sent": [], "other": []
  },
  "identityFeatures": {
    "email.sent": ["counterpartyExact", "counterpartyName"],
    "calendar.created": ["subjectOverlap", "counterpartyExact", "counterpartyName"],
    "calendar.updated": ["subjectOverlap", "counterpartyExact", "counterpartyName"],
    "calendar.deleted": ["subjectOverlap", "counterpartyExact", "counterpartyName"],
    "purchase.made": ["amountExact", "merchantMatch"], "subscription.changed": ["amountExact", "merchantMatch"],
    "listing.posted": ["amountExact", "merchantMatch"], "message.sent": [], "other": []
  },
  "allowlistTypes": ["email.sent", "calendar.created", "calendar.updated", "calendar.deleted"],
  "spendTypes": ["purchase.made", "subscription.changed"],
  "commonDomains": ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
                    "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"],                 // chosen
  "receiptMerchants": [],                       // normalised merchant names, one per shipped receipt parser (Sprint 2.3; a test pins it to the parser list); empty = no purchase is covered yet
  "normalize": { "stopWords": ["a", "an", "the", "and", "or", "of", "to", "for", "on", "in", "at", "with", "from", "by", "is", "it", "this", "that", "your", "my", "our"] },   // chosen
  "rules": [
    { "id": "unasked",                 "when": { "unaskedLikely": true },                                         "then": "UNASKED" },
    { "id": "over_scope_observed",     "when": { "observedScopeExceedsDeclared": true },                          "then": "OVER_SCOPE" },
    { "id": "over_scope",              "when": { "typeNotInGrant": true },                                        "then": "OVER_SCOPE" },
    { "id": "over_allowlist",          "when": { "counterpartyNotAllowed": true },                                "then": "OVER_SCOPE" },
    { "id": "over_ceiling",            "when": { "amountAboveCeiling": true },                                    "then": "OVER_SCOPE" },
    { "id": "over_ceiling_cumulative", "when": { "cumulativeAboveCeiling": true },                                "then": "OVER_SCOPE" },
    { "id": "no_target",               "when": { "targetMissing": true },                                         "then": "UNVERIFIABLE" },
    { "id": "underspecified",          "when": { "underspecified": true },                                        "then": "UNVERIFIABLE" },
    { "id": "no_coverage",             "when": { "coverage": "none" },                                            "then": "UNVERIFIABLE" },
    { "id": "verified",                "when": { "bestScoreGte": "verified" },                                    "then": "VERIFIED" },
    { "id": "partial",                 "when": { "bestScoreGte": "partial" },                                     "then": "PARTIAL" },
    { "id": "pending",                 "when": { "graceElapsed": false },                                         "then": "PENDING" },
    { "id": "partial_coverage",        "when": { "coverage": "partial", "bestScoreLt": "partial" },               "then": "UNVERIFIABLE" },
    { "id": "not_found",               "when": { "graceElapsed": true, "coverage": "full", "bestScoreLt": "partial" }, "then": "NOT_FOUND" }
  ],
  "unasked": {
    "signals": { "agentSessionActive": 0.4, "userIdle": 0.3, "agentSignature": 0.5, "activityLogAdjacent": 0.4 },
    "threshold": 0.6,                                                       // at least 1 bp (§5.3)
    "windows": { "sessionMin": 10, "idleMin": 2, "adjacentMin": 2 },        // sessionMin, idleMin chosen; adjacentMin per task 1.7
    "signatures": { "muse": [], "chatgpt": [], "dots": [], "claude": [] }  // empty until captured fixtures show real ones; never invented
  },
  "allowlistedFields": {
    "gmail.sent":    ["counterparty", "subjectHint", "occurredAt", "rowKeyHash", "contentHash"],
    "gmail.receipt": ["merchant", "amountCents", "currency", "subjectHint", "occurredAt", "rowKeyHash", "contentHash"],
    "gcal.event":    ["subjectHint", "occurredAt", "counterparty", "rowKeyHash", "contentHash"]
  }
}
```

## 13. Module contracts (Sprint 1)

All in `src/core`, all pure. Async appears only where an injected index is awaited. Dependencies point downward only (no cycles):
`unicode-table-*, invariant-error, units, sha256, base32, punycode → unicode-baseline, hash, normalize-time → schema → normalize, policy, ratio → window → order → redact, candidates, features → conditions, receipt → scope, attribution → grade → state, batch-fixed → batch → replay`. `unicode-baseline` imports only the generated `unicode-table-*` files, and `normalize-time` only `units`; `schema` reads its character classes from `unicode-baseline` (through `schema-text`).

| Module | Exports |
|---|---|
| `invariant-error.ts` | `InvariantError` with closed codes `no_such_row` (batch-table.ts) and `write_after_digest` (sha256.ts); a leaf module that imports nothing |
| `units.ts` | `MS_PER_MINUTE`, `MS_PER_HOUR`, `MS_PER_DAY`, `BASIS_POINTS`, `CURRENCY_MINOR_UNITS` |
| `hash.ts` (+ `sha256.ts`, `base32.ts`) | `sha256Hex(text)`, `canonicalJson(value)`, `idFromHash(hex)` |
| `schema.ts` | Branded `Ulid`, `Sha256`, `IsoTs`; `AgentId`, `ActionType`, `ObservationSource`, `ClaimPrecision`, `Request`, `Claim` (§7 + `targetAt?`, `claimedAtPrecision`, `claimedAtEnd?`), `ReasonParams`, `Observation` (§7 + `rowKeyHash?`), `Grant` (§7 + `spendCurrency?` (required when `spendCeilingCents` is set), `accounts?`), `Grade`, `ReceiptState`, `ReasonCode`, `Reason`, `Receipt` (§7 + `agent`, `policyHash`, `attribution?: 'likely'`, `override?`, `reverted?`, `supersededBy?`, `reasons: Reason[]`), `ObserverCoverage`, `Coverage`, `Attribution` (with `adapterLastSyncAt`), `GradeContext`, `Activity`, `HealthReport`, `SCHEMA_LIMITS` (`amountCents` ≥ 0, ≤ 10¹²). `src/ledger/types.ts` re-exports these. `counterparty`, `merchant` and `subjectHint` (Claim and Observation) are one line: no `\p{Cc}` (tab, CR, LF, NUL, U+0085, …), U+2028 or U+2029 (`schema-text.ts`: `ONE_LINE`, `oneLineText`); invisible format marks (`\p{Cf}`) are allowed. Adapter, observer and extractor ids and versions (`HealthReport.adapterId`/`version`, `Claim.extractor.id`/`version`, `ObserverCoverage.observerId`, and on the bus `adapter.claims` `adapterId`/`version`, `observer.observations` `observerId`/`version`, `coverage.ping` `observerId`) are `ComponentId` tokens (`schema-text.ts` `COMPONENT_ID`: an ASCII letter or digit, then letters, digits, `.`, `_`, `+` or `-`; 1 to `SCHEMA_LIMITS.ID` characters). Each `HealthReport.reasons` item is a reason code (`HEALTH_REASON`: lowercase snake_case segments joined by dots, at most `SCHEMA_LIMITS.ID` characters, e.g. `selector.missing`), never text. `Request.conversationId` is a vendor id (`schema-text.ts` `VENDOR_ID`, `vendorId`: empty, or an ASCII letter or digit then letters, digits, `.`, `_`, `:`, `+` or `-`; at most `SCHEMA_LIMITS.CONVERSATION_ID` characters), never a title or a line of chat. `Grant.counterpartyAllowlist` entries, `Grant.declaredScopes` and `Grant.observedScopes` items, and `GradeContext.scope.observed` are one line (`oneLineText`). |
| `normalize.ts` (+ `punycode.ts`, `unicode-baseline.ts`) | `email`, `sameAddress`, `name`, `nameTokens`, `amount`, `subjectTokens`, `stopWordKey`, `instantMs`, `isoWithOffset`, `resolveRelative` → `{start, end, precision}` |
| `policy.ts` | `loadPolicy` → frozen `Policy` with basis-point weights/thresholds and `policyHash` (throws `PolicyError('invalid_policy')` with one "path: problem" line per issue, including a rule without its evidence, §6); `assertLoadedPolicy(policy)` throws `PolicyError('policy_not_loaded')` for any object `loadPolicy` did not return; `isLoadedRules(rules)` is true only for the `rules` array of a policy `loadPolicy` returned (conditions.ts `firstMatch` keeps its per-rule memo only for such an array) |
| `redact.ts` | `project(source, raw, { type, observedAt, rowKey? }, policy)` → `Observation` (reads only own data properties; an allowlisted field held by an accessor (getter or setter) or inherited from a prototype, `occurredAt` included, refuses the whole row with `RedactError('invalid_field')` and is never invoked or read; fields the allowlist does not name are never looked at; an allowlisted own value other than `occurredAt` that fails its Observation field schema refuses the whole row with `RedactError('invalid_field')` and is never dropped, cut or coerced (only `subjectHint` is first cut to 80 code points); otherwise throws `RedactError('missing_occurred_at')` or `RedactError('invalid_argument')`); `contentHashOf(observation)` (the one §10 content hash: `project`, the ledger and replay call it); `observationIntegrityProblems(observation, policy)` → `[field, message][]` (each content field its source's allowlist does not name, and a `contentHash` that is not `contentHashOf` its content; `rowKeyHash` is not checked against the allowlist, because `project` keeps it whenever there is a row id); `hashText(text)` |
| `candidates.ts` | `ObservationIndex`, `createMemoryIndex`, `candidates`, `assign(pairs, policy, fixed, taken)`, `exclusiveCandidates` |
| `ratio.ts` | `Ratio` (`{num, den}` as bigint), `ratio`, `compareRatio`, `ratioGteBasisPoints`, `weightedScore` |
| `window.ts` | `precisionBounds`, `claimWindow`, `inClaimWindow`, `precisionStartMs`, `writtenOffsetMinutes` (throws `WindowError('no_offset')` for text without a trailing offset) |
| `order.ts` (internal) | `compareText`, `compareNumbers`, `representative`, `compareCandidates`, `mergeIntervals`, `fromRelevantSource`, `hasFirstSeenRule`, `firstSeenFromMs`, `passesFirstSeen`: the §3/§4.1 rules candidates.ts, batch-retrieve.ts, batch-orphans.ts and grade-guard.ts share |
| `features.ts` | `applicableFeatures`, `isUnderspecified`, `isAssignable`, `features` → `{ score: Ratio, signals, reasonCodes }` (assignable claims only) |
| `conditions.ts` | `coverageLevel(claim, grant, coverage, policy)`, `graceElapsed(claim, grant, coverage, policy)`, condition evaluators, `isFinalizable({outcome, rule, claim, orphan, grant, coverage, context, policy, candidateDependent, eligible?})` → `{final, finalAt?}` (`FinalityInput`, §8) |
| `receipt.ts` | `receiptId(subject)`, `inputsHash(inputs)`, receipt builder |
| `scope.ts` | `priorSpendCents(claim, claims, policy, spendCurrency?)`, `spendIndex(claims, policy)` → `(claim, spendCurrency?) => number`, `scopeSubjects(grant)` |
| `attribution.ts` | `attribute(observation, activity, policy, evaluatedAt?)` → `Attribution \| null`; `attributor(activity, policy, evaluatedAt?)` → reusable per batch; refuses a policy `loadPolicy` did not return with `PolicyError('policy_not_loaded')` |
| `reason-text.ts` | `reasonText(reason)` → one English sentence per ReasonCode (UI rendering; every `unasked.*` text says "likely"); depends only on `schema`; throws `ReasonTextError('unknown_code')` with no detail (an unparsed code is never repeated, Hard Rule 10) or `ReasonTextError('invalid_params', code or code.param)` |
| `grade.ts` (+ `grade-guard.ts`) | `grade(claim \| null, candidates, grant, policy, coverage, context)`; throws `GradeError` (`foreign_candidate`, `claimless_subject`, `agent_mismatch`, `unasked_with_claim`, and `unknown_reason_code` for a schema older than the contract) and `PolicyError('policy_not_loaded')` (grade, gradeOrphan, gradeClaim) |
| `state.ts` | `transition(receipt, event)` for `regrade`, `override`, `revert` (with its instant), `supersede`; `IllegalTransitionError` (codes include `regrade_held`) |
| `batch.ts` | `gradeBatch(claims, index, grants, policy, coverage, activity, fixed)` → `Promise<{receipt, inputs}[]>`; `fixed` lists `{observationId, claimId, after, until?, released?}` (`claimId: null` for a taken observation), of which `gradeBatch` fixes those in force at `evaluatedAt`. It throws `BatchError('claim_fixed')` for a graded claim named by one that has not ended, and `BatchError('stale_evaluated_at')` for a claim pair from a grading at or after `evaluatedAt`. `preAssignments(receipts)`, `inForceAt`, `fixedInForce`, `heldOutAt` and `gradedAt` (batch-fixed.ts, with batch-fixed-claims.ts) derive them for the background and for replay. |
| `replay.ts` | `LedgerSnapshot`, `ReplayReport`, `replay(snapshot)` (throws `PolicyError('policy_not_loaded')` for an unloaded snapshot policy) |

## 14. Deviations from build_spec §7 (all in Decisions.md, Sprint 1)

1. `grade()` takes a sixth argument, `context` (cumulative spend, attribution, scope), required and hashed (Hard Rule 4 needs every input in the hash).
2. Receipt ids derive from the subject (claim, orphan observation, scope), not from `inputsHash`; `inputsHash` is stored. Idempotency is kept: same subject → same row.
3. Receipt gains `agent`, `policyHash`, `attribution`, `override`, `reverted`, and structured `reasons`. Claim gains `targetAt` and `claimedAtPrecision`. Observation gains `rowKeyHash`. Grant gains `spendCurrency` and `accounts`.
4. The policy gains the keys in §12, the over-scope rules move before `no_coverage`, and `not_found` requires full coverage.
5. Finality is per outcome (§8): VERIFIED after a sync at `end(p,t) + graceMin`; PARTIAL and NOT_FOUND only after the whole window was seen; coverage-based UNVERIFIABLE after `finalizeUnverifiableHours`.
6. `USER_OVERRIDDEN` can be reverted (Sprint 4.3). A revert carries its instant and keeps the override in `reverted`, so a revert never erases what a batch saw (§8).
7. `src/core` gains `units.ts`, `hash.ts`, `sha256.ts`, `base32.ts`, `punycode.ts`, `ratio.ts`, `window.ts`, `conditions.ts`, `receipt.ts`, `batch.ts` beside the §6 file list; the no-literal test exempts `sha256.ts`, `base32.ts`, `punycode.ts`, `units.ts` and `schema.ts` with a reason each.
8. Text is read by a pinned Unicode baseline, 15.0.0, not by the engine's own Unicode version (SEC-1, Hard Rule 4). `src/core` gains `unicode-baseline.ts` (`asBaseline`, `onBaseline`, `trimBaseline`, `lowerBaseline`, `BASELINE_CLASS`) and the generated `unicode-table-assigned.ts`, `unicode-table-classes.ts` and `unicode-table-case.ts`. These are written by `scripts/gen-unicode-baseline.ts` from the UCD files committed in `scripts/ucd/15.0.0/` (DerivedAge, DerivedGeneralCategory, PropList, WordBreakProperty; SHA-256 checked). `tests/unit/core/unicode-tables.spec.ts` fails when a table is stale or hand-edited, and `tests/unit/core/unicode-fence.spec.ts` walks the syntax tree of every file in `src/core` and its subdirectories (any file there other than a `.ts` source and the top-level `tsconfig.json` fails). It refuses engine `\p{…}`, `\s`, `trim()`, case mapping and Unicode case folding elsewhere: an `i` flag with `u` or `v`, an `i` pattern that is not plain ASCII or holds a backreference, and any inline modifier group. It also refuses any regular expression built from text only run time knows (controls in `tests/unit/core/unicode-fence-controls.spec.ts` and `tests/unit/core/unicode-fence-pins.spec.ts`). Like the purity fences (item 9), it catches engine Unicode reached by accident or through ordinary idioms. Deliberately evasive code, such as a method name composed from fragments at run time to dodge every check, is a code-review matter.
9. The purity fences on `src/core` (Hard Rule 4) are three: lint (`eslint-rules/core-fences.js` and `attest/core-determinism`, with type information), the grep test (`tests/unit/core/core-purity.spec.ts`), and a runtime guard (`tests/unit/core/core-poison.ts`) installed before any `src/core` module loads. `pnpm test:poison` runs every core, golden and property test under the guard and fails on any impure call, any changed built-in, or less than 95% of `src/core`'s lines run. The fences catch impurity written by accident or through ordinary idioms. Deliberately evasive code is a code-review matter. These forms still pass lint and the grep test: (a) a key built at run time and held in a plain name, read by reflection from a value whose type does not show a Date: `const k = ['getTimezone', 'Offset'].join(''); Reflect.get(Object.getPrototypeOf(d as object), k)`; the guard catches the call when a test runs it. (b) A Date passed through a type that hides it, then made text: `(v: { toString(): string }) => v.toString()`; the guard catches it when run. (c) A built-in changed through a key built at run time on a prototype reached by reflection: `(Object.getPrototypeOf('') as Record<string, unknown>)[k] = f`; the poisoned run reports the changed built-in after the test that ran it. (d) Code that stays pure only while it detects the guard, for example by testing `Date.now.name`; no runtime check can rule this out. (e) An impure path that no core, golden or property test runs; the guard sees only code that runs, and the 95% floor limits how much code that can be, not which. (f) A stacked type assertion through a function call or more than five containers: `identity(x as unknown) as string`. (g) For the grep test only, forms that need types: `String(date)`, `${date}`, a key built from fragments; typed lint and the guard catch these.

Every change to `src/core` is also read by the reviews that close each sprint: the security review covers every file the sprint touched ([agents/security_reviewer.md](../agents/security_reviewer.md)), and the tech review checks `src/core` for clocks, randomness and impure imports ([agents/tech_reviewer.md](../agents/tech_reviewer.md)). Those reviews, not the fences of items 8 and 9, are the check on deliberately evasive code.

## 15. Golden scenarios (`tests/golden/`)

Each scenario is one JSON file, `tests/golden/<nn>-<slug>.json`, written from this document alone — never from the code. This section is the whole file format: [`scenario-schema.ts`](../extension/tests/golden/scenario-schema.ts) is its strict Zod schema (an unknown key fails at every level), and `pnpm check-docs` fails when a key that schema accepts is missing from the examples below. [`tests/golden/README.md`](../extension/tests/golden/README.md) explains how the files are checked and how to compute an expectation by hand; it adds no format rule. Hand-written files use short refs (`c1`, `o2`, `g1`); the loader (`tests/golden/load.ts`) builds full, schema-valid objects from them, fills documented defaults, and computes every hash and id with `hash.ts`. Ids and hashes are never typed by hand; a generated snapshot (`tests/golden/__snapshots__/ids.json`, written by a script and reviewed) pins their stability.

A minimal file (golden 01):

```jsonc
{
  "name": "exact match, same minute",
  "covers": ["ledger_engineer:exact_match"],          // which mandatory scenario(s) or contract rule it proves
  "mode": "batch",                                     // "batch" runs gradeBatch; "grade" calls grade() directly
  "policyPatch": { },                                  // optional JSON merge patch on policy/default.json, validated by loadPolicy
  "input": {
    "evaluatedAt": "2026-10-06T15:00:00-04:00",
    "claims":       [{ "ref": "c1", "agent": "muse", "type": "email.sent", "counterparty": "priya@company.com",
                       "subjectHint": "Q3 deck", "claimedAt": "2026-10-06T14:02:00-04:00" }],
    "observations": [{ "ref": "o1", "source": "gmail.sent", "type": "email.sent", "counterparty": "priya@company.com",
                       "subjectHint": "Q3 deck", "occurredAt": "2026-10-06T14:02:00-04:00" }],
    "grants":       [{ "agent": "muse" }],              // defaults: all types allowed, no allowlist, no ceiling, no accounts
    "coverage":     [{ "source": "gmail.sent", "lastSyncAt": "…", "windowStart": "…", "windowEnd": "…", "accountHash": "acct-a" }],
    "activity":     { },                                // optional, §7 shape with refs
    "fixed":        [ ]                                 // optional [{ "claim": "c9", "observation": "o9" }]
  },
  "expect": [{ "ref": "c1", "grade": "VERIFIED", "ruleId": "verified", "state": "FINAL",
               "observationRefs": ["o1"], "score": "1/1", "reasonCodes": ["match.best"] }]
}
```

Every key a file may hold. This is a catalogue, not one valid file: `input.grade` belongs to grade mode, while `fixed`, `regrade` events and `expect[].inputs` belong to batch mode; an observation holds only its source's fields (`counterparty` from `gmail.sent` or `gcal.event`; `merchant`, `amountCents` and `currency` from `gmail.receipt`, §12), and `allCalendars` describes a `gcal.event` entry.

```jsonc
{
  "name": "…",                                         // at most 120 characters
  "covers": ["ledger_engineer:exact_match", "edge:…", "contract:…"],
  "mode": "batch",                                     // or "grade"
  "policyPatch": { },
  "notes": ["the hand computation, one step per line"],   // or one string
  "input": {
    "evaluatedAt": "…",
    "claims": [{ "ref": "c1", "agent": "muse", "type": "purchase.made", "counterparty": "…", "amountCents": 4999,
                 "currency": "USD", "subjectHint": "…", "claimedAt": "…", "claimedAtPrecision": "day",
                 "claimedAtEnd": "…", "targetAt": "…", "observedAt": "…", "sourceKind": "activity_view",
                 "text": "…", "rowKey": "label" }],
    "observations": [{ "ref": "o1", "source": "gmail.receipt", "type": "purchase.made", "counterparty": "…",
                       "merchant": "…", "amountCents": 4999, "currency": "USD", "subjectHint": "…",
                       "occurredAt": "…", "observedAt": "…", "rowKey": "label" }],
    "grants": [{ "ref": "g1", "agent": "muse", "allowedTypes": ["purchase.made"], "counterpartyAllowlist": ["…"],
                 "spendCeilingCents": 5000, "spendCurrency": "USD", "declaredScopes": ["…"], "observedScopes": ["…"],
                 "accounts": { "gmail.receipt": ["acct-a"] }, "updatedAt": "…" }],
    "coverage": [{ "observerId": "…", "source": "gmail.receipt", "lastSyncAt": "…", "windowStart": "…",
                   "windowEnd": "…", "accountHash": "acct-a", "allCalendars": true }],
    "activity": { "sessions": [{ "agent": "muse", "at": "…" }], "idle": [{ "from": "…", "to": "…" }],
                  "entries": [{ "agent": "muse", "at": "…", "type": "email.sent" }],
                  "adapterSyncs": [{ "agent": "muse", "lastSyncAt": "…" }], "claims": ["c1"] },
    "fixed": [{ "claim": "c9", "observation": "o9" }, { "claim": null, "observation": "o3" }],
    "grade": { "claim": null, "candidates": ["o1"], "agent": "muse", "priorSpendCents": 0, "scope": "…" }
  },
  "events": [{ "event": "override", "ref": "c1", "grade": "VERIFIED", "reason": "…", "at": "…" },
             { "event": "supersede", "ref": "o1", "claim": "c1" },
             { "event": "regrade", "ref": "c1", "evaluatedAt": "…" },
             { "event": "regrade", "ref": "o2", "evaluatedAt": "…", "deleted": true },
             { "event": "override", "ref": "c1", "grade": "NOT_FOUND", "reason": "…", "at": "…", "rejected": true }],
  "assertIds": { "equal": [["o1", "o2"]], "ascending": [["c3", "c4"]] },
  "expect": [{ "ref": "c1", "grade": "VERIFIED", "ruleId": "verified", "state": "FINAL", "observationRefs": ["o1"],
               "score": "1/1", "reasonCodes": ["match.best"],
               "reasonParams": { "match.best": { "observationId": "o1" } },
               "agent": "muse", "inputs": { "grant": "g1", "priorSpendCents": 0, "scope": "…" } },
             { "ref": "c2", …, "state": "USER_OVERRIDDEN", "override": "NOT_FOUND", "previousState": "FINAL" },
             { "ref": "o1", "grade": "UNASKED", …, "attributionScore": "7/10", "supersededBy": "c1" },
             { "scope": { "agent": "muse", "scope": "gmail.read" }, "grade": "OVER_SCOPE", … }]
}
```

- **Top level.** `name` (at most 120 characters), `covers` (at least one `"<kind>:<id>"` tag naming the mandatory scenario, edge case or contract rule the file proves), `mode`, `input` and `expect` are required. `policyPatch` is an optional RFC 7386 JSON merge patch on `policy/default.json` (an array replaces the whole array), and the patched document must load with `loadPolicy`. `notes` (optional, one string or a list) holds the hand computation, one step per line.
- **Refs.** Claims are `c<n>`, observations `o<n>`, grants `g<n>`. Every ref a file uses resolves to an object of the file.
- **`mode`.** `"batch"` runs `gradeBatch` (§3) on every claim of `input.claims` that `fixed` does not name, with the observations in a memory index. `"grade"` makes the one `grade()` call `input.grade` describes, which grade mode requires and batch mode refuses: `claim` (a ref, or `null`), `candidates` (observation refs, passed as given), `agent` (whose grant in force applies; required when `claim` is null, else the claim's agent), `priorSpendCents` (`context.priorSpendCents`, default 0) and `scope` (`context.scope.observed`). A claim-less call in a file with `activity` also gets `context.attribution = attribute(candidates[0], activity, policy, evaluatedAt)` (§7).
- **Claims.** `ref`, `agent`, `type` and `claimedAt` are required. `counterparty`, `amountCents`, `currency`, `subjectHint`, `claimedAtPrecision`, `claimedAtEnd` (§4.1: `day` precision only), `targetAt`, `observedAt` and `sourceKind` are the `Claim` fields of those names. `text` is the normalised claim text that feeds `rawHash` (§10), and `rowKey` a label for the vendor's own row id.
- **Observations.** `ref`, `source`, `type` and `occurredAt` are required; `counterparty`, `merchant`, `amountCents`, `currency`, `subjectHint`, `observedAt` and `rowKey` are optional. An observation holds only fields `allowlistedFields[source]` names, from a source that sees its type.
- **Grants.** `agent` is required. `allowedTypes`, `counterpartyAllowlist`, `spendCeilingCents` (with `spendCurrency`), `declaredScopes`, `observedScopes` and `accounts` (source → account labels) are the `Grant` fields; `updatedAt` is when the grant took effect, and `ref` (optional) lets `expect[].inputs.grant` name it. An agent may have several grants: the one in force is the latest `updatedAt ≤ evaluatedAt` (§3), one agent's grants never share an instant, and every agent a claim or an expectation names has a grant in force.
- **Coverage.** One `ObserverCoverage` (§3) per entry: `source`, `lastSyncAt`, `windowStart`, `windowEnd`, and optionally `observerId`, `accountHash` (a label) and `allCalendars`.
- **`activity`** (optional): the §7 `Activity` with refs: `sessions` (`agent`, `at`), `idle` (`from`, `to`), `entries` (`agent`, `at`, `type`), `adapterSyncs` (`agent`, `lastSyncAt`) and `claims` (claim refs).
- **`fixed`** (batch mode, optional): FINAL or USER_OVERRIDDEN pre-assignments (§4.3), `{claim, observation}`. A claim named here already holds its receipt: it is not passed to `gradeBatch` and has no expectation. `claim: null` is an overridden UNASKED receipt, whose observation is taken. Each pair was fixed before every instant the file grades at, so it is in force in every grading of the file (§4.3).
- **`events`** (optional): state events applied with `state.ts` `transition()` after grading, in order (§8), each naming its receipt by `ref` (a claim, or an orphan observation for an UNASKED receipt). `override` carries `grade` (`VERIFIED` or `NOT_FOUND`), `reason` and `at`. `supersede` names the `claim` that supersedes an UNASKED receipt. `regrade` (batch mode) grades the same inputs again at its `evaluatedAt`, each input filtered by that instant (§3), and installs the subject's new receipt; with `deleted: true` that grading returns no receipt for the subject, and the caller deletes the PENDING UNASKED receipt (§7). `rejected: true` marks an illegal event: `transition` must throw `IllegalTransitionError` and nothing changes (a stale regrade, a regrade of a FINAL receipt, an override dated before `computedAt`).
- **`assertIds`** (optional): when an expectation depends on hash-derived ids (a tie broken by id, a dedupe by `contentHash`), the id relations it relies on: each `equal` pair has one id, each `ascending` pair is in id order. The spec checks each one.
- **`expect` is the whole result.** In batch mode it lists every receipt `gradeBatch` returns: a missing or an extra receipt fails. In grade mode it holds exactly the one receipt. Receipts are compared after the events. Each entry names its subject with exactly one of `ref` (a claim ref for a claim receipt, an observation ref for that orphan's UNASKED receipt) and `scope` (`{agent, scope}`, a scope-diff receipt), and gives `grade`, `ruleId`, `state`, `observationRefs`, `score` and `reasonCodes` (an exact, ordered list). Optional: `reasonParams` (below); `agent`, the receipt's agent; `attributionScore`, an UNASKED receipt's attribution score as a reduced fraction; `override` (the override's grade) and `previousState` (`PENDING` or `FINAL`, the state before it) on a USER_OVERRIDDEN receipt; `supersededBy`, the superseding claim's ref; and, in batch mode, `inputs`, what `gradeBatch` returned with the receipt (§3): `grant` (a grant ref, which must be the grant in force), `priorSpendCents` (`context.priorSpendCents`) and `scope` (`context.scope.observed`).
- `score` is the best candidate's exact score as a reduced fraction `"p/q"`, or `null` when no candidate was scored. `expect[].reasonParams` (optional) holds the params of every reason keyed by code, exactly per the closed table below: ids are written as refs, a `scopeHash` is written as the observed scope (the loader stores `sha256Hex(scope)`), and a `source` is left out for a type with no sources; the runner then compares reasons exactly. `__snapshots__/ids.json` is written by `tests/golden/write-ids.ts`. Expected values are computed by hand from §5 in basis points.
- `accountHash` values like `"acct-a"`, and `accounts` entries, are labels; the loader replaces each label with the SHA-256 of the label. A `rowKey` label becomes `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (§10), in `rawHash` for a claim and in `contentHash` for an observation.
- Defaults the loader fills: claim `extractor` (`{id: 'golden', version: '1', confidence: 1}`), `sourceKind: 'activity_view'`, `claimedAtPrecision: 'minute'`, claim `observedAt` = `claimedAt`, claim `text` (for `rawHash`, §10) = the claim's `ref` unless given, `requestId` absent; observation `observedAt` = the earliest `lastSyncAt` ≤ `evaluatedAt` among its source's coverage entries whose interval contains `occurredAt`, else `evaluatedAt`; observation `contentHash` per §10; grant: every type allowed, no allowlist, no ceiling, no scopes, no `accounts`, `updatedAt` = `evaluatedAt` minus one day; coverage `observerId` = its `source`; `activity` lists empty and `activity.claims` = every claim of the file.
- A scenario must state every input that decides its outcome: coverage with `accountHash` (else coverage is capped at partial), a non-common domain when it relies on `counterpartyDomain`, `targetAt` for calendar claims, positive idle evidence for `userIdle`. Invisible characters (zero-width, bidi) are written as JSON `\u` escapes, never raw.

**ReasonCode** (closed enum in `schema.ts`; params are ids, ISO timestamps from the inputs, numbers, enum values):

| Code | When |
|---|---|
| `match.best` | a best candidate exists (params: `observationId`) |
| `match.none` | no candidate was scored |
| `cp.plus_tag`, `cp.confusable`, `cp.non_ascii` | §5.1 |
| `claim.too_vague` | rule `underspecified` |
| `claim.no_target` | rule `no_target` |
| `coverage.none`, `coverage.partial` | rules `no_coverage`, `partial_coverage` (params: `source`) |
| `coverage.account_unbound` | NOT_FOUND graded without `grant.accounts` for the source |
| `coverage.calendars_hidden`, `coverage.multiple_accounts`, `coverage.no_account`, `coverage.no_parser` | why coverage was capped at partial |
| `coverage.never_completed` | a `pending` outcome finalised after `finalizeUnverifiableHours` |
| `grace.waiting` | rule `pending` (params: `source`) |
| `scope.type_not_allowed` | rule `over_scope` (params: `type`) |
| `scope.counterparty_not_allowed` | rule `over_allowlist` |
| `allowlist.unchecked` | allowlist not checkable for a name-only claim |
| `ceiling.exceeded` | rule `over_ceiling` (params: `amountCents`, `ceilingCents`) |
| `ceiling.cumulative_exceeded` | rule `over_ceiling_cumulative` (params: `priorSpendCents`, `amountCents`, `ceilingCents`) |
| `ceiling.currency_mismatch` | §6.1 |
| `scope.observed_not_declared` | rule `over_scope_observed` (params: `scopeHash`, never the scope text) |
| `unasked.session`, `unasked.idle`, `unasked.signature`, `unasked.adjacent` | each fired attribution signal (always rendered with "likely") |
| `override.user` | USER_OVERRIDDEN (params: `grade`) |
| `superseded` | an UNASKED receipt superseded by a claim (params: `claimId`) |

**Params per code (closed).** `match.best` {`observationId`: Ulid}; `coverage.none`, `coverage.partial`, `grace.waiting`, `coverage.account_unbound`, `coverage.no_account`, `coverage.multiple_accounts`, `coverage.calendars_hidden`, `coverage.no_parser` {`source`: ObservationSource} (omitted for a type with no sources); numeric params are non-negative integers (`-0` is written `0`); `scope.type_not_allowed` {`type`: ActionType}; `ceiling.exceeded` {`amountCents`, `ceilingCents`: int}; `ceiling.cumulative_exceeded` {`priorSpendCents`, `amountCents`, `ceilingCents`: int}; `ceiling.currency_mismatch` {`currency`: the claim's currency when present and ≠ `spendCurrency`, else the assigned candidate's; `spendCurrency`: currency code}; `ceiling.exceeded.amountCents` is the §6.1 Amount; `scope.observed_not_declared` {`scopeHash`: `sha256Hex(scope)`, the observed scope exactly as stored}; `unasked.*` {`agent`: AgentId}; `override.user` {`grade`: the override's grade, `VERIFIED` | `NOT_FOUND`}; `superseded` {`claimId`: Ulid}; every other code has no params. The schema enforces this table, so a reason can never carry an address, a name or a subject.

**Emission** (stated for the shipped rules; in general a rule's own codes are those of the conditions its `when` names that held, cap codes accompany `coverage: 'partial'` and `grace.waiting` accompanies `graceElapsed: false` while PENDING). `coverage.no_parser` is emitted on a `partial_coverage` receipt of a claim with no parser whenever a capped `gmail.receipt` entry overlaps its window, whatever else limited coverage; with the shipped policy (receipt types read only `gmail.receipt`) that is every such receipt. `match.best` (with the best candidate) or `match.none` on every claim receipt, never on claim-less ones; `cp.*` from the best candidate only; the coverage-capping codes (`coverage.no_account`, `coverage.multiple_accounts`, `coverage.calendars_hidden`, `coverage.no_parser`) only when `ruleId` is `partial_coverage`; `coverage.none` only for `no_coverage`; `coverage.account_unbound` only on NOT_FOUND; `coverage.never_completed` is the `pending` rule's own code once that outcome finalises by time (it replaces `grace.waiting`); `grace.waiting` only for `pending` while PENDING; `unasked.*` only on UNASKED; `allowlist.unchecked` only when that condition was not applicable and the receipt is not OVER_SCOPE by another rule; the `verified`, `partial`, `not_found` and `default_unverifiable` rules add no rule code. Golden files compare `reasonCodes` as an exact, ordered list.

Reason codes are ordered: the rule's own code first, then `allowlist.unchecked` if emitted, then coverage reasons, then match and counterparty reasons, each group in table order; `override.user` and `superseded` come last.

## 16. Worked examples

Each example is a golden scenario: a JSON file in [`extension/tests/golden/`](../extension/tests/golden/) that [`golden.spec.ts`](../extension/tests/golden/golden.spec.ts) grades through the core on every `pnpm test` (every file below runs through `gradeBatch`). The file is the source of truth; an example restates its inputs and the hand computation in its `notes`. The **canonical worked example** is the §2 demo as a test, [`extension/tests/unit/core/demo.spec.ts`](../extension/tests/unit/core/demo.spec.ts) (task 1.10): it builds the demo's ledger from synthetic data and walks it step by step, each assertion naming the section that decides it. §16.13 is the same story as a golden file; the two agree on every grade, rule and state.

Numbers are in basis points (bp, §5.3), from §12: `timeProximity` 2500, `counterpartyExact` 3500, `counterpartyDomain` 1500, `counterpartyName` 2500, `subjectOverlap` 1500; `thresholds.verified` 8500 and `thresholds.partial` 5000; `unasked.signals` `agentSessionActive` 4000 and `userIdle` 3000; `unasked.threshold` 6000. A score is `S = N / D`, with `N` = Σ wᵢ·(feature value) and `D` = Σ wᵢ over the applicable features; `S ≥ T` exactly when `10000 · N ≥ T · D`, after multiplying `N` and `D` by the denominators of fractional feature values (§5.3). Unless stated, times are on Tuesday 2026-10-06 in −04:00, claims have minute precision, and the grant is the default one: every type allowed, no allowlist, no ceiling, no `accounts`. "Window" is the §4.1 claim window and "unit" its precision unit `[start(p,t), end(p,t)]`.

| Example | Golden file | Receipt | Grade | Rule | State | Score |
|---|---|---|---|---|---|---|
| [16.1](#161-exact-match-same-minute) | [01-exact-match-same-minute.json](../extension/tests/golden/01-exact-match-same-minute.json) | c1 | VERIFIED | `verified` | FINAL | 1/1 |
| [16.2](#162-recipient-domain-match-subject-partial) | [02-domain-match-subject-partial.json](../extension/tests/golden/02-domain-match-subject-partial.json) | c1 | PARTIAL | `partial` | FINAL | 1/2 |
| [16.3](#163-no-observation-grace-not-elapsed) | [03-pending-grace-not-elapsed.json](../extension/tests/golden/03-pending-grace-not-elapsed.json) | c1 | UNVERIFIABLE | `pending` | PENDING | none |
| [16.4](#164-no-observation-grace-elapsed) | [04-not-found-after-grace.json](../extension/tests/golden/04-not-found-after-grace.json) | c1 | NOT_FOUND | `not_found` | FINAL | none |
| [16.5](#165-gmail-never-synced-in-the-window) | [05-gmail-never-synced-in-window.json](../extension/tests/golden/05-gmail-never-synced-in-window.json) | c1 | UNVERIFIABLE | `no_coverage` | FINAL | none |
| [16.6](#166-purchase-with-no-receipt-parser) | [06-purchase-without-receipt-parser.json](../extension/tests/golden/06-purchase-without-receipt-parser.json) | c1 | UNVERIFIABLE | `partial_coverage` | PENDING | none |
| [16.7](#167-orphan-observation-attribution-07) | [07-unasked-attribution-0-7.json](../extension/tests/golden/07-unasked-attribution-0-7.json) | o1 | UNASKED | `unasked` | FINAL | none |
| [16.8](#168-claim-type-not-in-the-grant) | [08-type-not-in-grant.json](../extension/tests/golden/08-type-not-in-grant.json) | c1 | OVER_SCOPE | `over_scope` | FINAL | 1/1 |
| [16.9](#169-amount-above-the-ceiling) | [09-amount-above-ceiling.json](../extension/tests/golden/09-amount-above-ceiling.json) | c1 | OVER_SCOPE | `over_ceiling` | FINAL | none |
| [16.10](#1610-two-claims-one-observation) | [10-two-claims-one-observation.json](../extension/tests/golden/10-two-claims-one-observation.json) | c1 | NOT_FOUND | `not_found` | FINAL | none |
| [16.10](#1610-two-claims-one-observation) | [10-two-claims-one-observation.json](../extension/tests/golden/10-two-claims-one-observation.json) | c2 | VERIFIED | `verified` | FINAL | 1/1 |
| [16.11](#1611-duplicate-observation) | [11-duplicate-observation-content-hash.json](../extension/tests/golden/11-duplicate-observation-content-hash.json) | c1 | VERIFIED | `verified` | FINAL | 1/1 |
| [16.12](#1612-time-zone-edge-2358-and-0001) | [12-timezone-midnight-edge.json](../extension/tests/golden/12-timezone-midnight-edge.json) | c1 | VERIFIED | `verified` | FINAL | 787/792 |
| [16.13](#1613-the-2-demo) | [13-demo-section-2.json](../extension/tests/golden/13-demo-section-2.json) | c1 | VERIFIED | `verified` | FINAL | 12/13 |
| [16.13](#1613-the-2-demo) | [13-demo-section-2.json](../extension/tests/golden/13-demo-section-2.json) | c2 | NOT_FOUND | `not_found` | FINAL | none |
| [16.13](#1613-the-2-demo) | [13-demo-section-2.json](../extension/tests/golden/13-demo-section-2.json) | o2 | UNASKED | `unasked` | FINAL | none |
| [16.14](#1614-the-2-demo-with-calendar-never-opened) | [14-demo-calendar-coverage-absent.json](../extension/tests/golden/14-demo-calendar-coverage-absent.json) | c2 | UNVERIFIABLE | `no_coverage` | PENDING | none |

"Score" is the best candidate's exact score; "none" means no candidate was scored (a claim receipt then carries `match.none`; an UNASKED receipt has no claim to score). A PENDING receipt by rule `pending` carries the placeholder grade UNVERIFIABLE (§2). [`extension/tests/unit/docs/worked-examples.spec.ts`](../extension/tests/unit/docs/worked-examples.spec.ts) checks every row of this table, and every row of §16.15, against the golden files.

### 16.1 Exact match, same minute

Golden: [`01-exact-match-same-minute.json`](../extension/tests/golden/01-exact-match-same-minute.json).

- **Inputs.** c1: `email.sent` to `priya@company.com`, subject "Q3 deck", claimed 14:02. o1: a `gmail.sent` row to `priya@company.com`, subject "Q3 deck", at 14:02. One `gmail.sent` coverage entry (account `acct-a`) saw 12:00 to 15:00 and synced at 15:00, which is also `evaluatedAt`.
- **Window.** Unit [14:02, 14:03]; window [14:00, 14:48]. Coverage is `full`.
- **Score.** An address claim with a subject: `timeProximity`, `counterpartyExact`, `counterpartyDomain` and `subjectOverlap` apply; `counterpartyName` does not (§5.2). D = 2500 + 3500 + 1500 + 1500 = 9000. o1 is inside the unit (1), the addresses are identical (1, 1), and the token sets are both {q3, deck} (1). N = 9000, so S = 9000/9000 = 1/1, and `10000 · 9000 ≥ 8500 · 9000`.
- **Rule.** No over-scope condition holds and coverage is `full`, so the first match is `verified`.
- **State.** FINAL (§8, VERIFIED): the sync at 15:00 is ≥ end(p,t) + `graceMin` = 14:03 + 30 min = 14:33.
- **Receipt.** VERIFIED, `observationIds` [o1], reasons `match.best`.

### 16.2 Recipient domain match, subject partial

Golden: [`02-domain-match-subject-partial.json`](../extension/tests/golden/02-domain-match-subject-partial.json).

- **Inputs.** c1 as in 16.1. o1: to `raj@company.com`, subject "Q3 budget", at 14:02. Coverage as in 16.1.
- **Score.** D = 9000 (as in 16.1). `timeProximity` 1. `counterpartyExact` 0: different local parts, both ASCII, no `+tag`, so no `cp.*` reason. `counterpartyDomain` 1: the same domain, `company.com` ∉ `commonDomains`, neither address confusable. `subjectOverlap`: {q3, deck} against {q3, budget} is |{q3}| / |{q3, deck, budget}| = 1/3. N = 2500 + 0 + 1500 + 1500 · 1/3 = 4500, so S = 4500/9000 = 1/2.
- **Rule.** `verified`: `10000 · 4500 = 45 000 000 < 8500 · 9000 = 76 500 000`, no. `partial`: `10000 · 4500 = 45 000 000 ≥ 5000 · 9000 = 45 000 000`, yes, with equality. Summed in floating point the score is 0.5 or 0.49999999999999994 depending on the order (§5.3); the exact comparison gives `partial` every time.
- **State.** FINAL (§8, PARTIAL needs `graceElapsed`): 15:00 is ≥ end + `graceMin` = 14:33 and ≥ end + `afterClaimMin` = 14:48.
- **Receipt.** PARTIAL, `observationIds` [o1], reasons `match.best`.

### 16.3 No observation, grace not elapsed

Golden: [`03-pending-grace-not-elapsed.json`](../extension/tests/golden/03-pending-grace-not-elapsed.json).

- **Inputs.** c1 as in 16.1; no observation. The only `gmail.sent` entry saw 12:00 to 14:20 and synced at 14:20, which is also `evaluatedAt`.
- **Coverage.** The entry overlaps the window [14:00, 14:48] but does not contain it: `partial`, so `no_coverage` does not match.
- **Rule.** No candidate, so `verified` and `partial` do not match. `graceElapsed` needs a sync ≥ 14:33 and ≥ 14:48; 14:20 is neither, so `pending` matches.
- **State.** PENDING, shown as "checking". Unless a later grading changes it, the `pending` outcome finalises as UNVERIFIABLE with reason `coverage.never_completed` once `evaluatedAt` ≥ end + `finalizeUnverifiableHours` = 10-07 14:03 (§8).
- **Receipt.** grade UNVERIFIABLE (the placeholder, §2), no score, reasons `grace.waiting` {source: `gmail.sent`}, `match.none`.

### 16.4 No observation, grace elapsed

Golden: [`04-not-found-after-grace.json`](../extension/tests/golden/04-not-found-after-grace.json).

- **Inputs.** c1 as in 16.1; no observation; coverage as in 16.1 (12:00 to 15:00, synced 15:00, one account).
- **Rule.** Coverage is `full`; `graceElapsed` holds (15:00 ≥ 14:33 and ≥ 14:48), so `pending` does not match; with no candidate, `bestScoreLt: partial` is true. `partial_coverage` needs `partial` coverage, so the first match is `not_found`.
- **State.** FINAL (§8, NOT_FOUND needs `graceElapsed`).
- **Receipt.** NOT_FOUND, no score, reasons `coverage.account_unbound` {source: `gmail.sent`} (the grant binds no Gmail account, §6.1) and `match.none`.

### 16.5 Gmail never synced in the window

Golden: [`05-gmail-never-synced-in-window.json`](../extension/tests/golden/05-gmail-never-synced-in-window.json).

- **Inputs.** c1 as in 16.1; no observation; `evaluatedAt` 10-07 15:00. Two `gmail.sent` entries: one saw 10-06 07:00 to 09:00, the other 10-07 12:00 to 15:00.
- **Rule.** Neither entry overlaps the window [10-06 14:00, 14:48], so coverage is `none` and `no_coverage` matches before `verified`, `pending` and `not_found`. The grade is UNVERIFIABLE, never NOT_FOUND: Attest did not look (Hard Rule 5).
- **State.** FINAL (§8): `evaluatedAt` 10-07 15:00 is ≥ end + `finalizeUnverifiableHours` = 10-07 14:03.
- **Receipt.** UNVERIFIABLE, no score, reasons `coverage.none` {source: `gmail.sent`}, `match.none`.

### 16.6 Purchase with no receipt parser

Golden: [`06-purchase-without-receipt-parser.json`](../extension/tests/golden/06-purchase-without-receipt-parser.json) (and [`78-purchase-no-parser-cap.json`](../extension/tests/golden/78-purchase-no-parser-cap.json)).

- **Inputs.** c1: `purchase.made` from "acme", 4999 USD, claimed 14:02. No receipt observation. One `gmail.receipt` entry (account `acct-a`) saw 12:00 to 15:00 and synced at 15:00.
- **Coverage.** `policy.receiptMerchants` is empty (no receipt parser ships yet), so no parser could have read an "acme" receipt: coverage is capped at `partial` with reason `coverage.no_parser` (§6.1), although the entry contains the window [14:00, 14:48].
- **Rule.** No ceiling is set, so the over-scope rules do not match. The claim is not underspecified (`amountExact` and `merchantMatch` apply). No candidate. `graceElapsed` holds (15:00 ≥ 14:33 and ≥ 14:48), so `pending` does not match, and `partial_coverage` does. `not_found` would need coverage `full`, which the cap rules out.
- **State.** PENDING until `evaluatedAt` ≥ end + `finalizeUnverifiableHours` = 10-07 14:03 (§8).
- **Receipt.** UNVERIFIABLE, no score, reasons `coverage.partial` {source: `gmail.receipt`}, `coverage.no_parser` {source: `gmail.receipt`}, `match.none`.

### 16.7 Orphan observation, attribution 0.7

Golden: [`07-unasked-attribution-0-7.json`](../extension/tests/golden/07-unasked-attribution-0-7.json).

- **Inputs.** No claim. o1: a `gmail.sent` row to `vendor@supplier.example`, subject "Re: invoice", at 14:03. Activity: a Muse session ping at 14:00, a recorded idle interval 13:50 to 14:10, and Muse's adapter last synced at 14:50.
- **Attribution (§7).** o1 is an orphan (§4.3), graded as `grade(null, [o1], …)` with Muse's attribution. `agentSessionActive`: 14:00 is within ±`sessionMin` (10 min) of 14:03, 4000 bp. `userIdle`: 13:50 to 14:10 covers [14:01, 14:03], 3000 bp. `agentSignature`: Muse's signature list is empty, so it cannot fire. `activityLogAdjacent`: no activity entry. Score 4000 + 3000 = 7000 bp = 7/10 ≥ 6000.
- **Rule.** `unasked`, with attribution "likely".
- **State.** FINAL (§7): Muse's adapter sync at 14:50 is ≥ `occurredAt` + `beforeClaimMin` + `graceMin` = 14:35, so a late claim can no longer explain o1.
- **Receipt.** UNASKED, `observationIds` [o1], confidence 7/10 (the attribution score), reasons `unasked.session` and `unasked.idle` {agent: `muse`}, each rendered with "likely".

### 16.8 Claim type not in the grant

Golden: [`08-type-not-in-grant.json`](../extension/tests/golden/08-type-not-in-grant.json).

- **Inputs.** c1, o1 and coverage as in 16.1. Muse's grant allows only `calendar.created`, `calendar.updated` and `calendar.deleted`.
- **Rule.** `typeNotInGrant` holds, and `over_scope` comes before `verified` (§6.2). c1 is still assignable (§4.3), so o1 scores 1/1 as in 16.1, is assigned, and is named by `match.best`; it does not become an orphan.
- **State.** FINAL at once (§8): the claim's type alone decided it.
- **Receipt.** OVER_SCOPE, `observationIds` [o1], score 1/1, reasons `scope.type_not_allowed` {type: `email.sent`}, `match.best`.

### 16.9 Amount above the ceiling

Golden: [`09-amount-above-ceiling.json`](../extension/tests/golden/09-amount-above-ceiling.json).

- **Inputs.** c1: `purchase.made` from "acme", 20000 USD ($200.00), claimed 14:02. Muse's grant: `spendCeilingCents` 5000, `spendCurrency` USD. No observation and no coverage at all; `evaluatedAt` 14:05.
- **Rule.** `amountAboveCeiling` (§6.1): `purchase.made` ∈ `spendTypes`, a ceiling is set, and the Amount is the claim's 20000 (no candidate), which is > 5000: `over_ceiling`. Over-scope rules come before `no_coverage` (§6.2), so the agent's own claim decides it with no receipt in view.
- **State.** FINAL at once (§8): the claim's own amount decided it.
- **Receipt.** OVER_SCOPE, no score, reasons `ceiling.exceeded` {amountCents: 20000, ceilingCents: 5000}, `match.none`.

### 16.10 Two claims, one observation

Golden: [`10-two-claims-one-observation.json`](../extension/tests/golden/10-two-claims-one-observation.json).

- **Inputs.** c1: to `priya@company.com`, subject "deck", claimed 14:00. c2: to `priya@company.com`, subject "Q3 deck", claimed 14:02. o1: one sent row to `priya@company.com`, subject "Q3 deck", at 14:02. Coverage as in 16.1.
- **c1 × o1.** c1's unit is [14:00, 14:01]; o1 is Δ = 60 000 ms after it, which equals `toleranceMin`, so `timeProximity` is 1. `counterpartyExact` and `counterpartyDomain` are 1. `subjectOverlap`: |{deck}| / |{q3, deck}| = 1/2. N = 2500 + 3500 + 1500 + 1500 · 1/2 = 8250, so S = 8250/9000 = 11/12: alone, it would verify.
- **c2 × o1.** S = 1/1, as in 16.1.
- **Assignment (§4.3).** One-to-one, best score first: (c2, o1) at 1/1 beats (c1, o1) at 11/12, although c1 was claimed earlier. c2 takes o1.
- **c1.** No candidate is left (`match.none`). Its window [13:58, 14:46] lies inside 12:00 to 15:00, and the sync at 15:00 is ≥ 14:31 and ≥ 14:46: rule `not_found`, FINAL, reasons `coverage.account_unbound`, `match.none`.
- **c2.** Rule `verified`, FINAL (15:00 ≥ 14:33), reasons `match.best`. One observation never verifies two claims.

### 16.11 Duplicate observation

Golden: [`11-duplicate-observation-content-hash.json`](../extension/tests/golden/11-duplicate-observation-content-hash.json).

- **Inputs.** c1 as in 16.1. o1 and o2 are the same sent row (to `priya@company.com`, "Q3 deck", 14:02) read by two syncs, first seen at 14:10 and 14:40. Same source, type and content fields and no row key, so the same `contentHash` (§10) and the same id. Activity: a Muse session ping at 14:00 and idle 13:55 to 14:10.
- **Candidates (§4.1).** Duplicates by `contentHash` count once; the copy first seen earliest is kept.
- **Rule and state.** c1 × o1 = 1/1 as in 16.1: `verified`, FINAL (15:00 ≥ 14:33), one observation id.
- **Why it matters.** Counted twice, the second copy would be an unassigned orphan, and the session and idle signals would turn it into an UNASKED receipt. The batch returns only c1's receipt.

### 16.12 Time-zone edge: 23:58 and 00:01

Golden: [`12-timezone-midnight-edge.json`](../extension/tests/golden/12-timezone-midnight-edge.json).

- **Inputs.** All times in −07:00. c1: to `priya@company.com`, "Q3 deck", claimed 10-06 23:58. o1: the same address and subject at 10-07 00:01, on the next calendar day. One `gmail.sent` entry saw 10-06 22:00 to 10-07 01:00 and synced at 01:00, which is also `evaluatedAt`.
- **Time.** c1's unit is [23:58, 23:59]; o1 is Δ = 120 000 ms after it. On the after side the edge is `afterClaimMin` = 2 700 000 ms and the tolerance is 60 000 ms, so `timeProximity` = (2 700 000 − 120 000) / (2 700 000 − 60 000) = 2 580 000 / 2 640 000 = 43/44.
- **Score.** S = (2500 · 43/44 + 3500 + 1500 + 1500) / 9000. Multiplying by Q = 44: N = 2500 · 43 + (3500 + 1500 + 1500) · 44 = 107 500 + 286 000 = 393 500 and D = 9000 · 44 = 396 000, so S = 393 500 / 396 000 = 787/792. `10000 · 393 500 = 3 935 000 000 ≥ 8500 · 396 000 = 3 366 000 000`: rule `verified`.
- **State.** FINAL: 01:00 is ≥ end + `graceMin` = 00:29. Windows and distances are measured between instants in milliseconds (§4.1, §5.1), so crossing midnight changes nothing.
- **Receipt.** VERIFIED, `observationIds` [o1], reasons `match.best`.

### 16.13 The §2 demo

Golden: [`13-demo-section-2.json`](../extension/tests/golden/13-demo-section-2.json). Canonical test: [`extension/tests/unit/core/demo.spec.ts`](../extension/tests/unit/core/demo.spec.ts). The arithmetic below is golden 13's. `demo.spec.ts` runs the same story through `gradeBatch` with its own inputs (the sent row's subject is exactly "Q3 deck", so c1 scores 1/1; Gmail checks at 14:10, 14:40 and after the window; a Monday-start week view; idle 14:00–14:09), and asserts the same three outcomes.

- **Inputs.** Muse's activity view says "Sent email to Priya with Q3 deck. Created calendar event 'Q3 review' Thu 2pm." c1: `email.sent` to the name "Priya" (not an address), subject "Q3 deck", claimed 14:02. c2: `calendar.created`, subject "Q3 review", claimed 14:02, `targetAt` Thursday 10-08 14:00. Gmail (one `gmail.sent` entry, 12:00 to 14:50, synced 14:50): o1 to `priya@company.com`, "Q3 deck - final", at 14:02, and o2 to `vendor@supplier.example`, "Re: invoice", at 14:03. Calendar: two `gcal.event` entries (all calendars visible, one account), checked at 14:10 and 14:40, each covering 10-01 to 11-01, with no calendar observation. Activity: a Muse session ping at 14:01, idle 13:55 to 14:20, Muse's adapter synced at 14:50. `evaluatedAt` 15:00.
- **c1 → VERIFIED.** A name claim: `timeProximity`, `counterpartyName` and `subjectOverlap` apply, D = 2500 + 2500 + 1500 = 6500. c1 × o1: `timeProximity` 1; "priya" is a token of the local part `priya`, so `counterpartyName` 1; {q3, deck} against {q3, deck, final} is 2/3. N = 2500 + 2500 + 1500 · 2/3 = 6000, so S = 6000/6500 = 12/13. Multiplying by Q = 3: `10000 · 18 000 = 180 000 000 ≥ 8500 · 6500 · 3 = 165 750 000`: rule `verified`. FINAL: the Gmail sync at 14:50 is ≥ 14:33.
- **c1 × o2.** `timeProximity` 1 (14:03 is inside the closed unit [14:02, 14:03]); the local part `vendor` does not hold "priya", so `counterpartyName` 0; "Re: invoice" reduces to {invoice}, so `subjectOverlap` 0. S = 2500/6500 = 5/13 < 1/2, so o2 is not assigned: it is an orphan.
- **c2 → NOT_FOUND.** The calendar window is [`targetAt` − 3 days, `targetAt` + 3 days] = [10-05 14:00, 10-11 14:00], inside both Calendar entries: coverage `full`. No calendar observation, so no candidate. For a calendar claim `graceElapsed` needs a sync ≥ end(p,t) + `graceMin` = 14:33, which the 14:40 check gives. Rule `not_found`, FINAL, reasons `coverage.account_unbound` {source: `gcal.event`}, `match.none`.
- **o2 → UNASKED (likely Muse).** The session ping at 14:01 is within ±10 min of 14:03 (4000 bp) and idle 13:55 to 14:20 covers [14:01, 14:03] (3000 bp): 7000 bp = 7/10 ≥ 6000, rule `unasked` on two signals. FINAL: the adapter sync at 14:50 is ≥ 14:35.

### 16.14 The §2 demo with Calendar never opened

Golden: [`14-demo-calendar-coverage-absent.json`](../extension/tests/golden/14-demo-calendar-coverage-absent.json).

- **Inputs.** As in 16.13, with no `gcal.event` coverage at all.
- **c2 → UNVERIFIABLE.** No eligible Calendar entry overlaps its window, so coverage is `none` and `no_coverage` matches: UNVERIFIABLE, never NOT_FOUND (Hard Rule 5). It stays PENDING until `evaluatedAt` ≥ end + `finalizeUnverifiableHours` = 10-07 14:03, since the user may still open Calendar. Reasons `coverage.none`, `match.none`.
- **c1 and o2** are unchanged: VERIFIED at 12/13 and UNASKED at 7/10.

### 16.15 Where each rule fires

Every rule in `policy/default.json`, in policy order, plus the terminal rule, with the worked examples above and other golden files that end on it.

| Rule | Then | Worked examples | Other golden files |
|---|---|---|---|
| `unasked` | UNASKED | [16.7](#167-orphan-observation-attribution-07), [16.13](#1613-the-2-demo) | [46](../extension/tests/golden/46-user-idle-positive-evidence.json), [47](../extension/tests/golden/47-per-agent-attribution.json) |
| `over_scope_observed` | OVER_SCOPE | none | [50](../extension/tests/golden/50-scope-diff.json) |
| `over_scope` | OVER_SCOPE | [16.8](#168-claim-type-not-in-the-grant) | [74](../extension/tests/golden/74-reason-order-allowlist-unchecked-override.json) |
| `over_allowlist` | OVER_SCOPE | none | [36](../extension/tests/golden/36-allowlist-domains.json), [64](../extension/tests/golden/64-allowlist-from-evidence.json) |
| `over_ceiling` | OVER_SCOPE | [16.9](#169-amount-above-the-ceiling) | [34](../extension/tests/golden/34-currency-mismatch.json), [35](../extension/tests/golden/35-receipt-amount-over-ceiling-pending.json) |
| `over_ceiling_cumulative` | OVER_SCOPE | none | [33](../extension/tests/golden/33-cumulative-ceiling.json), [77](../extension/tests/golden/77-prior-spend-reads-final-claims.json) |
| `no_target` | UNVERIFIABLE | none | [26](../extension/tests/golden/26-calendar-without-target.json) |
| `underspecified` | UNVERIFIABLE | none | [24](../extension/tests/golden/24-vague-claim-leaves-orphan.json), [25](../extension/tests/golden/25-subject-only-email-underspecified.json) |
| `no_coverage` | UNVERIFIABLE | [16.5](#165-gmail-never-synced-in-the-window), [16.14](#1614-the-2-demo-with-calendar-never-opened) | [45](../extension/tests/golden/45-no-source-types.json) |
| `verified` | VERIFIED | [16.1](#161-exact-match-same-minute), [16.10](#1610-two-claims-one-observation), [16.11](#1611-duplicate-observation), [16.12](#1612-time-zone-edge-2358-and-0001), [16.13](#1613-the-2-demo) | [29](../extension/tests/golden/29-verified-threshold-exact.json) |
| `partial` | PARTIAL | [16.2](#162-recipient-domain-match-subject-partial) | [15](../extension/tests/golden/15-plus-tag-partial.json) |
| `pending` | PENDING | [16.3](#163-no-observation-grace-not-elapsed) | [44](../extension/tests/golden/44-finalize-never-completed.json) |
| `partial_coverage` | UNVERIFIABLE | [16.6](#166-purchase-with-no-receipt-parser) | [41](../extension/tests/golden/41-calendars-hidden-cap.json), [42](../extension/tests/golden/42-no-account-cap-finalised.json) |
| `not_found` | NOT_FOUND | [16.4](#164-no-observation-grace-elapsed), [16.10](#1610-two-claims-one-observation), [16.13](#1613-the-2-demo) | [43](../extension/tests/golden/43-grace-boundaries.json) |
| `default_unverifiable` | UNVERIFIABLE | none | [51](../extension/tests/golden/51-default-unverifiable.json) |

`default_unverifiable` is the terminal rule (§6): it is not listed in `policy.rules` and matches when nothing else does. Under the default rules every claim receipt matches an earlier rule, so golden 51 reaches it with a `policyPatch` that drops `not_found` (its `notes` say so); of the other files in this table, only 33, 34, 35 and 77 patch the policy, and only to add "acme" to `receiptMerchants`.
