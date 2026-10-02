# Grading — how Attest decides

**Who this is for:** anyone who wants to know exactly why a receipt says VERIFIED, PARTIAL, NOT FOUND, UNASKED, OVER SCOPE or UNVERIFIABLE, and anyone changing `src/core`.
**What you'll know after:** every grade, every rule in `policy/default.json`, every feature, the windows, the receipt state machine, and how `attest replay` proves a receipt.

> Status: **v1.3, the Sprint 1 contract**, revised after three adversarial reviews (v0: 9 blockers; v1: 7; v1.1: 3; all fixed) and the clarifications raised while implementing waves A and B (schemas, normalisation, policy, golden scenarios, features, redaction, candidates). Written before the code (sprint 1: "write scenarios first"); task 1.11 adds the worked examples and the state-machine diagram. Where this file and the code disagree, the code is wrong until this file is changed by a reviewed commit. Every deviation from build_spec §7 is listed in §14 and in Decisions.md.

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
gradeBatch(claims, index, grants, policy, coverage, activity, fixed) → Promise<Receipt[]>   (batch.ts)
```

`gradeBatch` is the **only** path from the background to receipts: it retrieves candidates, scores every eligible pair, assigns observations (§4.3), computes cumulative spend (§6.3) and attribution (§7), then calls `grade` per claim, per orphan and per scope subject (§6.1). `grade` alone is used by tests and replay. `gradeBatch` grades exactly the PENDING `claims` it is given; `priorSpendCents` and attribution read `activity.claims`, which holds every claim of the user within retention, FINAL and USER_OVERRIDDEN included. It returns claim receipts, UNASKED receipts and `over_scope_observed` receipts only: a claim-less grade with any other outcome yields no receipt. `grade` sets `state` and `finalAt` itself (finality rules live in `conditions.ts`, §8); `state.ts` only applies user and lifecycle events to stored receipts.

- `claim`: the extracted claim, or `null` (UNASKED and scope-diff receipts).
- `candidates`: observations for this claim after assignment. `grade` sorts them by (`occurredAt` instant, `id`) itself.
- `grant`: the Grant for the claim's agent in force at `coverage.evaluatedAt`.
- `policy`: the loaded, frozen policy. Its `policyHash` (SHA-256 of its canonical JSON) is stored on every receipt.
- `coverage = { evaluatedAt: IsoTs, observers: ObserverCoverage[] }`, where

  ```
  ObserverCoverage = { observerId, source: 'gmail.sent' | 'gmail.receipt' | 'gcal.event',
                       lastSyncAt, windowStart, windowEnd, accountHash?, allCalendars? }
  ```
  `windowStart..windowEnd` is the span of time the pass could see. **Observer obligations (Sprint 2):** a coverage entry exists only for an extraction pass whose `health()` was OK, and is written atomically with that pass's observations (Hard Rules 5, 6). For a newest-first list whose pass saw the head of the list (Gmail Sent, first page), `windowEnd = lastSyncAt`; otherwise `windowEnd` = the newest visible row. A `gmail.receipt` interval asserts that every message in the span from a sender in the receipt-parser registry (`policy.receiptMerchants`) was parsed. A `gcal.event` entry sets `allCalendars: true` only if every calendar was visible.
- `context` (**required**, hashed): `{ priorSpendCents: number, attribution?: Attribution, scope?: { observed: string } }`. `Attribution` carries `adapterLastSyncAt` (the attributed agent's latest adapter sync) so `grade` can decide UNASKED finality.

`Coverage.observers` and each `Activity` list hold at most `SCHEMA_LIMITS.GRADING_INPUT` entries; the ledger readers (Sprint 2.6, 3.5) return the entries that overlap the batch windows. Entries are filtered deterministically before use: coverage entries with `lastSyncAt > evaluatedAt` and observations with `observedAt > evaluatedAt` are ignored, so replay at an earlier instant sees exactly what grading saw.

**Hashes.** `inputsHash` = SHA-256 of the canonical JSON (§10) of `{claim, candidates, grant, policyHash, coverage, context}` after every set-like array is sorted and de-duplicated (`coverage.observers`, `grant.allowedTypes`, `counterpartyAllowlist`, `declaredScopes`, `observedScopes`, candidates by id). It is stored and proves replay.

**Receipt id.** Stable per subject, not per input: `id = idFromHash(sha256Hex(canonicalJson(K)))` with `K = {k:'claim', claimId}` for a claim receipt, `{k:'unasked', observationId}` for UNASKED, `{k:'scope', agent, scope}` for a scope-diff receipt. A regrade replaces the PENDING row with the same id (idempotent; same claim → same row). `computedAt = coverage.evaluatedAt`; `finalAt` = the `evaluatedAt` of the first grading that met the FINAL condition.

## 4. Candidates (`candidates.ts`)

### 4.1 Window

Let `t = claimedAt` and `p = claimedAtPrecision` (`minute` | `hour` | `day`; the unit containing `t` in `t`'s own UTC offset).
- `calendar.*`: centred on the claimed event start `targetAt`, not on `claimedAt`: `[targetAt − calendarDays, targetAt + calendarDays]`. A calendar claim without `targetAt` is graded by rule `no_target`.
- every other type: `[start(p,t) − beforeClaimMin, end(p,t) + afterClaimMin]`, where `start(p,t)` is the start of the precision unit containing `t` and `end(p,t) = start(p,t) + unit` (the closed interval `[start, end]`; for minute precision, 14:02:00 → [14:02:00, 14:03:00]). A claim may carry `claimedAtEnd` only with `day` precision, in `(claimedAt, start(p,t) + 25 h]`: then `end(p,t) = claimedAtEnd`. Adapters set `claimedAt` to the unit start for `hour` and `day` precision, written in the offset in which it reads 00:00 (resp. hh:00). Adapters set it for `day` precision to the next local midnight (computed with the injected offset function), because a local day is 23 or 25 hours long on a DST change and `start + 24 h` would cut off its last hour (a false NOT_FOUND).

A candidate is an observation of the **same `ActionType`** whose `occurredAt` lies in the window (inclusive). For `calendar.created`, a candidate also needs `observedAt ≥ start(p,t) − beforeClaimMin`, comparing the earliest `observedAt` of all observations sharing its `contentHash` (an event already on the calendar before the claim cannot verify "created"). Duplicates by `contentHash` count once: the observation with the lowest id, then the earliest `observedAt`, is kept. Candidates are ordered by (`occurredAt` instant, id, `contentHash`); the schema requires `Observation.id = idFromHash(contentHash)`.

### 4.2 Retrieval

`ObservationIndex` is the only way core reads observations, and every read is bounded in time: `byTypeAndBucket(type, fromMs, toMs)` and `byCounterpartyToken(token, fromMs, toMs)`, both async, both allowed to over-return; `candidates()` filters exactly. Counterparty tokens are the observation's address read through `email()` (never the display name), its domain, and its local-part tokens split on `[._-]` without the `+tag`, all ASCII-lowercased, plus the merchant's name tokens; lookups are exact. An in-memory index ships in core for tests and replay; the Dexie index (Sprint 2.6) passes the same test file.

### 4.3 Assignment: one observation verifies at most one claim

A **batch** = every PENDING claim plus FINAL and USER_OVERRIDDEN claims as fixed pre-assignments (`fixed`: observation → claim; an override keeps its stored `observationIds`, empty for an override to NOT_FOUND; an overridden UNASKED receipt fixes its observation as taken; a FINAL UNASKED receipt does not: its observation stays assignable, and a claim that takes it supersedes it, §7). **Only eligible claims take part in assignment:** a claim that is underspecified (§5.2), a calendar claim without `targetAt`, or a claim whose type has no sources is never scored against observations, so a vague claim can neither take evidence from a specific claim nor hide an orphan from UNASKED. Every (eligible claim, candidate) pair is scored (§5). Pairs with score ≥ `thresholds.partial` are assigned greedily, best score first (exact comparison, §5.3); ties break by earlier `claimedAt` instant (epoch ms, never strings), then claim id, then observation id. **One-to-one:** each observation goes to at most one claim and each claim takes at most one observation. Fixed pairs are taken first and never moved (`assign(pairs, policy, fixed, taken)`: `taken` observations are never assigned; fixed pairs that are not one-to-one throw `CandidatesError`). A claim's candidates for `grade` are its own candidates minus observations assigned to other claims or fixed as taken. Observations assigned to no claim are **orphans** (§7).

## 5. Features and score (`features.ts`)

### 5.1 Features

Each feature value is an exact rational in [0, 1]. Counterparty normalisation is §11.

| Feature | Value |
|---|---|
| `timeProximity` | Δ = the distance in ms from `occurredAt` to the interval `[start(p,t), end(p,t)]` (0 inside it); for calendar, the distance to `targetAt`. `edge` = `beforeClaimMin` on the before side, `afterClaimMin` on the after side, `calendarDays` for calendar. Value 1 when Δ ≤ `toleranceMin`, else `(edge − Δ) / (edge − tolerance)`, all in ms. The loader rejects a policy whose `toleranceMin` is not below every edge. |
| `counterpartyExact` | Claim counterparty is an address: 1 iff the two addresses are **code-point-identical after ASCII-only lowercasing** (no NFC, no NFKC). Identical confusable addresses (any non-ASCII code point or an `xn--` label) score 1 with reason `cp.non_ascii`. If either address is confusable (§11) and they are not identical, the pair is confusable: 0, reason `cp.confusable`. Otherwise a `+tag`-only difference scores 0 with reason `cp.plus_tag` (`cp.confusable` replaces `cp.plus_tag` when both apply). `cp.*` reasons come only from address claims. |
| `counterpartyDomain` | Claim counterparty is an address: 1 iff `counterpartyExact` = 1, or (the domains are identical, neither address is confusable, and (the domain ∉ `policy.commonDomains`, or the addresses differ only by a `+tag`)); else 0. A free-mail domain alone says nothing about identity, but an exact or same-mailbox address still counts. |
| `counterpartyName` | Claim counterparty is a **name** (not an address) with at least one token: 1 iff every token of the normalised name is a token of the observation address's local part, ASCII-lowercased (never NFKC'd) and split on `[._-]` after removing a `+tag`. The display name is never used: it is attacker-controlled. Else 0 (also 0 when the observation has no address). |
| `subjectOverlap` | Jaccard |A∩B| / |A∪B| of the subject token sets (§11). Not applicable when the **claim** has no tokens; an observation with no tokens scores 0. |
| `amountExact` | Applicable when the claim has `amountCents`. 1 iff `amountCents` are equal **and** both currencies are present and equal; a currency missing on either side scores 0. |

Observation counterparties are always read through `email()` (§11) before comparison: observers store the address only, but a display-name form that slips through is reduced to its address and never compared by name.
| `merchantMatch` | 1 iff the claim's normalised counterparty equals the observation's normalised merchant; else Jaccard of their name tokens (0 when the observation has none). Merchant text is read through `counterparty()`; text it rejects has no name tokens (claim: not applicable; observation: 0). |
| `modelScore` | Reserved for Sprint 5 (weight 0; never applicable in Sprint 1). |

### 5.2 Applicability and identity

`policy.featuresByType[type]` lists the features for a claim type. Applicability is decided by the **claim alone**: a listed feature is dropped when the claim lacks its field or the field has no tokens (and the address/name split above picks exactly one of `counterpartyExact`+`counterpartyDomain` or `counterpartyName`). A missing or empty field on the *observation* scores 0, never "not applicable". So no observation can make a claim easier to match by omitting data.

**Identity.** `policy.identityFeatures[type]` lists the features that say *which* action a claim means (email: counterparty; calendar: subject or counterparty; purchase: amount or merchant). If the type's identity list is non-empty and none of its features is applicable, the claim is **underspecified** ("Done! I've sent the email.") and is graded by rule `underspecified` → UNVERIFIABLE with reason `claim.too_vague`, never matched on time alone.

### 5.3 Exact score

The policy loader converts every weight, threshold and unasked signal weight to integer **basis points** and rejects any value that is not a multiple of 0.0001. Feature values are rationals `pᵢ/qᵢ` with integer numerator and denominator. The score is the rational `S = Σ wᵢ·pᵢ/qᵢ ÷ Σ wᵢ` over applicable features, compared with a threshold `T` (bp) by cross-multiplication in `BigInt`: `S ≥ T ⇔ 10000 · Σ wᵢ·pᵢ·(Q/qᵢ) ≥ T · Σwᵢ · Q`, `Q = Π qᵢ`. Assignment ties compare the same rationals. A `featuresByType` entry whose weights sum to 0 is rejected at load, and so is an `identityFeatures` entry naming a feature of weight 0, so every claim that is not underspecified has Σwᵢ > 0; the loader also rejects a type with sources whose `identityFeatures` list is empty. `features()` throws `RatioError('zero_weight_sum')` if called on a claim with no weighted applicable feature; callers use it only for assignable claims. Windows are whole minutes, hours or days (integers ≥ 0, safe in ms). A rule may have `then: PENDING` only if its id is `pending`. `signals.score` and the feature values on a receipt are display numbers rounded to 4 decimals and are **never compared**. Summation order cannot change a grade.

## 6. Rules (`grade.ts`, conditions in `conditions.ts`)

First match wins, in the order written in `policy.rules`. If nothing matches: terminal rule `default_unverifiable` → UNVERIFIABLE. Every receipt names its `ruleId`.

### 6.1 Conditions

"Relevant sources" = `policy.sourcesByType[claim.type]`. An entry is **eligible** for a claim if its source is relevant, `lastSyncAt ≤ evaluatedAt`, and its account is acceptable: if `grant.accounts[source]` is set, `accountHash` must be in it; if not set, an entry with no `accountHash`, or a source seen with ≥ 2 distinct account hashes, counts at most as `partial` coverage. A `gcal.event` entry without `allCalendars: true` counts at most as `partial`.

| Condition | True when |
|---|---|
| `coverage: 'none'` | No eligible interval overlaps the claim window. A type with no sources (`message.sent`, `other`) is always `none`. For a purchase-like type (its sources are `["gmail.receipt"]`) whose normalised counterparty (`name()`, §11) is not in `policy.receiptMerchants`, or which has no counterparty, coverage is **at most `partial`** (reason `coverage.no_parser`): no parser could have seen the receipt, so Attest can never say NOT_FOUND, but a receipt it did see still verifies. |
| `coverage: 'partial'` | Eligible intervals overlap the window but their union does not contain all of it (or only capped entries contain it). |
| `coverage: 'full'` | The union of eligible, uncapped intervals contains the whole window. |
| `typeNotInGrant` | `claim.type ∉ grant.allowedTypes`. |
| `counterpartyNotAllowed` | `claim.type ∈ policy.allowlistTypes`, `grant.counterpartyAllowlist` is non-empty, and **any** known address — the claim's (if it is an address) and the assigned candidate's (if there is one) — matches no entry. Entries and domains compare after ASCII-only lowercasing; an entry containing `@` is an address and matches only an identical address (§5.1); any other entry is a domain, matching an equal domain or one ending in `.entry`. A confusable address never matches. A claim with no address of its own (a name, or no counterparty) and no assigned candidate: not applicable (reason `allowlist.unchecked`). |
| `amountAboveCeiling` | Applies only when `claim.type ∈ policy.spendTypes`, `grant.spendCeilingCents` is set (then `grant.spendCurrency` is required by schema), and an amount is known. Amount = the larger of the claim's `amountCents` (counted only when the claim's currency is absent or equals `spendCurrency`) and the assigned candidate's `amountCents` when that candidate's currency equals `spendCurrency`. True if amount > ceiling (reason `ceiling.exceeded`), or if the claim's currency is present and ≠ `spendCurrency`, or the assigned candidate's currency is present and ≠ `spendCurrency`, whatever the claim's currency (reason `ceiling.currency_mismatch`, which replaces `ceiling.exceeded` unless the amount also exceeds the ceiling in `spendCurrency`; the candidate case finalises like PARTIAL). Otherwise not applicable. |
| `cumulativeAboveCeiling` | Same guard as `amountAboveCeiling` (spend type, ceiling set, claim amount known, currency = `spendCurrency`); true when `context.priorSpendCents + claim.amountCents > spendCeilingCents`. |
| `observedScopeExceedsDeclared` | (claim null) `context.scope` is set and the observed scope is not in `grant.declaredScopes`. With `context.scope` absent: not applicable. |
| `targetMissing` | `claim.type` is `calendar.*` and `claim.targetAt` is absent. |
| `underspecified` | §5.2. |
| `bestScoreGte: T` | the best candidate's exact score ≥ `thresholds[T]`. |
| `bestScoreLt: T` | the best candidate's exact score < `thresholds[T]` (true with no candidates). |
| `graceElapsed` | every relevant source has an eligible entry with `lastSyncAt ≥ end(p,t) + graceMin` and, for non-calendar types, also `≥ end(p,t) + afterClaimMin` (the whole window has had time to happen). Vacuously true for a type with no sources. The clock is the observers' sync time, never a wall clock: Attest says NOT_FOUND only after it actually looked. |
| `unaskedLikely` | (claim null) `context.attribution` is set and its score ≥ `policy.unasked.threshold` (exact, in bp). With `context.attribution` absent: not applicable. |

Eligibility also caps coverage for accounts: the account-hash count is taken over **this source's entries in `coverage.observers`**, and `coverageFor` (Sprint 2.6) must return all of them. A NOT_FOUND graded without `grant.accounts` for that source carries reason `coverage.account_unbound`: if the user only ever opens the wrong account, Attest cannot tell (listed in `docs/attacks-that-work.md`, red-team strategy 7). The Sprint 3 settings-page adapters record the agent's account hash so `grant.accounts` can be filled.

All conditions in one `when` must hold. **Claim-less evaluation:** when `claim` is null, every condition except `unaskedLikely` and `observedScopeExceedsDeclared` is *not applicable*, and a rule with any non-applicable condition does not match; when a claim is present, those two are not applicable.

### 6.2 Default rule order

```
unasked → over_scope_observed → over_scope → over_allowlist → over_ceiling → over_ceiling_cumulative
→ no_target → underspecified → no_coverage → verified → partial → pending → partial_coverage → not_found
```

with `not_found.when = {graceElapsed: true, coverage: 'full', bestScoreLt: 'partial'}`, `pending.when = {graceElapsed: false}`, `partial_coverage.when = {coverage: 'partial', bestScoreLt: 'partial'}`. `no_target` and `underspecified` are claim-intrinsic (a calendar claim without a target has no window to cover), so they come before `no_coverage` and their reason is the accurate one. Over-scope rules read only the claim, the grant and (for amounts and allowlists) the assigned evidence, so they come before `no_coverage`: an agent that claims a $200 purchase against a $50 ceiling is OVER_SCOPE whether or not a receipt email is visible. Hard Rule 5 forbids VERIFIED and NOT_FOUND without sight; it does not forbid OVER_SCOPE on the agent's own claim.

### 6.3 Cumulative spend (`scope.ts`)

`priorSpendCents(claim, claims, policy)` sums `amountCents` of the same agent's claims whose type is in `policy.spendTypes`, in the claim's currency, with `claimedAt` in `[t − windows.spendWindowDays, t]` and strictly **before** the claim in `(claimedAt ms, id)` order. Amounts are non-negative by schema, so a refund cannot lower it. Two $30 purchases against a $50 ceiling make the second OVER_SCOPE.

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
| `userIdle` | (agent-independent) a recorded idle interval covers `[occurredAt − idleMin, occurredAt]`. **Positive evidence only:** missing data never counts as idle. |
| `agentSignature` | the observation's `subjectHint` contains one of `unasked.signatures[A]` (case-insensitive). Bodies are never stored, so footers cannot be read: a documented limit. |
| `activityLogAdjacent` | an activity entry of A is within ±`unasked.windows.adjacentMin`, and no claim of A of the observation's type is within ±`adjacentMin` (whether or not it was assigned). |

Each agent is scored separately: its own signals plus `userIdle`, capped at 1, exact in bp. The likely agent is the highest score; ties by number of fired signals, then agent id. No agent-specific signal fired → no attribution. `unaskedLikely` needs the score ≥ `unasked.threshold`. Reasons list the attributed agent's fired signals plus `userIdle`, each phrased with "likely". `Attribution.adapterLastSyncAt` is the attributed agent's latest adapter sync. An UNASKED receipt stays PENDING until that sync is `≥ occurredAt + beforeClaimMin + graceMin` (a later claim may still explain it), or until `evaluatedAt ≥ occurredAt + finalizeUnverifiableHours`. A PENDING UNASKED that re-evaluates to anything else is deleted. A claim that is later assigned an observation with a FINAL UNASKED receipt **supersedes** it (§8): FINAL UNASKED observations stay assignable.

## 8. State machine (`conditions.ts` decides finality; `state.ts` applies events)

`grade()` sets `state` and `finalAt` using `isFinalizable(outcome, claim, coverage, context, policy)` from `conditions.ts`:

| Outcome | FINAL when |
|---|---|
| VERIFIED | an eligible entry of every relevant source has `lastSyncAt ≥ end(p,t) + graceMin` (positive evidence needs no wait for the rest of the window). |
| PARTIAL, NOT_FOUND | `graceElapsed` (the whole window has had time to happen and was seen). |
| OVER_SCOPE from claim-only facts (type, claim amount, claim address, cumulative, observed scope) | immediately. |
| OVER_SCOPE that depended on the assigned candidate (its amount or address) | like PARTIAL: `graceElapsed`, so a better match can still correct it. |
| UNVERIFIABLE by `no_target` or `underspecified` | immediately. |
| `no_coverage` for a type with no sources (`message.sent`, `other`) | immediately: nothing can ever cover it. |
| `pending`, `no_coverage`, `partial_coverage`, `default_unverifiable` | `evaluatedAt ≥ end(p,t) + finalizeUnverifiableHours`; a `pending` outcome then finalises as UNVERIFIABLE (ruleId `pending`, reason `coverage.never_completed`), so nothing stays "checking" forever and nothing silently drops out of the counts. |
| UNASKED | §7. |

**Receipt invariants** (enforced by the schema): `override` is present iff `state` is USER_OVERRIDDEN; `finalAt` is present iff the state before any override is FINAL; `grade` is UNASKED iff `attribution` is `likely` and `claimId` is absent; `attribution` and `supersededBy` appear only on UNASKED receipts; an override reason contains a visible character. `observationIds` = `[the assigned candidate]` when one is assigned (score ≥ `thresholds.partial`), else `[]`; an UNASKED receipt's is `[its orphan]`; a scope-diff receipt's is `[]`. `grade`'s best candidate is the highest exact score, ties broken by observation id, so `match.best` names the assigned candidate whenever one is assigned, and names the best candidate even below partial. A claim-less `grade` whose outcome is neither `unasked` nor `over_scope_observed` returns rule `default_unverifiable`, FINAL; `gradeBatch` never stores it. Receipt `signals` keys are the §5.1 feature names plus `score`.

`state.ts` applies events to stored receipts and never decides finality:
- `regrade(next)`: PENDING → `next` (which may be PENDING or FINAL). On a FINAL or USER_OVERRIDDEN receipt it throws `IllegalTransitionError`: FINAL receipts are never re-graded, and grant changes affect PENDING receipts only.
- `override({grade: VERIFIED | NOT_FOUND, reason (required, non-empty), at})`: from PENDING or FINAL → USER_OVERRIDDEN, storing `previousState`. The computed `grade` is kept; the override sits beside it, so replay shows an override, never a changed grade.
- `revert`: USER_OVERRIDDEN → `previousState` (Sprint 4.3: overrides are reversible). A deviation from "terminal" in task 1.6, logged.
- `supersede(claimId)`: only on UNASKED receipts, in any state; sets `supersededBy`. Superseded receipts are excluded from counts, alerts and the digest.

## 9. Replay (`replay.ts`)

```
LedgerSnapshot = { claims, observations, receipts, receiptInputs, policies }   // receiptInputs keyed by inputsHash: {coverage, grant, context, policyHash}
replay(snapshot) → Promise<ReplayReport>
```

Replay groups receipts by `computedAt` and processes the groups in order. For each group it rebuilds candidates and the assignment from claims and observations as they were at that instant (`observedAt ≤ computedAt`), with FINAL assignments from earlier groups fixed, takes coverage, grant and context from `receiptInputs` (they cannot be rebuilt from current state), runs `grade`, and compares `inputsHash`, `grade`, `ruleId` and `state` with the stored receipt. Overridden receipts are compared on their `previousState`, and their assignment is fixed from the override's `at` onward. The report lists every mismatch. The ledger must therefore store `receiptInputs` (Sprint 2.6/3.6), all of it derived data with no content (Hard Rule 2), keep several coverage intervals per source within retention, and delete a `receiptInputs` row when its receipt is regraded. Replay covers the receipts inside the retention window; the 90-day purge removes receipts together with their evidence and inputs.

## 10. Ids and hashes (`hash.ts`)

- **SHA-256** in pure TypeScript (synchronous, runs in Node and the browser), tested against the FIPS 180-4 / NIST vectors and Node's `crypto`. Input is the UTF-8 encoding of the string; a lone surrogate is encoded as U+FFFD (as WHATWG `TextEncoder` does), so wherever two strings must stay distinct they are hashed through `canonicalJson` (which escapes lone surrogates): `rowKeyHash = sha256Hex(canonicalJson(rowKey))`.
- **Canonical JSON**: object keys sorted by UTF-16 code unit; arrays in the given order (callers sort set-like arrays first, §3); `undefined` properties dropped; strings exactly as ES2019 `JSON.stringify`; numbers in JavaScript's shortest round-trip form; `-0` written as `0`; `NaN` and `±Infinity` throw.
- **Ids from hashes**: two zero bits followed by the first 128 bits of the hash, as 26 uppercase Crockford base32 characters (always a valid ULID: first character 0–7). The `Ulid` schema accepts only the uppercase form, so one id has one spelling; every currency is a 3-letter uppercase ISO 4217 code. `Observation.id = idFromHash(contentHash)`; `Claim.id = idFromHash(rawHash)` where `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its precision unit}))` (`text` is the normalised claim text, computed by the adapter; the truncated `claimedAt` is the ISO string of the unit start in `claimedAt`'s own offset, seconds included, milliseconds omitted): three identical "Sent email to Priya" lines at different times stay three claims (red-team strategy 1), while the same line re-rendered on every page load stays one (strategy 9); `Request.id = idFromHash(sha256(canonicalJson({agent, conversationId, textHash, ts})))`, receipt ids per §3.
- **contentHash** (redact.ts) = SHA-256 of canonical JSON of `{source, type, ...the content fields (counterparty, merchant, amountCents, currency, subjectHint, occurredAt) that allowlistedFields[source] names and the row supplies}`, plus `rowKeyHash` (a hash of the vendor's own row id) when the observer has one. `subjectHint` is at most 80 Unicode code points (a surrogate pair counts once); `project` cuts a longer hint on a code-point boundary and hashes the stored text. So the same row seen twice is one observation, a created and a deleted event differ, and two separate identical sends in the same minute stay two. An observation carries one counterparty: a sent row with several recipients yields one observation per recipient (the counterparty is part of the hash).

## 11. Normalisation (`normalize.ts`)

- **Addresses.** `email(raw)` extracts the address (a display name `"Priya" <p@x.com>` is dropped), and sets `confusable` from the **raw** extracted address: any code point above U+007F, or a domain label starting with `xn--` in any ASCII case. Addresses are never NFKC-normalised (NFKC turns `𝐩` and fullwidth `ｐ` into `p`); only ASCII `A–Z` are lowercased, by table, never `String#toLowerCase` (which maps `K`, the Kelvin sign, to `k`). Claims and observations store the address exactly as read; comparison happens in `features.ts`. Two addresses compare equal iff they are code-point-identical after ASCII-only lowercasing (no NFC: NFC still folds the Kelvin, Ohm and Angstrom signs); a `+tag` difference is reported, not erased. IDN domains are decoded from punycode for display only.
- **Names.** NFKC, diacritics folded, zero-width and bidi marks removed, whitespace collapsed, lowercased, split into tokens.
- **Amounts.** Integer minor units and ISO currency from `$1,234.50`, `CA$10`, `€9,99`, `USD 10.00`, `¥980`; integer arithmetic only; the minor-unit exponent per currency (USD 2, JPY 0, KWD 3, …) comes from `units.ts`; bare `$` resolves to the caller-supplied default currency; `¥` is JPY (CNY is written `CN¥` or `CNY`); a lone separator that reads both as a decimal point and as a thousands group (`KWD 1.500`) is rejected, not guessed.
- **Subjects.** Remove zero-width and bidi marks → NFKC → lowercase → split on `/[^\p{L}\p{N}\p{M}]+/u` (so a combining mark NFKC cannot compose never splits a word) → drop empty → strip leading `re`, `fw`, `fwd` tokens repeatedly → drop `policy.normalize.stopWords` → set. A subject holding a bidi override or embedding yields no tokens; subjects fold compatibility digits with NFKC deliberately (`Q³` → `q3`): subject overlap is a soft feature that can never verify a claim on its own.
- **Text that displays differently from how it is stored is not read.** A string holding a bidi override or embedding (U+202A, U+202B, U+202D, U+202E), or a `\p{No}` digit that NFKC would turn into a different number (superscripts, subscripts, circled digits, fractions), yields null from `amount` and `resolveRelative` and no name tokens; bidi marks and isolates are only stripped.
- **Vendor-relative times** ("2:03 PM", "Yesterday", "Thu") resolve against a reference instant and an injected UTC-offset function; core never reads a time-zone database. The result carries a precision (`minute` | `hour` | `day`) and the unit's start and end instants. Rules: a weekday name means the most recent such day strictly before the reference day; "N units ago" is the floor range `[ref − (N+1)u, ref − Nu]` at the finest aligned unit that contains it ("N days ago" counts calendar days); a clock time that is skipped or ambiguous on a DST day widens to day precision.

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
    "threshold": 0.6,
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
`units, sha256, base32 → hash, schema → normalize, policy, ratio → window → redact, candidates, features → conditions, receipt → scope, attribution → grade → state, batch → replay`.

