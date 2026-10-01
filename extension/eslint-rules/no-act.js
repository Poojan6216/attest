/**
 * attest/no-act — Hard Rule 3: Attest never acts on a vendor page; Hard Rule 1: content scripts, adapters and
 * observers never touch the network; Hard Rule 2: they never write the vendor origin's storage.
 *
 * Applied to `entrypoints/content/**`, `src/adapters/**`, `src/observers/**` (see eslint.config.js). There is
 * no allow-list and no escape hatch: those scopes run with `linterOptions.noInlineConfig`.
 *
 * A forbidden name is reported however it is reached: called, referenced, `.call`ed / `.apply`ed / bound,
 * read off a prototype, destructured, or reached through reflection (`Reflect.apply`, `Object.assign`).
 * A call or write through a computed key that is not written in the source (`el[k]()`, `el[k] = v`) is
 * reported too, because it could be any of them. Names and lists live in no-act-names.js.
 */
import {
  ACTION_METHODS,
  ARIA_REFLECTION,
  ASSIGNED_PROPERTIES,
  EVENT_CONSTRUCTORS,
  FETCHING_GLOBALS,
  FETCHING_PROPERTIES,
  MUTATION_METHODS,
  NAVIGATION_METHODS,
  NAVIGATION_OWNERS,
  OWNER_MUTATIONS,
  REFLECTION,
  STORAGE_GLOBALS,
  STORAGE_PROPERTIES,
  ZERO_ARG_ACTION_METHODS,
} from './no-act-names.js';
import { forEachGlobalReference, isDynamicMember, objectName, propertyName } from './scope-globals.js';

/** @typedef {import('eslint').Rule.RuleContext} Context */
/** @typedef {import('estree').Node & { parent?: import('estree').Node }} NodeWithParent */

/** Safe reads on classList/dataset/style that the call check below allows. */
const OWNER_READS = new Set(['contains', 'item', 'getPropertyValue', 'getPropertyPriority']);

/**
 * The verdict for a forbidden name read off `owner` (null when allowed). Shared by member access and
 * destructuring, so `el.click`, `el.click.call(el)` and `const { click } = el` are judged alike.
 * @param {string} name
 * @param {string | null} owner
 * @returns {string | null} messageId
 */
function verdictFor(name, owner) {
  if (FETCHING_PROPERTIES.has(name)) return 'network';
  if (STORAGE_PROPERTIES.has(name) || (name === 'storage' && owner === 'navigator')) return 'storage';
  if (ACTION_METHODS.has(name)) return 'action';
  if (MUTATION_METHODS.has(name)) return 'mutation';
  if (owner !== null && NAVIGATION_OWNERS.has(owner) && NAVIGATION_METHODS.has(name)) return 'navigation';
  if (name === 'open' && (owner === 'window' || owner === 'globalThis' || owner === 'self'))
    return 'navigation';
  if (name === 'open' && owner === 'document') return 'mutation';
  if (owner !== null && OWNER_MUTATIONS.get(owner)?.has(name) === true) return 'mutation';
  if (owner !== null && REFLECTION.get(owner)?.has(name) === true) return 'reflection';
  return null;
}

/** @param {NodeWithParent} node */
function isCallee(node) {
  return node.parent?.type === 'CallExpression' && node.parent.callee === node;
}

/** True when the member is written to: `x.p = v`, `x.p += v`, `x.p++`, `delete x.p`. */
function isWriteTarget(/** @type {NodeWithParent} */ node) {
  const parent = node.parent;
  if (parent?.type === 'AssignmentExpression') return parent.left === node;
  if (parent?.type === 'UpdateExpression') return true;
  return parent?.type === 'UnaryExpression' && parent.operator === 'delete';
}

/** True when the member is used as a function value: `x[k].call(…)`, `.apply`, `.bind`. */
function isInvoked(/** @type {NodeWithParent} */ node) {
  if (isCallee(node)) return true;
  const parent = node.parent;
  const via = parent?.type === 'MemberExpression' && parent.object === node ? propertyName(parent) : null;
  return via === 'call' || via === 'apply' || via === 'bind';
}

/**
 * Zero-argument actions (`node.remove()`) are allowed only as a direct call with arguments
 * (`list.remove(item)`); a zero-argument call or any other reference is reported.
 */
function zeroArgViolation(/** @type {NodeWithParent} */ node) {
  if (!isCallee(node)) return true;
  const call = /** @type {import('estree').CallExpression} */ (node.parent);
  return call.arguments.length === 0;
}

/**
 * @param {Context} context
 * @param {NodeWithParent} node
 */
function checkMember(context, node) {
  if (node.type !== 'MemberExpression') return;
  if (isDynamicMember(node)) {
    if (isInvoked(node) || isWriteTarget(node)) context.report({ node, messageId: 'computed' });
    return;
  }
  const name = propertyName(node);
  if (name === null) return;
  const messageId = verdictFor(name, objectName(node));
  if (messageId !== null) {
    context.report({ node, messageId, data: { name } });
  } else if (ZERO_ARG_ACTION_METHODS.has(name) && zeroArgViolation(node)) {
    context.report({ node, messageId: 'action', data: { name } });
  }
}

/**
 * Calls on classList/dataset/style other than safe reads (`el.classList.forEach`, `el.dataset.x()`), and a
 * bare `open(…)` (window.open).
 * @param {Context} context
 * @param {import('estree').CallExpression} node
 */
