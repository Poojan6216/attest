import { AdaptersSection } from './components/AdaptersSection';
import { DangerZone } from './components/DangerZone';
import { EncryptionSection } from './components/EncryptionSection';
import { ExportSection } from './components/ExportSection';
import { GrantsSection } from './components/GrantsSection';
import { ModelSection } from './components/ModelSection';
import { PrivacySection } from './components/PrivacySection';
import { PrivacyStatement } from './components/PrivacyStatement';
import { SectionNav } from './components/SectionNav';

/**
 * Options page shell (Sprint 0). The privacy statement is the first line; sections follow in the order of
 * `SECTIONS`. Features that arrive later say so and show no controls. Grants set what each agent may do (sprint_4
 * 4.4); Adapters turn the page readers off or on and show their health, Privacy sets how long history is kept, Export
 * saves the ledger and the receipts, and the Danger zone deletes everything (sprint_4 4.5). Model turns Chrome's
 * on-device model on or off (sprint_5 5.2). Encryption seals the records with a passphrase (sprint_6 6.5).
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
          <GrantsSection />
          <AdaptersSection />
          <PrivacySection />
          <EncryptionSection />
          <ModelSection />
          <ExportSection />
          <DangerZone />
        </div>
      </main>
    </div>
  );
}
