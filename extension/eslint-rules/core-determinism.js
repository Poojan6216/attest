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
 *  - With type information (the real `pnpm lint` run, projectService), conversions that render a Date in the
 *    host's time zone are reported too: `date.toString()` (also read as a value), `String(date)`, and `join` or
 *    `toString` on an array of dates (TECH-C2). Templates and `+` on a Date are already reported by
 *    restrict-template-expressions and restrict-plus-operands. Without type information (a virtual file in a lint
 *    test) these checks are skipped; the core suites also run under two time zones in CI (`test:tz`).
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

/** Methods that turn a Date (or an array of dates) into local-time text; reported only with type information. */
const DATE_STRING_METHODS = new Set(['toString', 'join']);

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

/**
 * Whether a value of `type` renders as local time when made a string: a Date, a union or intersection holding one,
 * or an array or tuple of them.
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 * @returns {boolean}
 */
function holdsDate(checker, type) {
  if (type.isUnionOrIntersection()) return type.types.some((part) => holdsDate(checker, part));
  if (type.getSymbol()?.getName() === 'Date') return true;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker
      .getTypeArguments(/** @type {import('typescript').TypeReference} */ (type))
      .some((element) => holdsDate(checker, element));
  }
  return false;
}

/**
 * A test for "this expression holds a Date", from the parser's type information; null when there is none.
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {((node: import('estree').Node) => boolean) | null}
 */
function dateTypeTest(context) {
  const services = /** @type {any} */ (context.sourceCode.parserServices);
  const program = /** @type {import('typescript').Program | null | undefined} */ (services?.program);
  if (program === null || program === undefined) return null;
  const checker = program.getTypeChecker();
  /** @type {Map<import('estree').Node, import('typescript').Node>} */
  const toTs = services.esTreeNodeToTSNodeMap;
  return (node) => {
    const tsNode = toTs.get(node);
    return tsNode !== undefined && holdsDate(checker, checker.getTypeAtLocation(tsNode));
  };
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
    const isDate = dateTypeTest(context);
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === null) return;
        if (LOCAL_TIME_METHODS.has(name)) context.report({ node, messageId: 'localTime', data: { name } });
        else if (LOCALE_METHODS.has(name)) context.report({ node, messageId: 'locale', data: { name } });
        else if (isDate !== null && DATE_STRING_METHODS.has(name) && isDate(node.object)) {
          const what = name === 'join' ? 'join over Date values' : 'toString of a Date';
          context.report({ node, messageId: 'localTime', data: { name: what } });
        }
      },
      CallExpression(node) {
        const [argument] = node.arguments;
        const callee = node.callee;
        if (isDate === null || argument === undefined || argument.type === 'SpreadElement') return;
        if (callee.type === 'Identifier' && callee.name === 'String' && isDate(argument)) {
          context.report({ node, messageId: 'localTime', data: { name: 'String(date)' } });
        }
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
