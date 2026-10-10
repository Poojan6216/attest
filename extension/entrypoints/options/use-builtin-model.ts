/**
 * Chrome's on-device model as the options page sees it (sprint_5 5.2, 5.4; src/intel/providers/builtin.ts): whether
 * this Chrome has the Prompt API at all, known when the page opens without calling it; its availability, read only
 * when the person asks (`check`) and again after a download they started; and the download, which Chrome starts only in
 * answer to a click. Chrome logs a console warning each time a page asks while its model service is not running
 * (Chromium 153, Decisions [5.4]), so the page never asks on its own. A failed download is said and logged (Hard
 * Rule 6).
 */
import { useCallback, useState } from 'preact/hooks';

import {
  type BuiltinAvailability,
  builtinAvailability,
  downloadBuiltin,
  type PromptApi,
  promptApi,
} from '../../src/intel/providers/builtin';
import { log } from '../../src/log';

export type DownloadState =
  | { readonly status: 'idle' }
  | { readonly status: 'downloading'; readonly loaded: number }
  | { readonly status: 'failed' };

export interface BuiltinModel {
  /** `no_api` at once where this Chrome has no Prompt API; otherwise null until the person asks. */
  readonly availability: BuiltinAvailability | null;
  /** Whether Chrome is being asked now. */
  readonly checking: boolean;
  /** Asks Chrome whether it can run its model here (header). */
  readonly check: () => void;
  readonly download: DownloadState;
  readonly startDownload: () => void;
}

/** The page's own Prompt API when no other is given. */
export const PAGE_PROMPT_API = (): PromptApi | null => promptApi();

export function useBuiltinModel(api: () => PromptApi | null = PAGE_PROMPT_API): BuiltinModel {
  const [availability, setAvailability] = useState<BuiltinAvailability | null>(() =>
    api() === null ? 'no_api' : null,
  );
  const [checking, setChecking] = useState(false);
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' });
  const check = useCallback(() => {
    setChecking(true);
    void builtinAvailability(api()).then((said) => {
      setAvailability(said);
      setChecking(false);
    });
  }, [api]);
  const startDownload = useCallback(() => {
    const prompt = api();
    if (prompt === null) return;
    setDownload({ status: 'downloading', loaded: 0 });
    downloadBuiltin(prompt, (loaded) => {
      setDownload({ status: 'downloading', loaded });
    }).then(
      () => {
        setDownload({ status: 'idle' });
        check();
      },
      (error: unknown) => {
        log.warn('options.model_download_failed', { error });
        setDownload({ status: 'failed' });
        check();
      },
    );
  }, [api, check]);
  return { availability, checking, check, download, startDownload };
}
