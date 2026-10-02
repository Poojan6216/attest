/**
 * Weekly-digest-style counts for the §2 demo (build_spec §2 step 6: "Muse: 11 tasks claimed, 9 verified, 1 not
 * found, 1 unasked."). The digest itself ships in Sprint 4; this applies the counting rules docs/grading.md fixes
 * now, so the demo can state its digest line:
 *  - PENDING receipts are "checking", never counted (§2);
 *  - superseded UNASKED receipts are not counted (§8);
 *  - a USER_OVERRIDDEN receipt counts by its override grade (§8).
 * "Tasks claimed" counts the counted receipts that have a claim; an UNASKED receipt is not a claimed task.
 */
import { AGENT_LABEL } from '../../../src/core/reason-text';
import { type AgentId, Grade, type Receipt } from '../../../src/core/schema';

export interface DigestCounts {
  /** Receipts the digest counts. */
  readonly receipts: number;
  /** Counted receipts of a claim ("tasks claimed"). */
  readonly claimed: number;
  readonly byGrade: Readonly<Record<Grade, number>>;
  /** PENDING receipts: shown as "checking", outside every count. */
  readonly checking: number;
}

/** How the digest writes each grade, in Grade order. */
const GRADE_WORDS: Readonly<Record<Grade, string>> = {
  VERIFIED: 'verified',
  PARTIAL: 'partial',
  NOT_FOUND: 'not found',
  UNASKED: 'unasked',
  OVER_SCOPE: 'over scope',
  UNVERIFIABLE: 'unverifiable',
};

function zeroByGrade(): Record<Grade, number> {
  return { VERIFIED: 0, PARTIAL: 0, NOT_FOUND: 0, UNASKED: 0, OVER_SCOPE: 0, UNVERIFIABLE: 0 };
}

/** The grade a counted receipt is counted as: the override's when the user overrode it. */
function countedGrade(receipt: Receipt): Grade {
  return receipt.override?.grade ?? receipt.grade;
}

export function digestCounts(receipts: readonly Receipt[], agent: AgentId): DigestCounts {
  const byGrade = zeroByGrade();
  let counted = 0;
  let claimed = 0;
  let checking = 0;
  for (const receipt of receipts) {
    if (receipt.agent !== agent || receipt.supersededBy !== undefined) continue;
    if (receipt.state === 'PENDING') {
      checking += 1;
      continue;
    }
    counted += 1;
    if (receipt.claimId !== undefined) claimed += 1;
    byGrade[countedGrade(receipt)] += 1;
  }
  return { receipts: counted, claimed, byGrade, checking };
}

/** The §2 digest line: the agent, its claimed tasks, then every grade with a non-zero count, in Grade order. */
export function digestLine(agent: AgentId, counts: DigestCounts): string {
  const grades = Grade.options
    .filter((grade) => counts.byGrade[grade] > 0)
    .map((grade) => `${counts.byGrade[grade]} ${GRADE_WORDS[grade]}`);
  return `${AGENT_LABEL[agent]}: ${[`${counts.claimed} tasks claimed`, ...grades].join(', ')}.`;
}
