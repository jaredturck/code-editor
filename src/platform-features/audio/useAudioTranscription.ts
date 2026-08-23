import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOrbSettings } from '@/platform-context/AgentSettingsContext'
import {
  getAudioTranscriptionStatus,
  installAudioTranscriptionModel,
  transcribeAudio,
  type BridgeNoteTranscriptionStatus,
} from '@/platform/desktopBridge'
import { convertRecordingToWav } from '@/platform/audio/wavEncoder'
import { buildBridgePermissionState } from '@/platform/settingsStorage'
import { getKey } from '@/platform/keyStore'
import { resolveAudioTranscriptionBinding } from './transcriptionConfig'

const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000
const MEDIA_RECORDER_TIMESLICE_MS = 250

export type AudioTranscriptionPhase = 'idle' | 'checking' | 'recording' | 'transcribing' | 'installing' | 'error'

interface UseAudioTranscriptionOptions<T> {
  activeTarget: T | null
  onTranscript: (target: T, text: string) => void
}

function chooseRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function stopMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() || []) track.stop()
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access was denied. Enable it in Permissions and your system settings.'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was detected.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'The recording could not be transcribed.'
}

function isMicrophonePermissionError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return true
  if (!(error instanceof Error)) return false
  return /microphone.*(?:permission|access)|(?:permission|access).*microphone/i.test(error.message)
}

