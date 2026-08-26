/**
 * Exercises the bounded, in-memory Ollama transcription service without contacting Ollama.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getNoteTranscriptionStatus,
  installNoteTranscriptionModel,
  NOTE_TRANSCRIPTION_MODEL,
  transcribeAudio,
  transcribeNoteAudio,
} from '../../backend/desktopBridge/services/audioTranscriptionService'

function wavBuffer(): Buffer {
  const buffer = Buffer.alloc(44)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24)
  buffer.writeUInt32LE(32000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(0, 40)
  return buffer
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('audioTranscriptionService', () => {
  it('reports the fixed Granite model as installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: NOTE_TRANSCRIPTION_MODEL }] }),
      }),
    )

    await expect(getNoteTranscriptionStatus()).resolves.toMatchObject({
      ollamaAvailable: true,
      modelInstalled: true,
      model: NOTE_TRANSCRIPTION_MODEL,
    })
  })

  it('downloads the fixed Granite model through Ollama', async () => {
    let installed = false
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({
            models: installed ? [{ name: NOTE_TRANSCRIPTION_MODEL }] : [],
          }),
        }
      }
      if (url.endsWith('/api/pull')) {
        expect(JSON.parse(String(options?.body))).toEqual({
          model: NOTE_TRANSCRIPTION_MODEL,
          stream: false,
        })
        installed = true
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'success' }),
        }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(installNoteTranscriptionModel()).resolves.toMatchObject({
      ollamaAvailable: true,
      modelInstalled: true,
    })
  })

  it('forwards WAV audio as multipart data and returns NDJSON text', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: NOTE_TRANSCRIPTION_MODEL }] }),
        }
      }
      if (url.endsWith('/v1/audio/transcriptions')) {
        expect(options?.method).toBe('POST')
        const form = options?.body as FormData
        expect(form.get('model')).toBe(NOTE_TRANSCRIPTION_MODEL)
        expect(form.get('language')).toBe('en')
        expect(form.get('response_format')).toBe('json')
        expect(form.get('file')).toBeInstanceOf(Blob)
        return {
          ok: true,
          status: 200,
          text: async () => '{"text":"dictated note"}\n',
        }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeNoteAudio(wavBuffer())).resolves.toBe('dictated note')
  })

  it('uses OpenAI transcription when a cloud audio binding is configured', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer cloud-key')
      const form = options?.body as FormData
      expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
      expect(form.get('file')).toBeInstanceOf(Blob)
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'cloud transcript' }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeAudio(wavBuffer(), {
        provider: 'openai',
        model: 'gpt-4o-mini-transcribe',
        apiKey: 'cloud-key',
        localFallback: true,
      }),
    ).resolves.toEqual({
      text: 'cloud transcript',
      provider: 'openai',
      model: 'gpt-4o-mini-transcribe',
      fallbackUsed: false,
    })
  })

  it("uses OpenRouter's dedicated transcription endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer router-key')
      expect(JSON.parse(String(options?.body))).toMatchObject({
        model: 'openai/whisper-1',
        input_audio: { format: 'wav' },
      })
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'router transcript' }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeAudio(wavBuffer(), {
        provider: 'openrouter',
        model: 'openai/whisper-1',
        apiKey: 'router-key',
      }),
    ).resolves.toMatchObject({
      text: 'router transcript',
      provider: 'openrouter',
      fallbackUsed: false,
    })
  })

  it("uses Gemini's audio interaction API", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
      expect((options?.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key')
      expect(JSON.parse(String(options?.body))).toMatchObject({
        model: 'gemini-3.5-flash',
        input: [{ type: 'text' }, { type: 'audio', mime_type: 'audio/wav' }],
      })
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: 'gemini transcript' }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeAudio(wavBuffer(), {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        apiKey: 'gemini-key',
      }),
    ).resolves.toMatchObject({
      text: 'gemini transcript',
      provider: 'gemini',
      fallbackUsed: false,
    })
  })

  it('falls back to local Granite when a configured cloud provider fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.openai.com/v1/audio/transcriptions') {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'cloud unavailable' } }),
        }
      }
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: NOTE_TRANSCRIPTION_MODEL }] }),
        }
      }
      if (url.endsWith('/v1/audio/transcriptions')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ text: 'local fallback transcript' }),
        }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeAudio(wavBuffer(), {
        provider: 'openai',
        model: 'gpt-4o-mini-transcribe',
        apiKey: 'cloud-key',
        localFallback: true,
      }),
    ).resolves.toEqual({
      text: 'local fallback transcript',
      provider: 'local',
      model: NOTE_TRANSCRIPTION_MODEL,
      fallbackUsed: true,
    })
  })

  it('does not start a local fallback after the user cancels cloud transcription', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      transcribeAudio(wavBuffer(), {
        provider: 'openai',
        model: 'gpt-4o-mini-transcribe',
        apiKey: 'cloud-key',
        localFallback: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects non-WAV input before contacting Ollama', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeNoteAudio(Buffer.from('not audio'))).rejects.toThrow('empty or invalid')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
