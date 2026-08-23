/**
 * Discovers desktop applications and owns the one managed development process started from
 * the Launcher panel. Resolved binaries are returned to the renderer for encrypted caching;
 * discovery validates cached paths before doing bounded desktop-default and PATH lookups.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '../shared/processExecution.js'

export type LauncherApplicationCapability =
  | 'file_manager'
  | 'terminal'
  | 'web_browser'
  | 'code_editor'
  | 'system_settings'
  | 'calculator'
  | 'text_editor'
  | 'system_monitor'
  | 'email_client'
  | 'software_center'
  | 'password_manager'

export type LauncherToolCapability =
  'package_manager' | 'privilege_helper' | 'docker' | 'docker_desktop' | 'podman' | 'podman_desktop' | 'git' | 'shell'

export interface LauncherCapabilityResolution {
  capability: LauncherApplicationCapability | LauncherToolCapability
  displayName: string
  executable: string
  args: string[]
  source: 'cache' | 'desktop-default' | 'desktop-candidate' | 'path-candidate' | 'environment'
  desktopEntry?: string
  discoveredAt: number
}

export interface LauncherDiscoveryResult {
  desktop: string
  applications: LauncherCapabilityResolution[]
  tools: LauncherCapabilityResolution[]
}

export interface LauncherDiscoveryOptions {
  cached?: unknown
  force?: boolean
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export interface DevEnvironmentStatus {
  configured: boolean
  available: boolean
  running: boolean
  pid?: number
  cwd?: string
  projectName?: string
  executable?: string
  args?: string[]
  command?: string
  startedAt?: number
  reason?: string
}

interface ApplicationCandidate {
  executable: string
  displayName: string
}

interface ApplicationDefinition {
  capability: LauncherApplicationCapability
  genericName: string
  mimeTypes?: string[]
  candidates: ApplicationCandidate[]
  desktopCandidates?: Record<string, ApplicationCandidate[]>
}

interface ToolDefinition {
  capability: LauncherToolCapability
  candidates: ApplicationCandidate[]
}

interface DesktopEntryApplication {
  displayName: string
  executable: string
  args: string[]
  desktopEntry: string
}

interface ManagedDevProcess {
  child: ChildProcess
  pid: number
  cwd: string
  projectName: string
  executable: string
  args: string[]
  command: string
  startedAt: number
}

const APPLICATION_DEFINITIONS: ApplicationDefinition[] = [
  {
    capability: 'file_manager',
    genericName: 'Files',
    mimeTypes: ['inode/directory'],
    desktopCandidates: {
      kde: [
        { executable: 'dolphin', displayName: 'Dolphin' },
        { executable: 'konqueror', displayName: 'Konqueror' },
      ],
      gnome: [
        { executable: 'nautilus', displayName: 'Files' },
        { executable: 'nemo', displayName: 'Nemo' },
      ],
      xfce: [{ executable: 'thunar', displayName: 'Thunar' }],
      mate: [{ executable: 'caja', displayName: 'Caja' }],
      lxqt: [{ executable: 'pcmanfm-qt', displayName: 'PCManFM-Qt' }],
    },
    candidates: [
      { executable: 'dolphin', displayName: 'Dolphin' },
      { executable: 'nautilus', displayName: 'Files' },
      { executable: 'thunar', displayName: 'Thunar' },
      { executable: 'nemo', displayName: 'Nemo' },
      { executable: 'pcmanfm-qt', displayName: 'PCManFM-Qt' },
      { executable: 'pcmanfm', displayName: 'PCManFM' },
      { executable: 'caja', displayName: 'Caja' },
      { executable: 'konqueror', displayName: 'Konqueror' },
    ],
  },
  {
    capability: 'terminal',
    genericName: 'Terminal',
    desktopCandidates: {
      kde: [{ executable: 'konsole', displayName: 'Konsole' }],
      gnome: [
        { executable: 'kgx', displayName: 'Console' },
        { executable: 'gnome-terminal', displayName: 'GNOME Terminal' },
      ],
      xfce: [{ executable: 'xfce4-terminal', displayName: 'XFCE Terminal' }],
      mate: [{ executable: 'mate-terminal', displayName: 'MATE Terminal' }],
      lxqt: [{ executable: 'qterminal', displayName: 'QTerminal' }],
    },
    candidates: [
      { executable: 'konsole', displayName: 'Konsole' },
      { executable: 'kgx', displayName: 'Console' },
      { executable: 'gnome-terminal', displayName: 'GNOME Terminal' },
      { executable: 'xfce4-terminal', displayName: 'XFCE Terminal' },
      { executable: 'mate-terminal', displayName: 'MATE Terminal' },
      { executable: 'qterminal', displayName: 'QTerminal' },
      { executable: 'tilix', displayName: 'Tilix' },
      { executable: 'kitty', displayName: 'Kitty' },
      { executable: 'alacritty', displayName: 'Alacritty' },
      { executable: 'wezterm', displayName: 'WezTerm' },
      { executable: 'foot', displayName: 'Foot' },
      { executable: 'lxterminal', displayName: 'LXTerminal' },
      { executable: 'xterm', displayName: 'XTerm' },
    ],
  },
  {
    capability: 'web_browser',
    genericName: 'Web Browser',
    mimeTypes: ['x-scheme-handler/http', 'x-scheme-handler/https'],
    candidates: [
      { executable: 'google-chrome-stable', displayName: 'Google Chrome' },
      { executable: 'google-chrome', displayName: 'Google Chrome' },
      { executable: 'chromium', displayName: 'Chromium' },
      { executable: 'chromium-browser', displayName: 'Chromium' },
      { executable: 'firefox', displayName: 'Firefox' },
      { executable: 'brave-browser', displayName: 'Brave' },
      { executable: 'brave', displayName: 'Brave' },
      { executable: 'vivaldi-stable', displayName: 'Vivaldi' },
      { executable: 'vivaldi', displayName: 'Vivaldi' },
      { executable: 'microsoft-edge-stable', displayName: 'Microsoft Edge' },
      { executable: 'microsoft-edge', displayName: 'Microsoft Edge' },
      { executable: 'opera', displayName: 'Opera' },
    ],
  },
  {
    capability: 'code_editor',
    genericName: 'Code Editor',
    candidates: [
      { executable: 'code', displayName: 'VS Code' },
      { executable: 'codium', displayName: 'VSCodium' },
      { executable: 'code-oss', displayName: 'Code - OSS' },
      { executable: 'subl', displayName: 'Sublime Text' },
      { executable: 'sublime_text', displayName: 'Sublime Text' },
      { executable: 'zed', displayName: 'Zed' },
      { executable: 'idea', displayName: 'IntelliJ IDEA' },
      { executable: 'pycharm', displayName: 'PyCharm' },
      { executable: 'webstorm', displayName: 'WebStorm' },
      { executable: 'geany', displayName: 'Geany' },
    ],
  },
  {
    capability: 'system_settings',
    genericName: 'Settings',
    desktopCandidates: {
      kde: [
        { executable: 'systemsettings', displayName: 'System Settings' },
        { executable: 'systemsettings6', displayName: 'System Settings' },
        { executable: 'systemsettings5', displayName: 'System Settings' },
      ],
      gnome: [{ executable: 'gnome-control-center', displayName: 'Settings' }],
      xfce: [
        {
          executable: 'xfce4-settings-manager',
          displayName: 'Settings Manager',
        },
      ],
      mate: [{ executable: 'mate-control-center', displayName: 'Control Center' }],
      lxqt: [{ executable: 'lxqt-config', displayName: 'LXQt Configuration Center' }],
    },
    candidates: [
      { executable: 'systemsettings', displayName: 'System Settings' },
      { executable: 'systemsettings6', displayName: 'System Settings' },
      { executable: 'systemsettings5', displayName: 'System Settings' },
      { executable: 'gnome-control-center', displayName: 'Settings' },
      { executable: 'xfce4-settings-manager', displayName: 'Settings Manager' },
      { executable: 'mate-control-center', displayName: 'Control Center' },
      { executable: 'lxqt-config', displayName: 'LXQt Configuration Center' },
    ],
  },
  {
    capability: 'calculator',
    genericName: 'Calculator',
    desktopCandidates: {
      kde: [{ executable: 'kcalc', displayName: 'KCalc' }],
      gnome: [{ executable: 'gnome-calculator', displayName: 'Calculator' }],
      xfce: [{ executable: 'galculator', displayName: 'Galculator' }],
    },
    candidates: [
      { executable: 'kcalc', displayName: 'KCalc' },
      { executable: 'gnome-calculator', displayName: 'Calculator' },
      { executable: 'qalculate-gtk', displayName: 'Qalculate!' },
      { executable: 'galculator', displayName: 'Galculator' },
      { executable: 'mate-calc', displayName: 'MATE Calculator' },
      { executable: 'xcalc', displayName: 'XCalc' },
    ],
  },
  {
    capability: 'text_editor',
    genericName: 'Text Editor',
    mimeTypes: ['text/plain'],
    desktopCandidates: {
      kde: [
        { executable: 'kate', displayName: 'Kate' },
        { executable: 'kwrite', displayName: 'KWrite' },
      ],
      gnome: [
        { executable: 'gnome-text-editor', displayName: 'Text Editor' },
        { executable: 'gedit', displayName: 'gedit' },
      ],
      xfce: [{ executable: 'mousepad', displayName: 'Mousepad' }],
      mate: [{ executable: 'pluma', displayName: 'Pluma' }],
    },
    candidates: [
      { executable: 'kate', displayName: 'Kate' },
      { executable: 'kwrite', displayName: 'KWrite' },
      { executable: 'gnome-text-editor', displayName: 'Text Editor' },
      { executable: 'gedit', displayName: 'gedit' },
      { executable: 'mousepad', displayName: 'Mousepad' },
      { executable: 'xed', displayName: 'Xed' },
      { executable: 'pluma', displayName: 'Pluma' },
      { executable: 'leafpad', displayName: 'Leafpad' },
    ],
  },
  {
    capability: 'system_monitor',
    genericName: 'System Monitor',
    desktopCandidates: {
      kde: [
        {
          executable: 'plasma-systemmonitor',
          displayName: 'Plasma System Monitor',
        },
        { executable: 'ksysguard', displayName: 'KSysGuard' },
      ],
      gnome: [{ executable: 'gnome-system-monitor', displayName: 'System Monitor' }],
      xfce: [{ executable: 'xfce4-taskmanager', displayName: 'Task Manager' }],
      mate: [{ executable: 'mate-system-monitor', displayName: 'System Monitor' }],
    },
    candidates: [
      {
        executable: 'plasma-systemmonitor',
        displayName: 'Plasma System Monitor',
      },
      { executable: 'ksysguard', displayName: 'KSysGuard' },
      { executable: 'gnome-system-monitor', displayName: 'System Monitor' },
      { executable: 'xfce4-taskmanager', displayName: 'Task Manager' },
      { executable: 'mate-system-monitor', displayName: 'System Monitor' },
      { executable: 'lxtask', displayName: 'LXTask' },
    ],
  },
  {
    capability: 'email_client',
    genericName: 'Email Client',
    mimeTypes: ['x-scheme-handler/mailto'],
    candidates: [
      { executable: 'thunderbird', displayName: 'Thunderbird' },
      { executable: 'kmail', displayName: 'KMail' },
      { executable: 'evolution', displayName: 'Evolution' },
      { executable: 'geary', displayName: 'Geary' },
      { executable: 'mailspring', displayName: 'Mailspring' },
    ],
  },
  {
    capability: 'software_center',
    genericName: 'Software Center',
    desktopCandidates: {
      kde: [{ executable: 'plasma-discover', displayName: 'Discover' }],
      gnome: [{ executable: 'gnome-software', displayName: 'Software' }],
    },
    candidates: [
      { executable: 'plasma-discover', displayName: 'Discover' },
      { executable: 'gnome-software', displayName: 'Software' },
      { executable: 'pamac-manager', displayName: 'Pamac' },
      { executable: 'bauh', displayName: 'Bauh' },
      { executable: 'octopi', displayName: 'Octopi' },
      { executable: 'synaptic', displayName: 'Synaptic' },
    ],
  },
  {
    capability: 'password_manager',
    genericName: 'Password Manager',
    candidates: [
      { executable: 'keepassxc', displayName: 'KeePassXC' },
      { executable: 'bitwarden', displayName: 'Bitwarden' },
      { executable: '1password', displayName: '1Password' },
      { executable: 'proton-pass', displayName: 'Proton Pass' },
      { executable: 'seahorse', displayName: 'Passwords and Keys' },
    ],
  },
]

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    capability: 'package_manager',
    candidates: [
      { executable: 'pacman', displayName: 'Pacman' },
      { executable: 'apt', displayName: 'APT' },
      { executable: 'dnf', displayName: 'DNF' },
      { executable: 'zypper', displayName: 'Zypper' },
      { executable: 'apk', displayName: 'APK' },
      { executable: 'xbps-install', displayName: 'XBPS' },
    ],
  },
  {
    capability: 'privilege_helper',
    candidates: [
      { executable: 'sudo', displayName: 'sudo' },
      { executable: 'doas', displayName: 'doas' },
      { executable: 'pkexec', displayName: 'pkexec' },
    ],
  },
  {
    capability: 'docker_desktop',
    candidates: [{ executable: 'docker-desktop', displayName: 'Docker Desktop' }],
  },
  {
    capability: 'docker',
    candidates: [{ executable: 'docker', displayName: 'Docker' }],
  },
  {
    capability: 'podman_desktop',
    candidates: [{ executable: 'podman-desktop', displayName: 'Podman Desktop' }],
  },
  {
    capability: 'podman',
    candidates: [{ executable: 'podman', displayName: 'Podman' }],
  },
  {
    capability: 'git',
    candidates: [{ executable: 'git', displayName: 'Git' }],
  },
]

let managedDevProcess: ManagedDevProcess | null = null

function normalizeDesktop(env: NodeJS.ProcessEnv): string {
  return [env.XDG_CURRENT_DESKTOP, env.DESKTOP_SESSION, env.GDMSESSION].filter(Boolean).join(':').toLowerCase()
}

function desktopFamily(desktop: string): string {
  if (desktop.includes('kde') || desktop.includes('plasma')) return 'kde'
  if (desktop.includes('gnome') || desktop.includes('unity') || desktop.includes('cinnamon')) return 'gnome'
  if (desktop.includes('xfce')) return 'xfce'
  if (desktop.includes('mate')) return 'mate'
  if (desktop.includes('lxqt')) return 'lxqt'
  return ''
}

async function isExecutable(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath).catch(() => null)
  if (!stats?.isFile()) return false
  return fs.access(filePath, 0o1).then(
    () => true,
    () => false,
  )
}

export async function resolveLauncherExecutable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const value = String(executable || '').trim()
  if (!value) return null
  if (path.isAbsolute(value)) return (await isExecutable(value)) ? value : null

  const pathValue = String(env.PATH || '')
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, value)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

function desktopEntryDirectories(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const dataHome = env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share')
  const dataDirs = String(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean)
  return [dataHome, ...dataDirs].map((directory) => path.join(directory, 'applications'))
}

function parseDesktopExec(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  let escaped = false

  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ''
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += character
  }

  if (current) tokens.push(current)
  return tokens
    .filter((token) => !token.startsWith('@@'))
    .map((token) => token.replace(/%[fFuUdDnNickvm]/g, '').replace(/%%/g, '%'))
    .filter(Boolean)
}

function normalizeDesktopExecTokens(tokens: string[]): string[] {
  if (!tokens.length) return []
  if (tokens[0] !== 'env') return tokens
  let index = 1
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1
  return tokens.slice(index)
}

async function readDesktopEntry(
  desktopId: string,
  homeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<DesktopEntryApplication | null> {
  const normalizedId = path.basename(String(desktopId || '').trim())
  if (!normalizedId || normalizedId.includes('..')) return null

  for (const directory of desktopEntryDirectories(homeDir, env)) {
    const entryPath = path.join(directory, normalizedId)
    const content = await fs.readFile(entryPath, 'utf8').catch(() => '')
    if (!content) continue

    const values = new Map<string, string>()
    let inDesktopEntry = false
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.startsWith('[')) {
        inDesktopEntry = line === '[Desktop Entry]'
        continue
      }
      if (!inDesktopEntry || !line || line.startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator < 1) continue
      const key = line.slice(0, separator).trim()
      if (!values.has(key)) values.set(key, line.slice(separator + 1).trim())
    }

    if (values.get('Type') && values.get('Type') !== 'Application') continue
    if (values.get('Hidden') === 'true') continue
    const tokens = normalizeDesktopExecTokens(parseDesktopExec(values.get('Exec') || ''))
    if (!tokens.length) continue
    const executable = await resolveLauncherExecutable(tokens[0], env)
    if (!executable) continue

    return {
      displayName: values.get('Name') || path.basename(executable),
      executable,
      args: tokens.slice(1),
      desktopEntry: normalizedId,
    }
  }

  return null
}

async function runOptional(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return runProcess(executable, args, {
    env,
    timeoutMs: 1500,
    maxBufferBytes: 64 * 1024,
  }).then(
    (result) => result.stdout.trim(),
    () => '',
  )
}

async function resolveDesktopDefault(
  definition: ApplicationDefinition,
  homeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<LauncherCapabilityResolution | null> {
  const desktopIds: string[] = []

  if (definition.capability === 'web_browser') {
    const xdgSettings = await resolveLauncherExecutable('xdg-settings', env)
    if (xdgSettings) {
      const browserId = await runOptional(xdgSettings, ['get', 'default-web-browser'], env)
      if (browserId) desktopIds.push(browserId)
    }
  }

  const xdgMime = await resolveLauncherExecutable('xdg-mime', env)
  if (xdgMime) {
    for (const mimeType of definition.mimeTypes || []) {
      const desktopId = await runOptional(xdgMime, ['query', 'default', mimeType], env)
      if (desktopId) desktopIds.push(desktopId)
    }
  }

  const gio = await resolveLauncherExecutable('gio', env)
  if (gio) {
    for (const mimeType of definition.mimeTypes || []) {
      const output = await runOptional(gio, ['mime', mimeType], env)
      const desktopId = output.match(/Default application[^:]*:\s*([^\s]+\.desktop)/i)?.[1]
      if (desktopId) desktopIds.push(desktopId)
    }
  }

  for (const desktopId of [...new Set(desktopIds)]) {
    const application = await readDesktopEntry(desktopId, homeDir, env)
    if (!application) continue
    return {
      capability: definition.capability,
      displayName: application.displayName,
      executable: application.executable,
      args: application.args,
      source: 'desktop-default',
      desktopEntry: application.desktopEntry,
      discoveredAt: Date.now(),
    }
  }

  return null
}

function applicationCandidates(definition: ApplicationDefinition, family: string): ApplicationCandidate[] {
  const preferred = family ? definition.desktopCandidates?.[family] || [] : []
  const seen = new Set<string>()
  return [...preferred, ...definition.candidates].filter((candidate) => {
    if (seen.has(candidate.executable)) return false
    seen.add(candidate.executable)
    return true
  })
}

async function resolveCandidate(
  capability: LauncherApplicationCapability | LauncherToolCapability,
  candidates: ApplicationCandidate[],
  env: NodeJS.ProcessEnv,
  source: LauncherCapabilityResolution['source'],
): Promise<LauncherCapabilityResolution | null> {
  for (const candidate of candidates) {
    const executable = await resolveLauncherExecutable(candidate.executable, env)
    if (!executable) continue
    return {
      capability,
      displayName: candidate.displayName,
      executable,
      args: [],
      source,
      discoveredAt: Date.now(),
    }
  }
  return null
}

function cachedResolutions(value: unknown): LauncherCapabilityResolution[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { applications?: unknown; tools?: unknown }
  return [
    ...(Array.isArray(record.applications) ? record.applications : []),
    ...(Array.isArray(record.tools) ? record.tools : []),
  ]
    .filter((item): item is LauncherCapabilityResolution => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      capability: String(item.capability || '') as LauncherCapabilityResolution['capability'],
      displayName: String(item.displayName || ''),
      executable: String(item.executable || ''),
      args: Array.isArray(item.args) ? item.args.map((argument) => String(argument)).slice(0, 50) : [],
      source: 'cache' as const,
      desktopEntry: item.desktopEntry ? String(item.desktopEntry) : undefined,
      discoveredAt: Number(item.discoveredAt) || Date.now(),
    }))
}

async function validCachedResolution(
  capability: LauncherCapabilityResolution['capability'],
  cached: LauncherCapabilityResolution[],
): Promise<LauncherCapabilityResolution | null> {
  const resolution = cached.find((item) => item.capability === capability)
  if (!resolution || !resolution.displayName || !resolution.executable) return null
  if (!(await isExecutable(resolution.executable))) return null
  return { ...resolution, source: 'cache' }
}

function resolveShell(env: NodeJS.ProcessEnv): LauncherCapabilityResolution | null {
  const shell = String(env.SHELL || '').trim()
  if (!shell || !path.isAbsolute(shell)) return null
  return {
    capability: 'shell',
    displayName: path.basename(shell),
    executable: shell,
    args: [],
    source: 'environment',
    discoveredAt: Date.now(),
  }
}

/**
 * Resolves the installed applications used by launcher cards. Cached exact binaries are
 * validated first; missing entries then use desktop defaults, desktop-aware candidates, and
 * general PATH candidates in that order.
 */