| Module | Exports |
|---|---|
| `units.ts` | `MS_PER_MINUTE`, `MS_PER_HOUR`, `MS_PER_DAY`, `BASIS_POINTS`, `CURRENCY_MINOR_UNITS` |
| `hash.ts` (+ `sha256.ts`, `base32.ts`) | `sha256Hex(text)`, `canonicalJson(value)`, `idFromHash(hex)` |
| `schema.ts` | Branded `Ulid`, `Sha256`, `IsoTs`; `AgentId`, `ActionType`, `ObservationSource`, `ClaimPrecision`, `Request`, `Claim` (§7 + `targetAt?`, `claimedAtPrecision`, `claimedAtEnd?`), `ReasonParams`, `Observation` (§7 + `rowKeyHash?`), `Grant` (§7 + `spendCurrency?` (required when `spendCeilingCents` is set), `accounts?`), `Grade`, `ReceiptState`, `ReasonCode`, `Reason`, `Receipt` (§7 + `agent`, `policyHash`, `attribution?: 'likely'`, `override?`, `supersededBy?`, `reasons: Reason[]`), `ObserverCoverage`, `Coverage`, `Attribution` (with `adapterLastSyncAt`), `GradeContext`, `Activity`, `HealthReport`, `SCHEMA_LIMITS` (`amountCents` ≥ 0, ≤ 10¹²). `src/ledger/types.ts` re-exports these. |
| `normalize.ts` (+ `punycode.ts`) | `email`, `sameAddress`, `name`, `nameTokens`, `amount`, `subjectTokens`, `instantMs`, `isoWithOffset`, `resolveRelative` → `{start, end, precision}` |
| `policy.ts` | `loadPolicy` → frozen `Policy` with basis-point weights/thresholds and `policyHash` |
| `redact.ts` | `project(source, raw, { type, observedAt, rowKey? }, policy)` → `Observation` (reads only own data properties; throws `RedactError('missing_occurred_at')` or `RedactError('invalid_argument')`); `hashText(text)` |
| `candidates.ts` | `ObservationIndex`, `createMemoryIndex`, `candidates`, `assign(pairs, policy, fixed, taken)`, `exclusiveCandidates` |
| `ratio.ts` | `Ratio` (`{num, den}` as bigint), `ratio`, `compareRatio`, `ratioGteBasisPoints`, `weightedScore` |
| `window.ts` | `precisionBounds`, `claimWindow` |
| `features.ts` | `applicableFeatures`, `isUnderspecified`, `isAssignable`, `features` → `{ score: Ratio, signals, reasonCodes }` (assignable claims only) |
| `conditions.ts` | `coverageLevel`, `graceElapsed`, condition evaluators, `isFinalizable` |
| `receipt.ts` | `receiptId(subject)`, `inputsHash(inputs)`, receipt builder |
| `scope.ts` | `priorSpendCents`, `scopeSubjects(grant)` |
| `attribution.ts` | `attribute(observation, activity, policy)` → `Attribution \| null` |
| `grade.ts` | `grade(claim \| null, candidates, grant, policy, coverage, context)` |
| `state.ts` | `transition(receipt, event)` for `regrade`, `override`, `revert`, `supersede`; `IllegalTransitionError` |
| `batch.ts` | `gradeBatch(...)` |
| `replay.ts` | `LedgerSnapshot`, `ReplayReport`, `replay(snapshot)` |

