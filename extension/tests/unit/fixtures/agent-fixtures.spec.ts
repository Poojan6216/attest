// @vitest-environment happy-dom
/**
 * The agent fixtures and their labels agree (sprint_3 3.1; tests/fixtures/pages/README.md "Agent fixtures"). The
 * adapters' accuracy (3.2 to 3.4, the 3.8 bench) is measured against these labels, so a label that drifts from its
 * page would make a measured number false (Hard Rule 12):
 *  - every folder's labels parse, every page is labelled and every label names a page, and a page is synthetic exactly
 *    when its name says so;
 *  - every request's hint and every claim's sentence is text the page shows;
 *  - the three seeds a label lists are drawn on screen, each in its `data-attest-seeded` element, and no request hint
 *    or claim sentence holds one (no label expects an adapter to carry a secret);
 *  - no time a label states is later than the instant the page was read.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { instantMs } from '../../../src/core/normalize';
import seededJson from '../../fixtures/secrets/seeded.json';
import { agentLabelFolders, allAgentFixtures, loadAgentLabels } from './agent-labels';

const SEEDS: ReadonlyMap<string, string> = new Map(seededJson.seeds.map((seed) => [seed.id, seed.value]));
const fixtures = allAgentFixtures();
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();

describe('agent fixture folders', () => {
  it('exist, and in each every page is labelled and every label names a page', () => {
    const folders = agentLabelFolders();
    expect(folders.length).toBeGreaterThan(0);
    for (const { vendor, date, dir } of folders) {
      const pages = readdirSync(dir)
        .filter((file) => file.endsWith('.html'))
        .sort();
      const labelled = loadAgentLabels(vendor, date)
        .map((fixture) => fixture.file)
        .sort();
      expect(labelled, `${vendor}/${date}`).toEqual(pages);
    }
  });
});

describe.each(
  fixtures.map((fixture) => [`${fixture.vendor}/${fixture.date}/${fixture.file}`, fixture] as const),
)('%s', (_, fixture) => {
  const doc = new DOMParser().parseFromString(readFileSync(fixture.htmlPath, 'utf8'), 'text/html');
  const shown = oneLine(doc.body.textContent);

  it('is synthetic exactly when its name says so, and is its folder’s vendor', () => {
    expect(fixture.page.synthetic).toBe(fixture.file.startsWith('synthetic-'));
    expect(fixture.page.vendor).toBe(fixture.vendor);
  });

  it('shows every request hint and every claim sentence', () => {
    for (const request of fixture.requests) expect(shown).toContain(request.textHint);
    for (const claim of fixture.claims) expect(shown).toContain(claim.text);
  });

  it('draws its three seeds on screen in their seeded elements, and no label carries one', () => {
    const ids = fixture.label.seededSecrets;
    expect(new Set(ids).size).toBe(3);
    const carried = [...fixture.requests.map((r) => r.textHint), ...fixture.claims.map((c) => c.text)];
    for (const id of ids) {
      const value = SEEDS.get(id);
      expect(value, id).toBeDefined();
      const element = doc.querySelector(`[data-attest-seeded="${id}"]`);
      expect(element?.textContent, id).toBe(value);
      expect(element?.closest('[hidden], [aria-hidden="true"]'), id).toBeNull();
      for (const text of carried) expect(text).not.toContain(value);
    }
  });

  it('states no time later than the instant the page was read', () => {
    const readMs = instantMs(fixture.page.readAt);
    for (const request of fixture.requests) expect(instantMs(request.ts)).toBeLessThanOrEqual(readMs);
    for (const claim of fixture.claims) expect(instantMs(claim.claimedAt)).toBeLessThanOrEqual(readMs);
  });
});
