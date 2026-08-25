import type { EditorFileAuthority } from '../platform/desktopBridge'

export interface EditorFileSnapshot {
  file_path: string
  content: string
  dirty: boolean
}

export interface EditorFileAuthorityHost {
  get_snapshot: (file_path: string) => EditorFileSnapshot | null
  apply_content: (file_path: string, content: string, saved: boolean) => void
}

interface FileState {
  path: string
  content: string
  revision: string
  disk_revision: string | null
  dirty: boolean
}

const FILE_TOOL_NAMES = new Set([
  'files.list',
  'files.read',
  'files.write',
  'files.stat',
  'files.diff',
  'files.patch',
  'files.edit',
])

function normalize_path(file_path: string) {
  const normalized = file_path.replace(/\\/g, '/').replace(/\/+$/, '')
  return window.editor_api.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function content_revision(content: string) {
  let hash = 2166136261

  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return `${content.length}:${(hash >>> 0).toString(16)}`
}

function split_lines(content: string) {
  return content.replace(/\r\n/g, '\n').split('\n')
}

function build_pattern_blocks(
  lines: string[],
  pattern: string,
  pattern_regex: boolean,
  ignore_case: boolean,
  context_lines: number,
  max_results: number,
) {
  const normalized_context = Math.max(0, Math.min(20, Math.round(context_lines)))
  const normalized_max_results = Math.max(1, Math.min(200, Math.round(max_results)))
  const matcher = pattern_regex ? new RegExp(pattern, ignore_case ? 'i' : '') : null
  const needle = ignore_case ? pattern.toLowerCase() : pattern
  const matches: number[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const matched = matcher ? matcher.test(line) : (ignore_case ? line.toLowerCase() : line).includes(needle)
    if (matched) matches.push(index)
  }

  const selected_matches = matches.slice(0, normalized_max_results)
  const ranges = selected_matches.map((index) => ({
    start: Math.max(0, index - normalized_context),
    end: Math.min(lines.length - 1, index + normalized_context),
  }))
  const merged_ranges: Array<{ start: number; end: number }> = []

  for (const range of ranges) {
    const previous = merged_ranges[merged_ranges.length - 1]
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged_ranges.push({ ...range })
    }
  }

  return {
    matchCount: matches.length,
    truncated: matches.length > selected_matches.length,
    blocks: merged_ranges.map((range) => ({
      startLine: range.start + 1,
      endLine: range.end + 1,
      lines: lines.slice(range.start, range.end + 1).map((content, offset) => ({
        line: range.start + offset + 1,
        content,
      })),
    })),
  }
}

function build_simple_diff(file_path: string, current: string, proposed: string) {
  if (current === proposed) {
    return { path: file_path, diff: '', added: 0, removed: 0, changed: false }
  }

  const before = split_lines(current)
  const after = split_lines(proposed)
  let prefix = 0

  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const removed_lines = before.slice(prefix, before.length - suffix)
  const added_lines = after.slice(prefix, after.length - suffix)
  const hunk = [
    `--- ${file_path}`,
    `+++ ${file_path}`,
    `@@ -${prefix + 1},${removed_lines.length} +${prefix + 1},${added_lines.length} @@`,
    ...removed_lines.map((line) => `-${line}`),
    ...added_lines.map((line) => `+${line}`),
  ].join('\n')

  return {
    path: file_path,
    diff: hunk,
    added: added_lines.length,
    removed: removed_lines.length,
    changed: true,
  }
}

function apply_unified_patch(content: string, patch: string) {
  const source = split_lines(content)
  const patch_lines = patch.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  let source_index = 0
  let patch_index = 0
  let saw_hunk = false

  while (patch_index < patch_lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patch_lines[patch_index])
    if (!header) {
      patch_index += 1
      continue
    }

    saw_hunk = true
    const old_start = Math.max(0, Number(header[1]) - 1)
    output.push(...source.slice(source_index, old_start))
    source_index = old_start
    patch_index += 1

    while (patch_index < patch_lines.length && !patch_lines[patch_index].startsWith('@@ ')) {
      const line = patch_lines[patch_index]
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line === '\\ No newline at end of file') {
        patch_index += 1
        continue
      }

      const marker = line[0]
      const body = line.slice(1)

      if (marker === ' ') {
        if (source[source_index] !== body) throw new Error('Patch context no longer matches the editor buffer.')
        output.push(body)
        source_index += 1
      } else if (marker === '-') {
        if (source[source_index] !== body) throw new Error('Patch removal no longer matches the editor buffer.')
        source_index += 1
      } else if (marker === '+') {
        output.push(body)
      }

      patch_index += 1
    }
  }

  if (!saw_hunk) throw new Error('The supplied patch does not contain a unified diff hunk.')
  output.push(...source.slice(source_index))
  return output.join('\n')
}

