import { analyzeWorkspaceText, supportsWorkspaceDiagnostics } from '@/platform/workspaceDiagnosticsBridge'

const excluded_directory_names = new Set([
  '.git',
  '.cache',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.venv',
  '.vite',
  '__pycache__',
  'backend-dist',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'target',
  'vendor',
  'venv',
])

const diagnostics_states = new Map<string, WorkspaceDiagnosticsState>()
let remove_workspace_listener: (() => void) | null = null

interface WorkspaceDiagnosticsState {
  root: string
  dirty: boolean
  full_rescan: boolean
  change_version: number
  changed_files: Set<string>
  known_files: Set<string>
  snapshot: WorkspaceDiagnosticsSnapshot | null
  refresh_promise: Promise<WorkspaceDiagnosticsSnapshot> | null
}

interface WorkspaceDiagnosticsRefresh {
  snapshot: WorkspaceDiagnosticsSnapshot
  known_files: Set<string>
}

export interface WorkspaceDiagnosticFinding {
  path: string
  source: string
  code: string | null
  severity: 'error' | 'warning' | 'info'
  message: string
  line: number
  column: number
  end_line: number
  end_column: number
}

export interface WorkspaceDiagnosticsSnapshot {
  root: string
  refreshed_at: number
  analyzed_files: number
  diagnostic_files: number
  counts: {
    errors: number
    warnings: number
    info: number
    total: number
  }
  findings: WorkspaceDiagnosticFinding[]
  scan_errors: string[]
  complete: boolean
}

function normalize_path(value: string) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

function workspace_state(root_path: string) {
  const root = normalize_path(root_path)
  let state = diagnostics_states.get(root)
  if (!state) {
    state = {
      root,
      dirty: true,
      full_rescan: true,
      change_version: 0,
      changed_files: new Set(),
      known_files: new Set(),
      snapshot: null,
      refresh_promise: null,
    }
    diagnostics_states.set(root, state)
  }
  return state
}

function relative_path(root_path: string, file_path: string) {
  const root = normalize_path(root_path)
  const file = normalize_path(file_path)
  if (file === root) return ''
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
}

function path_is_in_workspace(root_path: string, file_path: string) {
  const root = normalize_path(root_path)
  const file = normalize_path(file_path)
  return Boolean(root) && (file === root || file.startsWith(`${root}/`))
}

function path_has_excluded_directory(root_path: string, file_path: string) {
  const relative = relative_path(root_path, file_path)
  if (!relative) return false
  const segments = relative.split('/').filter(Boolean)
  return segments.some((segment) => excluded_directory_names.has(segment.toLowerCase()))
}

function mark_state_change(state: WorkspaceDiagnosticsState, file_path = '', structural = false) {
  const file = normalize_path(file_path)
  const can_refresh_file =
    !structural &&
    Boolean(file) &&
    file !== state.root &&
    path_is_in_workspace(state.root, file) &&
    state.snapshot?.complete === true &&
    state.known_files.has(file) &&
    supportsWorkspaceDiagnostics(file)

  if (can_refresh_file) {
    state.changed_files.add(file)
  } else {
    state.full_rescan = true
    state.changed_files.clear()
  }
  state.change_version += 1
  state.dirty = true
}

function ensure_workspace_listener() {
  if (remove_workspace_listener || typeof window === 'undefined' || !window.editor_api?.workspace?.on_change) return
  remove_workspace_listener = window.editor_api.workspace.on_change((payload) => {
    const root = normalize_path(payload.root_path)
    const state = diagnostics_states.get(root)
    const file = normalize_path(payload.file_path)
    if (!state || path_has_excluded_directory(root, file)) return

    const event_type = String(payload.event_type || '').toLowerCase()
    if (event_type === 'change' && file && file !== root && !supportsWorkspaceDiagnostics(file)) return
    mark_state_change(state, file, event_type !== 'change')
  })
}

export function markWorkspaceDiagnosticsDirty(root_path: string, file_path = '') {
  const root = normalize_path(root_path)
  if (!root) return
  ensure_workspace_listener()
  const state = workspace_state(root)
  mark_state_change(state, file_path, !file_path)
}

