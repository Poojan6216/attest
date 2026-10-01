/**
 * The two @mandatory tests, pinned by file and title (sprint 0 header: never skipped, retried, or weakened),
 * and the check that a Playwright JSON report really ran them (QA-V1). Static checks on the source cannot see
 * a runtime `test.info().skip()`, a `testIgnore` in the config or an extra CLI flag; the report can.
 *
 *  - `list` mode reads `playwright test --list --grep @mandatory --reporter=json` (unit test, every run):
 *    exactly these tests are collected, nothing more, nothing less.
 *  - `run` mode reads the report of the CI step that runs them: each ran once and passed; none skipped,
 *    failed, flaky or retried.
 *
 * Changing anything here is a reviewed decision: log it in Decisions.md.
 */
import { z } from 'zod';

export const MANDATORY_TESTS: Readonly<Record<string, readonly string[]>> = {
  'network-intercept.spec.ts': [
    'the allowlist asserted here is the allowlist the extension ships',
    'a 5-minute scripted session makes no request outside the allowlist',
    'negative control: the guard catches a request from the worker, an extension page, and a page',
  ],
  'no-leak.spec.ts': [
    'seeded pages leave no trace in export, IndexedDB, storage, console, or network',
    'negative control: a seed planted in each channel is caught',
  ],
};

const Result = z.object({ status: z.string(), retry: z.number() });
const TestEntry = z.object({ status: z.string(), results: z.array(Result) });
const Spec = z.object({ title: z.string(), file: z.string(), tests: z.array(TestEntry) });
interface Suite {
  readonly specs?: readonly z.infer<typeof Spec>[] | undefined;
  readonly suites?: readonly Suite[] | undefined;
}
const SuiteSchema: z.ZodType<Suite> = z.lazy(() =>
  z.object({ specs: z.array(Spec).optional(), suites: z.array(SuiteSchema).optional() }),
);
const Report = z.object({ suites: z.array(SuiteSchema) });

function* specsOf(suite: Suite): Generator<z.infer<typeof Spec>> {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* specsOf(child);
}

/** Every problem with `report` in `mode`; an empty list means the mandatory tests are intact. */
export function checkMandatoryReport(report: unknown, mode: 'list' | 'run'): string[] {
  const parsed = Report.safeParse(report);
  if (!parsed.success) return ['the report is not a Playwright JSON report'];
  const problems: string[] = [];
  const seen = new Map<string, z.infer<typeof Spec>>();
  for (const suite of parsed.data.suites) {
    for (const spec of specsOf(suite)) {
      const key = `${path(spec.file)} :: ${spec.title}`;
      if (seen.has(key)) problems.push(`collected twice: ${key}`);
      seen.set(key, spec);
    }
  }
  const expected = Object.entries(MANDATORY_TESTS).flatMap(([file, titles]) =>
    titles.map((t) => `${file} :: ${t}`),
  );
  for (const key of expected) {
    const spec = seen.get(key);
    if (spec === undefined) problems.push(`missing: ${key}`);
    else if (mode === 'run') problems.push(...runProblems(key, spec));
  }
  for (const key of seen.keys())
    if (!expected.includes(key)) problems.push(`unexpected test under @mandatory: ${key}`);
  return problems;
}

function runProblems(key: string, spec: z.infer<typeof Spec>): string[] {
  const [test, ...extra] = spec.tests;
  if (test === undefined || extra.length > 0) return [`not run exactly once: ${key}`];
  const problems: string[] = [];
  if (test.status !== 'expected') problems.push(`status ${test.status}: ${key}`);
  if (test.results.length !== 1 || test.results.some((r) => r.status !== 'passed' || r.retry !== 0)) {
    problems.push(`did not pass on its only attempt: ${key}`);
  }
  return problems;
}

/** Report files are relative to the test dir; keep the base name only, as MANDATORY_TESTS does. */
function path(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}
