/**
 * Gmail Sent health: the Sent list is read only when it is the view Gmail shows, and every landmark the extractor
 * needs is there (sprint_2 2.2; agents/adapter_engineer.md rule 2; Hard Rules 5, 6). Each case changes a copy of a
 * fixture the way Gmail (an earlier view kept hidden, a compose window, a preview pane) or a selector break would.
 */
import { describe, expect, it } from 'vitest';

import { SENT_HEALTH_REASONS, sentHealth } from '../../../../src/observers/gmail/health';
import { fixtureHtml, fixtureNamed, openPage } from './sent-fixtures';
import { addHiddenView, all, one, PAGE_1, planVariant, row } from './variants';

const SENT = 'https://mail.google.com/mail/u/0/#sent';
const degraded = (reason: string) => ({ status: 'DEGRADED', reasons: [reason], observations: [] });

describe('the route and the nav decide which folder is active', () => {
  it('Sent markup at a Drafts, Inbox, label or search address is not_sent_folder, nothing extracted', async () => {
    for (const hash of ['#drafts', '#inbox', '#label/Receipts', '#search/in%3Asent', '']) {
      const url = `https://mail.google.com/mail/u/0/${hash}`;
      expect(await planVariant({ url }), hash).toEqual(degraded('not_sent_folder'));
    }
  });

  it('a Sent conversation (or the preview pane) is not_sent_list; a compose window changes nothing', async () => {
    expect(await planVariant({ url: `${SENT}/FMfcgzQXJWDsKmvBcfJbxFgx` })).toEqual(degraded('not_sent_list'));
    expect(await planVariant({ url: `${SENT}/p2/FMfcgzQXJWDsKmvBcfJbxFgx` })).toEqual(
      degraded('not_sent_list'),
    );
    expect(await planVariant({ url: `${SENT}?compose=new` })).toEqual(await planVariant());
  });

  it('a page that is not Gmail is refused', async () => {
    expect(await planVariant({ url: 'https://example.com/mail/u/0/#sent' })).toEqual(
      degraded('location.not_gmail'),
    );
  });

  it('the nav selecting another folder is not_sent_folder; a nav that selects none does not block', async () => {
    const select = (folder: string) => (doc: Document) => {
      for (const link of all(doc, '[role="navigation"] a[href*="#"]')) {
        link.setAttribute('tabindex', link.getAttribute('href')?.endsWith(`#${folder}`) ? '0' : '-1');
      }
    };
    expect(await planVariant({ mutate: select('inbox') })).toEqual(degraded('not_sent_folder'));
    expect((await planVariant({ mutate: select('nothing') })).status).toBe('OK');
  });
});

describe('only the region Gmail shows is read', () => {
  it('an earlier view kept in the DOM, hidden, is never read (display, hidden, a stylesheet rule)', async () => {
    const clean = await planVariant();
    const hiders: ((el: Element) => void)[] = [
      (el) => {
        el.setAttribute('style', 'display: none');
      },
      (el) => {
        el.setAttribute('hidden', '');
      },
      (el) => {
        el.setAttribute('class', 'zz9-hidden-view');
      },
    ];
    for (const hide of hiders) {
      const plan = await planVariant({
        mutate: (doc) => {
          one(doc, 'style').append(doc.createTextNode('.zz9-hidden-view { display: none; }'));
          addHiddenView(doc, hide);
        },
      });
      expect(plan).toEqual(clean);
    }
  });

  it('two shown lists, or two main regions, are ambiguous', async () => {
    const twoGrids = await planVariant({
      mutate: (doc) => {
        addHiddenView(doc, () => undefined);
      },
    });
    expect(twoGrids).toEqual(degraded('selector.ambiguous.grid'));
    const main = await planVariant({
      mutate: (doc) => {
        const extra = doc.createElement('div');
        extra.setAttribute('role', 'main');
        doc.body.append(extra);
      },
    });
    expect(main).toEqual(degraded('selector.ambiguous.main'));
  });
});

