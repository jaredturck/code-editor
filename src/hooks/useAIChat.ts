import { useEffect, useMemo, useRef, useState } from 'react'
import {
  build_core_agent_settings,
  build_project_run_input,
  build_project_run_seed_todos,
  normalize_agent_activity_event,
  normalize_persisted_chat_message,
  resolve_agent_chat_descriptor,
  sanitize_agent_timeline,
  should_block_core_agent_permission_grant,
  to_agent_attachments,
  to_agent_conversation,
} from '../chat/agentChat'
import {
  is_active_project_run_status,
  is_resumable_project_run_status,
  project_run_elapsed_ms,
  projectRunController,
  type ProjectRunMode,
  type ProjectRunState,
} from '../chat/projectRunController'
import { convert_recording_to_wav } from '../lib/audio'
import { create_editor_file_authority, type EditorFileAuthorityHost } from '../chat/editorFileAuthority'
import { runAgentSession } from '../platform/agentRuntime'
import { setEditorFileAuthority } from '../platform/desktopBridge'
import { appendAgentRunDurable } from '../platform/agentRunStore'
import { buildConversationContext } from '../platform/chatContextBuilder'
import {
  appendChatMessage,
  createChat,
  getActiveChatId,
  getChatSessionState,
  loadChat,
  removeChat,
  saveChatSessionState,
  setActiveChatId,
} from '../platform/chatSessionStore'
import {
  APPROVAL_REQUEST_TIMEOUT_MS,
  QUESTION_REQUEST_TIMEOUT_MS,
} from '../platform-features/chat-ui/constants'
import { useApprovalController } from '../platform-features/chat-ui/controllers/useApprovalController'
import type { ApprovalRequest, ApprovalResolution } from '../platform-features/chat-ui/types'
import {
  isApprovalDecisionApproved,
  normalizeApprovalDecision,
  normalizeApprovalOptions,
} from '../platform-features/chat-ui/utils/approvals'
import { modelImageCapability, persistedChatAttachments } from '../platform-features/chat/chatAttachments'
import {
  normalizePersistentPermissionKeys,
  readOrbSettings,
  subscribeSettingsChanged,
} from '../platform/settingsStorage'
import type { OrbSettings } from '../platform/settingsStorage'
import type { AIAttachment, AIChatMessage, EditorDiagnostic, EditorSettings, TextEditorDocument } from '../types/editor'

const max_attachments = 4
const max_text_characters = 100000

function create_id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function provisional_chat_title(prompt: string) {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return 'New agent chat'
  return clean.length <= 72 ? clean : `${clean.slice(0, 69)}…`
}

function get_recorder_mime_type() {
  if (typeof MediaRecorder === 'undefined') return ''
  return (
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ''
  )
}

function stop_stream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

interface AgentEditorContext {
  diagnostics?: EditorDiagnostic[]
  file_host?: EditorFileAuthorityHost
}

function build_diagnostic_context(diagnostics: EditorDiagnostic[] | undefined, workspace_root: string | null) {
  if (!workspace_root || !diagnostics?.length) return ''
  const normalized_root = workspace_root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  const relevant = diagnostics
    .filter((item) => {
      const file_path = String(item.file_path || '').replace(/\\/g, '/').toLowerCase()
      return file_path === normalized_root || file_path.startsWith(`${normalized_root}/`)
    })
    .slice(0, 60)
  if (!relevant.length) return ''

  return [
    '',
    'CURRENT EDITOR DIAGNOSTICS:',
    ...relevant.map((item) => {
      const location = `${item.file_path || 'unknown'}:${item.line}:${item.column}`
      const code = item.code ? ` ${item.code}` : ''
      return `- [${item.severity}] ${location} ${item.source}${code}: ${item.message}`
    }),
    '',
    'Treat these diagnostics as live editor evidence. Re-check them after edits or terminal verification before declaring the task complete.',
  ].join('\n')
}

