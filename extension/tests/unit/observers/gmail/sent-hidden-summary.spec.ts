/**
 * Gmail's hidden screen-reader summary, found on the first real Sent capture (2026-10-06): every row repeats its
 * recipients and its subject anchor (with the `data-legacy-*` ids) in a `display: none` element inside the recipients
 * cell. Only what the row shows is read, so the summary neither makes the subject ambiguous nor adds a recipient
 * (Hard Rule 5: the same row, read the same way, with or without it).
 */
import { describe, expect, it } from 'vitest';

import { all, planVariant } from './variants';

/** Gives every Sent row Gmail's hidden summary: copies of its first recipient and its subject anchor, not shown. */
function addHiddenSummaries(doc: Document, recipient?: (copy: Element) => void): void {
  for (const row of all(doc, '[role="main"] [role="grid"] [role="row"]')) {
    const anchor = row.querySelector('[data-legacy-last-message-id]');
    const first = row.querySelector('[email]');
    const cell = first?.closest('[role="gridcell"]') ?? null;
    if (anchor === null || first === null || cell === null) continue;
    const summary = doc.createElement('div');
    summary.setAttribute('style', 'display: none');
    summary.append(first.cloneNode(true), anchor.cloneNode(true));
    const copy = summary.querySelector('[email]');
    if (copy !== null) recipient?.(copy);
    cell.prepend(summary);
  }
}

describe('Gmail’s hidden row summary is not read (real capture, 2026-10-06)', () => {
  it('a row with the summary reads exactly as without it: one subject, the same recipients', async () => {
    const clean = await planVariant();
    expect(clean.status).toBe('OK');
    expect(
      await planVariant({
        mutate: (doc) => {
          addHiddenSummaries(doc);
        },
      }),
    ).toEqual(clean);
  });

  it('a recipient only the hidden summary holds is not a recipient of the row', async () => {
    const clean = await planVariant();
    const hiddenOnly = await planVariant({
      mutate: (doc) => {
        addHiddenSummaries(doc, (copy) => {
          copy.setAttribute('email', 'not.shown@example.com');
        });
      },
    });
    expect(hiddenOnly).toEqual(clean);
  });
});
