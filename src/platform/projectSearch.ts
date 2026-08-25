interface WorkspaceSearchFile {
  path: string
  name: string
}

export interface ProjectTextSearchMatch {
  file: string
  line: number
  content: string
}

export interface ProjectTextSearchOptions {
  ignoreCase?: boolean
  useRegex?: boolean
  wordBoundary?: boolean
  maxResults?: number
}

const ignored_directories = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.vite',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
])

const binary_extensions = new Set([
  '.7z',
  '.a',
  '.avi',
  '.bin',
  '.bmp',
  '.class',
  '.db',
  '.dll',
  '.doc',
  '.docx',
  '.dylib',
  '.eot',
  '.exe',
  '.flac',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.lockb',
  '.m4a',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.odg',
  '.odp',
  '.ods',
  '.odt',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.pyc',
  '.rar',
  '.so',
  '.sqlite',
  '.sqlite3',
  '.tar',
  '.tgz',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.xz',
  '.zip',
])

function extension_of(file_path: string) {
  const name = file_path.replace(/\\/g, '/').split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function escape_regex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function build_matcher(query: string, options: ProjectTextSearchOptions) {
  const flags = options.ignoreCase === false ? 'g' : 'gi'
  const source = options.useRegex === true ? query : escape_regex(query)
  const bounded = options.wordBoundary === true ? `\\b(?:${source})\\b` : source
  try {
    return new RegExp(bounded, flags)
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Invalid search expression: ${error.message}` : 'Invalid search expression.',
    )
  }
}

async function collect_workspace_files(root_path: string, max_files = 20_000): Promise<WorkspaceSearchFile[]> {
  const files: WorkspaceSearchFile[] = []
  const queue = [root_path]
  while (queue.length && files.length < max_files) {
    const directory_path = queue.shift()!
    let entries: Awaited<ReturnType<typeof window.editor_api.workspace.read_directory>>
    try {
      entries = await window.editor_api.workspace.read_directory(root_path, directory_path)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files.length >= max_files) break
      if (entry.is_symlink) continue
      if (entry.kind === 'directory') {
        if (!ignored_directories.has(entry.name.toLowerCase())) queue.push(entry.path)
      } else {
        files.push({ path: entry.path, name: entry.name })
      }
    }
  }
  return files
}

export async function searchProjectFileNames(root_path: string, query: string, max_results = 200) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const files = await collect_workspace_files(root_path)
  return files
    .filter((file) => file.name.toLowerCase().includes(needle))
    .sort((left, right) => {
      const left_exact = left.name.toLowerCase() === needle ? 0 : 1
      const right_exact = right.name.toLowerCase() === needle ? 0 : 1
      return left_exact - right_exact || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    })
    .slice(0, Math.max(1, Math.min(500, max_results)))
}

export async function searchProjectText(root_path: string, query: string, options: ProjectTextSearchOptions = {}) {
  const search_query = query.trim()
  if (!search_query) return []
  const max_results = Math.max(1, Math.min(500, Number(options.maxResults) || 200))
  const matcher = build_matcher(search_query, options)
  const files = (await collect_workspace_files(root_path)).filter(
    (file) => !binary_extensions.has(extension_of(file.path)),
  )
  const matches: ProjectTextSearchMatch[] = []
  const batch_size = 16

  for (let start = 0; start < files.length && matches.length < max_results; start += batch_size) {
    const batch = files.slice(start, start + batch_size)
    const opened_files = await Promise.all(
      batch.map(async (file) => {
        try {
          return { file, opened: await window.editor_api.file.open(file.path) }
        } catch {
          return null
        }
      }),
    )

    for (const item of opened_files) {
      if (!item || !item.opened || item.opened.status !== 'opened' || item.opened.kind !== 'text') continue
      const content = typeof item.opened.content === 'string' ? item.opened.content : ''
      if (!content) continue
      const lines = content.replace(/\r\n?/g, '\n').split('\n')
      for (let index = 0; index < lines.length && matches.length < max_results; index += 1) {
        matcher.lastIndex = 0
        if (matcher.test(lines[index])) matches.push({ file: item.file.path, line: index + 1, content: lines[index] })
      }
    }
  }
  return matches
}
