/**
 * Regenerates tests/golden/__snapshots__/ids.json from the scenario files:
 *   pnpm exec tsx tests/golden/write-ids.ts
 * Review the diff before committing: adding a scenario only adds lines; a changed id is a hashing change.
 */
import { writeFileSync } from 'node:fs';

import { formatIds, IDS_SNAPSHOT, scenarioIds } from './ids';

writeFileSync(IDS_SNAPSHOT, formatIds(scenarioIds()));
console.log(`wrote ${IDS_SNAPSHOT}`);
