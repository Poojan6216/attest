/**
 * The pages a red-team case serves (sprint_6 6.1, 6.2; agents/red_team.md), as Attest's readers see them at their
 * Gmail or Calendar addresses: Gmail's Sent list built from rows (the synthetic Sent head, ./demo.ts), with any rows a
 * spoofing page plants beside it; a labelled fixture with its forged text replaced; or a page of the strategy's own.
 * Every `{{gmailTime:N}}` in a page becomes the instant N minutes before the run, as Gmail writes it in a title.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type AttackPage, GMAIL_TIME, type SPOOF_PLACES, type Strategy } from '../../redteam/attack-schema';
import { demoSentPage, type SentRow, sentRowHtml } from './demo';
import { gmailTitle, MINUTE_MS } from './priya';
import { fixtureUrl, vendorFixture } from './vendor-pages';

const SENT_HEAD = vendorFixture('gmail', 'synthetic-sent-page-1.html');
/** The first element index of planted rows, apart from the list's own rows' (./demo.ts `sentRowHtml`). */
const PLANTED_INDEX = 900;

type CaseRow = Extract<AttackPage, { kind: 'gmail.sent' }>['rows'][number];
type SpoofPlace = (typeof SPOOF_PLACES)[number];

/** `rows` as the Sent list draws them: Gmail's title time, and a message id of each row's own from `first` on. */
function sentRows(rows: readonly CaseRow[], nowMs: number, first: number): SentRow[] {
  return rows.map(({ minutesAgo, ...row }, index) => ({
    ...row,
    title: gmailTitle(nowMs - minutesAgo * MINUTE_MS),
    messageId: `1a1020a0b0c0f${String(first + index).padStart(3, '0')}`,
  }));
}

/** `rows` in Gmail's row markup and a grid of their own, inside a main landmark when `main`. */
function plantedGrid(rows: readonly SentRow[], main: boolean): string {
  const body = rows.map((row, index) => sentRowHtml(row, PLANTED_INDEX + index)).join('\n');
  const grid = `<table role="grid"><tbody>${body}</tbody></table>`;
  return main ? `<div role="main">${grid}</div>` : grid;
}

/**
 * `html` with `planted` rows where `at` says: after the page's main landmark, in a second main landmark of their own,
 * in a main landmark inside a `data:` iframe (another origin), or inside Gmail's own list but hidden.
 */
export function withSpoof(html: string, at: SpoofPlace, planted: readonly SentRow[]): string {
  const bodyEnd = html.lastIndexOf('</body>');
  const listEnd = html.indexOf('</tbody>');
  if (bodyEnd < 0 || listEnd < 0) throw new Error('red team: the Sent page has no body or list end');
  const before = (end: number, text: string) => `${html.slice(0, end)}${text}\n${html.slice(end)}`;
  switch (at) {
    case 'outside-main':
      return before(bodyEnd, plantedGrid(planted, false));
    case 'second-main':
      return before(bodyEnd, plantedGrid(planted, true));
    case 'iframe': {
      const frame = Buffer.from(`<!doctype html><html><body>${plantedGrid(planted, true)}</body></html>`);
      return before(
        bodyEnd,
        `<iframe title="planted" src="data:text/html;base64,${frame.toString('base64')}"></iframe>`,
      );
    }
    case 'hidden-row': {
      const rows = planted.map((row, index) =>
        sentRowHtml(row, PLANTED_INDEX + index).replace('<tr ', '<tr style="display: none" '),
      );
      return before(listEnd, rows.join('\n'));
    }
  }
}

/** `html` with each `from` replaced by its `to`; a `from` the page does not hold fails, so a forged page stays forged. */
function replaced(html: string, replace: readonly { from: string; to: string }[], file: string): string {
  return replace.reduce((page, { from, to }) => {
    if (!page.includes(from)) throw new Error(`red team: ${file} holds no "${from}" to replace`);
    return page.split(from).join(to);
  }, html);
}

/** Every `{{gmailTime:N}}` in `html` as the instant N minutes before `nowMs`, in Gmail's title format. */
function withTimes(html: string, nowMs: number): string {
  return html.replace(GMAIL_TIME, (_, minutes: string) => gmailTitle(nowMs - Number(minutes) * MINUTE_MS));
}

/** The address `page` is served at, and its HTML, `nowMs` being the run's minute. */
export function served(strategy: Strategy, page: AttackPage, nowMs: number): { url: string; html: string } {
  switch (page.kind) {
    case 'file':
      return {
        url: page.url,
        html: withTimes(readFileSync(path.join(strategy.dir, page.file), 'utf8'), nowMs),
      };
    case 'fixture': {
      const fixture = vendorFixture(page.vendor, page.file);
      const html = replaced(readFileSync(fixture.htmlPath, 'utf8'), page.replace ?? [], page.file);
      return { url: fixtureUrl(fixture), html: withTimes(html, nowMs) };
    }
    case 'gmail.sent': {
      const list = demoSentPage(readFileSync(SENT_HEAD.htmlPath, 'utf8'), sentRows(page.rows, nowMs, 100));
      const html =
        page.spoof === undefined
          ? list
          : withSpoof(list, page.spoof.at, sentRows(page.spoof.rows, nowMs, 500));
      return { url: fixtureUrl(SENT_HEAD), html };
    }
  }
}
