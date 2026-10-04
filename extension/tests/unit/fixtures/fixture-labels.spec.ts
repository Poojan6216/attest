/**
 * The observer fixture corpus is well formed (sprint 2 tasks 2.1, 2.4; tests/fixtures/pages/README.md):
 *  - every labels.json parses (fixture-labels.ts) and names exactly the HTML files beside it;
 *  - every seeded secret a label lists is in the page's visible text, and no seed value or canary appears in any
 *    label string, so an extractor that matches the labels cannot be leaking a seed (Hard Rule 2);
 *  - every observation fact is one `redact.project()` returns unchanged under the shipped policy, so the labels ask
 *    for nothing project would refuse or drop;
 *  - each fact binds to the page (row ids, addresses, subjects, event ids, the account switcher), coverage only
 *    follows an OK pass (Hard Rules 5, 6), and dedup and diff facts agree with the facts they compare.
 * No observer code runs here: these checks are on the corpus itself.
 */
import { readdirSync, readFileSync } from 'node:fs';

import type { Document, Element } from 'happy-dom';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { CONTENT_FIELDS, project } from '../../../src/core/redact';
import { closeWindow, createInertWindow } from '../../tools/capture-dom';
import { BaseSeed, SEEDS_PATH } from '../../tools/seeds';
import {
  type Fact,
  labelFolders,
  type LabelledFixture,
  loadLabels,
  loadVendor,
  type ObservationFact,
  projectArgs,
} from './fixture-labels';

const SEEDS = z
  .object({ seeds: z.array(BaseSeed) })
  .parse(JSON.parse(readFileSync(SEEDS_PATH, 'utf8'))).seeds;
const window = createInertWindow();
afterAll(() => {
  closeWindow(window);
});

const docs = new Map<string, Document>();
function docOf(fixture: LabelledFixture): Document {
  let doc = docs.get(fixture.htmlPath);
  if (!doc) {
    doc = new window.DOMParser().parseFromString(readFileSync(fixture.htmlPath, 'utf8'), 'text/html');
    docs.set(fixture.htmlPath, doc);
  }
  return doc;
}

const collapse = (text: string | null | undefined): string => (text ?? '').replace(/\s+/gu, ' ').trim();
/** The no-leak matching: NFKC, case-insensitive, ignoring whitespace, punctuation and symbols. */
const fold = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
  }
  return [];
}

const folders = labelFolders();
const fixtures = folders.flatMap(({ vendor, date }) => loadLabels(vendor, date));
const byName = (fixture: LabelledFixture, file: string): LabelledFixture | undefined =>
  fixtures.find((other) => other.dir === fixture.dir && other.file === file);

function projected(fact: ObservationFact, readAt: string) {
  const { source, raw, ctx } = projectArgs(fact, readAt);
  return project(source, raw, ctx, DEFAULT_POLICY);
}

describe('observer fixture labels', () => {
  it('finds the Gmail and Calendar corpora (2.1: at least 12 Gmail fixtures; 2.4: at least 4 Calendar)', () => {
    expect(folders.map((f) => f.vendor)).toEqual(expect.arrayContaining(['gmail', 'gcal']));
    expect(loadVendor('gmail').length).toBeGreaterThanOrEqual(12);
    expect(loadVendor('gcal').length).toBeGreaterThanOrEqual(4);
  });

  it('every labels.json names exactly the HTML files beside it', () => {
    for (const folder of folders) {
      const html = readdirSync(folder.dir)
        .filter((name) => name.endsWith('.html'))
        .sort();
      const labelled = fixtures
        .filter((f) => f.dir === folder.dir)
        .map((f) => f.file)
        .sort();
      expect(labelled, folder.dir).toEqual(html);
    }
  });

  it('a fixture is named synthetic-*.html exactly when its page fact says synthetic', () => {
    for (const f of fixtures) expect(f.page.synthetic, f.file).toBe(f.file.startsWith('synthetic-'));
  });

  it('page facts match their folder and their page (vendor, account switcher)', () => {
    for (const f of fixtures) {
      expect(f.page.vendor, f.file).toBe(f.vendor);
      expect(f.label.capturedAt, f.file).toBe(f.date);
      const account = docOf(f).querySelector('[role="banner"] [aria-label^="Google Account:"]');
      expect(account?.getAttribute('aria-label'), f.file).toContain(`(${f.page.account})`);
      expect(docOf(f).querySelector('[role="main"]'), f.file).not.toBeNull();
    }
  });
});

