/**
 * The typed half of attest/core-determinism (Hard Rule 4): checks that need the type of an expression, from the
 * parser's type information (the real `pnpm lint` run, projectService). Without type information (a virtual file in
 * a lint test) the rule runs its untyped checks only. See core-determinism.js for what the whole rule reports.
 */
import ts from 'typescript';

import { propertyName } from './scope-globals.js';

/** Methods that turn a Date (or an array of dates, or a value whose type may hide one) into local-time text. */
const TEXT_METHODS = new Set(['toString', 'join']);

/** Calls that read a value's members by reflection: on a Date they reach its prototype (FR3-2). */
const REFLECTION = new Map([
  ['Object', new Set(['getPrototypeOf', 'getOwnPropertyDescriptor'])],
  ['Reflect', new Set(['get', 'has'])],
]);

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
 * Whether a value of `type` could be a Date the type does not show (FR3-2): `any`, `unknown`, `object`, `{}`,
 * `Object`, or a type parameter whose constraint is one of these. A Date passed as one renders local time.
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 * @returns {boolean}
 */
function isOpaque(checker, type) {
  if (type.isUnion()) return type.types.some((part) => isOpaque(checker, part));
  if (type.isIntersection()) return type.types.every((part) => isOpaque(checker, part));
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive)) !== 0) return true;
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint === undefined || constraint === type || isOpaque(checker, constraint);
  }
  if ((type.flags & ts.TypeFlags.Object) === 0 || checker.isArrayType(type) || checker.isTupleType(type))
    return false;
  if (type.getSymbol()?.getName() === 'Object') return true;
  const shapeless = type.getCallSignatures().length === 0 && type.getConstructSignatures().length === 0;
  return shapeless && checker.getPropertiesOfType(type).length === 0;
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
  return elementsOf(checker, type).some((element) => holdsDate(checker, element));
}

/**
 * Whether a value of `type` may be a Date the type does not show (isOpaque), or is an array or tuple holding one.
 * An intersection is opaque only when every part is (`string & {}` is a string).
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 * @returns {boolean}
 */
function holdsOpaque(checker, type) {
  if (type.isUnion()) return type.types.some((part) => holdsOpaque(checker, part));
  if (isOpaque(checker, type)) return true;
  return elementsOf(checker, type).some((element) => holdsOpaque(checker, element));
}

/**
 * The element types of an array or tuple type; none for any other type.
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 * @returns {readonly import('typescript').Type[]}
 */
function elementsOf(checker, type) {
  if (!checker.isArrayType(type) && !checker.isTupleType(type)) return [];
  return checker.getTypeArguments(/** @type {import('typescript').TypeReference} */ (type));
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
 * @property {(node: import('estree').Node) => boolean} holdsOpaque A value that may be a Date its type does not show
 *   (`unknown`, `any`, `object`, `{}`, a type parameter), or an array or tuple of them.
 * @property {(node: import('estree').Node) => boolean} isDate A Date (or a union holding one), not an array.
 * @property {(node: import('estree').Node) => boolean} isDateConstructor Typed DateConstructor.
 * @property {(node: import('estree').Node) => boolean} numberOrDate A number or a Date and nothing else.
 */

/**
 * Tests on an expression's type, from the parser's type information; null when there is none.
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {TypeTests | null}
 */
export function typeTests(context) {
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
    holdsOpaque: on((type) => holdsOpaque(checker, type)),
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
 * Whether a call reads a value's members by reflection (`Object.getPrototypeOf(x)`, `Reflect.get(x, …)`).
 * @param {import('estree').CallExpression} node
 * @returns {boolean}
 */
function isReflection(node) {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return false;
  const name = propertyName(callee);
  return name !== null && REFLECTION.get(callee.object.name)?.has(name) === true;
}

/**
 * Reports `what` made into text from `node`: as local time when it holds a Date, as possible local time when its
 * type may hide one. Returns whether it reported.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {TypeTests} types
 * @param {import('estree').Node} node The value made into text.
 * @param {import('estree').Node} at Where to report.
 * @param {readonly [string, string]} what The name for a Date and for a value that may be one.
 */
function reportText(context, types, node, at, [date, opaque]) {
  if (types.holdsDate(node)) context.report({ node: at, messageId: 'localTime', data: { name: date } });
  else if (types.holdsOpaque(node))
    context.report({ node: at, messageId: 'localText', data: { name: opaque } });
}

/**
 * Reports text made from a value that may be a Date: `String(x)`, `new String(x)`, `${x}` and `x + …`.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {TypeTests} types
 */
function textListener(context, types) {
  /** @param {import('estree').CallExpression | import('estree').NewExpression} node */
  const stringOf = (node) => {
    const [argument] = node.arguments;
    if (argument === undefined || argument.type === 'SpreadElement') return;
    if (node.callee.type === 'Identifier' && node.callee.name === 'String')
      reportText(context, types, argument, node, ['String(date)', 'String(value)']);
  };
  return {
    stringOf,
    /** @param {import('estree').TemplateLiteral} node */
    TemplateLiteral(node) {
      const parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (node).parent;
      if (parent?.type === 'TaggedTemplateExpression') return;
      for (const expression of node.expressions)
        reportText(context, types, expression, expression, ['a template of a Date', 'a template']);
    },
    /** @param {import('estree').BinaryExpression} node */
    BinaryExpression(node) {
      if (node.operator !== '+' || node.left.type === 'PrivateIdentifier') return;
      for (const side of [node.left, node.right])
        reportText(context, types, side, node, ['+ on a Date', '+']);
    },
  };
}

/**
 * The typed checks: a Date (or a value that may be one) made into text, a Date read with a key that is not written
 * or by reflection, a Date built from anything but a number or a Date, and a DateConstructor value other than the
 * global `Date` (collected into `constructors`; the global ones are told apart at Program:exit, after scope analysis).
 * @param {import('eslint').Rule.RuleContext} context
 * @param {TypeTests} types
 * @param {Set<import('estree').Node>} constructors
 * @returns {import('eslint').Rule.RuleListener}
 */
export function typedListener(context, types, constructors) {
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
  const { stringOf, ...text } = textListener(context, types);
  return {
    ...text,
    ...Object.fromEntries(VALUE_SITE_TYPES.map((type) => [type, sites])),
    'MemberExpression:exit'(node) {
      const name = propertyName(node);
      if (name !== null && TEXT_METHODS.has(name)) {
        const what = name === 'join' ? ['join over Date values', 'join'] : ['toString of a Date', 'toString'];
        reportText(context, types, node.object, node, /** @type {[string, string]} */ (what));
      } else if (node.computed && name === null && types.isDate(node.object)) {
        context.report({ node, messageId: 'dateKey' });
      }
    },
    'CallExpression:exit'(node) {
      stringOf(node);
      const [target] = node.arguments;
      if (
        isReflection(node) &&
        target !== undefined &&
        target.type !== 'SpreadElement' &&
        types.isDate(target)
      )
        context.report({ node, messageId: 'dateReflection' });
    },
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
