import { useEffect, useRef, useState } from 'react'
import { convert_recording_to_wav } from '../lib/audio'
import type { AIAttachment, AIChatMessage, AIModel, EditorSettings, TextEditorDocument } from '../types/editor'

const max_attachments = 4
const max_text_characters = 100000

function create_id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
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
  onUpdateSettings: (settings: EditorSettings) => void,
  activeDocument: TextEditorDocument | null,
) {
  const [models, set_models] = useState<AIModel[]>([])
  const [messages, set_messages] = useState<AIChatMessage[]>([])
  const [attachments, set_attachments] = useState<AIAttachment[]>([])
  const [prompt, set_prompt] = useState('')
  const [connection_status, set_connection_status] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [loading_models, set_loading_models] = useState(false)
  const [generating, set_generating] = useState(false)
  const [error, set_error] = useState('')
  const [recording, set_recording] = useState(false)
  const [transcribing, set_transcribing] = useState(false)
  const [recording_seconds, set_recording_seconds] = useState(0)
  const [speech_model_prompt, set_speech_model_prompt] = useState(false)
  const request_id_ref = useRef<string | null>(null)
  const recorder_ref = useRef<MediaRecorder | null>(null)
  const stream_ref = useRef<MediaStream | null>(null)
  const chunks_ref = useRef<Blob[]>([])
  const recording_timer_ref = useRef<number | null>(null)
  const settings_ref = useRef(settings)

  settings_ref.current = settings

  const refresh_models = async () => {
    set_loading_models(true)
    set_connection_status('checking')
    set_error('')

    try {
      const installed_models = await window.editor_api.ai.list_models(settings_ref.current.ai.ollama_url)
      set_models(installed_models)
      set_connection_status('connected')

      if (
        installed_models.length > 0 &&
        !installed_models.some((model) => model.name === settings_ref.current.ai.selected_model)
      ) {
        onUpdateSettings({
          ...settings_ref.current,
          ai: {
            ...settings_ref.current.ai,
            selected_model: installed_models[0].name,
          },
        })
      }
    } catch (model_error) {
      set_models([])
      set_connection_status('offline')
      set_error(model_error instanceof Error ? model_error.message : 'Ollama is unavailable.')
    } finally {
      set_loading_models(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh_models()
    }, 500)

    return () => window.clearTimeout(timer)
  }, [settings.ai.ollama_url])

  useEffect(() => {
    const remove_chunk = window.editor_api.ai.on_chat_chunk((payload) => {
      if (payload.request_id !== request_id_ref.current) {
        return
      }

      set_messages((current) =>
        current.map((message) =>
          message.id === payload.request_id ? { ...message, content: message.content + payload.content } : message,
        ),
      )
    })
    const remove_complete = window.editor_api.ai.on_chat_complete((payload) => {
      if (payload.request_id !== request_id_ref.current) {
        return
      }

      set_messages((current) =>
        current.map((message) => (message.id === payload.request_id ? { ...message, streaming: false } : message)),
      )
      request_id_ref.current = null
      set_generating(false)
    })
    const remove_error = window.editor_api.ai.on_chat_error((payload) => {
      if (payload.request_id !== request_id_ref.current) {
        return
      }

      set_messages((current) =>
        current.map((message) =>
          message.id === payload.request_id
            ? {
                ...message,
                content: message.content || payload.message,
                streaming: false,
                error: true,
              }
            : message,
        ),
      )
      request_id_ref.current = null
      set_generating(false)
      set_error(payload.message)
    })

    return () => {
      remove_chunk()
      remove_complete()
      remove_error()
    }
  }, [])

  useEffect(() => {
    return () => {
      stop_stream(stream_ref.current)
      if (recording_timer_ref.current !== null) {
        window.clearInterval(recording_timer_ref.current)
      }
      if (request_id_ref.current) {
        window.editor_api.ai.cancel_chat(request_id_ref.current)
      }
    }
  }, [])

  const set_selected_model = (model: string) => {
    onUpdateSettings({
      ...settings_ref.current,
      ai: { ...settings_ref.current.ai, selected_model: model },
    })
  }

  const set_ollama_url = (ollama_url: string) => {
    onUpdateSettings({
      ...settings_ref.current,
      ai: { ...settings_ref.current.ai, ollama_url },
    })
  }

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

  const submit_prompt = async () => {
    const next_prompt = prompt.trim()
    const model = settings_ref.current.ai.selected_model

    if ((!next_prompt && attachments.length === 0) || generating) {
      return
    }

    if (!model) {
      set_error('Choose an installed Ollama model first.')
      return
    }

    const image_attachments = attachments.filter((attachment) => attachment.type === 'image')

    if (image_attachments.length > 0) {
      try {
        const capabilities = await window.editor_api.ai.model_capabilities(settings_ref.current.ai.ollama_url, model)

        if (!capabilities.image) {
          set_error(`${model} does not advertise image support.`)
          return
        }
      } catch (capability_error) {
        set_error(
          capability_error instanceof Error ? capability_error.message : 'Unable to inspect the selected model.',
        )
        return
      }
    }

    const user_message: AIChatMessage = {
      id: create_id('user'),
      role: 'user',
      content: next_prompt || 'Review the attached files.',
      attachments,
    }
    const request_id = create_id('assistant')
    const assistant_message: AIChatMessage = {
      id: request_id,
      role: 'assistant',
      content: '',
      attachments: [],
      streaming: true,
    }
    const next_messages = [...messages, user_message]
    const ollama_messages = next_messages.map((message) => {
      const text_context = message.attachments
        .filter((attachment) => attachment.type === 'text')
        .map(
          (attachment) => `

--- ${attachment.name} ---
${attachment.content}`,
        )
        .join('')

      return {
        role: message.role,
        content: message.role === 'user' ? `${message.content}${text_context}` : message.content,
        images:
          message.role === 'user'
            ? message.attachments
                .filter((attachment) => attachment.type === 'image')
                .map((attachment) => attachment.content)
            : undefined,
      }
    })

    set_messages([...next_messages, assistant_message])
    set_prompt('')
    set_attachments([])
    set_error('')
    set_generating(true)
    request_id_ref.current = request_id
    window.editor_api.ai.start_chat({
      request_id,
      base_url: settings_ref.current.ai.ollama_url,
      model,
      messages: ollama_messages,
    })
  }

  const stop_generation = () => {
    if (!request_id_ref.current) {
      return
    }

    window.editor_api.ai.cancel_chat(request_id_ref.current)
    set_messages((current) =>
      current.map((message) => (message.id === request_id_ref.current ? { ...message, streaming: false } : message)),
    )
    request_id_ref.current = null
    set_generating(false)
  }

  const clear_chat = () => {
    stop_generation()
    set_messages([])
    set_error('')
  }

  const finish_recording = async (recording: Blob) => {
    set_transcribing(true)

    try {
      const wav = await convert_recording_to_wav(recording)
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
        const recording_blob = new Blob(chunks_ref.current, {
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
        void finish_recording(recording_blob)
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
    attachments,
    begin_recording,
    choose_attachment,
    clear_chat,
    connection_status,
    error,
    generating,
    install_speech_model,
    loading_models,
    messages,
    models,
    prompt,
    recording,
    recording_seconds,
    refresh_models,
    remove_attachment,
    set_error,
    set_ollama_url,
    set_prompt,
    selected_model: settings.ai.selected_model,
    set_selected_model,
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
