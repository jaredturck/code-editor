/** Loads and reuses bridge-generated image or video thumbnails for visible file tiles. */

import { useEffect, useState } from 'react';
import { getFileThumbnail } from '@/platform/desktopBridge';

const MAX_THUMBNAIL_CACHE_ENTRIES = 256;
const thumbnailCache = new Map<string, string>();

function rememberThumbnail(key: string, dataUrl: string): void {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, dataUrl);
  while (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
    const oldest = thumbnailCache.keys().next().value;
    if (!oldest) break;
    thumbnailCache.delete(oldest);
  }
}

export function useFileThumbnail(
  path: string,
  modifiedAt: number,
  enabled: boolean,
  width = 240,
  height = 240,
) {
  const key = `${path}\u0000${modifiedAt}\u0000${width}x${height}`;
  const [dataUrl, setDataUrl] = useState(() => thumbnailCache.get(key) || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      setDataUrl('');
      setError('');
      return;
    }
    const cached = thumbnailCache.get(key);
    if (cached) {
      setDataUrl(cached);
      setError('');
      return;
    }
    let active = true;
    setDataUrl('');
    setError('');
    void getFileThumbnail(path, width, height, true)
      .then((result) => {
        if (!active) return;
        rememberThumbnail(key, result.dataUrl);
        setDataUrl(result.dataUrl);
      })
      .catch((thumbnailError: unknown) => {
        if (!active) return;
        setError((thumbnailError as { message?: string }).message || 'Preview unavailable');
      });
    return () => {
      active = false;
    };
  }, [enabled, height, key, path, width]);

  return { dataUrl, error };
}
