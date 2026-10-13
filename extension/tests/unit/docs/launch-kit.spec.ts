/**
 * The launch kit in launch/ (sprint_7 7.6, Done when; agents/launch_engineer.md; Sprint 7 close): every file exists and
 * its index lists it; the Show HN title and its drafts fit in 80 characters and start "Show HN:", with five replies;
 * each Reddit post is at most 200 words and ends with a question; the message to incident authors is at most 80 words
 * with one ask and the Loom placeholder; no outreach draft holds a dash of any kind, an exclamation mark or a word no
 * copy uses (./copy-rules.ts; QA review QA-10, tech review TECH-14); and none claims more than the code proves about
 * what is sent (privacy review gap 11): nothing "never sends", "sends nothing" or is "local only" without the option
 * that sends. Every number posted names its metric (./figures.spec.ts).
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DASH, HYPE, read, REPO_ROOT, section } from './copy-rules';
import { POSTED } from './figures';

const LAUNCH = path.join(REPO_ROOT, 'launch');
const launch = (file: string): string => read(path.join('launch', file));
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
/** The outreach drafts: what is posted from launch/, never a purpose line. */
const OUTREACH = Object.entries(POSTED).filter(([file]) => !file.startsWith('README.md'));
/** What the code cannot prove while an option that sends exists: an absolute claim that nothing is sent. */
const OVERCLAIM =
  /\b(?:never sends? (?:your \w+ |anything |a thing )?anywhere|sends? nothing(?! unless)|sending nothing(?! unless)|local only)\b/iu;

const words = (text: string): number => text.split(/\s+/u).filter((word) => word !== '').length;

describe('the launch kit', () => {
  it('has every file, and its index lists every one', () => {
    for (const file of FILES) expect(existsSync(path.join(LAUNCH, file)), file).toBe(true);
    const index = launch('README.md');
    for (const entry of readdirSync(LAUNCH).filter((name) => name !== 'README.md')) {
      expect(index, entry).toContain(`](${entry}`);
    }
  });

  it('titles the Show HN post in 80 characters, from five drafts, with five replies', () => {
    const post = launch('show-hn.md');
    const title = section(post, 'Title').trim().split('\n')[0] ?? '';
    const drafts = [...section(post, 'Title drafts').matchAll(/^\d\. (.+)$/gmu)].map(
      ([, draft = '']) => draft,
    );
    expect(drafts).toHaveLength(5);
    expect(drafts).toContain(title);
    for (const line of drafts) {
      expect(line).toMatch(/^Show HN: /u);
      expect(line.length, line).toBeLessThanOrEqual(80);
    }
    expect([...section(post, 'First replies').matchAll(/^### /gmu)]).toHaveLength(5);
  });

  it('keeps each Reddit post to 200 words, ending with a question', () => {
    for (const file of REDDIT) {
      const post = section(launch(file), 'Post').trim();
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
});

describe('the launch kit’s outreach', () => {
  it.each(OUTREACH)('%s: no dash of any kind, no exclamation mark, no word no copy uses', (_file, text) => {
    const prose = text
      .replace(/\]\([^)]*\)/gu, ']')
      .replace(/`[^`]*`/gu, '')
      .replace(/^\s*- /gmu, '');
    expect(DASH.exec(prose)?.[0]).toBeUndefined();
    expect(prose).not.toContain('!');
    expect(HYPE.exec(prose)).toBeNull();
  });

  it.each(OUTREACH)('%s: claims no more than the code proves about what is sent', (_file, text) => {
    expect(OVERCLAIM.exec(text)?.[0]).toBeUndefined();
  });

  it('catches every dash and every overclaim it names', () => {
    for (const dash of [
      'a - b',
      'a -- b',
      'a \u2212 b',
      'a\u2e3ab',
      'a\uff0db',
      'a\ufe58b',
      'a\u00adb',
      'a -b',
    ])
      expect(DASH.test(dash), dash).toBe(true);
    for (const claim of [
      'a checker that never sends your mail anywhere',
      'in your browser, sending nothing',
      '(local only, misses some)',
      'It sends nothing.',
    ])
      expect(OVERCLAIM.test(claim), claim).toBe(true);
    for (const honest of ['sending nothing unless you turn it on', 'it keeps your mail in your browser'])
      expect(OVERCLAIM.test(honest), honest).toBe(false);
  });
});