## 14. Deviations from build_spec §7 (all in Decisions.md, Sprint 1)

1. `grade()` takes a sixth argument, `context` (cumulative spend, attribution, scope), required and hashed (Hard Rule 4 needs every input in the hash).
2. Receipt ids derive from the subject (claim, orphan observation, scope), not from `inputsHash`; `inputsHash` is stored. Idempotency is kept: same subject → same row.
3. Receipt gains `agent`, `policyHash`, `attribution`, `override`, and structured `reasons`. Claim gains `targetAt` and `claimedAtPrecision`. Observation gains `rowKeyHash`. Grant gains `spendCurrency` and `accounts`.
4. The policy gains the keys in §12, the over-scope rules move before `no_coverage`, and `not_found` requires full coverage.
5. Finality is per outcome (§8): VERIFIED after a sync at `end(p,t) + graceMin`; PARTIAL and NOT_FOUND only after the whole window was seen; coverage-based UNVERIFIABLE after `finalizeUnverifiableHours`.
6. `USER_OVERRIDDEN` can be reverted (Sprint 4.3).
7. `src/core` gains `units.ts`, `hash.ts`, `sha256.ts`, `base32.ts`, `punycode.ts`, `ratio.ts`, `window.ts`, `conditions.ts`, `receipt.ts`, `batch.ts` beside the §6 file list; the no-literal test exempts `sha256.ts`, `base32.ts`, `punycode.ts`, `units.ts` and `schema.ts` with a reason each.

