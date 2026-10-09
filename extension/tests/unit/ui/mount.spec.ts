// @vitest-environment happy-dom
/**
 * src/ui/mount.ts: every surface mounts the same way, and a page without `#app` fails loudly (TECH-13,
 * Hard Rule 6) instead of showing a blank popup with nothing in the log.
 */
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type LogRecord, setLogSink } from '../../../src/log';
import { mount, ROOT_ELEMENT_ID, type Surface } from '../../../src/ui/mount';

let records: LogRecord[] = [];
let restoreSink: () => void = () => undefined;

beforeEach(() => {
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
  document.body.innerHTML = '';
});

afterEach(() => {
  restoreSink();
});

const Hello = () => h('p', null, 'hello');

describe('mount', () => {
  it.each<Surface>(['popup', 'sidepanel', 'options', 'dev'])('%s renders into #app', (surface) => {
    const root = document.createElement('div');
    root.id = ROOT_ELEMENT_ID;
    document.body.append(root);

    expect(mount(Hello, surface)).toBe(true);

    expect(root.textContent).toBe('hello');
    expect(records).toEqual([]);
  });

  it.each<Surface>(['popup', 'sidepanel', 'options', 'dev'])(
    '%s without #app logs ui.root_missing',
    (surface) => {
      expect(mount(Hello, surface)).toBe(false);

      expect(records).toEqual([{ level: 'error', event: 'ui.root_missing', fields: { surface } }]);
    },
  );
});
