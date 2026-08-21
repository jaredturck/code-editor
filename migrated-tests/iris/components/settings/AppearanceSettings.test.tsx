/**
 * Verifies Appearance controls persist theme, accent, and shared orb-size settings while using
 * the real orb component as the preview surface.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    appearance_theme: 'dark',
    appearance_accent: 'blue',
    orb_size: 'medium',
    orb_texture: 'desert',
  } as Record<string, unknown>,
  updateSettings: vi.fn(),
}));

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock('@/components/orb/ParticleOrb', () => ({
  default: ({ size, accent, texture }: { size: number; accent: string; texture: string }) => (
    <div
      data-testid="particle-orb-preview"
      data-size={size}
      data-accent={accent}
      data-texture={texture}
    />
  ),
}));

import AppearanceSettings from '@/components/settings/categories/AppearanceSettings';

describe('AppearanceSettings', () => {
  beforeEach(() => mocks.updateSettings.mockReset());

  it('renders the shared animated orb preview dimensions', () => {
    render(<AppearanceSettings />);

    expect(screen.getByTestId('particle-orb-preview')).toHaveAttribute('data-size', '72');
    expect(screen.getByTestId('particle-orb-preview')).toHaveAttribute('data-accent', 'blue');
    expect(screen.getByTestId('particle-orb-preview')).toHaveAttribute('data-texture', 'desert');
  });

  it('persists theme, accent, and orb size choices', () => {
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green accent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Neon planet texture' }));
    fireEvent.click(screen.getByRole('button', { name: 'large' }));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      appearance_theme: 'light',
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      appearance_accent: 'green',
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ orb_texture: 'neon' });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ orb_size: 'large' });
  });
});
