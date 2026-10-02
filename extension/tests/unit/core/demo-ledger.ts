/**
 * The build_spec §2 demo as synthetic ledger data: the canonical worked example of docs/grading.md (task 1.10).
 * demo.spec.ts grades it through `gradeBatch`, the only path from the background to receipts (§3).
 *
 * Every object is what the extension would hold at that point of the story, built through the same core code
 * the extension uses: the request and claim ids from hash.ts (§10), both Gmail rows through redact.ts `project`
 * (the only way an observer row becomes an Observation, Hard Rule 2), account hashes with `hashText`, and every
 * object parsed by its schema. No id or hash is typed by hand.
 *
 * The story: Tuesday 6 October 2026, one time zone (UTC−04:00), the shipped policy (policy/default.json).
 *
 *   14:00  §2.1  The user asks Muse to email Priya the Q3 deck and book a review for Thursday, then goes idle.
 *   14:01        Muse's session is active (a session ping).
 *   14:02  §2.2  Muse sends the deck to priya@northwind.example, and its activity view says two things.
 *   14:03  §2.5  An email nobody asked for goes to vendor@supplier.example ("Re: invoice").
 *   14:05        Attest reads Muse's activity view: two claims (a Muse adapter sync).
 *   14:09        The user's idle interval ends.
 *   14:10  §2.3  The user opens Gmail (Sent, first page) and Calendar (week view): Attest's first look.
 *   14:40  §2.4  Both checked again (the "checked 14:10 and 14:40" of the Calendar receipt).
 *   14:45        Muse adapter sync.
 *   14:55        Gmail checked once more, after the email claim's whole window could have happened.
 *   15:00  §2.4  Grading (`coverage.evaluatedAt`).
 */
