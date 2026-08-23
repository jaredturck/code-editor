/**
 * Builds the launcher menu from encrypted user shortcuts, cached desktop capability
 * discovery, and managed workflow state. Application cards exist only when a verified
 * binary was found; the code-editor card uses the detected application's real name.
 */

import {
  discoverLauncherCapabilities,
  getDevEnvironmentStatus,
  type BridgeDevEnvironmentStatus,
  type BridgeLauncherCapability,
  type BridgeLauncherDiscovery,
  type BridgeLauncherSemanticApplication,
} from '@/platform/desktopBridge'
import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore'

export type LauncherCategory = 'app' | 'script' | 'command' | 'url'
export type LauncherAction = 'launch' | 'dev_start' | 'dev_stop' | 'clear_data'

export interface LauncherEntry {
  id: number | string
  name: string
  command: string
  icon: string
  category: LauncherCategory
  pinned?: boolean
  executable?: string
  args?: string[]
  cwd?: string
  subtitle?: string
  action?: LauncherAction
  disabled?: boolean
  disabledReason?: string
  capability?: string
  agentVisible?: boolean
}

export interface LauncherCatalogState {
  discovery: BridgeLauncherDiscovery
  devStatus: BridgeDevEnvironmentStatus
}

export const LAUNCHER_SHORTCUTS_STORAGE_KEY = 'iris_launcher_shortcuts'
export const LAUNCHER_DISCOVERY_STORAGE_KEY = 'iris_launcher_discovery'

const EMPTY_DISCOVERY: BridgeLauncherDiscovery = {
  desktop: '',
  applications: [],
  tools: [],
}

const EMPTY_DEV_STATUS: BridgeDevEnvironmentStatus = {
  configured: false,
  available: false,
  running: false,
  reason: 'No working directory configured.',
}

const APPLICATION_PRESENTATION: Record<string, { name: string; icon: string; dynamicName?: boolean }> = {
  file_manager: { name: 'Files', icon: 'files' },
  terminal: { name: 'Terminal', icon: 'terminal' },
  web_browser: { name: 'Web Browser', icon: 'web_network' },
  code_editor: { name: 'Code Editor', icon: 'code_editor', dynamicName: true },
  system_settings: { name: 'Settings', icon: 'settings' },
  calculator: { name: 'Calculator', icon: 'calculator' },
  text_editor: { name: 'Text Editor', icon: 'editor' },
  system_monitor: { name: 'System Monitor', icon: 'monitor' },
  email_client: { name: 'Email Client', icon: 'email' },
  software_center: { name: 'Software Center', icon: 'software_center' },
  password_manager: { name: 'Password Manager', icon: 'password' },
}

let latestDevStatus: BridgeDevEnvironmentStatus = EMPTY_DEV_STATUS

function normalizeDiscovery(value: unknown): BridgeLauncherDiscovery {
  if (!value || typeof value !== 'object') return EMPTY_DISCOVERY
  const record = value as Partial<BridgeLauncherDiscovery>
  return {
    desktop: String(record.desktop || ''),
    applications: Array.isArray(record.applications) ? record.applications.slice(0, 50) : [],
    tools: Array.isArray(record.tools) ? record.tools.slice(0, 30) : [],
  }
}

export function getLauncherDiscovery(): BridgeLauncherDiscovery {
  return normalizeDiscovery(readStorageJson<unknown>(LAUNCHER_DISCOVERY_STORAGE_KEY, EMPTY_DISCOVERY))
}

export function getLauncherShortcuts(): LauncherEntry[] {
  const parsed = readStorageJson<unknown>(LAUNCHER_SHORTCUTS_STORAGE_KEY, [])
  return Array.isArray(parsed) ? (parsed.slice(0, 100) as LauncherEntry[]) : []
}

function capabilityByName(values: BridgeLauncherCapability[], capability: string): BridgeLauncherCapability | null {
  return values.find((value) => value.capability === capability) || null
}