function useAIChat(
  settings: EditorSettings,
  activeDocument: TextEditorDocument | null,
  workspaceRoot: string | null,
  editorContext: AgentEditorContext = {},
) {
  const [messages, set_messages] = useState<AIChatMessage[]>([])
  const [attachments, set_attachments] = useState<AIAttachment[]>([])
  const [prompt, set_prompt] = useState('')
  const [generating, set_generating] = useState(false)
  const [restoring_chat, set_restoring_chat] = useState(true)
  const [error, set_error] = useState('')
  const [run_status, set_run_status] = useState('')
  const [project_run, set_project_run] = useState<ProjectRunState | null>(null)
  const [run_mode, set_run_mode] = useState<ProjectRunMode>('automatic')
  const [, set_run_clock] = useState(0)
  const [recording, set_recording] = useState(false)
  const [transcribing, set_transcribing] = useState(false)
  const [recording_seconds, set_recording_seconds] = useState(0)
  const [speech_model_prompt, set_speech_model_prompt] = useState(false)
  const [platform_settings, set_platform_settings] = useState<OrbSettings>(() => readOrbSettings())
  const active_chat_id_ref = useRef<string | null>(getActiveChatId())
  const active_activity_ref = useRef<NonNullable<AIChatMessage['activity']>>([])
  const stream_step_ref = useRef<unknown>(null)
  const recorder_ref = useRef<MediaRecorder | null>(null)
  const stream_ref = useRef<MediaStream | null>(null)
  const chunks_ref = useRef<Blob[]>([])
  const recording_timer_ref = useRef<number | null>(null)
  const settings_ref = useRef(settings)
  const platform_settings_ref = useRef(platform_settings)
  const approval_controller = useApprovalController(set_run_status)

  settings_ref.current = settings
  platform_settings_ref.current = platform_settings

  const agent_descriptor = useMemo(
    () => resolve_agent_chat_descriptor(platform_settings),
    [platform_settings],
  )
  const connection_status = restoring_chat
    ? ('checking' as const)
    : agent_descriptor.ready
      ? ('connected' as const)
      : ('offline' as const)

  useEffect(() => subscribeSettingsChanged(set_platform_settings), [])
  useEffect(() => projectRunController.subscribe(set_project_run), [])

  useEffect(() => {
    if (!project_run || !is_active_project_run_status(project_run.status)) return
    const timer = window.setInterval(() => set_run_clock((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [project_run?.id, project_run?.status])

  useEffect(() => {
    let cancelled = false

    const restore_chat = async () => {
      const chat_id = getActiveChatId()
      active_chat_id_ref.current = chat_id
      if (!chat_id) {
        if (!cancelled) {
          set_project_run(null)
          set_restoring_chat(false)
        }
        return
      }

      try {
        const chat = await loadChat(chat_id)
        if (!chat) {
          setActiveChatId(null)
          active_chat_id_ref.current = null
          if (!cancelled) {
            set_messages([])
            set_project_run(null)
          }
          return
        }
        const restored = Array.isArray(chat.messages)
          ? chat.messages
              .map(normalize_persisted_chat_message)
              .filter((message): message is AIChatMessage => Boolean(message))
          : []
        if (!cancelled) {
          set_messages(restored)
          const restored_run = projectRunController.restore(chat_id)
          set_run_mode(restored_run?.mode || 'automatic')
          if (restored_run?.status === 'interrupted') set_run_status('Previous project run was interrupted')
        }
      } catch (restore_error) {
        if (!cancelled) {
          set_error(restore_error instanceof Error ? restore_error.message : 'Encrypted chat history could not be restored.')
        }
      } finally {
        if (!cancelled) set_restoring_chat(false)
      }
    }

    void restore_chat()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const remove_stop_listener = window.orbitDesktop?.onAgentStopRequest?.(() => {
      projectRunController.request_cancel('Emergency stop requested')
      approval_controller.clearApprovalRequests({ stopped: true })
      set_run_status('Emergency stop requested…')
    })
    return () => remove_stop_listener?.()
  }, [])

  useEffect(() => {
    return () => {
      const state = projectRunController.get_state()
      if (state && is_active_project_run_status(state.status)) {
        projectRunController.checkpoint({ last_activity: 'Application closing during active run' })
      }
      approval_controller.clearApprovalRequests({ stopped: true })
      stop_stream(stream_ref.current)
      if (recording_timer_ref.current !== null) window.clearInterval(recording_timer_ref.current)
    }
  }, [])

  const add_attachment = (attachment: AIAttachment) => {
    set_attachments((current) => {
      if (current.length >= max_attachments) {
        set_error(`A maximum of ${max_attachments} attachments can be sent at once.`)
        return current
      }
      return [...current, attachment]
    })
  }

  const attach_active_file = () => {
    if (!activeDocument) {
      set_error('Open a text file before attaching the active document.')
      return
    }
    add_attachment({
      id: create_id('attachment'),
      name: activeDocument.name,
      type: 'text',
      content: activeDocument.content.slice(0, max_text_characters),
      mime_type: 'text/plain',
      preview: null,
    })
  }

  const choose_attachment = async () => {
    const file_path = await window.editor_api.dialog.open_file()
    if (!file_path) return
    try {
      const result = await window.editor_api.file.read_attachment(file_path)
      add_attachment({
        id: create_id('attachment'),
        name: result.name,
        type: result.type,
        content: result.type === 'text' ? result.content.slice(0, max_text_characters) : result.content,
        mime_type: result.mime_type,
        preview: result.type === 'image' ? `data:${result.mime_type};base64,${result.content}` : null,
      })
    } catch (attachment_error) {
      set_error(attachment_error instanceof Error ? attachment_error.message : 'Unable to attach that file.')
    }
  }

  const remove_attachment = (attachment_id: string) => {
    set_attachments((current) => current.filter((attachment) => attachment.id !== attachment_id))
  }

  const supports_image_attachments = async (turn_attachments: AIAttachment[]) => {
    if (!turn_attachments.some((attachment) => attachment.type === 'image')) return true
    const current_descriptor = resolve_agent_chat_descriptor(platform_settings_ref.current)
    const fallback = modelImageCapability(current_descriptor.provider, current_descriptor.model)
    if (fallback.image) return true
    if (current_descriptor.provider !== 'local') {
      set_error(`${current_descriptor.provider_label} · ${current_descriptor.model} is not known to support image input.`)
      return false
    }
    try {
      const local_url = String(platform_settings_ref.current.ai_local_url || settings_ref.current.ai.ollama_url)
      const capabilities = await window.editor_api.ai.model_capabilities(local_url, current_descriptor.model)
      if (!capabilities.image) {
        set_error(`${current_descriptor.model} does not advertise image support.`)
        return false
      }
      return true
    } catch (capability_error) {
      set_error(capability_error instanceof Error ? capability_error.message : 'Unable to inspect the configured local model.')
      return false
    }
  }

  const resolve_approval = async (request_id: string, decision: string) => {
    const request = approval_controller.approvalRequests.find((item) => item.id === request_id)
    const normalized_decision = normalizeApprovalDecision(decision)
    const approved = isApprovalDecisionApproved(normalized_decision)
    const request_type = String(request?.requestType || 'permission').toLowerCase()
    const permission_keys = normalizePersistentPermissionKeys(request?.permissionKeys)
    if (approved && should_block_core_agent_permission_grant(request_type, permission_keys)) {
      set_error('Agent Chat cannot grant persistent machine permissions. Configure workspace and terminal authority explicitly in Settings.')
      approval_controller.resolveApprovalRequest(request_id, 'deny')
      const state = projectRunController.get_state()
      if (state && is_active_project_run_status(state.status)) {
        projectRunController.set_status('running', { last_activity: 'Permission request denied' })
      }
      return
    }
    approval_controller.resolveApprovalRequest(request_id, normalized_decision)
    const state = projectRunController.get_state()
    if (state && is_active_project_run_status(state.status)) {
      projectRunController.set_status('running', { last_activity: 'Approval resolved' })
    }
  }

  const answer_question = (request_id: string, answer: string) => {
    approval_controller.resolveQuestionRequest(request_id, answer)
    const state = projectRunController.get_state()
    if (state && is_active_project_run_status(state.status)) {
      projectRunController.set_status('running', { last_activity: 'User input received' })
    }
  }

  const execute_project_segment = async ({
    chat_id,
    run_id,
    goal,
    mode,
    conversation_messages,
    turn_attachments,
    assistant_message_id,
    signal,
    todos,
    resume,
  }: {
    chat_id: string
    run_id: string
    goal: string
    mode: ProjectRunMode
    conversation_messages: AIChatMessage[]
    turn_attachments: AIAttachment[]
    assistant_message_id: string
    signal: AbortSignal
    todos: unknown[]
    resume: boolean
  }) => {
    const descriptor = resolve_agent_chat_descriptor(platform_settings_ref.current)
    const execution_settings = build_core_agent_settings(platform_settings_ref.current, workspaceRoot, mode)
    set_error('')
    set_generating(true)
    set_run_status(resume ? 'Resuming project run…' : mode === 'plan_first' ? 'Planning project run…' : 'Starting agent…')
    approval_controller.clearApprovalRequests()
    active_activity_ref.current = []
    stream_step_ref.current = null

    if (resume) {
      projectRunController.set_status(mode === 'plan_first' && todos.length === 0 ? 'planning' : 'running', {
        last_activity: 'Resuming project run',
      })
    }

    try {
      if (workspaceRoot && !resume) {
        set_run_status('Preparing source control…')
        projectRunController.checkpoint({ last_activity: 'Preparing source control baseline' })
        await window.editor_api.git.prepare_agent_run(workspaceRoot, run_id)
      }

      const context_messages = await buildConversationContext({
        chatId: chat_id,
        messages: to_agent_conversation(conversation_messages),
        settings: execution_settings,
      })
      if (!resume && mode !== 'plan_first') {
        projectRunController.set_status('running', { last_activity: 'Agent session started' })
      }

      const file_authority = editorContext.file_host ? create_editor_file_authority(workspaceRoot, editorContext.file_host) : null
      setEditorFileAuthority(file_authority)
      const diagnostic_context = build_diagnostic_context(editorContext.diagnostics, workspaceRoot)

      const result = await runAgentSession({
        userInput: `${build_project_run_input(goal, mode, resume)}${diagnostic_context}`,
        conversation: context_messages,
        settings: {
          ...execution_settings,
          attached_files: to_agent_attachments(turn_attachments),
          chat_session: { id: chat_id },
        },
        todos,
        abortSignal: signal,
        onCheckpoint: (checkpoint) => {
          if (checkpoint?.type === 'todos') {
            projectRunController.checkpoint({ todos: checkpoint.todos, last_activity: 'Project plan updated' })
            const checkpoint_todos = Array.isArray(checkpoint.todos) ? checkpoint.todos : []
            const planning_complete = mode !== 'plan_first' || checkpoint_todos.length > 1 || !String(checkpoint_todos[0]?.text || '').startsWith('Create a concrete execution plan for:')
            if (planning_complete && projectRunController.get_state()?.status === 'planning') {
              projectRunController.set_status('running', { last_activity: 'Project plan ready' })
            }
          }
        },
        onEvent: (event) => {
          if (event.type === 'stream') {
            const step = event.step
            const delta = String(event.delta || '')
            if (stream_step_ref.current !== step) {
              stream_step_ref.current = step
              set_messages((current) => current.map((message) => message.id === assistant_message_id ? { ...message, content: delta } : message))
            } else if (delta) {
              set_messages((current) => current.map((message) => message.id === assistant_message_id ? { ...message, content: message.content + delta } : message))
            }
            return
          }
          if (event.type === 'thinking_stream' || event.type === 'thinking' || event.type === 'reward') return
          const activity = normalize_agent_activity_event(event, active_activity_ref.current.length)
          if (!activity) return
          active_activity_ref.current = [...active_activity_ref.current, activity].slice(-200)
          set_run_status(activity.label)
          if (['phase', 'tool_result', 'notice', 'cloud_response'].includes(String(event.type))) {
            projectRunController.checkpoint({ last_activity: activity.label, steps: event.step })
          }
          set_messages((current) => current.map((message) => message.id === assistant_message_id ? { ...message, activity: active_activity_ref.current } : message))
        },
        onApprovalRequest: (request) => new Promise<ApprovalResolution>((resolve) => {
          const request_id = create_id('approval')
          const request_type = String(request.requestType || 'permission').toLowerCase()
          const is_question = request_type === 'question'
          const timeout_ms = is_question ? QUESTION_REQUEST_TIMEOUT_MS : APPROVAL_REQUEST_TIMEOUT_MS
          const expires_at = Date.now() + timeout_ms
          projectRunController.set_status(is_question ? 'waiting_for_user' : 'waiting_for_approval', {
            last_activity: is_question ? 'Waiting for user input' : 'Waiting for approval',
          })
          approval_controller.approvalResolversRef.current.set(request_id, resolve)
          const timeout_id = setTimeout(() => {
            if (is_question) approval_controller.resolveQuestionRequest(request_id, '', { timedOut: true })
            else approval_controller.resolveApprovalRequest(request_id, 'deny', { timedOut: true })
            const state = projectRunController.get_state()
            if (state && is_active_project_run_status(state.status)) {
              projectRunController.set_status('running', { last_activity: 'Approval request timed out' })
            }
          }, timeout_ms)
          approval_controller.approvalTimeoutsRef.current.set(request_id, timeout_id)
          approval_controller.setApprovalRequests((current) => [...current, {
            ...request,
            id: request_id,
            requestType: request_type,
            createdAt: Date.now(),
            expiresAt: expires_at,
            reason: String(request.reason || ''),
            question: is_question ? String(request.question || request.requestedAction || '') : '',
            questionOptions: is_question && Array.isArray(request.options)
              ? request.options.map((option) => option && typeof option === 'object' ? String((option as Record<string, unknown>).value ?? (option as Record<string, unknown>).label ?? '') : String(option || '')).filter(Boolean)
              : [],
            allowOther: is_question ? request.allowOther !== false : false,
            options: is_question ? [] : normalizeApprovalOptions(request as Partial<ApprovalRequest>),
            permissionKeys: normalizePersistentPermissionKeys(request.permissionKeys),
            persistentPermission: request.persistentPermission === true,
            recommendedDecision: normalizeApprovalDecision(request.recommendedDecision || ''),
          }])
          set_run_status(is_question ? 'Waiting for your answer…' : 'Waiting for approval…')
        }),
      })

      projectRunController.set_status('finalizing', { last_activity: 'Finalizing project run' })
      const timeline = Array.isArray(result.timeline) ? result.timeline : []
      const activity = sanitize_agent_timeline(timeline)
      const persisted_timeline = activity.map((item) => ({ ...item }))
      const result_todos = Array.isArray(result.todos) ? result.todos : []
      const assistant_reply = String(result.reply || 'Done.')
      const unresolved = result_todos.filter((todo) => {
        const status = String(todo.status || '').toLowerCase()
        return status === 'pending' || status === 'in_progress'
      })
      let git_commit: string | null = null
      let removed_nested_repositories: string[] = []

      if (workspaceRoot && unresolved.length === 0) {
        set_run_status('Committing project changes…')
        projectRunController.checkpoint({ last_activity: 'Creating local source control checkpoint' })
        const git_result = await window.editor_api.git.commit_agent_changes(workspaceRoot, run_id, goal)
        git_commit = git_result.commit
        removed_nested_repositories = git_result.removed_nested_repositories
      }

      const created_at = Date.now()
      const meta = {
        runId: run_id,
        createdAt: created_at,
        userInput: goal,
        reply: assistant_reply,
        timeline: persisted_timeline,
        todos: result_todos,
        steps: result.steps || 0,
        summary: result.summary || null,
        skills: result.skills || null,
        safety: result.safety || null,
        artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
        provider: descriptor.provider,
        model: descriptor.model,
        git: workspaceRoot
          ? {
              commit: git_commit,
              removedNestedRepositories: removed_nested_repositories,
            }
          : null,
      }
      await appendChatMessage(chat_id, 'assistant', assistant_reply, meta)
      const open_todos = result_todos.filter((todo) => String(todo.status || '').toLowerCase() !== 'done')
      if (platform_settings_ref.current.chat_warm_session !== false) {
        saveChatSessionState(chat_id, {
          todos: open_todos,
          primaryOrchestratorId: `${descriptor.provider}:${descriptor.model}:${descriptor.key_id}`,
          executionPolicy: String(platform_settings_ref.current.agent_execution_policy || 'hybrid'),
        })
      }
      if (platform_settings_ref.current.agent_replay_enabled !== false) {
        await appendAgentRunDurable({
          id: run_id,
          createdAt: created_at,
          userInput: goal,
          reply: assistant_reply,
          steps: result.steps || 0,
          timeline: persisted_timeline,
          todos: result_todos,
          summary: result.summary || null,
          skills: result.skills || { profile: '', active: [] },
          safety: result.safety || null,
        }, Number(platform_settings_ref.current.agent_replay_max_runs) || 40)
      }
      set_messages((current) => current.map((message) => message.id === assistant_message_id ? {
        ...message,
        content: assistant_reply,
        streaming: false,
        activity,
        provider: descriptor.provider,
        model: descriptor.model,
        run_id,
      } : message))

      const budget_pause = unresolved.length > 0 && /paused here|halted|time budget|stopped after/i.test(assistant_reply)
      if (budget_pause) {
        projectRunController.set_status('paused', { todos: result_todos, steps: result.steps, summary: result.summary, last_activity: 'Paused at runtime budget boundary' })
        set_run_status('Project run paused')
      } else if (unresolved.length > 0) {
        projectRunController.set_status('paused', {
          todos: result_todos,
          steps: result.steps,
          summary: result.summary,
          error: `Completion verification found ${unresolved.length} unresolved task(s).`,
          last_activity: 'Completion verification paused the run with unresolved tasks',
        })
        set_run_status('Project run paused for unresolved tasks')
      } else {
        projectRunController.complete({ todos: result_todos, steps: result.steps, summary: result.summary, last_activity: 'Project run completed' })
        set_run_status('Project run completed')
      }
    } catch (runtime_error) {
      const paused = projectRunController.is_pause_requested()
      const stopped = signal.aborted
      const message = paused ? 'Paused. Resume when ready.' : stopped ? 'Stopped.' : runtime_error instanceof Error ? runtime_error.message : 'The agent run failed.'
      if (!paused) {
        window.editor_api.git.abandon_agent_run(run_id)
      }
      try {
        await appendChatMessage(chat_id, 'assistant', message, {
          runId: run_id,
          createdAt: Date.now(),
          provider: descriptor.provider,
          model: descriptor.model,
          error: !stopped,
          timeline: active_activity_ref.current,
        })
      } catch (storage_error) {
        set_error(storage_error instanceof Error ? storage_error.message : 'The interrupted agent result could not be stored securely.')
        set_messages((current) => current.filter((item) => item.id !== assistant_message_id))
        return
      }
      set_messages((current) => current.map((item) => item.id === assistant_message_id ? {
        ...item,
        content: message,
        streaming: false,
        error: !stopped,
        activity: active_activity_ref.current,
        provider: descriptor.provider,
        model: descriptor.model,
        run_id,
      } : item))
      if (paused) set_run_status('Project run paused')
      else if (stopped) set_run_status('Project run cancelled')
      else {
        projectRunController.fail(message, { last_activity: 'Project run failed', todos: projectRunController.get_state()?.todos || todos })
        set_run_status('Project run failed')
        set_error(message)
      }
    } finally {
      approval_controller.clearApprovalRequests({ stopped: signal.aborted })
      setEditorFileAuthority(null)
      projectRunController.finish_segment()
      active_activity_ref.current = []
      stream_step_ref.current = null
      set_generating(false)
    }
  }

  const submit_prompt = async () => {
    const next_prompt = prompt.trim()
    const turn_attachments = [...attachments]
    if ((!next_prompt && turn_attachments.length === 0) || generating || restoring_chat) return
    const existing_run = projectRunController.get_state()
    if (existing_run && (is_active_project_run_status(existing_run.status) || is_resumable_project_run_status(existing_run.status))) {
      set_error('Resume, cancel, or clear the existing project run before starting another one.')
      return
    }
    const descriptor = resolve_agent_chat_descriptor(platform_settings_ref.current)
    if (!descriptor.ready) {
      set_error(descriptor.message)
      return
    }
    if (!(await supports_image_attachments(turn_attachments))) return

    const user_message: AIChatMessage = {
      id: create_id('user'),
      role: 'user',
      content: next_prompt || 'Review the attached files.',
      attachments: turn_attachments,
    }
    const next_messages = [...messages, user_message]
    let chat_id = active_chat_id_ref.current
    try {
      if (!chat_id) {
        const created_chat = await createChat({ provider: descriptor.provider, model: descriptor.model, title: provisional_chat_title(user_message.content) })
        chat_id = String(created_chat?.id || '')
        if (!chat_id) throw new Error('Encrypted chat creation failed.')
        active_chat_id_ref.current = chat_id
        setActiveChatId(chat_id)
      }
      await appendChatMessage(chat_id, 'user', user_message.content, null, persistedChatAttachments(to_agent_attachments(turn_attachments)))
    } catch (storage_error) {
      set_error(storage_error instanceof Error ? storage_error.message : 'The user message could not be stored securely.')
      return
    }

    const assistant_message_id = create_id('assistant')
    const run_id = create_id('run')
    const seed_todos = build_project_run_seed_todos(user_message.content, run_mode)
    const segment = projectRunController.begin({
      id: run_id,
      chat_id,
      goal: user_message.content,
      mode: run_mode,
      provider: descriptor.provider,
      model: descriptor.model,
      todos: seed_todos,
    })
    set_messages([...next_messages, {
      id: assistant_message_id,
      role: 'assistant',
      content: '',
      attachments: [],
      streaming: true,
      activity: [],
      provider: descriptor.provider,
      model: descriptor.model,
      run_id,
    }])
    set_prompt('')
    set_attachments([])
    await execute_project_segment({
      chat_id,
      run_id,
      goal: user_message.content,
      mode: run_mode,
      conversation_messages: next_messages,
      turn_attachments,
      assistant_message_id,
      signal: segment.signal,
      todos: seed_todos,
      resume: false,
    })
  }

  const resume_project_run = async () => {
    const state = projectRunController.get_state()
    const chat_id = active_chat_id_ref.current
    if (!state || !chat_id || generating || !is_resumable_project_run_status(state.status)) return
    const descriptor = resolve_agent_chat_descriptor(platform_settings_ref.current)
    if (!descriptor.ready) {
      set_error(descriptor.message)
      return
    }
    const segment = projectRunController.resume(descriptor.provider, descriptor.model)
    if (!segment) return
    const assistant_message_id = create_id('assistant')
    set_messages((current) => [...current, {
      id: assistant_message_id,
      role: 'assistant',
      content: '',
      attachments: [],
      streaming: true,
      activity: [],
      provider: descriptor.provider,
      model: descriptor.model,
      run_id: state.id,
    }])
    await execute_project_segment({
      chat_id,
      run_id: state.id,
      goal: state.goal,
      mode: state.mode,
      conversation_messages: messages,
      turn_attachments: [],
      assistant_message_id,
      signal: segment.signal,
      todos: state.todos,
      resume: true,
    })
  }

  const pause_project_run = () => {
    if (!projectRunController.request_pause()) return
    approval_controller.clearApprovalRequests({ stopped: true })
    set_run_status('Pausing project run…')
  }

  const cancel_project_run = () => {
    projectRunController.request_cancel('Cancelled by user')
    approval_controller.clearApprovalRequests({ stopped: true })
    set_run_status('Project run cancelled')
  }

  const stop_generation = () => {
    projectRunController.request_cancel('Stopped by user')
    approval_controller.clearApprovalRequests({ stopped: true })
    set_run_status('Stopping agent…')
  }

  const clear_chat = async () => {
    if (generating) return
    const chat_id = active_chat_id_ref.current
    if (chat_id) {
      try {
        projectRunController.clear(chat_id)
        await removeChat(chat_id)
      } catch (remove_error) {
        set_error(remove_error instanceof Error ? remove_error.message : 'Unable to clear encrypted chat history.')
        return
      }
    }
    setActiveChatId(null)
    active_chat_id_ref.current = null
    set_messages([])
    set_error('')
    set_run_status('')
  }

  const finish_recording = async (recording_blob: Blob) => {
    set_transcribing(true)
    try {
      const wav = await convert_recording_to_wav(recording_blob)
      const bytes = new Uint8Array(await wav.arrayBuffer())
      const transcript = await window.editor_api.ai.transcribe(settings_ref.current.ai.ollama_url, settings_ref.current.ai.speech_model, bytes)
      set_prompt((current) => `${current}${current ? ' ' : ''}${transcript}`)
    } catch (transcription_error) {
      set_error(transcription_error instanceof Error ? transcription_error.message : 'Audio transcription failed.')
    } finally {
      set_transcribing(false)
    }
  }

  const begin_recording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      set_error('Microphone recording is not supported by this runtime.')
      return
    }
    try {
      const status = await window.editor_api.ai.speech_status(settings_ref.current.ai.ollama_url, settings_ref.current.ai.speech_model)
      if (!status.ollama_available) {
        set_error('Ollama is not running.')
        return
      }
      if (!status.installed) {
        set_speech_model_prompt(true)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      const mime_type = get_recorder_mime_type()
      const recorder = mime_type ? new MediaRecorder(stream, { mimeType: mime_type }) : new MediaRecorder(stream)
      chunks_ref.current = []
      stream_ref.current = stream
      recorder_ref.current = recorder
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks_ref.current.push(event.data) })
      recorder.addEventListener('stop', () => {
        const recording = new Blob(chunks_ref.current, { type: recorder.mimeType || 'audio/webm' })
        chunks_ref.current = []
        stop_stream(stream_ref.current)
        stream_ref.current = null
        set_recording(false)
        set_recording_seconds(0)
        if (recording_timer_ref.current !== null) {
          window.clearInterval(recording_timer_ref.current)
          recording_timer_ref.current = null
        }
        void finish_recording(recording)
      })
      recorder.start(250)
      set_recording(true)
      set_recording_seconds(0)
      recording_timer_ref.current = window.setInterval(() => set_recording_seconds((current) => current + 1), 1000)
    } catch (recording_error) {
      stop_stream(stream_ref.current)
      set_error(recording_error instanceof Error ? recording_error.message : 'Microphone access failed.')
    }
  }

  const stop_recording = () => {
    if (recorder_ref.current?.state === 'recording') recorder_ref.current.stop()
  }

  const install_speech_model = async () => {
    set_speech_model_prompt(false)
    set_transcribing(true)
    try {
      await window.editor_api.ai.install_speech_model(settings_ref.current.ai.ollama_url, settings_ref.current.ai.speech_model)
      await begin_recording()
    } catch (install_error) {
      set_error(install_error instanceof Error ? install_error.message : 'Unable to install the speech model.')
    } finally {
      set_transcribing(false)
    }
  }

  return {
    agent_descriptor,
    answer_question,
    approval_requests: approval_controller.approvalRequests,
    cancel_project_run,
    attachments,
    begin_recording,
    choose_attachment,
    clear_chat,
    connection_status,
    error,
    generating,
    install_speech_model,
    messages,
    pause_project_run,
    project_run,
    project_run_budget_minutes: Math.max(1, Number(platform_settings.agent_session_minutes) || 15),
    project_run_elapsed_seconds: Math.floor(project_run_elapsed_ms(project_run) / 1000),
    prompt,
    recording,
    recording_seconds,
    resolve_approval,
    resume_project_run,
    run_mode,
    restoring_chat,
    run_status,
    remove_attachment,
    set_error,
    set_prompt,
    set_run_mode,
    set_speech_model_prompt,
    speech_model_prompt,
    stop_generation,
    stop_recording,
    submit_prompt,
    transcribing,
    attach_active_file,
  }
}

export default useAIChat
