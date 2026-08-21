import { resolveAgentIdentity, resolveAgentRoleSettings } from '@/platform/agent/agentIdentity'
import { getToolPresentation } from '@/platform/agent/toolCatalog'
import { hasKeyFor } from '@/platform/keyStore'
import { findAIProvider } from '@/platform/providers/providerRegistry'
import { stripTerminalControlCharacters } from '@/platform/security'
import type { OrbSettings } from '@/platform/settingsStorage'
import type { AIAttachment, AgentActivityItem, AIChatMessage } from '@/types/editor'
import type { ProjectRunMode } from '@/chat/projectRunController'

export interface AgentChatDescriptor {
  provider: string
  provider_label: string
  model: string
  key_id: string
  ready: boolean
  status: 'ready' | 'unconfigured' | 'missing-key'
  message: string
}

const core_agent_tools = [
  'skills.list',
  'skills.search',
  'skills.load',
  'skills.offload',
  'resources.list',
  'approval.request',
  'user.ask',
  'todo.update',
  'chat.remember',
  'chat.recall',
  'context.summarize',
  'search.web',
  'web.fetch',
  'sources.lookup',
]

const editor_workspace_tools = [
  'files.list',
  'files.read',
  'files.write',
  'files.stat',
  'files.diff',
  'files.patch',
  'files.edit',
  'search.ripgrep',
  'search.find',
  'search.fd',
  'rag.retrieve',
]

const agent_terminal_tools = ['terminal.exec']

export function get_core_agent_tool_allowlist(
  workspace_root: string | null,
  terminal_enabled = false,
) {
  const tools = workspace_root ? [...core_agent_tools, ...editor_workspace_tools] : [...core_agent_tools]
  if (workspace_root && terminal_enabled) tools.push(...agent_terminal_tools)
  return tools
}

export function should_block_core_agent_permission_grant(
  request_type: string,
  permission_keys: string[],
) {
  return request_type === 'permission' && permission_keys.length > 0
}

export function resolve_agent_chat_descriptor(settings: OrbSettings): AgentChatDescriptor {
  const identity = resolveAgentIdentity('orchestrator', settings)
  const provider = findAIProvider(identity.provider)

  if (!identity.explicitlyAssigned || !identity.provider || !identity.model || !provider) {
    return {
      provider: identity.provider,
      provider_label: provider?.label || identity.provider || 'AI provider',
      model: identity.model,
      key_id: identity.keyId,
      ready: false,
      status: 'unconfigured',
      message: 'Assign an Orchestrator in Settings → AI → Agents.',
    }
  }

  if (provider.requiresApiKey && !hasKeyFor(identity.provider, identity.keyId)) {
    return {
      provider: identity.provider,
      provider_label: provider.label,
      model: identity.model,
      key_id: identity.keyId,
      ready: false,
      status: 'missing-key',
      message: `Save ${provider.label} Key ${identity.keyId} in Settings → AI → Providers.`,
    }
  }

  return {
    provider: identity.provider,
    provider_label: provider.label,
    model: identity.model,
    key_id: identity.keyId,
    ready: true,
    status: 'ready',
    message: `${provider.label} · ${identity.model}`,
  }
}

export function build_core_agent_settings(
  settings: OrbSettings,
  workspace_root: string | null,
  run_mode: ProjectRunMode = 'automatic',
) {
  const bound = resolveAgentRoleSettings('orchestrator', settings).settings

  return {
    ...bound,
    agent_working_dir: workspace_root || '',
    agent_multi_enabled: false,
    agent_execution_policy: 'primary_only',
    agent_model_routing: 'off',
    agent_peer_consult_enabled: false,
    agent_peer_review: 'off',
    agent_overwatch_continuous: false,
    agent_planning_mode: false,
    agent_project_run_mode: run_mode,
    force_session_alive: false,
    agent_permission_tier_orchestrator: Math.max(1, Number(bound.agent_permission_tier_orchestrator) || 1),
    permissions_file_read: Boolean(workspace_root && bound.permissions_file_read === true),
    permissions_file_write: Boolean(workspace_root && bound.permissions_file_write === true),
    permissions_terminal: Boolean(workspace_root && bound.permissions_terminal === true),
    permissions_screen_capture: false,
    permissions_mouse_control: false,
    agent_tool_allowlist: get_core_agent_tool_allowlist(workspace_root, Boolean(workspace_root && bound.permissions_terminal === true)),
  }
}

export function build_project_run_seed_todos(goal: string, run_mode: ProjectRunMode) {
  if (run_mode !== 'plan_first') return []
  const clean_goal = String(goal || '').replace(/\s+/g, ' ').trim()
  return [
    {
      id: 1,
      text: `Create a concrete execution plan for: ${clean_goal.slice(0, 160) || 'the current request'}`,
      status: 'in_progress',
    },
  ]
}

