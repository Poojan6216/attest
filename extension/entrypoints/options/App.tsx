import { DangerZone } from './components/DangerZone';
import { PrivacySection } from './components/PrivacySection';
import { PrivacyStatement } from './components/PrivacyStatement';
import { SectionNav } from './components/SectionNav';
import { StubSection } from './components/StubSection';

/**
 * Options page shell (Sprint 0). The privacy statement is the first line; sections follow in the order of
 * `SECTIONS`. Features that arrive later say so and show no controls.
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
          <StubSection
            id="adapters"
            summary="See which agent pages and which Gmail and Calendar readers are working, and which need repair after a site changes."
          />
          <PrivacySection />
          <StubSection
            id="model"
            summary="An optional model can suggest which items might match. It never decides a grade, and it is off by default."
          />
          <StubSection id="export" summary="Save your receipts and their evidence as JSON or CSV." />
          <DangerZone />
        </div>
      </main>
    </div>
  );
}