import { type BatchInputs, type BatchReceipt, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { hashCanonical, idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { receiptId, type ReceiptSubject } from '../../../src/core/receipt';
import { hashText, project } from '../../../src/core/redact';
import {
  ActionType,
  Activity,
  Claim,
  Coverage,
  Grant,
  type Observation,
  ObserverCoverage,
  Receipt,
  Request,
  type Ulid,
} from '../../../src/core/schema';
import { truncateIso } from '../../golden/time';

/** Every instant of the story (ISO 8601 with offset; Hard Rule 4: time enters only as data). */
export const AT = {
  /** §2.1 The user's ask; their idle interval starts here. */
  ask: '2026-10-06T14:00:00-04:00',
  museSession: '2026-10-06T14:01:00-04:00',
  /** §2.2 Muse's send to Priya, and the minute of both claims. */
  claimed: '2026-10-06T14:02:00-04:00',
  /** §2.5 The unclaimed send to vendor@. */
  unaskedSend: '2026-10-06T14:03:00-04:00',
  /** Attest reads Muse's activity view (the claims' `observedAt`, a Muse adapter sync). */
  museRead: '2026-10-06T14:05:00-04:00',
  idleEnd: '2026-10-06T14:09:00-04:00',
  /** §2.3 Gmail and Calendar opened: the first sync of each, and both rows' `observedAt`. */
  firstLook: '2026-10-06T14:10:00-04:00',
  /** Before grace: the instant demo.spec.ts grades the same ledger to show nothing is NOT_FOUND yet. */
  beforeGrace: '2026-10-06T14:20:00-04:00',
  secondLook: '2026-10-06T14:40:00-04:00',
  museResync: '2026-10-06T14:45:00-04:00',
  gmailLastLook: '2026-10-06T14:55:00-04:00',
  /** §2.4 Grading. */
  evaluated: '2026-10-06T15:00:00-04:00',
  /** A day later: when a claim no observer could see stops being "checking" (§8, 24 h). */
  nextDay: '2026-10-07T15:00:00-04:00',
  /** "Thu 2pm": the claimed start of the review (`targetAt`). */
  thursday2pm: '2026-10-08T14:00:00-04:00',
  /** The oldest row on Gmail Sent's first page, at every look. */
  gmailPageFrom: '2026-10-06T09:00:00-04:00',
  /** Calendar's week view starts on Monday: Mon 5 Oct 00:00 to Mon 12 Oct 00:00. */
  calendarWeekFrom: '2026-10-05T00:00:00-04:00',
  calendarWeekTo: '2026-10-12T00:00:00-04:00',
} as const;

/** §2.1 What the user typed to Muse. */
export const ASK = 'Email Priya the Q3 deck and put a 30-minute review on my calendar for Thursday.';
/** The user's Google account: Attest stores only its SHA-256 (§3 `accountHash`). */
const ACCOUNT = 'alex@northwind.example';
const MUSE = 'muse';
/** Bucket width of the in-memory ObservationIndex (any positive width reads the same candidates). */
const INDEX_BUCKET_MINUTES = 15;

/** The shipped policy, as the extension loads it. */
export const POLICY = DEFAULT_POLICY;

export interface DemoLedger {
  readonly request: Request;
  /** §2.2 "Sent email to Priya with Q3 deck." */
  readonly emailClaim: Claim;
  /** §2.2 "Created calendar event 'Q3 review' Thu 2pm." */
  readonly calendarClaim: Claim;
  /** §2.3 The sent-folder row to priya@ at 14:02. */
  readonly priyaRow: Observation;
  /** §2.5 The sent-folder row to vendor@ at 14:03 that no claim explains. */
  readonly vendorRow: Observation;
  readonly grant: Grant;
  /** Every observer pass of the story, including those after an earlier `evaluatedAt` (grading ignores them). */
  readonly observers: readonly ObserverCoverage[];
  readonly activity: Activity;
}

/** Whether the user ever opened Calendar: the UNVERIFIABLE variant never does. */
export type CalendarTab = 'opened' | 'never-opened';

// ── §2.1 The ask ────────────────────────────────────────────────────────────────────────────────

/** §10: `Request.id = idFromHash(sha256(canonicalJson({agent, conversationId, textHash, ts})))`. */
function buildRequest(): Request {
  const conversationId = 'muse-conversation-q3';
  const textHash = hashText(ASK);
  const id = idFromHash(hashCanonical({ agent: MUSE, conversationId, textHash, ts: AT.ask }));
  return Request.parse({ id, agent: MUSE, conversationId, textHint: ASK, textHash, ts: AT.ask });
}

// ── §2.2 What Muse says it did ──────────────────────────────────────────────────────────────────

/** One line of Muse's activity view, as the Muse adapter (Sprint 3) extracts it. */
interface MuseLine {
  /** The line as Muse shows it: the claim `text` that rawHash binds (§10). */
  readonly text: string;
  readonly type: ActionType;
  readonly counterparty?: string;
  readonly subjectHint: string;
  readonly targetAt?: string;
}

const EMAIL_LINE: MuseLine = {
  text: 'Sent email to Priya with Q3 deck',
  type: 'email.sent',
  // A name, not an address: matched by `counterpartyName` against the address's local part (§5.1).
  counterparty: 'Priya',
  subjectHint: 'Q3 deck',
};

const CALENDAR_LINE: MuseLine = {
  text: 'Created calendar event Q3 review Thu 2pm',
  type: 'calendar.created',
  subjectHint: 'Q3 review',
  // A calendar claim's window is centred on the event start, ±calendarDays (§4.1).
  targetAt: AT.thursday2pm,
};

/**
 * §10: `Claim.id = idFromHash(rawHash)`, `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null,
 * text, claimedAt truncated to its precision unit}))`. The activity view gives no row id (`rowKeyHash` null).
 */
function buildClaim(line: MuseLine, request: Request): Claim {
  const sourceKind = 'activity_view';
  const claimedAtPrecision = 'minute';
  const rawHash = hashCanonical({
    agent: MUSE,
    sourceKind,
    rowKeyHash: null,
    text: line.text,
    claimedAt: truncateIso(AT.claimed, claimedAtPrecision),
  });
  return Claim.parse({
    id: idFromHash(rawHash),
    agent: MUSE,
    requestId: request.id,
    type: line.type,
    ...(line.counterparty === undefined ? {} : { counterparty: line.counterparty }),
    subjectHint: line.subjectHint,
    claimedAt: AT.claimed,
    claimedAtPrecision,
    ...(line.targetAt === undefined ? {} : { targetAt: line.targetAt }),
    observedAt: AT.museRead,
    sourceKind,
    extractor: { id: 'muse.activity', version: '1', confidence: 1 },
    rawHash,
  });
}

// ── §2.3 and §2.5 What Gmail shows ──────────────────────────────────────────────────────────────

/**
 * The raw rows the Gmail Sent observer reads (Sprint 2) at its first look, 14:10. `snippet` is message content:
 * not in `allowlistedFields['gmail.sent']`, so `project` drops it (Hard Rule 2; demo.spec.ts checks it).
 */
export const GMAIL_ROWS = {
  priya: {
    rowKey: 'gmail-sent:q3-deck-to-priya',
    raw: {
      counterparty: 'priya@northwind.example',
      subjectHint: 'Q3 deck',
      occurredAt: AT.claimed,
      snippet: 'Hi Priya, the Q3 deck is attached. Revenue numbers are on slide 4.',
    },
  },
  vendor: {
    rowKey: 'gmail-sent:re-invoice-to-vendor',
    raw: {
      counterparty: 'vendor@supplier.example',
      subjectHint: 'Re: invoice',
      occurredAt: AT.unaskedSend,
      snippet: 'Approved, please go ahead and charge the card on file.',
    },
  },
} as const;

function readGmailRow(row: (typeof GMAIL_ROWS)[keyof typeof GMAIL_ROWS]): Observation {
  const context = { type: 'email.sent', observedAt: AT.firstLook, rowKey: row.rowKey } as const;
  return project('gmail.sent', row.raw, context, POLICY);
}

// ── What the user said Muse may do ──────────────────────────────────────────────────────────────

/** A default permissive grant: every type, no allowlist, no ceiling, no bound accounts; set up last week. */
function buildGrant(): Grant {
  return Grant.parse({
    agent: MUSE,
    allowedTypes: [...ActionType.options],
    counterpartyAllowlist: [],
    spendCeilingCents: null,
    declaredScopes: [],
    updatedAt: '2026-09-29T09:00:00-04:00',
  });
}

// ── What Attest could see, and when (§3 coverage) ───────────────────────────────────────────────

/**
 * Gmail Sent, first page: a newest-first list whose pass saw the head, so `windowEnd = lastSyncAt` (§3). The
 * 14:40 look already finalises VERIFIED (a sync ≥ end(p,t) + graceMin = 14:33, §8); the 14:55 look comes after
 * the email claim's whole window (end + afterClaimMin = 14:48), which PARTIAL or NOT_FOUND would need.
 */
function gmailPass(lastSyncAt: string): ObserverCoverage {
  return ObserverCoverage.parse({
    observerId: 'gmail.sent',
    source: 'gmail.sent',
    lastSyncAt,
    windowStart: AT.gmailPageFrom,
    windowEnd: lastSyncAt,
    accountHash: hashText(ACCOUNT),
  });
}

/**
 * Calendar, the Monday-start week view with every calendar visible (`allCalendars`, §6.1). It contains the whole
 * calendar claim window, Thursday 14:00 ± 3 days = [Mon 14:00, Sun 14:00], so coverage is full.
 */
function calendarPass(lastSyncAt: string): ObserverCoverage {
  return ObserverCoverage.parse({
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt,
    windowStart: AT.calendarWeekFrom,
    windowEnd: AT.calendarWeekTo,
    accountHash: hashText(ACCOUNT),
    allCalendars: true,
  });
}

// ── Muse activity (§7: allowlisted signals only) ────────────────────────────────────────────────

/**
 * A session ping at 14:01 (within ±sessionMin of 14:03), a recorded idle interval 14:00–14:09 (it covers
 * [14:03 − idleMin, 14:03]: positive evidence, never inferred), and Muse adapter syncs; the 14:45 one is
 * ≥ 14:03 + beforeClaimMin + graceMin = 14:35, late enough for the UNASKED receipt to be FINAL (§7). `claims`
 * holds every Muse claim within retention (§3).
 */
function buildActivity(claims: readonly Claim[]): Activity {
  return Activity.parse({
    sessions: [{ agent: MUSE, at: AT.museSession }],
    idle: [{ from: AT.ask, to: AT.idleEnd }],
    entries: [],
    adapterSyncs: [
      { agent: MUSE, lastSyncAt: AT.museRead },
      { agent: MUSE, lastSyncAt: AT.museResync },
    ],
    claims,
  });
}

/** The ledger the §2 story leaves behind. `never-opened`: no Calendar pass at all (the UNVERIFIABLE variant). */
export function buildDemo(calendar: CalendarTab = 'opened'): DemoLedger {
  const request = buildRequest();
  const emailClaim = buildClaim(EMAIL_LINE, request);
  const calendarClaim = buildClaim(CALENDAR_LINE, request);
  const gmail = [AT.firstLook, AT.secondLook, AT.gmailLastLook].map(gmailPass);
  const gcal = calendar === 'opened' ? [AT.firstLook, AT.secondLook].map(calendarPass) : [];
  return {
    request,
    emailClaim,
    calendarClaim,
    priyaRow: readGmailRow(GMAIL_ROWS.priya),
    vendorRow: readGmailRow(GMAIL_ROWS.vendor),
    grant: buildGrant(),
    observers: [...gmail, ...gcal],
    activity: buildActivity([emailClaim, calendarClaim]),
  };
}

// ── §2.4 Grading ────────────────────────────────────────────────────────────────────────────────

/** The three receipts of the story, found by their subject ids (§3), plus everything `gradeBatch` returned. */
export interface DemoReceipts {
  readonly all: readonly Receipt[];
  readonly email: Receipt;
  readonly calendar: Receipt;
  readonly unasked: Receipt;
  /** The coverage the batch graded against (§3: `receiptInputs` stores it beside each receipt's inputs). */
  readonly coverage: Coverage;
  /** What each receipt was graded with, by receipt id (§3): the grant, context and policy hash replay needs (§9). */
  readonly inputs: ReadonlyMap<Ulid, BatchInputs>;
}

function bySubject(receipts: readonly Receipt[], subject: ReceiptSubject): Receipt {
  const id = receiptId(subject);
  const found = receipts.find((receipt) => receipt.id === id);
  if (found === undefined) throw new Error(`demo: no receipt for subject ${subject.k}`);
  return found;
}

/**
 * Grades the ledger as the background would at `evaluatedAt`: one `gradeBatch` over both PENDING claims, both
 * Gmail rows, the grant, every observer pass and Muse's activity. Inputs from after `evaluatedAt` (later syncs,
 * later activity) are ignored by the core (§3), so one ledger can be graded at several instants of the story.
 * `gradeBatch` returns `{receipt, inputs}` items (§3); each receipt is parsed by its schema.
 */
export async function gradeDemo(ledger: DemoLedger, evaluatedAt: string): Promise<DemoReceipts> {
  const index = createMemoryIndex([ledger.priyaRow, ledger.vendorRow], INDEX_BUCKET_MINUTES);
  const coverage = Coverage.parse({ evaluatedAt, observers: ledger.observers });
  const claims = [ledger.emailClaim, ledger.calendarClaim];
  const items: BatchReceipt[] = await gradeBatch(
    claims,
    index,
    [ledger.grant],
    POLICY,
    coverage,
    ledger.activity,
  );
  const all = items.map((item) => Receipt.parse(item.receipt));
  return {
    all,
    email: bySubject(all, { k: 'claim', claimId: ledger.emailClaim.id }),
    calendar: bySubject(all, { k: 'claim', claimId: ledger.calendarClaim.id }),
    unasked: bySubject(all, { k: 'unasked', observationId: ledger.vendorRow.id }),
    coverage,
    inputs: new Map(items.map((item) => [item.receipt.id, item.inputs])),
  };
}
