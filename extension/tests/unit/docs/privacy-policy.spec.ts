/**
 * PRIVACY.md held to the code it describes (Sprint 7 close: QA review QA-11, privacy review gaps 6, 7, 9 and 12, tech
 * review TECH-6): both paragraphs on your own model key name every field the model is sent (src/intel/input.ts), the
 * purchase case among them; the usage numbers' paragraph names every field of the report (src/telemetry/schema.ts) and
 * says totals are published; neither the policy's summaries nor the listing's call the numbers "counts only"; and the
 * policy never says no server runs, and names the telemetry host once it is a real one (wxt.config.ts
 * `assertReleasable` refuses a store build until it does).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TELEMETRY_HOST } from '../../../src/config';
import { IntelCandidate, IntelClaim } from '../../../src/intel/input';
import { TelemetryPayload } from '../../../src/telemetry/schema';
import { REPO_ROOT } from './public-numbers';

const POLICY = readFileSync(path.join(REPO_ROOT, 'PRIVACY.md'), 'utf8');
const LISTING = readFileSync(path.join(REPO_ROOT, 'launch', 'store-listing.md'), 'utf8');

/** The paragraph of `text` that starts with `start`. */
function paragraph(text: string, start: string): string {
  const found = text.split('\n\n').find((part) => part.trimStart().startsWith(start));
  if (found === undefined) throw new Error(`no paragraph starting "${start}"`);
  return found;
}

/** How the policy names each field the model is sent, in plain words. */
const MODEL_WORDS: Readonly<
  Record<keyof typeof IntelCandidate.shape | keyof typeof IntelClaim.shape, string>
> = {
  id: "Attest's id",
  type: 'kind of action',
  counterparty: 'who it was to',
  merchant: 'merchant',
  subjectHint: 'short subject',
  amountCents: 'amount',
  occurredAt: 'time',
};

/** How the policy names each field of the usage report. */
const USAGE_WORDS: Readonly<Record<keyof typeof TelemetryPayload.shape, string>> = {
  installId: 'random install id',
  extVersion: 'Attest version',
  chromeMajor: 'Chrome major version',
  dayBucket: 'the date',
  adaptersEnabled: 'which page readers were on',
  observersEnabled: 'which page readers were on',
  counts: 'how many receipts each agent got of each grade',
  adapterHealth: 'whether they worked',
  coverageHours: 'how many hours of the day they covered',
};

const USAGE = paragraph(POLICY, '**Anonymous usage numbers**');

describe('PRIVACY.md', () => {
  it('names every field the model is sent, the purchase case too, in both paragraphs on it', () => {
    expect(Object.keys(MODEL_WORDS).sort()).toEqual(
      [...new Set([...Object.keys(IntelClaim.shape), ...Object.keys(IntelCandidate.shape)])].sort(),
    );
    for (const start of ['The model is given only', '**Your own model key**']) {
      const text = paragraph(POLICY, start);
      for (const [field, words] of Object.entries(MODEL_WORDS))
        expect(text, `${start}: ${field}`).toContain(words);
      expect(text, start).toContain('for a purchase');
    }
  });

  it('names every field of the usage report, and says totals are published from it', () => {
    expect(Object.keys(USAGE_WORDS).sort()).toEqual(Object.keys(TelemetryPayload.shape).sort());
    for (const [field, words] of Object.entries(USAGE_WORDS)) expect(USAGE, field).toContain(words);
    expect(USAGE).toContain('It publishes only totals across installs');
    expect(USAGE).toContain('The server cannot verify an install id');
  });

  it('never calls the usage numbers counts only, in the policy or in the listing', () => {
    const summaries = [
      paragraph(POLICY, 'Nothing leaves your browser unless you turn it on.'),
      paragraph(POLICY, 'What Attest reads from your Gmail and Calendar tabs'),
      USAGE,
      paragraph(LISTING, 'Nothing leaves your browser unless you turn on an option that sends.'),
      paragraph(LISTING, 'Data read from your Gmail and Calendar tabs'),
    ];
    for (const text of summaries) expect(text).not.toMatch(/counts only/iu);
  });

  it('never says no server runs, and names the telemetry host once it is a real one', () => {
    expect(POLICY).not.toMatch(/none running|nothing arrives anywhere/iu);
    expect(USAGE).toContain('whose address the options page shows beside the switch');
    if (!TELEMETRY_HOST.endsWith('.invalid')) expect(POLICY).toContain(TELEMETRY_HOST);
  });
});
