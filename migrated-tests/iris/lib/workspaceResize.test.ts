/**
 * Verifies workspace resize geometry for each edge family, including preservation of the
 * opposite edge when minimum dimensions are reached.
 */

import { describe, expect, it } from 'vitest';
import {
  computeWorkspaceResizeBounds,
  WORKSPACE_MIN_HEIGHT,
  WORKSPACE_MIN_WIDTH,
} from '@/platform/workspaceResize';

const initial = { x: 100, y: 80, width: 900, height: 640 };

describe('workspaceResize', () => {
  it('grows from the east and south edges', () => {
    expect(computeWorkspaceResizeBounds(initial, 'se', 120, 70)).toEqual({
      x: 100,
      y: 80,
      width: 1020,
      height: 710,
    });
  });

  it('moves the origin while resizing from the north-west corner', () => {
    expect(computeWorkspaceResizeBounds(initial, 'nw', 50, 30)).toEqual({
      x: 150,
      y: 110,
      width: 850,
      height: 610,
    });
  });

  it('preserves the opposite edge when clamping west to the minimum width', () => {
    const resized = computeWorkspaceResizeBounds(initial, 'w', 800, 0);
    expect(resized).toEqual({
      x: initial.x + initial.width - WORKSPACE_MIN_WIDTH,
      y: initial.y,
      width: WORKSPACE_MIN_WIDTH,
      height: initial.height,
    });
  });

  it('preserves the bottom edge when clamping north to the minimum height', () => {
    const resized = computeWorkspaceResizeBounds(initial, 'n', 0, 500);
    expect(resized).toEqual({
      x: initial.x,
      y: initial.y + initial.height - WORKSPACE_MIN_HEIGHT,
      width: initial.width,
      height: WORKSPACE_MIN_HEIGHT,
    });
  });
});