function checkCall(context, node) {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    if (callee.name === 'open') context.report({ node, messageId: 'navigation', data: { name: 'open' } });
    return;
  }
  const name = propertyName(callee);
  const owner = objectName(callee);
  if (name === null || (owner !== 'classList' && owner !== 'dataset' && owner !== 'style')) return;
  if (OWNER_READS.has(name) || verdictFor(name, owner) !== null) return;
  context.report({ node, messageId: 'mutation', data: { name: `${owner}.${name}` } });
}

/**
 * Assignments, updates and deletes of page-state properties.
 * @param {Context} context
 * @param {import('estree').Node} node the assignment, update or delete
 * @param {import('estree').Node} target
 */
function checkWrite(context, node, target) {
  if (target.type === 'Identifier' && target.name === 'location') {
    context.report({ node, messageId: 'navigation', data: { name: 'location' } });
    return;
  }
  const name = propertyName(target);
  if (name === null) return;
  const owner = objectName(target);
  const handler = name.startsWith('on') && name.length > 2 && name === name.toLowerCase();
  if (ASSIGNED_PROPERTIES.has(name) || ARIA_REFLECTION.test(name) || handler) {
    context.report({ node, messageId: 'assignment', data: { name } });
  } else if (owner === 'style' || owner === 'dataset') {
    context.report({ node, messageId: 'assignment', data: { name: `${owner}.${name}` } });
  }
}

/**
 * `const { click } = el`, `({ submit } = form)`, `function f({ focus }) {}`.
 * @param {Context} context
 * @param {import('estree').Property & { parent?: import('estree').Node }} node
 */
function checkPatternProperty(context, node) {
  if (node.parent?.type !== 'ObjectPattern') return;
  if (node.computed && !(node.key.type === 'Literal' && typeof node.key.value === 'string')) {
    context.report({ node, messageId: 'computed' });
    return;
  }
  const name =
    node.key.type === 'Identifier'
      ? node.key.name
      : String(/** @type {{ value?: unknown }} */ (node.key).value);
  const pattern = /** @type {NodeWithParent} */ (node.parent);
  const source = pattern.parent?.type === 'VariableDeclarator' ? pattern.parent.init : null;
  const owner = source?.type === 'Identifier' ? source.name : null;
  const messageId = verdictFor(name, owner) ?? (ZERO_ARG_ACTION_METHODS.has(name) ? 'action' : null);
  if (messageId !== null) context.report({ node, messageId, data: { name } });
}

/**
 * Every reference to a global that fetches, runs remote code or reaches the vendor's storage.
 * @param {Context} context
 * @param {import('estree').Program} program
 */
function checkGlobals(context, program) {
  forEachGlobalReference(context, program, FETCHING_GLOBALS, (identifier, name) => {
    context.report({ node: identifier, messageId: 'network', data: { name } });
  });
  forEachGlobalReference(context, program, STORAGE_GLOBALS, (identifier, name) => {
    context.report({ node: identifier, messageId: 'storage', data: { name } });
  });
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid acting on vendor pages (clicks, submits, events, focus, DOM writes, navigation), any network access, and the vendor origin’s storage in content scripts, adapters and observers (Hard Rules 1, 2 and 3).',
    },
    schema: [],
    messages: {
      action: "Attest never acts: '{{name}}' is forbidden here (Hard Rule 3).",
      mutation: "extract() is read-only: DOM mutation '{{name}}' is forbidden here (Hard Rule 3).",
      navigation: "Attest never navigates a vendor page: '{{name}}' is forbidden here (Hard Rule 3).",
      assignment:
        "Attest never writes to the page: assignment to '.{{name}}' is forbidden here (Hard Rule 3).",
      syntheticEvent: "Synthetic events are forbidden here: 'new {{name}}' (Hard Rule 3).",
      network: "Nothing leaves the browser: '{{name}}' is forbidden here (Hard Rule 1).",
      storage:
        "'{{name}}' is the vendor page's storage (or the user's clipboard/cookies): forbidden here (Hard Rules 2 and 3).",
      reflection:
        "'{{name}}' through reflection hides what is called or written: forbidden here (Hard Rule 3).",
      computed:
        'A call or write through a computed key could be any action: write the property name (Hard Rule 3).',
    },
  },
  create(context) {
    return {
      MemberExpression: (node) => {
        checkMember(context, node);
      },
      CallExpression: (node) => {
        checkCall(context, node);
      },
      NewExpression: (node) => {
        if (node.callee.type === 'Identifier' && EVENT_CONSTRUCTORS.has(node.callee.name)) {
          context.report({ node, messageId: 'syntheticEvent', data: { name: node.callee.name } });
        }
      },
      ImportExpression: (node) => {
        context.report({ node, messageId: 'network', data: { name: 'import()' } });
      },
      AssignmentExpression: (node) => {
        checkWrite(context, node, node.left);
      },
      UpdateExpression: (node) => {
        checkWrite(context, node, node.argument);
      },
      UnaryExpression: (node) => {
        if (node.operator === 'delete') checkWrite(context, node, node.argument);
      },
      Property: (node) => {
        checkPatternProperty(context, node);
      },
      'Program:exit': (program) => {
        checkGlobals(context, program);
      },
    };
  },
};

export default rule;