export function create_editor_file_authority(
  workspace_root: string | null,
  host: EditorFileAuthorityHost,
): EditorFileAuthority | null {
  if (!workspace_root) return null

  const observed_revisions = new Map<string, string>()
  const observed_disk_revisions = new Map<string, string | null>()

  const read_state = async (file_path: string, remember: boolean): Promise<FileState> => {
    const disk = await window.editor_api.workspace.agent_read_file(workspace_root, file_path)
    const snapshot = host.get_snapshot(disk.path)
    const content = snapshot?.content ?? disk.content
    const revision = snapshot ? `editor:${content_revision(content)}` : `disk:${disk.revision}`
    const state = {
      path: disk.path,
      content,
      revision,
      disk_revision: disk.revision,
      dirty: Boolean(snapshot?.dirty),
    }

    if (remember) {
      observed_revisions.set(normalize_path(disk.path), revision)
      observed_disk_revisions.set(normalize_path(disk.path), disk.revision)
    }

    return state
  }

  const read_optional_state = async (file_path: string, remember: boolean) => {
    try {
      return await read_state(file_path, remember)
    } catch (error) {
      if (error instanceof Error && /does not exist|not found|enoent/i.test(error.message)) return null
      throw error
    }
  }

  const ensure_unchanged = async (file_path: string) => {
    const current = await read_optional_state(file_path, false)
    const key = normalize_path(current?.path || file_path)
    const expected = observed_revisions.get(key)

    if (current && !expected) {
      throw new Error(`Read ${file_path} before editing it so human changes cannot be overwritten.`)
    }

    if (current && expected !== current.revision) {
      throw new Error(`Refusing to edit ${file_path}: it changed after the agent last read it.`)
    }

    return current
  }

  const write_content = async (file_path: string, content: string, append = false) => {
    const current = await ensure_unchanged(file_path)
    const next_content = append && current ? current.content + content : content
    const resolved_path = current?.path || file_path
    const snapshot = current ? host.get_snapshot(resolved_path) : null
    const key = normalize_path(resolved_path)

    if (snapshot?.dirty) {
      host.apply_content(resolved_path, next_content, false)
      const revision = `editor:${content_revision(next_content)}`
      observed_revisions.set(key, revision)
      return {
        path: resolved_path,
        saved: false,
        dirty: true,
        revision,
        note: 'Updated the live unsaved editor buffer; disk was intentionally left unchanged.',
      }
    }

    const disk_result = await window.editor_api.workspace.agent_write_file(
      workspace_root,
      resolved_path,
      next_content,
      current ? (observed_disk_revisions.get(key) ?? current.disk_revision) : null,
    )
    host.apply_content(disk_result.path, next_content, true)
    const revision = `disk:${disk_result.revision}`
    observed_revisions.set(normalize_path(disk_result.path), revision)
    observed_disk_revisions.set(normalize_path(disk_result.path), disk_result.revision)

    return { path: disk_result.path, saved: true, dirty: false, revision }
  }

  return {
    async execute(tool_name, args = {}) {
      if (!FILE_TOOL_NAMES.has(tool_name)) throw new Error(`Unsupported editor file tool: ${tool_name}`)

      if (tool_name === 'files.list') {
        return window.editor_api.workspace.agent_list(
          workspace_root,
          String(args.path || workspace_root),
          Number(args.depth) || 3,
          args.optional === true,
        )
      }

      if (tool_name === 'files.stat') {
        const paths = Array.isArray(args.path) ? args.path : [args.path]
        const files = await Promise.all(
          paths
            .filter(Boolean)
            .slice(0, 20)
            .map((file_path) => window.editor_api.workspace.agent_stat(workspace_root, String(file_path))),
        )
        return { files }
      }

      const file_path = String(args.path || '').trim()
      if (!file_path) throw new Error(`${tool_name} requires a file path.`)

      if (tool_name === 'files.read') {
        const disk = await window.editor_api.workspace.agent_read_file(
          workspace_root,
          file_path,
          args.optional === true,
        )
        if (disk.missing) {
          return { ...disk, isBinary: false }
        }
        const snapshot = host.get_snapshot(disk.path)
        const content = snapshot?.content ?? disk.content
        const revision = snapshot ? `editor:${content_revision(content)}` : `disk:${disk.revision}`
        observed_revisions.set(normalize_path(disk.path), revision)
        observed_disk_revisions.set(normalize_path(disk.path), disk.revision)

        const lines = split_lines(content)
        const pattern = args.pattern !== undefined ? String(args.pattern) : ''
        if (pattern) {
          const pattern_result = build_pattern_blocks(
            lines,
            pattern,
            args.patternRegex === true || args.useRegex === true,
            args.ignoreCase !== false,
            Number.isFinite(Number(args.patternContext)) ? Number(args.patternContext) : 2,
            Number.isFinite(Number(args.maxResults)) ? Number(args.maxResults) : 50,
          )
          return {
            path: disk.path,
            isBinary: false,
            mode: 'pattern',
            pattern,
            ...pattern_result,
            totalLines: lines.length,
            dirty: Boolean(snapshot?.dirty),
            revision,
          }
        }

        const tail = Number(args.tail) || 0
        const start_line = tail > 0 ? Math.max(1, lines.length - tail + 1) : Math.max(1, Number(args.startLine) || 1)
        const line_count = tail > 0 ? tail : Math.max(1, Math.min(2000, Number(args.lineCount) || 950))
        const selected = lines.slice(start_line - 1, start_line - 1 + line_count)
        const end_line = start_line + Math.max(0, selected.length - 1)

        return {
          path: disk.path,
          content: selected.join('\n'),
          isBinary: false,
          ...(tail > 0 ? { mode: 'tail' } : {}),
          startLine: start_line,
          endLine: end_line,
          lineCount: selected.length,
          totalLines: lines.length,
          hasMore: tail > 0 ? false : end_line < lines.length,
          nextStartLine: tail > 0 ? null : end_line < lines.length ? end_line + 1 : null,
          dirty: Boolean(snapshot?.dirty),
          revision,
        }
      }

      if (tool_name === 'files.diff') {
        const current = await read_state(file_path, false)
        return build_simple_diff(current.path, current.content, String(args.newContent || ''))
      }

      if (tool_name === 'files.write') {
        const content = String(args.content || '')
        const append = String(args.mode || '').toLowerCase() === 'append'
        const before = await read_optional_state(file_path, false)
        const result = await write_content(file_path, content, append)
        return {
          ...result,
          mode: append ? 'append' : 'create',
          bytesWritten: content.length,
          ...(before
            ? build_simple_diff(before.path, before.content, append ? before.content + content : content)
            : {}),
        }
      }

      if (tool_name === 'files.edit') {
        const current = await ensure_unchanged(file_path)
        if (!current) throw new Error(`${file_path} does not exist.`)
        const old_text = String(args.oldText ?? args.oldString ?? '')
        const new_text = String(args.newText ?? args.newString ?? '')
        if (!old_text) throw new Error('oldText is required for files.edit.')
        const matches = current.content.split(old_text).length - 1
        if (matches === 0) throw new Error('oldText was not found. Read the file again before editing.')
        if (matches > 1 && args.replaceAll !== true)
          throw new Error('oldText matches more than once. Include more context or set replaceAll.')
        const next_content =
          args.replaceAll === true
            ? current.content.split(old_text).join(new_text)
            : current.content.replace(old_text, new_text)
        const result = await write_content(file_path, next_content)
        return {
          ...result,
          applied: true,
          replacements: args.replaceAll === true ? matches : 1,
          ...build_simple_diff(current.path, current.content, next_content),
        }
      }

      if (tool_name === 'files.patch') {
        const current = await ensure_unchanged(file_path)
        if (!current) throw new Error(`${file_path} does not exist.`)
        const patch = String(args.patch || '')
        if (!patch) throw new Error('patch is required for files.patch')
        const next_content = apply_unified_patch(current.content, patch)
        const diff = build_simple_diff(current.path, current.content, next_content)
        if (args.dryRun === true) return { ...diff, applied: false, dryRun: true }
        return { ...(await write_content(file_path, next_content)), ...diff, applied: true }
      }

      throw new Error(`Unsupported editor file tool: ${tool_name}`)
    },
  }
}
