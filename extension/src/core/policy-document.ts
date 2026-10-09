/**
 * The policy document's schema (docs/grading.md §12), apart from ./policy.ts so a module that only checks a document
 * (the ledger's replay records and its export, sprint_3 3.13) never imports the shipped policy file: code that Node
 * loads without a bundler (the Playwright tests import the ledger's schemas) cannot import JSON without an import
 * attribute.
 */
import { policyIssues } from './policy-checks';
import { type PolicyDocument as PolicyDocumentType, PolicyShape } from './policy-schema';

/** The whole policy document: every field's schema plus the cross-field checks. Strict at every level. */
export const PolicyDocument = PolicyShape.superRefine((doc, ctx) => {
  for (const issue of policyIssues(doc)) {
    ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message });
  }
});

export type PolicyDocument = PolicyDocumentType;
