/** Verifies Linux index-location discovery, default selection, and unavailable-drive handling. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const processMocks = vi.hoisted(() => ({
  run: vi.fn(),
}))

const databaseMocks = vi.hoisted(() => ({
  meta: null as Record<string, unknown> | null,
}))

vi.mock('../../backend/desktopBridge/shared/processExecution', () => ({
  runProcess: processMocks.run,
}))

vi.mock('../../backend/desktopBridge/storage/encryptedDatabase', () => ({
  readEncryptedFileIndexMeta: vi.fn(async () => databaseMocks.meta),
}))

import {
  discoverFileIndexSources,
  getFileIndexAccessRoots,
  getFileIndexSourceState,
  resolveSelectedFileIndexSources,
} from '../../backend/desktopBridge/services/fileIndexSourceService'

let root = ''
let home = ''
let internal = ''
let removable = ''
let network = ''
let loop = ''

beforeEach(async () => {
  processMocks.run.mockReset()
  databaseMocks.meta = null
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-index-sources-'))
  home = path.join(root, 'home')
  internal = path.join(root, 'projects')
  removable = path.join(root, 'usb')
  network = path.join(root, 'share')
  loop = path.join(root, 'loop')
  await Promise.all(
    [home, internal, removable, network, loop].map((directory) => fs.mkdir(directory, { recursive: true })),
  )

  processMocks.run.mockImplementation(async (executable: string) => {
    if (executable === 'findmnt') {
      return {
        stdout: JSON.stringify({
          filesystems: [
            {
              target: '/',
              source: '/dev/nvme0n1p1',
              fstype: 'ext4',
              size: 1000,
            },
            {
              target: home,
              source: '/dev/nvme0n1p2',
              fstype: 'ext4',
              size: 2000,
            },
            {
              target: internal,
              source: '/dev/sdb1',
              fstype: 'btrfs',
              size: 3000,
            },
            {
              target: removable,
              source: '/dev/sdc1',
              fstype: 'exfat',
              size: 4000,
            },
            {
              target: network,
              source: 'nas:/media',
              fstype: 'nfs4',
              size: 5000,
            },
            {
              target: loop,
              source: '/dev/loop4',
              fstype: 'squashfs',
              size: 6000,
            },
          ],
        }),
        stderr: '',
        exitCode: 0,
      }
    }
    return {
      stdout: JSON.stringify({
        blockdevices: [
          {
            path: '/dev/nvme0n1p2',
            name: 'nvme0n1p2',
            type: 'part',
            fstype: 'ext4',
            size: 2000,
            mountpoints: [home],
            rm: false,
            ro: false,
            tran: 'nvme',
            uuid: 'HOME-UUID',
            label: 'Home',
          },
          {
            path: '/dev/sdb1',
            name: 'sdb1',
            type: 'part',
            fstype: 'btrfs',
            size: 3000,
            mountpoints: [internal],
            rm: false,
            ro: false,
            tran: 'sata',
            uuid: 'PROJECTS-UUID',
            label: 'Projects',
          },
          {
            path: '/dev/sdc1',
            name: 'sdc1',
            type: 'part',
            fstype: 'exfat',
            size: 4000,
            mountpoints: [removable],
            rm: true,
            ro: false,
            tran: 'usb',
            uuid: 'USB-UUID',
            label: 'Backup USB',
          },
          {
            path: '/dev/loop4',
            name: 'loop4',
            type: 'loop',
            fstype: 'squashfs',
            size: 6000,
            mountpoints: [loop],
            rm: false,
            ro: true,
            tran: null,
            uuid: 'LOOP-UUID',
            label: 'Loop',
          },
        ],
      }),
      stderr: '',
      exitCode: 0,
    }
  })
})

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true })
})

describe('file index source service', () => {
  it('selects Home and internal drives by default while leaving removable and network mounts optional', async () => {
    const discovered = await discoverFileIndexSources(home)

    expect(discovered.map((source) => source.kind)).toEqual(['home', 'removable', 'internal', 'network'])
    expect(discovered.some((source) => source.path === loop)).toBe(false)
    const projects = discovered.find((source) => source.path === internal)!
    expect(projects.id).toBe('uuid:projects-uuid')

    const selection = await resolveSelectedFileIndexSources(home)
    expect(selection.sources.map((source) => source.label)).toEqual(['Home', 'Projects'])

    const usb = discovered.find((source) => source.path === removable)!
    const explicit = await resolveSelectedFileIndexSources(home, [usb.id])
    expect(explicit.sources.map((source) => source.label)).toEqual(['Home', 'Backup USB'])
  })

  it('keeps missing locked sources visible but omits them from active File Manager roots', async () => {
    const missingPath = path.join(root, 'missing-drive')
    databaseMocks.meta = {
      status: 'complete',
      sources: [
        {
          id: 'uuid:missing',
          label: 'Archive',
          path: missingPath,
          kind: 'internal',
          filesystem: 'ext4',
          device: '/dev/sdd1',
          size: 100,
          uuid: 'MISSING',
          removable: false,
          network: false,
          readOnly: false,
          available: true,
          alwaysSelected: false,
          selectedByDefault: true,
        },
      ],
    }

    const state = await getFileIndexSourceState(home)
    expect(state.locked).toBe(true)
    expect(state.sources.find((source) => source.id === 'uuid:missing')).toMatchObject({
      path: missingPath,
      available: false,
    })

    await expect(getFileIndexAccessRoots(home)).resolves.toEqual([await fs.realpath(home)])
  })

  it('follows a UUID-backed drive when its mount path changes', async () => {
    const oldPath = path.join(root, 'old-projects-mount')
    databaseMocks.meta = {
      status: 'complete',
      sources: [
        {
          id: 'uuid:projects-uuid',
          label: 'Projects',
          path: oldPath,
          kind: 'internal',
          filesystem: 'btrfs',
          device: '/dev/sdb1',
          size: 3000,
          uuid: 'PROJECTS-UUID',
          removable: false,
          network: false,
          readOnly: false,
          available: true,
          alwaysSelected: false,
          selectedByDefault: true,
        },
      ],
    }

    const state = await getFileIndexSourceState(home)
    expect(state.sources.find((source) => source.id === 'uuid:projects-uuid')).toMatchObject({
      path: internal,
      available: true,
    })
    await expect(getFileIndexAccessRoots(home)).resolves.toEqual([await fs.realpath(home), await fs.realpath(internal)])
  })
})
