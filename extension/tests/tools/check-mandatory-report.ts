/**
 * CI: `tsx tests/tools/check-mandatory-report.ts <report.json>` after the @mandatory step. Exits non-zero
 * unless exactly the pinned @mandatory tests ran, once each, and passed (QA-V1).
 */
import { readFileSync } from 'node:fs';

import { checkMandatoryReport } from './mandatory-report';

const [reportPath] = process.argv.slice(2);
if (reportPath === undefined) {
  console.error('usage: check-mandatory-report <playwright-json-report>');
  process.exit(2);
}
const problems = checkMandatoryReport(JSON.parse(readFileSync(reportPath, 'utf8')), 'run');
for (const problem of problems) console.error(`[mandatory] ${problem}`);
if (problems.length > 0) process.exit(1);
console.log('[mandatory] all pinned @mandatory tests ran once and passed');
