/**
 * launch/store-listing.md against what the build ships (sprint_7 7.4, Done when): its name and summary are the manifest's
 * (the store shows those), the summary within the store's 132 characters; its description keeps the launch engineer's
 * order, privacy first and build_spec §11's limits fourth, with no number and no word of hype; every picture it lists is
 * there at its size; and its privacy form's answers name every field the opt-in usage numbers and the own-key model
 * send, read from their schemas, so a field added to either fails here until the listing says it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IntelCandidate, IntelClaim } from '../../../src/intel/input';
import { TelemetryPayload } from '../../../src/telemetry/schema';
import config from '../../../wxt.config';
import { HYPE, missingLimits, read, REPO_ROOT, section as sectionOf } from './copy-rules';

const LISTING = read('launch/store-listing.md');
const PACKAGE = JSON.parse(read('extension/package.json')) as { description: string };

/** The listing's section `heading`, up to the next `## `. */
const section = (heading: string): string => sectionOf(LISTING, heading);

const field = (label: string): string =>
  new RegExp(`^- \\*\\*${label}:\\*\\* (.+)$`, 'mu').exec(LISTING)?.[1] ?? '';

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): readonly [number, number] {
  const png = readFileSync(file);
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

/** Where the listing's form answers name each field sent: a phrase per schema key. */
const USAGE_PHRASES: Readonly<Record<keyof typeof TelemetryPayload.shape, string>> = {
  installId: 'install id',
  extVersion: 'extension and Chrome versions',
  chromeMajor: 'extension and Chrome versions',
  dayBucket: 'the date',
  adaptersEnabled: 'which readers are on',
  observersEnabled: 'which readers are on',
  counts: 'receipts by grade and agent',
  adapterHealth: 'working or degraded',
  coverageHours: 'hours checked',
};
const MODEL_PHRASES: Readonly<
  Record<keyof typeof IntelCandidate.shape | keyof typeof IntelClaim.shape, string>
> = {
  id: "Attest's id",
  type: 'kind',
  counterparty: 'counterparty',
  merchant: 'merchant',
  subjectHint: 'short subject',
  amountCents: 'amount',
  occurredAt: 'time',
};

describe('launch/store-listing.md', () => {
  it("names the item and sums it up as the manifest does, within the store's 132 characters", () => {
    const manifest: unknown = config.manifest;
    expect(field('Name')).toBe(Reflect.get(Object(manifest), 'name'));
    const summary = /^- \*\*Summary\*\* \(132 characters at most\): (.+)$/mu.exec(LISTING)?.[1];
    expect(summary).toBe(PACKAGE.description);
    expect((summary ?? '').length).toBeLessThanOrEqual(132);
  });

  it("orders its description as the launch engineer does, with build_spec §11's limits fourth, no number and no hype", () => {
    const paragraphs = section('Description')
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== '')
      .slice(1);
    expect(paragraphs).toHaveLength(4);
    const [privacy = '', purpose = '', checks = '', limits = ''] = paragraphs;
    expect(privacy).toMatch(/^Nothing leaves your browser unless you turn on an option that sends\./u);
    expect(purpose).toBe(section('Single purpose').trim().split('\n\n')[0]);
    for (const grade of [
      'Verified',
      'Partial',
      'Not found',
      'Over scope',
      'Unverifiable',
      'Unasked, likely agent',
    ])
      expect(checks).toContain(grade);
    expect(limits).toMatch(/^What Attest cannot do\./u);
    expect(missingLimits(limits)).toEqual([]);
    const text = paragraphs.join('\n');
    expect(text).not.toMatch(/\d|!/u);
    expect(HYPE.exec(text)).toBeNull();
  });

  it('lists five 1280×800 screenshots, a 440×280 promo tile and the icon, each where it says', () => {
    const shots = [
      ...section('Screenshots and promo tile').matchAll(/\]\((screenshots\/[^)]+\.png)\)/gu),
    ].map(([, file = '']) => file);
    expect(shots).toHaveLength(5);
    for (const shot of shots) expect(pngSize(path.join(REPO_ROOT, 'launch', shot))).toEqual([1280, 800]);
    expect(pngSize(path.join(REPO_ROOT, 'launch', 'promo-tile.png'))).toEqual([440, 280]);
    for (const size of [16, 32, 48, 96, 128])
      expect(pngSize(path.join(REPO_ROOT, 'extension', 'public', 'icon', `${String(size)}.png`))).toEqual([
        size,
        size,
      ]);
  });
});

describe("launch/store-listing.md's privacy form", () => {
  it('names every field the usage numbers and the model send, as their schemas hold them (privacy re-check)', () => {
    // Each phrase table has one entry per schema key, which its type makes so: a key added to a schema fails the build.
    expect(Object.keys(USAGE_PHRASES).sort()).toEqual(Object.keys(TelemetryPayload.shape).sort());
    const usage = field('Data the developer collects');
    for (const [key, phrase] of Object.entries(USAGE_PHRASES)) expect(usage, key).toContain(phrase);
    expect(Object.keys(MODEL_PHRASES).sort()).toEqual(
      [...new Set([...Object.keys(IntelClaim.shape), ...Object.keys(IntelCandidate.shape)])].sort(),
    );
    const model = field('Data sent to a third party you choose');
    for (const [key, phrase] of Object.entries(MODEL_PHRASES)) expect(model, key).toContain(phrase);
  });
});
