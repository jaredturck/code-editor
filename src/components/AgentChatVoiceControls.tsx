import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useAgentSettings } from '../platform-context/AgentSettingsContext'
import {
  AUDIO_PROVIDER_DEFINITIONS,
  audioModelsForProvider,
  resolveAudioTranscriptionBinding,
} from '../platform-features/audio/transcriptionConfig'
import { useAudioTranscription } from '../platform-features/audio/useAudioTranscription'
import { hasKeyFor } from '../platform/keyStore'
import { getValidProviderKeyIds } from '../platform/providers/providerConfiguration'

interface AgentChatVoiceControlsProps {
  disabled: boolean
  setPrompt: Dispatch<SetStateAction<string>>
}

function format_seconds(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function VoicePopover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[10px] text-[var(--text)] shadow-2xl">
      {children}
    </div>
  )
}

function AgentChatVoiceControls({ disabled, setPrompt }: AgentChatVoiceControlsProps) {
  const { settings, updateSettings } = useAgentSettings()
  const [settings_open, set_settings_open] = useState(false)
  const binding = useMemo(() => resolveAudioTranscriptionBinding(settings), [settings])
  const voice = useAudioTranscription({
    activeTarget: disabled ? null : 'agent-chat-prompt',
    onTranscript: (_target, text) =>
      setPrompt((current) => `${current}${current ? ' ' : ''}${text}`),
  })
  const definition =
    AUDIO_PROVIDER_DEFINITIONS.find((entry) => entry.id === binding.provider) ||
    AUDIO_PROVIDER_DEFINITIONS[0]
  const models = audioModelsForProvider(binding.provider)
  const valid_key_ids = binding.cloud ? getValidProviderKeyIds(settings, binding.provider) : ['1']
  const key_ids = Array.from(new Set([binding.keyId, ...valid_key_ids].filter(Boolean)))
  const key_ready = !binding.cloud || hasKeyFor(binding.provider, binding.keyId)
  const busy = ['checking', 'transcribing', 'installing'].includes(voice.phase)

  const update_provider = (provider_id: string) => {
    const next_definition =
      AUDIO_PROVIDER_DEFINITIONS.find((entry) => entry.id === provider_id) ||
      AUDIO_PROVIDER_DEFINITIONS[0]
    const next_key_ids = next_definition.cloud
      ? getValidProviderKeyIds(settings, provider_id)
      : ['1']
    updateSettings({
      audio_provider: next_definition.id,
      audio_model: next_definition.models[0] || '',
      audio_key_id: next_key_ids[0] || '1',
      ...(next_definition.cloud ? { audio_cloud_notice_ack: false } : {}),
    })
  }

  let prompt: React.ReactNode = null
  if (voice.cloudPromptOpen) {
    prompt = (
      <VoicePopover>
        <div className="font-medium">Cloud transcription notice</div>
        <p className="mt-1 leading-relaxed text-[var(--muted)]">
          This recording will be uploaded to {voice.binding.label} for transcription. The IRIS
          bridge does not persist the audio recording.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]"
            onClick={voice.dismissCloudNotice}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded bg-sky-600 px-2 py-1 font-medium text-white hover:bg-sky-500"
            onClick={voice.acceptCloudNotice}
            type="button"
          >
            Continue
          </button>
        </div>
      </VoicePopover>
    )
  } else if (voice.permissionPromptOpen) {
    prompt = (
      <VoicePopover>
        <div className="font-medium">Microphone permission</div>
        <p className="mt-1 leading-relaxed text-[var(--muted)]">
          Allow the trusted desktop bridge to accept microphone audio for voice prompts? Your
          operating system may ask for microphone access separately.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]"
            onClick={voice.denyMicrophone}
            type="button"
          >
            Not now
          </button>
          <button
            className="rounded bg-amber-500 px-2 py-1 font-medium text-black hover:bg-amber-400"
            onClick={() => void voice.allowMicrophone()}
            type="button"
          >
            Allow microphone
          </button>
        </div>
      </VoicePopover>
    )
  } else if (voice.modelPromptOpen) {
    prompt = (
      <VoicePopover>
        <div className="font-medium">Install local speech model?</div>
        <p className="mt-1 leading-relaxed text-[var(--muted)]">
          Local transcription uses Granite Speech through Ollama. Install the configured model
          before recording?
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]"
            onClick={voice.dismissModelPrompt}
            type="button"
          >
            Not now
          </button>
          <button
            className="rounded bg-amber-500 px-2 py-1 font-medium text-black hover:bg-amber-400"
            onClick={() => void voice.installModel()}
            type="button"
          >
            Install model
          </button>
        </div>
      </VoicePopover>
    )
  } else if (voice.error) {
    prompt = (
      <VoicePopover>
        <div className="font-medium text-red-300">Voice transcription failed</div>
        <p className="mt-1 leading-relaxed text-[var(--muted)]">{voice.error}</p>
        <div className="mt-3 flex justify-end gap-2">
          {voice.permissionRecoveryAvailable ? (
            <button
              className="rounded border border-amber-500/30 px-2 py-1 text-amber-300 hover:bg-amber-500/10"
              onClick={voice.requestMicrophonePermission}
              type="button"
            >
              Review permission
            </button>
          ) : null}
          <button
            className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--hover)]"
            onClick={voice.cancel}
            type="button"
          >
            Close
          </button>
        </div>
      </VoicePopover>
    )
  } else if (settings_open) {
    prompt = (
      <VoicePopover>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">Voice transcription</div>
            <div className="mt-0.5 text-[9px] text-[var(--muted)]">
              Local audio stays on this machine. Cloud audio is uploaded only after the first-use
              notice above.
            </div>
          </div>
          <button
            aria-label="Close voice settings"
            className="text-[var(--muted)] hover:text-[var(--text)]"
            onClick={() => set_settings_open(false)}
            type="button"
          >
            ×
          </button>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[9px] uppercase tracking-wide text-[var(--muted)]">
            Provider
          </span>
          <select
            aria-label="Voice transcription provider"
            className="h-8 w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-[10px] outline-none focus:border-sky-500"
            onChange={(event) => update_provider(event.target.value)}
            value={binding.provider}
          >
            {AUDIO_PROVIDER_DEFINITIONS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-2 block">
          <span className="mb-1 block text-[9px] uppercase tracking-wide text-[var(--muted)]">
            Model
          </span>
          <select
            aria-label="Voice transcription model"
            className="h-8 w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 font-mono text-[10px] outline-none focus:border-sky-500"
            onChange={(event) => updateSettings({ audio_model: event.target.value })}
            value={binding.model}
          >
            {binding.model && !models.includes(binding.model) ? (
              <option value={binding.model}>{binding.model}</option>
            ) : null}
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        {binding.cloud ? (
          <>
            <label className="mt-2 block">
              <span className="mb-1 block text-[9px] uppercase tracking-wide text-[var(--muted)]">
                Credential
              </span>
              <select
                aria-label="Voice transcription credential"
                className="h-8 w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-[10px] outline-none focus:border-sky-500"
                onChange={(event) => updateSettings({ audio_key_id: event.target.value })}
                value={binding.keyId}
              >
                {key_ids.map((key_id) => (
                  <option key={key_id} value={key_id}>
                    Key {key_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 flex items-center justify-between gap-3 rounded border border-[var(--border)] px-2 py-2">
              <span>
                <span className="block text-[10px]">Local fallback</span>
                <span className="block text-[9px] text-[var(--muted)]">
                  Retry failed cloud transcription with Granite.
                </span>
              </span>
              <input
                checked={binding.localFallback}
                onChange={(event) => updateSettings({ audio_local_fallback: event.target.checked })}
                type="checkbox"
              />
            </label>
            {!key_ready ? (
              <div className="mt-2 text-[9px] text-amber-300">
                Key {binding.keyId} is not stored for {definition.label}. Add and validate it in
                Settings → AI → Providers, or keep local fallback enabled.
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-2 text-[9px] text-[var(--muted)]">
            Granite Speech runs through your local Ollama service. If the model is missing, the mic
            button will offer to install it explicitly.
          </div>
        )}
      </VoicePopover>
    )
  }

  return (
    <div className="relative flex items-center gap-1">
      {prompt}
      <button
        aria-label={voice.phase === 'recording' ? 'Stop recording' : 'Record voice prompt'}
        className={`rounded px-2 py-1 text-[10px] ${
          voice.phase === 'recording'
            ? 'bg-red-500/15 text-red-300'
            : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
        }`}
        disabled={disabled || busy}
        onClick={() => (voice.phase === 'recording' ? voice.stopRecording() : voice.requestStart())}
        title={voice.statusText || `${binding.label} · ${binding.model}`}
        type="button"
      >
        {voice.phase === 'recording'
          ? `Stop ${format_seconds(voice.elapsedSeconds)}`
          : voice.phase === 'transcribing'
            ? 'Transcribing…'
            : voice.phase === 'checking'
              ? 'Checking…'
              : voice.phase === 'installing'
                ? 'Installing…'
                : 'Mic'}
      </button>
      <button
        aria-label="Voice settings"
        className="rounded px-1.5 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
        disabled={disabled || voice.phase === 'recording'}
        onClick={() => set_settings_open((open) => !open)}
        title="Voice transcription settings"
        type="button"
      >
        Voice
      </button>
    </div>
  )
}

export default AgentChatVoiceControls
