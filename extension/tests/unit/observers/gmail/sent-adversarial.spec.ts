/**
 * Adversarial cases for the Gmail Sent observer (sprint_2 2.2 verification; Hard Rules 5, 6). Each pins a rule of
 * ./sent-page.ts, ./shown.ts, ./route.ts or ./account.ts that the corpus alone does not: a view Gmail still shows
 * after the route changed, earlier views kept in the DOM in other ways, markup the live page may add (nested cells,
 * avatars, display names in `title`), the head-of-list control, and the account switcher's label.
 */
import { describe, expect, it } from 'vitest';

import { accountHashOf } from '../../../../src/observers/account';
import { addHiddenView, all, one, planVariant, row } from './variants';

const SENT = 'https://mail.google.com/mail/u/0/#sent';
const degraded = (reason: string) => ({ status: 'DEGRADED', reasons: [reason], observations: [] });

/** Marks the nav link that opens `folder` as selected (tabindex 0) and every other link as not. */
const selectNav = (folder: string) => (doc: Document) => {
  for (const link of all(doc, '[role="navigation"] a[href*="#"]')) {
    link.setAttribute('tabindex', link.getAttribute('href')?.endsWith(`#${folder}`) ? '0' : '-1');
  }
};

describe('a previous view still shown under #sent (route and nav already say Sent) is not read', () => {
  it.each(['synthetic-inbox.html', 'synthetic-drafts.html'])(
    '%s drawn at #sent: the document title names its folder, so DEGRADED view.mismatch',
    async (file) => {
      expect(await planVariant({ file, url: SENT, mutate: selectNav('sent') })).toEqual(
        degraded('view.mismatch'),
      );
    },
  );

  it('a title that names no folder (a chat flash) or names Sent and a same-titled label does not block', async () => {
    const clean = await planVariant();
    expect(clean.status).toBe('OK');
    const flash = await planVariant({
      mutate: (doc) => {
        one(doc, 'title').textContent = 'Alex says hi - Gmail';
      },
    });
    expect(flash).toEqual(clean);
    const label = await planVariant({
      mutate: (doc) => {
        const link = doc.createElement('a');
        link.setAttribute('href', 'https://mail.google.com/mail/u/0/#label/Sent');
        link.setAttribute('title', 'Sent');
        link.setAttribute('tabindex', '-1');
        one(doc, '[role="navigation"]').append(link);
      },
    });
    expect(label).toEqual(clean);
  });
});

describe('earlier views kept in the DOM in other ways', () => {
  it('a stale list under visibility: hidden is not read', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        addHiddenView(doc, (el) => {
          el.setAttribute('style', 'visibility: hidden');
        });
      },
    });
    expect(plan).toEqual(await planVariant());
  });

  it("a hidden earlier view's own main region, list and enabled Newer change nothing", async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        const main = doc.createElement('div');
        main.setAttribute('role', 'main');
        main.setAttribute('style', 'display: none');
        main.innerHTML = '<div role="button" aria-label="Newer" tabindex="0"></div>';
        main.append(one(doc, '[role="main"] [role="grid"]').cloneNode(true));
        doc.body.append(main);
      },
    });
    expect(plan).toEqual(await planVariant());
    expect(plan.status === 'OK' && plan.coverage.map((c) => c.windowEnd)).toEqual([
      '2026-10-03T10:15:00-04:00',
    ]);
  });

  it('a Newer control marked aria-disabled="false" is enabled: not the head, so rows and no coverage', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        one(doc, '[aria-label="Newer"]').setAttribute('aria-disabled', 'false');
      },
    });
    expect(plan).toEqual({ status: 'OK_NO_COVERAGE', observations: (await planVariant()).observations });
  });
});

describe('the route and the nav, exactly', () => {
  it('an http: Gmail address is not Gmail', async () => {
    expect(await planVariant({ url: 'http://mail.google.com/mail/u/0/#sent' })).toEqual(
      degraded('location.not_gmail'),
    );
  });

  it('relative nav links are read against the page address', async () => {
    const relative = (doc: Document) => {
      for (const link of all(doc, '[role="navigation"] a[href*="#"]')) {
        const href = link.getAttribute('href') ?? '';
        link.setAttribute('href', href.slice(href.indexOf('#')));
      }
      selectNav('inbox')(doc);
    };
    expect(await planVariant({ mutate: relative })).toEqual(degraded('view.mismatch'));
  });

  it('only tabindex="0" marks a folder as selected: links without a tabindex mark nothing', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        for (const link of all(doc, '[role="navigation"] a[href*="#"]')) {
          if ((link.getAttribute('href') ?? '').endsWith('#sent')) link.setAttribute('tabindex', '-1');
          else link.removeAttribute('tabindex');
        }
      },
    });
    expect(plan).toEqual(await planVariant());
  });
});

describe('row markup the live page may add', () => {
  it('a nested cell in the subject cell (a label chip with a title) is part of that cell', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        for (const r of all(doc, '[role="row"]')) {
          const chip = doc.createElement('div');
          chip.setAttribute('role', 'gridcell');
          chip.innerHTML = '<div title="Work" aria-label="Work">Work</div>';
          one(r, '[data-legacy-last-message-id]').after(chip);
        }
      },
    });
    expect(plan).toEqual(await planVariant());
  });

  it('an avatar nested in a recipient span, or a display name in its title, changes nothing', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        for (const span of all(doc, '[role="main"] [email]')) {
          span.setAttribute('title', span.getAttribute('name') ?? 'Someone');
          const avatar = doc.createElement('img');
          avatar.setAttribute('data-hovercard-id', 'not-an-address');
          span.append(avatar);
        }
      },
    });
    expect(plan).toEqual(await planVariant());
  });

  it('an email attribute that is not an address is refused, even when the title is one', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        const span = one(row(doc, 0), '[email]');
        span.setAttribute('title', span.getAttribute('email') ?? '');
        span.setAttribute('email', 'Alex Rivera');
      },
    });
    expect(plan).toEqual(degraded('row.recipient_invalid'));
  });
});

describe('the account switcher', () => {
  const ACCOUNT = accountHashOf('avery.founder@example.com');
  const hashOf = async (mutate: (doc: Document) => void) => {
    const plan = await planVariant({ mutate });
    return plan.status === 'OK' ? plan.coverage[0].accountHash : plan.status;
  };

  it('the address is the parenthesised one at the end, not one inside the display name', async () => {
    const label = 'Google Account: Avery (someone.else@example.org)\n(avery.founder@example.com)';
    const relabel = (doc: Document) => {
      one(doc, '[aria-label^="Google Account"]').setAttribute('aria-label', label);
    };
    expect(await hashOf(relabel)).toBe(ACCOUNT);
  });

  it('the same address in another case is one account; a label outside the banner is not read', async () => {
    const twice = (doc: Document) => {
      const other = doc.createElement('a');
      other.setAttribute('aria-label', 'Google Account: Avery\n(Avery.Founder@Example.com)');
      one(doc, '[role="banner"]').append(other);
    };
    expect(await hashOf(twice)).toBe(ACCOUNT);
    const outside = (doc: Document) => {
      one(row(doc, 0), '[email]').setAttribute('aria-label', 'Alex Rivera (alex.rivera@example.com)');
    };
    expect(await hashOf(outside)).toBe(ACCOUNT);
  });
});
