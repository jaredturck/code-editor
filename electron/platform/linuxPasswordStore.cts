/**
 * Selects Electron's Linux password-store backend before app readiness. Detection is based on
 * the active desktop environment and available wallet daemon rather than the Linux distribution.
 */

import fs = require('node:fs');
import path = require('node:path');
import type { App } from 'electron';

const LIBSECRET_DESKTOP_MARKERS = [
  'budgie',
  'cinnamon',
  'deepin',
  'elementary',
  'gnome',
  'mate',
  'pantheon',
  'pop',
  'ubuntu',
  'ukui',
  'unity',
  'xfce',
  'xubuntu',
];

const LIBSECRET_SESSION_MARKERS = ['awesome', 'bspwm', 'hyprland', 'i3', 'river', 'sway'];

interface CommandLineApi {
  appendSwitch: (name: string, value?: string) => void;
  getSwitchValue: (name: string) => string;
  hasSwitch: (name: string) => boolean;
}

interface LinuxPasswordStoreOptions {
  app: Pick<App, 'commandLine'>;
  commandExists?: (command: string, environment?: NodeJS.ProcessEnv) => boolean;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface LinuxPasswordStoreSelection {
  backend: string;
  desktop: string;
  reason: string;
}

function normalizeEnvironmentValue(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function getDesktopDescription(environment: NodeJS.ProcessEnv = process.env): string {
  return [
    environment.XDG_CURRENT_DESKTOP,
    environment.XDG_SESSION_DESKTOP,
    environment.DESKTOP_SESSION,
    environment.GDMSESSION,
  ]
    .map(normalizeEnvironmentValue)
    .filter(Boolean)
    .join(':');
}

function commandExistsInPath(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const searchPath = String(environment.PATH || '');
  if (!searchPath) return false;

  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    try {
      const candidate = path.join(directory, command);
      const stats = fs.statSync(candidate);
      if (stats.isFile()) return true;
    } catch {
      // Continue searching the remaining PATH entries.
    }
  }
  return false;
}

function includesMarker(value: string, markers: readonly string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

function detectKwalletBackend(
  desktop: string,
  environment: NodeJS.ProcessEnv,
  commandExists: (command: string, environment?: NodeJS.ProcessEnv) => boolean,
): LinuxPasswordStoreSelection | null {
  const kdeVersion = normalizeEnvironmentValue(environment.KDE_SESSION_VERSION);
  const kdeSession =
    desktop.includes('kde') ||
    desktop.includes('plasma') ||
    normalizeEnvironmentValue(environment.KDE_FULL_SESSION) === 'true';

  if (!kdeSession) return null;

  if (kdeVersion === '5' || desktop.includes('kde5') || desktop.includes('plasma5')) {
    return { backend: 'kwallet5', desktop, reason: 'kde-session-version-5' };
  }
  if (kdeVersion === '6' || desktop.includes('kde6') || desktop.includes('plasma6')) {
    return { backend: 'kwallet6', desktop, reason: 'kde-session-version-6' };
  }

  const hasKwallet6 = commandExists('kwalletd6', environment);
  const hasKwallet5 = commandExists('kwalletd5', environment);
  if (hasKwallet6 && !hasKwallet5) {
    return { backend: 'kwallet6', desktop, reason: 'kwallet6-daemon-found' };
  }
  if (hasKwallet5 && !hasKwallet6) {
    return { backend: 'kwallet5', desktop, reason: 'kwallet5-daemon-found' };
  }
  if (hasKwallet6) {
    return { backend: 'kwallet6', desktop, reason: 'kwallet6-preferred' };
  }

  // Current Plasma releases use KWallet 6. Electron verifies the selected backend after ready,
  // so an unavailable wallet still fails closed instead of falling back to basic_text.
  return { backend: 'kwallet6', desktop, reason: 'modern-plasma-default' };
}

function detectLibsecretBackend(
  desktop: string,
  environment: NodeJS.ProcessEnv,
  commandExists: (command: string, environment?: NodeJS.ProcessEnv) => boolean,
): LinuxPasswordStoreSelection | null {
  if (includesMarker(desktop, LIBSECRET_DESKTOP_MARKERS)) {
    return { backend: 'gnome-libsecret', desktop, reason: 'libsecret-desktop' };
  }

  if (
    includesMarker(desktop, LIBSECRET_SESSION_MARKERS) &&
    (Boolean(environment.GNOME_KEYRING_CONTROL) ||
      commandExists('gnome-keyring-daemon', environment) ||
      commandExists('secret-tool', environment))
  ) {
    return { backend: 'gnome-libsecret', desktop, reason: 'libsecret-session-service' };
  }

  return null;
}

function detectLinuxPasswordStore(
  environment: NodeJS.ProcessEnv = process.env,
  commandExists = commandExistsInPath,
): LinuxPasswordStoreSelection | null {
  const desktop = getDesktopDescription(environment);
  const kwallet = detectKwalletBackend(desktop, environment, commandExists);
  if (kwallet) return kwallet;
  return detectLibsecretBackend(desktop, environment, commandExists);
}

function configureLinuxPasswordStore({
  app,
  commandExists = commandExistsInPath,
  environment = process.env,
  platform = process.platform,
}: LinuxPasswordStoreOptions): LinuxPasswordStoreSelection | null {
  if (platform !== 'linux') return null;

  const commandLine = app.commandLine as CommandLineApi;
  if (commandLine.hasSwitch('password-store')) {
    return {
      backend: commandLine.getSwitchValue('password-store') || 'explicit',
      desktop: getDesktopDescription(environment),
      reason: 'explicit-command-line',
    };
  }

  const selection = detectLinuxPasswordStore(environment, commandExists);
  if (!selection) return null;

  commandLine.appendSwitch('password-store', selection.backend);
  return selection;
}

export {
  commandExistsInPath,
  configureLinuxPasswordStore,
  detectLinuxPasswordStore,
  getDesktopDescription,
};
