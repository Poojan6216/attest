/**
 * Shared helpers for Attest's lint rules: property names of member expressions, and every reference to a
 * global (by scope analysis, so calls, `new`, aliasing and passing as a value are all seen).
 */

/**
 * The property a member expression names, when it is written in the source (`a.b`, `a['b']`, a`b`), else null.
 * @param {import('estree').Node} node
 * @returns {string | null}
 */
export function propertyName(node) {
  if (node.type !== 'MemberExpression') return null;
  const property = node.property;
  if (!node.computed && property.type === 'Identifier') return property.name;
  if (!node.computed) return null;
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/**
 * The name of the object a member expression is read from (`history` in `history.back`, `classList` in
 * `el.classList.add`), else null.
 * @param {import('estree').Node} node
 * @returns {string | null}
 */
export function objectName(node) {
  if (node.type !== 'MemberExpression') return null;
  const object = node.object;
  if (object.type === 'Identifier') return object.name;
  return propertyName(object);
}

/**
 * True for a computed member whose key is not written in the source (`el[k]`, `el['cl' + 'ick']`).
 * @param {import('estree').Node} node
 */
export function isDynamicMember(node) {
  return node.type === 'MemberExpression' && node.computed && propertyName(node) === null;
}

/**
 * Calls `report(identifier, name)` once for every value reference to a global named in `names`: undeclared
 * globals appear in the global scope's `through`; typescript-eslint also declares DOM lib globals (fetch,
 * WebSocket, …) as global-scope variables without definitions, so their references count too. Type-only
 * references (`let d: Date`) are skipped.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('estree').Node} program
 * @param {ReadonlySet<string>} names
 * @param {(identifier: import('estree').Identifier, name: string) => void} report
 */
export function forEachGlobalReference(context, program, names, report) {
  const globalScope = context.sourceCode.getScope(program);
  const seen = new Set();
  /** @param {import('eslint').Scope.Reference} reference */
  const visit = (reference) => {
    const identifier = reference.identifier;
    if (seen.has(identifier) || !names.has(identifier.name)) return;
    if (/** @type {{ isValueReference?: boolean }} */ (reference).isValueReference === false) return;
    seen.add(identifier);
    report(/** @type {import('estree').Identifier} */ (identifier), identifier.name);
  };
  for (const reference of globalScope.through) visit(reference);
  for (const variable of globalScope.variables) {
    if (!names.has(variable.name) || variable.defs.length > 0) continue;
    for (const reference of variable.references) visit(reference);
  }
}

/** Globals that open a network channel (Hard Rule 1). */
export const NETWORK_GLOBALS = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
  'RTCPeerConnection',
  'importScripts',
]);

/** Member names that reach the network however they are reached (`window.fetch`, `navigator.sendBeacon`). */
export const NETWORK_PROPERTIES = new Set([...NETWORK_GLOBALS, 'sendBeacon']);
