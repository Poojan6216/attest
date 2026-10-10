// @vitest-environment happy-dom
/**
 * The side panel's grade filter says what an Unasked receipt cannot catch while Unasked is shown (sprint_6 6.9;
 * Decisions [6.9]: the red team's UNASKED evasion, accepted): a timeline with no Unasked receipt is never read as one
 * with no unasked action. With Unasked filtered out, the line goes with it.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TimelineFiltersForm } from '../../../entrypoints/sidepanel/components/TimelineFiltersForm';
import { AgentId } from '../../../src/core/schema';
import type { TimelineFilters } from '../../../src/ui/data';
import { UNASKED_LIMIT } from '../../../src/ui/labels';

const ALL: TimelineFilters = { agents: AgentId.options, from: '2026-10-04', to: '2026-10-10' };
let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

async function show(filters: TimelineFilters): Promise<string> {
  await act(() => {
    render(h(TimelineFiltersForm, { filters, onChange: () => undefined }), root);
  });
  return root.textContent;
}

describe("the timeline's grade filter", () => {
  it('says what an Unasked receipt cannot catch while Unasked is shown, every grade or Unasked alone', async () => {
    expect(UNASKED_LIMIT).toContain('likely Unasked');
    expect(await show(ALL)).toContain(UNASKED_LIMIT);
    expect(await show({ ...ALL, grades: ['UNASKED'] })).toContain(UNASKED_LIMIT);
  });

  it('drops the line with Unasked filtered out', async () => {
    expect(await show({ ...ALL, grades: ['VERIFIED', 'NOT_FOUND'] })).not.toContain(UNASKED_LIMIT);
  });
});
