/**
 * RuleTester cases for attest/no-network (Hard Rule 1), attest/log-call (Hard Rule 10) and
 * attest/core-determinism (Hard Rule 4). Added when Sprint 0 closed (SECURITY-5, TECH-3, QA-2, TECH-V1).
 */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import coreDeterminism from '../../../eslint-rules/core-determinism.js';
import logCall from '../../../eslint-rules/log-call.js';
import noNetwork from '../../../eslint-rules/no-network.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } });
const tsTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', parser: tseslint.parser },
});

const invalid = (code: string, messageId: string) => ({ code, errors: [{ messageId }] });

tester.run('attest/no-network', noNetwork, {
  valid: [
    "chrome.runtime.sendMessage({ type: 'ui.query' });",
    'function fetchRows(doc) { return doc.rows; } fetchRows(document);',
    'const fetch = (x) => x; fetch(1);',
  ],
  invalid: [
    invalid("fetch('https://example.com/');", 'network'),
    invalid('const f = fetch; f(1);', 'network'),
    invalid('new XMLHttpRequest();', 'network'),
    invalid("new WebSocket('wss://example.com/');", 'network'),
    invalid("new EventSource('/e');", 'network'),
    invalid("new WebTransport('https://x');", 'network'),
    invalid('new RTCPeerConnection();', 'network'),
    invalid("importScripts('https://x/a.js');", 'network'),
    invalid("navigator.sendBeacon('https://x', 'y');", 'network'),
    invalid("window.fetch('https://x');", 'network'),
    invalid("globalThis['fetch']('https://x');", 'network'),
    invalid("self.fetch('https://x');", 'network'),
    invalid('const send = navigator.sendBeacon;', 'network'),
    invalid('register(fetch);', 'network'),
  ],
});

// A `declare` emits nothing: the name still reads the real global, so it is still reported (PI-2).
tsTester.run('attest/no-network through ambient declarations', noNetwork, {
  valid: ['const fetch = (x: string) => x; fetch("1");'],
  invalid: [
    invalid("declare const fetch: (u: string) => Promise<unknown>; fetch('https://x');", 'network'),
    invalid("declare function fetch(u: string): Promise<unknown>; fetch('https://x');", 'network'),
    invalid(
      "declare global { const WebSocket: new (u: string) => object } new WebSocket('wss://x');",
      'network',
    ),
    invalid('declare let XMLHttpRequest: new () => object; const X = XMLHttpRequest; new X();', 'network'),
  ],
});

tester.run('attest/log-call', logCall, {
  valid: [
    "log.info('background.started');",
    "log.warn('bus.dropped', { reason, type });",
    "log.warn('bus.dropped', type === undefined ? { reason } : { reason, type });",
    "log.error('install.failed', { error, 'quoted': 1 });",
    'other.info(anything, fields);',
  ],
  invalid: [
    invalid('log.info(eventName);', 'eventLiteral'),
    invalid('log.info(`bus.${x}`);', 'eventLiteral'),
    invalid("log.info('bus.dropped', fields);", 'fieldsLiteral'),
    invalid("log.info('bus.dropped', make());", 'fieldsLiteral'),
    invalid("log.info('bus.dropped', { [secret]: 1 });", 'computedKey'),
    invalid("log.info('bus.dropped', { ['reason']: 1 });", 'computedKey'),
    invalid("log.info('bus.dropped', { ...row });", 'spread'),
    invalid("log.info('bus.dropped', ok ? { reason } : fields);", 'fieldsLiteral'),
    invalid("log.info('bus.dropped', { reason }, extra);", 'arity'),
    invalid("log[level]('bus.dropped');", 'computedLevel'),
  ],
});

tsTester.run('attest/core-determinism', coreDeterminism, {
  valid: [
    'export const t = (iso: string) => new Date(iso).getTime();',
    'export const u = Date.UTC(2026, 9, 1);',
    'export const h = (d: Date) => d.getUTCHours();',
    'export const isDate = (x: unknown) => x instanceof Date;',
    'export const m = Math.max(1, 2) + Math.floor(1.5);',
    'export const sorted = (a: string[]) => [...a].sort();',
    'export const d = (ms: number) => new Date(ms);',
    'const Date = { now: () => 1 }; export const t = Date.now();',
    "export const g = (o: object, k: string) => [Reflect.get(o, 'code'), Reflect.get(o, k), Reflect.has(o, k)];",
    'export const p = (o: object) => Object.getPrototypeOf(o) === Object.prototype && o instanceof Object;',
    'const Reflect = { apply: () => 1 }; export const a = Reflect.apply();',
  ],
  invalid: [
    invalid('declare const Date: DateConstructor; export const t = Date.now();', 'date'),
    invalid('declare const Date: DateConstructor; const D = Date; D.now();', 'date'),
    invalid('declare const Math: { random(): number }; export const r = Math.random();', 'math'),
    invalid('declare global { const Math: { random(): number } } export const r = Math.random();', 'math'),
    invalid('const none: [] = []; export const t = new Date(...none);', 'date'),
    invalid('export const t = (y: number, m: number) => new Date(y, m);', 'date'),
    invalid("export const t = new Date('2026-01-01T00:00:00');", 'dateArgument'),
    invalid('export const t = new Date(`2026-01-01`);', 'dateArgument'),
    invalid('export const t = Date.now();', 'date'),
    invalid('export const p = Date.parse(s);', 'date'),
    invalid('export const t = new Date();', 'date'),
    invalid('export const t = Date();', 'date'),
    invalid('const { now } = Date; now();', 'date'),
    invalid('const D = Date; D.now();', 'date'),
    {
      code: 'Reflect.apply(Date.now, Date, []);',
      errors: [{ messageId: 'reflect' }, { messageId: 'date' }, { messageId: 'date' }],
    },
    invalid('const R = Reflect; R.get(o, k);', 'reflect'),
    invalid('export const n = Object.getOwnPropertyNames(o);', 'reflect'),
    invalid("export const g = Reflect.get(o, 'getTimezone' + 'Offset');", 'reflectKey'),
    invalid("export const g = Reflect.get(o, 'getTimezoneOffset');", 'localTime'),
    {
      code: "Reflect.get(Date, 'now');",
      errors: [{ messageId: 'date' }],
    },
    invalid("export const t = Date['now']();", 'date'),
    invalid('export const r = Math.random();', 'math'),
    invalid('const r = Math.random; r();', 'math'),
    invalid('const { random } = Math; random();', 'math'),
    invalid("export const r = Math['random']();", 'math'),
    invalid('export const r = Math[k]();', 'math'),
    invalid('use(Math);', 'math'),
    invalid('export const h = new Date(s).getHours();', 'localTime'),
    invalid('export const o = new Date(s).getTimezoneOffset();', 'localTime'),
    invalid('export const d = new Date(s).toDateString();', 'localTime'),
    invalid('export const s = new Date(s).toLocaleDateString();', 'locale'),
    invalid('export const c = a.localeCompare(b);', 'locale'),
    invalid('export const u = a.toLocaleUpperCase();', 'locale'),
  ],
});
