// @ts-check
/**
 * Lint fences for extension code (Hard Rules 1–3, 10; TECH-2/3/4/6, TECH-V2/V3): which files are in which scope,
 * and what each scope may not import, read or call. Flat config replaces (never merges) a rule's options when a
 * later block sets it, so every no-restricted-* list is built per scope from these pieces, and each block in
 * eslint.config.js sets the whole list. src/core's fences are in core-fences.js. tests/unit/lint/fences*.spec.ts
 * prove each fence through the real config.
 */

/** Extension code: everything that ships. Inline disables have no effect anywhere here (Hard Rules 1–4, 10). */
export const APP = ['src/**', 'entrypoints/**'];

/** Hard Rule 3: no acting, no network, no vendor storage, in anything that runs on a vendor page. */
export const ACT_SCOPES = ['entrypoints/content/**', 'src/adapters/**', 'src/observers/**'];

/** The extractors themselves (`src/adapters/<vendor>/…`): pure over the DOM, no bus, no extension APIs. */
export const EXTRACTOR_SCOPES = ['src/adapters/*/**', 'src/observers/*/**'];

/**
 * The helpers beside each skeleton that extractors import (`src/observers/text.ts`, `types.ts`, `shown.ts`, …):
 * no bus, no extension APIs, and never the skeleton, so no import chain from an extractor reaches the bus (TECH-10).
 * The skeleton itself (`base.ts`) posts to the bus and is the one file of these directories that may.
 */
export const HELPER_SCOPES = ['src/adapters/*.ts', 'src/observers/*.ts'];
export const SKELETON_FILES = ['src/adapters/base.ts', 'src/observers/base.ts'];

/** Files where MV3 listeners are registered. */
export const LISTENER_SCOPES = ['entrypoints/background.ts', 'src/background/**', 'src/bus/**'];

/** Code the service worker bundle runs: it has no DOM (TECH-V3). src/ledger is listed separately below. */
export const WORKER_SCOPES = [
  'entrypoints/background.ts',
  'src/background/**',
  'src/bus/**',
  'src/config.ts',
  'src/setup.ts',
  'src/clock.ts',
  'src/log-vocabulary.ts',
];

/** Dexie is the storage layer; nothing outside the ledger (and crypto, Sprint 6) may import it. Tests may. */
export const DEXIE_ALLOWED = ['src/ledger/**', 'src/crypto/**'];

/**
 * Hard Rule 1: the only files allowed to reach the network, one host each, and only when the user opts in:
 * the telemetry sender (Sprint 5.7) and the bring-your-own-key model provider (Sprint 5.3). Pinned by
 * fences.spec.ts; widening this list is a Decisions.md entry.
 */
export const NETWORK_EXEMPT_FILES = ['src/telemetry/send.ts', 'src/intel/providers/byo.ts'];

export const DEXIE_RESTRICTION = {
  name: 'dexie',
  message: 'Dexie is only imported in src/ledger (and src/crypto). Go through the ledger repos.',
};

/**
 * Extension code runs in Chrome, never Node (TECH-6). TypeScript cannot enforce this on its own: wxt's types
 * pull in vite's, which reference @types/node, so Node globals type-check in every file that imports
 * wxt/utils. These fences close that gap.
 */
export const NODE_IMPORTS = {
  group: [
    'node:*',
    'fs',
    'fs/*',
    'path',
    'os',
    'http',
    'https',
    'net',
    'url',
    'util',
    'stream',
    'buffer',
    'child_process',
    'crypto',
    'worker_threads',
  ],
  message: 'Extension code runs in Chrome: no Node built-ins.',
};
export const NODE_GLOBALS = [
  'Buffer',
  'process',
  'global',
  '__dirname',
  '__filename',
  'require',
  'setImmediate',
  'clearImmediate',
];
export const NODE_TYPE_SYNTAX = [
  {
    selector: "TSQualifiedName[left.name='NodeJS']",
    message: 'Extension code runs in Chrome: no NodeJS types (use ReturnType<typeof setTimeout> etc.).',
  },
];

/** The default for extension code: no Dexie outside the ledger, no Node. */
export const APP_RESTRICTED_IMPORTS = { paths: [DEXIE_RESTRICTION], patterns: [NODE_IMPORTS] };

/** Content scripts reach the ledger only through src/bus (TECH-2, SECURITY-V4). */
export const ACT_RESTRICTED_IMPORTS = {
  paths: [DEXIE_RESTRICTION],
  patterns: [
    NODE_IMPORTS,
    { group: ['dexie/*'], message: 'Code on a vendor page never opens storage (Hard Rule 2).' },
    {
      group: ['wxt/utils/storage', '@wxt-dev/storage'],
      message:
        'Code on a vendor page never uses extension storage: it posts to src/bus only (TECH-10, Hard Rule 2).',
    },
    {
      regex: '(^|/)(ledger|background|crypto|telemetry|intel|ui)(/|$)',
      message:
        'Code on a vendor page posts to src/bus only; it never touches the ledger, worker, crypto, telemetry, model or UI code (Hard Rules 1, 2).',
    },
  ],
};

/**
 * The helpers extractors import (HELPER_SCOPES) are as pure as the extractors: no bus, no extension APIs, and never
 * the skeleton (`base`), which reaches the bus (TECH-10).
 */
export const HELPER_RESTRICTED_IMPORTS = {
  paths: [DEXIE_RESTRICTION, { name: 'wxt/browser', message: 'extract() is pure: no extension APIs.' }],
  patterns: [
    ...ACT_RESTRICTED_IMPORTS.patterns,
    {
      group: ['wxt/*', '@wxt-dev/*', 'webextension-polyfill'],
      message: 'extract() is pure: no extension APIs.',
    },
    { regex: '(^|/)bus(/|$)', message: 'extract() returns data; the content script posts it to the bus.' },
    {
      regex: '(^|/)base$',
      message: 'The skeleton (base) reaches the bus: extractors and their helpers never import it (TECH-10).',
    },
  ],
};

