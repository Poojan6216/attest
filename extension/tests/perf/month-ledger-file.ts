/**
 * Writes the 30-day ledger's stored rows (./month-ledger.ts) as one JSON file, for a process that cannot import the
 * policy file core reads (Playwright's loader takes no JSON import): `tsx tests/perf/month-ledger-file.ts <out.json>
 * <endMs>`. tests/e2e/perf-ledger.spec.ts runs it and reads the file back.
 */
import { writeFileSync } from 'node:fs';

import { monthLedgerRows } from './month-ledger';

const [out, end] = process.argv.slice(2);
if (out === undefined || end === undefined) throw new Error('usage: month-ledger-file.ts <out.json> <endMs>');
writeFileSync(out, JSON.stringify(await monthLedgerRows(Number(end))));
