/**
 * One read of a Google Calendar page per pass (sprint_2 TECH-2). A pass (src/observers/plan.ts) asks the observer
 * for its health, its rows, its windows, whether every calendar is shown, its snapshot and its account, one after
 * another in one synchronous run; each used to read the page again (four full reads per pass). Now each asks
 * `passReads(offsetAt)(doc)`, which reads the page once per run (../pass-memo.ts `perPass`) and hands every member
 * the same facts, so the health, the rows, the windows, the snapshot and the account always describe one page.
 *
 * A read is keyed by the offset function it reads times with: a pass whose `ctx.offsetAt` is the observer's own (the
 * browser's, in production) reads once; a caller that passes another one gets a read of its own, so `extract()`
 * still fails loud on a page `health()` read differently (./observer.ts). Pure over the DOM (Hard Rule 3): it reads,
 * keeps the result for the run, and writes nothing.
 */
import type { OffsetAt } from '../../core/normalize';
import { perPass } from '../pass-memo';
import { accountOf, moreOutsideDays, pageBusy } from './page';
import { type PageRead, readCalendar } from './read';

/**
 * What one pass read of the page. `account` is the account as ./page.ts `accountOf` reads it: null when the page names
 * none, '' when it cannot tell which. A busy page (./page.ts `pageBusy`: still drawing its range) is read no further.
 * Otherwise `page` holds its facts or why they cannot be read, and `strayMore` says a "more" control sits in no day
 * (./page.ts `moreOutsideDays`), so no window can be told.
 */
export type PassRead =
  | { readonly busy: true; readonly account: string | null }
  | {
      readonly busy: false;
      readonly account: string | null;
      readonly page: PageRead;
      readonly strayMore: boolean;
    };

/** Reads `doc` once, with times read through `offsetAt`. */
export function readPass(doc: Document, offsetAt: OffsetAt): PassRead {
  const account = accountOf(doc);
  if (pageBusy(doc)) return { busy: true, account };
  return {
    busy: false,
    account,
    page: readCalendar(doc, offsetAt, account),
    strayMore: moreOutsideDays(doc),
  };
}

/** The pass reads of one observer: one memo per offset function, each kept for one synchronous run per document. */
export function passReads(): (offsetAt: OffsetAt) => (doc: Document) => PassRead {
  const memos = new WeakMap<OffsetAt, (doc: Document) => PassRead>();
  return (offsetAt) => {
    const known = memos.get(offsetAt);
    if (known !== undefined) return known;
    const memo = perPass((doc: Document) => readPass(doc, offsetAt));
    memos.set(offsetAt, memo);
    return memo;
  };
}
