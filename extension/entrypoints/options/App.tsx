import { AdaptersSection } from './components/AdaptersSection';
import { DangerZone } from './components/DangerZone';
import { ExportSection } from './components/ExportSection';
import { PrivacySection } from './components/PrivacySection';
import { PrivacyStatement } from './components/PrivacyStatement';
import { SectionNav } from './components/SectionNav';
import { StubSection } from './components/StubSection';

/**
 * Options page shell (Sprint 0). The privacy statement is the first line; sections follow in the order of
 * `SECTIONS`. Features that arrive later say so and show no controls. Export saves the ledger (Sprint 2 close); the
 * Adapters section says which page readers run and why the agent ones are off (sprint_3 3.10).
 */
export function App() {
  return (
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <main id="main" aria-labelledby="page-title">
        <PrivacyStatement />
        <h1 id="page-title" class="mt-8 text-2xl font-semibold tracking-tight">
          Attest settings
        </h1>
        <SectionNav />
        <div class="mt-6 space-y-6">
          <StubSection
            id="grants"
            summary="Set what each agent may do: which actions, which recipients, and how much it may spend."
          />
          <AdaptersSection />
          <PrivacySection />
          <StubSection
            id="model"
            summary="An optional model can suggest which items might match. It never decides a grade, and it is off by default."
          />
          <ExportSection />
          <DangerZone />
        </div>
      </main>
    </div>
  );
}
