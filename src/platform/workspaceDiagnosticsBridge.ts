import { get_language_for_file } from '@/data/languages'
import { readTextFile } from '@/platform/desktopBridge'

const diagnostic_language_by_extension: Record<string, string> = {
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.js': 'javascript',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.json5': 'json5',
  '.jsonc': 'jsonc',
  '.less': 'less',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.py': 'python',
  '.pyw': 'python',
  '.scss': 'scss',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.yaml': 'yaml',
  '.yml': 'yaml',
}

const supported_diagnostic_languages = new Set([
  'python',
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'json',
  'json5',
  'jsonc',
  'yaml',
  'markdown',
])

function file_extension(file_path: string) {
  const name = String(file_path || '').split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function diagnostic_language_for_file(file_path: string, requested_language = '') {
  const requested = String(requested_language || '').trim().toLowerCase()
  if (requested) return requested

  const by_extension = diagnostic_language_by_extension[file_extension(file_path)]
  if (by_extension) return by_extension

  return String(get_language_for_file(file_path) || 'plain text').trim().toLowerCase()
}

export async function analyzeWorkspaceFile(
  file_path: string,
  options: { language?: string; max_diagnostics?: number; actor_id?: string } = {},
) {
  const read = await readTextFile(file_path, {
    actorId: String(options.actor_id || 'orchestrator'),
    lineNumbers: false,
  })
  if (read.isBinary) throw new Error('diagnostics.check cannot analyze a binary file.')

  const language = diagnostic_language_for_file(read.path || file_path, options.language)
  const supported = supported_diagnostic_languages.has(language)
  if (!supported) {
    return {
      path: read.path || file_path,
      revision: read.revision || null,
      language,
      supported: false,
      ok: null,
      clean: null,
      counts: { errors: 0, warnings: 0, info: 0, total: 0 },
      diagnostics: [],
      omitted: 0,
      message: `No built-in editor diagnostics provider is registered for ${language || 'this file type'}. Use the project-native lint, typecheck, build, or test tooling when appropriate.`,
    }
  }

  if (typeof window === 'undefined' || !window.editor_api?.diagnostics?.analyze) {
    throw new Error('Editor diagnostics are unavailable in this environment.')
  }

  const diagnostics = await window.editor_api.diagnostics.analyze({
    language,
    content: read.content,
    file_path: read.path || file_path,
  })
  const normalized = Array.isArray(diagnostics) ? diagnostics : []
  const errors = normalized.filter((diagnostic) => diagnostic.severity === 'error').length
  const warnings = normalized.filter((diagnostic) => diagnostic.severity === 'warning').length
  const info = normalized.filter((diagnostic) => diagnostic.severity === 'info').length
  const max_diagnostics = Math.max(1, Math.min(200, Math.round(Number(options.max_diagnostics) || 80)))

  return {
    path: read.path || file_path,
    revision: read.revision || null,
    language,
    supported: true,
    ok: errors === 0,
    clean: normalized.length === 0,
    counts: { errors, warnings, info, total: normalized.length },
    diagnostics: normalized.slice(0, max_diagnostics),
    omitted: Math.max(0, normalized.length - max_diagnostics),
  }
}
