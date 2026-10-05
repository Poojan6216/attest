/**
 * The head of the Sent list asserts only what it showed (docs/grading.md §3; Hard Rule 5). Added by the Sprint 2 QA
 * review for the known limit docs/adapters.md §8.1 left "open for the sprint close" (QA-1, TECH-8).
 *
 * Gmail shows a send's time to the minute. When the list continues on another page (an enabled "Older" control), a
 * send made in the oldest row's minute, earlier than that row and so listed on the next page, would lie inside a
 * window starting at that minute although the pass never saw it: a claim about that send whose window the span
 * covers would grade NOT FOUND although the send happened. So while the list may continue (an enabled "Older", or
 * no "Older" seen at all), the window starts one minute after the oldest row's minute; the rows of that minute are
 * still posted as evidence. A page that provably ends the list (every "Older" disabled) keeps its oldest minute.
 */
import { describe, expect, it } from 'vitest';

import { instantMs } from '../../../../src/core/normalize';
import { all, newYorkCtx, one, planVariant, row, setRowTime } from './variants';

/** The oldest row on the labelled Sent page 1 (synthetic-sent-page-1.html), to the minute Gmail shows. */
const OLDEST_ROW_MINUTE = '2026-09-29T17:55:00-04:00';
const MINUTE_MS = 60_000;
const OLDER = '[role="button"][aria-label="Older"]';

const windowsOf = (plan: Awaited<ReturnType<typeof planVariant>>) =>
  plan.status === 'OK' ? plan.coverage.map((c) => [c.windowStart, c.windowEnd]) : plan.status;

describe('the head window never covers the part of its oldest minute the page may not list', () => {
  it('the labelled page 1 says "Older": the list continues, and its window starts after the oldest minute', async () => {
    const head = await planVariant();
    expect(head.status).toBe('OK');
    // The rows of that minute are still evidence.
    expect(head.observations.some((row) => row.occurredAt === OLDEST_ROW_MINUTE)).toBe(true);
    const [window] = head.status === 'OK' ? head.coverage : [];
    expect(instantMs(window?.windowStart ?? '')).toBeGreaterThanOrEqual(
      instantMs(OLDEST_ROW_MINUTE) + MINUTE_MS,
    );
  });

  it('control: the same page has an enabled "Older" control, so another page can list older sends', async () => {
    const head = await planVariant({
      mutate: (doc) => {
        const older = one(doc, OLDER);
        expect(older.getAttribute('aria-disabled')).toBeNull();
      },
    });
    expect(head.status).toBe('OK');
  });

  it('a page that ends the list (every "Older" disabled) keeps its oldest minute', async () => {
    const last = await planVariant({
      mutate: (doc) => {
        one(doc, OLDER).setAttribute('aria-disabled', 'true');
      },
    });
    expect(windowsOf(last)).toEqual([[OLDEST_ROW_MINUTE, '2026-10-03T10:15:00-04:00']]);
  });

  it.each<[string, (doc: Document) => void]>([
    [
      'no "Older" control at all',
      (doc) => {
        for (const control of all(doc, OLDER)) control.remove();
      },
    ],
    [
      'an "Older" control that is hidden',
      (doc) => {
        one(doc, OLDER).setAttribute('hidden', '');
      },
    ],
    [
      '"Older" marked aria-disabled="false"',
      (doc) => {
        one(doc, OLDER).setAttribute('aria-disabled', 'false');
      },
    ],
  ])('%s proves nothing: the list may continue, the window starts a minute later', async (_case, mutate) => {
    expect(windowsOf(await planVariant({ mutate }))).toEqual([
      ['2026-09-29T17:56:00-04:00', '2026-10-03T10:15:00-04:00'],
    ]);
  });
});

describe('two sends in one minute at the page boundary (TECH-8)', () => {
  it('two sends in one minute, the older listed on page 2: the head window does not hold the unseen one', async () => {
    const head = await planVariant();
    // Page 2 (labelled synthetic-sent-page-2.html) with its third row sent in the minute of page 1's oldest row,
    // before it: Gmail lists it on page 2, so page 1's pass never saw it.
    const second = await planVariant({
      file: 'synthetic-sent-page-2.html',
      mutate: (doc) => {
        setRowTime(row(doc, 2), { title: 'Tue, Sep 29, 2026, 5:55 PM', label: 'Sep 29' });
      },
    });
    const unseen = second.observations.find((o) => o.counterparty === 'logan.price@example.com');
    expect(unseen?.occurredAt).toBe(OLDEST_ROW_MINUTE);
    expect(head.observations.some((o) => o.counterparty === 'logan.price@example.com')).toBe(false);
    const [window] = head.status === 'OK' ? head.coverage : [];
    expect(instantMs(window?.windowStart ?? '')).toBeGreaterThan(instantMs(unseen?.occurredAt ?? ''));
  });
});

describe('the head window at the edges of the minute being read and of a DST change', () => {
  it('a head whose every row is in the minute being read asserts no window, never one that ends first', async () => {
    const plan = await planVariant({
      ctx: newYorkCtx('2026-10-03T09:41:30-04:00'),
      mutate: (doc) => {
        for (let at = 0; at < 10; at += 1) {
          setRowTime(row(doc, at), { title: 'Sat, Oct 3, 2026, 9:41 AM', label: '9:41 AM' });
        }
      },
    });
    expect(plan.status).toBe('OK_NO_COVERAGE');
    expect(plan.observations).toHaveLength(11);
  });

  it('the start a minute later is written in the offset in force then (across a DST change)', async () => {
    const plan = await planVariant({
      ctx: newYorkCtx('2026-03-08T09:00:00-04:00'),
      mutate: (doc) => {
        for (let at = 0; at < 9; at += 1) {
          setRowTime(row(doc, at), { title: 'Sun, Mar 8, 2026, 8:00 AM', label: '8:00 AM' });
        }
        setRowTime(row(doc, 9), { title: 'Sun, Mar 8, 2026, 1:59 AM', label: '1:59 AM' });
      },
    });
    expect(windowsOf(plan)).toEqual([['2026-03-08T03:00:00-04:00', '2026-03-08T09:00:00-04:00']]);
  });
});
