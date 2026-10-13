/**
 * The launch kit in launch/ (sprint_7 7.6, Done when; agents/launch_engineer.md): every file exists and its index lists
 * it; the Show HN title and its drafts fit in 80 characters and start "Show HN:", with five replies; each Reddit post is
 * at most 200 words and ends with a question; the message to incident authors is at most 80 words with one ask and the
 * Loom placeholder; no outreach draft holds a dash, an exclamation mark or a word of hype; and every number in what is
 * posted is one RESULTS.md holds (./public-numbers.ts), dates aside.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, unsourced } from './public-numbers';

const LAUNCH = path.join(REPO_ROOT, 'launch');
const read = (file: string): string => readFileSync(path.join(LAUNCH, file), 'utf8');
const REDDIT = ['reddit/r-privacy.md', 'reddit/r-chatgpt.md', 'reddit/r-claudeai.md'];
const FILES = [
  'README.md',
  'store-listing.md',
  'show-hn.md',
  ...REDDIT,
  'dm-template.md',
  'weekly-posts.md',
  'alerts.md',
  'reliability-report-v0.md',
  'launch-checklist.md',
  'demo.gif',
  'promo-tile.png',
];
const HYPE =
  /\b(?:powerful|seamless(?:ly)?|revolutionary|magic(?:al)?|AI[- ]powered|cutting[- ]edge|game[- ]chang(?:er|ing)|effortless(?:ly)?|limited (?:spots|time)|act now)\b/iu;

/** The text after `heading` (a `## ` heading), up to the next `## `. */
function after(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`no section "${heading}"`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start + heading.length + 5, next === -1 ? undefined : next);
}

const words = (text: string): number => text.split(/\s+/u).filter((word) => word !== '').length;

/** What is posted, file by file: each draft's text, never its purpose line. */
const POSTED: Readonly<Record<string, string>> = {
  'show-hn.md': ['Title drafts', 'Title', 'Body', 'First replies']
    .map((part) => after(read('show-hn.md'), part))
    .join('\n'),
  ...Object.fromEntries(REDDIT.map((file) => [file, after(read(file), 'Title') + after(read(file), 'Post')])),
  'dm-template.md': after(read('dm-template.md'), 'Message'),
  'weekly-posts.md': ['Week one', 'Week two', 'Week three', 'Week four']
    .map((week) => after(read('weekly-posts.md'), week))
    .join('\n'),
  'alerts.md': after(read('alerts.md'), 'Reply'),
};

describe('the launch kit', () => {
  it('has every file, and its index lists every one', () => {
    for (const file of FILES) expect(existsSync(path.join(LAUNCH, file)), file).toBe(true);
    const index = read('README.md');
    for (const entry of readdirSync(LAUNCH).filter((name) => name !== 'README.md')) {
      expect(index, entry).toContain(`](${entry}`);
    }
  });

  it('titles the Show HN post in 80 characters, from five drafts, with five replies', () => {
    const post = read('show-hn.md');
    const title = after(post, 'Title').trim().split('\n')[0] ?? '';
    const drafts = [...after(post, 'Title drafts').matchAll(/^\d\. (.+)$/gmu)].map(([, draft = '']) => draft);
    expect(drafts).toHaveLength(5);
    expect(drafts).toContain(title);
    for (const line of drafts) {
      expect(line).toMatch(/^Show HN: /u);
      expect(line.length, line).toBeLessThanOrEqual(80);
    }
    expect([...after(post, 'First replies').matchAll(/^### /gmu)]).toHaveLength(5);
  });

  it('keeps each Reddit post to 200 words, ending with a question', () => {
    for (const file of REDDIT) {
      const post = after(read(file), 'Post').trim();
      expect(words(post), file).toBeLessThanOrEqual(200);
      expect(post.endsWith('?'), file).toBe(true);
    }
  });

  it('keeps the message to 80 words with one ask and the Loom placeholder', () => {
    const message = POSTED['dm-template.md'] ?? '';
    expect(words(message)).toBeLessThanOrEqual(80);
    expect(message.match(/\?/gu)).toHaveLength(1);
    expect(message).toContain('[Loom link]');
  });

  it.each(Object.keys(POSTED))('%s: no dash, no exclamation mark, no hype', (file) => {
    const text = (POSTED[file] ?? '').replace(/\]\([^)]*\)/gu, ']').replace(/`[^`]*`/gu, '');
    const prose = text.replace(/^\s*- /gmu, '');
    expect(prose).not.toMatch(/[‐-―]|\w-\w| - /u);
    expect(prose).not.toContain('!');
    expect(HYPE.exec(prose)).toBeNull();
  });

  it.each(Object.keys(POSTED))('%s: every number is one RESULTS.md holds', (file) => {
    expect(unsourced(POSTED[file] ?? '')).toEqual([]);
  });
});
