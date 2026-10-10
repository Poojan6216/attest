/**
 * Reading and rendering bench result files (Hard Rule 12: never report a number you didn't measure).
 *
 * A result file is untrusted input (written by a bench, possibly by hand or by an older version), so each one
 * is validated before RESULTS.md is generated from it (TECH-15): exactly the four fields below, the bench name
 * and date matching the file name, a non-empty command, and metrics that are finite numbers, strings or
 * booleans (a measured value, a unit or label, a pass/fail gate). Anything else throws with the file name.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type MetricValue = number | string | boolean;

export interface BenchResult {
  readonly bench: string;
  readonly date: string;
  readonly command: string;
  readonly metrics: Readonly<Record<string, MetricValue>>;
}

export const RESULT_FILE = /^([a-z0-9][a-z0-9-]*)-(\d{4}-\d{2}-\d{2})\.json$/;
const KEYS = ['bench', 'command', 'date', 'metrics'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMetricValue(value: unknown): value is MetricValue {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  );
}

/** The problems with one parsed result file, given its file name. Empty when it is valid. */
function problemsOf(fileName: string, value: unknown): string[] {
  const match = RESULT_FILE.exec(fileName);
  if (match === null) return ['file name is not <bench>-<yyyy-mm-dd>.json'];
  if (!isRecord(value)) return ['not a JSON object'];
  const problems: string[] = [];
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== KEYS.join(',')) problems.push(`fields must be exactly ${KEYS.join(', ')}`);
  if (value.bench !== match[1]) problems.push(`bench must be "${match[1] ?? ''}" (the file name)`);
  if (value.date !== match[2]) problems.push(`date must be "${match[2] ?? ''}" (the file name)`);
  if (typeof value.command !== 'string' || value.command.trim() === '')
    problems.push('command must be a non-empty string');
  if (!isRecord(value.metrics) || Object.keys(value.metrics).length === 0) {
    problems.push('metrics must be a non-empty object');
  } else {
    for (const [name, metric] of Object.entries(value.metrics)) {
      if (!isMetricValue(metric))
        problems.push(`metric ${name} must be a finite number, a string or a boolean`);
    }
  }
  return problems;
}

/** Validates one result file's parsed JSON; throws naming the file and every problem. */
export function parseBenchResult(fileName: string, value: unknown): BenchResult {
  const problems = problemsOf(fileName, value);
  if (problems.length > 0 || !isRecord(value) || !isRecord(value.metrics)) {
    throw new Error(`bench/results/${fileName}: ${problems.join('; ')}`);
  }
  const { bench, date, command } = value;
  const metrics: Record<string, MetricValue> = {};
  for (const [name, metric] of Object.entries(value.metrics))
    if (isMetricValue(metric)) metrics[name] = metric;
  if (typeof bench !== 'string' || typeof date !== 'string' || typeof command !== 'string') {
    throw new Error(`bench/results/${fileName}: bench, date and command must be strings`);
  }
  return { bench, date, command, metrics };
}

/** The newest valid result of each bench in `dir` (newest by the date in the file name). */
export function latestResults(dir: string): BenchResult[] {
  const newest = new Map<string, string>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const match = RESULT_FILE.exec(file);
    newest.set(match?.[1] ?? file, file);
  }
  return [...newest.values()].map((file) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      throw new Error(`bench/results/${file}: not valid JSON`);
    }
    return parseBenchResult(file, parsed);
  });
}

/** A gate metric: `gatePassed`, or a name ending in `GatePassed` (`gradingGatePassed`). */
const GATE_METRIC = /^(?:gatePassed|[a-z][A-Za-z0-9]*GatePassed)$/;

/** The gate metrics a result carries: `gatePassed` and every `…GatePassed`. A bench may have none (the red team's). */
export function gatesOf(result: BenchResult): string[] {
  return Object.keys(result.metrics).filter((name) => GATE_METRIC.test(name));
}

/**
 * The gates a result failed: its gate metrics that are not `true`. A gate written as anything but a boolean is a
 * failed gate too, so a malformed result can never pass (QA-R8: `pnpm bench` exits non-zero on any of these).
 */
export function failedGates(result: BenchResult): string[] {
  return Object.entries(result.metrics)
    .filter(([name, value]) => GATE_METRIC.test(name) && value !== true)
    .map(([name]) => name);
}

export function render(results: readonly BenchResult[]): string {
  const lines = [
    '# RESULTS',
    '',
    '> Generated by `pnpm bench` from `bench/results/*.json`. Do not edit by hand (Hard Rule 12).',
    '',
  ];
  if (results.length === 0) {
    lines.push(
      'No benchmark results yet. Benches are added from Sprint 1 onward; no number is reported until it is measured.',
      '',
    );
    return lines.join('\n');
  }
  for (const result of results) {
    lines.push(
      `## ${result.bench}`,
      '',
      `Measured ${result.date} with \`${result.command}\`.`,
      '',
      '| Metric | Value |',
      '|---|---|',
    );
    for (const [metric, value] of Object.entries(result.metrics))
      lines.push(`| ${metric} | ${String(value)} |`);
    lines.push('');
  }
  return lines.join('\n');
}
