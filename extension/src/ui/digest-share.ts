/**
 * A weekly digest shared (sprint_4 4.7; agents/ux_engineer.md rule 11: share is redacted): markdown made from the stored
 * digest alone (src/ledger/digest.ts). A counterparty is its domain only (the digest keeps no address and no name),
 * amounts and times are kept, a subject only as the hint the ledger keeps, and every UNASKED line says "likely" (Hard
 * Rule 7). A time is written as the ledger stored it, on the clock it was read on, so the text is the same wherever it
 * is made. Text that came from a page (a hint, a domain) is escaped, so it can never become a link or a heading in the
 * markdown. Pure.
 */
import { dateLabel, gapLine, healthWord, instantLabel } from './digest-labels';
import { formatAmount } from './format';
import { escapeMarkdown } from './markdown';
import { AGENT_NAMES, claimTypeLabel } from './labels';
import { adapterName, gradeLabel } from './receipt-labels';
import { withoutAddresses } from '../ledger/domain';
import { type AgentWeek, type DigestRecord, Grade, type NotableReceipt } from '../ledger/types';

/** Every grade, in the schema's order (sprint_4 close, tech review TECH-8). */
const GRADES: readonly Grade[] = Grade.options;

function agentLines(week: AgentWeek): string[] {
  const counts = GRADES.map((grade) => `${gradeLabel(grade)} ${String(week.grades[grade])}`).join(' · ');
  return [
    `## ${AGENT_NAMES[week.agent]}`,
    '',
    `- ${counts}`,
    `- ${String(week.verified)} of ${String(week.checked)} checked claims verified · ${String(week.checking)} still checking · ${String(week.marked)} you marked`,
    '',
  ];
}

function notableLine(receipt: NotableReceipt): string {
  const name = AGENT_NAMES[receipt.agent];
  const who = receipt.grade === 'UNASKED' ? `likely ${name}` : name;
  const parts = [
    receipt.type === undefined ? undefined : claimTypeLabel(receipt.type),
    receipt.at === undefined ? undefined : instantLabel(receipt.at),
    receipt.domain === undefined ? undefined : escapeMarkdown(receipt.domain),
    receipt.amountCents === undefined ? undefined : formatAmount(receipt.amountCents, receipt.currency),
    receipt.subjectHint === undefined
      ? undefined
      : `“${escapeMarkdown(withoutAddresses(receipt.subjectHint))}”`,
  ].filter((part) => part !== undefined);
  const mark = receipt.mark === undefined ? '' : ` (marked ${gradeLabel(receipt.mark.grade)} by the person)`;
  return `- ${gradeLabel(receipt.grade)}: ${who}${parts.length === 0 ? '' : ` (${parts.join(', ')})`}${mark}`;
}

/** The digest as markdown (header). */
export function digestMarkdown(digest: DigestRecord): string {
  const more = digest.notableCount - digest.notable.length;
  const lines = [
    `# Attest weekly digest, week of ${dateLabel(digest.week)}`,
    '',
    ...(digest.agents.length === 0
      ? ['No agent receipt was graded this week.', '']
      : digest.agents.flatMap(agentLines)),
    '## To look at',
    '',
    ...(digest.notable.length === 0
      ? ['- Nothing ended Not found, Unasked or Over scope.']
      : digest.notable.map(notableLine)),
    ...(more > 0 ? [`- And ${String(more)} more.`] : []),
    '',
    '## Coverage',
    '',
    ...(digest.gaps.length === 0
      ? ['- Gmail Sent and Calendar were checked every day.']
      : digest.gaps.map(({ source, days }) => `- ${gapLine(source, days)}`)),
    '',
    '## Readers',
    '',
    ...(digest.health.length === 0
      ? ['- No reader has reported yet.']
      : digest.health.map(
          ({ adapterId, status, version }) =>
            `- ${adapterName(adapterId)}: ${healthWord(status)}, version ${version}`,
        )),
    '',
    `Made by Attest on ${dateLabel(digest.createdAt.slice(0, 10))}, from this browser’s own ledger. Counterparties are shown by domain only.`,
    '',
  ];
  return lines.join('\n');
}
