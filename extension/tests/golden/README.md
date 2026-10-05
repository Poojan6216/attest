# Golden scenarios

Hand-written grading scenarios with hand-computed expectations, written from `docs/grading.md` **alone** (v1.5;
`69` re-derived and `98` written under v1.6; `99`–`103` written and `86` updated under v1.9; `112` written under v1.12), never from `src/core`. They are the independent statement of what
`grade()` and `gradeBatch()` must do: the code is written to satisfy them, not the other way round (sprint 1: "write
scenarios first").

| File                                    | Role                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `NN-slug.json`, `NNN-slug.json`         | One scenario, in the §15 format (three digits from `100` on, v1.9).                               |
| `scenario-schema.ts`                    | Strict Zod schema for a scenario file, and the §15 params table. Unknown keys fail.               |
| `load.ts`                               | Builds schema-valid core inputs from a file: defaults, ids, hashes, receipt ids, reasons.         |
| `build.ts`                              | Per-object builders (claim, observation, grant, coverage) and the policy merge patch.             |
| `time.ts`                               | Offset-preserving time helpers (no host time zone, no `Intl`).                                    |
| `checks.ts`                             | Contract invariants checked on the files (emission table, v1.3 order, thresholds, refs).          |
| `checks-reasons.ts`                     | §15 params per code and the `allowlist.unchecked` emission rule, checked on the files.            |
| `checks-claims.ts`                      | Never-scored claims (§4.3), evidence of the claim's own type (§4.1), no-parser purchases.         |
| `checks-events.ts`                      | The §8 v1.4 event rules on the files: stale regrades, early overrides, the last supersede wins.   |
| `grants.ts`                             | The grant in force (§3 v1.4) read from a file, and the grant checks (one instant per agent).      |
| `proof-helpers.ts`                      | Shared pieces of the `contract:<tag>` proofs.                                                     |
| `v12-rules.ts`                          | One `contract:<tag>` per v1.2 rule (as it still reads in v1.3), with its proof.                   |
| `v13-rules*.ts` (rules, evidence, text) | One `contract:<tag>` per v1.3 rule, with a proof that the tagged file exercises it.               |
| `v14-rules*.ts` (rules, events)         | One `contract:<tag>` per v1.4 rule, with a proof that the tagged file exercises it.               |
| `v19-rules.ts`                          | One `contract:<tag>` per v1.9 rule (receipt points, followed calendar changes), with its proof.   |
| `v110-rules.ts`                         | One `contract:<tag>` per v1.10 rule (first-look markers, views looked at too early), with proof.  |
| `v112-rules.ts`                         | The v1.12 `contract:<tag>` (every Calendar row stored with its marker), with its proof.           |
| `ids.ts`, `write-ids.ts`                | The ids snapshot and the script that writes it.                                                   |
| `scenarios.spec.ts`                     | Validates every file, the coverage requirements, and the loader output.                           |
| `checks.spec.ts`                        | Mutation tests: every check and v1.2 proof rejects a broken copy of a real expectation.           |
| `v13-rules.spec.ts`                     | Every v1.3 tag is exercised, every proof and check fails on a broken copy, every tag has a proof. |
| `v14-rules.spec.ts`                     | The same for the v1.4 tags, and the v1.4 checks (grants, late claims, events, params) bite.       |
| `v19-rules.spec.ts`                     | The same for the v1.9 tags.                                                                       |
| `v110-rules.spec.ts`                    | The same for the v1.10 tags, and broken copies graded: without a marker the row is UNASKED.       |
| `v112-rules.spec.ts`                    | The same for the v1.12 tag, and `112` graded without its markers: the changes are UNASKED.        |
| `loader.spec.ts`                        | Pins the loader defaults, `claimedAtEnd`, row-key hashing, reason params and time helpers.        |
| `__snapshots__/ids.json`                | Every claim and observation id per scenario, so a hashing change is a reviewed diff.              |
| `runner.ts`, `golden.spec.ts`           | The runner: grades every file through the core (gradeBatch or grade, then the events).            |
| `runner-inputs.ts`                      | Checks the inputs gradeBatch returns with every receipt, by replaying them through `grade`.       |
| `runner-diff.ts`                        | Compares a run with the expectations, one line per disagreement.                                  |
| `runner-v14.spec.ts`                    | The v1.4 runner checks (inputs, regrade, rejected events) report broken runs and expectations.    |
| `timezones.spec.ts`                     | Every file graded again under seven host time zones (odd offsets, DST): identical receipts.       |

## File format

`docs/grading.md` §15 is the format, and it documents every key below: `pnpm check-docs` fails when a key that
`scenario-schema.ts` accepts is missing from §15's examples. The same catalogue, for reference while writing a file:

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
    "grants": [{ "ref": "g1", "agent": "muse", "allowedTypes": [], "counterpartyAllowlist": [],
                 "spendCeilingCents": 5000, "spendCurrency": "USD", "declaredScopes": [], "observedScopes": [],
                 "accounts": { "gmail.sent": ["acct-a"] }, "updatedAt": "…" }],
    "coverage": [{ "source": "gcal.event", "lastSyncAt": "…", "windowStart": "…", "windowEnd": "…",
                   "accountHash": "acct-a", "allCalendars": true, "changesSince": "…" }],
    "activity": { "sessions": [], "idle": [], "entries": [], "adapterSyncs": [], "claims": ["c1"] },
    "fixed": [{ "claim": "c9", "observation": "o9" }, { "claim": null, "observation": "o3" }],
    "grade": { "claim": null, "candidates": ["o1"], "agent": "muse", "priorSpendCents": 0, "scope": "…" }
  },
  "events": [{ "event": "override", "ref": "c1", "grade": "VERIFIED", "reason": "…", "at": "…" },
             { "event": "supersede", "ref": "o1", "claim": "c1" },
             { "event": "regrade", "ref": "c1", "evaluatedAt": "…" },
             { "event": "regrade", "ref": "o2", "evaluatedAt": "…", "deleted": true },
             { "event": "override", "ref": "c1", "grade": "NOT_FOUND", "reason": "…", "at": "…", "rejected": true }],
  "assertIds": { "equal": [["o1", "o2"]], "ascending": [["c3", "c4"]] },
  "expect": [{ "ref": "c1", "grade": "VERIFIED", "ruleId": "verified", "state": "FINAL",
               "observationRefs": ["o1"], "score": "1/1", "reasonCodes": ["match.best"],
               "reasonParams": { "match.best": { "observationId": "o1" } },
               "inputs": { "grant": "g1", "priorSpendCents": 0 } },
             { "ref": "o2", "grade": "UNASKED", …, "agent": "muse", "attributionScore": "7/10" },
             { "scope": { "agent": "muse", "scope": "gmail.read" }, "grade": "OVER_SCOPE", …,
               "reasonParams": { "scope.observed_not_declared": { "scopeHash": "gmail.read" } } }]
}
```

- **Refs.** Claims are `c<n>`, observations `o<n>`, grants `g<n>` (optional). An expectation names its subject:
  a claim ref (claim receipt), an observation ref (UNASKED receipt for that orphan), or `scope` (scope-diff
  receipt).
- **Grants (v1.4).** An agent may have several grants; the one in force is the latest `updatedAt ≤ evaluatedAt`
  (§3). `updatedAt` defaults to `evaluatedAt − 1 day`. One agent's grants never share an instant (gradeBatch would
  throw `ambiguous_grant`), and every agent a claim or an expectation names has a grant in force (`89`).
- **`inputs`** (batch mode, v1.4, optional). What gradeBatch returned with the receipt (§3: `{receipt, inputs:
{grant, context, policyHash}}`), stated where it is the point: `grant` (a grant ref; it must be the grant in
  force), `priorSpendCents` (`context.priorSpendCents`) and `scope` (`context.scope.observed`) (`87`–`89`, `93`).
  Whether stated or not, the runner checks every returned input (see "Runner contract").
- **Claims read after `evaluatedAt`** (v1.4). A claim whose `observedAt` is after `evaluatedAt` is still passed to
  gradeBatch (it is in the ledger) but must be ignored (§3): no receipt, no expectation, no spend, no adjacency
  (`88`, `94`).
- **Labels.** `accountHash` and `accounts` entries are short labels; the loader stores SHA-256(label) (§15). A
  `rowKey` label becomes `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (§10 v1.3), for claims (`rawHash`) and
  observations (`contentHash`) alike. Ids and hashes are never typed by hand.
