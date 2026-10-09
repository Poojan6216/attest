/**
 * The digest page's reads (sprint_4 4.7): the weeks that have a digest, newest first, and the chosen week's digest,
 * read from this page's own connection to the ledger (src/ledger/digest.ts), and again when the service worker
 * announces a new one (`ledger.changed`: digests). The page shows what was stored and computes nothing. A read that
 * fails is said and logged (Hard Rule 6).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';

import { digestWeeks, getDigest } from '../../src/ledger/digest';
import { getLedger } from '../../src/ledger/shared';
import type { DigestRecord } from '../../src/ledger/types';
import { log } from '../../src/log';
import { onLedgerChanged } from '../../src/ui/data';

export interface DigestSources {
  readonly weeks: () => Promise<string[]>;
  readonly digest: (week: string) => Promise<DigestRecord | undefined>;
  /** Calls `onChange` when a digest may have been added; returns how to stop. */
  readonly subscribe: (onChange: () => void) => () => void;
}

export const LIVE_DIGESTS: DigestSources = {
  weeks: async () => digestWeeks(await getLedger()),
  digest: async (week) => getDigest(await getLedger(), week),
  subscribe: (onChange) => onLedgerChanged(['digests'], onChange),
};

export type DigestState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready';
      readonly weeks: readonly string[];
      /** The week shown: the newest unless the person chose another; null when there is no digest yet. */
      readonly week: string | null;
      readonly digest: DigestRecord | undefined;
    };

export function useDigests(sources: DigestSources = LIVE_DIGESTS): {
  readonly state: DigestState;
  readonly choose: (week: string) => void;
} {
  const [state, setState] = useState<DigestState>({ status: 'loading' });
  const [chosen, choose] = useState<string | null>(null);
  const read = useMemo(
    () => () => {
      sources
        .weeks()
        .then(async (weeks) => {
          const week = chosen !== null && weeks.includes(chosen) ? chosen : (weeks[0] ?? null);
          const digest = week === null ? undefined : await sources.digest(week);
          setState({ status: 'ready', weeks, week, digest });
        })
        .catch((error: unknown) => {
          log.error('digest.read_failed', { error });
          setState({ status: 'failed' });
        });
    },
    [sources, chosen],
  );
  useEffect(() => {
    read();
    return sources.subscribe(read);
  }, [read, sources]);
  return { state, choose };
}
