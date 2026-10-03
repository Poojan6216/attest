// @ts-check
/**
 * attest/core-globals — Hard Rules 1 and 4: src/core reads no global but the ECMAScript 2023 built-ins on its
 * allowlist (CORE_ALLOWED_GLOBALS, eslint-rules/core-names.js; R4-FENCE-1, R4-FENCE-2).
 *
 * Applied to `src/core/**` with noInlineConfig. A list of banned names always misses one (`Image`, `FontFace`,
 * `clientInformation` passed the fences while only their lists held), so this rule turns the list round: every value
 * reference to a global (by scope analysis, scope-globals.js: calls, `new`, `typeof`, aliasing, passing as a value,
 * through an ambient declaration) whose name is not on the allowlist is reported. A name src/core's
 * no-restricted-globals or attest/no-network already reports is left to them, with their clearer messages, so each
 * read is reported once. A binding the file declares or imports is not a global, and type-only references are
 * skipped.
 */
import { CORE_ALLOWED_GLOBALS, CORE_RESTRICTED_GLOBAL_NAMES, NETWORK_GLOBALS } from './core-names.js';
import { forEachGlobalReference } from './scope-globals.js';

/** Names another rule reports in src/core (no-restricted-globals, attest/no-network). */
const REPORTED_ELSEWHERE = new Set([...CORE_RESTRICTED_GLOBAL_NAMES, ...NETWORK_GLOBALS]);

/** Every global name this rule reports: off the allowlist and reported by no other rule. */
const NOT_ALLOWED = {
  /** @param {string} name */
  has: (name) => !CORE_ALLOWED_GLOBALS.has(name) && !REPORTED_ELSEWHERE.has(name),
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'src/core reads only the ES2023 built-ins on its allowlist (Hard Rules 1 and 4).',
    },
    schema: [],
    messages: {
      notAllowed:
        "src/core reads only the ES2023 built-ins on its allowlist (eslint-rules/core-names.js): '{{name}}' is not one. Pass what you need in as an argument (Hard Rules 1 and 4).",
    },
  },
  create(context) {
    return {
      'Program:exit'(program) {
        forEachGlobalReference(context, program, NOT_ALLOWED, (identifier, name) => {
          context.report({ node: identifier, messageId: 'notAllowed', data: { name } });
        });
      },
    };
  },
};

export default rule;
