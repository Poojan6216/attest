/**
 * The build_spec §2 demo's pages for the end-to-end test (sprint_3 3.16): the Gmail Sent head the person opens on
 * Friday 9 October, holding the demo's sends of Tuesday 6 October, and the log they paste from Muse's activity view.
 * Every name and address is the demo's own, invented (reserved `.example` domains).
 *
 * The Sent page is tests/fixtures/pages/gmail/2026-10-03/synthetic-sent-page-1.html, the synthetic head of the Sent
 * list (Newer off, Older on), with its rows replaced: the observer reads the same structure, and the rows are the
 * demo's. An earlier send at 09:00 starts the head's window before the demo's minute (the list may go on, so the window
 * starts a minute after its oldest row, docs/grading.md §3).
 */
export interface SentRow {
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly snippet: string;
  /** As Gmail's title writes it: "Tue, Oct 6, 2026, 2:03 PM". */
  readonly title: string;
  /** Gmail's own message id, one per row (the row holds one message). */
  readonly messageId: string;
}

export const DEMO_SENT: readonly SentRow[] = [
  {
    name: 'Vendor Billing',
    email: 'vendor@supplier.example',
    subject: 'Re: invoice',
    snippet: 'Approved, please proceed.',
    title: 'Tue, Oct 6, 2026, 2:03 PM',
    messageId: '1a1020a0b0c0d003',
  },
  {
    name: 'Priya',
    email: 'priya@company.example',
    subject: 'Q3 deck - final',
    snippet: 'Here is the final Q3 deck.',
    title: 'Tue, Oct 6, 2026, 2:02 PM',
    messageId: '1a1020a0b0c0d002',
  },
  {
    name: 'Sam Chen',
    email: 'sam.chen@example.com',
    subject: 'Agenda',
    snippet: 'Agenda for this week attached.',
    title: 'Tue, Oct 6, 2026, 9:00 AM',
    messageId: '1a1020a0b0c0d001',
  },
];

/** One Sent row as Gmail draws it; `index` keeps its element ids apart from every other row's on the page. */
export function sentRowHtml(row: SentRow, index: number): string {
  const id = (part: number) => `:d${String(index)}${String(part)}`;
  const recipient = `<span class="sPwCL p6yzXV dIC"><span translate="no" class="l2cAGn" email="${row.email}" name="${row.name}" data-hovercard-id="${row.email}" data-hovercard-owner-id="0">${row.name}</span></span>`;
  const ids = `data-thread-id="#thread-f:18780361693596${String(index)}0000" data-legacy-thread-id="${row.messageId}" data-legacy-last-message-id="${row.messageId}" data-legacy-last-non-draft-message-id="${row.messageId}"`;
  return [
    `<tr class="CW6Xo mXV Jk" id="${id(0)}" role="row" tabindex="-1" draggable="false" aria-labelledby="${id(1)}">`,
    '<td class="jAy9 TIn"></td>',
    `<td id="${id(2)}" class="zmHM" role="gridcell"><div id="${id(3)}" class="x0W EyM" role="checkbox" aria-checked="false" tabindex="-1" aria-label="Select"></div></td>`,
    `<td class="qm96Qc bISe"><span id="${id(4)}" class="Whntr R1" role="button" aria-label="Not starred" title="Not starred" tabindex="-1"></span></td>`,
    `<td id="${id(5)}" class="tqsHsv OiBqcs sx" role="gridcell" tabindex="-1"><div class="pfh Z3hp" id="${id(1)}">To: ${row.name}, ${row.subject}, Oct 6, ${row.snippet}</div><div class="YG">To: ${recipient}</div></td>`,
    `<td id="${id(6)}" class="Z1bxlq ofD" role="gridcell" tabindex="-1"><div class="NC" role="link"><div class="f0Hw"><div class="D0NM haRMqG pkKm"></div><div class="jlzp6 jJN"><span class="U4LgM8 JKSc"><span ${ids}>${row.subject}</span></span></div><span class="ZoNJAP"><span class="viFIc C8">&nbsp;-&nbsp;</span>${row.snippet}</span></div></div></td>`,
    `<td class="Bh enK" role="gridcell" tabindex="-1"><span title="${row.title}" aria-label="Oct 6"><span>Oct 6</span></span></td>`,
    '</tr>',
  ].join('\n');
}

