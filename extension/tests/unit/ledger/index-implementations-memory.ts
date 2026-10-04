/**
 * The memory half of tests/unit/ledger/index-implementations.ts, and the whole of it in the poisoned run
 * (vitest.poison.config.ts aliases that module here). The Dexie index does I/O by design (src/ledger, over
 * fake-indexeddb); under the runtime guard its calls would be charged to src/core's `candidates()`, which reaches it
 * through the injected `ObservationIndex`. The guard checks src/core, so its run uses the memory index, and the main
 * suite runs every candidate test against both implementations (Sprint 2.6).
 */
import { createMemoryIndex } from '../../../src/core/candidates';
import type { ObservationIndex } from '../../../src/core/candidates';
import type { Observation } from '../../../src/core/schema';

export interface IndexImplementation {
  readonly name: 'memory' | 'dexie';
  readonly createIndex: (observations: readonly Observation[], bucketMinutes: number) => ObservationIndex;
  readonly held: (observations: readonly Observation[]) => Observation[];
  /** Whether the index can hold and return rows the strict schema rejects (the "corrupt index" tests). */
  readonly returnsUnparsedRows: boolean;
  /** Whether `createIndex` reads `bucketMinutes` (and refuses a bad one). */
  readonly bucketed: boolean;
}

export const MEMORY_INDEX: IndexImplementation = {
  name: 'memory',
  createIndex: createMemoryIndex,
  held: (observations) => [...observations],
  returnsUnparsedRows: true,
  bucketed: true,
};

/** The poisoned run's implementations: the memory index only (see the header). */
export const INDEX_IMPLEMENTATIONS: readonly IndexImplementation[] = [MEMORY_INDEX];
