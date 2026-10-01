import { describe, expect, it } from 'vitest';

import { findLeaks, loadSeeds, normalizeForSearch } from '../../e2e/support/leaks';

const seeds = loadSeeds();
const IDENTIFIER_SHAPED = ['token_lowercase', 'email_local_part', 'passphrase_hyphenated'];
const byId = (id: string) => {
  const seed = seeds.find((s) => s.id === id);
  if (!seed) throw new Error(`no seed ${id}`);
  return seed;
};

describe('seeded secrets file', () => {
  it('has the 15 formats task 0.5 lists', () => {
    const original = seeds.filter((s) => !IDENTIFIER_SHAPED.includes(s.id));
    const kinds = original.map((s) => s.kind);
    expect(original).toHaveLength(15);
    expect(kinds.filter((k) => k === 'api_key')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'email_body')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'name')).toHaveLength(2);
    for (const kind of ['ssn', 'card', 'phone', 'address', 'passphrase', 'url_token', 'base64']) {
      expect(
        kinds.filter((k) => k === kind),
        kind,
      ).toHaveLength(1);
    }
    expect(new Set(seeds.map((s) => s.id)).size).toBe(seeds.length);
  });

  it('also has identifier-shaped seeds, which no shape rule can tell from plumbing (QA-6)', () => {
    const identifier = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
    for (const id of IDENTIFIER_SHAPED) expect(byId(id).value, id).toMatch(identifier);
  });

  it('every seed has canaries, so a partial leak is caught (SECURITY-V3)', () => {
    for (const seed of seeds) expect(seed.canaries.length, seed.id).toBeGreaterThan(0);
  });
});

describe('findLeaks', () => {
  it('finds nothing in clean data', () => {
    const clean = {
      tables: { observations: [{ subjectHint: 'Q3 deck', counterparty: 'priya@example.com' }] },
    };
    expect(findLeaks('indexeddb', clean, seeds)).toEqual([]);
    expect(findLeaks('console', ['[attest] {"event":"background.started"}'], seeds)).toEqual([]);
  });

  it('finds a seed value nested in structured data and reports a path, not the secret', () => {
    const name = byId('person_name_1');
    const leaks = findLeaks('indexeddb', { tables: { claims: [{ counterparty: name.value }] } }, seeds);
    expect(leaks).toEqual([
      { channel: 'indexeddb', seedId: name.id, location: '$.tables.claims[0].counterparty' },
    ]);
    expect(JSON.stringify(leaks)).not.toContain(name.value);
  });

  it('finds a canary fragment (partial leak, e.g. a truncated subject hint)', () => {
    const body = byId('email_body_1');
    const hint = body.value.slice(0, 80);
    expect(findLeaks('export', { subjectHint: hint }, seeds).map((l) => l.seedId)).toContain(body.id);
  });

  it('is case-, whitespace- and Unicode-width-insensitive', () => {
    const passphrase = byId('passphrase');
    const variant = passphrase.value.toUpperCase().replace(/ /g, '\n  ');
    expect(findLeaks('console', [variant], seeds).map((l) => l.seedId)).toEqual([passphrase.id]);
    const fullWidth = 'ＡＫＸＱＺ７ＱＷ３ＲＴ５ＹＵ８ＩＯＰ２Ｘ';
    expect(findLeaks('console', [fullWidth], seeds).map((l) => l.seedId)).toEqual(['api_key_aws_shape']);
  });

  it('finds card numbers with or without separators', () => {
    expect(findLeaks('storage', { v: '4000056655665556' }, seeds).map((l) => l.seedId)).toEqual([
      'card_shape',
    ]);
    expect(findLeaks('storage', { v: '4000-0566-5566-5556' }, seeds).map((l) => l.seedId)).toEqual([
      'card_shape',
    ]);
  });

  it('finds a secret used as an object key', () => {
    const seed = byId('ssn_shape');
    expect(findLeaks('storage', { [seed.value]: true }, seeds).map((l) => l.seedId)).toEqual([seed.id]);
  });

  it('reports one leak per channel and seed', () => {
    const seed = byId('api_key_openai_shape');
    expect(findLeaks('console', [seed.value, seed.value, `x ${seed.value}`], seeds)).toHaveLength(1);
  });

  it('normalises for search: NFKC, lower case, no whitespace, punctuation or symbols', () => {
    expect(normalizeForSearch('  A\tB\n\nC ')).toBe('abc');
    expect(normalizeForSearch('Ottoline Vasquez-Brannigan')).toBe('ottolinevasquezbrannigan');
    expect(normalizeForSearch('912-44-7031')).toBe('912447031');
    expect(normalizeForSearch('ＡＢ＠ｃ.d')).toBe('abcd');
  });

  // SECURITY-V3: every probe the security review found MISSED is now caught.
  it.each([
    ['"who":"ottoline.vasquez-brannigan"', 'person_name_1'],
    ['"who":"vasquez-brannigan"', 'person_name_1'],
    ['OttolineVasquezBrannigan', 'person_name_1'],
    ['"p":"glacier-minnow-trumpet"', 'passphrase'],
    ['"p":"glacier minnow trumpet"', 'passphrase'],
    ['https://x/?q=Ottoline%20Vasquez-Brannigan', 'person_name_1'],
    [`https://x/?q=${Buffer.from('Ottoline Vasquez-Brannigan').toString('base64')}`, 'person_name_1'],
    [`https://x/?q=${Buffer.from('Thaddeus Okonkwo-Lindqvist').toString('base64url')}`, 'person_name_2'],
    [
      `k=${'sk-anx-api99-Hx4Tq9Zm2Wv7Pk5Lr8Nc3Bd6Fg1Js0Ye-Uo2Ia5Ks9Dl3Mn7Qp1Rt4Vx8Zb6Cf-AAAA'.slice(0, 40)}`,
      'api_key_anthropic_shape',
    ],
    ['"ssn":"912447031"', 'ssn_shape'],
    ['{"AKXQZ7QW3RT5YU8IOP2X":1}', 'api_key_aws_shape'],
    ['"amount":4000056655665556', 'card_shape'],
    ['reason=k7pq2vxw9mzr4tnb8hyd', 'token_lowercase'],
    ['reason=perpetua.villanueva', 'email_local_part'],
    ['reason=saffron-otter-lantern-quarry', 'passphrase_hyphenated'],
    ['%7B%22p%22%3A%22glacier%20minnow%20trumpet%22%7D', 'passphrase'],
  ])('catches %s', (line, seedId) => {
    expect(findLeaks('console', [line], seeds).map((l) => l.seedId)).toContain(seedId);
  });

  it('a number in structured data is searched too', () => {
    expect(findLeaks('storage', { amount: 4000056655665556 }, seeds).map((l) => l.seedId)).toContain(
      'card_shape',
    );
  });
});