async function collect_diagnostic_files(root_path: string) {
  const pending_directories = [root_path]
  const files: string[] = []
  const scan_errors: string[] = []

  while (pending_directories.length > 0) {
    const batch = pending_directories.splice(0, 8)
    const results = await Promise.all(
      batch.map(async (directory_path) => {
        try {
          return {
            directory_path,
            entries: await window.editor_api.workspace.read_directory(root_path, directory_path),
            error: '',
          }
        } catch (error) {
          return {
            directory_path,
            entries: [],
            error: error instanceof Error ? error.message : String(error || 'Unable to read directory'),
          }
        }
      }),
    )

    for (const result of results) {
      if (result.error) {
        scan_errors.push(`${relative_path(root_path, result.directory_path) || '.'}: ${result.error}`)
        continue
      }
      for (const entry of result.entries) {
        if (entry.kind === 'directory') {
          if (!entry.is_symlink && !excluded_directory_names.has(entry.name.toLowerCase())) {
            pending_directories.push(entry.path)
          }
          continue
        }
        if (supportsWorkspaceDiagnostics(entry.path)) files.push(entry.path)
      }
    }
  }

  return { files, scan_errors }
}

async function analyze_diagnostic_file(root_path: string, file_path: string) {
  try {
    const read = await window.editor_api.workspace.agent_read_file(root_path, file_path, true)
    if (read.missing) return { result: null, error: '' }
    const result = await analyzeWorkspaceText(read.path || file_path, read.content, {
      revision: read.revision || null,
      max_diagnostics: 200,
    })
    return { result, error: '' }
  } catch (error) {
    return {
      result: null,
      error: `${relative_path(root_path, file_path)}: ${error instanceof Error ? error.message : String(error || 'Diagnostics failed')}`,
    }
  }
}

function append_diagnostics(
  findings: WorkspaceDiagnosticFinding[],
  result: Awaited<ReturnType<typeof analyzeWorkspaceText>>,
) {
  for (const diagnostic of result.diagnostics) {
    findings.push({
      path: result.path,
      source: String(diagnostic.source || 'Diagnostic'),
      code: diagnostic.code == null ? null : String(diagnostic.code),
      severity: diagnostic.severity,
      message: String(diagnostic.message || ''),
      line: Number(diagnostic.line || 1),
      column: Number(diagnostic.column || 1),
      end_line: Number(diagnostic.end_line || diagnostic.line || 1),
      end_column: Number(diagnostic.end_column || diagnostic.column || 1),
    })
  }
}

function build_snapshot(
  root_path: string,
  analyzed_files: number,
  findings: WorkspaceDiagnosticFinding[],
  scan_errors: string[],
): WorkspaceDiagnosticsSnapshot {
  findings.sort((left, right) => {
    const severity_rank = { error: 0, warning: 1, info: 2 }
    return (
      severity_rank[left.severity] - severity_rank[right.severity] ||
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column
    )
  })

  const errors = findings.filter((finding) => finding.severity === 'error').length
  const warnings = findings.filter((finding) => finding.severity === 'warning').length
  const info = findings.filter((finding) => finding.severity === 'info').length
  const diagnostic_files = new Set(findings.map((finding) => normalize_path(finding.path))).size

  return {
    root: root_path,
    refreshed_at: Date.now(),
    analyzed_files,
    diagnostic_files,
    counts: { errors, warnings, info, total: findings.length },
    findings,
    scan_errors: scan_errors.slice(0, 20),
    complete: scan_errors.length === 0,
  }
}

async function scan_workspace(root_path: string): Promise<WorkspaceDiagnosticsRefresh> {
  const collected = await collect_diagnostic_files(root_path)
  const findings: WorkspaceDiagnosticFinding[] = []
  const scan_errors = [...collected.scan_errors]
  let analyzed_files = 0

  for (let index = 0; index < collected.files.length; index += 12) {
    const batch = collected.files.slice(index, index + 12)
    const results = await Promise.all(batch.map((file_path) => analyze_diagnostic_file(root_path, file_path)))
    for (const entry of results) {
      if (entry.error) {
        scan_errors.push(entry.error)
        continue
      }
      if (!entry.result) continue
      analyzed_files += 1
      append_diagnostics(findings, entry.result)
    }
  }

  return {
    snapshot: build_snapshot(root_path, analyzed_files, findings, scan_errors),
    known_files: new Set(collected.files.map(normalize_path)),
  }
}

