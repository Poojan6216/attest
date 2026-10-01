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
  ],
});
