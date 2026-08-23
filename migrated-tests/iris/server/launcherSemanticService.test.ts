/**
 * Covers installed-application discovery and Ollama-backed semantic ranking without contacting
 * a real model server or writing unencrypted launcher metadata.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  meta: null as Record<string, unknown> | null,
  applications: [] as Array<{
    id: string
    metadata: Record<string, unknown>
    embedding: number[]
  }>,
  save: vi.fn(),
}))

vi.mock('../../server/desktopBridge/storage/encryptedDatabase.js', () => ({
  readEncryptedLauncherIndexMeta: vi.fn(async () => storage.meta),
  readEncryptedLauncherApplications: vi.fn(async () => storage.applications),
  saveEncryptedLauncherIndex: vi.fn(
    async (meta: Record<string, unknown>, applications: typeof storage.applications) => {
      storage.meta = meta
      storage.applications = applications
      storage.save(meta, applications)
    },
  ),
}))

const temporaryRoots: string[] = []

async function createExecutable(directory: string, name: string): Promise<string> {
  const filePath = path.join(directory, name)
  await fs.writeFile(filePath, '#!/bin/sh\nexit 0\n')
  await fs.chmod(filePath, 0o755)
  return filePath
}

beforeEach(() => {
  storage.meta = null
  storage.applications = []
  storage.save.mockClear()
  vi.restoreAllMocks()
  vi.resetModules()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('launcher semantic service', () => {
  it('discovers desktop applications and installed Steam games with useful metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-semantic-discovery-'))
    temporaryRoots.push(root)
    const bin = path.join(root, 'bin')
    const applications = path.join(root, 'share', 'applications')
    const steamApps = path.join(root, '.local', 'share', 'Steam', 'steamapps')
    await fs.mkdir(bin, { recursive: true })
    await fs.mkdir(applications, { recursive: true })
    await fs.mkdir(steamApps, { recursive: true })
    const blender = await createExecutable(bin, 'blender')
    await createExecutable(bin, 'steam')
    await fs.writeFile(
      path.join(applications, 'org.blender.Blender.desktop'),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Blender',
        'GenericName=3D Creation Suite',
        'Comment=Create 3D models, animations and rendered scenes',
        'Keywords=3D;modeling;animation;rendering;',
        'Categories=Graphics;3DGraphics;',
        `Exec=${blender} %f`,
        'Icon=blender',
      ].join('\n'),
    )
    await fs.writeFile(
      path.join(steamApps, 'appmanifest_730.acf'),
      ['"AppState"', '{', '  "appid" "730"', '  "name" "Counter-Strike 2"', '}'].join('\n'),
    )

    const { discoverInstalledLauncherApplications } =
      await import('../../server/desktopBridge/services/launcherSemanticService')
    const result = await discoverInstalledLauncherApplications({
      env: {
        PATH: bin,
        HOME: root,
        SHELL: '/bin/sh',
        XDG_DATA_HOME: path.join(root, 'share'),
        XDG_DATA_DIRS: path.join(root, 'system-share'),
      },
      homeDir: root,
      applicationDirectories: [applications],
    })

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Blender',
          genericName: '3D Creation Suite',
          description: 'Create 3D models, animations and rendered scenes',
          keywords: expect.arrayContaining(['3D', 'modeling', 'animation']),
          executable: blender,
          args: [],
          source: 'desktop_entry',
        }),
        expect.objectContaining({
          name: 'Counter-Strike 2',
          genericName: 'Steam Game',
          executable: path.join(bin, 'steam'),
          args: ['-applaunch', '730'],
          source: 'steam',
        }),
      ]),
    )
  })

  it('reports a missing Ollama model without starting an index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3:latest' }] }),
        text: async (): Promise<string> => '',
      }),
    )
    const { getLauncherSemanticStatus, LAUNCHER_EMBEDDING_MODEL } =
      await import('../../server/desktopBridge/services/launcherSemanticService')

    await expect(getLauncherSemanticStatus(true)).resolves.toMatchObject({
      ollamaAvailable: true,
      modelInstalled: false,
      model: LAUNCHER_EMBEDDING_MODEL,
      indexStatus: 'missing',
      applicationCount: 0,
    })
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('downloads the fixed model through Ollama and builds the missing index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-semantic-install-'))
    temporaryRoots.push(root)
    const bin = path.join(root, 'bin')
    await fs.mkdir(bin, { recursive: true })
    const discoveryOptions = {
      env: {
        PATH: bin,
        HOME: root,
        SHELL: '/bin/sh',
        XDG_DATA_HOME: path.join(root, 'share'),
        XDG_DATA_DIRS: path.join(root, 'system-share'),
      },
      homeDir: root,
      applicationDirectories: [],
    }

    let installed = false
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({
            models: installed ? [{ name: 'qwen3-embedding:0.6b' }] : [],
          }),
          text: async (): Promise<string> => '',
        }
      }
      if (url.endsWith('/api/pull')) {
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
          model: 'qwen3-embedding:0.6b',
          stream: false,
        })
        installed = true
        return {
          ok: true,
          json: async () => ({ status: 'success' }),
          text: async (): Promise<string> => '',
        }
      }
      throw new Error(`Unexpected Ollama request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { getLauncherSemanticStatus, installLauncherSemanticModel } =
      await import('../../server/desktopBridge/services/launcherSemanticService')

    const initial = await getLauncherSemanticStatus(false)
    expect(initial.modelInstalled).toBe(false)

    await installLauncherSemanticModel(discoveryOptions)

    await vi.waitFor(
      () => {
        expect(storage.save).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'qwen3-embedding:0.6b',
            applicationCount: 0,
            status: 'complete',
          }),
          [],
        )
      },
      {
        timeout: 5000,
        interval: 20,
      },
    )
    await expect(getLauncherSemanticStatus(false)).resolves.toMatchObject({
      modelInstalled: true,
      indexStatus: 'ready',
      applicationCount: 0,
    })
  })

  it('embeds a query and orders encrypted application records by cosine similarity', async () => {
    storage.meta = {
      schemaVersion: 1,
      model: 'qwen3-embedding:0.6b',
      applicationCount: 2,
      generatedAt: 1,
      status: 'complete',
    }
    storage.applications = [
      {
        id: 'blender',
        metadata: {
          name: 'Blender',
          genericName: '3D Creation Suite',
          description: 'Create 3D models and animations',
          keywords: ['3D', 'modeling'],
          categories: ['Graphics'],
          executable: '/usr/bin/blender',
          args: [],
          icon: 'blender',
          terminal: false,
          source: 'desktop_entry',
          sourceId: 'blender.desktop',
          searchOnly: false,
          metadataFingerprint: 'one',
          metadataText: 'Blender 3D modelling',
        },
        embedding: [1, 0],
      },
      {
        id: 'okular',
        metadata: {
          name: 'Okular',
          genericName: 'Document Viewer',
          description: 'Read PDF documents',
          keywords: ['PDF'],
          categories: ['Office'],
          executable: '/usr/bin/okular',
          args: [],
          icon: 'okular',
          terminal: false,
          source: 'desktop_entry',
          sourceId: 'okular.desktop',
          searchOnly: false,
          metadataFingerprint: 'two',
          metadataText: 'Okular PDF reader',
        },
        embedding: [0, 1],
      },
    ]
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/embed')) {
        return {
          ok: true,
          json: async () => ({ embeddings: [[1, 0]] }),
          text: async (): Promise<string> => '',
        }
      }
      return {
        ok: true,
        json: async () => ({
          models: [{ name: 'qwen3-embedding:0.6b' }],
        }),
        text: async (): Promise<string> => '',
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { searchLauncherSemanticIndex } = await import('../../server/desktopBridge/services/launcherSemanticService')

    const result = await searchLauncherSemanticIndex('3D modelling', 2)

    expect(result.map((application) => application.name)).toEqual(['Blender', 'Okular'])
    expect(result[0].score).toBeCloseTo(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
