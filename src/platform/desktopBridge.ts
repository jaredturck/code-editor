export * from './desktopBridgeBase'
export * from './documentBridge'

import * as base from './desktopBridgeBase'
import { runVisionTask } from './agent/visionTask'
import { acquireAgentWriteLease, clearAgentWriteLeases, releaseAgentWriteLease } from './agent/writeLease'
import { loadProjectSkillDefinitions, mergeProjectSkillDefinitions } from './projectSkillLoader'
import { captureAgentScreen } from './screenCaptureBridge'
import { readOrbSettings } from './settingsStorage'
import type {
  BridgeAutomationCapabilities,
  BridgeFileNode,
  BridgeFileSemanticResult,
  BridgeFileSemanticSearchKind,
  BridgeOptions,
  BridgeRecord,
  BridgeSkillDefinition,
} from './desktopBridgeBase'

export interface EditorFileAuthority {
  execute: (tool_name: string, args?: BridgeRecord) => Promise<unknown>
}

let editor_file_authority: EditorFileAuthority | null = null
let editor_workspace_root: Promise<string> | null = null
let agent_vision_objective = ''
const observed_agent_revisions = new Map<string, string>()

interface AgentFileOperationOptions {
  actorId?: string
  taskId?: string
  holdLease?: boolean
}

function normalize_workspace_path(file_path: string) {
  const normalized = String(file_path || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const windows = typeof window !== 'undefined' && window.editor_api?.platform === 'win32'
  return windows ? normalized.toLowerCase() : normalized
}

function path_is_in_workspace(root_path: string, file_path: string) {
  const root = normalize_workspace_path(root_path)
  const target = normalize_workspace_path(file_path)
  return Boolean(root) && (target === root || target.startsWith(`${root}/`))
}

function agent_operation_identity(options: AgentFileOperationOptions = {}) {
  const actor_id = String(options.actorId || 'orchestrator').trim() || 'orchestrator'
  const task_id = String(options.taskId || `direct:${actor_id}`).trim() || `direct:${actor_id}`
  return { actor_id, task_id }
}

function agent_revision_key(actor_id: string, file_path: string) {
  return `${actor_id}:${normalize_workspace_path(file_path)}`
}

function remember_agent_revision(actor_id: string, result: unknown) {
  const record = result && typeof result === 'object' ? result as BridgeRecord : {}
  const path = String(record.path || '')
  const revision = String(record.revision || '')
  if (path && revision) observed_agent_revisions.set(agent_revision_key(actor_id, path), revision)
}

async function prepare_editor_agent_write(path: string, options: AgentFileOperationOptions = {}) {
  if (!editor_file_authority) return null
  const { actor_id, task_id } = agent_operation_identity(options)
  let resolved_path = path

  try {
    const current = await editor_file_authority.execute('files.read', {
      path,
      startLine: 1,
      lineCount: 1,
    })
    const record = current && typeof current === 'object' ? current as BridgeRecord : {}
    resolved_path = String(record.path || path)
    const revision = String(record.revision || '')
    const expected = observed_agent_revisions.get(agent_revision_key(actor_id, resolved_path))
    if (!expected) {
      throw new Error(`Read ${resolved_path} as ${actor_id} before editing it so human or agent changes cannot be overwritten.`)
    }
    if (revision && revision !== expected) {
      throw new Error(`Refusing to edit ${resolved_path}: it changed after ${actor_id} last read it. Re-read the live file before retrying.`)
    }
  } catch (error) {
    if (!(error instanceof Error) || !/does not exist|not found|enoent/i.test(error.message)) throw error
  }

  acquireAgentWriteLease(normalize_workspace_path(resolved_path), actor_id, task_id)
  return { actor_id, task_id, resolved_path }
}

function finish_editor_agent_write(
  prepared: Awaited<ReturnType<typeof prepare_editor_agent_write>>,
  result: unknown,
  options: AgentFileOperationOptions = {},
) {
  if (!prepared) return
  remember_agent_revision(prepared.actor_id, result)
  if (options.holdLease !== true) {
    releaseAgentWriteLease(
      normalize_workspace_path(prepared.resolved_path),
      prepared.actor_id,
      prepared.task_id,
    )
  }
}

export function setEditorFileAuthority(authority: EditorFileAuthority | null) {
  editor_file_authority = authority
  observed_agent_revisions.clear()
  if (!authority) clearAgentWriteLeases()
  editor_workspace_root = authority
    ? authority.execute('files.list', { path: '', depth: 1 })
        .then((result) => {
          const record = result && typeof result === 'object' ? result as BridgeRecord : {}
          return String(record.rootPath || '')
        })
        .catch(() => '')
    : null
}

export function setAgentVisionObjective(objective: string | null) {
  agent_vision_objective = String(objective || '').trim().slice(0, 2400)
}

export async function getAutomationCapabilities(): Promise<BridgeAutomationCapabilities & BridgeRecord> {
  const capabilities = await base.getAutomationCapabilities()
  const settings = readOrbSettings()
  if (settings.permissions_screen_capture !== true) {
    return { ...capabilities, screenCapture: false }
  }

  try {
    const frame = await captureAgentScreen({ maxWidth: 1600, maxHeight: 1000 })
    const objective = agent_vision_objective ||
      'Inspect the current desktop for visible evidence relevant to the active coding task. Identify errors, dialogs, browser or application state, build/test output, or other UI evidence that should influence the next safe action.'
    const vision = await runVisionTask(objective, frame.dataUrl, settings as unknown as Record<string, unknown>)

    let execution: BridgeRecord | null = null

    if (settings.permissions_mouse_control === true && vision.actions.length > 0) {
      try {
        execution = await base.executeAutomationActions(vision.actions as unknown as BridgeRecord[], {
          cwd: String(settings.agent_working_dir || '').trim() || undefined,
        }) as BridgeRecord
      } catch (error) {
        execution = {
          error: error instanceof Error ? error.message : 'The approved visual action plan failed.',
        }
      }
    }

    return {
      ...capabilities,
      screenCapture: true,
      source: frame.source,
      vision: {
        ...vision,
        actionsExecuted: Boolean(execution && !execution.error),
      },
      ...(execution ? { execution } : {}),
    }
  } catch (error) {
    return {
      ...capabilities,
      screenCapture: true,
      visionError: error instanceof Error ? error.message : 'Visual inspection failed.',
    }
  }
}

export async function listSkillDefinitions(
  profile: string,
): Promise<{ profile?: string; skills?: BridgeSkillDefinition[] }> {
  const result = await base.listSkillDefinitions(profile)
  const global_skills = Array.isArray(result?.skills) ? result.skills : []
  const workspace_root = editor_workspace_root ? await editor_workspace_root : ''

  if (!workspace_root) return result

  const project_skills = await loadProjectSkillDefinitions(workspace_root, {
    listDirectory,
    readTextFile,
  })

  return {
    ...result,
    skills: mergeProjectSkillDefinitions(global_skills, project_skills),
  }
}

export async function searchFileSemanticIndex(
  query: string,
  limit = 30,
  kind: BridgeFileSemanticSearchKind = 'all',
): Promise<BridgeFileSemanticResult[]> {
  const requested_limit = Math.max(1, Math.min(100, Math.round(Number(limit) || 30)))
  const workspace_root = editor_workspace_root ? await editor_workspace_root : ''
  const search_limit = workspace_root ? Math.min(100, requested_limit * 3) : requested_limit
  const results = await base.searchFileSemanticIndex(query, search_limit, kind)

  if (!workspace_root) return results.slice(0, requested_limit)
  return results
    .filter((result) => path_is_in_workspace(workspace_root, result.path))
    .slice(0, requested_limit)
}

export async function listDirectory(
  path: string,
  depth = 3,
): Promise<{ rootPath: string; tree: BridgeFileNode }> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.list', { path, depth })) as {
      rootPath: string
      tree: BridgeFileNode
    }
  }
  return base.listDirectory(path, depth)
}