export async function discoverLauncherCapabilities(
  options: LauncherDiscoveryOptions = {},
): Promise<LauncherDiscoveryResult> {
  const env = options.env || process.env
  const homeDir = options.homeDir || os.homedir()
  const desktop = normalizeDesktop(env)
  const family = desktopFamily(desktop)
  const cached = options.force ? [] : cachedResolutions(options.cached)
  const applications: LauncherCapabilityResolution[] = []
  const tools: LauncherCapabilityResolution[] = []

  for (const definition of APPLICATION_DEFINITIONS) {
    const cachedApplication = await validCachedResolution(definition.capability, cached)
    if (cachedApplication) {
      applications.push(cachedApplication)
      continue
    }

    const desktopDefault = await resolveDesktopDefault(definition, homeDir, env)
    if (desktopDefault) {
      applications.push(desktopDefault)
      continue
    }

    const preferredCount = family ? definition.desktopCandidates?.[family]?.length || 0 : 0
    const candidates = applicationCandidates(definition, family)
    const preferred = await resolveCandidate(
      definition.capability,
      candidates.slice(0, preferredCount),
      env,
      'desktop-candidate',
    )
    if (preferred) {
      applications.push(preferred)
      continue
    }

    const fallback = await resolveCandidate(
      definition.capability,
      candidates.slice(preferredCount),
      env,
      'path-candidate',
    )
    if (fallback) applications.push(fallback)
  }

  for (const definition of TOOL_DEFINITIONS) {
    const cachedTool = await validCachedResolution(definition.capability, cached)
    if (cachedTool) {
      tools.push(cachedTool)
      continue
    }
    const resolution = await resolveCandidate(definition.capability, definition.candidates, env, 'path-candidate')
    if (resolution) tools.push(resolution)
  }

  const cachedShell = await validCachedResolution('shell', cached)
  if (cachedShell) tools.push(cachedShell)
  else {
    const shell = resolveShell(env)
    if (shell && (await isExecutable(shell.executable))) tools.push(shell)
  }

  return { desktop, applications, tools }
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  )
}

