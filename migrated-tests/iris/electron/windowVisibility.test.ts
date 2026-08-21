/**
 * Verifies that workspace panels are restored and shown without using the focus-stealing
 * BrowserWindow show/focus path.
 */

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { showWorkspaceInactive } = require('../../electron/windowVisibility.cjs') as {
  showWorkspaceInactive: (win: {
    isMinimized: () => boolean;
    restore: () => void;
    showInactive: () => void;
  }) => void;
};

describe('workspace window visibility', () => {
  it('shows a hidden workspace without taking keyboard focus', () => {
    const restore = vi.fn();
    const showInactive = vi.fn();

    showWorkspaceInactive({
      isMinimized: () => false,
      restore,
      showInactive,
    });

    expect(restore).not.toHaveBeenCalled();
    expect(showInactive).toHaveBeenCalledTimes(1);
  });

  it('restores a minimized workspace before showing it inactive', () => {
    const calls: string[] = [];

    showWorkspaceInactive({
      isMinimized: () => true,
      restore: () => calls.push('restore'),
      showInactive: () => calls.push('showInactive'),
    });

    expect(calls).toEqual(['restore', 'showInactive']);
  });
});