- **`claimedAtEnd`** (v1.2 §4.1; v1.3: `day` precision only, at most `start + 25 h`). The end of the claim's
  precision unit, passed to the core claim as written. Adapters set it for `day` precision to the next local
  midnight, so a 23- or 25-hour DST day is one unit (`68`). It does not enter `rawHash` (§10).
- **`reasonParams`** (§15, optional). The params of every reason, keyed by code, exactly per the closed table
  ("Params per code"). When present it names every code in `reasonCodes`; ids are written as refs (`o1`, `c1`)
  and the loader resolves them; a `scopeHash` is written as the observed scope and the loader stores
  `sha256Hex(scope)` (v1.3, `50`); a `source` is left out for a type with no sources (`45`). Files without it
  assert codes only.
- **`fixed`.** FINAL or USER_OVERRIDDEN pre-assignments (§4.3). A claim named here already holds its receipt: it
  is not passed to `gradeBatch` and gets no expectation. `claim: null` is an overridden UNASKED receipt.
- **`events`.** State events applied with `state.ts` `transition()` after grading, in order (§8). `regrade`
  (batch mode, v1.4) grades the same inputs again at its `evaluatedAt` (each input filtered by that instant, §3)
  and installs the subject's new receipt; with `deleted: true` that grading returns no receipt for the subject,
  and the caller deletes the PENDING UNASKED receipt (§7). `rejected: true` marks an illegal event: `transition`
  must throw `IllegalTransitionError` and nothing changes (a stale regrade, a regrade of a FINAL receipt, an
  override dated before `computedAt`; `93`, `94`).