export function useAudioTranscription<T>({ activeTarget, onTranscript }: UseAudioTranscriptionOptions<T>) {
  const { settings, updateSettings, grantPermissions } = useOrbSettings()
  const binding = useMemo(() => resolveAudioTranscriptionBinding(settings), [settings])
  const [phase, setPhase] = useState<AudioTranscriptionPhase>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState('')
  const [permissionPromptOpen, setPermissionPromptOpen] = useState(false)
  const [modelPromptOpen, setModelPromptOpen] = useState(false)
  const [cloudPromptOpen, setCloudPromptOpen] = useState(false)
  const [modelStatus, setModelStatus] = useState<BridgeNoteTranscriptionStatus | null>(null)
  const [statusText, setStatusText] = useState('')
  const [permissionRecoveryAvailable, setPermissionRecoveryAvailable] = useState(false)

  const mountedRef = useRef(true)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const pendingTargetRef = useRef<T | null>(null)
  const operationRef = useRef(0)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const requestAbortRef = useRef<AbortController | null>(null)

  const clearRecordingTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const releaseRecording = useCallback(() => {
    clearRecordingTimers()
    stopMediaStream(streamRef.current)
    streamRef.current = null
    recorderRef.current = null
  }, [clearRecordingTimers])

  const fail = useCallback(
    (value: unknown) => {
      releaseRecording()
      if (!mountedRef.current) return
      setError(errorMessage(value))
      setPermissionRecoveryAvailable(isMicrophonePermissionError(value))
      setStatusText('')
      setPhase('error')
    },
    [releaseRecording],
  )

  const synchronizeBridgeMicrophone = useCallback(async (permissionSettings: typeof settings) => {
    const updateBridgePermissions = window.orbitDesktop?.security?.updateBridgePermissions
    if (!updateBridgePermissions) return
    const result = await updateBridgePermissions(buildBridgePermissionState(permissionSettings))
    if (!result?.ok) {
      throw new Error(result?.error || 'IRIS could not enable microphone access.')
    }
  }, [])

  const finalizeRecording = useCallback(
    async (target: T, mimeType: string, operation: number) => {
      const chunks = chunksRef.current
      chunksRef.current = []
      releaseRecording()
      if (cancelledRef.current || operation !== operationRef.current) return

      try {
        const recording = new Blob(chunks, { type: mimeType || 'audio/webm' })
        if (!recording.size) throw new Error('No audio was recorded.')
        if (mountedRef.current) {
          setPhase('transcribing')
          setStatusText(
            binding.cloud ? `Transcribing with ${binding.label}…` : 'Transcribing locally with Granite Speech…',
          )
        }
        const wav = await convertRecordingToWav(recording)
        if (cancelledRef.current || operation !== operationRef.current) return

        const apiKey = binding.cloud ? getKey(binding.provider, binding.keyId) : ''
        if (binding.cloud && !apiKey && !binding.localFallback) {
          throw new Error(`No ${binding.label} API key is configured for Key ${binding.keyId}.`)
        }

        const controller = new AbortController()
        requestAbortRef.current = controller
        const result = await transcribeAudio(
          wav,
          {
            provider: binding.provider,
            model: binding.model,
            apiKey,
            localFallback: binding.localFallback,
          },
          controller.signal,
        )
        requestAbortRef.current = null
        if (cancelledRef.current || operation !== operationRef.current) return
        if (!result.text) throw new Error('The transcription provider returned an empty result.')

        onTranscript(target, result.text)
        if (mountedRef.current) {
          pendingTargetRef.current = null
          setElapsedSeconds(0)
          setError('')
          setStatusText(result.fallbackUsed ? 'Cloud transcription failed; local Granite completed it.' : '')
          setPhase('idle')
        }
      } catch (value) {
        requestAbortRef.current = null
        if (cancelledRef.current || operation !== operationRef.current) return
        fail(value)
      }
    },
    [binding, fail, onTranscript, releaseRecording],
  )

  const beginCapture = useCallback(
    async (target: T) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail(new Error('Microphone recording is not supported by this desktop runtime.'))
        return
      }
      if (typeof MediaRecorder === 'undefined') {
        fail(new Error('Audio recording is not supported by this desktop runtime.'))
        return
      }

      const operation = operationRef.current + 1
      operationRef.current = operation
      cancelledRef.current = false
      chunksRef.current = []
      setElapsedSeconds(0)
      setError('')
      setPermissionRecoveryAvailable(false)
      setStatusText('')

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        if (operation !== operationRef.current || cancelledRef.current) {
          stopMediaStream(stream)
          return
        }

        const mimeType = chooseRecorderMimeType()
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
        streamRef.current = stream
        recorderRef.current = recorder

        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size) chunksRef.current.push(event.data)
        })
        recorder.addEventListener('error', () => {
          cancelledRef.current = true
          operationRef.current += 1
          fail(new Error('The microphone recording stopped unexpectedly.'))
        })
        recorder.addEventListener('stop', () => {
          void finalizeRecording(target, recorder.mimeType || mimeType, operation)
        })

        recorder.start(MEDIA_RECORDER_TIMESLICE_MS)
        setPhase('recording')
        intervalRef.current = window.setInterval(() => {
          setElapsedSeconds((current) => current + 1)
        }, 1000)
        timeoutRef.current = window.setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop()
        }, MAX_RECORDING_DURATION_MS)
      } catch (value) {
        fail(value)
      }
    },
    [fail, finalizeRecording],
  )

  const prepareRecording = useCallback(
    async (target: T, bridgeSynchronized = false) => {
      const operation = operationRef.current + 1
      operationRef.current = operation
      pendingTargetRef.current = target
      setError('')
      setPermissionRecoveryAvailable(false)
      setModelPromptOpen(false)
      setPhase('checking')
      setStatusText(binding.cloud ? `Preparing ${binding.label} transcription…` : 'Checking Ollama…')

      try {
        if (!bridgeSynchronized) {
          await synchronizeBridgeMicrophone({
            ...settings,
            permissions_microphone: true,
          })
          if (!mountedRef.current || operation !== operationRef.current) return
        }

        if (!binding.cloud) {
          const status = await getAudioTranscriptionStatus()
          if (!mountedRef.current || operation !== operationRef.current) return
          setModelStatus(status)
          if (!status.ollamaAvailable) {
            throw new Error('Ollama is not running. Start Ollama and try again.')
          }
          if (!status.modelInstalled) {
            setPhase('idle')
            setStatusText('')
            setModelPromptOpen(true)
            return
          }
        }

        await beginCapture(target)
      } catch (value) {
        if (operation !== operationRef.current) return
        fail(value)
      }
    },
    [beginCapture, binding, fail, settings, synchronizeBridgeMicrophone],
  )

  const beginAfterNotices = useCallback(
    (target: T) => {
      if (settings.permissions_microphone !== true) {
        setPermissionPromptOpen(true)
        return
      }
      void prepareRecording(target)
    },
    [prepareRecording, settings.permissions_microphone],
  )

  const requestStart = useCallback(() => {
    if (activeTarget === null) return
    if (!['idle', 'error'].includes(phase)) return
    pendingTargetRef.current = activeTarget
    setError('')
    setModelPromptOpen(false)
    if (binding.cloud && settings.audio_cloud_notice_ack !== true) {
      setCloudPromptOpen(true)
      return
    }
    beginAfterNotices(activeTarget)
  }, [activeTarget, beginAfterNotices, binding.cloud, phase, settings.audio_cloud_notice_ack])

  const acceptCloudNotice = useCallback(() => {
    const target = pendingTargetRef.current
    if (target === null) return
    updateSettings({ audio_cloud_notice_ack: true })
    setCloudPromptOpen(false)
    beginAfterNotices(target)
  }, [beginAfterNotices, updateSettings])

  const dismissCloudNotice = useCallback(() => {
    pendingTargetRef.current = null
    setCloudPromptOpen(false)
    setPhase('idle')
  }, [])

  const allowMicrophone = useCallback(async () => {
    const target = pendingTargetRef.current
    if (target === null) return

    try {
      await grantPermissions('microphone')
      setPermissionPromptOpen(false)
      await prepareRecording(target, true)
    } catch (value) {
      setPermissionPromptOpen(false)
      fail(value)
    }
  }, [fail, grantPermissions, prepareRecording])

  const requestMicrophonePermission = useCallback(() => {
    if (activeTarget === null) return
    pendingTargetRef.current = activeTarget
    setError('')
    setPermissionRecoveryAvailable(false)
    setPermissionPromptOpen(true)
  }, [activeTarget])

  const denyMicrophone = useCallback(() => {
    pendingTargetRef.current = null
    setPermissionPromptOpen(false)
    setPhase('idle')
  }, [])

  const installModel = useCallback(async () => {
    const target = pendingTargetRef.current
    if (target === null) return
    setModelPromptOpen(false)
    setPhase('installing')
    setStatusText('Downloading Granite Speech through Ollama…')
    setError('')
    const operation = operationRef.current + 1
    operationRef.current = operation

    try {
      const status = await installAudioTranscriptionModel()
      if (!mountedRef.current || operation !== operationRef.current) return
      setModelStatus(status)
      await beginCapture(target)
    } catch (value) {
      if (operation !== operationRef.current) return
      fail(value)
    }
  }, [beginCapture, fail])

  const dismissModelPrompt = useCallback(() => {
    pendingTargetRef.current = null
    setModelPromptOpen(false)
    setPhase('idle')
  }, [])

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    operationRef.current += 1
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    releaseRecording()
    chunksRef.current = []
    pendingTargetRef.current = null
    setPermissionPromptOpen(false)
    setModelPromptOpen(false)
    setCloudPromptOpen(false)
    setElapsedSeconds(0)
    setError('')
    setPermissionRecoveryAvailable(false)
    setStatusText('')
    setPhase('idle')
  }, [releaseRecording])

  useEffect(() => {
    if (
      pendingTargetRef.current !== null &&
      activeTarget !== pendingTargetRef.current &&
      (phase !== 'idle' || permissionPromptOpen || modelPromptOpen || cloudPromptOpen)
    ) {
      cancel()
    }
  }, [activeTarget, cancel, cloudPromptOpen, modelPromptOpen, permissionPromptOpen, phase])

  useEffect(() => {
    if (
      settings.permissions_microphone !== true &&
      ['checking', 'recording', 'transcribing', 'installing'].includes(phase)
    ) {
      cancel()
    }
  }, [cancel, phase, settings.permissions_microphone])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      operationRef.current += 1
      requestAbortRef.current?.abort()
      const recorder = recorderRef.current
      if (recorder?.state === 'recording') recorder.stop()
      releaseRecording()
    }
  }, [releaseRecording])

  return {
    phase,
    elapsedSeconds,
    error,
    statusText,
    permissionRecoveryAvailable,
    permissionPromptOpen,
    modelPromptOpen,
    cloudPromptOpen,
    modelStatus,
    binding,
    requestStart,
    allowMicrophone,
    requestMicrophonePermission,
    denyMicrophone,
    acceptCloudNotice,
    dismissCloudNotice,
    installModel,
    dismissModelPrompt,
    stopRecording,
    cancel,
  }
}