function quoteShellValue(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function terminalArguments(
  terminal: BridgeLauncherCapability,
  shell: BridgeLauncherCapability,
  command: string,
): string[] {
  const executable = terminal.executable.split('/').pop()?.toLowerCase() || ''
  const wrapped = `${command}; status=$?; printf '\nCommand exited with status %s. Press Enter to close...' "$status"; read -r _; exit "$status"`

  if (executable === 'gnome-terminal' || executable === 'kgx' || executable === 'mate-terminal') {
    return ['--', shell.executable, '-lc', wrapped]
  }
  if (executable === 'xfce4-terminal') {
    return ['--execute', shell.executable, '-lc', wrapped]
  }
  if (executable === 'wezterm') {
    return ['start', '--', shell.executable, '-lc', wrapped]
  }
  return ['-e', shell.executable, '-lc', wrapped]
}

function terminalWorkflowEntry({
  id,
  name,
  icon,
  command,
  category,
  terminal,
  shell,
  cwd,
  subtitle,
  agentVisible = false,
}: {
  id: string
  name: string
  icon: string
  command: string
  category: LauncherCategory
  terminal: BridgeLauncherCapability
  shell: BridgeLauncherCapability
  cwd?: string
  subtitle: string
  agentVisible?: boolean
}): LauncherEntry {
  return {
    id,
    name,
    icon,
    command,
    category,
    executable: terminal.executable,
    args: terminalArguments(terminal, shell, command),
    cwd,
    subtitle,
    agentVisible,
  }
}

function updateCommand(packageManager: BridgeLauncherCapability, privilegeHelper: BridgeLauncherCapability): string {
  const manager = packageManager.executable.split('/').pop() || ''
  const prefix = `${quoteShellValue(privilegeHelper.executable)} ${quoteShellValue(packageManager.executable)}`

  if (manager === 'pacman') return `${prefix} -Syu`
  if (manager === 'apt') return `${prefix} update && ${prefix} full-upgrade`
  if (manager === 'dnf') return `${prefix} upgrade --refresh`
  if (manager === 'zypper') return `${prefix} update`
  if (manager === 'apk') return `${prefix} update && ${prefix} upgrade`
  if (manager === 'xbps-install') return `${prefix} -Su`
  return ''
}

function semanticApplicationIcon(application: BridgeLauncherSemanticApplication): string {
  const categories = application.categories.map((value) => value.toLowerCase())
  if (application.source === 'steam' || categories.some((value) => value.includes('game'))) return 'controller'
  if (categories.some((value) => value.includes('graphics'))) return 'graphics'
  if (categories.some((value) => value.includes('audio') || value.includes('video'))) return 'clapperboard'
  if (categories.some((value) => value.includes('development'))) return 'code_editor'
  if (categories.some((value) => value.includes('office'))) return 'paper'
  if (categories.some((value) => value.includes('network'))) return 'web_network'
  return 'rocket'
}

/** Converts one semantic search result into the same structured launcher contract as curated cards. */
export function semanticApplicationLauncherEntry(
  application: BridgeLauncherSemanticApplication,
  discovery: BridgeLauncherDiscovery,
): LauncherEntry {
  const command = [application.executable, ...(application.args || [])].map(quoteShellValue).join(' ')
  const base = {
    id: `indexed-${application.id}`,
    name: application.name,
    command,
    icon: semanticApplicationIcon(application),
    category: 'app' as const,
    subtitle:
      application.description ||
      application.genericName ||
      application.categories.join(', ') ||
      'Installed application',
    capability: 'semantic_application',
    agentVisible: false,
  }

  if (!application.terminal) {
    return {
      ...base,
      executable: application.executable,
      args: application.args || [],
    }
  }

  const terminal = capabilityByName(discovery.applications, 'terminal')
  const shell = capabilityByName(discovery.tools, 'shell')
  if (!terminal || !shell) {
    return {
      ...base,
      disabled: true,
      disabledReason: 'A terminal application is required to run this program.',
    }
  }
  return {
    ...base,
    executable: terminal.executable,
    args: terminalArguments(terminal, shell, command),
  }
}

function buildApplicationEntries(discovery: BridgeLauncherDiscovery): LauncherEntry[] {
  return discovery.applications.flatMap((application) => {
    const presentation = APPLICATION_PRESENTATION[application.capability]
    if (!presentation) return []
    return [
      {
        id: `detected-${application.capability}`,
        name: presentation.dynamicName ? application.displayName : presentation.name,
        command: [application.executable, ...(application.args || [])].join(' '),
        executable: application.executable,
        args: application.args || [],
        icon: presentation.icon,
        category: 'app' as const,
        subtitle: presentation.dynamicName ? 'Code editor' : application.displayName,
        capability: application.capability,
      },
    ]
  })
}

function buildDevEntries(devStatus: BridgeDevEnvironmentStatus): LauncherEntry[] {
  const project = String(devStatus.projectName || '').trim()
  const command = String(devStatus.command || '').trim()
  const startSubtitle = devStatus.running
    ? `Running${project ? ` · ${project}` : ''}`
    : devStatus.available
      ? `${command}${project ? ` · ${project}` : ''}`
      : String(devStatus.reason || 'No supported development command found.')

  return [
    {
      id: 'workflow-dev-start',
      name: 'Start Dev Environment',
      command,
      icon: 'start_env',
      category: 'command',
      action: 'dev_start',
      subtitle: startSubtitle,
      disabled: devStatus.running || !devStatus.available,
      disabledReason: devStatus.running
        ? 'The managed development environment is already running.'
        : String(devStatus.reason || 'No supported development command found.'),
      agentVisible: false,
    },
    {
      id: 'workflow-dev-stop',
      name: 'Stop Dev Environment',
      command,
      icon: 'stop_env',
      category: 'command',
      action: 'dev_stop',
      subtitle: devStatus.running
        ? `${command || 'Managed process'}${devStatus.pid ? ` · PID ${devStatus.pid}` : ''}`
        : 'No managed development process is running.',
      disabled: !devStatus.running,
      disabledReason: 'No managed development process is running.',
      agentVisible: false,
    },
  ]
}

function buildWorkflowEntries(
  discovery: BridgeLauncherDiscovery,
  devStatus: BridgeDevEnvironmentStatus,
  workingDirectory: string,
): LauncherEntry[] {
  const entries = buildDevEntries(devStatus)
  const terminal = capabilityByName(discovery.applications, 'terminal')
  const shell = capabilityByName(discovery.tools, 'shell')
  const packageManager = capabilityByName(discovery.tools, 'package_manager')
  const privilegeHelper = capabilityByName(discovery.tools, 'privilege_helper')
  const dockerDesktop = capabilityByName(discovery.tools, 'docker_desktop')
  const docker = capabilityByName(discovery.tools, 'docker')
  const podmanDesktop = capabilityByName(discovery.tools, 'podman_desktop')
  const podman = capabilityByName(discovery.tools, 'podman')
  const git = capabilityByName(discovery.tools, 'git')

  if (terminal && shell && packageManager && privilegeHelper) {
    const command = updateCommand(packageManager, privilegeHelper)
    if (command) {
      entries.push(
        terminalWorkflowEntry({
          id: 'workflow-system-update',
          name: 'Update System',
          icon: 'update',
          command,
          category: 'script',
          terminal,
          shell,
          subtitle: `${packageManager.displayName} system update`,
        }),
      )
    }
  }

  entries.push({
    id: 'workflow-clear-data',
    name: 'Clear IRIS Data',
    command: 'Clear IRIS encrypted application data',
    icon: 'cleanup',
    category: 'script',
    action: 'clear_data',
    subtitle: 'Delete encrypted chats, settings, notes, skills, and artifacts',
    agentVisible: false,
  })

  if (dockerDesktop) {
    entries.push({
      id: 'workflow-docker',
      name: 'Docker',
      command: dockerDesktop.executable,
      executable: dockerDesktop.executable,
      args: dockerDesktop.args || [],
      icon: 'docker',
      category: 'app',
      subtitle: dockerDesktop.displayName,
    })
  } else if (docker && terminal && shell) {
    entries.push(
      terminalWorkflowEntry({
        id: 'workflow-docker',
        name: 'Docker',
        icon: 'docker',
        command: `${quoteShellValue(docker.executable)} ps`,
        category: 'command',
        terminal,
        shell,
        cwd: workingDirectory || undefined,
        subtitle: 'Show running Docker containers',
      }),
    )
  }

  if (podmanDesktop) {
    entries.push({
      id: 'workflow-podman',
      name: 'Podman',
      command: podmanDesktop.executable,
      executable: podmanDesktop.executable,
      args: podmanDesktop.args || [],
      icon: 'podman',
      category: 'app',
      subtitle: podmanDesktop.displayName,
    })
  } else if (podman && terminal && shell) {
    entries.push(
      terminalWorkflowEntry({
        id: 'workflow-podman',
        name: 'Podman',
        icon: 'podman',
        command: `${quoteShellValue(podman.executable)} ps`,
        category: 'command',
        terminal,
        shell,
        cwd: workingDirectory || undefined,
        subtitle: 'Show running Podman containers',
      }),
    )
  }

  if (git && terminal && shell) {
    entries.push(
      terminalWorkflowEntry({
        id: 'workflow-git-status',
        name: 'Git Status',
        icon: 'git',
        command: `${quoteShellValue(git.executable)} status`,
        category: 'command',
        terminal,
        shell,
        cwd: workingDirectory || undefined,
        subtitle: workingDirectory
          ? `Repository status · ${workingDirectory.split('/').pop() || workingDirectory}`
          : 'Configure a working directory in Settings',
      }),
    )
    if (!workingDirectory) {
      const gitEntry = entries[entries.length - 1]
      gitEntry.disabled = true
      gitEntry.disabledReason = 'Configure an agent working directory before running Git Status.'
    }
  }

  return entries
}

export function buildLauncherCatalog({
  shortcuts = getLauncherShortcuts(),
  discovery = getLauncherDiscovery(),
  devStatus = latestDevStatus,
  workingDirectory = '',
  agentOnly = false,
}: {
  shortcuts?: LauncherEntry[]
  discovery?: BridgeLauncherDiscovery
  devStatus?: BridgeDevEnvironmentStatus
  workingDirectory?: string
  agentOnly?: boolean
} = {}): LauncherEntry[] {
  const catalog = [
    ...shortcuts,
    ...buildApplicationEntries(discovery),
    ...buildWorkflowEntries(discovery, devStatus, workingDirectory),
  ]
  return agentOnly ? catalog.filter((entry) => entry.agentVisible !== false && !entry.disabled) : catalog
}

export function getLauncherCatalog(
  options: {
    workingDirectory?: string
    agentOnly?: boolean
  } = {},
): LauncherEntry[] {
  return buildLauncherCatalog(options)
}

export async function refreshLauncherCatalog(workingDirectory = '', force = false): Promise<LauncherCatalogState> {
  const cached = getLauncherDiscovery()
  const discovery = normalizeDiscovery(await discoverLauncherCapabilities(cached, force))
  writeStorageJson(LAUNCHER_DISCOVERY_STORAGE_KEY, discovery)
  latestDevStatus = await getDevEnvironmentStatus(workingDirectory)
  return { discovery, devStatus: latestDevStatus }
}

export function resolveLauncherEntry(
  query: string,
  options: { workingDirectory?: string; agentOnly?: boolean } = {},
): LauncherEntry | null {
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase()
  if (!normalizedQuery) return null
  const catalog = getLauncherCatalog(options)
  return (
    catalog.find((entry) => String(entry.name).toLowerCase() === normalizedQuery) ||
    catalog.find((entry) => String(entry.id).toLowerCase() === normalizedQuery) ||
    catalog.find((entry) => String(entry.command).toLowerCase() === normalizedQuery) ||
    catalog.find((entry) => String(entry.name).toLowerCase().includes(normalizedQuery)) ||
    null
  )
}