- **`assertIds`.** When an expectation depends on hash-derived ids (a tie broken by claim or observation id,
  or dedupe by `contentHash`), the file states the id relation it relies on and the spec verifies it.
- **`expect` is the whole result.** In batch mode it lists every receipt `gradeBatch` returns: a missing or an
  extra receipt is a failure. In grade mode it holds exactly the one receipt.
- **Invisible characters** (zero-width, bidi) are written as JSON `\u` escapes, never raw (`72`).

## Loader defaults (§15)

| Object         | Default                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim          | `extractor {golden, 1, 1}`, `sourceKind activity_view`, `claimedAtPrecision minute`, no `claimedAtEnd`, `observedAt = claimedAt`, `text = ref`, no `requestId`                                |
| Claim id       | `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its unit in its own offset}))`, `id = idFromHash(rawHash)` (the v1.4 schema requires it) |
| Observation    | `observedAt` = earliest `lastSyncAt ≤ evaluatedAt` among its source's coverage entries whose window holds `occurredAt`, else `evaluatedAt`                                                    |
| Observation id | `contentHash = sha256(canonicalJson({source, type, …the content fields allowlistedFields[source] names, rowKeyHash if any}))`, `id = idFromHash(contentHash)`                                 |
| Row key        | `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (§10 v1.3); `redact-golden.spec.ts` checks `project()` builds the same observation                                                            |
| Grant          | every type allowed, empty allowlist, `spendCeilingCents null`, no scopes, no accounts, `updatedAt` as written, else `evaluatedAt − 1 day`                                                     |
| Coverage       | `observerId = source`                                                                                                                                                                         |
| Activity       | empty lists; `claims` = every scenario claim                                                                                                                                                  |
| Receipt id     | `idFromHash(sha256(canonicalJson(K)))`, `K = {k:'claim', claimId}` / `{k:'unasked', observationId}` / `{k:'scope', agent, scope}`                                                             |
| Reasons        | only with `reasonParams`: `{code, params}` in `reasonCodes` order, refs resolved to ids, scopes hashed, parsed with the core `Reason` schema                                                  |
| Inputs         | only with `inputs`: the grant ref resolved to the built grant                                                                                                                                 |

## How an expectation is computed

Everything is exact: basis points and reduced fractions, never floats (§5.3). Worked example, `02`:

1. **Window (§4.1).** Claim at 14:02, minute precision → unit `[14:02, 14:03]`, window `[14:00, 14:48]`. With
   `claimedAtEnd` the unit ends there instead of at `start + unit`.
2. **Applicable features (§5.2).** An address claim with a subject: `timeProximity 2500`, `counterpartyExact
3500`, `counterpartyDomain 1500`, `subjectOverlap 1500` bp; Σw = 9000. (A name claim uses
   `counterpartyName 2500` instead of the two address features; a purchase uses `timeProximity`, `amountExact`
   when the claim has an amount, and `merchantMatch` when it has a counterparty; a calendar claim
   `timeProximity`, `subjectOverlap` and the counterparty features.)
3. **Feature values (§5.1, §11).** `raj@company.com` vs `priya@company.com`: ce 0, cd 1 (same non-common
   domain); subjects `{q3, deck}` vs `{q3, budget}` → 1/3; tp 1. Observation counterparties are read through
   `email()` first (`71`).
4. **Score.** S = (2500 + 0 + 1500 + 1500·1/3) / 9000 = 4500/9000 = **1/2**.
5. **Rule (§6).** First match in policy order: S ≥ partial (10000·4500 ≥ 5000·9000) → `partial`.
6. **State (§8).** PARTIAL is FINAL once `graceElapsed`: a sync ≥ end + 30 min and ≥ end + 45 min.
7. **Reasons (§15).** The rule's own code (including `coverage.never_completed`, the `pending` rule's code once
   it finalises), then `allowlist.unchecked` if emitted, then coverage reasons (`coverage.account_unbound` and
   the caps `calendars_hidden`, `changes_unfollowed`, `change_unprovable`, `account_partial`, `multiple_accounts`,
   `no_account`, `no_parser`), then
   `match.*`/`cp.*`, each
   group in table order; `override.user` and `superseded` last (`74`, `80`).

`timeProximity` = 1 within `toleranceMin`, else `(edge − Δ)/(edge − tolerance)` in ms, with edge 120 000 before
the unit, 2 700 000 after it, 259 200 000 around a calendar target. `28` and `29` exercise the millisecond
boundaries (9503999/9504000, 17/20 exactly, 8078399/9504000).

## What v1.12 changed in the files

v1.12 is the Sprint 2 close (the status note of `docs/grading.md`). No file from `01` to `111` changed: the orphan rule
is the same in `src/core`, and what changed is what the service worker stores. A snapshot cannot tell a change the
account made from one other people made to its calendar, so every Calendar row is stored as a first sighting with its
first-look marker, a change a followed view saw included. The rule has a `contract:<tag>` with a proof in
`v112-rules.ts`; `v112-rules.spec.ts` also grades `112` without its markers, to show they decide the file.

- **Calendar changes other people made (§3, §7).** `112` holds an invitation Google added, an organiser's reschedule
  and cancellation, and a colleague's edit on a shared calendar, each a change a followed view saw, each next to an
  agent's session and idle evidence, and each with its marker: none is UNASKED. A claim to have moved the meeting is
  still VERIFIED on the reschedule's row: a marker is never a candidate.

## What v1.11 changed in the files

v1.11 is the Sprint 2 wave E contract (the status note of `docs/grading.md`). Each rule below has a `contract:<tag>`
with a proof in `v111-rules.ts`; `v111-rules.spec.ts` also grades changed copies of `109`–`111`, to show what
decides each file.

- **Calendar change claims are never NOT_FOUND (§6.1).** Every `gcal.event` entry over a `calendar.updated` or
  `calendar.deleted` claim's window is capped `coverage.change_unprovable`; a change row still verifies. `102`'s cap
  is now that code (same grade), `103`'s c2 is `partial_coverage`, PENDING where it was NOT_FOUND, and `109` shows a
  move that reached the ledger as a created and a deleted row: the update claim is `partial_coverage`, while a
  created claim under the same whole, fresh views is NOT_FOUND.
- **Per-account coverage (§6.1).** Under a grant binding two accounts, a window only their views together contain
  is `partial_coverage` with `coverage.account_partial`; one each account's own views contain is NOT_FOUND (`110`,
  Calendar and Gmail Sent).
- **No evidence on time alone (§5.3).** A pair none of whose content features scores above 0 scores `0/1`: never
  assigned, so a false calendar claim no longer takes a real event as PARTIAL evidence, and the event stays an
  orphan (`111`). `78` and `85` now expect `0/1` for a best candidate that matched on time alone (5/14 and 5/18
  before), and `13`'s notes say so for c1 × o2; no grade changed in them.

## What v1.10 changed in the files

v1.10 is the Sprint 2 wave D contract (the status note of `docs/grading.md`). No file from `01` to `103` changed.
Each rule below has a `contract:<tag>` with a proof in `v110-rules.ts`; `v110-rules.spec.ts` also grades broken
copies of the files, to show the marker and the cap decide their outcomes.

- **First-look markers (§3, §7).** Every row a Calendar pass stores as a first sighting comes with a `gcal.event`
  entry at its start (a point) whose `lastSyncAt` and `changesSince` are its first sighting. A file writes the
  marker as an ordinary coverage entry. With it, the row a first look found is no orphan even when no window of its
  pass holds its start: an event that began before the visible range (`104`), one on a day hidden behind "N more"
  (`105`), one from a pass the ledger refused and a later pass derived again (`106`, all or none), one from a pass
  that recorded no window (`107`). Each file also has a change acct-a's view followed, which is UNASKED.
- **Views looked at too early (§6.1).** A `gcal.event` entry synced before a calendar claim's grace sync
  (`end(p,t) + graceMin`) is capped `coverage.changes_unfollowed`: never NOT_FOUND from it, while a row it saw
  still verifies and a view synced after the grace sync still finds NOT_FOUND (`108`).

## What v1.9 changed in the files

v1.9 is the Sprint 2 wave C contract (the status note of `docs/grading.md`). Each rule below has a
`contract:<tag>` with a proof in `v19-rules.ts`.

- **`changesSince` (§3).** A coverage entry may carry it (`gcal.event` only, never after `lastSyncAt`): since when
  that Calendar view followed the window's changes.
- **`86` updated.** Its two Calendar passes now continue a comparison begun at 13:00 (`changesSince`), so its rows,
  first seen at 14:05 and 14:50, stay changes Attest saw happen and the expectation is unchanged. Without it, both
  rows would be what a first look found, and no orphan (§3 v1.9).
- **Receipt points (§3, §6.1).** A `gmail.receipt` pass covers its message's instant only: an exact receipt still
  verifies, a purchase with no receipt read is never NOT_FOUND (`99`), and an unclaimed receipt read at its own
  instant can be UNASKED (`100`).
- **Followed calendar changes (§3, §6.1, §7).** A first look's rows are no orphans (`101`); a deletion claimed
  before Attest first looked is capped `coverage.changes_unfollowed`, never NOT_FOUND (`102`); a followed view
  verifies the deletion it saw and finds an unseen one NOT_FOUND (`103`).
- **File names.** Two digits ran out at `99`: files from `100` on have three (`NNN-slug.json`), and the suite sorts
  them by number.

## What v1.7 changed in the files

v1.7 is the third Sprint 1 review close (the status note of `docs/grading.md`). No file's input or expectation
changed, and the files keep the v1.6 format. Its rules touch what the files never state: the ledger's writes
(§3, §10), reverted overrides (§4.3, §8; the `events` format has no `revert`), and a policy's `unasked.threshold`,
which no `policyPatch` sets. Its new `gradeBatch` refusal (`stale_evaluated_at`, §3) never fires on a file: the
loader dates `fixed` pairs before every instant the file grades at, so each pair's `after` is earlier than every
`evaluatedAt`.

## What v1.6 changed in the files

v1.6 is the Sprint 1 review close (the status note of `docs/grading.md`). One of its rules changes what a file
expects: a spend claim with no currency is counted in the grant's `spendCurrency`, by the cumulative ceiling and by
`priorSpendCents` (§6.1, §6.3).

- **`69` re-derived.** Its c1 and c2 were both currency-less 3000 claims under a 5000 USD ceiling. Under v1.6 c1 is
  c2's prior spend, so 3000 + 3000 > 5000 would make c2 OVER_SCOPE from claim-only facts and FINAL at once, and `69`
  would stop testing what it is for: an OVER_SCOPE that rests on the assigned candidate waits like PARTIAL (§8). c2
  now claims 2000 (3000 + 2000 = 5000 is not over the ceiling), so it stays PENDING; the notes cite §6.1 and §6.3
  v1.6.
- **`98` added.** `69`'s original input, expected under v1.6: both claims are `over_ceiling` (the receipt's CAD),
  and c2 is FINAL at once, because without its candidate `over_ceiling_cumulative` would still conclude OVER_SCOPE.
- No other file's input or expectation changed. v1.6 pre-assignments carry the batches they are in force in (§4.3);
  a file's `fixed` pairs were made before every instant the file grades at, so each is in force in every grading of
  the file (§15).

## What v1.4 (and v1.5) changed in the files

v1.4 settled the wave C questions (Decisions [1.contract] v1.4); v1.5 only changed how `inputsHash` names the
candidates, which no file states. Each rule below has a `contract:<tag>` with a proof in `v14-rules*.ts`.

- **gradeBatch returns `{receipt, inputs}` (§3).** The runner checks every returned input on every receipt
  (policy hash, grant in force, context shape, and replay: `grade` on the inputs gives back the very receipt);
  files state inputs where they are the point: the scope-diff receipts (`87`), the grant chosen (`89`) and the
  spend that a late claim must not add (`88`).
- **Grant in force (§3).** The latest `updatedAt ≤ evaluatedAt`, compared as instants: neither the first nor the
  last listed, nor the first or last listed of those already in force, nor the earliest, nor the latest overall;
  and it took effect at `evaluatedAt` itself, written in another offset, so a strict `<` or a text comparison
  picks another (`89`; its older and future grants' scopes yield no receipt).
- **Late claims ignored (§3).** A claim read after `evaluatedAt` gets no receipt, adds nothing to
  `priorSpendCents` and suppresses no adjacency (`88`); a later regrade sees it (`94`).
- **Adjacency (§7).** Only an _assignable_ claim of the agent, by its precision unit, suppresses
  `activityLogAdjacent`: a vague claim next to an orphan no longer hides it (`85` o1, UNASKED; v1.3 gave no
  receipt), while an assignable one still does (`85` o2, `48`).
- **Calendar anchor (§7).** A calendar orphan's attribution windows are measured from its earliest `observedAt`,
  not the event start (`86`: UNASKED from the first sighting; none from the later sighting; an event attributed
  only from its start has no receipt).
- **Per-source coverage (§6.1).** Full iff every relevant source is full (`90`: one source full and one blind is
  partial, never NOT_FOUND; the union of the intervals would give a false NOT_FOUND).
- **Claim-less default subject (§8).** A claim-less `grade` matching no UNASKED/OVER_SCOPE rule is
  `default_unverifiable`, FINAL, on the orphan's (`91`) or the scope's (`92`) subject, `observationIds []`,
  reasons `[]`; gradeBatch never returns one (checked on every batch file).
- **Params (§15).** `coverage.no_parser` carries `{source}` (`06`, `76`); `ceiling.currency_mismatch.currency` is
  the claim's when present and ≠ `spendCurrency`, else the assigned candidate's (`81` c1 now asserts EUR, the
  candidate's; `81` c3, a EUR claim with a CAD receipt, asserts EUR, the claim's).
- **Events (§8).** A regrade installs a later grading of the same subject (`93` PENDING → FINAL, `94` PENDING
  UNASKED → FINAL UNASKED); a stale regrade (`next.computedAt < computedAt`) and a regrade of a FINAL receipt are
  refused (`93`); an override dated before `computedAt` is refused (`93`); a PENDING UNASKED that a later grading
  no longer returns is deleted (`94` o2); a later supersede replaces the earlier claim and repeating it changes
  nothing (`94`). Existing events (`56`, `57`, `74`) already satisfied every v1.4 rule.
- **Loader.** Grants take an optional `ref` and `updatedAt`; `Claim.id = idFromHash(rawHash)` as before (now a
  schema rule). No existing id changed; the snapshot gained `85`–`94` and `81`'s c3 and o3.

## What v1.3 changed in the files

One behaviour change and a set of clarifications (Decisions [1.contract] v1.3; `git show 02a89c2`).

- **Purchase coverage (§6.1).** A purchase-like claim (its only source is `gmail.receipt`) whose normalised
  counterparty is not in `policy.receiptMerchants`, or which has no counterparty, now has coverage **at most
  partial**, reason `coverage.no_parser`, instead of `none`. A receipt the observer did see still verifies;
  NOT_FOUND stays impossible. Re-derived: `06` (no_coverage → partial_coverage), `62` c3 (same), `76` c2 (same;
  and a new c3 that only the normalised name lets reach NOT_FOUND). Unchanged, re-checked: `09`, `65` (no
  coverage at all, so still `none`), `33`–`35`, `63`, `67`, `69`, `77` (patched `receiptMerchants`, or an
  over-scope rule first). New: `78`.
- **Reason params (§15).** `scope.observed_not_declared` {`scopeHash`: `sha256Hex(scope)`} is now asserted
  (`50`); `override.user.grade`, the ceiling params and `ceiling.exceeded.amountCents` (the §6.1 Amount) read as
  the files already had them. `coverage.no_parser` has no params (the closed table lists none; `06`, `76`).
- **`coverage.never_completed`** is the `pending` rule's own code once it finalises (it replaces
  `grace.waiting`), so it precedes `allowlist.unchecked` (`80` c2; `44`).
- **`cp.*`** come only from address claims (`54` c4); `cp.confusable` replaces `cp.plus_tag` when both apply
  (`79`); `xn--` is detected in any ASCII case (`79` c4).
- **`amountExact`** applies when the claim has `amountCents`, and a currency missing on either side scores 0
  (`63` c1 observation side, `69` claim side).
- **Allowlist (§6.1).** A claim with no address of its own (a name, or no counterparty) and no assigned
  candidate leaves the allowlist unchecked (`80` c1, c2: subject-only calendar claims).
- **Ceilings (§6.1).** The claim's amount counts toward the Amount only when its currency is absent or
  `spendCurrency`; an assigned receipt in another currency is a mismatch whatever the claim's currency (`81`
  c1); an Amount over the ceiling keeps `ceiling.exceeded` next to `ceiling.currency_mismatch` (`81` c2).
- **Best candidate (§8).** Equal best scores break by observation id, lowest first (`82`).
- **Text that displays differently (§11, §5.1).** A bidi embedding (U+202A, U+202B) makes a subject or a name
  unread, like an override; subjects fold compatibility digits with NFKC on purpose (`Q³` → `q3`); merchant text
  `counterparty()` rejects scores `merchantMatch` 0 on the observation and is not applicable on the claim (`84`).
- **Adapter `claimedAt` (§4.1).** Adapters write `claimedAt` at the unit start for `hour` and `day` precision; `27`
  keeps a mid-day `claimedAt` on purpose, so the core must compute `start(p,t)` itself.
- **First-seen and dedupe (§4.1).** `calendar.created` compares `start(p,t) − beforeClaimMin` with the earliest
  `observedAt` of the observation's `contentHash` group (`83`).
- **UNASKED `observationIds`** = `[its orphan]` (§8), as every UNASKED file already had it.
- **Loader.** `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (only `58`'s two observation ids changed);
  `contentHash` over the content fields only plus `rowKeyHash`.

## Readings the contract still leaves open

Each is reported as a contract issue. _Avoided_ files stay off the reading (some enforced by a check); _taken_
readings are asserted and must change if the contract decides otherwise.

1. _Settled in v1.4._ `coverage.no_parser` carries `{source}` (`06`, `76`).
2. _Settled in v1.4._ `ceiling.currency_mismatch.currency` names the candidate's currency when the claim's is
   `spendCurrency` (`81` c1), and the claim's when both differ from it (`81` c3).
3. _Taken._ "An amount is known" (the `amountAboveCeiling` guard) counts a claim amount in another currency, so a
   claim in EUR against a USD ceiling is `ceiling.currency_mismatch` even though that amount is not in the Amount
   (`34`, `65` c2). v1.4's "(the claim's or the assigned candidate's `amountCents`, in any currency)" agrees.
4. _Avoided._ The finality of an over-ceiling claim whose `ceiling.exceeded` comes from the claim alone and whose
   `ceiling.currency_mismatch` comes from the receipt: `81` c2 is past grace, so both readings give FINAL.
5. _Avoided (checked)._ `coverage.no_parser` when coverage would be partial anyway (an interval gap): every
   no-parser file has an interval that holds the whole window; `checks-claims.ts` requires the code on every
   no-parser `partial_coverage` receipt.
6. _Settled in v1.4._ A claim-less `grade()` falling to `default_unverifiable` (`91`, `92`).
7. _Avoided._ An allowlist claim with no address whose assigned candidate has no address either (a calendar
   event with no attendees): no file has one.
8. _Loader convention_, not a grading reading: a claim's truncated `claimedAt` in `rawHash` keeps a `Z` offset
   as `Z` (`31`). It changes golden ids only; the core never recomputes `rawHash`.
9. _Avoided._ Whether `name()` of merchant text that `counterparty()` rejects (a bidi override) can match
   `policy.receiptMerchants` (§6.1 no-parser test): `84` c5 is VERIFIED, which no coverage reading changes.
10. _Avoided._ How many `coverage.none` / `coverage.partial` / `grace.waiting` reasons a claim with several
    relevant sources carries (one per source, or one per source that falls short), and in which order: `90`
    patches out `partial_coverage` so its partial claim falls to `default_unverifiable`, which adds no code.
11. _Avoided._ Whether a calendar UNASKED receipt's finality (§7: "`occurredAt` + beforeClaimMin + graceMin",
    "`occurredAt` + finalizeUnverifiableHours") also moves to the first sighting: `86` is PENDING either way.
