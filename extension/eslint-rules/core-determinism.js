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
 *    getters and setters, `getTimezoneOffset`, `toLocale*`, `localeCompare`, `toDateString`, `toTimeString`; so is
 *    the same name given as the written key of `Reflect.get(o, '…')` or `Object.getOwnPropertyDescriptor`.
 *  - `RegExp` may only be read as `new RegExp(…)` or `x instanceof RegExp`: `RegExp.lastMatch`, `RegExp.$1` and the
 *    other legacy statics hold the last match any code in the realm made, so aliasing, passing, a member or a
 *    destructuring of it is reported.
 *  - `Reflect` may only be read as `Reflect.get`, `Reflect.has` or `Reflect.isExtensible`, and `Object` only as a
 *    member with a written name other than those that list, define or re-parent properties
 *    (`getOwnPropertyNames`, `getOwnPropertyDescriptors`, `getOwnPropertySymbols`, `defineProperty`,
 *    `defineProperties`, `setPrototypeOf`, `assign`, `preventExtensions`, `seal`), or as `x instanceof Object`
 *    (FR3-2). Aliasing either (`const R = Reflect`), passing it, or a computed member is reported. The key of
 *    `Reflect.get` and `Object.getOwnPropertyDescriptor` must be written: a string, a template without expressions,
 *    or a plain name (`'getTimezone' + 'Offset'` is reported).
 *  - With type information (the real `pnpm lint` run, projectService; core-determinism-types.js), conversions that
 *    render a Date in the host's time zone are reported too: `date.toString()` (also read as a value),
 *    `String(date)`, `new String(date)`, `${date}`, `date + …`, and `join` or `toString` on an array of dates
 *    (TECH-C2); the same on a value whose type may hide a Date (`unknown`, `any`, `object`, `{}`, a type parameter,
 *    or an array of them; FR3-2); `Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor`, `Reflect.get` and
 *    `Reflect.has` on a Date; a computed member of a Date whose key is not written (`date[key]`,
 *    `date[Symbol.toPrimitive]`); and any value typed DateConstructor other than the global `Date` itself
 *    (`(new Date(0).constructor as DateConstructor).now()`, PI-3). Without type information (a virtual file in a lint
 *    test) these checks are skipped; the core suites also run under two time zones in CI (`test:tz`), and under the
 *    runtime guard (tests/unit/core/core-poison.ts) in `pnpm test:poison`.
 */
import { typedListener, typeTests } from './core-determinism-types.js';
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

/**
 * Reflect may only be read as `Reflect.<one of these>` (FR3-2): `apply`, `construct`, `set`, `defineProperty`,
 * `ownKeys`, `getPrototypeOf` and the rest reach or change built-ins by a path no fence can follow.
 */
const REFLECT_ALLOWED = new Set(['get', 'has', 'isExtensible']);

/** What Object may not be read as (FR3-2): every way to list, define or re-parent a built-in's properties. */
const OBJECT_BANNED = new Set([
  'getOwnPropertyNames',
  'getOwnPropertyDescriptors',
  'getOwnPropertySymbols',
  'defineProperty',
  'defineProperties',
  'setPrototypeOf',
  'assign',
  'preventExtensions',
  'seal',
]);

