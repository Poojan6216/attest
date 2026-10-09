/**
 * A share's image (sprint_4 4.8; ./share-png.ts), drawn when the markdown is shown, in the page's own light or dark, and
 * its object URL released when the share closes. A page that cannot draw it says so (`failed`, logged).
 */
import { useEffect, useState } from 'preact/hooks';

import { log } from '../log';
import type { ShareTheme } from './share-png';

export type ShareImage = { readonly blob: Blob; readonly url: string } | 'drawing' | 'failed';

const pageTheme = (): ShareTheme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function useShareImage(
  markdown: string,
  makeImage: (markdown: string, theme: ShareTheme) => Promise<Blob>,
): ShareImage {
  const [image, setImage] = useState<ShareImage>('drawing');
  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    setImage('drawing');
    makeImage(markdown, pageTheme()).then(
      (blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      },
      (error: unknown) => {
        log.warn('share.image_failed', { error });
        if (alive) setImage('failed');
      },
    );
    return () => {
      alive = false;
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [markdown, makeImage]);
  return image;
}
