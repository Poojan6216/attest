/**
 * scripts/check-docs-allowlist.ts (sprint_2 2.9 Done-when: "every allowlisted field in policy/default.json is
 * described"; Hard Rule 2): docs/privacy-architecture.md describes every field the policy lets an observation source
 * store, in that source's allowlist section, and describes nothing else as allowlisted. Each rule is proven on a
 * fixture text, clean and then broken one way at a time, and the real repository passes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs } from '../../../../scripts/check-docs';
import {
  allowlistProblems,
  allowlistSections,
  PRIVACY_DOC,
  policyAllowlists,
} from '../../../../scripts/check-docs-allowlist';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

const POLICY = JSON.stringify({
  rules: [],
  allowlistedFields: { 'gmail.sent': ['counterparty', 'occurredAt'], 'gcal.event': ['occurredAt'] },
});

const DOC = [
  '# Privacy architecture',
  '',
  '## 4. The policy allowlists',
  '',
  '### 4.1 Allowlist: `gmail.sent`',
  '',
  '| Allowlisted field | What it holds |',
  '|---|---|',
  '| `counterparty` | The recipient address as read. |',
  '| `occurredAt` | When the mail was sent. |',
  '',
  '### 4.2 Allowlist: `gcal.event`',
  '',
  '| Allowlisted field | What it holds |',
  '|---|---|',
  '| `occurredAt` | The event start. |',
  '',
  '## 5. What is hashed',
  '',
  '| Field | Hash |',
  '|---|---|',
  '| `counterparty` | not hashed |',
  '',
].join('\n');

const messages = (policy: string | null, doc: string | null): string[] =>
  allowlistProblems(policy, doc).problems.map((p) => `${String(p.line)}: ${p.message}`);

describe('check-docs: every allowlisted field is described in docs/privacy-architecture.md', () => {
  it('passes a document with one section per source and one described row per field, and counts the fields', () => {
    expect(allowlistProblems(POLICY, DOC)).toEqual({ problems: [], checked: 3 });
    expect(allowlistSections(DOC).map((s) => [s.source, s.rows.map((r) => r.field)])).toEqual([
      ['gmail.sent', ['counterparty', 'occurredAt']],
      ['gcal.event', ['occurredAt']],
    ]);
  });

  it('reports a field the policy allowlists that its section does not describe', () => {
    const doc = DOC.replace('| `counterparty` | The recipient address as read. |\n', '');
    expect(messages(POLICY, doc)).toEqual([
      "5: allowlisted field 'counterparty' of gmail.sent (policy/default.json) has no row here: write | `counterparty` | what it holds |",
    ]);
  });

  it('reports a row with an empty description, and a row for a field the policy does not allowlist', () => {
    const empty = DOC.replace('| `occurredAt` | When the mail was sent. |', '| `occurredAt` | |');
    expect(messages(POLICY, empty)).toEqual([
      "10: allowlisted field 'occurredAt' of gmail.sent has no description in the next cell",
    ]);
    const extra = DOC.replace(
      '| `occurredAt` | The event start. |',
      '| `occurredAt` | The event start. |\n| `merchant` | x |',
    );
    expect(messages(POLICY, extra)).toEqual([
      "17: 'merchant' is described as allowlisted for gcal.event, but policy/default.json does not list it",
    ]);
  });

  it('reports a source with no section, a section for an unknown source, and a second section for one source', () => {
    const missing = DOC.replace('### 4.2 Allowlist: `gcal.event`', '### 4.2 Calendar');
    expect(messages(POLICY, missing)).toEqual([
      '0: no allowlist section for gcal.event: write a heading "Allowlist: `gcal.event`" with a row per field',
    ]);
    const unknown = `${DOC}\n### Allowlist: \`gmail.drafts\`\n`;
    expect(messages(POLICY, unknown)).toEqual([
      "24: allowlist section names 'gmail.drafts', which has no allowlist in policy/default.json",
    ]);
    const twice = `${DOC}\n### Allowlist: \`gcal.event\`\n\n| \`occurredAt\` | again |\n`;
    expect(messages(POLICY, twice)).toEqual([
      '24: a second allowlist section for gcal.event: describe each source once',
    ]);
  });
});

describe('check-docs: what counts as an allowlist section and row', () => {
  it('ends a section at the next heading of its level or higher, and reads no code block or HTML comment', () => {
    // The table under "## 5." names `counterparty` outside any allowlist section: not a row of gcal.event.
    expect(allowlistSections(DOC)[1]?.rows.map((r) => r.field)).toEqual(['occurredAt']);
    const fenced = DOC.replace(
      '| `counterparty` | The recipient address as read. |',
      '```\n| `counterparty` | The recipient address as read. |\n```',
    );
    expect(messages(POLICY, fenced)[0]).toContain("'counterparty' of gmail.sent");
    const commented = DOC.replace(
      '| `counterparty` | The recipient address as read. |',
      '<!-- | `counterparty` | The recipient address as read. | -->',
    );
    expect(messages(POLICY, commented)[0]).toContain("'counterparty' of gmail.sent");
    // A heading needs the singular word "allowlist" outside code and exactly one code span.
    const plural = DOC.replace('### 4.2 Allowlist: `gcal.event`', '### 4.2 Allowlists: `gcal.event`');
    expect(messages(POLICY, plural)).toEqual([
      '0: no allowlist section for gcal.event: write a heading "Allowlist: `gcal.event`" with a row per field',
    ]);
  });
});

describe('check-docs: inputs to the allowlist check', () => {
  it('checks nothing without allowlists, and reports a missing document or a malformed allowlist', () => {
    expect(allowlistProblems(null, null)).toEqual({ problems: [], checked: 0 });
    expect(allowlistProblems('{ "rules": [] }', null)).toEqual({ problems: [], checked: 0 });
    expect(allowlistProblems('not json', null)).toEqual({ problems: [], checked: 0 });
    expect(allowlistProblems(POLICY, null)).toEqual({
      problems: [
        {
          file: PRIVACY_DOC,
          line: 0,
          message: 'missing: every allowlisted field in policy/default.json must be described here',
        },
      ],
      checked: 3,
    });
    expect(policyAllowlists('{ "allowlistedFields": ["gmail.sent"] }')).toBe(
      'cannot read "allowlistedFields" (expected source → list of field names)',
    );
    expect(messages('{ "allowlistedFields": { "gmail.sent": [1] } }', DOC)).toEqual([
      '0: cannot read "allowlistedFields.gmail.sent" (expected a list of field names)',
    ]);
  });
});

describe('check-docs runs the allowlist check', () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  it('reports the problem through checkDocs with the document path', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-allowlist-'));
    dirs.push(root);
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ scripts: {} }),
      'policy/default.json': POLICY,
      'docs/grading.md': '# Grading\n',
      'docs/privacy-architecture.md': DOC.replace('### 4.2 Allowlist: `gcal.event`', '### 4.2 Calendar'),
      'README.md': '# Attest\n',
      'PRIVACY.md': '# Privacy\n',
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    const result = checkDocs(root);
    expect(result.allowlistFields).toBe(3);
    expect(result.problems.filter((p) => p.file === PRIVACY_DOC).map((p) => p.message)).toEqual([
      'no allowlist section for gcal.event: write a heading "Allowlist: `gcal.event`" with a row per field',
    ]);
  });

  it('passes on the repository: docs/privacy-architecture.md describes every field policy/default.json allowlists', () => {
    const result = checkDocs(REPO_ROOT);
    expect(result.allowlistFields).toBeGreaterThan(0);
    expect(result.problems.filter((p) => p.file === PRIVACY_DOC)).toEqual([]);
  });
});
