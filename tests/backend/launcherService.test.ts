/**
 * Verifies desktop capability discovery, exact-binary cache validation, and the managed
 * development process lifecycle without launching real desktop applications.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverLauncherCapabilities,
  getDevEnvironmentStatus,
  startManagedDevEnvironment,
  stopManagedDevEnvironment,
} from '../../backend/desktopBridge/services/launcherService'

const temporaryRoots: string[] = []

async function createExecutable(directory: string, name: string, content = 'exit 0'): Promise<string> {
  const filePath = path.join(directory, name)
  await fs.writeFile(filePath, `#!/bin/sh\n${content}\n`)
  await fs.chmod(filePath, 0o755)
  return filePath
}

afterEach(async () => {
  await stopManagedDevEnvironment().catch(() => undefined)
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('launcher service', () => {
  it('prefers desktop candidates and omits capabilities that cannot be resolved', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-launcher-discovery-'))
    temporaryRoots.push(root)
    const bin = path.join(root, 'bin')
    await fs.mkdir(bin)
    await createExecutable(bin, 'dolphin')
    await createExecutable(bin, 'konsole')
    await createExecutable(bin, 'subl')

    const result = await discoverLauncherCapabilities({
      env: {
        PATH: bin,
        HOME: root,
        SHELL: '/bin/sh',
        XDG_CURRENT_DESKTOP: 'KDE',
        XDG_DATA_HOME: path.join(root, 'share'),
        XDG_DATA_DIRS: path.join(root, 'system-share'),
      },
      homeDir: root,
    })

    expect(result.applications.find((item) => item.capability === 'file_manager')).toMatchObject({
      displayName: 'Dolphin',
      source: 'desktop-candidate',
    })
    expect(result.applications.find((item) => item.capability === 'terminal')?.displayName).toBe('Konsole')
    expect(result.applications.find((item) => item.capability === 'code_editor')?.displayName).toBe('Sublime Text')
    expect(result.applications.some((item) => item.capability === 'web_browser')).toBe(false)
  })

  it('prefers the registered default browser over an installed fallback browser', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-launcher-default-'))
    temporaryRoots.push(root)
    const bin = path.join(root, 'bin')
    const applications = path.join(root, 'share', 'applications')
    await fs.mkdir(bin, { recursive: true })
    await fs.mkdir(applications, { recursive: true })
    const customBrowser = await createExecutable(bin, 'custom-browser')
    await createExecutable(bin, 'firefox')
    await createExecutable(bin, 'xdg-settings', 'if [ "$1" = "get" ]; then echo custom-browser.desktop; fi')
    await fs.writeFile(
      path.join(applications, 'custom-browser.desktop'),
      ['[Desktop Entry]', 'Type=Application', 'Name=Custom Browser', `Exec=${customBrowser} --profile iris %u`].join(
        '\n',
      ),
    )

    const result = await discoverLauncherCapabilities({
      env: {
        PATH: bin,
        HOME: root,
        SHELL: '/bin/sh',
        XDG_DATA_HOME: path.join(root, 'share'),
        XDG_DATA_DIRS: path.join(root, 'system-share'),
      },
      homeDir: root,
    })

    expect(result.applications.find((item) => item.capability === 'web_browser')).toMatchObject({
      displayName: 'Custom Browser',
      executable: customBrowser,
      args: ['--profile', 'iris'],
      source: 'desktop-default',
    })
  })

  it('reuses a cached exact binary without searching the fallback list again', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-launcher-cache-'))
    temporaryRoots.push(root)
    const browser = await createExecutable(root, 'custom-browser')

    const result = await discoverLauncherCapabilities({
      cached: {
        applications: [
          {
            capability: 'web_browser',
            displayName: 'Custom Browser',
            executable: browser,
            args: ['--profile', 'iris'],
            discoveredAt: 1,
          },
        ],
        tools: [],
      },
      env: {
        PATH: '',
        HOME: root,
        SHELL: '/bin/sh',
        XDG_DATA_HOME: path.join(root, 'share'),
        XDG_DATA_DIRS: path.join(root, 'system-share'),
      },
      homeDir: root,
    })

    expect(result.applications.find((item) => item.capability === 'web_browser')).toMatchObject({
      displayName: 'Custom Browser',
      executable: browser,
      args: ['--profile', 'iris'],
      source: 'cache',
    })
  })

  it.skipIf(process.platform === 'win32')('starts and stops only the managed development process group', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-launcher-dev-'))
    temporaryRoots.push(root)
    const bin = path.join(root, 'bin')
    await fs.mkdir(bin)
    await createExecutable(bin, 'npm', 'sleep 30')
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { dev: 'demo' } }))
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}')
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    }

    const detected = await getDevEnvironmentStatus(root, env)
    expect(detected).toMatchObject({
      available: true,
      running: false,
      command: 'npm run dev',
    })

    const running = await startManagedDevEnvironment(root, env)
    expect(running.running).toBe(true)
    expect(running.pid).toBeTypeOf('number')

    const stopped = await stopManagedDevEnvironment()
    expect(stopped.running).toBe(false)
    expect(stopped.reason).toContain('stopped')
  })
})
