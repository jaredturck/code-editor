/**
 * Canonical tool catalog for the local agentic coding runtime.
 *
 * Keep this surface small. Qwen is trained to choose tools natively; every overlapping or
 * general-desktop capability makes that decision harder. Runtime-only coordination state does
 * not need a corresponding language-model tool.
 */
export type PermissionTier = 0 | 1 | 2 | 3
export type ToolModule = 'Files' | 'Terminal' | 'Search' | 'Agent' | 'System'
export type ToolArgumentDescriptions = Record<string, string>

export interface ToolDefinition {
  name: string
  module: ToolModule
  description: string
  args: ToolArgumentDescriptions
  internal?: boolean
}

export type ToolPresentationKind = 'command' | 'edit' | 'read' | 'search' | 'other'

export interface ToolPresentation {
  kind: ToolPresentationKind
  icon: string
  moduleIcon: string
  language: string
  actionVerb?: string
}

export interface ToolCatalogEntry extends ToolDefinition {
  aliases: string[]
  timeoutMs: number
  risky: boolean
  permissionKey: string | null
  lean: boolean
  subAgentMinTier: number | null
  subAgentNative: boolean
  presentation: ToolPresentation
}

export interface CatalogToolResolution {
  requested: string
  resolved: string
  matchedBy: 'none' | 'exact' | 'case_insensitive' | 'alias'
}

export interface SubAgentToolDefinition {
  name: string
  description: string
  args: ToolArgumentDescriptions
}

export const DEFAULT_AGENT_READ_LINE_COUNT = 600
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

export const PERMISSION_TIER = {
  LOCKED: 0,
  READ_ONLY: 1,
  STANDARD: 2,
  POWER: 3,
} as const satisfies Record<string, PermissionTier>

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'files.list',
    module: 'Files',
    description: 'List the project tree below a directory. Use shallow depth unless deeper structure is needed.',
    args: { path: 'string', depth: 'number (optional, 1-8)' },
  },
  {
    name: 'files.find',
    module: 'Files',
    description: 'Search project file names or text contents. Prefer this for repository navigation instead of semantic search.',
    args: {
      path: 'string',
      query: 'string',
      mode: 'name | content | auto (optional)',
      useRegex: 'boolean (optional)',
      ignoreCase: 'boolean (optional)',
      depth: 'number (optional)',
      maxResults: 'number (optional)',
    },
  },
  {
    name: 'files.read',
    module: 'Files',
    description: 'Read a bounded text-file range or search within one file. Read only the context needed for the current work.',
    args: {
      path: 'string',
      startLine: 'number (optional)',
      lineCount: `number (optional, default ${DEFAULT_AGENT_READ_LINE_COUNT})`,
      maxChars: 'number (optional)',
      pattern: 'string (optional)',
      patternRegex: 'boolean (optional)',
      patternContext: 'number (optional)',
      tail: 'number (optional)',
    },
  },
  {
    name: 'files.stat',
    module: 'Files',
    description: 'Read file metadata for one or more project paths without reading file contents.',
    args: { path: 'string[]' },
  },
  {
    name: 'files.diff',
    module: 'Files',
    description: 'Preview a unified diff between the current file and proposed complete content.',
    args: { path: 'string', newContent: 'string', contextLines: 'number (optional)' },
  },
  {
    name: 'files.write',
    module: 'Files',
    description: 'Create or replace a project text file. Use append only when deliberately extending a file.',
    args: { path: 'string', content: 'string', mode: 'create | append (optional)' },
  },
  {
    name: 'files.edit',
    module: 'Files',
    description: 'Edit a project file by exact string replacement. Prefer this for precise changes after reading the target.',
    args: {
      path: 'string',
      oldText: 'string',
      newText: 'string',
      replaceAll: 'boolean (optional)',
    },
  },
  {
    name: 'files.patch',
    module: 'Files',
    description: 'Apply a unified diff to a project file. Use when a patch is more natural than exact replacement.',
    args: { path: 'string', patch: 'string', dryRun: 'boolean (optional)' },
  },
  {
    name: 'terminal.exec',
    module: 'Terminal',
    description: 'Run a shell command inside the authorized project workspace for builds, tests, package commands, scripts, or targeted inspection.',
    args: { command: 'string', cwd: 'string (optional)' },
  },
  {
    name: 'search.web',
    module: 'Search',
    description: 'Search the public web when current external development information is required.',
    args: { query: 'string', maxResults: 'number (optional)' },
  },
  {
    name: 'web.fetch',
    module: 'Search',
    description: 'Fetch and extract one known public URL. Prefer this after search when a specific source is relevant.',
    args: { url: 'string', extract: 'text | code | links | all (optional)', maxChars: 'number (optional)' },
  },
  {
    name: 'browser.inspect',
    module: 'System',
    description: 'Inspect the running application/browser for rendered UI, console, network, or runtime evidence.',
    args: { action: 'string (optional)', url: 'string (optional)', selector: 'string (optional)' },
  },
  {
    name: 'diagnostics.check',
    module: 'System',
    description: 'Read current editor/workspace diagnostics. Any severity=error diagnostic blocks accepted completion.',
    args: { path: 'string (optional)' },
  },
  {
    name: 'agent.delegate',
    module: 'Agent',
    internal: true,
    description: 'Delegate a bounded software-engineering work item to a specialist scout or executor. Runtime owns scheduling and status tracking.',
    args: {
      toAgent: 'executor | scout',
      type: 'execute | discover | summarize | verify',
      instructions: 'string',
      tools: 'string[] (optional)',
      context: 'object (optional)',
      priority: 'high | normal | low (optional)',
    },
  },
  {
    name: 'agent.consult',
    module: 'Agent',
    internal: true,
    description: 'Ask another configured local specialist a focused question when independent expertise is useful.',
    args: {
      toAgent: 'string (optional)',
      topic: 'string (optional)',
      question: 'string',
      context: 'object (optional)',
    },
  },
  {
    name: 'agent.review',
    module: 'Agent',
    internal: true,
    description: 'Request independent local-agent review of a concrete code diff or implementation result.',
    args: { diff: 'string', request: 'string (optional)' },
  },
  {
    name: 'user.ask',
    module: 'System',
    internal: true,
    description: 'Ask the user only when a material product requirement cannot be resolved safely from the prompt or project.',
    args: { question: 'string', options: 'string[] (2-5 choices)' },
  },
  {
    name: 'approval.request',
    module: 'System',
    internal: true,
    description: 'Request explicit approval for an operation that the runtime security policy cannot authorize automatically.',
    args: { reason: 'string', action: 'string (optional)', tool: 'string (optional)', command: 'string (optional)' },
  },
]

