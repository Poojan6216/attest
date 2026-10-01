/**
 * attest/core-determinism — Hard Rule 4: src/core gives the same answer on every machine, forever.
 *
 * Applied to `src/core/**` with noInlineConfig, alongside no-restricted-globals (Intl, globalThis, …).
 *  - `Date` may only be used as `new Date(<value>)` or `Date.UTC(…)` (and `x instanceof Date`). Everything else
 *    is reported: `Date.now`, `Date.parse` (an offset-less string parses in local time), `Date()`, `new Date()`,
 *    `const { now } = Date`, `const D = Date`, `f(Date)`, `Date['now']`, `Reflect.get(Date, 'now')`.
 *  - `Math` may only be read as `Math.<name>` with a written name other than `random`: `Math.random`,
 *    `Math[k]`, `const { random } = Math`, `const M = Math` and `f(Math)` are reported.
 *  - Methods whose answer depends on the host's time zone or locale are reported on any object: local-time
 *    getters and setters, `getTimezoneOffset`, `toLocale*`, `localeCompare`, `toDateString`, `toTimeString`.
 *    (`Date#toString` and `String(date)` are local too, but cannot be told apart from other `toString`
 *    calls without types; the core suites also run under two time zones in CI to catch them.)
 */
import { forEachGlobalReference, propertyName } from './scope-globals.js';

const LOCAL_TIME_METHODS = new Set([
  'getFullYear',
  'getYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'getSeconds',
  'getMilliseconds',
  'getTimezoneOffset',
  'setFullYear',
  'setYear',
  'setMonth',
  'setDate',
  'setHours',
  'setMinutes',
  'setSeconds',
  'setMilliseconds',
  'toDateString',
  'toTimeString',
]);

const LOCALE_METHODS = new Set([
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleUpperCase',
  'toLocaleLowerCase',
  'localeCompare',
]);

/** @typedef {import('estree').Node & { parent?: import('estree').Node }} NodeWithParent */

/** @param {NodeWithParent} identifier */
function dateUseAllowed(identifier) {
  const parent = identifier.parent;
  if (parent?.type === 'NewExpression') return parent.callee === identifier && parent.arguments.length > 0;
  if (parent?.type === 'MemberExpression' && parent.object === identifier)
    return propertyName(parent) === 'UTC';
  return (
    parent?.type === 'BinaryExpression' && parent.operator === 'instanceof' && parent.right === identifier
  );
}

/** @param {NodeWithParent} identifier */
function mathUseAllowed(identifier) {
  const parent = identifier.parent;
  if (parent?.type !== 'MemberExpression' || parent.object !== identifier || parent.computed) return false;
  return propertyName(parent) !== 'random';
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid clocks, randomness, and host time-zone or locale dependence in src/core (Hard Rule 4).',
    },
    schema: [],
    messages: {
      date: 'src/core is pure: use Date only as `new Date(value)` or `Date.UTC(…)`; pass time in as an argument (Hard Rule 4).',
      math: "src/core is pure: no randomness, and no aliasing or computed access of 'Math' (Hard Rule 4).",
      localTime:
        "src/core is deterministic: '{{name}}' depends on the host time zone. Use the UTC methods (Hard Rule 4).",
      locale: "src/core is deterministic: '{{name}}' depends on the host locale (Hard Rule 4).",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === null) return;
        if (LOCAL_TIME_METHODS.has(name)) context.report({ node, messageId: 'localTime', data: { name } });
        else if (LOCALE_METHODS.has(name)) context.report({ node, messageId: 'locale', data: { name } });
      },
      'Program:exit'(program) {
        forEachGlobalReference(context, program, new Set(['Date', 'Math']), (identifier, name) => {
          const allowed = name === 'Date' ? dateUseAllowed(identifier) : mathUseAllowed(identifier);
          if (!allowed) context.report({ node: identifier, messageId: name === 'Date' ? 'date' : 'math' });
        });
      },
    };
  },
};

export default rule;
