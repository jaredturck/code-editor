/**
 * Covers capability-driven launcher catalog construction, including conditional application
 * cards, dynamic code-editor naming, encrypted-cache-compatible resolution, and managed
 * development workflow state.
 */

import { describe, expect, it } from 'vitest'
import {
  buildLauncherCatalog,
  resolveLauncherEntry,
  semanticApplicationLauncherEntry,
} from '@/platform/launcherCatalog'
import { initializeStorageForTests } from '@/platform/localStorageStore'
import type { BridgeLauncherDiscovery } from '@/platform/desktopBridge'

const discovery: BridgeLauncherDiscovery = {
  desktop: 'KDE',
  applications: [
    {
      capability: 'file_manager',
      displayName: 'Dolphin',
      executable: '/usr/bin/dolphin',
      args: [],
      source: 'cache',
      discoveredAt: 1,
    },
    {
      capability: 'terminal',
      displayName: 'Konsole',
      executable: '/usr/bin/konsole',
      args: [],
      source: 'cache',
      discoveredAt: 1,
    },
    {
      capability: 'code_editor',
      displayName: 'Sublime Text',
      executable: '/usr/bin/subl',
      args: [],
      source: 'path-candidate',
      discoveredAt: 1,
    },
  ],
  tools: [
    {
      capability: 'shell',
      displayName: 'bash',
      executable: '/bin/bash',
      args: [],
      source: 'environment',
      discoveredAt: 1,
    },
    {
      capability: 'git',
      displayName: 'Git',
      executable: '/usr/bin/git',
      args: [],
      source: 'path-candidate',
      discoveredAt: 1,
    },
  ],
}

describe('launcherCatalog', () => {
  it('shows only discovered application cards and uses the detected editor name', () => {
    const catalog = buildLauncherCatalog({
      shortcuts: [],
      discovery,
      workingDirectory: '/home/jared/project',
    })
    const names = catalog.map((entry) => entry.name)

    expect(names).toContain('Files')
    expect(names).toContain('Terminal')
    expect(names).toContain('Sublime Text')
    expect(names).not.toContain('Web Browser')
    expect(names).not.toContain('VS Code')
    expect(catalog.find((entry) => entry.name === 'Files')?.subtitle).toBe('Dolphin')
  })

  it('keeps start and stop as one managed pair without a port-kill command', () => {
    const catalog = buildLauncherCatalog({
      shortcuts: [],
      discovery,
      workingDirectory: '/home/jared/project',
      devStatus: {
        configured: true,
        available: true,
        running: true,
        pid: 4321,
        projectName: 'project',
        command: 'npm run dev',
      },
    })

    const start = catalog.find((entry) => entry.action === 'dev_start')
    const stop = catalog.find((entry) => entry.action === 'dev_stop')
    expect(start).toMatchObject({
      name: 'Start Dev Environment',
      disabled: true,
    })
    expect(stop).toMatchObject({
      name: 'Stop Dev Environment',
      disabled: false,
    })
    expect(stop?.subtitle).toContain('PID 4321')
    expect(catalog.some((entry) => entry.command.includes('lsof -t -i:3000'))).toBe(false)
  })

  it('maps semantic results to structured launch requests and wraps terminal applications', () => {
    const graphical = semanticApplicationLauncherEntry(
      {
        id: 'blender',
        name: 'Blender',
        genericName: '3D Creation Suite',
        description: 'Create 3D models and animations',
        keywords: ['3D'],
        categories: ['Graphics'],
        executable: '/usr/bin/blender',
        args: [],
        icon: 'blender',
        terminal: false,
        source: 'desktop_entry',
        sourceId: 'blender.desktop',
        searchOnly: false,
        metadataFingerprint: 'one',
        metadataText: 'Blender 3D',
        score: 0.9,
      },
      discovery,
    )
    expect(graphical).toMatchObject({
      name: 'Blender',
      executable: '/usr/bin/blender',
      args: [],
      icon: 'graphics',
      subtitle: 'Create 3D models and animations',
    })

    const terminalApp = semanticApplicationLauncherEntry(
      {
        id: 'htop',
        name: 'htop',
        genericName: 'Process Viewer',
        description: 'Interactive process monitor',
        keywords: ['process'],
        categories: ['System'],
        executable: '/usr/bin/htop',
        args: [],
        icon: '',
        terminal: true,
        source: 'desktop_entry',
        sourceId: 'htop.desktop',
        searchOnly: false,
        metadataFingerprint: 'two',
        metadataText: 'htop process monitor',
        score: 0.8,
      },
      discovery,
    )
    expect(terminalApp.executable).toBe('/usr/bin/konsole')
    expect(terminalApp.args?.join(' ')).toContain('/usr/bin/htop')
  })

  it('resolves cached application entries by visible name for agent launch', () => {
    initializeStorageForTests({
      iris_launcher_discovery: JSON.stringify(discovery),
      iris_launcher_shortcuts: '[]',
    })

    expect(
      resolveLauncherEntry('Sublime Text', {
        workingDirectory: '/home/jared/project',
        agentOnly: true,
      })?.executable,
    ).toBe('/usr/bin/subl')
    expect(
      resolveLauncherEntry('Web Browser', {
        workingDirectory: '/home/jared/project',
        agentOnly: true,
      }),
    ).toBeNull()
  })
})
