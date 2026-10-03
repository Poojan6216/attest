/**
 * attest/core-determinism — Hard Rule 4: src/core gives the same answer on every machine, forever.
 *
 * Applied to `src/core/**` with noInlineConfig, alongside no-restricted-globals (Intl, globalThis, Temporal, …) and
 * the core no-restricted-syntax list (ambient declarations, `.constructor`, `Symbol.toPrimitive`).
 *  - `Date` may only be used as `new Date(<one value>)` or `Date.UTC(…)` (and `x instanceof Date`). Everything else
 *    is reported: `Date.now`, `Date.parse` (an offset-less string parses in local time), `Date()`, `new Date()`,
 *    `new Date(...args)` (a spread may be empty, which reads the clock), `new Date(y, m, d)` (fields read in the
 *    host's time zone), `const { now } = Date`, `const D = Date`, `f(Date)`, `Date['now']`, `Reflect.get(Date, 'now')`.
 *    A `declare const Date` does not hide the global from this check (scope-globals.js).
 *  - `new Date(<text>)` is reported: a written string or template always, and with type information any argument
 *    that is not a number or a Date (an ISO string without an offset parses in the host's time zone, and any other
 *    text by the engine's own rules). Text is read by normalize-time's `instantMs`.
 *  - `Math` may only be read as `Math.<name>` with a written name other than `random`: `Math.random`,
 *    `Math[k]`, `const { random } = Math`, `const M = Math` and `f(Math)` are reported.
 *  - Methods whose answer depends on the host's time zone or locale are reported on any object: local-time
 *    getters and setters, `getTimezoneOffset`, `toLocale*`, `localeCompare`, `toDateString`, `toTimeString`.
 *  - With type information (the real `pnpm lint` run, projectService), conversions that render a Date in the
 *    host's time zone are reported too: `date.toString()` (also read as a value), `String(date)`, `new String(date)`,
 *    and `join` or `toString` on an array of dates (TECH-C2); so is a computed member of a Date whose key is not
 *    written (`date[key]`, `date[Symbol.toPrimitive]`), and any value typed DateConstructor other than the global
 *    `Date` itself (`(new Date(0).constructor as DateConstructor).now()`, PI-3). Templates and `+` on a Date are
 *    already reported by restrict-template-expressions and restrict-plus-operands. Without type information (a
 *    virtual file in a lint test) these checks are skipped; the core suites also run under two time zones in CI
 *    (`test:tz`), and tests/unit/core/core-poison.spec.ts runs the core with every impure global poisoned.
 */
import ts from 'typescript';

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
  if (parent?.type === 'NewExpression') {
    const [only, ...rest] = parent.arguments;
    return (
      parent.callee === identifier && only !== undefined && only.type !== 'SpreadElement' && rest.length === 0
    );
  }
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
 * Whether `type` (or a part of a union or intersection) is the interface named `name` (`Date`, `DateConstructor`).
 * @param {import('typescript').Type} type
 * @param {string} name
 * @returns {boolean}
 */
