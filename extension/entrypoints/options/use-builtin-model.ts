/**
 * Chrome's on-device model as the options page sees it (sprint_5 5.2; src/intel/providers/builtin.ts): its
 * availability, read when the section opens and again after a download, and the download a person may start with a
 * click (Chrome downloads its model only in answer to one). A failed download is said and logged (Hard Rule 6).
 */
import { useCallback, useEffect, useState } from 'preact/hooks';

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
  /** Null while it is being read. */
  readonly availability: BuiltinAvailability | null;
  readonly download: DownloadState;
  readonly startDownload: () => void;
}

/** The page's own Prompt API when no other is given. */
export const PAGE_PROMPT_API = (): PromptApi | null => promptApi();

export function useBuiltinModel(api: () => PromptApi | null = PAGE_PROMPT_API): BuiltinModel {
  const [availability, setAvailability] = useState<BuiltinAvailability | null>(null);
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' });
  const read = useCallback(() => {
    void builtinAvailability(api()).then(setAvailability);
  }, [api]);
  useEffect(read, [read]);
  const startDownload = useCallback(() => {
    const prompt = api();
    if (prompt === null) return;
    setDownload({ status: 'downloading', loaded: 0 });
    downloadBuiltin(prompt, (loaded) => {
      setDownload({ status: 'downloading', loaded });
    }).then(
      () => {
        setDownload({ status: 'idle' });
        read();
      },
      (error: unknown) => {
        log.warn('options.model_download_failed', { error });
        setDownload({ status: 'failed' });
        read();
      },
    );
  }, [api, read]);
  return { availability, download, startDownload };
}
