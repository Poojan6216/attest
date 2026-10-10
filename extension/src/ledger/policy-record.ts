/**
 * A `policies` row (sprint_3 3.13; ./replay-records.ts): a policy document as policy/default.json writes one, keyed by
 * its `policyHash`. Kept apart from ./types.ts, so a page that reads receipts loads no policy schema (sprint_4 close,
 * tech review TECH-5: the popup never reads this table).
 */
import { z } from 'zod';

import { PolicyDocument } from '../core/policy-document';
import { Sha256 } from '../core/schema';

export const PolicyRecord = z.strictObject({ policyHash: Sha256, document: PolicyDocument });

export type PolicyRecord = z.infer<typeof PolicyRecord>;
