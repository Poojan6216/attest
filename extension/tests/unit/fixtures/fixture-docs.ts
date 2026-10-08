/**
 * The parsed pages a fixture spec reads, at most a few at a time (tech review TECH-L1). A happy-dom window keeps every
 * document parsed in it alive until it is closed, and the real captures are up to about 1 MB each: one window for a
 * whole spec held every page at once (1.9 GB of a 2 GB worker). Here each page is parsed in a window of its own, the
 * last `keep` pages are kept (a spec reads a page several times in a row, and a diff reads two in turn), and the page
 * read longest ago is closed when another is needed. A spec closes the rest after its last test (`closeAll`).
 */
import { readFileSync } from 'node:fs';

import type { Document } from 'happy-dom';

import { closeWindow, createInertWindow } from '../../tools/capture-dom';
import type { LabelledFixture } from './fixture-labels';

type InertWindow = ReturnType<typeof createInertWindow>;

export interface FixtureDocs {
  /** The fixture's page, parsed once while it is among the last `keep` pages read. */
  readonly docOf: (fixture: LabelledFixture) => Document;
  /** Closes every page still kept. */
  readonly closeAll: () => void;
}

export function fixtureDocs(keep = 2): FixtureDocs {
  const open = new Map<string, { window: InertWindow; doc: Document }>();
  const docOf = (fixture: LabelledFixture): Document => {
    const kept = open.get(fixture.htmlPath);
    if (kept !== undefined) {
      // Read again: it becomes the page read last.
      open.delete(fixture.htmlPath);
      open.set(fixture.htmlPath, kept);
      return kept.doc;
    }
    while (open.size >= keep) {
      const [oldest] = open;
      if (oldest === undefined) break;
      open.delete(oldest[0]);
      closeWindow(oldest[1].window);
    }
    const window = createInertWindow();
    const doc = new window.DOMParser().parseFromString(readFileSync(fixture.htmlPath, 'utf8'), 'text/html');
    open.set(fixture.htmlPath, { window, doc });
    return doc;
  };
  const closeAll = (): void => {
    for (const { window } of open.values()) closeWindow(window);
    open.clear();
  };
  return { docOf, closeAll };
}

/**
 * Runs `check` on each item in turn, then lets the timers run once: happy-dom finishes closing a window on a timer, so
 * a test that reads page after page in one synchronous loop would hold every page until it ends.
 */
export async function eachPage<T>(items: readonly T[], check: (item: T) => void): Promise<void> {
  for (const item of items) {
    check(item);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
