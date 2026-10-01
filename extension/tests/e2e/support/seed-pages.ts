/**
 * Injects every seeded secret into a fixture page, in visible text and in the attributes adapters
 * read (title, aria-label, email, href), for the @mandatory no-leak test. Server-side string
 * injection: the page is served already seeded, so the extension sees the secrets exactly as it
 * would see real content.
 */
import type { Seed } from './leaks';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function seedBlock(seeds: readonly Seed[]): string {
  const items = seeds.map((seed) => {
    const value = escapeHtml(seed.value);
    const id = escapeHtml(seed.id);
    return [
      `<div role="row" data-attest-seeded="${id}">`,
      `<span email="${value}" title="${value}" aria-label="${value}">${value}</span>`,
      `<span>${value}</span>`,
      seed.kind === 'url_token' ? `<a href="${value}">${value}</a>` : '',
      '</div>',
    ].join('');
  });
  return `<section aria-label="Seeded secrets" data-attest-seeded-block="1">${items.join('')}</section>`;
}

/** Returns the page with all seeds inserted at the end of the main landmark (or body). */
export function injectSeeds(html: string, seeds: readonly Seed[]): string {
  const block = seedBlock(seeds);
  for (const closing of ['</main>', '</body>']) {
    const at = html.lastIndexOf(closing);
    if (at !== -1) return `${html.slice(0, at)}${block}${html.slice(at)}`;
  }
  return `${html}${block}`;
}
