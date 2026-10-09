/**
 * The labelled paste corpus (tests/fixtures/paste; Sprint 3 QA review GAP 11; qa_tester rule 2): invented logs in each
 * vendor's shape and, for each, the entries the paste parser should find, each one's outcome, and each claim's type,
 * time, precision, counterparty, amount and event start. `scorePasteCorpus` reads every log as the side panel would
 * and compares field by field; the unit test holds every field right and `pnpm bench` reports the share
 * (bench/adapters/paste.ts). Every log is invented: the number says how the parser reads logs written the way the
 * vendors write them, not how it reads real ones.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { readPastedLog } from '../../../src/adapters/paste';
import { AgentId, IsoTs } from '../../../src/core/schema';

const CORPUS_DIR = path.join(import.meta.dirname, '../../fixtures/paste');

const LabelledClaim = z.strictObject({
  type: z.string(),
  claimedAt: z.string(),
  precision: z.enum(['minute', 'hour', 'day']),
  counterparty: z.string().optional(),
  amountCents: z.number().int().optional(),
  currency: z.string().optional(),
  targetAt: z.string().optional(),
});
const Labels = z.strictObject({
  note: z.string(),
  pastedAt: IsoTs,
  offsetMinutes: z.number().int(),
  logs: z.array(
    z.strictObject({
      file: z.string(),
      agent: AgentId,
      entries: z.array(z.strictObject({ outcome: z.string(), claims: z.array(LabelledClaim) })),
    }),
  ),
});

/** The fields a claim is compared on, as the labels name them. */
const CLAIM_FIELDS = [
  'type',
  'claimedAt',
  'precision',
  'counterparty',
  'amountCents',
  'currency',
  'targetAt',
] as const;

export interface PasteScore {
  readonly logs: number;
  readonly fields: number;
  readonly right: number;
  /** Each field read otherwise than labelled, as `file entry#claim field: read (labelled)`. */
  readonly wrong: readonly string[];
}

/** Reads every labelled log and compares what the parser finds with its labels, field by field. */
export function scorePasteCorpus(): PasteScore {
  const labels = Labels.parse(JSON.parse(readFileSync(path.join(CORPUS_DIR, 'labels.json'), 'utf8')));
  const wrong: string[] = [];
  let fields = 0;
  const check = (where: string, read: unknown, labelled: unknown): void => {
    fields += 1;
    if (read !== labelled) wrong.push(`${where}: ${String(read)} (${String(labelled)})`);
  };
  for (const log of labels.logs) {
    const text = readFileSync(path.join(CORPUS_DIR, log.file), 'utf8');
    const result = readPastedLog(text, {
      agent: log.agent,
      pastedAt: labels.pastedAt,
      offsetAt: () => labels.offsetMinutes,
    });
    const entries = result.ok ? result.log.entries : [];
    check(`${log.file} entries`, entries.length, log.entries.length);
    log.entries.forEach((labelled, e) => {
      const entry = entries[e];
      check(`${log.file} ${String(e)} outcome`, entry?.outcome, labelled.outcome);
      check(`${log.file} ${String(e)} claims`, entry?.claims.length, labelled.claims.length);
      labelled.claims.forEach((claim, c) => {
        const read = entry?.claims[c];
        const actual = read === undefined ? undefined : { ...read, precision: read.claimedAtPrecision };
        for (const field of CLAIM_FIELDS) {
          check(`${log.file} ${String(e)}#${String(c)} ${field}`, actual?.[field], claim[field]);
        }
      });
    });
  }
  return { logs: labels.logs.length, fields, right: fields - wrong.length, wrong };
}