12. _Avoided._ `context.priorSpendCents` of a claim-less receipt (§3 calls the field required but defines it for
    claims only): `87`, `89` and `88` state it only for claims.
13. _Taken._ A claim passed to gradeBatch whose `observedAt` is after `evaluatedAt` is ignored entirely (no
    receipt), reading §3's filter ("claims with `observedAt > evaluatedAt` … are ignored") over "grades exactly
    the PENDING `claims` it is given" (`88`, `94`; `checks.ts` expects no receipt for such a claim).

The v1.1/v1.2 readings are all settled now: evidence is the assigned candidate only (`18`–`23`, `30`, `73`);
`gradeBatch` returns claim, UNASKED and `over_scope_observed` receipts only (`46`–`48`, `50`, `73`); no-source
types are `no_coverage` (`45`); `allowlist.unchecked` sits after the rule's code (`37`, `74`);
`ceiling.currency_mismatch` replaces `ceiling.exceeded` unless the Amount exceeds the ceiling (`34`, `65`, `69`,
`81`); `override.user`/`superseded` come last (`56`, `57`, `74`); taken observations are no claim's candidate
(`32`); UNASKED reasons are the attributed agent's signals plus `userIdle` (`47`).

## Independent verification

Every expectation in `01`–`61` was recomputed by a second author from docs/grading.md alone, before reading the
first author's notes (grade, rule, state, evidence, exact score, reason codes); there were no disagreements.
That pass added `62`–`67` (identity per type, purchase feature details, the allowlist on the evidence's
address, the cumulative spend window, UNASKED finalised by time, a ceiling known only from the receipt). The
v1.2 pass added `68`–`74` and asserted params in 44 expectations; an adversarial verifier recomputed them and
added `75`–`77`. The v1.3 pass re-derived every purchase scenario from v1.3 alone (`06`, `62`, `76` changed;
`09`, `33`–`35`, `63`, `65`, `67`, `69`, `77` re-checked unchanged), asserted the scope hash, and added
`78`–`83`, each built so the v1.2-era reading gives a different grade, score or reason (its notes say how).
The v1.3 adversarial verifier recomputed every changed and new file from v1.3 alone (no disagreement) and added
`84` for the §11/§5.1 text rules no file exercised.
After the files were written, the task 1.5 runner (`golden.spec.ts`) graded all of them through the core with
no disagreement. The v1.4 pass re-checked every file against v1.4/v1.5 (only `06`, `76` and `81` changed: their
params), added `85`–`94` computed from the contract alone (each built so the v1.3-era reading gives a different
receipt set, grade or state; its notes say how), and moved the runner to gradeBatch's `{receipt, inputs}`; the
v1.4 core then graded all 94 with no disagreement, every returned input replaying to its receipt. The v1.4
adversarial verifier recomputed `85`–`94`, `06`, `76` and `81` from v1.4/v1.5 alone (no disagreement), then ran
the suite against copies of the core with one v1.4 rule broken at a time: two broken rules passed, so `89` gained
a fourth grant and the in-force grant at `evaluatedAt` itself (a grant picked as the first one already in force
passed), and `81` gained c3 (the claim's currency named before the candidate's; the reverse order passed).
The Sprint 1 close added `95`–`97`, computed from v1.5 alone, for the score cross-check in
`tests/unit/core/features-golden.spec.ts` (each one failed the cross-check as committed and passes the core):
`95` a regrade whose only candidate was first observed after the first pass, with a better row observed only
after the regrade (candidates are read at the receipt's own grading instant, §3, §8); `96` two tied best candidates
whose `cp.*` codes differ, the lower id occurring later (`assertIds`; §8 ties by observation id, §15 `cp.*` from the
best only); `97` a `calendar.created` claim whose pre-existing event outscores the new one (§4.1 first-seen). It also
re-derived `69` and added `98` under v1.6 (above).

## Adding a scenario

1. Pick the next number: `NN-short-slug.json`. Start from the closest existing file.
2. State every input that decides the outcome (§15): coverage with `accountHash`, a non-common domain when you
   rely on `counterpartyDomain`, `targetAt` for calendar claims, positive idle evidence for `userIdle`, and a
   `receiptMerchants` patch when a purchase must be fully covered.
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
  policy order has a best score below that threshold), the §15 emission table and the reason order;
  NOT_FOUND carries `coverage.account_unbound` iff the grant binds no account; `allowlist.unchecked` appears
  exactly when §6.1 makes the allowlist uncheckable; a purchase no parser can see is never NOT_FOUND, and its
  `partial_coverage` receipt names `coverage.no_parser`.
