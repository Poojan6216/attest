import { importClaims } from '../../src/bus/send';
import { nowIso } from '../../src/clock';
import { IsoTs } from '../../src/core/schema';
import { browserOffsetAt } from '../../src/observers/time-zone';
import { AddActivity } from './components/AddActivity';
import { SidePanel } from './components/SidePanel';
import type { ImportClaims, PasteClock } from './use-paste-flow';

/** The paste instant and the browser's zone: the side panel's own clock (src/clock.ts). */
const CLOCK: PasteClock = { now: () => IsoTs.parse(nowIso()), offsetAt: browserOffsetAt };

/** Sends the claims, never the text, to the service worker (`claims.import`, sprint_3 3.13). */
export const sendImport: ImportClaims = async (agent, claims, activeAt) => {
  const result = await importClaims(agent, claims, activeAt);
  return result.ok ? { ok: true, received: result.received, added: result.added } : { ok: false };
};

/** The side panel's root: the timeline (sprint_4 4.3) with Add agent activity (sprint_3 3.12) above it. */
export function App() {
  return (
    <SidePanel>
      <AddActivity clock={CLOCK} onImport={sendImport} />
    </SidePanel>
  );
}
