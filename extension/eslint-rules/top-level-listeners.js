/**
 * attest/top-level-listeners — MV3 service workers only receive events for listeners registered
 * synchronously during the worker's first turn. A listener added inside an async function, a callback, or
 * another listener is silently dropped after the worker restarts (extension_engineer checklist).
 *
 * Registrations: `*.addListener(...)`, `*.addEventListener(...)` / `addEventListener(...)`, and the bus's
 * `listen(...)`. One is reported when any enclosing function
 *  - is async or a generator;
 *  - is passed as an argument to a call (a callback: `.then`, `setTimeout`, `storage.get(k, cb)`, another
 *    `addListener`, …), unless the callee is a known synchronous invoker (`forEach`, `map`, `defineBackground`…);
 *  - is a named function (or a function stored in a variable) that is itself passed as a callback anywhere in
 *    the file (`onStartup.addListener(later)`), found by scope analysis.
 * An IIFE and the `defineBackground({ main() {} })` method form are synchronous and stay valid.
 */

/** Callees that run their function argument synchronously, before they return. */
const SYNCHRONOUS_INVOKERS = new Set([
  'defineBackground',
  // `new Promise(executor)` runs the executor before the constructor returns.
  'Promise',
  'forEach',
  'map',
  'filter',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'reduce',
  'reduceRight',
]);

/** @typedef {import('estree').Node & { parent?: import('estree').Node }} NodeWithParent */

/** @param {import('estree').Node} callee */
function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return '(computed)';
}

/**
 * The callee a node is handed to as a callback argument (null when it is not one, or the callee runs it
 * synchronously).
 * @param {NodeWithParent} node
 */
function deferringCallee(node) {
  const parent = node.parent;
  if (parent?.type !== 'CallExpression' && parent?.type !== 'NewExpression') return null;
  if (!parent.arguments.includes(/** @type {never} */ (node))) return null;
  const name = calleeName(parent.callee);
  return SYNCHRONOUS_INVOKERS.has(name) ? null : name;
}

/**
 * The variable a function is bound to: `function later() {}` or `const later = () => {}`.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {NodeWithParent} fn
 */
function boundVariable(context, fn) {
  if (fn.type === 'FunctionDeclaration' && fn.id) {
    return context.sourceCode.getDeclaredVariables(fn).find((v) => v.name === fn.id?.name) ?? null;
  }
  const parent = fn.parent;
  if (parent?.type === 'VariableDeclarator' && parent.init === fn && parent.id.type === 'Identifier') {
    return context.sourceCode.getDeclaredVariables(parent)[0] ?? null;
  }
  return null;
}

/**
 * Why a function defers what runs inside it, or null.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {NodeWithParent & { async?: boolean, generator?: boolean }} fn
 * @returns {{ messageId: 'async' } | { messageId: 'deferred', callee: string } | null}
 */
function deferral(context, fn) {
  if (fn.async === true || fn.generator === true) return { messageId: 'async' };
  const direct = deferringCallee(fn);
  if (direct !== null) return { messageId: 'deferred', callee: direct };
  const variable = boundVariable(context, fn);
  for (const reference of variable?.references ?? []) {
    const callee = deferringCallee(/** @type {NodeWithParent} */ (reference.identifier));
    if (callee !== null) return { messageId: 'deferred', callee };
  }
  return null;
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require service-worker event listeners to be registered synchronously at startup (MV3).',
    },
    schema: [],
    messages: {
      async:
        'Listener registered inside an async function; MV3 drops it after a worker restart. Register it synchronously in main().',
      deferred:
        "Listener registered inside a '{{callee}}' callback; MV3 drops it after a worker restart. Register it synchronously in main().",
    },
  },
  create(context) {
    return {
      'CallExpression[callee.property.name=/^(addListener|addEventListener)$/], CallExpression[callee.type="Identifier"][callee.name=/^(listen|addEventListener)$/]'(
        node,
      ) {
        for (const ancestor of context.sourceCode.getAncestors(node)) {
          if (!FUNCTION_TYPES.has(ancestor.type)) continue;
          const found = deferral(context, ancestor);
          if (found === null) continue;
          if (found.messageId === 'async') context.report({ node, messageId: 'async' });
          else context.report({ node, messageId: 'deferred', data: { callee: found.callee } });
          return;
        }
      },
    };
  },
};

export default rule;
