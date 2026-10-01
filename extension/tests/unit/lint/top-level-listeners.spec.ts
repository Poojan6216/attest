import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import topLevelListeners from '../../../eslint-rules/top-level-listeners.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } });

tester.run('attest/top-level-listeners', topLevelListeners, {
  valid: [
    'chrome.runtime.onMessage.addListener(onMessage);',
    'function main() { chrome.alarms.onAlarm.addListener(onAlarm); } main();',
    'export default defineBackground({ main() { browser.runtime.onInstalled.addListener(onInstalled); } });',
    // An async handler is fine; registering inside one is not.
    'chrome.runtime.onMessage.addListener(async (message) => { await handle(message); });',
    'function main() { listen(createHandlers()); }',
    // Synchronous invokers and IIFEs run before main() returns.
    'function main() { [a, b].forEach((e) => e.addListener(onEvent)); }',
    '(() => { chrome.runtime.onMessage.addListener(onMessage); })();',
    'const register = () => chrome.alarms.onAlarm.addListener(onAlarm); function main() { register(); }',
    'export default defineBackground(() => { browser.runtime.onStartup.addListener(onStartup); });',
    'new Promise((resolve) => { chrome.runtime.onMessage.addListener(onMessage); resolve(); });',
    "self.addEventListener('message', onMessage);",
  ],
  invalid: [
    {
      code: 'async function main() { await ready(); listen(handlers); }',
      errors: [{ messageId: 'async' }],
    },
    {
      code: 'boot().then(() => listen(handlers));',
      errors: [{ messageId: 'deferred', data: { callee: 'then' } }],
    },
    {
      code: 'async function init() { chrome.runtime.onMessage.addListener(onMessage); }',
      errors: [{ messageId: 'async' }],
    },
    {
      code: 'const init = async () => { await load(); chrome.alarms.onAlarm.addListener(onAlarm); };',
      errors: [{ messageId: 'async' }],
    },
    {
      code: 'load().then(() => { chrome.runtime.onMessage.addListener(onMessage); });',
      errors: [{ messageId: 'deferred', data: { callee: 'then' } }],
    },
    {
      code: 'setTimeout(() => chrome.runtime.onMessage.addListener(onMessage), 0);',
      errors: [{ messageId: 'deferred', data: { callee: 'setTimeout' } }],
    },
    {
      code: 'queueMicrotask(function () { chrome.storage.onChanged.addListener(onChanged); });',
      errors: [{ messageId: 'deferred', data: { callee: 'queueMicrotask' } }],
    },
    // TECH-5: listeners inside other listeners, Chrome callback APIs, and named functions passed as callbacks.
    {
      code: 'chrome.runtime.onInstalled.addListener(() => { chrome.runtime.onMessage.addListener(onMessage); });',
      errors: [{ messageId: 'deferred', data: { callee: 'addListener' } }],
    },
    {
      code: 'function later() { chrome.alarms.onAlarm.addListener(onAlarm); } chrome.runtime.onStartup.addListener(later);',
      errors: [{ messageId: 'deferred', data: { callee: 'addListener' } }],
    },
    {
      code: 'const later = () => { listen(handlers); }; boot.then(later);',
      errors: [{ messageId: 'deferred', data: { callee: 'then' } }],
    },
    {
      code: "chrome.storage.local.get('x', () => { listen(handlers); });",
      errors: [{ messageId: 'deferred', data: { callee: 'get' } }],
    },
    {
      code: "Promise.resolve().then(() => { self.addEventListener('message', onMessage); });",
      errors: [{ messageId: 'deferred', data: { callee: 'then' } }],
    },
    {
      code: "fetchSomething(function () { addEventListener('message', onMessage); });",
      errors: [{ messageId: 'deferred', data: { callee: 'fetchSomething' } }],
    },
  ],
});
