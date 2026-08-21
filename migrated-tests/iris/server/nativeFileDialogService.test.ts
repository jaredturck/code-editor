import { describe, expect, it } from 'vitest';
import { buildNativeFileDialogFilters } from '../../server/desktopBridge/services/nativeFileDialogService';

describe('native file dialog filters', () => {
  it('uses human-readable filters for mixed Chat attachments', () => {
    expect(buildNativeFileDialogFilters(['image/*', '.txt', '.md', '.js', '.ts', '.json'])).toEqual(
      [
        {
          name: 'Supported files',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'md', 'js', 'ts', 'json'],
        },
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        },
        {
          name: 'Text files',
          extensions: ['txt', 'md', 'js', 'ts', 'json'],
        },
      ],
    );
  });

  it('labels an image-only picker as Images instead of Allowed', () => {
    expect(buildNativeFileDialogFilters(['image/*'])).toEqual([
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      },
    ]);
  });
});