export const TOOL_BY_NAME = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.name, tool])) as Record<string, ToolDefinition>
const TOOL_BY_NAME_LOWER = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.name.toLowerCase(), tool.name])) as Record<string, string>

const TOOL_ALIAS_MAP: Record<string, string> = {
  list_files: 'files.list',
  files_list: 'files.list',
  find_files: 'files.find',
  search_files: 'files.find',
  find_in_files: 'files.find',
  grep_files: 'files.find',
  read_file: 'files.read',
  file_read: 'files.read',
  write_file: 'files.write',
  create_file: 'files.write',
  edit_file: 'files.edit',
  str_replace: 'files.edit',
  patch_file: 'files.patch',
  run_command: 'terminal.exec',
  shell_exec: 'terminal.exec',
  web_search: 'search.web',
  search_web: 'search.web',
  fetch_url: 'web.fetch',
  check_diagnostics: 'diagnostics.check',
}

const TOOL_TIMEOUT_MS_BY_NAME: Record<string, number> = {
  'terminal.exec': 5 * 60_000,
  'search.web': 90_000,
  'web.fetch': 60_000,
  'browser.inspect': 60_000,
  'agent.delegate': 90_000,
  'agent.consult': 5 * 60_000,
  'agent.review': 5 * 60_000,
  'user.ask': 12 * 60 * 60_000,
  'approval.request': 12 * 60 * 60_000,
}

const RISKY_TOOL_NAMES = new Set(['files.write', 'files.edit', 'files.patch', 'terminal.exec'])

const TOOL_PERMISSION_KEYS: Record<string, string> = {
  'files.list': 'file_read',
  'files.find': 'file_read',
  'files.read': 'file_read',
  'files.stat': 'file_read',
  'files.diff': 'file_read',
  'files.write': 'file_write',
  'files.edit': 'file_write',
  'files.patch': 'file_write',
  'terminal.exec': 'terminal_exec',
}

const SUB_AGENT_MIN_TIER: Record<string, number> = {
  'files.list': PERMISSION_TIER.READ_ONLY,
  'files.find': PERMISSION_TIER.READ_ONLY,
  'files.read': PERMISSION_TIER.READ_ONLY,
  'files.stat': PERMISSION_TIER.READ_ONLY,
  'files.diff': PERMISSION_TIER.READ_ONLY,
  'search.web': PERMISSION_TIER.READ_ONLY,
  'web.fetch': PERMISSION_TIER.READ_ONLY,
  'browser.inspect': PERMISSION_TIER.READ_ONLY,
  'diagnostics.check': PERMISSION_TIER.READ_ONLY,
  'agent.consult': PERMISSION_TIER.READ_ONLY,
  'agent.review': PERMISSION_TIER.READ_ONLY,
  'files.write': PERMISSION_TIER.STANDARD,
  'files.edit': PERMISSION_TIER.STANDARD,
  'files.patch': PERMISSION_TIER.STANDARD,
  'terminal.exec': PERMISSION_TIER.STANDARD,
}

