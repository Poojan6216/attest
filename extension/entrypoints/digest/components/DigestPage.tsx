import { EmptyState } from '../../../src/ui/EmptyState';
import { Skeleton } from '../../../src/ui/Skeleton';
import { type DigestSources, LIVE_DIGESTS, useDigests } from '../use-digests';
import { DigestView } from './DigestView';
import type { ShareTools } from './ShareDigest';
import { WeekPicker } from './WeekPicker';
import type { PrivacySources } from '../../../src/ui/privacy-data';
import { PrivacyLine } from '../../../src/ui/PrivacyLine';

export interface DigestPageProps {
  /** Where the page reads; the ledger when absent. */
  readonly sources?: DigestSources;
  readonly nowMs?: () => number;
  /** The share's clipboard and image drawing: the page's own when absent (src/ui/SharePreview.tsx). */
  readonly share?: ShareTools;
  /** Where the privacy line reads the person's choices; the ledger and storage when absent. */
  readonly privacy?: PrivacySources;
}

/**
 * The weekly digest page (sprint_4 4.7): the privacy line, the chosen week (the newest by default; every kept week can
 * be read again), or, before the first Monday, what will come and when.
 */
export function DigestPage({
  sources = LIVE_DIGESTS,
  nowMs = Date.now,
  share = {},
  privacy,
}: DigestPageProps) {
  const { state, choose } = useDigests(sources);
  return (
    <main class="mx-auto max-w-3xl space-y-6 p-gutter text-sm">
      <header>
        <h1 class="text-xl font-semibold">Attest weekly digest</h1>
        <PrivacyLine sources={privacy} class="mt-1 text-ink-muted" />
      </header>
      {state.status === 'loading' ? <Skeleton rows={4} label="Loading the digest" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its digests. Reload the page.
        </p>
      ) : null}
      {state.status === 'ready' && state.week === null ? (
        <EmptyState title="No digest yet">
          Attest makes your first weekly digest on Monday at 09:00, from the week before.
        </EmptyState>
      ) : null}
      {state.status === 'ready' && state.week !== null && state.weeks.length > 1 ? (
        <WeekPicker weeks={state.weeks} week={state.week} onChoose={choose} />
      ) : null}
      {state.status === 'ready' && state.digest !== undefined ? (
        <DigestView digest={state.digest} nowMs={nowMs()} share={share} />
      ) : null}
    </main>
  );
}
