/**
 * One read of the page per pass (src/observers/pass-memo.ts; TECH-2). A pass asks for health, rows, windows and the
 * account in one synchronous run; each observer reads its page once in it, and afresh in the next pass. Each case
 * counts how often a pass queries the page for its main landmark.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { receiptObserver } from '../../../src/observers/gmail/receipts';
import { gmailSentObserver } from '../../../src/observers/gmail/sent-observer';
import { perPass } from '../../../src/observers/pass-memo';
import { planPass } from '../../../src/observers/plan';
import type { Observer } from '../../../src/observers/types';
import { fixtureCtx, fixtureNamed, openPage } from './gmail/sent-fixtures';

describe('perPass', () => {
  it('reads once per synchronous run and document, and again after the run yields', async () => {
    let reads = 0;
    const read = perPass((doc: Document) => {
      reads += 1;
      return { url: doc.URL };
    });
    const page = openPage('<html><body></body></html>', 'https://mail.google.com/mail/u/0/#sent');
    const other = openPage('<html><body></body></html>', 'https://mail.google.com/mail/u/0/#inbox');
    try {
      const first = read(page.doc);
      expect(read(page.doc)).toBe(first);
      expect(read(other.doc)).not.toBe(first);
      expect(reads).toBe(2);
      await Promise.resolve();
      expect(read(page.doc)).not.toBe(first);
      expect(reads).toBe(3);
    } finally {
      await page.close();
      await other.close();
    }
  });

  it('keeps nothing when the read throws', () => {
    let reads = 0;
    const read = perPass((): never => {
      reads += 1;
      throw new Error('broken page');
    });
    const page = openPage('<html><body></body></html>', 'https://mail.google.com/mail/u/0/#sent');
    expect(() => read(page.doc)).toThrow('broken page');
    expect(() => read(page.doc)).toThrow('broken page');
    expect(reads).toBe(2);
    void page.close();
  });
});

/** How often one pass of `observer` over `file` queries the page for its main landmark. */
async function mainQueries(observer: Observer, file: string): Promise<number> {
  const fixture = fixtureNamed(file);
  const page = openPage(readFileSync(fixture.htmlPath, 'utf8'), fixture.page.liveUrl);
  try {
    const doc = page.doc;
    const queries = vi.spyOn(doc, 'querySelectorAll');
    const plan = planPass({ observer, doc, ctx: fixtureCtx(fixture), policy: DEFAULT_POLICY });
    expect(plan.status, file).not.toBe('DEGRADED');
    return queries.mock.calls.filter(([selector]) => selector === '[role="main"]').length;
  } finally {
    await page.close();
  }
}

describe('a pass reads its page once (TECH-2)', () => {
  it('gmail.sent: health, the rows, the window and the account share one read of the Sent list', async () => {
    expect(await mainQueries(gmailSentObserver, 'synthetic-sent-page-1.html')).toBe(1);
  });

  it('gmail.receipt: health, the rows, the windows and the account share one read of the conversation', async () => {
    expect(await mainQueries(receiptObserver, 'synthetic-receipt-amazon.html')).toBe(1);
  });
});
