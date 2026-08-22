import { describe, expect, it } from 'vitest'

import {
  LOCAL_TRANSCRIPTION_MODEL,
  audioModelsForProvider,
  resolveAudioTranscriptionBinding,
} from '../src/platform-features/audio/transcriptionConfig'

describe('audio transcription configuration', () => {
  it('defaults to local Granite with local fallback enabled', () => {
    const binding = resolveAudioTranscriptionBinding({} as never)

    expect(binding.provider).toBe('local')
    expect(binding.model).toBe(LOCAL_TRANSCRIPTION_MODEL)
    expect(binding.cloud).toBe(false)
    expect(binding.localFallback).toBe(true)
  })

  it('binds cloud provider, model, credential slot and explicit fallback policy', () => {
    const binding = resolveAudioTranscriptionBinding({
      audio_provider: 'openai',
      audio_model: 'gpt-4o-transcribe',
      audio_key_id: '3',
      audio_local_fallback: false,
    } as never)

    expect(binding).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-transcribe',
      keyId: '3',
      cloud: true,
      localFallback: false,
    })
  })

  it('falls unknown providers back to the secure local definition', () => {
    const binding = resolveAudioTranscriptionBinding({
      audio_provider: 'unknown-provider',
      audio_model: '',
      audio_key_id: '1',
      audio_local_fallback: true,
    } as never)

    expect(binding.provider).toBe('local')
    expect(binding.model).toBe(LOCAL_TRANSCRIPTION_MODEL)
    expect(audioModelsForProvider('openrouter')).toContain('openai/whisper-1')
  })
})