describe('seeded secrets', () => {
  it('each listed seed exists and sits in the text of its page (fixture-pages.spec.ts: drawn on screen)', () => {
    for (const f of fixtures) {
      expect(f.label.seededSecrets.length, f.file).toBeGreaterThanOrEqual(3);
      const doc = docOf(f);
      const text = collapse(doc.body.textContent);
      for (const id of f.label.seededSecrets) {
        const secret = SEEDS.find((s) => s.id === id);
        expect(secret, `${f.file}: ${id}`).toBeDefined();
        const marked = doc.querySelector(`[data-attest-seeded="${id}"]`);
        expect(collapse(marked?.textContent), `${f.file}: ${id}`).toBe(collapse(secret?.value));
        expect(text, `${f.file}: ${id}`).toContain(collapse(secret?.value));
      }
    }
  });

  it('no seed value or canary appears in any label string (expected values, notes, keys)', () => {
    const needles = SEEDS.flatMap((s) =>
      [s.value, ...s.canaries].map((n) => ({ id: s.id, needle: fold(n) })),
    );
    for (const f of fixtures) {
      for (const value of strings(f.label)) {
        const hay = fold(value);
        const hit = needles.find(({ needle }) => needle.length >= 6 && hay.includes(needle));
        expect(hit, `${f.file}: a label string holds seed ${hit?.id ?? ''}`).toBeUndefined();
      }
    }
  });
});

