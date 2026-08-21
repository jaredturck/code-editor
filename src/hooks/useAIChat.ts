import { useEffect, useMemo, useRef, useState } from 'react'
import {
  build_core_agent_settings,
  normalize_agent_activity_event,
  normalize_persisted_chat_message,
  resolve_agent_chat_descriptor,
  sanitize_agent_timeline,
  should_block_core_agent_permission_grant,
  to_agent_attachments,
  to_agent_conversation,
} from '../chat/agentChat'
import { convert_recording_to_wav } from '../lib/audio'
import { runAgentSession } from '../platform/agentRuntime'
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
import type { AIAttachment, AIChatMessage, EditorSettings, TextEditorDocument } from '../types/editor'

const max_attachments = 4
const max_text_characters = 100000

function create_id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function provisional_chat_title(prompt: string) {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) {
    return 'New agent chat'
  }

  return clean.length <= 72 ? clean : `${clean.slice(0, 69)}…`
}

function get_recorder_mime_type() {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  return (
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ''
  )
}

function stop_stream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop()
  }
}

function useAIChat(
  settings: EditorSettings,
  activeDocument: TextEditorDocument | null,
  workspaceRoot: string | null,
) {
  const [messages, set_messages] = useState<AIChatMessage[]>([])
  const [attachments, set_attachments] = useState<AIAttachment[]>([])
  const [prompt, set_prompt] = useState('')
  const [generating, set_generating] = useState(false)
  const [restoring_chat, set_restoring_chat] = useState(true)
  const [error, set_error] = useState('')
  const [run_status, set_run_status] = useState('')
  const [recording, set_recording] = useState(false)
  const [transcribing, set_transcribing] = useState(false)
  const [recording_seconds, set_recording_seconds] = useState(0)
  const [speech_model_prompt, set_speech_model_prompt] = useState(false)
  const [platform_settings, set_platform_settings] = useState<OrbSettings>(() => readOrbSettings())
  const abort_controller_ref = useRef<AbortController | null>(null)
  const active_chat_id_ref = useRef<string | null>(getActiveChatId())
  const active_activity_ref = useRef<NonNullable<AIChatMessage['activity']>>([])
  const stream_step_ref = useRef<unknown>(null)
  const recorder_ref = useRef<MediaRecorder | null>(null)
  const stream_ref = useRef<MediaStream | null>(null)
  const chunks_ref = useRef<Blob[]>([])
  const recording_timer_ref = useRef<number | null>(null)
  const settings_ref = useRef(settings)
  const platform_settings_ref = useRef(platform_settings)
  const restoring_started_ref = useRef(false)
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

  useEffect(() => {
    if (restoring_started_ref.current) {
      return
    }

    restoring_started_ref.current = true
    let cancelled = false

    const restore_chat = async () => {
      const chat_id = getActiveChatId()
      active_chat_id_ref.current = chat_id

      if (!chat_id) {
        if (!cancelled) {
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
        }
      } catch (restore_error) {
        if (!cancelled) {
          set_error(
            restore_error instanceof Error
              ? restore_error.message
              : 'Encrypted chat history could not be restored.',
          )
        }
      } finally {
        if (!cancelled) {
          set_restoring_chat(false)
        }
      }
    }

    void restore_chat()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const remove_stop_listener = window.orbitDesktop?.onAgentStopRequest?.(() => {
      abort_controller_ref.current?.abort()
      approval_controller.clearApprovalRequests({ stopped: true })
      set_run_status('Emergency stop requested…')
    })

    return () => remove_stop_listener?.()
  }, [])

  useEffect(() => {
    return () => {
      abort_controller_ref.current?.abort()
      approval_controller.clearApprovalRequests({ stopped: true })
      stop_stream(stream_ref.current)
      if (recording_timer_ref.current !== null) {
        window.clearInterval(recording_timer_ref.current)
      }
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

    if (!file_path) {
      return
    }

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
    if (!turn_attachments.some((attachment) => attachment.type === 'image')) {
      return true
    }

    const current_descriptor = resolve_agent_chat_descriptor(platform_settings_ref.current)
    const fallback = modelImageCapability(current_descriptor.provider, current_descriptor.model)

    if (fallback.image) {
      return true
    }

    if (current_descriptor.provider !== 'local') {
      set_error(
        `${current_descriptor.provider_label} · ${current_descriptor.model} is not known to support image input.`,
      )
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
      set_error(
        capability_error instanceof Error
          ? capability_error.message
          : 'Unable to inspect the configured local model.',
      )
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
      set_error(
        'Core Agent Chat cannot grant persistent machine permissions yet. Configure them in Settings; workspace and terminal authority are enabled in later milestones.',
      )
      approval_controller.resolveApprovalRequest(request_id, 'deny')
      return
    }

    approval_controller.resolveApprovalRequest(request_id, normalized_decision)
  }

  const answer_question = (request_id: string, answer: string) => {
    approval_controller.resolveQuestionRequest(request_id, answer)
  }

  const submit_prompt = async () => {
    const next_prompt = prompt.trim()
    const turn_attachments = [...attachments]

    if ((!next_prompt && turn_attachments.length === 0) || generating || restoring_chat) {
      return
    }

    const descriptor = resolve_agent_chat_descriptor(platform_settings_ref.current)
    if (!descriptor.ready) {
      set_error(descriptor.message)
      return
    }

    if (!(await supports_image_attachments(turn_attachments))) {
      return
    }

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
        const created_chat = await createChat({
          provider: descriptor.provider,
          model: descriptor.model,
          title: provisional_chat_title(user_message.content),
        })
        chat_id = String(created_chat?.id || '')
        if (!chat_id) {
          throw new Error('Encrypted chat creation failed.')
        }

        active_chat_id_ref.current = chat_id
        setActiveChatId(chat_id)
      }

      await appendChatMessage(
        chat_id,
        'user',
        user_message.content,
        null,
        persistedChatAttachments(to_agent_attachments(turn_attachments)),
      )
    } catch (storage_error) {
      set_error(
        storage_error instanceof Error
          ? storage_error.message
          : 'The user message could not be stored securely.',
      )
      return
    }

    const assistant_message_id = create_id('assistant')
    const run_id = create_id('run')
    const assistant_message: AIChatMessage = {
      id: assistant_message_id,
      role: 'assistant',
      content: '',
      attachments: [],
      streaming: true,
      activity: [],
      provider: descriptor.provider,
      model: descriptor.model,
      run_id,
    }

    set_messages([...next_messages, assistant_message])
    set_prompt('')
    set_attachments([])
    set_error('')
    set_generating(true)
    set_run_status('Starting agent…')
    approval_controller.clearApprovalRequests()
    active_activity_ref.current = []
    stream_step_ref.current = null

    const abort_controller = new AbortController()
    abort_controller_ref.current = abort_controller
    const execution_settings = build_core_agent_settings(platform_settings_ref.current, workspaceRoot)
    const warm_state = getChatSessionState(chat_id)

    try {
      const context_messages = await buildConversationContext({
        chatId: chat_id,
        messages: to_agent_conversation(next_messages),
        settings: execution_settings,
      })

      const result = await runAgentSession({
        userInput: user_message.content,
        conversation: context_messages,
        settings: {
          ...execution_settings,
          attached_files: to_agent_attachments(turn_attachments),
          chat_session: { id: chat_id },
        },
        todos: warm_state?.todos || [],
        abortSignal: abort_controller.signal,
        onEvent: (event) => {
          if (event.type === 'stream') {
            const step = event.step
            const delta = String(event.delta || '')
            if (stream_step_ref.current !== step) {
              stream_step_ref.current = step
              set_messages((current) =>
                current.map((message) =>
                  message.id === assistant_message_id ? { ...message, content: delta } : message,
                ),
              )
            } else if (delta) {
              set_messages((current) =>
                current.map((message) =>
                  message.id === assistant_message_id
                    ? { ...message, content: message.content + delta }
                    : message,
                ),
              )
            }
            return
          }

          if (event.type === 'thinking_stream' || event.type === 'thinking' || event.type === 'reward') {
            return
          }

          const activity = normalize_agent_activity_event(event, active_activity_ref.current.length)
          if (!activity) {
            return
          }

          active_activity_ref.current = [...active_activity_ref.current, activity].slice(-200)
          set_run_status(activity.label)
          set_messages((current) =>
            current.map((message) =>
              message.id === assistant_message_id
                ? { ...message, activity: active_activity_ref.current }
                : message,
            ),
          )
        },
        onApprovalRequest: (request) =>
          new Promise<ApprovalResolution>((resolve) => {
            const request_id = create_id('approval')
            const request_type = String(request.requestType || 'permission').toLowerCase()
            const is_question = request_type === 'question'
            const timeout_ms = is_question ? QUESTION_REQUEST_TIMEOUT_MS : APPROVAL_REQUEST_TIMEOUT_MS
            const expires_at = Date.now() + timeout_ms

            approval_controller.approvalResolversRef.current.set(request_id, resolve)
            const timeout_id = setTimeout(() => {
              if (is_question) {
                approval_controller.resolveQuestionRequest(request_id, '', { timedOut: true })
              } else {
                approval_controller.resolveApprovalRequest(request_id, 'deny', { timedOut: true })
              }
            }, timeout_ms)
            approval_controller.approvalTimeoutsRef.current.set(request_id, timeout_id)
            approval_controller.setApprovalRequests((current) => [
              ...current,
              {
                ...request,
                id: request_id,
                requestType: request_type,
                createdAt: Date.now(),
                expiresAt: expires_at,
                reason: String(request.reason || ''),
                question: is_question
                  ? String(request.question || request.requestedAction || '')
                  : '',
                questionOptions:
                  is_question && Array.isArray(request.options)
                    ? request.options
                        .map((option) => {
                          if (option && typeof option === 'object') {
                            const source = option as Record<string, unknown>
                            return String(source.value ?? source.label ?? '')
                          }
                          return String(option || '')
                        })
                        .filter(Boolean)
                    : [],
                allowOther: is_question ? request.allowOther !== false : false,
                options: is_question ? [] : normalizeApprovalOptions(request as Partial<ApprovalRequest>),
                permissionKeys: normalizePersistentPermissionKeys(request.permissionKeys),
                persistentPermission: request.persistentPermission === true,
                recommendedDecision: normalizeApprovalDecision(request.recommendedDecision || ''),
              },
            ])
            set_run_status(is_question ? 'Waiting for your answer…' : 'Waiting for approval…')
          }),
      })

      const timeline = Array.isArray(result.timeline) ? result.timeline : []
      const activity = sanitize_agent_timeline(timeline)
      const persisted_timeline = activity.map((item) => ({ ...item }))
      const todos = Array.isArray(result.todos) ? result.todos : []
      const assistant_reply = String(result.reply || 'Done.')
      const created_at = Date.now()
      const meta = {
        runId: run_id,
        createdAt: created_at,
        userInput: user_message.content,
        reply: assistant_reply,
        timeline: persisted_timeline,
        todos,
        steps: result.steps || 0,
        summary: result.summary || null,
        skills: result.skills || null,
        safety: result.safety || null,
        artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
        provider: descriptor.provider,
        model: descriptor.model,
      }

      await appendChatMessage(chat_id, 'assistant', assistant_reply, meta)

      if (platform_settings_ref.current.chat_warm_session !== false) {
        const open_todos = todos.filter((todo) => String(todo.status || '').toLowerCase() !== 'done')
        saveChatSessionState(chat_id, {
          todos: open_todos,
          primaryOrchestratorId: `${descriptor.provider}:${descriptor.model}:${descriptor.key_id}`,
          executionPolicy: String(platform_settings_ref.current.agent_execution_policy || 'hybrid'),
        })
      }

      if (platform_settings_ref.current.agent_replay_enabled !== false) {
        await appendAgentRunDurable(
          {
            id: run_id,
            createdAt: created_at,
            userInput: user_message.content,
            reply: assistant_reply,
            steps: result.steps || 0,
            timeline: persisted_timeline,
            todos,
            summary: result.summary || null,
            skills: result.skills || { profile: '', active: [] },
            safety: result.safety || null,
          },
          Number(platform_settings_ref.current.agent_replay_max_runs) || 40,
        )
      }

      set_messages((current) =>
        current.map((message) =>
          message.id === assistant_message_id
            ? {
                ...message,
                content: assistant_reply,
                streaming: false,
                activity,
                provider: descriptor.provider,
                model: descriptor.model,
                run_id,
              }
            : message,
        ),
      )
      set_run_status('Agent completed')
    } catch (runtime_error) {
      const stopped = abort_controller.signal.aborted
      const message = stopped
        ? 'Stopped.'
        : runtime_error instanceof Error
          ? runtime_error.message
          : 'The agent run failed.'

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
        set_error(
          storage_error instanceof Error
            ? storage_error.message
            : 'The failed agent result could not be stored securely.',
        )
        set_messages((current) => current.filter((item) => item.id !== assistant_message_id))
        return
      }

      set_messages((current) =>
        current.map((item) =>
          item.id === assistant_message_id
            ? {
                ...item,
                content: message,
                streaming: false,
                error: !stopped,
                activity: active_activity_ref.current,
                provider: descriptor.provider,
                model: descriptor.model,
                run_id,
              }
            : item,
        ),
      )
      set_run_status(stopped ? 'Agent stopped' : 'Agent failed')
      if (!stopped) {
        set_error(message)
      }
    } finally {
      approval_controller.clearApprovalRequests({ stopped: abort_controller.signal.aborted })
      abort_controller_ref.current = null
      active_activity_ref.current = []
      stream_step_ref.current = null
      set_generating(false)
    }
  }

  const stop_generation = () => {
    if (!abort_controller_ref.current) {
      return
    }

    abort_controller_ref.current.abort()
    approval_controller.clearApprovalRequests({ stopped: true })
    set_run_status('Stopping agent…')
  }

  const clear_chat = async () => {
    if (generating) {
      return
    }

    const chat_id = active_chat_id_ref.current
    if (chat_id) {
      try {
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
      const transcript = await window.editor_api.ai.transcribe(
        settings_ref.current.ai.ollama_url,
        settings_ref.current.ai.speech_model,
        bytes,
      )
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
      const status = await window.editor_api.ai.speech_status(
        settings_ref.current.ai.ollama_url,
        settings_ref.current.ai.speech_model,
      )

      if (!status.ollama_available) {
        set_error('Ollama is not running.')
        return
      }

      if (!status.installed) {
        set_speech_model_prompt(true)
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const mime_type = get_recorder_mime_type()
      const recorder = mime_type ? new MediaRecorder(stream, { mimeType: mime_type }) : new MediaRecorder(stream)
      chunks_ref.current = []
      stream_ref.current = stream
      recorder_ref.current = recorder
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) {
          chunks_ref.current.push(event.data)
        }
      })
      recorder.addEventListener('stop', () => {
        const recording = new Blob(chunks_ref.current, {
          type: recorder.mimeType || 'audio/webm',
        })
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
    if (recorder_ref.current?.state === 'recording') {
      recorder_ref.current.stop()
    }
  }

  const install_speech_model = async () => {
    set_speech_model_prompt(false)
    set_transcribing(true)

    try {
      await window.editor_api.ai.install_speech_model(
        settings_ref.current.ai.ollama_url,
        settings_ref.current.ai.speech_model,
      )
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
    attachments,
    begin_recording,
    choose_attachment,
    clear_chat,
    connection_status,
    error,
    generating,
    install_speech_model,
    messages,
    prompt,
    recording,
    recording_seconds,
    resolve_approval,
    restoring_chat,
    run_status,
    remove_attachment,
    set_error,
    set_prompt,
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
