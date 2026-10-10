/**
 * The shares' markdown (sprint_4 4.8; sprint_4 close, tech review TECH-8): what a share writes has every character
 * markdown gives a meaning escaped, and the share's image (./share-png.ts) and the tests read the text back by removing
 * each escape. Both live here, so each stays the other's inverse.
 */

/** `text` with every character markdown gives a meaning escaped. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/gu, (char) => `\\${char}`);
}

/** `text` with every escape removed: the inverse of `escapeMarkdown`. */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\(.)/gu, '$1');
}