async function refresh_changed_files(
  state: WorkspaceDiagnosticsState,
  changed_files: Set<string>,
): Promise<WorkspaceDiagnosticsRefresh> {
  if (!state.snapshot?.complete || [...changed_files].some((file) => !state.known_files.has(file))) {
    return scan_workspace(state.root)
  }

  const findings = state.snapshot.findings.filter((finding) => !changed_files.has(normalize_path(finding.path)))
  const scan_errors: string[] = []
  const files = [...changed_files]

  for (let index = 0; index < files.length; index += 12) {
    const batch = files.slice(index, index + 12)
    const results = await Promise.all(batch.map((file_path) => analyze_diagnostic_file(state.root, file_path)))
    for (const entry of results) {
      if (entry.error) {
        scan_errors.push(entry.error)
        continue
      }
      if (!entry.result) return scan_workspace(state.root)
      append_diagnostics(findings, entry.result)
    }
  }

  return {
    snapshot: build_snapshot(state.root, state.snapshot.analyzed_files, findings, scan_errors),
    known_files: new Set(state.known_files),
  }
}

async function refresh_state(state: WorkspaceDiagnosticsState, retry = true): Promise<WorkspaceDiagnosticsSnapshot> {
  const started_version = state.change_version
  const changed_files = new Set(state.changed_files)
  const full_rescan = state.full_rescan || !state.snapshot || !state.snapshot.complete
  state.changed_files.clear()
  state.full_rescan = false

  const refreshed = full_rescan ? await scan_workspace(state.root) : await refresh_changed_files(state, changed_files)
  state.snapshot = refreshed.snapshot
  state.known_files = refreshed.known_files
  state.dirty = state.change_version !== started_version

  if (state.dirty && retry) return refresh_state(state, false)
  return refreshed.snapshot
}

export async function getWorkspaceDiagnosticsSnapshot(root_path: string) {
  const root = normalize_path(root_path)
  if (!root) return null
  if (typeof window === 'undefined' || !window.editor_api?.workspace || !window.editor_api?.diagnostics) return null

  ensure_workspace_listener()
  const state = workspace_state(root)
  if (!state.dirty && state.snapshot) return state.snapshot
  if (state.refresh_promise) return state.refresh_promise

  state.refresh_promise = refresh_state(state).finally(() => {
    state.refresh_promise = null
  })
  return state.refresh_promise
}

export function formatWorkspaceDiagnostics(snapshot: WorkspaceDiagnosticsSnapshot | null, max_findings = 80) {
  if (!snapshot) return ''
  const { errors, warnings, info, total } = snapshot.counts
  const lines = [
    `LIVE WORKSPACE DIAGNOSTICS: ${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${info} info across ${snapshot.analyzed_files} analyzed file${snapshot.analyzed_files === 1 ? '' : 's'}.`,
  ]

  if (!snapshot.complete) {
    lines.push(
      `Diagnostics scan was incomplete in ${snapshot.scan_errors.length} location(s); do not assume unscanned files are clean.`,
    )
  }

  const visible = snapshot.findings.slice(0, Math.max(1, max_findings))
  if (visible.length === 0) {
    lines.push('No editor errors or warnings are currently reported in the analyzed workspace.')
  } else {
    let current_path = ''
    for (const finding of visible) {
      const path = relative_path(snapshot.root, finding.path) || finding.path
      if (path !== current_path) {
        current_path = path
        lines.push('', path)
      }
      const code = finding.code ? ` · ${finding.code}` : ''
      lines.push(
        `- ${finding.severity.toUpperCase()} ${finding.source}${code} · ${finding.line}:${finding.column} — ${finding.message}`,
      )
    }
  }

  if (total > visible.length) {
    lines.push(
      '',
      `${total - visible.length} additional diagnostic(s) omitted from this prompt; the counts above include them.`,
    )
  }
  if (snapshot.scan_errors.length > 0) {
    lines.push('', `Scan issue: ${snapshot.scan_errors[0]}`)
  }

  return lines.join('\n').slice(0, 14000)
}

export function resetWorkspaceDiagnosticsForTests() {
  diagnostics_states.clear()
  remove_workspace_listener?.()
  remove_workspace_listener = null
}
