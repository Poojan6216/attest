/**
 * The Gmail fixtures as pages the Sent observer reads (sprint_2 2.2), shared by the unit tests in this folder and
 * by bench/observers/gmail.ts, so the accuracy the bench reports is measured exactly as the tests check it.
 *
 * Each fixture is parsed in its own inert happy-dom window opened at the fixture's `liveUrl` (README: "serve with
 * its #fragment when an observer reads location"), so `doc.URL` carries the Gmail route the observer's health
 * reads, and computed style works for the shown-region check. Scripts, file loading, navigation and fetch are off.
 * A pass runs with `observedAt` = the page fact's `readAt` and the UTC offsets of its `timeZone` (from Intl, the
 * same function the label checks use), so results do not depend on the machine's zone.
 */
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs } from '../../../../src/core/schema';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import { type PassPlan, planPass } from '../../../../src/observers/plan';
import type { ExtractContext, Observer } from '../../../../src/observers/types';
import { type LabelledFixture, loadVendor } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';

/** Every labelled Gmail fixture (all date folders). */
export const gmailFixtures = (): LabelledFixture[] => loadVendor('gmail');

/** The fixtures that show the Sent list (view `gmail.list.sent`): the ones field accuracy is measured on. */
export const sentListFixtures = (): LabelledFixture[] =>
  gmailFixtures().filter((fixture) => fixture.page.view === 'gmail.list.sent');

function isDocument(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && 'querySelectorAll' in value && 'URL' in value;
}

export interface OpenedPage {
  readonly doc: Document;
  /** Closes the page's window. */
  readonly close: () => Promise<void>;
}

/** `html` parsed in an inert window at `url`. */
export function openPage(html: string, url: string): OpenedPage {
  const window = new Window({
    url,
    settings: {
      enableJavaScriptEvaluation: false,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
        disableFallbackToSetURL: true,
      },
      fetch: {
        interceptor: {
          beforeAsyncRequest: ({ window: at }) => Promise.resolve(new at.Response(null, { status: 451 })),
        },
      },
    },
  });
  const doc: unknown = new window.DOMParser().parseFromString(html, 'text/html');
  if (!isDocument(doc)) throw new Error('happy-dom did not return a document');
  return { doc, close: () => window.happyDOM.close() };
}

/** The fixture's page, at its live URL; `html` replaces the file's markup (a variant built from it). */
export function openFixture(fixture: LabelledFixture, html?: string): OpenedPage {
  return openPage(html ?? readFileSync(fixture.htmlPath, 'utf8'), fixture.page.liveUrl);
}

/** The pass context the labels were written for: read at `readAt`, in the page's time zone. */
export function fixtureCtx(fixture: LabelledFixture): ExtractContext {
  return { observedAt: IsoTs.parse(fixture.page.readAt), offsetAt: zoneOffset(fixture.page.timeZone) };
}

/** One full pass (health → extract → project → account → window) over the fixture, as the skeleton plans it. */
export async function runSentPass(
  fixture: LabelledFixture,
  options: { readonly html?: string; readonly observer?: Observer } = {},
): Promise<PassPlan> {
  const page = openFixture(fixture, options.html);
  try {
    return planPass({
      observer: options.observer ?? gmailSentObserver,
      doc: page.doc,
      ctx: fixtureCtx(fixture),
      policy: DEFAULT_POLICY,
    });
  } finally {
    await page.close();
  }
}

/** The fixture's markup, for building variants. */
export const fixtureHtml = (fixture: LabelledFixture): string => readFileSync(fixture.htmlPath, 'utf8');

/** The fixture named `file` (throws when there is none, so a renamed fixture fails loud). */
export function fixtureNamed(file: string): LabelledFixture {
  const found = gmailFixtures().find((fixture) => fixture.file === file);
  if (found === undefined) throw new Error(`no labelled Gmail fixture ${file}`);
  return found;
}
