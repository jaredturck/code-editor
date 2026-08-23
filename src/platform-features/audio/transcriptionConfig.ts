import type { OrbSettings } from '@/platform/settingsStorage'

export const LOCAL_TRANSCRIPTION_PROVIDER = 'local'
export const LOCAL_TRANSCRIPTION_MODEL = 'gabegoodhart/granite4.1-speech:2b'

export interface AudioProviderDefinition {
  id: string
  label: string
  models: readonly string[]
  cloud: boolean
}

export const AUDIO_PROVIDER_DEFINITIONS: readonly AudioProviderDefinition[] = [
  {
    id: LOCAL_TRANSCRIPTION_PROVIDER,
    label: 'Local Granite Speech (Ollama)',
    models: [LOCAL_TRANSCRIPTION_MODEL],
    cloud: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    cloud: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    models: ['openai/whisper-1', 'openai/whisper-large-v3'],
    cloud: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: ['gemini-3.5-flash'],
    cloud: true,
  },
] as const

export interface AudioTranscriptionBinding {
  provider: string
  model: string
  keyId: string
  localFallback: boolean
  cloud: boolean
  label: string
}

export function resolveAudioTranscriptionBinding(
  settings: Pick<OrbSettings, 'audio_provider' | 'audio_model' | 'audio_key_id' | 'audio_local_fallback'>,
): AudioTranscriptionBinding {
  const provider = String(settings.audio_provider || LOCAL_TRANSCRIPTION_PROVIDER).toLowerCase()
  const definition = AUDIO_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider) || AUDIO_PROVIDER_DEFINITIONS[0]
  const configuredModel = String(settings.audio_model || '').trim()
  const model = configuredModel || definition.models[0] || LOCAL_TRANSCRIPTION_MODEL

  return {
    provider: definition.id,
    model,
    keyId: String(settings.audio_key_id || '1'),
    localFallback: settings.audio_local_fallback !== false,
    cloud: definition.cloud,
    label: definition.label,
  }
}

export function audioModelsForProvider(provider: unknown): readonly string[] {
  return AUDIO_PROVIDER_DEFINITIONS.find((entry) => entry.id === String(provider || '').toLowerCase())?.models || []
}
