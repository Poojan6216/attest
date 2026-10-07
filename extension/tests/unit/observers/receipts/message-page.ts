/**
 * Hand-built opened-conversation pages for the receipt parser tests (sprint_2 2.3): the Gmail page model of
 * tests/fixtures/pages/README.md (banner account switcher, `role="main"`, the subject heading, one `role="listitem"`
 * per message with the sender span, the date cell and the body), with random class names so nothing can anchor on
 * them. Synthetic structure, not a capture of any page. Bodies may carry seeded secrets: they must never come out.
 */
import { withPage } from './receipt-fixtures';

export const ACCOUNT = 'avery.founder@example.com';
export const THREAD_URL = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzZGxrXxHGLCpWxRpfXgzvWhpWHb';
export const LIST_URL = 'https://mail.google.com/mail/u/0/#inbox';

export interface MessageSpec {
  readonly from: string;
  readonly name?: string;
  /** The date cell's `title`; null leaves the title off (then `alt`, then the visible text is read). */
  readonly title?: string | null;
  readonly alt?: string;
  /** The date cell's visible text. */
  readonly shown?: string;
  readonly body: string;
  readonly key?: string;
  readonly expanded?: 'true' | 'false' | null;
  /** Leave out the date cell entirely. */
  readonly noDate?: boolean;
  /** Leave out the sender span entirely. */
  readonly noSender?: boolean;
  /**
   * Draw the message as real Gmail does (capture of 2026-10-06): the key on an element inside the list item, not on
   * it, and a list of attachment chips inside the message.
   */
  readonly nestedKey?: boolean;
  /** Leave the message key off entirely, as real Gmail draws a collapsed message (capture of 2026-10-06). */
  readonly noKey?: boolean;
}

export interface PageSpec {
  readonly subject?: string | null;
  readonly account?: string | null;
  readonly messages: readonly MessageSpec[];
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let counter = 0;
/** A fresh random-looking class name, so a test can never pass by anchoring on one. */
function cls(): string {
  counter += 1;
  return `k${(counter * 7919).toString(36)}`;
}

function senderHtml(m: MessageSpec): string {
  if (m.noSender === true) return '';
  const name = m.name ?? '';
  return `<h3 class="${cls()}"><span role="gridcell" tabindex="-1"><span email="${escape(m.from)}" name="${escape(name)}" data-hovercard-id="${escape(m.from)}" class="${cls()}"><span>${escape(name)}</span></span> <span><span aria-hidden="true">&lt;</span>${escape(m.from)}<span aria-hidden="true">&gt;</span></span></span></h3>`;
}

function dateHtml(m: MessageSpec): string {
  if (m.noDate === true) return '';
  const title = m.title === undefined ? 'Fri, Oct 2, 2026, 4:17 PM' : m.title;
  const attributes = [
    title === null ? '' : ` title="${escape(title)}"`,
    m.alt === undefined ? '' : ` alt="${escape(m.alt)}"`,
  ].join('');
  return `<div class="${cls()}"><span class="${cls()}"${attributes} role="gridcell" tabindex="-1">${escape(m.shown ?? 'Fri, Oct 2, 4:17 PM (18 hours ago)')}</span></div>`;
}

function messageHtml(m: MessageSpec, index: number): string {
  const key = m.key ?? `1a0fe43526${String(index).padStart(6, '0')}`;
  const expanded =
    m.expanded === undefined
      ? ' aria-expanded="true"'
      : m.expanded === null
        ? ''
        : ` aria-expanded="${m.expanded}"`;
  const ids =
    m.noKey === true ? '' : `data-message-id="#msg-f:${String(index)}" data-legacy-message-id="${key}"`;
  const attachments =
    m.nestedKey === true ? '<div role="list"><div role="listitem">invoice.pdf</div></div>' : '';
  return [
    `<div class="${cls()}" role="listitem"${expanded} tabindex="-1"${m.nestedKey === true ? '' : ` ${ids}`}>`,
    m.nestedKey === true ? `<div class="${cls()}" ${ids}>` : '',
    `<div><table cellpadding="0" class="${cls()}"><tbody><tr><td>${senderHtml(m)}</td><td>${dateHtml(m)}</td>`,
    `<td><div role="button" aria-label="Reply" tabindex="0" class="${cls()}"></div></td></tr>`,
    `<tr><td colspan="3"><span>to <span email="${ACCOUNT}" name="me">me</span></span></td></tr></tbody></table></div>`,
    `<div class="${cls()}"><div dir="ltr">${m.body}</div>${attachments}</div>`,
    m.nestedKey === true ? '</div></div>' : '</div>',
  ].join('');
}

/** An opened conversation page (a subject heading of null leaves the heading off). */
export function messagePage(spec: PageSpec): string {
  const account = spec.account === undefined ? ACCOUNT : spec.account;
  const switcher =
    account === null
      ? ''
      : `<a class="${cls()}" aria-label="Google Account: Avery Founder&#10;(${escape(account)})" role="button" tabindex="0">A</a>`;
  const subject = spec.subject === undefined ? 'Your receipt from Acme' : spec.subject;
  const heading =
    subject === null
      ? ''
      : `<h2 class="${cls()}" data-legacy-thread-id="1a0fe435260eb853" tabindex="-1">${escape(subject)}</h2>`;
  return [
    `<!DOCTYPE html><html lang="en"><head><title>${escape(subject ?? '')} - Gmail</title></head><body>`,
    `<header class="${cls()}" role="banner">${switcher}</header>`,
    `<div class="${cls()}" role="navigation"><a href="https://mail.google.com/mail/u/0/#inbox" tabindex="0">Inbox</a></div>`,
    `<div class="${cls()}" role="main">${heading}<div role="list">`,
    spec.messages.map(messageHtml).join(''),
    '</div></div></body></html>',
  ].join('');
}

/** A two-column table of body rows: `[label, value]` pairs (bold total rows look the same to the parser). */
export function rows(pairs: readonly (readonly [string, string])[]): string {
  const body = pairs
    .map(([label, value]) => `<tr><td>${escape(label)}</td><td>${escape(value)}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%"><tbody>${body}</tbody></table>`;
}

/** Paragraphs of body text. */
export function paragraphs(...texts: readonly string[]): string {
  return texts.map((text) => `<p>${escape(text)}</p>`).join('');
}

/** Reads a built page at `url` (default: an opened-thread address). */
export function onPage<T>(spec: PageSpec, read: (doc: Document) => T, url = THREAD_URL): T {
  return withPage(messagePage(spec), url, read);
}