/** The calls that read one property by a key argument: that key must be written (FR3-2). */
const KEYED_READS = new Map([
  ['Reflect', 'get'],
  ['Object', 'getOwnPropertyDescriptor'],
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

/**
 * Reflect and Object only as a member with a written name it may use; Object also as `x instanceof Object`.
 * @param {NodeWithParent} identifier
 * @param {string} name
 */
function reflectionUseAllowed(identifier, name) {
  const parent = identifier.parent;
  if (parent?.type === 'BinaryExpression' && parent.operator === 'instanceof' && parent.right === identifier)
    return name === 'Object';
  if (parent?.type !== 'MemberExpression' || parent.object !== identifier) return false;
  const member = propertyName(parent);
  if (member === null) return false;
  return name === 'Reflect' ? REFLECT_ALLOWED.has(member) : !OBJECT_BANNED.has(member);
}

/**
 * A key written in the source: a string, a template without expressions, or a plain name (a const holds it).
 * @param {import('estree').Node | undefined} key
 * @returns {{ written: boolean, text: string | null }}
 */
function writtenKey(key) {
  if (key?.type === 'Literal')
    return { written: true, text: typeof key.value === 'string' ? key.value : null };
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0)
    return { written: true, text: key.quasis[0]?.value.cooked ?? null };
  return { written: key?.type === 'Identifier', text: null };
}

/**
 * RegExp only as `new RegExp(…)` or `x instanceof RegExp`: its legacy statics (`RegExp.lastMatch`, `RegExp.$1`,
 * `RegExp.input`, `RegExp.leftContext`, …) hold the last match any code in the realm made, the caller's included.
 * @param {NodeWithParent} identifier
 */
function regExpUseAllowed(identifier) {
  const parent = identifier.parent;
  if (parent?.type === 'NewExpression') return parent.callee === identifier;
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

/** The globals whose every use is checked, by scope analysis (aliasing and passing as a value included). */
const GUARDED_GLOBALS = new Set(['Date', 'Math', 'Reflect', 'Object', 'RegExp']);

/**
 * Reports a member name (written, or a written key of `Reflect.get`) whose answer depends on the host.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('estree').Node} node
 * @param {string} name
 */
function reportName(context, node, name) {
  if (LOCAL_TIME_METHODS.has(name)) context.report({ node, messageId: 'localTime', data: { name } });
  else if (LOCALE_METHODS.has(name)) context.report({ node, messageId: 'locale', data: { name } });
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
      regexp:
        'src/core is deterministic: use RegExp only as `new RegExp(…)` or `x instanceof RegExp`. Its legacy statics (`RegExp.lastMatch`, `RegExp.$1`, `RegExp.input`) hold the last match any code made (Hard Rule 4).',
      localTime:
        "src/core is deterministic: '{{name}}' depends on the host time zone. Use the UTC methods (Hard Rule 4).",
      locale: "src/core is deterministic: '{{name}}' depends on the host locale (Hard Rule 4).",
      localText:
        "src/core is deterministic: '{{name}}' of a value whose type may hide a Date (`unknown`, `any`, `object`, a type parameter) renders the host's time zone when one is passed. Narrow it first (Hard Rule 4).",
      dateReflection:
        'src/core is deterministic: no reflection on a Date (its prototype holds the local-time methods and the constructor with the clock) (Hard Rule 4).',
      reflect:
        "src/core is pure: '{{name}}' may be read only as a member with a written name, and never as one that lists, defines, re-parents or calls through built-ins (Reflect: get, has, isExtensible; Object: no getOwnPropertyNames, defineProperty, setPrototypeOf, assign, …) (Hard Rule 4).",
      reflectKey:
        "src/core is pure: `{{name}}` takes a written key (a string or a plain name), never one built at run time (`'getTimezone' + 'Offset'`) (Hard Rule 4).",
    },
  },
  create(context) {
    const types = typeTests(context);
    /** @type {Set<import('estree').Node>} */
    const constructors = new Set();
    return merge(types === null ? {} : typedListener(context, types, constructors), {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name !== null) reportName(context, node, name);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return;
        const method = KEYED_READS.get(callee.object.name);
        if (method === undefined || propertyName(callee) !== method) return;
        const key = writtenKey(node.arguments[1]);
        const name = `${callee.object.name}.${method}`;
        if (!key.written) context.report({ node, messageId: 'reflectKey', data: { name } });
        else if (key.text !== null) reportName(context, node, key.text);
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
        forEachGlobalReference(context, program, GUARDED_GLOBALS, (identifier, name) => {
          if (name === 'Date') globalDate.add(identifier);
          if (name === 'RegExp') {
            if (!regExpUseAllowed(identifier)) context.report({ node: identifier, messageId: 'regexp' });
            return;
          }
          if (name === 'Reflect' || name === 'Object') {
            if (!reflectionUseAllowed(identifier, name))
              context.report({ node: identifier, messageId: 'reflect', data: { name } });
            return;
          }
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