function commandDisplay(executable: string, args: string[]): string {
  return [executable, ...args]
    .map((value) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value)))
    .join(' ')
}

async function resolvePackageCommand(cwd: string, env: NodeJS.ProcessEnv): Promise<DevEnvironmentStatus | null> {
  const packagePath = path.join(cwd, 'package.json')
  if (!(await fileExists(packagePath))) return null

  const content = await fs.readFile(packagePath, 'utf8').catch(() => '')
  let packageData: { name?: unknown; scripts?: Record<string, unknown> } = {}
  try {
    packageData = JSON.parse(content) as {
      name?: unknown
      scripts?: Record<string, unknown>
    }
  } catch {
    return {
      configured: true,
      available: false,
      running: false,
      cwd,
      projectName: path.basename(cwd),
      reason: 'package.json could not be parsed.',
    }
  }

  const script = ['dev', 'start', 'serve'].find((name) => typeof packageData.scripts?.[name] === 'string')
  if (!script) {
    return {
      configured: true,
      available: false,
      running: false,
      cwd,
      projectName: String(packageData.name || path.basename(cwd)),
      reason: 'No dev, start, or serve script was found in package.json.',
    }
  }

  const managerCandidates: Array<{
    lockfile?: string
    executable: string
    args: string[]
  }> = [
    { lockfile: 'pnpm-lock.yaml', executable: 'pnpm', args: ['run', script] },
    { lockfile: 'yarn.lock', executable: 'yarn', args: [script] },
    { lockfile: 'bun.lock', executable: 'bun', args: ['run', script] },
    { lockfile: 'bun.lockb', executable: 'bun', args: ['run', script] },
    { lockfile: 'package-lock.json', executable: 'npm', args: ['run', script] },
  ]

  let selected = managerCandidates[managerCandidates.length - 1]
  for (const candidate of managerCandidates) {
    if (candidate.lockfile && (await fileExists(path.join(cwd, candidate.lockfile)))) {
      selected = candidate
      break
    }
  }

  const executable = await resolveLauncherExecutable(selected.executable, env)
  if (!executable) {
    return {
      configured: true,
      available: false,
      running: false,
      cwd,
      projectName: String(packageData.name || path.basename(cwd)),
      reason: `${selected.executable} is required by this project but was not found.`,
    }
  }

  return {
    configured: true,
    available: true,
    running: false,
    cwd,
    projectName: String(packageData.name || path.basename(cwd)),
    executable,
    args: selected.args,
    command: commandDisplay(selected.executable, selected.args),
  }
}

