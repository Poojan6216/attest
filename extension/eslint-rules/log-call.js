/**
 * attest/log-call — Hard Rule 10: every `log.<level>(event, fields)` call is written so a reviewer can see
 * exactly what it prints.
 *
 *  - `event` is a string literal (src/log.ts types it as a LogEvent from the closed vocabulary);
 *  - `fields`, when present, is an object literal (or a `cond ? {…} : {…}` of object literals) whose keys
 *    are all written in the source: no computed keys, no spreads, no variable holding the object.
 *
 * So a key can never carry data (a name, a token, a passphrase); src/log.ts still sanitises keys and values
 * at runtime as a second line. Applied to src/** and entrypoints/** with noInlineConfig.
 */

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/** @param {import('estree').Node} node */
function isLogCall(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'log' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    LEVELS.has(callee.property.name)
  );
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('estree').Node} node
 */
function checkFields(context, node) {
  if (node.type === 'ConditionalExpression') {
    checkFields(context, node.consequent);
    checkFields(context, node.alternate);
    return;
  }
  if (node.type !== 'ObjectExpression') {
    context.report({ node, messageId: 'fieldsLiteral' });
    return;
  }
  for (const property of node.properties) {
    if (property.type === 'SpreadElement') {
      context.report({ node: property, messageId: 'spread' });
    } else if (property.computed) {
      context.report({ node: property, messageId: 'computedKey' });
    } else if (property.key.type !== 'Identifier' && property.key.type !== 'Literal') {
      context.report({ node: property, messageId: 'computedKey' });
    }
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require log calls to name a literal event and literal field keys, so no key can carry content (Hard Rule 10).',
    },
    schema: [],
    messages: {
      eventLiteral: 'The log event must be a string literal from src/log-vocabulary.ts (Hard Rule 10).',
      fieldsLiteral:
        'Log fields must be an object literal written here, not a variable or call result (Hard Rule 10).',
      computedKey:
        'Log field keys must be written in the source; computed keys are forbidden (Hard Rule 10).',
      spread: 'Spreading into log fields is forbidden: every key must be written here (Hard Rule 10).',
      arity: 'log.<level>() takes an event and at most one fields object.',
      computedLevel: "Call the logger as log.debug/info/warn/error, never through 'log[…]'.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isLogCall(node)) return;
        const [event, fields, ...rest] = node.arguments;
        if (rest.length > 0) context.report({ node, messageId: 'arity' });
        if (event === undefined || event.type !== 'Literal' || typeof event.value !== 'string') {
          context.report({ node: event ?? node, messageId: 'eventLiteral' });
        }
        if (fields !== undefined) checkFields(context, fields);
      },
      MemberExpression(node) {
        if (node.object.type === 'Identifier' && node.object.name === 'log' && node.computed) {
          context.report({ node, messageId: 'computedLevel' });
        }
      },
    };
  },
};

export default rule;