- Asserted params follow the closed §15 table and agree with the claim, grant, evidence, override, supersede
  and scope; every code that has params is asserted somewhere, and the golden params table is the one
  `src/core/schema.ts` `Reason` enforces, code by code.
- UNASKED receipts carry an agent-specific signal and an `attributionScore` equal to their fired signals' weights
  (capped at 1, in basis points); claim-less receipts carry no match, `cp.*`, coverage or allowlist code.
- Underspecified claims, calendar claims without `targetAt` and claims of a type with no sources are never scored
  (§4.3); evidence and `match.best` name an observation of the claim's own type.
- Observations carry only allowlisted fields from a source that sees their type; every patched policy loads.
- Coverage: the 12 mandatory scenarios (checked against `agents/ledger_engineer.md`), the §2 demo and its
  UNVERIFIABLE variant, every rule in `policy/default.json` plus `default_unverifiable`, every ReasonCode, every
  grade and state, both modes, the hardened edge cases, and each v1.2, v1.3 and v1.4 rule with a proof it is
  exercised.
- The scenario enums equal `src/core/schema.ts`; the loader's objects and reasons parse with the core schemas.
- `__snapshots__/ids.json` is byte-identical to what `write-ids.ts` writes.
- Mutation tests (`checks.spec.ts`, `v13-rules.spec.ts`, `v14-rules.spec.ts`) prove the checks and the proofs
  fail on broken files; `golden.spec.ts` and `runner-v14.spec.ts` prove the runner reports broken runs.