## 15. Golden scenarios (`tests/golden/`)

Each scenario is one JSON file, `tests/golden/<nn>-<slug>.json`, written from this document alone — never from the code. Hand-written files use short refs (`c1`, `o2`, `g1`); the loader (`tests/golden/load.ts`) builds full, schema-valid objects from them, fills documented defaults, and computes every hash and id with `hash.ts`. Ids and hashes are never typed by hand; a generated snapshot (`tests/golden/__snapshots__/ids.json`, written by a script and reviewed) pins their stability.

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

- `score` is the best candidate's exact score as a reduced fraction `"p/q"`, or `null` when no candidate was scored. Claims may carry `claimedAtEnd`; `expect[].reasonParams` (optional) holds the params of every reason keyed by code (ids as refs), and the runner then compares reasons exactly. `__snapshots__/ids.json` is written by `tests/golden/write-ids.ts`. Expected values are computed by hand from §5 in basis points.
- `accountHash` values like `"acct-a"` are labels; the loader replaces each label with the SHA-256 of the label.
- Defaults the loader fills: claim `extractor` (`{id: 'golden', version: '1', confidence: 1}`), `sourceKind: 'activity_view'`, `claimedAtPrecision: 'minute'`, claim `observedAt` = `claimedAt`, claim `text` (for `rawHash`, §10) = the claim's `ref` unless given, `requestId` absent; observation `observedAt` = the earliest `lastSyncAt` ≤ `evaluatedAt` among its source's coverage entries whose interval contains `occurredAt`, else `evaluatedAt`; observation `contentHash` per §10; grant `updatedAt` = `evaluatedAt` minus one day.
- A scenario must state every input that decides its outcome: coverage with `accountHash` (else coverage is capped at partial), a non-common domain when it relies on `counterpartyDomain`, `targetAt` for calendar claims, positive idle evidence for `userIdle`.

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

