import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import noAct from '../../../eslint-rules/no-act.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } });

const invalid = (code: string, messageId: string) => ({ code, errors: [{ messageId }] });

tester.run('attest/no-act', noAct, {
  valid: [
    // Reading the page is the whole job.
    'const rows = document.querySelectorAll(\'[role="row"]\');',
    "const text = row.textContent; const label = el.getAttribute('aria-label');",
    'const style = getComputedStyle(el); const box = el.getBoundingClientRect();',
    "el.classList.contains('x');",
    // Listening is not acting (Sprint 3.5), as long as no handler calls preventDefault.
    "document.addEventListener('visibilitychange', onVisible, { passive: true });",
    // Posting to our own bus is not the network.
    "chrome.runtime.sendMessage({ type: 'coverage.ping' });",
    // A locally declared function named fetch is not the network global.
    'function fetchRows(doc) { return doc.rows; } fetchRows(document);',
    'const select = (doc, q) => doc.querySelector(q); select(document, "main");',
    'list.remove(item);',
  ],
  invalid: [
    invalid('button.click();', 'action'),
    invalid('form.submit();', 'action'),
    invalid('form.requestSubmit();', 'action'),
    {
      code: "el.dispatchEvent(new Event('input'));",
      errors: [{ messageId: 'action' }, { messageId: 'syntheticEvent' }],
    },
    invalid('el.dispatchEvent(prebuilt);', 'action'),
    invalid('input.focus();', 'action'),
    invalid('input.blur();', 'action'),
    invalid("document.execCommand('insertText', false, 'x');", 'action'),
    invalid('event.preventDefault();', 'action'),
    invalid('event.stopPropagation();', 'action'),
    invalid('row.scrollIntoView();', 'action'),
    invalid('window.scrollTo(0, 100);', 'action'),
    invalid('input.select();', 'action'),
    invalid('node.remove();', 'action'),
    invalid('parent.appendChild(child);', 'mutation'),
    invalid("el.setAttribute('aria-checked', 'true');", 'mutation'),
    invalid("el.insertAdjacentHTML('beforeend', '<b>x</b>');", 'mutation'),
    invalid("el.classList.add('x');", 'mutation'),
    invalid("el.style.setProperty('display', 'none');", 'mutation'),
    invalid("input.value = 'hello';", 'assignment'),
    invalid('box.checked = true;', 'assignment'),
    invalid("el.innerHTML = '<b>x</b>';", 'assignment'),
    invalid("el.textContent = 'x';", 'assignment'),
    invalid("link.href = 'https://example.com';", 'assignment'),
    invalid("el.style.display = 'none';", 'assignment'),
    invalid('el.onclick = handler;', 'assignment'),
    invalid("location = 'https://example.com';", 'navigation'),
    invalid("history.pushState({}, '', '/x');", 'navigation'),
    invalid("location.assign('/x');", 'navigation'),
    invalid("location.replace('/x');", 'navigation'),
    invalid("window.open('https://example.com');", 'navigation'),
    invalid("open('https://example.com');", 'navigation'),
    invalid("new MouseEvent('click');", 'syntheticEvent'),
    invalid("new KeyboardEvent('keydown', { key: 'Enter' });", 'syntheticEvent'),
    invalid("new CustomEvent('x');", 'syntheticEvent'),
    invalid("fetch('https://example.com');", 'network'),
    invalid('const f = fetch;', 'network'),
    invalid('new XMLHttpRequest();', 'network'),
    invalid("new WebSocket('wss://example.com');", 'network'),
    invalid("new EventSource('/events');", 'network'),
    invalid("importScripts('https://example.com/x.js');", 'network'),
    {
      code: "window.fetch('https://example.com');",
      errors: [{ messageId: 'network' }],
    },
    {
      code: "navigator.sendBeacon('https://example.com', 'x');",
      errors: [{ messageId: 'network' }],
    },
    {
      code: 'globalThis.XMLHttpRequest;',
      errors: [{ messageId: 'network' }],
    },
  ],
});