/** The synthetic Sent head with its rows replaced by `rows`. */
export function demoSentPage(head: string, rows: readonly SentRow[] = DEMO_SENT): string {
  const start = head.indexOf('<tbody>');
  const end = head.indexOf('</tbody>');
  if (start < 0 || end < start) throw new Error('the Sent fixture has no table body');
  return `${head.slice(0, start + '<tbody>'.length)}\n${rows.map(sentRowHtml).join('\n')}\n${head.slice(end)}`;
}

/**
 * The Calendar week the person opens: tests/fixtures/pages/gcal/2026-10-03/synthetic-gcal-week-two-calendars.html
 * (Sunday 4 to Saturday 10 October, every calendar shown) with every event chip removed. Its "Design review with
 * Priya" (Thursday 3 pm) shares a title word with the "Q3 review" Muse said it created on Wednesday at 2 pm, and that
 * word with a start 25 hours away rightly makes the claim PARTIAL (subject overlap 0.25, time 0.65, score 0.50 with
 * the shipped policy, docs/grading.md §5); an event near it in time alone would not (v1.11: no evidence on time
 * alone). The demo's Calendar holds neither. Each chip is cut whole by counting its divs, and the week must be left
 * with no event id, so a markup change fails here, loudly.
 */
export function emptyWeek(week: string): string {
  let page = week;
  for (let at = page.indexOf('data-eventchip=""'); at >= 0; at = page.indexOf('data-eventchip=""')) {
    const start = page.lastIndexOf('<div', at);
    const tags = /<div\b|<\/div>/gu;
    tags.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let tag = tags.exec(page); tag !== null; tag = tags.exec(page)) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) {
        end = tags.lastIndex;
        break;
      }
    }
    if (start < 0 || end < 0) throw new Error('an event chip has no end');
    page = page.slice(0, start) + page.slice(end);
  }
  if (page.includes('data-eventid')) throw new Error('an event is left in the week');
  return page;
}

/**
 * Muse's activity view on Tuesday 6 October, as the person copies it, under its day heading. The calendar action names
 * Wednesday, not the demo's Thursday: every Calendar fixture is the Sunday-start week of 4 to 10 October, and a claim
 * is graded over ±3 days around its event, which for Thursday 14:00 reaches into Sunday 11 October, a day no fixture
 * shows (that claim would rightly be UNVERIFIABLE). Wednesday's window lies inside the week (Decisions [3.16]).
 */
export const DEMO_LOG = [
  'Oct 6',
  'Email Priya the Q3 deck',
  'Sent email to Priya with Q3 deck',
  '2:02 pm',
  'Put a review on the calendar',
  'Created calendar event "Q3 review" Wed 2pm',
  '2:02 pm',
].join('\n');

/**
 * The time away detection would have recorded on 6 October (14:00 to 14:09): the one input the test cannot make live,
 * since Chrome reports idle only as it happens. Written into the extension's own IndexedDB from its service worker, as
 * src/ledger/activity.ts stores one (id, kind, from, to, and the epoch ms it indexes).
 */
export const DEMO_AWAY = {
  id: `${'0'.repeat(63)}6`,
  kind: 'idle',
  from: '2026-10-06T14:00:00-04:00',
  to: '2026-10-06T14:09:00-04:00',
  startMs: Date.parse('2026-10-06T14:00:00-04:00'),
  endMs: Date.parse('2026-10-06T14:09:00-04:00'),
} as const;