**Params per code (closed).** `match.best` {`observationId`: Ulid}; `coverage.none`, `coverage.partial`, `grace.waiting`, `coverage.account_unbound`, `coverage.no_account`, `coverage.multiple_accounts`, `coverage.calendars_hidden` {`source`: ObservationSource} (omitted for a type with no sources); `scope.type_not_allowed` {`type`: ActionType}; `ceiling.exceeded` {`amountCents`, `ceilingCents`: int}; `ceiling.cumulative_exceeded` {`priorSpendCents`, `amountCents`, `ceilingCents`: int}; `ceiling.currency_mismatch` {`currency` (the claim's when present, else the assigned candidate's), `spendCurrency`: currency code}; `ceiling.exceeded.amountCents` is the §6.1 Amount; `scope.observed_not_declared` {`scopeHash`: `sha256Hex(scope)`, the observed scope exactly as stored}; `unasked.*` {`agent`: AgentId}; `override.user` {`grade`: the override's grade, `VERIFIED` | `NOT_FOUND`}; `superseded` {`claimId`: Ulid}; every other code has no params. The schema enforces this table, so a reason can never carry an address, a name or a subject.

**Emission.** `match.best` (with the best candidate) or `match.none` on every claim receipt, never on claim-less ones; `cp.*` from the best candidate only; the coverage-capping codes (`coverage.no_account`, `coverage.multiple_accounts`, `coverage.calendars_hidden`, `coverage.no_parser`) only when `ruleId` is `partial_coverage`; `coverage.none` only for `no_coverage`; `coverage.account_unbound` only on NOT_FOUND; `coverage.never_completed` is the `pending` rule's own code once that outcome finalises by time (it replaces `grace.waiting`); `grace.waiting` only for `pending` while PENDING; `unasked.*` only on UNASKED; `allowlist.unchecked` only when that condition was not applicable and the receipt is not OVER_SCOPE by another rule; the `verified`, `partial`, `not_found` and `default_unverifiable` rules add no rule code. Golden files compare `reasonCodes` as an exact, ordered list.

Reason codes are ordered: the rule's own code first, then `allowlist.unchecked` if emitted, then coverage reasons, then match and counterparty reasons, each group in table order; `override.user` and `superseded` come last.
