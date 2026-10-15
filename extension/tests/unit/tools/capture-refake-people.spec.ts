/**
 * The second re-fake (tests/tools/capture-refake-people.ts; MANUAL.md, before the repository goes public): emails,
 * names and phrases a capture faked with the public seed become HMAC(key; old fake) in the faker's shapes, found by
 * those shapes alone, with one mapping for a page and its labels. Every value below is invented.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CaptureError } from '../../tools/capture-error';
import { applyPeople, fakesIn, main, peopleMapping } from '../../tools/capture-refake-people';

const SEED = 'a'.repeat(64);
const PAGE =
  '<div role="main"><span email="corett.belmore@example.com" name="Corett Belmore">Corett Belmore</span>' +
  '<span class="bog">Amber basin cobalt</span><span>Echo</span>' +
  '<p aria-label="Corett Belmore, Amber basin cobalt, 3:04 PM">From ASHDALE, to ashdale, Corettbelmore</p>' +
  '<p>Gmail Inbox, receipts@t.shopifyemail.com, ashdale@uber.example, Ashdales, Ambers, amber basin</p></div>';
const LABELS = JSON.stringify({
  to: ['corett.belmore@example.com'],
  subject: 'Amber basin cobalt',
  who: 'Ashdale',
});
const mappingOf = (...texts: string[]) => peopleMapping(fakesIn(texts), SEED);

describe('the shapes of a public-seed fake', () => {
  it('finds the addresses, the pool names in each case and the phrases, and no page word', () => {
    const found = fakesIn([PAGE]);
    expect([...found.email]).toEqual(['corett.belmore@example.com']);
    expect([...found.name].sort()).toEqual(['ashdale', 'corett', 'corettbelmore', 'belmore'].sort());
    expect([...found.phrase].sort()).toEqual(['Amber basin cobalt', 'Echo'].sort());
  });
});

describe('applyPeople', () => {
  it('gives each old fake one new fake on the page and in its labels, in the case it was written', () => {
    const mapping = mappingOf(PAGE, LABELS);
    const page = applyPeople(PAGE, mapping).text;
    const labels = JSON.parse(applyPeople(LABELS, mapping).text) as {
      to: string[];
      subject: string;
      who: string;
    };
    const email = mapping.email.get('corett.belmore@example.com') ?? '?';
    const ashdale = mapping.name.get('ashdale') ?? '?';
    const subject = mapping.phrase.get('Amber basin cobalt') ?? '?';
    expect(labels).toEqual({ to: [email], subject, who: ashdale });
    expect(page).toContain(`email="${email}"`);
    expect(page).toContain(
      `aria-label="${mapping.name.get('corett') ?? '?'} ${mapping.name.get('belmore') ?? '?'}, ${subject}, 3:04 PM"`,
    );
    expect(page).toContain(`From ${ashdale.toUpperCase()}, to ${ashdale.toLowerCase()}, `);
    expect(email).toMatch(/^[a-z]+\.[a-z]+\d*@example\.(?:com|org|net)$/u);
    expect(subject.split(' ')).toHaveLength(3);
  });

  it("gives a kept sender's fake local part a new one at the sender's own domain", () => {
    const sender = '<span email="corsby.ashard@receipts.shop.example">Receipts</span>';
    const mapping = mappingOf(sender);
    const out = applyPeople(sender, mapping).text;
    expect(out).toMatch(/^<span email="[a-z]+\.[a-z]+\d*@receipts\.shop\.example">Receipts<\/span>$/u);
    expect(out).not.toContain('corsby.ashard');
  });

  it('leaves every other byte as it was, and no old fake behind', () => {
    const mapping = mappingOf(PAGE);
    const page = applyPeople(PAGE, mapping).text;
    expect(page).toContain(
      '<p>Gmail Inbox, receipts@t.shopifyemail.com, ashdale@uber.example, Ashdales, Ambers, amber basin</p>',
    );
    for (const old of ['corett.belmore@', 'Corett Belmore', 'Amber basin cobalt', '>Echo<', 'ASHDALE'])
      expect(page).not.toContain(old);
    const after = fakesIn([page]);
    for (const kind of ['email', 'name', 'phrase'] as const)
      for (const value of after[kind]) expect(mapping[kind].has(value)).toBe(false);
  });

  it('counts what it replaced, and fails on a fake the mapping does not hold', () => {
    const mapping = mappingOf(PAGE);
    expect(applyPeople(PAGE, mapping).counts).toEqual({ email: 1, name: 9, phrase: 3, clamp: 0 });
    expect(() => applyPeople('<p>Ashett</p>', mapping)).toThrow(CaptureError);
  });

  it('is pure: one seed, one mapping; another seed, another; no new fake is an old one', () => {
    expect(peopleMapping(fakesIn([PAGE]), SEED)).toEqual(peopleMapping(fakesIn([PAGE]), SEED));
    expect(peopleMapping(fakesIn([PAGE]), 'b'.repeat(64))).not.toEqual(peopleMapping(fakesIn([PAGE]), SEED));
    const mapping = mappingOf(PAGE, LABELS);
    const olds = new Set([...mapping.email.keys(), ...mapping.name.keys(), ...mapping.phrase.keys()]);
    const news = [...mapping.email.values(), ...mapping.name.values(), ...mapping.phrase.values()];
    for (const fake of news) expect(olds.has(fake.toLowerCase()) || olds.has(fake)).toBe(false);
  });
});

describe('a full pool', () => {
  it('gives a one-word phrase two words once every one-word phrase is an old fake', () => {
    const words =
      'amber basin cobalt delta ember fable garnet harbor island juniper kettle lantern meadow nectar orbit pepper quarry ripple saffron timber umber velvet willow yonder zephyr bramble cinder dapple echo fern glade hollow';
    const page = words
      .split(' ')
      .map((word) => `<b>${word.charAt(0).toUpperCase()}${word.slice(1)}</b>`)
      .join('');
    const mapping = mappingOf(page);
    expect(mapping.phrase.size).toBe(32);
    for (const fake of mapping.phrase.values()) expect(fake.split(' ').length).toBeGreaterThan(1);
  });
});

describe('a subject hint (src/core/redact.ts clampSubjectHint)', () => {
  it("keeps each phrase on its side of a subject hint's 80 characters, and gives a label's cut hint the new cut", () => {
    const long = 'Lantern saffron juniper bramble lantern saffron juniper bramble lantern saffron juniper';
    expect(long.length).toBeGreaterThan(80);
    const short = 'Echo fern echo fern echo fern echo fern echo fern echo fern';
    const page = `<span class="bog">${long}</span><span class="bog">${short}</span>`;
    const labels = JSON.stringify({ subjects: [long.slice(0, 80), short] });
    const mapping = mappingOf(page, labels);
    expect([...mapping.phrase.keys()].sort()).toEqual([long, short].sort());
    const newLong = mapping.phrase.get(long) ?? '';
    const newShort = mapping.phrase.get(short) ?? '';
    expect(newLong.length).toBeGreaterThan(80);
    expect(newShort.length).toBeLessThanOrEqual(80);
    const out = JSON.parse(applyPeople(labels, mapping).text) as { subjects: string[] };
    expect(out.subjects).toEqual([newLong.slice(0, 80), newShort]);
    expect(applyPeople(labels, mapping).counts.clamp).toBe(1);
  });
});

describe('the second re-fake command', () => {
  it('refuses a record inside the repository, or none: the record holds the old fakes', async () => {
    await expect(main(['--record', path.resolve('tests', 'people.json'), 'missing.html'])).rejects.toThrow(
      CaptureError,
    );
    await expect(main(['missing.html'])).rejects.toThrow(CaptureError);
  });
});