export async function readTextFile(
  path: string,
  options: BridgeOptions & AgentFileOperationOptions = {},
): Promise<{ path: string; content: string; isBinary: boolean; revision?: string }> {
  if (editor_file_authority) {
    const result = (await editor_file_authority.execute('files.read', { path, ...options })) as {
      path: string
      content: string
      isBinary: boolean
      revision?: string
    }
    const { actor_id } = agent_operation_identity(options)
    remember_agent_revision(actor_id, result)
    return result
  }
  return base.readTextFile(path, options)
}

export async function writeTextFile(
  path: string,
  content: string,
  options: { append?: boolean; fileManager?: boolean } & AgentFileOperationOptions = {},
): Promise<BridgeRecord> {
  if (editor_file_authority && options.fileManager !== true) {
    const prepared = await prepare_editor_agent_write(path, options)
    const result = (await editor_file_authority.execute('files.write', {
      path,
      content,
      mode: options.append === true ? 'append' : 'create',
    })) as BridgeRecord
    finish_editor_agent_write(prepared, result, options)
    return result
  }
  return base.writeTextFile(path, content, options)
}

export async function editTextFile(
  path: string,
  oldText: string,
  newText: string,
  options: { replaceAll?: boolean; fileManager?: boolean } & AgentFileOperationOptions = {},
): Promise<BridgeRecord> {
  if (editor_file_authority && options.fileManager !== true) {
    const prepared = await prepare_editor_agent_write(path, options)
    const result = (await editor_file_authority.execute('files.edit', {
      path,
      oldText,
      newText,
      replaceAll: options.replaceAll === true,
    })) as BridgeRecord
    finish_editor_agent_write(prepared, result, options)
    return result
  }
  return base.editTextFile(path, oldText, newText, options)
}

export async function powerStat(path_or_paths: string | string[]): Promise<BridgeRecord> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.stat', {
      path: Array.isArray(path_or_paths) ? path_or_paths : [path_or_paths],
    })) as BridgeRecord
  }
  return base.powerStat(path_or_paths)
}

export async function powerDiff(
  path: string,
  new_content: string,
  context_lines = 3,
): Promise<BridgeRecord> {
  if (editor_file_authority) {
    return (await editor_file_authority.execute('files.diff', {
      path,
      newContent: new_content,
      contextLines: context_lines,
    })) as BridgeRecord
  }
  return base.powerDiff(path, new_content, context_lines)
}

export async function powerPatch(
  path: string,
  patch: string,
  dry_run = false,
  options: AgentFileOperationOptions = {},
): Promise<BridgeRecord> {
  if (editor_file_authority) {
    const prepared = dry_run ? null : await prepare_editor_agent_write(path, options)
    const result = (await editor_file_authority.execute('files.patch', {
      path,
      patch,
      dryRun: dry_run,
    })) as BridgeRecord
    if (!dry_run) finish_editor_agent_write(prepared, result, options)
    return result
  }
  return base.powerPatch(path, patch, dry_run)
}
