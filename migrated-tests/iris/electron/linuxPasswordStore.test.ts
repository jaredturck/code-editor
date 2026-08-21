/**
 * Verifies distro-independent Linux password-store selection from desktop/session metadata.
 */

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { configureLinuxPasswordStore, detectLinuxPasswordStore } =
  require('../../electron/linuxPasswordStore.cjs') as {
    configureLinuxPasswordStore: (options: Record<string, unknown>) => {
      backend: string;
      desktop: string;
      reason: string;
    } | null;
    detectLinuxPasswordStore: (
      environment: Record<string, string>,
      commandExists?: (command: string) => boolean,
    ) => {
      backend: string;
      desktop: string;
      reason: string;
    } | null;
  };

function fakeApp(explicitBackend = '') {
  const appendSwitch = vi.fn();
  return {
    app: {
      commandLine: {
        appendSwitch,
        getSwitchValue: () => explicitBackend,
        hasSwitch: () => Boolean(explicitBackend),
      },
    },
    appendSwitch,
  };
}

describe('Linux password-store selection', () => {
  it('selects KWallet 6 for Plasma 6 on any Linux distribution', () => {
    const { app, appendSwitch } = fakeApp();
    const result = configureLinuxPasswordStore({
      app,
      platform: 'linux',
      environment: {
        XDG_CURRENT_DESKTOP: 'KDE',
        DESKTOP_SESSION: 'plasma',
        KDE_SESSION_VERSION: '6',
      },
    });

    expect(result?.backend).toBe('kwallet6');
    expect(appendSwitch).toHaveBeenCalledWith('password-store', 'kwallet6');
  });

  it('selects KWallet 5 for Plasma 5', () => {
    const result = detectLinuxPasswordStore({
      XDG_CURRENT_DESKTOP: 'KDE',
      DESKTOP_SESSION: 'plasma',
      KDE_SESSION_VERSION: '5',
    });

    expect(result?.backend).toBe('kwallet5');
  });

  it('uses the available KWallet daemon when Plasma omits its version', () => {
    const result = detectLinuxPasswordStore(
      {
        XDG_CURRENT_DESKTOP: 'KDE',
        DESKTOP_SESSION: 'plasma',
      },
      (command: string) => command === 'kwalletd5',
    );

    expect(result?.backend).toBe('kwallet5');
    expect(result?.reason).toBe('kwallet5-daemon-found');
  });

  it.each([
    ['GNOME', 'ubuntu'],
    ['ubuntu:GNOME', 'ubuntu-wayland'],
    ['XFCE', 'xubuntu'],
    ['X-Cinnamon', 'cinnamon'],
    ['MATE', 'mate'],
    ['Budgie:GNOME', 'budgie-desktop'],
    ['Pantheon', 'pantheon'],
    ['Deepin', 'deepin'],
    ['UKUI', 'ukui'],
  ])('selects libsecret for %s sessions', (desktop, session) => {
    const result = detectLinuxPasswordStore({
      XDG_CURRENT_DESKTOP: desktop,
      DESKTOP_SESSION: session,
    });

    expect(result?.backend).toBe('gnome-libsecret');
  });

  it('selects libsecret for a tiling desktop when a Secret Service client is installed', () => {
    const result = detectLinuxPasswordStore(
      {
        XDG_CURRENT_DESKTOP: 'Hyprland',
        DESKTOP_SESSION: 'hyprland',
      },
      (command: string) => command === 'secret-tool',
    );

    expect(result?.backend).toBe('gnome-libsecret');
  });

  it('respects an explicit password-store command-line switch', () => {
    const { app, appendSwitch } = fakeApp('gnome-libsecret');
    const result = configureLinuxPasswordStore({
      app,
      platform: 'linux',
      environment: { XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' },
    });

    expect(result?.backend).toBe('gnome-libsecret');
    expect(result?.reason).toBe('explicit-command-line');
    expect(appendSwitch).not.toHaveBeenCalled();
  });

  it('leaves unknown desktops to Electron and the existing fail-closed verification', () => {
    const { app, appendSwitch } = fakeApp();
    const result = configureLinuxPasswordStore({
      app,
      platform: 'linux',
      environment: { XDG_CURRENT_DESKTOP: 'unknown-shell' },
      commandExists: () => false,
    });

    expect(result).toBeNull();
    expect(appendSwitch).not.toHaveBeenCalled();
  });

  it('does nothing on non-Linux platforms', () => {
    const { app, appendSwitch } = fakeApp();
    const result = configureLinuxPasswordStore({
      app,
      platform: 'win32',
      environment: { XDG_CURRENT_DESKTOP: 'KDE' },
    });

    expect(result).toBeNull();
    expect(appendSwitch).not.toHaveBeenCalled();
  });
});