describe('the head of the list (docs/grading.md §3; sprint_2 2.7: only the head asserts coverage)', () => {
  it('#sent with Newer off is the head: its window ends at lastSyncAt', async () => {
    const head = await planVariant();
    expect(head.status === 'OK' && head.coverage.map((c) => c.windowEnd)).toEqual([
      '2026-10-03T10:15:00-04:00',
    ]);
  });

  it.each<[string, Parameters<typeof planVariant>[0]]>([
    ['#sent/p2', { url: `${SENT}/p2` }],
    [
      'an enabled Newer',
      {
        mutate: (doc) => {
          one(doc, '[aria-label="Newer"]').removeAttribute('aria-disabled');
        },
      },
    ],
  ])(
    '%s is not the head: the same rows, health OK, no coverage (by design, never DEGRADED)',
    async (_, variant) => {
      const head = await planVariant();
      expect(await planVariant(variant)).toEqual({
        status: 'OK_NO_COVERAGE',
        observations: head.observations,
      });
    },
  );
});

const LANDMARK_CASES: [string, (doc: Document) => void][] = [
  [
    'selector.missing.main',
    (doc) => {
      one(doc, '[role="main"]').removeAttribute('role');
    },
  ],
  [
    'selector.missing.grid',
    (doc) => {
      one(doc, '[role="grid"]').removeAttribute('role');
    },
  ],
  [
    'selector.missing.row',
    (doc) => {
      for (const r of all(doc, '[role="row"]')) r.removeAttribute('role');
    },
  ],
  [
    'selector.missing.subject',
    (doc) => {
      one(row(doc, 4), '[data-legacy-last-message-id]').removeAttribute('data-legacy-last-message-id');
    },
  ],
  [
    'selector.ambiguous.subject',
    (doc) => {
      const anchor = one(row(doc, 5), '[data-legacy-last-message-id]');
      const second = doc.createElement('span');
      second.setAttribute('data-legacy-last-message-id', '1a0000000000beef');
      anchor.after(second);
    },
  ],
  [
    'selector.missing.cell',
    (doc) => {
      one(row(doc, 6), '[role="gridcell"]:has([data-legacy-last-message-id])').removeAttribute('role');
    },
  ],
  [
    'selector.missing.recipient',
    (doc) => {
      const span = one(row(doc, 2), '[email]');
      span.removeAttribute('email');
      span.removeAttribute('data-hovercard-id');
    },
  ],
  [
    'row.recipient_invalid',
    (doc) => {
      one(row(doc, 1), '[email]').setAttribute('email', 'Priya Raman');
    },
  ],
  [
    'selector.missing.time',
    (doc) => {
      const span = one(row(doc, 3), '[role="gridcell"]:last-child [aria-label]');
      span.removeAttribute('title');
      span.removeAttribute('aria-label');
    },
  ],
  [
    'selector.missing.account',
    (doc) => {
      one(doc, '[aria-label^="Google Account"]').removeAttribute('aria-label');
    },
  ],
  [
    'selector.ambiguous.account',
    (doc) => {
      const other = doc.createElement('a');
      other.setAttribute('aria-label', 'Google Account: Someone Else (someone.else@example.org)');
      one(doc, '[role="banner"]').append(other);
    },
  ],
];

describe('a missing landmark names itself, and nothing is extracted (Hard Rule 6)', () => {
  it.each(LANDMARK_CASES)('%s', async (reason, mutate) => {
    expect(await planVariant({ mutate })).toEqual(degraded(reason));
  });

  it('every reason health can give is a closed, listed code', () => {
    for (const [reason] of LANDMARK_CASES) expect(SENT_HEALTH_REASONS).toContain(reason);
    for (const reason of SENT_HEALTH_REASONS) expect(reason).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/u);
  });
});

describe('anchors are role, aria-*, data-* and structure, never class names', () => {
  it('rewriting every class name on the page changes nothing', async () => {
    const clean = await planVariant();
    const renamed = await planVariant({
      mutate: (doc) => {
        all(doc, '[class]').forEach((el, at) => {
          el.setAttribute('class', `r${String(at)}x q${String(at * 7)}`);
        });
      },
    });
    expect(renamed).toEqual(clean);
  });

  it('health is OK on the Sent list and reads the page only', async () => {
    const fixture = fixtureNamed(PAGE_1);
    const page = openPage(fixtureHtml(fixture), fixture.page.liveUrl);
    const before = page.doc.documentElement.outerHTML;
    expect(sentHealth(page.doc)).toEqual({ status: 'OK' });
    expect(page.doc.documentElement.outerHTML).toBe(before);
    await page.close();
  });
});