function isNamed(type, name) {
  if (type.isUnionOrIntersection()) return type.types.some((part) => isNamed(part, name));
  return type.getSymbol()?.getName() === name;
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
 * Whether `type` is a number or a Date, every part of it: the only values `new Date(value)` reads the same way
 * everywhere.
 * @param {import('typescript').Type} type
 * @returns {boolean}
 */
function numberOrDate(type) {
  if (type.isUnion()) return type.types.every(numberOrDate);
  return (type.flags & ts.TypeFlags.NumberLike) !== 0 || type.getSymbol()?.getName() === 'Date';
}

/**
 * @typedef {object} TypeTests
 * @property {(node: import('estree').Node) => boolean} holdsDate A Date, or an array or tuple of them.
 * @property {(node: import('estree').Node) => boolean} isDate A Date (or a union holding one), not an array.
 * @property {(node: import('estree').Node) => boolean} isDateConstructor Typed DateConstructor.
 * @property {(node: import('estree').Node) => boolean} numberOrDate A number or a Date and nothing else.
 */

/**
 * Tests on an expression's type, from the parser's type information; null when there is none.
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {TypeTests | null}
 */
function typeTests(context) {
  const services = /** @type {any} */ (context.sourceCode.parserServices);
  const program = /** @type {import('typescript').Program | null | undefined} */ (services?.program);
  if (program === null || program === undefined) return null;
  const checker = program.getTypeChecker();
  /** @type {Map<import('estree').Node, import('typescript').Node>} */
  const toTs = services.esTreeNodeToTSNodeMap;
  /** @param {(type: import('typescript').Type) => boolean} test */
  const on = (test) => (/** @type {import('estree').Node} */ node) => {
    const tsNode = toTs.get(node);
    return tsNode !== undefined && test(checker.getTypeAtLocation(tsNode));
  };
  return {
    holdsDate: on((type) => holdsDate(checker, type)),
    isDate: on((type) => isNamed(type, 'Date')),
    isDateConstructor: on((type) => isNamed(type, 'DateConstructor')),
    numberOrDate: on(numberOrDate),
  };
}

/**
 * The expressions a node hands on as values: where a DateConstructor-typed value would be read, called or passed.
 * @param {import('estree').Node} node
 * @returns {(import('estree').Node | null | undefined)[]}
 */
function valueSites(node) {
  switch (node.type) {
    case 'MemberExpression':
      return [node.object];
    case 'CallExpression':
    case 'NewExpression':
      return [node.callee, ...node.arguments];
    case 'VariableDeclarator':
      return [node.init];
    case 'AssignmentExpression':
      return [node.right];
    case 'ReturnStatement':
      return [node.argument];
    case 'ArrowFunctionExpression':
      return node.body.type === 'BlockStatement' ? [] : [node.body];
    case 'Property':
      return [/** @type {import('estree').Node} */ (node.value)];
    case 'ArrayExpression':
      return node.elements;
    default:
      return [node];
  }
}

/** The node types valueSites reads: the assertion forms are checked as values themselves. */
const VALUE_SITE_TYPES = [
  'MemberExpression',
  'CallExpression',
  'NewExpression',
  'VariableDeclarator',
  'AssignmentExpression',
  'ReturnStatement',
  'ArrowFunctionExpression',
  'Property',
  'ArrayExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
];

/**
 * The typed checks: a Date made into text, a Date read with a key that is not written, a Date built from anything
 * but a number or a Date, and a DateConstructor value other than the global `Date` (collected into
 * `constructors`; the global ones are told apart at Program:exit, after scope analysis).
 * @param {import('eslint').Rule.RuleContext} context
 * @param {TypeTests} types
 * @param {Set<import('estree').Node>} constructors
 * @returns {import('eslint').Rule.RuleListener}
 */
function typedListener(context, types, constructors) {
  /** @param {import('estree').Node} node */
  const sites = (node) => {
    for (const site of valueSites(node)) {
      if (
        site !== null &&
        site !== undefined &&
        site.type !== 'SpreadElement' &&
        types.isDateConstructor(site)
      )
        constructors.add(site);
    }
  };
  /** @param {import('estree').CallExpression | import('estree').NewExpression} node */
  const stringOf = (node) => {
    const [argument] = node.arguments;
    if (argument === undefined || argument.type === 'SpreadElement') return;
    if (node.callee.type === 'Identifier' && node.callee.name === 'String' && types.holdsDate(argument))
      context.report({ node, messageId: 'localTime', data: { name: 'String(date)' } });
  };
  return {
    ...Object.fromEntries(VALUE_SITE_TYPES.map((type) => [type, sites])),
    'MemberExpression:exit'(node) {
      const name = propertyName(node);
      if (name !== null && DATE_STRING_METHODS.has(name) && types.holdsDate(node.object)) {
        const what = name === 'join' ? 'join over Date values' : 'toString of a Date';
        context.report({ node, messageId: 'localTime', data: { name: what } });
      } else if (node.computed && name === null && types.isDate(node.object)) {
        context.report({ node, messageId: 'dateKey' });
      }
    },
    'CallExpression:exit': stringOf,
    'NewExpression:exit'(node) {
      stringOf(node);
      const [argument] = node.arguments;
      const isDate = node.callee.type === 'Identifier' && node.callee.name === 'Date';
      if (
        isDate &&
        argument !== undefined &&
        argument.type !== 'SpreadElement' &&
        !types.numberOrDate(argument)
      )
        context.report({ node: argument, messageId: 'dateArgument' });
    },
  };
}

/**
 * Two listeners as one: where both handle a selector, both run (the first one first).
 * @param {import('eslint').Rule.RuleListener} first
 * @param {import('eslint').Rule.RuleListener} second
 * @returns {import('eslint').Rule.RuleListener}
 */
function merge(first, second) {
  /** @type {Record<string, (...args: any[]) => void>} */
  const merged = { ...first };
  for (const [selector, handler] of Object.entries(second)) {
    const before = merged[selector];
    merged[selector] =
      before === undefined
        ? handler
        : (/** @type {any[]} */ ...args) => {
            before(...args);
            handler?.(...args);
          };
  }
  return merged;
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
      date: 'src/core is pure: use Date only as `new Date(value)` with one number or Date, or `Date.UTC(…)`; pass time in as an argument (Hard Rule 4).',
      dateArgument:
        "src/core is deterministic: `new Date(text)` reads the host's time zone or the engine's own parser. Build a Date from epoch ms (normalize-time's instantMs reads text) (Hard Rule 4).",
      dateKey:
        'src/core is deterministic: no computed member of a Date whose key is not written (`date[key]`, `date[Symbol.toPrimitive]`) (Hard Rule 4).',
      math: "src/core is pure: no randomness, and no aliasing or computed access of 'Math' (Hard Rule 4).",
      localTime:
        "src/core is deterministic: '{{name}}' depends on the host time zone. Use the UTC methods (Hard Rule 4).",
      locale: "src/core is deterministic: '{{name}}' depends on the host locale (Hard Rule 4).",
    },
  },
  create(context) {
    const types = typeTests(context);
    /** @type {Set<import('estree').Node>} */
    const constructors = new Set();
    return merge(types === null ? {} : typedListener(context, types, constructors), {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === null) return;
        if (LOCAL_TIME_METHODS.has(name)) context.report({ node, messageId: 'localTime', data: { name } });
        else if (LOCALE_METHODS.has(name)) context.report({ node, messageId: 'locale', data: { name } });
      },
      NewExpression(node) {
        // Without type information, a written string or template is still seen.
        const [argument] = node.arguments;
        if (types !== null || node.callee.type !== 'Identifier' || node.callee.name !== 'Date') return;
        const text =
          argument?.type === 'Literal'
            ? typeof argument.value === 'string'
            : argument?.type === 'TemplateLiteral';
        if (argument !== undefined && text) context.report({ node: argument, messageId: 'dateArgument' });
      },
      'Program:exit'(program) {
        /** @type {Set<import('estree').Node>} */
        const globalDate = new Set();
        forEachGlobalReference(context, program, new Set(['Date', 'Math']), (identifier, name) => {
          if (name === 'Date') globalDate.add(identifier);
          const allowed = name === 'Date' ? dateUseAllowed(identifier) : mathUseAllowed(identifier);
          if (!allowed) context.report({ node: identifier, messageId: name === 'Date' ? 'date' : 'math' });
        });
        for (const node of constructors) {
          if (!globalDate.has(node)) context.report({ node, messageId: 'date' });
        }
      },
    });
  },
};

export default rule;
