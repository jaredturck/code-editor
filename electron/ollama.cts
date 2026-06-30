export interface OllamaModel {
  name: string
  size: number
  modified_at: string
}

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
}

export function normalize_ollama_url(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434'

  return trimmed.replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1')
}

async function read_error(response: Response) {
  const text = await response.text().catch(() => '')

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string }
    return parsed.error || parsed.message || text || `Request failed (${response.status})`
  } catch {
    return text || `Request failed (${response.status})`
  }
}

export async function list_ollama_models(base_url: string): Promise<OllamaModel[]> {
  const response = await fetch(`${normalize_ollama_url(base_url)}/api/tags`)

  if (!response.ok) {
    throw new Error(await read_error(response))
  }

  const data = (await response.json()) as {
    models?: Array<{
      name?: string
      model?: string
      size?: number
      modified_at?: string
    }>
  }

  return (data.models ?? [])
    .map((model) => ({
      name: model.name || model.model || '',
      size: Number(model.size) || 0,
      modified_at: model.modified_at || '',
    }))
    .filter((model) => model.name)
    .sort((first, second) => first.name.localeCompare(second.name))
}

export async function get_ollama_model_capabilities(base_url: string, model: string) {
  const response = await fetch(`${normalize_ollama_url(base_url)}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })

  if (!response.ok) {
    throw new Error(await read_error(response))
  }

  const data = (await response.json()) as {
    capabilities?: string[]
    details?: { families?: string[]; family?: string }
    model_info?: Record<string, unknown>
  }
  const capabilities = new Set((data.capabilities ?? []).map((capability) => capability.toLowerCase()))
  const metadata = JSON.stringify(data).toLowerCase()

  return {
    image: capabilities.has('vision') || capabilities.has('image') || metadata.includes('vision'),
  }
}

export async function stream_ollama_chat(
  base_url: string,
  model: string,
  messages: OllamaMessage[],
  signal: AbortSignal,
  on_chunk: (content: string, thinking: string) => void,
) {
  const response = await fetch(`${normalize_ollama_url(base_url)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(await read_error(response))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consume_line = (line: string) => {
    if (!line.trim()) {
      return
    }

    const data = JSON.parse(line) as {
      error?: string
      message?: {
        content?: string
        thinking?: string
        reasoning_content?: string
      }
    }

    if (data.error) {
      throw new Error(data.error)
    }

    on_chunk(data.message?.content ?? '', data.message?.thinking ?? data.message?.reasoning_content ?? '')
  }

  while (true) {
    const result = await reader.read()

    if (result.done) {
      break
    }

    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      consume_line(line)
    }
  }

  buffer += decoder.decode()

  if (buffer.trim()) {
    consume_line(buffer)
  }
}

export async function get_speech_model_status(base_url: string, speech_model: string) {
  const models = await list_ollama_models(base_url)

  return {
    ollama_available: true,
    installed: models.some((model) => model.name === speech_model || model.name.startsWith(`${speech_model}:`)),
  }
}

export async function install_speech_model(base_url: string, speech_model: string) {
  const response = await fetch(`${normalize_ollama_url(base_url)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: speech_model, stream: false }),
  })

  if (!response.ok) {
    throw new Error(await read_error(response))
  }

  return true
}

export async function transcribe_audio(base_url: string, speech_model: string, audio: Uint8Array) {
  const form = new FormData()
  form.append('model', speech_model)
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav')
  const response = await fetch(`${normalize_ollama_url(base_url)}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
  })

  if (!response.ok) {
    throw new Error(await read_error(response))
  }

  const data = (await response.json()) as { text?: string }

  if (!data.text?.trim()) {
    throw new Error('The transcription model returned no text.')
  }

  return data.text.trim()
}
