/** Covers immediate directory browsing and on-demand image previews for the Files panel. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createVideoThumbnail: vi.fn(),
}))

vi.mock('../../server/desktopBridge/services/fileVideoService.js', () => ({
  createVideoThumbnail: mocks.createVideoThumbnail,
}))

import {
  browseDirectory,
  clearFileThumbnailCache,
  createFileThumbnail,
  isVideoFilePath,
  videoMimeTypeForPath,
} from '../../server/desktopBridge/services/fileBrowserService'

const temporaryRoots: string[] = []

beforeEach(() => {
  mocks.createVideoThumbnail.mockReset()
  mocks.createVideoThumbnail.mockResolvedValue({
    buffer: Buffer.from('jpeg thumbnail'),
    width: 120,
    height: 120,
  })
})

afterEach(async () => {
  clearFileThumbnailCache()
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('file browser service', () => {
  it('lists only immediate files and directories with sortable metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-browser-'))
    temporaryRoots.push(root)
    await fs.mkdir(path.join(root, 'Pictures'))
    await fs.writeFile(path.join(root, 'notes.txt'), 'hello')
    await fs.writeFile(path.join(root, 'photo.png'), Buffer.from('image'))
    await fs.writeFile(path.join(root, 'video.mp4'), Buffer.from('video'))

    const result = await browseDirectory(root, root)

    expect(result).toMatchObject({
      currentPath: root,
      parentPath: null,
      truncated: false,
    })
    expect(result.entries.map((entry) => entry.name)).toEqual(['Pictures', 'notes.txt', 'photo.png', 'video.mp4'])
    expect(result.entries.find((entry) => entry.name === 'photo.png')).toMatchObject({
      type: 'file',
      extension: '.png',
      isImage: true,
      size: 5,
    })
    expect(result.entries.find((entry) => entry.name === 'video.mp4')).toMatchObject({
      type: 'file',
      extension: '.mp4',
      isImage: false,
      isVideo: true,
      size: 5,
    })
  })

  it('hides excluded directories and rejects direct navigation into them', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-exclusions-'))
    temporaryRoots.push(root)
    await fs.mkdir(path.join(root, 'Documents'))
    await fs.mkdir(path.join(root, '.hidden'))
    await fs.mkdir(path.join(root, 'node_modules'))
    await fs.mkdir(path.join(root, 'venv'))

    const result = await browseDirectory(root, root)

    expect(result.entries.map((entry) => entry.name)).toEqual(['Documents'])
    await expect(browseDirectory(path.join(root, 'node_modules'), root)).rejects.toThrow(/excluded/i)
  })

  it('recognizes video extensions and returns browser media types', () => {
    expect(isVideoFilePath('clip.mp4')).toBe(true)
    expect(isVideoFilePath('clip.webm')).toBe(true)
    expect(isVideoFilePath('notes.txt')).toBe(false)
    expect(videoMimeTypeForPath('clip.mp4')).toBe('video/mp4')
    expect(videoMimeTypeForPath('clip.webm')).toBe('video/webm')
  })

  it('returns a data URL preview without persisting a thumbnail file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-file-thumbnail-'))
    temporaryRoots.push(root)
    const imagePath = path.join(root, 'photo.png')
    await fs.writeFile(imagePath, Buffer.from('small image payload'))

    const result = await createFileThumbnail(imagePath, 120, 120)

    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.modifiedAt).toBeGreaterThan(0)
    expect((await fs.readdir(root)).sort()).toEqual(['photo.png'])
  })

  it('returns a cached FFmpeg video frame without persisting a thumbnail file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-video-thumbnail-'))
    temporaryRoots.push(root)
    const videoPath = path.join(root, 'clip.mp4')
    await fs.writeFile(videoPath, Buffer.from('video payload'))

    const first = await createFileThumbnail(videoPath, 120, 120)
    const second = await createFileThumbnail(videoPath, 120, 120)

    expect(first.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(second).toEqual(first)
    expect(mocks.createVideoThumbnail).toHaveBeenCalledOnce()
    expect(mocks.createVideoThumbnail).toHaveBeenCalledWith(videoPath, 120, 120)
    expect((await fs.readdir(root)).sort()).toEqual(['clip.mp4'])
  })
})