async function resolveFrameworkCommand(cwd: string, env: NodeJS.ProcessEnv): Promise<DevEnvironmentStatus | null> {
  if (await fileExists(path.join(cwd, 'manage.py'))) {
    const executable =
      (await resolveLauncherExecutable('python3', env)) || (await resolveLauncherExecutable('python', env))
    if (!executable) {
      return {
        configured: true,
        available: false,
        running: false,
        cwd,
        projectName: path.basename(cwd),
        reason: 'Python was not found for manage.py.',
      }
    }
    const args = ['manage.py', 'runserver']
    return {
      configured: true,
      available: true,
      running: false,
      cwd,
      projectName: path.basename(cwd),
      executable,
      args,
      command: commandDisplay(path.basename(executable), args),
    }
  }

  if (await fileExists(path.join(cwd, 'Cargo.toml'))) {
    const executable = await resolveLauncherExecutable('cargo', env)
    if (!executable) {
      return {
        configured: true,
        available: false,
        running: false,
        cwd,
        projectName: path.basename(cwd),
        reason: 'Cargo was not found for Cargo.toml.',
      }
    }
    const args = ['run']
    return {
      configured: true,
      available: true,
      running: false,
      cwd,
      projectName: path.basename(cwd),
      executable,
      args,
      command: 'cargo run',
    }
  }

  if (await fileExists(path.join(cwd, 'pyproject.toml'))) {
    return {
      configured: true,
      available: false,
      running: false,
      cwd,
      projectName: path.basename(cwd),
      reason: 'A pyproject.toml was found, but no unambiguous development command is available.',
    }
  }

  return null
}

