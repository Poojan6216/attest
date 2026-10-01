/**
 * The names attest/no-act forbids in code that runs on a vendor page (Hard Rules 1, 2, 3). Data only; the
 * rule is in no-act.js. Every list is reported on any member access (called, aliased, `.call`ed, bound,
 * destructured), not only on a direct call.
 */
import { NETWORK_GLOBALS, NETWORK_PROPERTIES } from './scope-globals.js';

/** Methods that perform a user-like action, change focus, selection or page state, or talk to page scripts. */
export const ACTION_METHODS = new Set([
  'click',
  'submit',
  'requestSubmit',
  'reset',
  'dispatchEvent',
  'focus',
  'blur',
  'execCommand',
  'setRangeText',
  'setSelectionRange',
  'showPicker',
  'showModal',
  'show',
  'close',
  'stop',
  'print',
  'animate',
  'showPopover',
  'hidePopover',
  'togglePopover',
  'requestFullscreen',
  'requestPointerLock',
  'postMessage',
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
export const MUTATION_METHODS = new Set([
  'appendChild',
  'removeChild',
  'insertBefore',
  'replaceChild',
  'replaceChildren',
  'replaceWith',
  'append',
  'prepend',
  'before',
  'after',
  'insertAdjacentHTML',
  'insertAdjacentElement',
  'insertAdjacentText',
  'setAttribute',
  'setAttributeNS',
  'setAttributeNode',
  'setAttributeNodeNS',
  'removeAttribute',
  'removeAttributeNS',
  'removeAttributeNode',
  'toggleAttribute',
  'attachShadow',
  'setHTMLUnsafe',
  'setHTML',
  'insertNode',
  'surroundContents',
  'deleteContents',
  'extractContents',
  'appendData',
  'insertData',
  'deleteData',
  'replaceData',
  'splitText',
  'adoptNode',
  'write',
  'writeln',
]);

/** Navigation, reported when read from `history` or `location` (the names are too common elsewhere). */
export const NAVIGATION_METHODS = new Set([
  'pushState',
  'replaceState',
  'back',
  'forward',
  'go',
  'reload',
  'assign',
  'replace',
]);
export const NAVIGATION_OWNERS = new Set(['history', 'location']);

/** Calls that act only with zero arguments (`input.select()`, `node.remove()`, `node.normalize()`). */
export const ZERO_ARG_ACTION_METHODS = new Set(['select', 'remove', 'normalize']);

/** Mutating methods of `classList` / `style`, reported however they are reached. */
export const OWNER_MUTATIONS = new Map([
  ['classList', new Set(['add', 'remove', 'toggle', 'replace'])],
  ['style', new Set(['setProperty', 'removeProperty'])],
]);

/** Properties whose assignment changes what the user sees, submits, or what the page loads. */
export const ASSIGNED_PROPERTIES = new Set([
  'value',
  'valueAsDate',
  'valueAsNumber',
  'defaultValue',
  'defaultChecked',
  'defaultSelected',
  'checked',
  'indeterminate',
  'selected',
  'selectedIndex',
  'files',
  'innerHTML',
  'outerHTML',
  'innerText',
  'outerText',
  'textContent',
  'nodeValue',
  'data',
  'src',
  'srcset',
  'srcdoc',
  'poster',
  'background',
  'ping',
  'href',
  'action',
  'formAction',
  'formMethod',
  'method',
  'target',
  'type',
  'download',
  'rel',
  'scrollTop',
  'scrollLeft',
  'location',
  'cookie',
  'hidden',
  'disabled',
  'readOnly',
  'required',
  'placeholder',
  'className',
  'id',
  'title',
  'name',
  'slot',
  'dir',
  'lang',
  'role',
  'open',
  'popover',
  'inert',
  'draggable',
  'autofocus',
  'accessKey',
  'tabIndex',
  'contentEditable',
  'designMode',
]);

/** `aria*` reflection properties (`el.ariaChecked = 'true'`). */
export const ARIA_REFLECTION = /^aria[A-Z]/;

/** Synthetic event constructors: the first half of every dispatch. */
export const EVENT_CONSTRUCTORS = new Set([
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

/** Globals that fetch or run code from a URL: the network list plus workers and media. */
export const FETCHING_GLOBALS = new Set([...NETWORK_GLOBALS, 'Worker', 'SharedWorker', 'Audio']);
export const FETCHING_PROPERTIES = new Set([...NETWORK_PROPERTIES, 'serviceWorker']);

/**
 * The vendor origin's storage (a content script's localStorage is the vendor's, readable by its scripts) and
 * the user's clipboard and cookies. `storage` only counts when read from `navigator` (`browser.storage` is ours).
 */
export const STORAGE_GLOBALS = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'cookieStore',
  'openDatabase',
]);
export const STORAGE_PROPERTIES = new Set([...STORAGE_GLOBALS, 'clipboard', 'cookie']);

/** Writes and calls through reflection, which hide the property name from the other checks. */
export const REFLECTION = new Map([
  ['Reflect', new Set(['set', 'defineProperty', 'deleteProperty', 'apply', 'construct', 'setPrototypeOf'])],
  ['Object', new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])],
]);
