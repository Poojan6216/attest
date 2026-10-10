// @vitest-environment happy-dom
/**
 * The development page that checks Chrome's on-device model (entrypoints/model-check; sprint_5 5.2): where Chrome
 * has its model, one click scores the ten check claims through the grading's own provider and call, and lists each
 * claim's parsed scores, and another records the bench's answers (5.5); where it has none, the buttons are disabled and
 * the page says so. Over a stand-in Prompt API
 * (./stand-in.ts); the real model is checked by a person (MANUAL.md). Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelCheck } from '../../../entrypoints/model-check/App';
import { setLogSink } from '../../../src/log';
import { scoringAll, standIn } from './stand-in';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  setLogSink(() => undefined);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('the model check page', () => {
  it('scores the ten check claims and lists each one’s parsed scores', async () => {
    const stand = standIn('available');
    stand.answer = scoringAll(0.5);
    await act(() => {
      render(h(ModelCheck, { api: () => stand.api }), root);
    });
    await settle();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Chrome’s on-device model: available.');
    await act(() => {
      root.querySelector('button')?.click();
    });
    await settle();
    const rows = [...root.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.includes(' 0.5') && !row.includes('No answer'))).toBe(true);
  });

  it('records the bench’s answers, then offers the recording to save (sprint_5 5.5)', async () => {
    const stand = standIn('available');
    stand.answer = scoringAll(0.5);
    await act(() => {
      render(h(ModelCheck, { api: () => stand.api }), root);
    });
    await settle();
    const button = (name: string) =>
      [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
    expect(button('Save the recording')).toBeUndefined();
    await act(() => {
      button('Record the bench’s answers')?.click();
    });
    await settle();
    const statuses = [...root.querySelectorAll('[role="status"]')].map((p) => p.textContent);
    expect(statuses).toContain('Asked 16 of 16 bench inputs.');
    expect(button('Save the recording')).toBeDefined();
  });

  it('cannot run without a model, and says so', async () => {
    await act(() => {
      render(h(ModelCheck, { api: () => null }), root);
    });
    await settle();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Chrome’s on-device model: no_api.');
    expect([...root.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });
});
