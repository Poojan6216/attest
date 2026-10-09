import { importClaims } from '../../src/bus/send';
import { nowIso } from '../../src/clock';
import { IsoTs } from '../../src/core/schema';
import { browserOffsetAt } from '../../src/observers/time-zone';
import { AddActivity } from './components/AddActivity';
import type { ImportClaims, PasteClock } from './use-paste-flow';

/** The paste instant and the browser's zone: the side panel's own clock (src/clock.ts). */
const CLOCK: PasteClock = { now: () => IsoTs.parse(nowIso()), offsetAt: browserOffsetAt };

/** Sends the claims, never the text, to the service worker (`claims.import`, sprint_3 3.13). */
export const sendImport: ImportClaims = async (agent, claims) => {
  const result = await importClaims(agent, claims);
  return result.ok ? { ok: true, received: result.received, added: result.added } : { ok: false };
};

export function App() {
  return (
    <main class="min-h-screen p-4 text-sm text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <h1 class="text-base font-semibold">Attest timeline</h1>
      <p class="mt-1 text-neutral-600 dark:text-neutral-300">Nothing leaves your browser.</p>
      <div class="mt-4">
        <AddActivity clock={CLOCK} onImport={sendImport} />
      </div>
      <p class="mt-4 text-neutral-600 dark:text-neutral-300">
        The timeline of receipts comes in a later version. The options page exports them now.
      </p>
    </main>
  );
}