- Grants: one instant per agent, a grant in force for every agent named, `inputs.grant` is the grant in force.
  A claim read after `evaluatedAt` has no expectation; a batch file keeps claim-less receipts only when UNASKED
  or OVER_SCOPE; a claim-less `default_unverifiable` (grade mode) is FINAL with no evidence.
- Events (`checks-events.ts`): a stale regrade and an override before `computedAt` are `rejected`, every other
  override is applied, only an orphan is `deleted`, and the expectation shows the last applied override and
  supersede.
- Every `contract:<tag>` a file carries has a proof (`v12-rules.ts`, `v13-rules*.ts`, `v14-rules*.ts`), except
  four descriptive v1.0/v1.1 tags listed in `v13-rules.spec.ts` (`demo`, `demo_unverifiable`,
  `counterparty_domain_plus_tag`, `grade_mode_claimless`).

## Runner contract

For each file: `loadScenario(file)`, `policy = loadPolicy(loaded.policyJson)`, then

- **batch:** `gradeBatch(loaded.batchClaims, createMemoryIndex([...loaded.observations.values()]),
loaded.grants, policy, loaded.coverage, loaded.activity, loaded.fixed)` → `{receipt, inputs}[]` (§3 v1.4);
- **grade:** `grade(call.claim, call.candidates, grantInForce(call.agent), policy, loaded.coverage, context)`,
  where `context = call.context` plus, when `call.attributeFromActivity`, `attribute(call.candidates[0],
loaded.activity, policy)`;

