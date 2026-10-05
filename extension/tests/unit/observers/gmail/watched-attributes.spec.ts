/**
 * The attributes the Gmail observers' reads depend on (Sprint 2 close, TECH-2). The Gmail content script's one
 * watcher starts a pass only on a change to the tree, the text, `class`, `hidden`, `style` or an attribute one of
 * its observers names (src/observers/batch.ts `watchedInit`). So an attribute an observer reads but does not name
 * would leave a pass stale until something else changed. On every labelled Gmail page, each attribute the page holds
 * that an observer does not name is removed, then set to "true", then to "false", on every element: what that
 * observer's pass reads (its plan and its account) must not change. Changing a named one must change it on some page,
 * so the check can fail.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { VIEW_ATTRIBUTES, watchedInit } from '../../../../src/observers/batch';
import { RECEIPT_ATTRIBUTES, receiptObserver } from '../../../../src/observers/gmail/receipts/index';
import { gmailSentObserver, SENT_ATTRIBUTES } from '../../../../src/observers/gmail/sent-observer';
import { planPass } from '../../../../src/observers/plan';
import type { Observer } from '../../../../src/observers/types';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { fixtureCtx, gmailFixtures, openFixture } from './sent-fixtures';

type Mutation = 'removed' | 'true' | 'false';

/** Everything one pass of `observer` reads from `doc`: its plan and its account. */
function readOf(observer: Observer, doc: Document, fixture: LabelledFixture): string {
  const plan = planPass({ observer, doc, ctx: fixtureCtx(fixture), policy: DEFAULT_POLICY });
  return JSON.stringify([plan, observer.account(doc)]);
}

/** Lets the per-pass memo (src/observers/pass-memo.ts) drop the last read, so the next pass reads the page again. */
const nextPass = (): Promise<void> => Promise.resolve();

/** Applies `mutation` to `name` on every element that has it, and returns the undo. */
function mutate(doc: Document, name: string, mutation: Mutation): () => void {
  const held = Array.from(doc.querySelectorAll('*')).flatMap((el) => {
    const value = el.getAttribute(name);
    return value === null ? [] : [{ el, value }];
  });
  for (const { el } of held) {
    if (mutation === 'removed') el.removeAttribute(name);
    else el.setAttribute(name, mutation);
  }
  return () => {
    for (const { el, value } of held) el.setAttribute(name, value);
  };
}

function attributeNames(doc: Document): string[] {
  const names = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll('*')))
    for (const name of el.getAttributeNames()) names.add(name);
  return [...names].sort();
}

/** The [file, attribute, mutation] triples whose change alters what `observer` reads, over `names` of each page. */
async function readersOf(
  observer: Observer,
  names: (doc: Document) => readonly string[],
): Promise<(readonly [string, string, Mutation])[]> {
  const changed: (readonly [string, string, Mutation])[] = [];
  for (const fixture of gmailFixtures()) {
    const page = openFixture(fixture);
    try {
      const before = readOf(observer, page.doc, fixture);
      for (const name of names(page.doc)) {
        for (const mutation of ['removed', 'true', 'false'] as const) {
          await nextPass();
          const undo = mutate(page.doc, name, mutation);
          if (readOf(observer, page.doc, fixture) !== before) changed.push([fixture.file, name, mutation]);
          undo();
        }
      }
    } finally {
      await page.close();
    }
  }
  return changed;
}

/** The attributes of a page that `observer` does not name (each list must hold on its own, not only together). */
const unnamedBy =
  (observer: Observer) =>
  (doc: Document): string[] =>
    attributeNames(doc).filter(
      (name) => ![...VIEW_ATTRIBUTES, ...(observer.attributes ?? [])].includes(name),
    );

describe('the attributes the Gmail observers name (TECH-2)', () => {
  it('are the ones their selectors match on and their readers read', () => {
    expect(SENT_ATTRIBUTES).toEqual([
      'aria-disabled',
      'aria-label',
      'data-hovercard-id',
      'data-legacy-last-message-id',
      'data-legacy-last-non-draft-message-id',
      'data-legacy-thread-id',
      'email',
      'href',
      'role',
      'tabindex',
      'title',
    ]);
    expect(RECEIPT_ATTRIBUTES).toEqual([
      'alt',
      'aria-expanded',
      'aria-label',
      'data-legacy-message-id',
      'data-legacy-thread-id',
      'email',
      'name',
      'role',
      'title',
    ]);
    expect(gmailSentObserver.attributes).toBe(SENT_ATTRIBUTES);
    expect(receiptObserver.attributes).toBe(RECEIPT_ATTRIBUTES);
  });

  it("the Gmail tab's watcher observes exactly those and the shown-view attributes", () => {
    const init = watchedInit([gmailSentObserver.attributes, receiptObserver.attributes]);
    expect(init.attributeFilter).toEqual(
      [...new Set([...VIEW_ATTRIBUTES, ...SENT_ATTRIBUTES, ...RECEIPT_ATTRIBUTES])].sort(),
    );
  });

  it('no attribute they do not name changes what a pass reads, on any Gmail page', async () => {
    expect(await readersOf(gmailSentObserver, unnamedBy(gmailSentObserver))).toEqual([]);
    expect(await readersOf(receiptObserver, unnamedBy(receiptObserver))).toEqual([]);
  }, 120_000);

  it('a named attribute does change what a pass reads (the check can fail)', async () => {
    const named = (list: readonly string[]) => (doc: Document) =>
      attributeNames(doc).filter((name) => list.includes(name));
    const sent = await readersOf(gmailSentObserver, named(SENT_ATTRIBUTES));
    const receipts = await readersOf(receiptObserver, named(RECEIPT_ATTRIBUTES));
    expect(sent.map(([, name]) => name)).toEqual(
      expect.arrayContaining(['email', 'data-legacy-last-message-id']),
    );
    expect(receipts.map(([, name]) => name)).toEqual(
      expect.arrayContaining(['email', 'data-legacy-message-id', 'title']),
    );
  }, 120_000);
});