/**
 * Extractors are pure over the DOM: no bus, no extension APIs (tech_reviewer; build_spec §7 contract), not even
 * through the skeleton or its pass planner (`plan`), which only the skeleton runs (TECH-10).
 */
export const EXTRACTOR_RESTRICTED_IMPORTS = {
  paths: HELPER_RESTRICTED_IMPORTS.paths,
  patterns: [
    ...HELPER_RESTRICTED_IMPORTS.patterns,
    {
      regex: '(^|/)plan$',
      message: 'The pass planner is the skeleton’s: an extractor never imports it (TECH-10).',
    },
  ],
};

/**
 * Restricted globals, and the same names read off `window` / `globalThis` / `self` (aliasing them is the
 * same access).
 * @param {readonly string[]} names
 * @param {(name: string) => string} message
 */
export function restrictGlobals(names, message) {
  names = [...new Set(names)];
  return {
    'no-restricted-globals': ['error', ...names.map((name) => ({ name, message: message(name) }))],
    'no-restricted-properties': [
      'error',
      ...names.flatMap((name) =>
        ['window', 'globalThis', 'self'].map((object) => ({
          object,
          property: name,
          message: message(name),
        })),
      ),
    ],
  };
}

/** Web storage: build_spec §5 allows Dexie (IndexedDB) and chrome.storage only (TECH-V2, Hard Rule 2). */
export const WEB_STORAGE = ['localStorage', 'sessionStorage', 'caches', 'cookieStore', 'openDatabase'];
/** No DOM in the MV3 service worker or the modules it shares (TECH-V3, Hard Rule 6). */
export const WORKER_DOM = [
  'window',
  'document',
  'alert',
  'confirm',
  'prompt',
  'XMLHttpRequest',
  'DOMParser',
  'Image',
  'Audio',
  'history',
  'requestAnimationFrame',
  'getComputedStyle',
  'matchMedia',
];

/** @param {{ indexedDB: boolean, console: boolean, dom: boolean }} allow */
export function appGlobals(allow) {
  const names = [
    ...WEB_STORAGE,
    ...NODE_GLOBALS,
    ...(allow.indexedDB ? [] : ['indexedDB']),
    ...(allow.console ? [] : ['console']),
    ...(allow.dom ? [] : WORKER_DOM),
  ];
  return restrictGlobals(names, (name) => {
    if (name === 'console') return 'Log only through src/log.ts (Hard Rule 10).';
    if (name === 'indexedDB') return 'IndexedDB is the ledger: go through src/ledger (Dexie) (Hard Rule 2).';
    if (WEB_STORAGE.includes(name))
      return `'${name}' is not Attest storage: use the ledger or chrome.storage (build_spec §5).`;
    if (NODE_GLOBALS.includes(name)) return `'${name}' is Node: extension code runs in Chrome.`;
    return `'${name}' does not exist in the MV3 service worker (or code it shares).`;
  });
}

/**
 * No ambient declarations in shipped code (PI-2, Hard Rules 1 and 4). `declare const fetch: …` or
 * `declare const Date: DateConstructor` emits nothing, so the name still reads the real global at run time, but it
 * looks local to scope analysis and so to no-restricted-globals. No shipped file has one; tests (the e2e `chrome`
 * declarations) may. scope-globals.js also sees through them, so attest/no-network and attest/core-determinism
 * hold even where this list is not applied.
 */
export const AMBIENT_SYNTAX = [
  'VariableDeclaration[declare=true]',
  'TSDeclareFunction[declare=true]',
  'ClassDeclaration[declare=true]',
  'TSEnumDeclaration[declare=true]',
  'TSModuleDeclaration',
].map((selector) => ({
  selector,
  message:
    'Shipped code declares no globals and no namespaces: an ambient declaration hides the real global from every fence (Hard Rules 1, 4).',
}));

/**
 * Extension storage (`browser.storage`, `chrome.storage`, however reached) is not for code on a vendor page (TECH-10,
 * Hard Rule 2): what a content script learns goes to the service worker through src/bus, which validates it and stores
 * it in the ledger. `navigator.storage` is the vendor's own and attest/no-act refuses it too.
 */
export const EXTENSION_STORAGE_SYNTAX = [
  "MemberExpression[property.name='storage']",
  "MemberExpression[computed=true][property.value='storage']",
  "ObjectPattern > Property[key.name='storage']",
].map((selector) => ({
  selector,
  message:
    'Code on a vendor page never uses extension storage: it posts to the service worker through src/bus (TECH-10, Hard Rule 2).',
}));

/** Runtime messaging only through src/bus (TECH-4, extension_engineer rule 2). */
export const MESSAGING_NAMES =
  'sendMessage|onMessage|onMessageExternal|connect|onConnect|onConnectExternal|connectNative|sendNativeMessage';
export const MESSAGING_SYNTAX = [
  {
    selector: `MemberExpression[property.name=/^(${MESSAGING_NAMES})$/]`,
    message:
      'Runtime messaging goes through src/bus (send, listen, query), never ad hoc (extension_engineer rule 2).',
  },
  {
    selector: `MemberExpression[computed=true][property.value=/^(${MESSAGING_NAMES})$/]`,
    message:
      'Runtime messaging goes through src/bus (send, listen, query), never ad hoc (extension_engineer rule 2).',
  },
];