function currentManagedStatus(): DevEnvironmentStatus | null {
  const current = managedDevProcess
  if (!current) return null
  return {
    configured: true,
    available: true,
    running: true,
    pid: current.pid,
    cwd: current.cwd,
    projectName: current.projectName,
    executable: current.executable,
    args: current.args,
    command: current.command,
    startedAt: current.startedAt,
  }
}

/** Detects the supported development command for one configured working directory. */
export async function getDevEnvironmentStatus(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DevEnvironmentStatus> {
  const current = currentManagedStatus()
  if (current) return current

  const normalizedCwd = String(cwd || '').trim()
  if (!normalizedCwd) {
    return {
      configured: false,
      available: false,
      running: false,
      reason: 'No working directory configured.',
    }
  }

  const packageCommand = await resolvePackageCommand(normalizedCwd, env)
  if (packageCommand) return packageCommand
  const frameworkCommand = await resolveFrameworkCommand(normalizedCwd, env)
  if (frameworkCommand) return frameworkCommand

  return {
    configured: true,
    available: false,
    running: false,
    cwd: normalizedCwd,
    projectName: path.basename(normalizedCwd),
    reason: 'No supported development command was found in this directory.',
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0)
    return true
  } catch {
    return false
  }
}

function clearManagedDevProcess(child: ChildProcess): void {
  const current = managedDevProcess
  if (!current || current.child !== child) return
  setTimeout(() => {
    if (managedDevProcess?.child === child && !processGroupExists(current.pid)) {
      managedDevProcess = null
    }
  }, 100)
}

