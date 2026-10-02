# Golden scenarios

Hand-written grading scenarios with hand-computed expectations, written from `docs/grading.md` (v1.2) **alone**,
never from `src/core`. They are the independent statement of what `grade()` and `gradeBatch()` must do: the code
is written to satisfy them, not the other way round (sprint 1: "write scenarios first").

| File                     | Role                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `NN-slug.json`           | One scenario (§15 format, extended below).                                                |
| `scenario-schema.ts`     | Strict Zod schema for a scenario file, and the §15 params table. Unknown keys fail.       |
| `load.ts`                | Builds schema-valid core inputs from a file: defaults, ids, hashes, receipt ids, reasons. |
| `build.ts`               | Per-object builders (claim, observation, grant, coverage) and the policy merge patch.     |
| `time.ts`                | Offset-preserving time helpers (no host time zone, no `Intl`).                            |
| `checks.ts`              | Contract invariants checked on the files (emission table, v1.2 order, thresholds, refs).  |
| `checks-reasons.ts`      | §15 params per code and the `allowlist.unchecked` emission rule, checked on the files.    |
| `checks-claims.ts`       | Claims that are never scored (§4.3) and evidence of the claim's own type (§4.1).          |
| `v12-rules.ts`           | One `contract:<tag>` per v1.2 rule, with a proof that the tagged file exercises it.       |
| `ids.ts`, `write-ids.ts` | The ids snapshot and the script that writes it.                                           |
| `scenarios.spec.ts`      | Validates every file, the coverage requirements, and the loader output.                   |
| `checks.spec.ts`         | Mutation tests: every check rejects a deliberately broken copy of a real expectation.     |
| `loader.spec.ts`         | Pins the loader defaults, `claimedAtEnd`, reason params and the time helpers.             |
| `__snapshots__/ids.json` | Every claim and observation id per scenario, so a hashing change is a reviewed diff.      |

