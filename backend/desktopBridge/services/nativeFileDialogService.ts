/**
 * Exposes the native file dialog capabilities used by bridge route handlers. The facade
 * keeps routes dependent on a focused contract while shared state and implementation remain
 * in the bridge runtime.
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import sharp from 'sharp'

export interface NativeFileDialogOptions {
  multiple: boolean
  accept: string[]
}

export interface NativeFileDialogFile {
  name: string
  path: string
  type: string
  base64: string | null
  text: string | null
  width?: number
  height?: number
  size?: number
}

export interface NativeFileDialogResult {
  files: NativeFileDialogFile[]
  canceled?: boolean
  useNativeFallback?: boolean
  error?: string
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const DIALOG_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const MAX_SELECTED_FILE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 2048

function toDialogExtensions(value: string): string[] {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return []
  if (normalized === 'image/*') return DIALOG_IMAGE_EXTENSIONS
  const extension = normalized.replace(/^\*\./, '').replace(/^\./, '')
  return extension && !extension.includes('/') ? [extension] : []
}

export interface NativeFileDialogFilter {
  name: string
  extensions: string[]
}

/** Builds human-readable native dialog filters from the renderer's accepted extensions. */
export function buildNativeFileDialogFilters(accept: readonly string[]): NativeFileDialogFilter[] {
  const extensions = Array.from(new Set(accept.flatMap(toDialogExtensions)))
  if (!extensions.length) return []

  const images = extensions.filter((extension) => IMAGE_EXTENSIONS.has(extension))
  const text = extensions.filter((extension) => !IMAGE_EXTENSIONS.has(extension))
  const filters: NativeFileDialogFilter[] = [
    {
      name: images.length && text.length ? 'Supported files' : images.length ? 'Images' : 'Text files',
      extensions,
    },
  ]

  if (images.length && text.length) {
    filters.push({ name: 'Images', extensions: images })
    filters.push({ name: 'Text files', extensions: text })
  }
  return filters
}

async function normalizeSelectedImage(
  buffer: Buffer,
  extension: string,
): Promise<{ buffer: Buffer; type: string; width?: number; height?: number }> {
  const pipeline = sharp(buffer, { animated: false, failOn: 'none' }).rotate().resize({
    width: MAX_IMAGE_DIMENSION,
    height: MAX_IMAGE_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  })

  let output: Buffer
  let type: string
  if (extension === 'png') {
    output = await pipeline.png({ compressionLevel: 8 }).toBuffer()
    type = 'image/png'
  } else if (extension === 'webp') {
    output = await pipeline.webp({ quality: 88 }).toBuffer()
    type = 'image/webp'
  } else {
    output = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    type = 'image/jpeg'
  }
  const metadata = await sharp(output).metadata()
  return {
    buffer: output,
    type,
    width: metadata.width,
    height: metadata.height,
  }
}

// Reads a selected local file into the bounded representation returned to the renderer.
async function readSelectedFile(filePath: string): Promise<NativeFileDialogFile> {
  const buffer = await readFile(filePath)
  if (buffer.length > MAX_SELECTED_FILE_BYTES) {
    throw new Error(`${basename(filePath)} is larger than the 12 MB attachment limit`)
  }

  const extension = extname(filePath).slice(1).toLowerCase()
  const isImage = IMAGE_EXTENSIONS.has(extension)
  if (isImage) {
    const normalized = await normalizeSelectedImage(buffer, extension)
    return {
      name: basename(filePath),
      path: filePath,
      type: normalized.type,
      base64: normalized.buffer.toString('base64'),
      text: null,
      width: normalized.width,
      height: normalized.height,
      size: normalized.buffer.length,
    }
  }

  return {
    name: basename(filePath),
    path: filePath,
    type: 'text/plain',
    base64: null,
    text: buffer.toString('utf8').slice(0, 100000),
    size: buffer.length,
  }
}

// Renders the open native file dialog and coordinates its user-facing state.
export async function openNativeFileDialog(options: NativeFileDialogOptions): Promise<NativeFileDialogResult> {
  try {
    const electron = await import('electron').catch(() => null)
    if (!electron?.dialog) {
      return { files: [], useNativeFallback: true }
    }

    const filters = buildNativeFileDialogFilters(options.accept)
    const result = await electron.dialog.showOpenDialog({
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: filters.length ? filters : undefined,
    })

    if (result.canceled || !result.filePaths?.length) {
      return { files: [], canceled: true }
    }

    return {
      files: await Promise.all(result.filePaths.map(readSelectedFile)),
      canceled: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { files: [], useNativeFallback: true, error: message }
  }
}