/** Starts the detected development command and retains its exact process group in memory. */
export async function startManagedDevEnvironment(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DevEnvironmentStatus> {
  const current = currentManagedStatus()
  if (current) return current

  const status = await getDevEnvironmentStatus(cwd, env)
  if (!status.available || !status.executable || !status.cwd || !status.command) return status

  const child = spawn(status.executable, status.args || [], {
    cwd: status.cwd,
    detached: true,
    stdio: 'ignore',
    shell: false,
    env,
  })
  if (!child.pid) throw new Error('The development process did not return a process ID.')

  managedDevProcess = {
    child,
    pid: child.pid,
    cwd: status.cwd,
    projectName: status.projectName || path.basename(status.cwd),
    executable: status.executable,
    args: status.args || [],
    command: status.command,
    startedAt: Date.now(),
  }
  child.once('exit', () => clearManagedDevProcess(child))
  child.once('error', () => clearManagedDevProcess(child))
  child.unref()
  return currentManagedStatus() as DevEnvironmentStatus
}

function signalManagedProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ESRCH') return false
    throw error
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !processGroupExists(pid)
}

/** Stops only the process group previously started by IRIS. */
export async function stopManagedDevEnvironment(): Promise<DevEnvironmentStatus> {
  const current = managedDevProcess
  if (!current) {
    return {
      configured: true,
      available: false,
      running: false,
      reason: 'No development environment is running.',
    }
  }

  const signaled = signalManagedProcess(current.pid, 'SIGTERM')
  const stopped = !signaled || (await waitForProcessExit(current.pid, 3000))
  if (!stopped && signalManagedProcess(current.pid, 'SIGKILL')) {
    await waitForProcessExit(current.pid, 1000)
  }
  managedDevProcess = null

  return {
    configured: true,
    available: true,
    running: false,
    cwd: current.cwd,
    projectName: current.projectName,
    executable: current.executable,
    args: current.args,
    command: current.command,
    reason: 'Development environment stopped.',
  }
}

/** Ensures bridge shutdown cannot leave a managed development process orphaned. */
export async function closeManagedDevEnvironment(): Promise<void> {
  if (!managedDevProcess) return
  await stopManagedDevEnvironment().catch(() => undefined)
}
