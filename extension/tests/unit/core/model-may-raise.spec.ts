/**
 * Which receipts the model may still change (Sprint 5 close, tech review TECH-9; src/core/model-raise.ts
 * `modelMayRaise`; docs/grading.md §5.4, §8): a PARTIAL still PENDING, read from the grade and the state, never from
 * the policy's rule ids. Every other grade, and every receipt no longer PENDING, is never asked about.
 */
import { describe, expect, it } from 'vitest';

import { modelMayRaise } from '../../../src/core/model-raise';
import { Grade, ReceiptState } from '../../../src/core/schema-enums';

describe('modelMayRaise', () => {
  it('is true for a PARTIAL still PENDING, and for nothing else', () => {
    for (const grade of Grade.options)
      for (const state of ReceiptState.options)
        expect(modelMayRaise({ grade, state }), `${grade} ${state}`).toBe(
          grade === 'PARTIAL' && state === 'PENDING',
        );
  });
});