describe('observation facts are what project() keeps', () => {
  const all = fixtures.flatMap((f) =>
    [...f.observations, ...f.diffs.flatMap((d) => d.observations)].map((fact) => ({ f, fact })),
  );

  it('there are observation facts to check', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('project() accepts each fact under the shipped policy and keeps every field unchanged', () => {
    for (const { f, fact } of all) {
      const observation = projected(fact, f.page.readAt);
      const kept = Object.fromEntries(
        CONTENT_FIELDS.flatMap((k) => (observation[k] === undefined ? [] : [[k, observation[k]]])),
      );
      const asked = Object.fromEntries(
        CONTENT_FIELDS.flatMap((k) => (fact[k] === undefined ? [] : [[k, fact[k]]])),
      );
      expect(kept, `${f.file}: ${fact.rowKey ?? ''}`).toEqual(asked);
      expect(observation.rowKeyHash === undefined, f.file).toBe(fact.rowKey === undefined);
    }
  });

  it('each fact type is one its source serves (policy.sourcesByType)', () => {
    for (const { f, fact } of all) {
      expect(DEFAULT_POLICY.sourcesByType[fact.type], `${f.file}: ${fact.type}`).toContain(fact.source);
    }
  });

  it('a Gmail sent fact never lies in the future of the read', () => {
    for (const { f, fact } of all.filter((a) => a.fact.source !== 'gcal.event')) {
      expect(Date.parse(fact.occurredAt), f.file).toBeLessThanOrEqual(Date.parse(f.page.readAt));
    }
  });
});

describe('health and coverage honesty (Hard Rules 5, 6)', () => {
  it('every Gmail page reports gmail.sent health; every opened message reports gmail.receipt health', () => {
    for (const f of fixtures.filter((x) => x.vendor === 'gmail')) {
      expect(
        f.health.map((h) => h.observer),
        f.file,
      ).toContain('gmail.sent');
      const sentOk = f.health.some((h) => h.observer === 'gmail.sent' && h.status === 'OK');
      expect(sentOk, f.file).toBe(f.page.view === 'gmail.list.sent' && f.coverage.length > 0);
      if (f.page.view === 'gmail.message')
        expect(
          f.health.map((h) => h.observer),
          f.file,
        ).toContain('gmail.receipt');
    }
    for (const f of fixtures.filter((x) => x.vendor === 'gcal')) {
      expect(
        f.health.map((h) => h.observer),
        f.file,
      ).toEqual(['gcal.event']);
    }
  });

  it('coverage follows only an OK pass, and a DEGRADED pass writes none', () => {
    for (const f of fixtures) {
      for (const c of f.coverage) {
        const health = f.health.find((h) => h.observer === c.source);
        expect(health?.status, `${f.file}: ${c.source}`).toBe('OK');
        expect(c.account, f.file).toBe(f.page.account);
      }
    }
  });

  it('a DEGRADED observer named by health emits nothing for a page it refused (health-level reasons)', () => {
    const refusals = new Set(['not_sent_folder', 'not_sent_list']);
    for (const f of fixtures) {
      for (const h of f.health.filter((x) => x.reasons.some((r) => refusals.has(r)))) {
        expect(
          f.observations.filter((o) => o.source === h.observer),
          f.file,
        ).toEqual([]);
      }
    }
  });
});

describe('coverage windows (Hard Rule 5)', () => {
  it('a Gmail Sent window starts at its oldest row and ends at its newest row or, at the head, lastSyncAt', () => {
    for (const f of fixtures.filter((x) => x.coverage.some((c) => c.source === 'gmail.sent'))) {
      const times = f.observations.map((o) => Date.parse(o.occurredAt));
      const [c] = f.coverage;
      expect(Date.parse(c?.windowStart ?? ''), f.file).toBe(Math.min(...times));
      if (c?.windowEnd !== 'lastSyncAt')
        expect(Date.parse(c?.windowEnd ?? ''), f.file).toBe(Math.max(...times));
    }
  });

  it('every Calendar event lies inside the visible range the coverage facts span', () => {
    for (const f of fixtures.filter((x) => x.vendor === 'gcal')) {
      const starts = f.coverage.map((c) => Date.parse(c.windowStart));
      const ends = f.coverage.map((c) => (c.windowEnd === 'lastSyncAt' ? NaN : Date.parse(c.windowEnd)));
      for (const e of f.events) {
        expect(Date.parse(e.occurredAt), `${f.file}: ${e.subjectHint}`).toBeGreaterThanOrEqual(
          Math.min(...starts),
        );
        expect(Date.parse(e.occurredAt), `${f.file}: ${e.subjectHint}`).toBeLessThan(Math.max(...ends));
      }
    }
  });
});

function attributeIs(scope: Element, name: string, value: string): boolean {
  return [scope, ...Array.from(scope.querySelectorAll('*'))].some((el) => el.getAttribute(name) === value);
}

function withAttribute(doc: Document, name: string, value: string): Element[] {
  return Array.from(doc.querySelectorAll(`[${name}]`)).filter((el) => el.getAttribute(name) === value);
}

describe('facts bind to the page', () => {
  it('a gmail.sent fact names a list row holding its row id, recipient address and subject', () => {
    for (const f of fixtures) {
      for (const o of f.observations.filter((x) => x.source === 'gmail.sent')) {
        const span = withAttribute(docOf(f), 'data-legacy-last-message-id', o.rowKey ?? '')[0];
        const row = span?.closest('[role="row"]');
        expect(row, `${f.file}: ${o.rowKey ?? ''}`).toBeTruthy();
        if (!row || !span) continue;
        const address =
          attributeIs(row, 'email', o.counterparty ?? '') || attributeIs(row, 'title', o.counterparty ?? '');
        expect(address, `${f.file}: ${o.counterparty ?? ''}`).toBe(true);
        const subject = collapse(span.textContent);
        expect(subject.startsWith(o.subjectHint ?? '(no subject)'), `${f.file}: ${subject}`).toBe(true);
      }
    }
  });

  it('a gmail.receipt fact names an opened message by its id and its subject heading', () => {
    for (const f of fixtures) {
      for (const o of f.observations.filter((x) => x.source === 'gmail.receipt')) {
        expect(withAttribute(docOf(f), 'data-legacy-message-id', o.rowKey ?? ''), f.file).toHaveLength(1);
        const heading = collapse(docOf(f).querySelector('h2[data-legacy-thread-id]')?.textContent);
        expect(heading.startsWith(o.subjectHint ?? ''), `${f.file}: ${heading}`).toBe(true);
      }
    }
  });

  it('a Calendar event fact names a chip in the main grid with its id and visible title', () => {
    for (const f of fixtures.filter((x) => x.vendor === 'gcal')) {
      const main = docOf(f).querySelector('[role="main"]');
      const chips = Array.from(main?.querySelectorAll('[role="button"][data-eventid]') ?? []);
      expect(new Set(chips.map((c) => c.getAttribute('data-eventid'))).size, f.file).toBe(f.events.length);
      for (const e of f.events) {
        const chip = chips.find((c) => c.getAttribute('data-eventid') === e.rowKey);
        const visible = collapse(chip?.querySelector('[aria-hidden="true"]')?.textContent);
        expect(visible, `${f.file}: ${e.rowKey}`).toContain(e.subjectHint);
      }
    }
  });
});

describe('dedup and diff facts', () => {
  it('a dedup fact counts the observations two fixtures share by contentHash', () => {
    for (const f of fixtures) {
      for (const d of f.dedups) {
        const other = byName(f, d.with);
        expect(other, `${f.file} → ${d.with}`).toBeDefined();
        const mine = new Set(f.observations.map((o) => projected(o, f.page.readAt).contentHash));
        const theirs = (other?.observations ?? []).map(
          (o) => projected(o, other?.page.readAt ?? '').contentHash,
        );
        expect(theirs.filter((h) => mine.has(h)).length, f.file).toBe(d.shared);
      }
    }
  });

  it('fixtures are independent: two fixtures share a contentHash only when a dedup fact joins them', () => {
    const owners = new Map<string, Set<string>>();
    for (const f of fixtures)
      for (const o of f.observations) {
        const hash = projected(o, f.page.readAt).contentHash;
        owners.set(hash, (owners.get(hash) ?? new Set()).add(`${f.dir}/${f.file}`));
      }
    const joined = (a: string, b: string) =>
      fixtures.some((f) => `${f.dir}/${f.file}` === a && f.dedups.some((d) => `${f.dir}/${d.with}` === b));
    for (const files of owners.values()) {
      const [first = '', ...rest] = [...files];
      for (const other of rest) expect(joined(first, other) || joined(other, first), other).toBe(true);
    }
  });

  it('a diff compares with an earlier fixture of the folder and agrees with both event lists', () => {
    for (const f of fixtures) {
      for (const d of f.diffs) {
        const from = byName(f, d.from);
        expect(from, `${f.file} ← ${d.from}`).toBeDefined();
        if (!from) continue;
        expect(Date.parse(from.page.readAt), f.file).toBeLessThan(Date.parse(f.page.readAt));
        for (const o of d.observations)
          expect(diffAgrees(o, from.events, f.events), `${f.file}: ${o.type}`).toBe(true);
      }
    }
  });

  it('the Calendar diffs cover created, updated, deleted and unchanged', () => {
    const types = fixtures.flatMap((f) => f.diffs.flatMap((d) => d.observations.map((o) => o.type)));
    expect(new Set(types)).toEqual(new Set(['calendar.created', 'calendar.updated', 'calendar.deleted']));
    expect(fixtures.some((f) => f.diffs.some((d) => d.observations.length === 0))).toBe(true);
  });
});

function diffAgrees(o: ObservationFact, before: readonly Fact[], after: readonly Fact[]): boolean {
  const find = (events: readonly Fact[]) =>
    events.find((e): e is Extract<Fact, { kind: 'event' }> => e.kind === 'event' && e.rowKey === o.rowKey);
  const was = find(before);
  const now = find(after);
  const matches = (e: Extract<Fact, { kind: 'event' }> | undefined): boolean =>
    e?.occurredAt === o.occurredAt &&
    e.subjectHint === o.subjectHint &&
    (o.counterparty === undefined ? e.attendees.length === 0 : e.attendees.includes(o.counterparty));
  if (o.type === 'calendar.created') return was === undefined && matches(now);
  if (o.type === 'calendar.updated')
    return was !== undefined && matches(now) && was.occurredAt !== now?.occurredAt;
  if (o.type === 'calendar.deleted') return now === undefined && matches(was);
  return false;
}

describe('receipt corpus (2.3 Done-when)', () => {
  const gmail = fixtures.filter((f) => f.vendor === 'gmail');
  const receipts = gmail.flatMap((f) => f.observations.filter((o) => o.source === 'gmail.receipt'));

  it('names every parser the sprint lists, each with a labelled positive', () => {
    const parsers = new Set(receipts.map((o) => o.parser));
    for (const parser of [
      'stripe',
      'amazon',
      'marketplace',
      'opentable',
      'instacart',
      'uber',
      'shopify',
      'generic',
    ]) {
      expect(parsers, parser).toContain(parser);
    }
    for (const o of receipts)
      expect(o.merchant && o.amountCents !== undefined && o.currency, o.subjectHint).toBeTruthy();
  });

  it('has at least 3 generic positives and 3 opened-inbox negatives with no receipt', () => {
    expect(receipts.filter((o) => o.parser === 'generic').length).toBeGreaterThanOrEqual(3);
    const negatives = gmail.filter(
      (f) => f.page.view === 'gmail.message' && f.page.folder === 'inbox' && f.observations.length === 0,
    );
    expect(negatives.length).toBeGreaterThanOrEqual(3);
  });
});
