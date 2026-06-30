import { randomUUID } from 'node:crypto'
import { access, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'

export type OpenedFileKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'unsupported'

export interface OpenedFileResult {
  status: 'opened'
  kind: OpenedFileKind
  file_path: string
  name: string
  content?: string
  resource_url?: string
  mime_type: string
  size: number
}

const resource_paths = new Map<string, string>()
const path_tokens = new Map<string, string>()

const mime_types: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
}

const image_extensions = new Set(['.apng', '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const video_extensions = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.ogv', '.webm'])
const audio_extensions = new Set(['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav'])

export function get_file_kind(file_path: string): OpenedFileKind {
  const extension = extname(file_path).toLowerCase()

  if (image_extensions.has(extension)) {
    return 'image'
  }

  if (video_extensions.has(extension)) {
    return 'video'
  }

  if (audio_extensions.has(extension)) {
    return 'audio'
  }

  if (extension === '.pdf') {
    return 'pdf'
  }

  return 'text'
}

export function register_resource(file_path: string) {
  const normalized_path = resolve(file_path)
  const existing_token = path_tokens.get(normalized_path)

  if (existing_token) {
    return `editor-file://resource/${existing_token}`
  }

  const token = randomUUID()
  resource_paths.set(token, normalized_path)
  path_tokens.set(normalized_path, token)

  return `editor-file://resource/${token}`
}

export function get_resource_path(url: string) {
  const parsed = new URL(url)

  if (parsed.protocol !== 'editor-file:' || parsed.hostname !== 'resource') {
    return null
  }

  const token = parsed.pathname.replace(/^\//, '')
  return resource_paths.get(token) ?? null
}

export async function open_editor_file(file_path: string): Promise<OpenedFileResult> {
  const file_stat = await stat(file_path)
  const kind = get_file_kind(file_path)
  const extension = extname(file_path).toLowerCase()
  const base = {
    status: 'opened' as const,
    kind,
    file_path,
    name: basename(file_path),
    mime_type: mime_types[extension] ?? 'application/octet-stream',
    size: file_stat.size,
  }

  if (kind !== 'text') {
    return {
      ...base,
      resource_url: register_resource(file_path),
    }
  }

  const content = await readFile(file_path, 'utf8')

  if (content.includes('\0')) {
    return {
      ...base,
      kind: 'unsupported',
      resource_url: register_resource(file_path),
    }
  }

  return {
    ...base,
    content,
    mime_type: 'text/plain',
  }
}

export async function file_exists(file_path: string) {
  return access(file_path)
    .then(() => true)
    .catch(() => false)
}

export async function resolve_relative_file(base_file_path: string, relative_path: string) {
  if (!base_file_path || !relative_path || /^(?:https?:|data:|mailto:|#)/i.test(relative_path)) {
    return null
  }

  const decoded_path = decodeURIComponent(relative_path.split('#')[0].split('?')[0])
  const target_path = isAbsolute(decoded_path) ? resolve(decoded_path) : resolve(dirname(base_file_path), decoded_path)

  if (!(await file_exists(target_path))) {
    return null
  }

  return {
    file_path: target_path,
    resource_url: register_resource(target_path),
  }
}

export async function read_attachment(file_path: string) {
  const file_stat = await stat(file_path)
  const kind = get_file_kind(file_path)
  const extension = extname(file_path).toLowerCase()

  if (file_stat.size > 12 * 1024 * 1024) {
    throw new Error(`${basename(file_path)} is larger than the 12 MB attachment limit.`)
  }

  const data = await readFile(file_path)

  if (kind === 'image') {
    return {
      name: basename(file_path),
      type: 'image' as const,
      mime_type: mime_types[extension] ?? 'image/png',
      content: data.toString('base64'),
    }
  }

  if (kind !== 'text') {
    throw new Error(`${basename(file_path)} is not a supported text or image attachment.`)
  }

  const content = data.toString('utf8')

  if (content.includes('\0')) {
    throw new Error(`${basename(file_path)} is not a supported text or image attachment.`)
  }

  return {
    name: basename(file_path),
    type: 'text' as const,
    mime_type: 'text/plain',
    content: content.slice(0, 100_000),
  }
}