The runner that actually calls `grade()`/`gradeBatch()` and compares receipts arrives in a later wave (see
[Runner contract](#runner-contract)).

## File format

The §15 format, plus a few fields the contract needs but the §15 example does not show:

```jsonc
{
  "name": "…",
  "covers": ["ledger_engineer:exact_match", "edge:…", "contract:…"],
  "mode": "batch",                    // "batch" → gradeBatch; "grade" → one grade() call (needs input.grade)
  "policyPatch": { },                 // RFC 7386 merge patch on policy/default.json (arrays replace)
  "notes": ["the hand computation, one step per line"],
  "input": {
    "evaluatedAt": "2026-10-06T15:00:00-04:00",
    "claims": [{ "ref": "c1", "agent": "muse", "type": "email.sent", "counterparty": "…", "subjectHint": "…",
                 "claimedAt": "…", "claimedAtPrecision": "day", "claimedAtEnd": "…", "targetAt": "…",
                 "observedAt": "…", "text": "…", "rowKey": "label" }],
    "observations": [{ "ref": "o1", "source": "gmail.sent", "type": "email.sent", "counterparty": "…",
                       "occurredAt": "…", "observedAt": "…", "rowKey": "label" }],
    "grants": [{ "agent": "muse", "allowedTypes": [], "counterpartyAllowlist": [], "spendCeilingCents": 5000,
                 "spendCurrency": "USD", "declaredScopes": [], "observedScopes": [],
                 "accounts": { "gmail.sent": ["acct-a"] } }],
    "coverage": [{ "source": "gmail.sent", "lastSyncAt": "…", "windowStart": "…", "windowEnd": "…",
                   "accountHash": "acct-a", "allCalendars": true }],
    "activity": { "sessions": [], "idle": [], "entries": [], "adapterSyncs": [], "claims": ["c1"] },
    "fixed": [{ "claim": "c9", "observation": "o9" }, { "claim": null, "observation": "o3" }],
    "grade": { "claim": null, "candidates": ["o1"], "agent": "muse", "priorSpendCents": 0, "scope": "…" }
  },
  "events": [{ "event": "override", "ref": "c1", "grade": "VERIFIED", "reason": "…", "at": "…" },
             { "event": "supersede", "ref": "o1", "claim": "c1" }],
  "assertIds": { "equal": [["o1", "o2"]], "ascending": [["c3", "c4"]] },
  "expect": [{ "ref": "c1", "grade": "VERIFIED", "ruleId": "verified", "state": "FINAL",
               "observationRefs": ["o1"], "score": "1/1", "reasonCodes": ["match.best"],
               "reasonParams": { "match.best": { "observationId": "o1" } } },
             { "ref": "o2", "grade": "UNASKED", …, "agent": "muse", "attributionScore": "7/10" },
             { "scope": { "agent": "muse", "scope": "gmail.read" }, "grade": "OVER_SCOPE", … }]
}
```

- **Refs.** Claims are `c<n>`, observations `o<n>`. An expectation names its subject: a claim ref (claim
  receipt), an observation ref (UNASKED receipt for that orphan), or `scope` (scope-diff receipt).
- **Labels.** `accountHash`, `accounts` entries and `rowKey` are short labels; the loader stores SHA-256(label).
  Ids and hashes are never typed by hand.
- **`claimedAtEnd`** (v1.2 §4.1). The end of the claim's precision unit, passed to the core claim as written.
  Adapters set it for `day` precision to the next local midnight, so a 23- or 25-hour DST day is one unit (`68`).
  It does not enter `rawHash` (§10).
- **`reasonParams`** (v1.2 §15, optional). The params of every reason, keyed by code, exactly per the closed
  table ("Params per code"). When present it names every code in `reasonCodes`; ids are written as refs (`o1`,
  `c1`) and the loader resolves them; a `source` is left out for a type with no sources (`45`). Files without it
  assert codes only.
- **`fixed`.** FINAL or USER_OVERRIDDEN pre-assignments (§4.3). A claim named here already holds its receipt: it
  is not passed to `gradeBatch` and gets no expectation. `claim: null` is an overridden UNASKED receipt.
- **`events`.** State events applied with `state.ts` `transition()` after grading, in order (§8).
- **`assertIds`.** When an expectation depends on hash-derived ids (a tie broken by claim or observation id,
  or dedupe by `contentHash`), the file states the id relation it relies on and the spec verifies it.
- **`expect` is the whole result.** In batch mode it lists every receipt `gradeBatch` returns: a missing or an
  extra receipt is a failure. In grade mode it holds exactly the one receipt.
- **Invisible characters** (zero-width, bidi) are written as JSON `\u` escapes, never raw (`72`).

## Loader defaults (§15)

| Object         | Default                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim          | `extractor {golden, 1, 1}`, `sourceKind activity_view`, `claimedAtPrecision minute`, no `claimedAtEnd`, `observedAt = claimedAt`, `text = ref`, no `requestId`  |
| Claim id       | `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its unit in its own offset}))`, `id = idFromHash(rawHash)` |
| Observation    | `observedAt` = earliest `lastSyncAt ≤ evaluatedAt` among its source's coverage entries whose window holds `occurredAt`, else `evaluatedAt`                      |
| Observation id | `contentHash = sha256(canonicalJson({source, type, …allowlisted content fields, rowKeyHash if any}))`, `id = idFromHash(contentHash)`                           |
| Grant          | every type allowed, empty allowlist, `spendCeilingCents null`, no scopes, no accounts, `updatedAt = evaluatedAt − 1 day`                                        |
| Coverage       | `observerId = source`                                                                                                                                           |
| Activity       | empty lists; `claims` = every scenario claim                                                                                                                    |
| Receipt id     | `idFromHash(sha256(canonicalJson(K)))`, `K = {k:'claim', claimId}` / `{k:'unasked', observationId}` / `{k:'scope', agent, scope}`                               |
| Reasons        | only with `reasonParams`: `{code, params}` in `reasonCodes` order, refs resolved to ids, parsed with the core `Reason` schema                                   |

## How an expectation is computed

Everything is exact: basis points and reduced fractions, never floats (§5.3). Worked example, `02`:

1. **Window (§4.1).** Claim at 14:02, minute precision → unit `[14:02, 14:03]`, window `[14:00, 14:48]`. With
   `claimedAtEnd` the unit ends there instead of at `start + unit`.
2. **Applicable features (§5.2).** An address claim with a subject: `timeProximity 2500`, `counterpartyExact
3500`, `counterpartyDomain 1500`, `subjectOverlap 1500` bp; Σw = 9000. (A name claim uses
   `counterpartyName 2500` instead of the two address features; a purchase uses `timeProximity`, `amountExact`,
   `merchantMatch`; a calendar claim `timeProximity`, `subjectOverlap` and the counterparty features.)
3. **Feature values (§5.1, §11).** `raj@company.com` vs `priya@company.com`: ce 0, cd 1 (same non-common
   domain); subjects `{q3, deck}` vs `{q3, budget}` → 1/3; tp 1. Observation counterparties are read through
   `email()` first (`71`).
4. **Score.** S = (2500 + 0 + 1500 + 1500·1/3) / 9000 = 4500/9000 = **1/2**.
5. **Rule (§6).** First match in policy order: S ≥ partial (10000·4500 ≥ 5000·9000) → `partial`.
6. **State (§8).** PARTIAL is FINAL once `graceElapsed`: a sync ≥ end + 30 min and ≥ end + 45 min.
7. **Reasons (§15 v1.2).** The rule's own code, then `allowlist.unchecked` if emitted, then coverage reasons,
   then `match.*`/`cp.*`, each group in table order; `override.user` and `superseded` last (`74`).

`timeProximity` = 1 within `toleranceMin`, else `(edge − Δ)/(edge − tolerance)` in ms, with edge 120 000 before
the unit, 2 700 000 after it, 259 200 000 around a calendar target. `28` and `29` exercise the millisecond
boundaries (9503999/9504000, 17/20 exactly, 8078399/9504000).

## Readings settled by v1.2

The v1.1 authors took eight readings where the contract was open. Contract v1.2 settled every one of them the
way the files already read, so no expectation changed; only notes and this list did.

1. **Evidence** (§8 receipt invariants): `observationIds` = the assigned candidate (score ≥ partial), else `[]`;
   `match.best` still names a best candidate below partial (`18`–`23`, `30`, `73`).
2. **Claim-less outcomes** (§3): `gradeBatch` returns claim receipts, UNASKED receipts and `over_scope_observed`
   receipts only (`46`–`48`, `50`, `73`).
3. **No-source types** (§5.2): only a non-empty identity list can make a claim underspecified, so `message.sent`
   and `other` are graded `no_coverage` (`45`).
4. **`allowlist.unchecked`** (§15 order): after the rule's own code, before coverage reasons (`37`, `74`).
5. **`ceiling.currency_mismatch`** (§6.1) replaces `ceiling.exceeded` unless an amount in `spendCurrency` also
   exceeds the ceiling (`34`, `65`, `69`).
6. **`override.user` and `superseded`** (§15 order) come last (`56`, `57`, `74`).
7. **Taken observations** (§4.3): an observation fixed by an overridden UNASKED receipt is no claim's candidate
   (`32`).
8. **UNASKED reasons** (§7): the attributed agent's fired signals plus `userIdle` (`47`).

`68`–`74` add one scenario per v1.2 rule: `claimedAtEnd` on both DST days (`68`), the candidate-currency
ceiling mismatch that waits like PARTIAL (`69`), identical `xn--` addresses (`70`), a display-name observation
counterparty read through `email()` (`71`), zero-width characters inside a word and a bidi override in subjects
(`72`, one proof each), a below-partial best candidate with no evidence plus below-threshold orphans that yield
no receipt (`73`), and the reason order with `allowlist.unchecked` and `override.user` (`74`). The verification
pass added `75`–`77` for the v1.2 rules no file exercised yet: a name's tokens against an address local part
that is ASCII-lowercased but never NFKC'd or `toLowerCase`'d, and a name holding a bidi override that has no
tokens (`75`); `receiptMerchants` matched by the claim's normalised name, and a purchase claim with no
counterparty that is never covered (`76`); cumulative spend that counts the agent's FINAL claims from
`activity.claims` (`77`). Params are asserted for every code that has them, except
`scope.observed_not_declared` (below).

## Readings the contract does not settle

Each is reported as a contract issue. Files marked _avoided_ stay off the reading (some are enforced by a check);
_taken_ readings are asserted and must change if the contract decides otherwise.

1. _Avoided (checked)._ The position of `coverage.never_completed` relative to `allowlist.unchecked`: is it the
   `pending` rule's own code once it finalises (first), or a coverage reason (after `allowlist.unchecked`)? No
   file combines them; `checks.ts` rejects one that does.
2. _Avoided._ What `scope.observed_not_declared.scopeHash` hashes (the observed scope string as stored?). `50`
   asserts the code only.
3. _Avoided (checked)._ A claim of an allowlist type with no counterparty at all (a calendar claim with only a
   subject) and a non-empty allowlist: `allowlist.unchecked`, or the condition simply false? No file has one;
   `checks-reasons.ts` rejects one.
4. _Avoided._ A claim in `spendCurrency` assigned a receipt in a third currency: read literally, the receipt's
   amount is ignored and nothing is raised. `69` uses claims without a currency only.
5. _Avoided._ Whether a claim amount in another currency (or with no currency) counts as "exceeding the ceiling
   in `spendCurrency`", which decides `[ceiling.exceeded, ceiling.currency_mismatch]` vs the mismatch alone. Every
   mismatching amount in the files is under the ceiling (`34`, `65`, `69`).
6. _Avoided._ `xn--` detection in another ASCII case (`XN--`). `70` writes the label in lowercase.
7. _Avoided._ How `grade` picks `match.best` among equal-score candidates, and whether that always equals the
   §4.3 tie-break (observation id). Only `58` has a tie, where `occurredAt` is equal and both orders agree.
8. _Avoided._ The state and finality of a claim-less `grade()` whose outcome is neither `unasked` nor
   `over_scope_observed` (there is no `end(p,t)`); `gradeBatch` drops it, and grade-mode files never produce it.
9. _Taken (checked)._ `override.user.grade` is the override's grade, not the computed one (`56`, `74`);
   `ceiling.exceeded.amountCents` is the §6.1 Amount, the larger in-currency amount (`35`, `67`);
   `ceiling.currency_mismatch.currency` is the claim's currency, else the assigned candidate's (`69`);
   `unasked.idle.agent` is the attributed agent (`7`, `48`, `57`).
10. _Loader convention_, not a grading reading: a claim's truncated `claimedAt` in `rawHash` keeps a `Z` offset
    as `Z` (`31`). It changes golden ids only; the core never recomputes `rawHash`.
11. _Taken (checked)._ An UNASKED receipt's `observationIds` is `[its orphan]` (`7`, `13`, `14`, `20`, `24`,
    `30`, `46`–`49`, `57`, `58`, `66`). The §8 invariant ("the assigned candidate when one is assigned, else
    `[]`") is written for claim receipts; read literally, an orphan is assigned to no claim and the receipt would
    name no observation. `checks.ts` requires the orphan; a scope-diff receipt names none (`50`).
12. _Taken._ A name claim carries no `cp.*` reason, even against a confusable or `+tag` address: §5.1 defines
    `cp.*` in the `counterpartyExact` row, which applies to address claims only (`54`, `75`).

## Independent verification

Every expectation in `01`–`61` was recomputed by a second author from docs/grading.md alone, before reading the
first author's notes (grade, rule, state, evidence, exact score, reason codes); there were no disagreements.
The same pass added `62`–`67` for contract paths no earlier file discriminated: identity per type (vague
calendar and purchase claims), purchase feature details (merchant token Jaccard, `amountExact` needing both
currencies), the allowlist failing only on the evidence's address (OVER_SCOPE that waits for grace), the
cumulative spend window and its exclusions (other agent, other currency, 1 ms outside 30 days, `>` not `≥`),
UNASKED finalised by `finalizeUnverifiableHours`, and a ceiling known only from the receipt. The v1.2 pass
re-read every file against v1.2 (no outcome changed), added `68`–`74` and asserted params in 44 expectations.
An adversarial verifier then recomputed `68`–`74` and every asserted param from v1.2 alone (no disagreements),
added `75`–`77` and the checks that tie an UNASKED score to its fired signals, keep claim reasons off claim-less
receipts, keep never-scored claims unscored, and tie `ceiling.exceeded.amountCents` to the §6.1 Amount.
Each new file is built so the v1.1-era mistake it targets gives a different grade or score (its notes say how).

## Adding a scenario

1. Pick the next number: `NN-short-slug.json`. Start from the closest existing file.
2. State every input that decides the outcome (§15): coverage with `accountHash`, a non-common domain when you
   rely on `counterpartyDomain`, `targetAt` for calendar claims, positive idle evidence for `userIdle`.
3. Compute the expectation by hand from docs/grading.md, in basis points and exact fractions; write each step in
   `notes`. Keep pairs you do not mean to test out of each other's windows (two hours apart is enough).
4. Tag it in `covers` (`ledger_engineer:*`, `edge:*`, `contract:*`); assert `reasonParams` where the params are
   the point.
5. Run `pnpm exec tsx tests/golden/write-ids.ts`, then review `git diff tests/golden/__snapshots__/ids.json`: a
   new scenario only adds lines (a changed id means a hashing change). If an expectation depends on id order,
   add `assertIds`. The spec never rewrites the snapshot; it fails until the script has run.
6. Run `pnpm exec prettier --write tests/golden` and `pnpm exec vitest run tests/golden`.

## What the spec enforces

- ≥ 40 files; each parses strictly; refs resolve; one expectation per graded claim; evidence is one-to-one.
- Every expectation agrees with the rule → grade mapping, the thresholds (exactly, in the basis points
  `loadPolicy()` computes, never the decimal fields), first-match-wins (a rule after `verified` or `partial` in
  policy order has a best score below that threshold), the §15 emission table and the v1.2 reason order;
  NOT_FOUND carries `coverage.account_unbound` iff the grant binds no account; `allowlist.unchecked` appears
  exactly when §6.1 makes the allowlist uncheckable.
- Asserted params follow the closed §15 table and agree with the claim, grant, evidence, override and
  supersede; every code that has params is asserted somewhere (except `scopeHash`), and the golden params table
  is the one `src/core/schema.ts` `Reason` enforces, code by code.
- UNASKED receipts carry an agent-specific signal and an `attributionScore` equal to their fired signals' weights
  (capped at 1, in basis points); claim-less receipts carry no match, `cp.*`, coverage or allowlist code.
- Underspecified claims, calendar claims without `targetAt` and claims of a type with no sources are never scored
  (§4.3); evidence and `match.best` name an observation of the claim's own type.
- Observations carry only allowlisted fields from a source that sees their type; every patched policy loads.
- Coverage: the 12 mandatory scenarios (checked against `agents/ledger_engineer.md`), the §2 demo and its
  UNVERIFIABLE variant, every rule in `policy/default.json` plus `default_unverifiable`, every ReasonCode, every
  grade and state, both modes, the hardened edge cases, and each v1.2 rule with a proof it is exercised.
- The scenario enums equal `src/core/schema.ts`; the loader's objects and reasons parse with the core schemas.
- `__snapshots__/ids.json` is byte-identical to what `write-ids.ts` writes.
- Mutation tests (`checks.spec.ts`) prove the checks and the v1.2 proofs fail on broken expectations.

## Runner contract

For each file: `loadScenario(file)`, `policy = loadPolicy(loaded.policyJson)`, then

- **batch:** `gradeBatch(loaded.batchClaims, createMemoryIndex([...loaded.observations.values()]),
loaded.grants, policy, loaded.coverage, loaded.activity, loaded.fixed)`;
- **grade:** `grade(call.claim, call.candidates, grantOf(call.agent), policy, loaded.coverage, context)`, where
  `context = call.context` plus, when `call.attributeFromActivity`, `attribution = attribute(call.candidates[0],
loaded.activity, policy)`;

then apply `loaded.events` with `transition()` and compare by receipt id with `loaded.expected`: the same set of
ids; `grade`, `ruleId`, `state`; `observationIds` = `expected.observationIds`; reason codes as an exact ordered
list, and when `expected.reasons` is set, `receipt.reasons` deep-equal to it; `score` = the exact `features()`
score of the `match.best` candidate as a reduced fraction (null with `match.none` or no claim); `agent`; for
UNASKED the attribution `scoreBp` as `attributionScore` and `attribution: 'likely'`;
`override.grade`/`override.previousState`; `supersededBy`. Generic checks for every receipt: `computedAt =
evaluatedAt`; `finalAt = evaluatedAt` iff the (pre-override) state is FINAL; claim receipts carry the claim's
agent.