then apply `loaded.events` with `transition()` in order (a `regrade` grades the same inputs again at its instant,
with the coverage's `evaluatedAt` replaced, and installs the subject's receipt from that grading, or deletes a
PENDING UNASKED receipt the grading no longer returns when the event says `deleted`; a `rejected` event must throw
`IllegalTransitionError` and change nothing), and compare by receipt id with `loaded.expected`: the same set of
ids; `grade`, `ruleId`, `state`; `observationIds` = `expected.observationIds`; reason codes as an exact ordered
list, and when `expected.reasons` is set, `receipt.reasons` deep-equal to it; `score` = the exact `features()`
score of the `match.best` candidate as a reduced fraction (null with `match.none` or no claim); `agent`; for
UNASKED the attribution `scoreBp` the receipt was graded with as `attributionScore` and `attribution: 'likely'`;
`override.grade`/`override.previousState`; `supersededBy`; the stated `inputs` (grant by `grantHash`,
`priorSpendCents`, `scope.observed`). Generic checks for every receipt: `computedAt` = the instant of the grading
that produced it (`evaluatedAt`, or its last applied regrade's); `finalAt` = that instant iff the (pre-override)
state is FINAL; claim receipts carry the claim's agent. On every receipt of every batch grading
(`runner-inputs.ts`): `inputs.policyHash` is the policy's, `inputs.grant` is the agent's grant in force,
`inputs.context` has the subject's shape (claim: no attribution or scope; UNASKED: the attributed agent's
attribution; scope: the scope), and `grade(subject, candidates, inputs.grant, policy, coverage, inputs.context)`
gives back the receipt exactly, where the candidates are the claim's §4.1 candidates as of that instant minus
those assigned to other claims, fixed or taken (none for a claim that is not assignable), `[the orphan]` for
UNASKED and `[]` for a scope subject (§4.3, §9).
