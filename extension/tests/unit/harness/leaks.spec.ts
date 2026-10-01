import { describe, expect, it } from 'vitest';

import { findLeaks, loadSeeds, normalizeForSearch } from '../../e2e/support/leaks';

const seeds = loadSeeds();
const byId = (id: string) => {
  const seed = seeds.find((s) => s.id === id);
  if (!seed) throw new Error(`no seed ${id}`);
  return seed;
};

describe('seeded secrets file', () => {
  it('has exactly the 15 formats task 0.5 lists', () => {
    const kinds = seeds.map((s) => s.kind);
    expect(seeds).toHaveLength(15);
    expect(kinds.filter((k) => k === 'api_key')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'email_body')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'name')).toHaveLength(2);
    for (const kind of ['ssn', 'card', 'phone', 'address', 'passphrase', 'url_token', 'base64']) {
      expect(
        kinds.filter((k) => k === kind),
        kind,
      ).toHaveLength(1);
    }
    expect(new Set(seeds.map((s) => s.id)).size).toBe(15);
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

  it('normalises for search', () => {
    expect(normalizeForSearch('  A\tB\n\nC ')).toBe('a b c');
  });
});
