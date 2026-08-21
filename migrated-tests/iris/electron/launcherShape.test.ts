/**
 * Verifies the pure geometry used by Electron's fixed launcher window. The collapsed shape
 * must leave enough room for the orb glow while the expanded shape restores the complete
 * launcher canvas without resizing the native window.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface ShapeRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const {
  LAUNCHER_EDGE_GRAB_SIZE,
  LAUNCHER_GLOW_PADDING,
  centeredLauncherOrbBounds,
  clampLauncherWindowBounds,
  createCollapsedLauncherShape,
  createExpandedLauncherShape,
  placeLauncherOrbAtDisplayEdge,
  tuckLauncherWindowAtDisplayEdge,
} = require('../../electron/launcherShape.cjs') as {
  LAUNCHER_EDGE_GRAB_SIZE: number;
  LAUNCHER_GLOW_PADDING: number;
  centeredLauncherOrbBounds: (width: number, height: number, orbSize?: number) => ShapeRectangle;
  clampLauncherWindowBounds: (
    windowBounds: ShapeRectangle,
    orbBounds: ShapeRectangle,
    displayBounds: ShapeRectangle,
    visiblePixels?: number,
  ) => ShapeRectangle;
  createCollapsedLauncherShape: (
    orbBounds: ShapeRectangle,
    width: number,
    height: number,
  ) => ShapeRectangle[];
  createExpandedLauncherShape: (width: number, height: number) => ShapeRectangle[];
  placeLauncherOrbAtDisplayEdge: (
    windowBounds: ShapeRectangle,
    orbBounds: ShapeRectangle,
    displayBounds: ShapeRectangle,
    pointer: { x: number; y: number },
    triggerBounds?: ShapeRectangle,
  ) => { windowBounds: ShapeRectangle; orbBounds: ShapeRectangle };
  tuckLauncherWindowAtDisplayEdge: (
    windowBounds: ShapeRectangle,
    orbBounds: ShapeRectangle,
    displayBounds: ShapeRectangle,
    pointer: { x: number; y: number },
  ) => ShapeRectangle;
};

function shapeBounds(rectangles: ShapeRectangle[]): ShapeRectangle {
  const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const top = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

describe('launcher window shape geometry', () => {
  it('keeps the expanded launcher on one fixed native canvas', () => {
    expect(createExpandedLauncherShape(500, 500)).toEqual([
      { x: 0, y: 0, width: 500, height: 500 },
    ]);
  });

  it('adds enough collapsed padding for the complete orb glow', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const shape = createCollapsedLauncherShape(orbBounds, 500, 500);
    const bounds = shapeBounds(shape);

    expect(shape.length).toBeGreaterThan(20);
    expect(bounds.width).toBeGreaterThanOrEqual(orbBounds.width + LAUNCHER_GLOW_PADDING * 2 - 4);
    expect(bounds.height).toBe(orbBounds.height + LAUNCHER_GLOW_PADDING * 2);
  });

  it('approximates a rounded glow region instead of a clipped square', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const shape = createCollapsedLauncherShape(orbBounds, 500, 500);
    const first = shape[0];
    const middle = shape[Math.floor(shape.length / 2)];

    expect(first.width).toBeLessThan(middle.width);
    expect(middle.width).toBeGreaterThan(orbBounds.width);
  });

  it('lets the orb tuck into a bottom corner with only the recovery area visible', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
    const nextBounds = clampLauncherWindowBounds(
      { x: -1000, y: 1200, width: 500, height: 500 },
      orbBounds,
      displayBounds,
    );

    expect(LAUNCHER_EDGE_GRAB_SIZE).toBeLessThan(8);
    expect(nextBounds).toEqual({ x: -280, y: 860, width: 500, height: 500 });
    expect(nextBounds.x + orbBounds.x + orbBounds.width).toBe(LAUNCHER_EDGE_GRAB_SIZE);
    expect(nextBounds.y + orbBounds.y).toBe(displayBounds.height - LAUNCHER_EDGE_GRAB_SIZE);
  });

  it('keeps the same tiny recovery area at the bottom-right edge', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
    const nextBounds = clampLauncherWindowBounds(
      { x: 2400, y: 1200, width: 500, height: 500 },
      orbBounds,
      displayBounds,
    );

    expect(nextBounds).toEqual({ x: 1700, y: 860, width: 500, height: 500 });
    expect(nextBounds.x + orbBounds.x).toBe(displayBounds.width - LAUNCHER_EDGE_GRAB_SIZE);
    expect(nextBounds.y + orbBounds.y).toBe(displayBounds.height - LAUNCHER_EDGE_GRAB_SIZE);
  });

  it('tucks the launcher to six visible pixels when the drag ends at a screen corner', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
    const nextBounds = tuckLauncherWindowAtDisplayEdge(
      { x: -214, y: 830, width: 500, height: 500 },
      orbBounds,
      displayBounds,
      { x: 0, y: 1079 },
    );

    expect(nextBounds).toEqual({ x: -280, y: 860, width: 500, height: 500 });
  });

  it('does not reposition the launcher when the pointer is away from display edges', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const current = { x: 600, y: 300, width: 500, height: 500 };
    expect(
      tuckLauncherWindowAtDisplayEdge(
        current,
        orbBounds,
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: 900, y: 500 },
      ),
    ).toEqual(current);
  });

  it('tucks the orb inside an onscreen native canvas when the window manager rejects offscreen bounds', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const placement = placeLauncherOrbAtDisplayEdge(
      { x: 47, y: 0, width: 500, height: 500 },
      orbBounds,
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 47, y: 1031 },
      { x: 47, y: 0, width: 1873, height: 1032 },
    );

    expect(placement.windowBounds).toEqual({
      x: 0,
      y: 580,
      width: 500,
      height: 500,
    });
    expect(placement.orbBounds).toEqual({
      x: -66,
      y: 494,
      width: 72,
      height: 72,
    });
  });

  it('recenters a tucked orb inside the native canvas after it is dragged back onscreen', () => {
    const placement = placeLauncherOrbAtDisplayEdge(
      { x: 600, y: 200, width: 500, height: 500 },
      { x: -66, y: 494, width: 72, height: 72 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 700, y: 700 },
    );

    expect(placement.orbBounds).toEqual({
      x: 214,
      y: 214,
      width: 72,
      height: 72,
    });
    expect(placement.windowBounds).toEqual({
      x: 320,
      y: 480,
      width: 500,
      height: 500,
    });
    expect(placement.windowBounds.x + placement.orbBounds.x).toBe(534);
    expect(placement.windowBounds.y + placement.orbBounds.y).toBe(694);
  });

  it('reduces a tucked collapsed launcher to the exact six-pixel recovery corner', () => {
    expect(
      createCollapsedLauncherShape({ x: -66, y: 494, width: 72, height: 72 }, 500, 500),
    ).toEqual([{ x: 0, y: 494, width: 6, height: 6 }]);
  });

  it('supports negative display coordinates on multi-monitor desktops', () => {
    const orbBounds = centeredLauncherOrbBounds(500, 500, 72);
    const displayBounds = { x: -1920, y: 0, width: 1920, height: 1080 };
    const nextBounds = clampLauncherWindowBounds(
      { x: -3000, y: 1200, width: 500, height: 500 },
      orbBounds,
      displayBounds,
    );

    expect(nextBounds).toEqual({ x: -2200, y: 860, width: 500, height: 500 });
  });
});
