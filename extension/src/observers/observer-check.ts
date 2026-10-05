/**
 * The observer contract, checked when a content script starts (sprint_2 2.0; build_spec §7; ./types.ts). Kept apart
 * from ./base.ts, which reaches the bus, so the check itself needs nothing but the contract and src/core.
 */
import { OBSERVER_HOSTS } from '../config';
import { ComponentId, ObservationSource } from '../core/schema';
import { ObserverError } from './errors';
import type { Observer } from './types';

const OBSERVER_HOST_SET: ReadonlySet<string> = new Set(Object.values(OBSERVER_HOSTS).flat());

function hostsAreOurs(hosts: unknown): boolean {
  if (!Array.isArray(hosts) || hosts.length === 0) return false;
  return hosts.every((host: unknown) => typeof host === 'string' && OBSERVER_HOST_SET.has(host));
}

const isFunction = (value: unknown): boolean => typeof value === 'function';

/** Exactly one window reader: `visibleWindow` or `visibleWindows`, a function, the other absent. */
function oneWindowReader(observer: Observer): boolean {
  const { visibleWindow: one, visibleWindows: many } = observer;
  return one === undefined ? isFunction(many) : many === undefined && isFunction(one);
}

/** `allCalendars` and `snapshot` are Calendar facts: absent, or functions of a `gcal.event` observer. */
function calendarHooksFit(observer: Observer): boolean {
  const hooks = [observer.allCalendars, observer.snapshot].filter((hook) => hook !== undefined);
  return hooks.length === 0 || (observer.source === 'gcal.event' && hooks.every(isFunction));
}

/** An attribute name the watcher can filter on: a name, never a selector or a value. */
const ATTRIBUTE_NAME = /^[A-Za-z_][\w:.-]*$/;

/** `attributes` is absent, or a list of attribute names (./types.ts). */
function attributesFit(attributes: unknown): boolean {
  if (attributes === undefined) return true;
  return (
    Array.isArray(attributes) &&
    attributes.every((name) => typeof name === 'string' && ATTRIBUTE_NAME.test(name))
  );
}

/**
 * Throws `ObserverError('invalid_observer')` unless the observer's id, vendor and version are ComponentId tokens,
 * its source is an ObservationSource, its hosts are a non-empty subset of OBSERVER_HOSTS (Hard Rule 8), its
 * `health`, `extract` and `account` are functions, it has exactly one window reader, only a `gcal.event` observer
 * has `allCalendars` or `snapshot`, and its `attributes`, if any, are attribute names. A bad definition is a
 * developer error and fails loud at start, before any page is read.
 */
export function assertObserver(observer: Observer): void {
  const tokens = [observer.id, observer.vendor, observer.version];
  const valid =
    tokens.every((token) => ComponentId.safeParse(token).success) &&
    ObservationSource.safeParse(observer.source).success &&
    hostsAreOurs(observer.hosts) &&
    [observer.health, observer.extract, observer.account].every(isFunction) &&
    oneWindowReader(observer) &&
    calendarHooksFit(observer) &&
    attributesFit(observer.attributes);
  if (!valid) throw new ObserverError('invalid_observer');
}
