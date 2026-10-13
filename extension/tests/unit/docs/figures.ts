/**
 * Every figure the launch's posted text prints, with the RESULTS.md metric it quotes (Sprint 7 close, tech review
 * TECH-2, QA review QA-2): Sprint 7's rule is that every number in public traces to RESULTS.md, and a number that only
 * equals some value RESULTS.md holds traces to nothing. `POSTED` is what is posted, text by text: the README's first
 * screen and the prose of its Results and Attacks that still work (their tables are ./readme-figures.spec.ts's), the
 * Show HN post, the three Reddit posts, the message, the weekly posts and the alert reply, never a draft's purpose line.
 * `FIGURES` names, for each, the figures it may print: a pattern that finds the figure as written, capturing its
 * numbers, and the metrics they must equal. ./figures.spec.ts fails on a figure that is not its metric's value, and on
 * any number a text prints that no figure names, so a number added to a post fails until it names its metric here.
 */
import path from 'node:path';

import { latestResults, type MetricValue } from '../../../../bench/results';
import { read, REPO_ROOT, section } from './copy-rules';

const METRICS = new Map(
  latestResults(path.join(REPO_ROOT, 'bench', 'results')).map((result) => [result.bench, result.metrics]),
);

/** `bench`'s metric `name`, which RESULTS.md must hold. */
export function metric(bench: string, name: string): MetricValue {
  const value = METRICS.get(bench)?.[name];
  if (value === undefined) throw new Error(`RESULTS.md has no ${bench} ${name}`);
  return value;
}

/** `bench`'s numeric metric `name`. */
export function num(bench: string, name: string): number {
  const value = metric(bench, name);
  if (typeof value !== 'number') throw new Error(`${bench} ${name} is not a number`);
  return value;
}

export interface Strategy {
  readonly number: string;
  readonly name: string;
  readonly cases: number;
  readonly works: number;
  readonly severity: string;
  readonly outcome: string;
}

/** Every red-team strategy RESULTS.md holds, from its `redteam<NN><Name>Cases` metric and its siblings. */
export const STRATEGIES: readonly Strategy[] = Object.keys(METRICS.get('redteam') ?? {}).flatMap((key) => {
  const match = /^redteam(\d{2})([A-Za-z]+)Cases$/u.exec(key);
  if (match === null) return [];
  const [, number = '', name = ''] = match;
  const of = (field: string): MetricValue => metric('redteam', `redteam${number}${name}${field}`);
  return [
    {
      number,
      name,
      cases: num('redteam', key),
      works: num('redteam', `redteam${number}${name}Works`),
      severity: String(of('Severity')),
      outcome: String(of('Outcome')),
    },
  ];
});
export const RANK = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** The strategy that still wins at the highest severity: the README's and the posts' "worst". */
export function worstStrategy(): Strategy {
  const [worst] = STRATEGIES.filter(({ outcome }) => outcome === 'works').sort(
    (a, b) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity),
  );
  if (worst === undefined) throw new Error('no red-team strategy still wins');
  return worst;
}

/** A figure as written, and the metrics its numbers are, in order. */
export interface Figure {
  /** Finds the figure; a global pattern, each capture one number as written (a percentage as such). */
  readonly pattern: RegExp;
  readonly measured: () => number[];
}

const WINNING_STRATEGIES: Figure = {
  pattern: /\b(\d+) of (?:the )?(\d+) (?:attack )?strategies\b/gu,
  measured: () => [num('redteam', 'redteamWorking'), num('redteam', 'redteamStrategies')],
};
const WORST_CASES: Figure = {
  pattern: /\bunflagged in (\d+) of (\d+) cases\b/gu,
  measured: () => [worstStrategy().works, worstStrategy().cases],
};

const README = read('README.md');
/** Every line of `text` but a table's. */
const prose = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('|'))
    .join('\n');
const launch = (file: string): string => read(path.join('launch', file));
const REDDIT = ['reddit/r-privacy.md', 'reddit/r-chatgpt.md', 'reddit/r-claudeai.md'];

/** What is posted, text by text (header). */
export const POSTED: Readonly<Record<string, string>> = {
  'README.md opening': README.slice(0, README.indexOf('\n## ')),
  'README.md Results, beside its table': prose(section(README, 'Results')),
  'README.md Attacks that still work, beside its table': prose(section(README, 'Attacks that still work')),
  'show-hn.md': ['Title drafts', 'Title', 'Body', 'First replies']
    .map((part) => section(launch('show-hn.md'), part))
    .join('\n'),
  ...Object.fromEntries(
    REDDIT.map((file) => [file, `${section(launch(file), 'Title')}\n${section(launch(file), 'Post')}`]),
  ),
  'dm-template.md': section(launch('dm-template.md'), 'Message'),
  'weekly-posts.md': ['Week one', 'Week two', 'Week three', 'Week four']
    .map((week) => section(launch('weekly-posts.md'), week))
    .join('\n'),
  'alerts.md': section(launch('alerts.md'), 'Reply'),
};

/** The figures each posted text may print (header); a text not named here may print no number at all. */
export const FIGURES: Readonly<Record<string, readonly Figure[]>> = {
  'README.md opening': [WINNING_STRATEGIES, WORST_CASES],
  'show-hn.md': [WINNING_STRATEGIES, WORST_CASES],
};
