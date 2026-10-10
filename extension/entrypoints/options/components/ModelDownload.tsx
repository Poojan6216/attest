import { Button } from '../../../src/ui/Button';
import type { BuiltinModelToggleProps } from './BuiltinModelToggle';

/** The download a person may start with a click, its progress, and its failure. */
export function ModelDownload({
  download,
  startDownload,
}: Pick<BuiltinModelToggleProps, 'download' | 'startDownload'>) {
  return (
    <>
      <Button variant="secondary" disabled={download.status === 'downloading'} onClick={startDownload}>
        Download Chrome’s on-device model
      </Button>
      {download.status === 'downloading' ? (
        <p role="status" class="text-sm">
          Chrome is downloading its model: {Math.round(download.loaded * 100)}% so far.
        </p>
      ) : null}
      {download.status === 'failed' ? (
        <p role="alert" class="text-sm text-error-fg">
          Chrome did not download its model. Try again later.
        </p>
      ) : null}
    </>
  );
}