const SUB_AGENT_NATIVE_DEFINITIONS: Record<string, SubAgentToolDefinition> = Object.fromEntries(
  TOOL_DEFINITIONS
    .filter((tool) => !['agent.delegate', 'user.ask', 'approval.request'].includes(tool.name))
    .map((tool) => [tool.name, { name: tool.name, description: tool.description, args: tool.args }]),
)

const MODULE_ICONS: Record<string, string> = {
  files: 'files',
  terminal: 'terminal',
  search: 'search',
  agent: 'trace',
  system: 'tool',
}

export function normalizeToolAliasKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function resolveCatalogToolRequest(value: unknown): CatalogToolResolution {
  const requested = String(value || '').trim()
  if (!requested) return { requested, resolved: '', matchedBy: 'none' }
  if (TOOL_BY_NAME[requested]) return { requested, resolved: requested, matchedBy: 'exact' }
  const insensitive = TOOL_BY_NAME_LOWER[requested.toLowerCase()]
  if (insensitive) return { requested, resolved: insensitive, matchedBy: 'case_insensitive' }
  const alias = TOOL_ALIAS_MAP[normalizeToolAliasKey(requested)]
  if (alias && TOOL_BY_NAME[alias]) return { requested, resolved: alias, matchedBy: 'alias' }
  return { requested, resolved: '', matchedBy: 'none' }
}

export function getToolTimeoutMs(toolName: unknown): number {
  return TOOL_TIMEOUT_MS_BY_NAME[String(toolName || '').trim()] || DEFAULT_TOOL_TIMEOUT_MS
}

export function getToolPermissionKey(toolName: unknown): string | null {
  return TOOL_PERMISSION_KEYS[String(toolName || '').trim()] || null
}

export function isToolRisky(toolName: unknown): boolean {
  return RISKY_TOOL_NAMES.has(String(toolName || '').trim())
}

export function isLeanTool(toolName: unknown): boolean {
  return Boolean(TOOL_BY_NAME[String(toolName || '').trim()])
}

export function getSubAgentMinTier(toolName: unknown, fallback: number = PERMISSION_TIER.STANDARD): number {
  const value = SUB_AGENT_MIN_TIER[String(toolName || '').trim()]
  return Number.isFinite(value) ? value : fallback
}

export function getSubAgentNativeToolDefinitions(
  availableNames: readonly unknown[],
  forbiddenNames: readonly unknown[] = [],
): SubAgentToolDefinition[] {
  const forbidden = new Set((forbiddenNames || []).map((name) => String(name || '').trim()))
  return (availableNames || [])
    .map((name) => SUB_AGENT_NATIVE_DEFINITIONS[String(name || '').trim()])
    .filter((definition): definition is SubAgentToolDefinition => Boolean(definition) && !forbidden.has(definition.name))
}

export function listSubAgentNativeToolNames(): string[] {
  return Object.keys(SUB_AGENT_NATIVE_DEFINITIONS)
}

export function getToolPresentation(toolName: unknown): ToolPresentation {
  const name = String(toolName || '').trim()
  const moduleName = name.split('.')[0].toLowerCase()
  const moduleIcon = MODULE_ICONS[moduleName] || 'tool'
  if (name === 'terminal.exec') return { kind: 'command', icon: 'command', moduleIcon, language: 'bash' }
  if (name.startsWith('files.')) {
    const edit = /\.(write|edit|patch|diff)$/.test(name)
    return {
      kind: edit ? 'edit' : 'read',
      icon: edit ? 'edit' : 'fileText',
      moduleIcon,
      language: edit ? 'text' : 'json',
      actionVerb: edit ? 'Edited' : name === 'files.find' ? 'Searched' : 'Read',
    }
  }
  if (name.startsWith('search.') || name === 'web.fetch') return { kind: 'search', icon: 'search', moduleIcon, language: 'json' }
  return { kind: 'other', icon: moduleIcon, moduleIcon, language: 'json' }
}

export const TOOL_CATALOG = TOOL_DEFINITIONS.reduce<Record<string, ToolCatalogEntry>>((catalog, definition) => {
  catalog[definition.name] = {
    ...definition,
    aliases: Object.keys(TOOL_ALIAS_MAP).filter((alias) => TOOL_ALIAS_MAP[alias] === definition.name),
    timeoutMs: getToolTimeoutMs(definition.name),
    risky: isToolRisky(definition.name),
    permissionKey: getToolPermissionKey(definition.name),
    lean: true,
    subAgentMinTier: SUB_AGENT_MIN_TIER[definition.name] ?? null,
    subAgentNative: Boolean(SUB_AGENT_NATIVE_DEFINITIONS[definition.name]),
    presentation: getToolPresentation(definition.name),
  }
  return catalog
}, {})

export function getToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.slice()
}

export function getToolCatalogEntry(toolName: unknown): ToolCatalogEntry | null {
  return TOOL_CATALOG[String(toolName || '').trim()] || null
}