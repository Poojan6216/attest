/**
 * attest/no-act — Hard Rule 3: Attest never acts on a vendor page, and (Hard Rule 1) content
 * scripts, adapters and observers never touch the network.
 *
 * Applied to `entrypoints/content/**`, `src/adapters/**`, `src/observers/**` (see eslint.config.js).
 * There is no allow-list and no escape hatch: those scopes run with `linterOptions.noInlineConfig`,
 * so an `eslint-disable` comment there has no effect and is itself reported (with --max-warnings 0).
 */

/** Methods that perform a user-like action, change focus/selection, or alter the page's behaviour. */
const ACTION_METHODS = new Set([
  'click',
  'submit',
  'requestSubmit',
  'dispatchEvent',
  'focus',
  'blur',
  'execCommand',
  'setRangeText',
  'setSelectionRange',
  'showPicker',
  'showModal',
  'preventDefault',
  'stopPropagation',
  'stopImmediatePropagation',
  'scrollIntoView',
  'scrollIntoViewIfNeeded',
  'scroll',
  'scrollTo',
  'scrollBy',
  'createEvent',
  'initEvent',
  'initMouseEvent',
  'initKeyboardEvent',
]);

/** Methods that mutate the vendor DOM. extract() is pure over the DOM (adapter_engineer rule 4). */
const MUTATION_METHODS = new Set([
  'appendChild',
  'removeChild',
  'insertBefore',
  'replaceChild',
  'replaceChildren',
  'replaceWith',
  'insertAdjacentHTML',
  'insertAdjacentElement',
  'insertAdjacentText',
  'setAttribute',
  'setAttributeNS',
  'setAttributeNode',
  'removeAttribute',
  'removeAttributeNS',
  'toggleAttribute',
  'attachShadow',
  'setHTMLUnsafe',
]);

/** Navigation away from or within the vendor page. */
const NAVIGATION_METHODS = new Set([
  'pushState',
  'replaceState',
  'back',
  'forward',
  'go',
  'reload',
  'assign',
]);

/** Zero-argument calls that act on an element (`input.select()`, `el.remove()`). */
const ZERO_ARG_ACTION_METHODS = new Set(['select', 'remove']);

/** Properties whose assignment changes what the user sees or submits. */
const ASSIGNED_PROPERTIES = new Set([
  'value',
  'valueAsDate',
  'valueAsNumber',
  'defaultValue',
  'checked',
  'selected',
  'selectedIndex',
  'innerHTML',
  'outerHTML',
  'innerText',
  'outerText',
  'textContent',
  'nodeValue',
  'src',
  'href',
  'action',
  'scrollTop',
  'scrollLeft',
  'location',
  'cookie',
  'hidden',
  'disabled',
]);

/** Constructors for synthetic events (the first half of every dispatch) and network channels. */
const EVENT_CONSTRUCTORS = new Set([
  'Event',
  'CustomEvent',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'InputEvent',
  'FocusEvent',
  'SubmitEvent',
  'TouchEvent',
  'WheelEvent',
  'DragEvent',
  'ClipboardEvent',
  'CompositionEvent',
]);

const NETWORK_IDENTIFIERS = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
  'RTCPeerConnection',
  'importScripts',
]);

/** @param {import('estree').Node} node */
function propertyName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return null;
}

/** @param {import('estree').Node} node */
function objectName(node) {
  if (node.type !== 'MemberExpression') return null;
  const object = node.object;
  if (object.type === 'Identifier') return object.name;
  return propertyName(object);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid acting on vendor pages (clicks, submits, events, focus, DOM writes, navigation) and any network access in content scripts, adapters and observers (Hard Rules 1 and 3).',
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
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Identifier') {
          // Network globals are reported once, via scope analysis in Program:exit.
          if (callee.name === 'open') {
            context.report({ node, messageId: 'navigation', data: { name: 'open' } });
          }
          return;
        }
        const name = propertyName(callee);
        if (name === null) return;
        const owner = objectName(callee);
        if (ACTION_METHODS.has(name)) {
          context.report({ node, messageId: 'action', data: { name } });
        } else if (MUTATION_METHODS.has(name)) {
          context.report({ node, messageId: 'mutation', data: { name } });
        } else if (ZERO_ARG_ACTION_METHODS.has(name) && node.arguments.length === 0) {
          context.report({ node, messageId: 'action', data: { name } });
        } else if (owner === 'classList' || owner === 'dataset' || owner === 'style') {
          if (name !== 'contains' && name !== 'item' && name !== 'getPropertyValue') {
            context.report({ node, messageId: 'mutation', data: { name: `${owner}.${name}` } });
          }
        } else if (name === 'open' && (owner === 'window' || owner === 'globalThis' || owner === 'self')) {
          context.report({ node, messageId: 'navigation', data: { name: `${owner}.open` } });
        } else if (NAVIGATION_METHODS.has(name) && (owner === 'history' || owner === 'location')) {
          context.report({ node, messageId: 'navigation', data: { name: `${owner}.${name}` } });
        } else if (name === 'replace' && owner === 'location') {
          context.report({ node, messageId: 'navigation', data: { name: 'location.replace' } });
        }
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        const name = node.callee.name;
        if (EVENT_CONSTRUCTORS.has(name)) {
          context.report({ node, messageId: 'syntheticEvent', data: { name } });
        }
      },
      AssignmentExpression(node) {
        const target = node.left;
        if (target.type === 'Identifier' && target.name === 'location') {
          context.report({ node, messageId: 'navigation', data: { name: 'location' } });
          return;
        }
        const name = propertyName(target);
        if (name === null) return;
        const owner = objectName(target);
        if (ASSIGNED_PROPERTIES.has(name)) {
          context.report({ node, messageId: 'assignment', data: { name } });
        } else if (owner === 'style' || owner === 'dataset') {
          context.report({ node, messageId: 'assignment', data: { name: `${owner}.${name}` } });
        } else if (name.startsWith('on') && name.length > 2 && name === name.toLowerCase()) {
          // el.onclick = … installs a handler that can change page behaviour.
          context.report({ node, messageId: 'assignment', data: { name } });
        }
      },
      MemberExpression(node) {
        // window.fetch, globalThis.XMLHttpRequest, navigator.sendBeacon — called or merely referenced.
        const name = propertyName(node);
        if (name !== null && (NETWORK_IDENTIFIERS.has(name) || name === 'sendBeacon')) {
          context.report({ node, messageId: 'network', data: { name } });
        }
      },
      'Program:exit'(node) {
        // Any reference to a network global that is not declared locally: calls, `new`, aliasing.
        // Undeclared globals appear in `through`; typescript-eslint also declares DOM lib globals
        // (fetch, WebSocket, …) as global-scope variables, so check their references too.
        const globalScope = context.sourceCode.getScope(node);
        const seen = new Set();
        const report = (identifier) => {
          if (seen.has(identifier)) return;
          seen.add(identifier);
          context.report({ node: identifier, messageId: 'network', data: { name: identifier.name } });
        };
        for (const reference of globalScope.through) {
          if (NETWORK_IDENTIFIERS.has(reference.identifier.name)) report(reference.identifier);
        }
        for (const variable of globalScope.variables) {
          if (!NETWORK_IDENTIFIERS.has(variable.name) || variable.defs.length > 0) continue;
          for (const reference of variable.references) report(reference.identifier);
        }
      },
    };
  },
};

export default rule;
