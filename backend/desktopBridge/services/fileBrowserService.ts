/**
 * Provides the bounded directory and thumbnail operations used by the graphical Files panel.
 * Files remain the source of truth; previews are generated on demand and cached only in memory
 * for the lifetime of the bridge process.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isExcludedDirectoryName, pathContainsExcludedDirectory } from '../shared/fileExclusions.js'
import { createVideoThumbnail } from './fileVideoService.js'

const MAX_DIRECTORY_ENTRIES = 1000
const MAX_FALLBACK_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_THUMBNAIL_CACHE_ENTRIES = 256
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'])

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
}

const VIDEO_MIME_TYPES: Record<string, string> = {
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
}

export interface FileBrowserEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
  extension: string
  isImage: boolean
  isVideo: boolean
}

export interface FileBrowserDirectory {
  currentPath: string
  parentPath: string | null
  entries: FileBrowserEntry[]
  truncated: boolean
}

export interface FileThumbnailResult {
  dataUrl: string
  width: number
  height: number
  modifiedAt: number
}

interface ThumbnailCacheEntry extends FileThumbnailResult {
  key: string
}

const thumbnailCache = new Map<string, ThumbnailCacheEntry>()

function imageExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(imageExtension(filePath))
}

export function isVideoFilePath(filePath: string): boolean {
  return Boolean(VIDEO_MIME_TYPES[imageExtension(filePath)])
}

export function videoMimeTypeForPath(filePath: string): string {
  return VIDEO_MIME_TYPES[imageExtension(filePath)] || ''
}

function rememberThumbnail(entry: ThumbnailCacheEntry): FileThumbnailResult {
  thumbnailCache.delete(entry.key)
  thumbnailCache.set(entry.key, entry)
  while (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
    const oldest = thumbnailCache.keys().next().value
    if (!oldest) break
    thumbnailCache.delete(oldest)
  }
  return entry
}

/** Lists the immediate children of one directory for the icon-grid file browser. */
export async function browseDirectory(targetPath: string, rootPath: string): Promise<FileBrowserDirectory> {
  if (pathContainsExcludedDirectory(rootPath, targetPath, true)) {
    throw new Error('This directory is excluded from the File Manager')
  }
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  const visible = entries
    .filter(
      (entry) =>
        !entry.isSymbolicLink() &&
        (entry.isDirectory() || entry.isFile()) &&
        !(entry.isDirectory() && isExcludedDirectoryName(entry.name)),
    )
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1
      if (!left.isDirectory() && right.isDirectory()) return 1
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
      })
    })
  const selected = visible.slice(0, MAX_DIRECTORY_ENTRIES)
  const results = await Promise.all(
    selected.map(async (entry): Promise<FileBrowserEntry | null> => {
      const entryPath = path.join(targetPath, entry.name)
      try {
        const stats = await fs.stat(entryPath)
        const extension = entry.isFile() ? path.extname(entry.name).toLowerCase() : ''
        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? stats.size : 0,
          modifiedAt: stats.mtimeMs,
          extension: extension.toLowerCase(),
          isImage: entry.isFile() && isImageFilePath(entry.name),
          isVideo: entry.isFile() && isVideoFilePath(entry.name),
        }
      } catch {
        return null
      }
    }),
  )
  const parent = path.dirname(targetPath)
  return {
    currentPath: targetPath,
    parentPath: targetPath === rootPath ? null : parent,
    entries: results.filter((entry): entry is FileBrowserEntry => Boolean(entry)),
    truncated: visible.length > selected.length,
  }
}

