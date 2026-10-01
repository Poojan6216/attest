/**
 * attest/top-level-listeners — MV3 service workers only receive events for listeners registered
 * synchronously during the worker's first turn. A listener added inside an async function or a
 * promise/timer callback is silently dropped after the worker restarts (extension_engineer checklist).
 *
 * Reports `*.addListener(...)` and the bus's `listen(...)` when any enclosing function is async, a
 * generator, or a callback passed to then/catch/finally/setTimeout/setInterval/queueMicrotask/
 * requestIdleCallback.
 */

const DEFERRING_CALLEES = new Set([
  'then',
  'catch',
  'finally',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestIdleCallback',
  'requestAnimationFrame',
]);

/** @param {import('estree').Node} fn */
function deferringCallee(fn) {
  const parent = /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (fn).parent;
  if (!parent || parent.type !== 'CallExpression' || !parent.arguments.includes(/** @type {never} */ (fn))) {
    return null;
  }
  const callee = parent.callee;
  if (callee.type === 'Identifier' && DEFERRING_CALLEES.has(callee.name)) return callee.name;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    DEFERRING_CALLEES.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return null;
}

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
      // `x.addListener(...)` and the bus's own `listen(...)`, which registers runtime.onMessage.
      'CallExpression[callee.type="MemberExpression"][callee.property.name="addListener"], CallExpression[callee.type="Identifier"][callee.name="listen"]'(
        node,
      ) {
        for (const ancestor of context.sourceCode.getAncestors(node)) {
          if (
            ancestor.type !== 'FunctionDeclaration' &&
            ancestor.type !== 'FunctionExpression' &&
            ancestor.type !== 'ArrowFunctionExpression'
          ) {
            continue;
          }
          if (ancestor.async || ancestor.generator) {
            context.report({ node, messageId: 'async' });
            return;
          }
          const callee = deferringCallee(ancestor);
          if (callee !== null) {
            context.report({ node, messageId: 'deferred', data: { callee } });
            return;
          }
        }
      },
    };
  },
};

export default rule;
