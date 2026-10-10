// @vitest-environment happy-dom
/**
 * The shared receipt components (sprint_4 4.1; src/ui), rendered with Preact in happy-dom: each grade chip carries its
 * name, the badge says "Likely agent" when asked, the coverage header flags what was not checked in words, the
 * degraded banner shows only for a DEGRADED adapter and links to a filled-in issue in a new tab, the evidence list
 * names every stored field, the empty state says what is empty, and the skeleton is a labelled status whose rows are
 * hidden from screen readers. The demo page's samples are valid ledger values, and release builds leave it out.
 */
import { type ComponentChild, h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_ENTRYPOINTS, releaseEntrypoints } from '../../../wxt.config';
import { samples } from '../../../entrypoints/dev/samples';
import { AdapterHealth, Grade, IsoTs } from '../../../src/ledger/types';
import { AgentBadge } from '../../../src/ui/AgentBadge';
import { CoverageHeader } from '../../../src/ui/CoverageHeader';
import { DegradedBanner } from '../../../src/ui/DegradedBanner';
import { EmptyState } from '../../../src/ui/EmptyState';
import { EvidenceList } from '../../../src/ui/EvidenceList';
import { GradeChip } from '../../../src/ui/GradeChip';
import { Skeleton } from '../../../src/ui/Skeleton';

// wxt.config.ts loads WXT through `defineConfig`; a stub that returns its argument keeps this file from loading WXT
// (as tests/unit/manifest-hosts.spec.ts does).
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

const NOW = new Date(2026, 9, 9, 12, 0).getTime();
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

function show(node: ComponentChild): HTMLElement {
  render(node, root);
  return root;
}

const health = (status: 'OK' | 'IDLE' | 'DEGRADED', adapterId = 'gmail.sent') =>
  AdapterHealth.parse({
    adapterId,
    version: '1.5.0',
    status,
    reasons: [],
    checkedAt: IsoTs.parse('2026-10-09T10:00:00Z'),
  });

describe('GradeChip and AgentBadge', () => {
  it('writes every grade in words, read as "Grade: …"', () => {
    for (const grade of Grade.options) {
      const chip = show(h(GradeChip, { grade })).firstElementChild;
      expect(chip?.textContent).toMatch(/^Grade: [A-Z][a-z ]+$/u);
    }
    expect(show(h(GradeChip, { grade: 'OVER_SCOPE' })).textContent).toBe('Grade: Over scope');
  });

  it('names the agent, and says "Likely agent" for an UNASKED receipt', () => {
    const badge = show(h(AgentBadge, { agent: 'chatgpt' }));
    // A screen reader hears "Agent: ChatGPT" (sprint_4 4.10); the eye sees the name alone.
    expect(badge.textContent).toBe('Agent: ChatGPT');
    expect(badge.querySelector('.sr-only')?.textContent).toBe('Agent: ');
    expect(show(h(AgentBadge, { agent: 'muse', likely: true })).textContent).toBe('Likely agent: Muse');
  });
});

describe('CoverageHeader', () => {
  it('lists each source and agent line in a labelled region, the ones not current marked in words', () => {
    const { gaps } = samples(NOW);
    const header = show(h(CoverageHeader, { coverage: gaps, nowMs: NOW }));
    const region = header.querySelector('section');
    expect(region?.getAttribute('aria-label')).toBe('What Attest has checked');
    const items = [...header.querySelectorAll('li')].map((item) => item.textContent);
    expect(items).toEqual([
      'Gmail Sent not checked since 09:00',
      'Gmail receipts not checked yet',
      'Calendar not checked yet',
    ]);
  });
});

describe('DegradedBanner', () => {
  it('draws nothing while every adapter is OK or idle', () => {
    expect(
      show(h(DegradedBanner, { health: [health('OK'), health('IDLE', 'gcal.event')], userAgent: UA }))
        .innerHTML,
    ).toBe('');
  });

  it('names each degraded reader in an alert, with a report link that opens a new tab', () => {
    const banner = show(
      h(DegradedBanner, { health: [health('DEGRADED'), health('OK', 'gcal.event')], userAgent: UA }),
    );
    const alert = banner.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'Degraded: Gmail Sent reader 1.5.0 is not reading its page as expected.',
    );
    expect(alert?.textContent).not.toContain('Calendar');
    const link = banner.querySelector('a');
    expect(link?.textContent).toBe('Report on GitHub (opens a new tab)');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('href')).toContain('Chrome%3A+153');
  });
});

describe('EvidenceList, EmptyState and Skeleton', () => {
  it('lists each piece of evidence with every field, or says there is none', () => {
    const { evidence } = samples(NOW);
    const list = show(h(EvidenceList, { observations: evidence, nowMs: NOW }));
    expect(list.querySelector('ul')?.getAttribute('aria-label')).toBe('Evidence');
    expect(list.querySelectorAll('li')).toHaveLength(3);
    const terms = [...list.querySelectorAll('li:nth-child(2) dt')].map((term) => term.textContent);
    expect(terms).toEqual(['Source', 'What', 'When', 'With', 'Subject', 'First seen', 'Stored']);
    expect(show(h(EvidenceList, { observations: [], nowMs: NOW })).textContent).toBe('No evidence.');
  });

  it('says what is empty as a status, and loads as a labelled status with hidden rows', () => {
    const empty = show(h(EmptyState, { title: 'No receipts today' }, 'Add an agent’s activity to check it.'));
    expect(empty.querySelector('[role="status"]')?.textContent).toBe(
      'No receipts today' + 'Add an agent’s activity to check it.',
    );
    const skeleton = show(h(Skeleton, { rows: 4, label: "Loading today's receipts" }));
    const status = skeleton.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toBe("Loading today's receipts");
    expect(skeleton.querySelector('ul')?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.querySelectorAll('li')).toHaveLength(4);
  });
});

describe('the components page', () => {
  it('builds its samples as valid ledger values', () => {
    const built = samples(NOW);
    expect(built.covered.coverage).toHaveLength(3);
    expect(built.health.filter(({ status }) => status === 'DEGRADED')).toHaveLength(1);
    expect(built.evidence.map(({ source }) => source)).toEqual(['gmail.sent', 'gcal.event', 'gmail.receipt']);
  });

  it('is left out of a release build, and kept in every other', () => {
    const infos = [{ name: 'popup' }, { name: 'dev' }, { name: 'model-check' }, { name: 'sidepanel' }];
    expect(DEV_ENTRYPOINTS).toEqual(['dev', 'model-check']);
    expect(releaseEntrypoints(infos, true).map(({ name }) => name)).toEqual(['popup', 'sidepanel']);
    expect(releaseEntrypoints(infos, false)).toBe(infos);
  });
});