export function build_project_run_input(goal: string, run_mode: ProjectRunMode, resume = false) {
  const clean_goal = String(goal || '').trim()
  if (resume) {
    return `Resume the durable project run for this goal:\n${clean_goal}\n\nContinue from the persisted TODO state and current chat context. Do not redo completed tasks. Reconcile blocked or stale TODOs as needed before continuing.`
  }
  if (run_mode !== 'plan_first') return clean_goal
  return `PROJECT RUN MODE: PLAN FIRST. Before substantive execution, use todo.update to replace the planning placeholder with a concrete, task-specific TODO plan. Keep exactly one task in progress and revise the plan as new facts emerge. After the plan is concrete, call user.ask to show it to the user and ask for approval before continuing. If the user asks for revisions, update the TODO plan and ask again. Only begin substantive execution after approval.\n\nGoal:\n${clean_goal}`
}

export function to_agent_attachments(attachments: AIAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    type: attachment.type === 'image' ? attachment.mime_type || 'image/png' : 'text/plain',
    content: attachment.content,
    preview: attachment.preview,
  }))
}

export function to_agent_conversation(messages: AIChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.attachments.length ? { attachments: to_agent_attachments(message.attachments) } : {}),
  }))
}

function clean_text(value: unknown, max_characters: number) {
  const clean = stripTerminalControlCharacters(String(value || '')).trim()
  if (clean.length <= max_characters) return clean
  return `${clean.slice(0, max_characters)}…`
}

function activity_detail(event: Record<string, unknown>) {
  if (event.detail) return clean_text(event.detail, 800)
  const type = String(event.type || '')
  if (type === 'tool_call') return clean_text(event.argsPreview, 600)
  if (type === 'tool_result') return clean_text(event.summary || event.status, 300)
  if (type === 'todo') return clean_text(`${event.op || 'update'}: ${event.text || ''}`, 500)
  return clean_text(event.summary || event.body || event.reason || event.text, 700)
}

function activity_label(event: Record<string, unknown>) {
  if (event.label) return clean_text(event.label, 100)
  const type = String(event.type || '')
  const tool = String(event.tool || '')
  if (type === 'phase') return String(event.name || 'Agent phase')
  if (type === 'notice') return 'Notice'
  if (type === 'todo') return 'TODO update'
  if (type === 'cloud_request') return `Cloud request · ${String(event.provider || 'provider')}`
  if (type === 'cloud_response') return `Cloud response · ${String(event.provider || 'provider')}`
  if (type === 'tool_call') return getToolPresentation(tool).actionVerb || tool || 'Tool call'
  if (type === 'tool_result') {
    const action = getToolPresentation(tool).actionVerb || tool || 'Tool'
    return event.status === 'ok' ? `${action} complete` : `${action} failed`
  }
  if (type === 'skill') return `Skill · ${String(event.name || 'loaded')}`
  return clean_text(event.name || type || 'Agent activity', 100)
}

export function normalize_agent_activity_event(event: Record<string, unknown>, index = 0): AgentActivityItem | null {
  const type = String(event?.type || '').toLowerCase()
  if (!type || ['stream', 'thinking', 'thinking_stream', 'reward'].includes(type)) {
    return null
  }

  return {
    id: String(event.id || `activity-${Date.now().toString(36)}-${index}`),
    type,
    label: activity_label(event),
    detail: activity_detail(event),
    status: String(event.status || event.level || ''),
    tool: String(event.tool || ''),
    at: Number(event.at) || Date.now(),
  }
}

export function sanitize_agent_timeline(value: unknown): AgentActivityItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((event, index) =>
      event && typeof event === 'object'
        ? normalize_agent_activity_event(event as Record<string, unknown>, index)
        : null,
    )
    .filter((event): event is AgentActivityItem => Boolean(event))
    .slice(-200)
}

export function normalize_persisted_attachment(value: unknown): AIAttachment | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const content = String(source.content || '')
  const name = String(source.name || '')
  const source_type = String(source.type || '').toLowerCase()
  const mime_type = String(source.mime_type || '').toLowerCase()
  const image =
    source_type === 'image' || source_type.startsWith('image/') || mime_type.startsWith('image/')
  const resolved_mime_type = source_type.startsWith('image/')
    ? source_type
    : mime_type.startsWith('image/')
      ? mime_type
      : 'image/png'
  if (!content || !name) return null

  return {
    id: String(source.id || `attachment-${Date.now().toString(36)}`),
    name,
    type: image ? 'image' : 'text',
    content,
    mime_type: image ? resolved_mime_type : 'text/plain',
    preview: image ? `data:${resolved_mime_type};base64,${content}` : null,
  }
}

export function normalize_persisted_chat_message(value: unknown, index = 0): AIChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const role = String(source.role || '')
  if (role !== 'user' && role !== 'assistant') return null
  const meta = source.meta && typeof source.meta === 'object' ? (source.meta as Record<string, unknown>) : {}
  const attachments = Array.isArray(source.attachments)
    ? source.attachments
        .map(normalize_persisted_attachment)
        .filter((attachment): attachment is AIAttachment => Boolean(attachment))
    : []

  return {
    id: String(meta.message_id || `${role}-${index}`),
    role,
    content: String(source.content || ''),
    attachments,
    activity: sanitize_agent_timeline(meta.timeline),
    provider: String(meta.provider || ''),
    model: String(meta.model || ''),
    run_id: String(meta.runId || ''),
  }
}