async function electronThumbnail(
  targetPath: string,
  width: number,
  height: number,
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  try {
    const electron = await import('electron')
    if (!electron.nativeImage) return null
    let image = electron.nativeImage.createFromPath(targetPath)
    if (image.isEmpty() && electron.nativeImage.createThumbnailFromPath) {
      image = await electron.nativeImage.createThumbnailFromPath(targetPath, {
        width,
        height,
      })
    }
    if (image.isEmpty()) return null
    const original = image.getSize()
    const scale = Math.min(width / original.width, height / original.height, 1)
    const targetWidth = Math.max(1, Math.round(original.width * scale))
    const targetHeight = Math.max(1, Math.round(original.height * scale))
    const resized = image.resize({
      width: targetWidth,
      height: targetHeight,
      quality: 'good',
    })
    const size = resized.getSize()
    return { buffer: resized.toPNG(), width: size.width, height: size.height }
  } catch {
    return null
  }
}

/** Generates a bounded image or video preview without creating a persistent thumbnail file. */
export async function createFileThumbnail(
  targetPath: string,
  requestedWidth: number,
  requestedHeight: number,
): Promise<FileThumbnailResult> {
  const isImage = isImageFilePath(targetPath)
  const isVideo = isVideoFilePath(targetPath)
  if (!isImage && !isVideo) throw new Error('Thumbnail previews are only available for images and videos')
  const width = Math.max(32, Math.min(1600, Math.floor(requestedWidth || 240)))
  const height = Math.max(32, Math.min(1600, Math.floor(requestedHeight || 240)))
  const stats = await fs.stat(targetPath)
  const key = `${targetPath}\u0000${stats.mtimeMs}\u0000${width}x${height}`
  const cached = thumbnailCache.get(key)
  if (cached) return rememberThumbnail(cached)

  if (isVideo) {
    const generated = await createVideoThumbnail(targetPath, width, height)
    return rememberThumbnail({
      key,
      dataUrl: `data:image/jpeg;base64,${generated.buffer.toString('base64')}`,
      width: generated.width,
      height: generated.height,
      modifiedAt: stats.mtimeMs,
    })
  }

  const generated = await electronThumbnail(targetPath, width, height)
  if (generated) {
    return rememberThumbnail({
      key,
      dataUrl: `data:image/png;base64,${generated.buffer.toString('base64')}`,
      width: generated.width,
      height: generated.height,
      modifiedAt: stats.mtimeMs,
    })
  }

  if (stats.size > MAX_FALLBACK_IMAGE_BYTES) {
    throw new Error('Image is too large to preview outside the Electron runtime')
  }
  const extension = imageExtension(targetPath)
  const buffer = await fs.readFile(targetPath)
  return rememberThumbnail({
    key,
    dataUrl: `data:${IMAGE_MIME_TYPES[extension] || 'application/octet-stream'};base64,${buffer.toString('base64')}`,
    width: 0,
    height: 0,
    modifiedAt: stats.mtimeMs,
  })
}

function launchDetached(executable: string, args: string[]): void {
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
    shell: false,
  })
  child.unref()
}

/** Opens a file through the operating system's associated application. */
export async function openFileWithSystem(targetPath: string): Promise<void> {
  const electron = await import('electron').catch(() => null)
  if (electron?.shell?.openPath) {
    const error = await electron.shell.openPath(targetPath)
    if (error) throw new Error(error)
    return
  }

  if (process.platform === 'darwin') launchDetached('open', [targetPath])
  else if (process.platform === 'win32') launchDetached('cmd.exe', ['/c', 'start', '', targetPath])
  else launchDetached('xdg-open', [targetPath])
}

/** Reveals a file in the operating system's file manager. */
export async function revealFileInFolder(targetPath: string): Promise<void> {
  const electron = await import('electron').catch(() => null)
  if (electron?.shell?.showItemInFolder) {
    electron.shell.showItemInFolder(targetPath)
    return
  }

  if (process.platform === 'darwin') {
    launchDetached('open', ['-R', targetPath])
    return
  }
  if (process.platform === 'win32') {
    launchDetached('explorer.exe', ['/select,', targetPath])
    return
  }

  const stats = await fs.stat(targetPath)
  launchDetached('xdg-open', [stats.isDirectory() ? targetPath : path.dirname(targetPath)])
}

/** Clears in-memory thumbnails when application data is cleared or the bridge shuts down. */
export function clearFileThumbnailCache(): void {
  thumbnailCache.clear()
}
