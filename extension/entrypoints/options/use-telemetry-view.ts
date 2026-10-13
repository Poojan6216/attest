/**
 * The options page's usage numbers, read in order (src/ui/use-ledger-read.ts) on every change its sources announce
 * (../telemetry-preview.ts) and again when the page asks, after its own command (Sprint 5 close, security review SEC-8).
 * `undefined` while reading, `null` when the read failed (logged), `locked` while the ledger is (Sprint 6 close, tech
 * review TECH-8).
 */
import { useCallback, useRef } from 'preact/hooks';

import { log } from '../../src/log';
import { useLedgerRead } from '../../src/ui/use-ledger-read';
import type { TelemetrySources } from './components/TelemetryToggle';
import type { TelemetryView } from './telemetry-preview';

/** What each state of the read shows but `ready`, which shows its value. */
const VIEW_OF: Readonly<Partial<Record<string, null | 'locked'>>> = { failed: null, locked: 'locked' };

const logPreviewFailed = (error: unknown): void => {
  log.warn('options.telemetry_preview_failed', { error });
};

/** The view (header), and how to read it again now. */
export function useTelemetryView(sources: TelemetrySources): {
  readonly view: TelemetryView | null | undefined | 'locked';
  readonly readAgain: () => void;
} {
  // The read's own change callback, kept so the page's command can read again through it.
  const again = useRef<() => void>(() => undefined);
  const subscribe = useCallback(
    (onChange: () => void) => {
      again.current = onChange;
      const off = sources.subscribe(onChange);
      return () => {
        again.current = () => undefined;
        off();
      };
    },
    [sources],
  );
  const read = useLedgerRead(sources.preview, subscribe, logPreviewFailed);
  const view = VIEW_OF[read.status] ?? (read.status === 'ready' ? read.value : undefined);
  return {
    view,
    readAgain: () => {
      again.current();
    },
  };
}
