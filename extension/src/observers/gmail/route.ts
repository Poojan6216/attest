/**
 * Which Gmail view is active, from the page's own address (sprint_2 2.2; Hard Rule 5). Gmail routes in the URL
 * fragment: `#sent` is the first page of the Sent list, `#sent/p2` its second page, `#sent/<thread>` an opened
 * conversation, `#drafts`, `#inbox`, `#label/…`, `#search/…` other views. A compose window adds `?compose=…`.
 *
 * The fragment is Gmail's record of the view it shows, so it decides which folder is active; the DOM still holds
 * earlier views, hidden (../shown.ts). Read from `doc.URL`, a string: nothing here touches `location` (Hard Rule 3).
 * Gmail's origin is the host permission itself (src/config.ts OBSERVER_HOSTS.gmail), never a second copy (TECH-14).
 * The receipt observer reads its thread addresses through `gmailFragment` too (./receipts/message.ts).
 */
import { OBSERVER_HOSTS } from '../../config';
import { PAGE_SEGMENT, SENT_SELECTORS } from './selectors';

export type SentRoute =
  /** The Sent list, page `page` (1 is the head of the list). */
  | { readonly kind: 'list'; readonly page: number }
  /** The Sent folder with a conversation open (or a split-pane preview): no list to read as the whole page. */
  | { readonly kind: 'conversation' }
  /** Any other folder or view. */
  | { readonly kind: 'other' }
  /** Not a Gmail address at all. */
  | { readonly kind: 'not_gmail' };

/** Gmail's origins (`https://mail.google.com`), from its host match patterns (`https://mail.google.com/*`). */
const GMAIL_ORIGINS: ReadonlySet<string> = new Set(
  OBSERVER_HOSTS.gmail.map((pattern) => new URL(pattern).origin),
);

/**
 * The fragment of `url` (resolved against `base` when relative) without its `#` and without a `?query` part, or
 * null when it does not parse or is not a Gmail address.
 */
export function gmailFragment(url: string, base?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  if (!GMAIL_ORIGINS.has(parsed.origin)) return null;
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  const query = fragment.indexOf('?');
  return query < 0 ? fragment : fragment.slice(0, query);
}

/** The view a Gmail address shows. */
export function sentRoute(url: string): SentRoute {
  const path = gmailFragment(url);
  if (path === null) return { kind: 'not_gmail' };
  const [folder, second, ...rest] = path.split('/');
  if (folder !== SENT_SELECTORS.route.folder) return { kind: 'other' };
  if (second === undefined) return { kind: 'list', page: 1 };
  const page = PAGE_SEGMENT.exec(second)?.[1];
  if (page !== undefined && rest.length === 0) return { kind: 'list', page: Number(page) };
  return { kind: 'conversation' };
}

/** The folder a nav link's `href` opens (`sent` for `…/#sent`), read against the page address; or null. */
export function linkFolder(href: string, pageUrl: string): string | null {
  const path = gmailFragment(href, pageUrl);
  if (path === null || path === '') return null;
  return path.split('/')[0] ?? null;
}
