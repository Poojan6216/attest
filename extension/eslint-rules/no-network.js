/**
 * attest/no-network — Hard Rule 1: nothing leaves the browser.
 *
 * Applied to all of `src/**` and `entrypoints/**` (with noInlineConfig). Reports every reference to a network
 * global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`,
 * `importScripts`): calls, `new`, aliasing, passing as a value; and every member access that reaches one
 * (`window.fetch`, `globalThis['WebSocket']`, `navigator.sendBeacon`), called or not.
 *
 * The only exemptions are the two files build_spec allows to talk to one host each, listed in
 * eslint.config.js (NETWORK_EXEMPT_FILES) and pinned by tests/unit/lint/fences.spec.ts.
 */
import {
  forEachGlobalReference,
  NETWORK_GLOBALS,
  NETWORK_PROPERTIES,
  propertyName,
} from './scope-globals.js';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid every network API outside the two exempt files (Hard Rule 1).' },
    schema: [],
    messages: {
      network: "Nothing leaves the browser: '{{name}}' is forbidden here (Hard Rule 1).",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name !== null && NETWORK_PROPERTIES.has(name)) {
          context.report({ node, messageId: 'network', data: { name } });
        }
      },
      'Program:exit'(program) {
        forEachGlobalReference(context, program, NETWORK_GLOBALS, (identifier, name) => {
          context.report({ node: identifier, messageId: 'network', data: { name } });
        });
      },
    };
  },
};

export default rule;
