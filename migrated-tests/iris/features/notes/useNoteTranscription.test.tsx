/**
 * Covers the Notes microphone permission, model-readiness, recording, and transcript delivery
 * lifecycle while keeping browser audio and Ollama fully mocked.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  settings: { permissions_microphone: false } as Record<string, unknown>,
  updateSettings: vi.fn(),
  grantPermissions: vi.fn(),
  getStatus: vi.fn(),
  installModel: vi.fn(),
  transcribe: vi.fn(),
  convertRecording: vi.fn(),
  updateBridgePermissions: vi.fn(),
  trackStop: vi.fn(),
}))

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
    grantPermissions: mocks.grantPermissions,
  }),
}))

vi.mock('@/platform/desktopBridge', () => ({
  getAudioTranscriptionStatus: mocks.getStatus,
  installAudioTranscriptionModel: mocks.installModel,
  transcribeAudio: mocks.transcribe,
}))

vi.mock('@/platform/audio/wavEncoder', () => ({
  convertRecordingToWav: mocks.convertRecording,
}))

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(): boolean {
    return true
  }

  state: RecordingState = 'inactive'
  mimeType: string

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType || 'audio/webm'
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    if (this.state !== 'recording') return
    this.state = 'inactive'
    const dataEvent = new Event('dataavailable') as Event & { data: Blob }
    Object.defineProperty(dataEvent, 'data', {
      value: new Blob(['recorded audio'], { type: this.mimeType }),
    })
    this.dispatchEvent(dataEvent)
    this.dispatchEvent(new Event('stop'))
  }
}

const transcriptionStatus = {
  ollamaAvailable: true,
  modelInstalled: true,
  model: 'gabegoodhart/granite4.1-speech:2b',
  modelDownloadBytes: 2_300_000_000,
}

beforeEach(() => {
  mocks.settings = { permissions_microphone: false }
  mocks.updateSettings.mockReset().mockImplementation((patch) => {
    mocks.settings = { ...mocks.settings, ...patch }
  })
  mocks.grantPermissions.mockReset().mockImplementation(async () => {
    mocks.settings = { ...mocks.settings, permissions_microphone: true }
    await mocks.updateBridgePermissions({ microphone: true })
    return mocks.settings
  })
  mocks.getStatus.mockReset().mockResolvedValue(transcriptionStatus)
  mocks.installModel.mockReset().mockResolvedValue(transcriptionStatus)
  mocks.transcribe.mockReset().mockResolvedValue({
    text: 'dictated note',
    provider: 'local',
    model: transcriptionStatus.model,
    fallbackUsed: false,
  })
  mocks.convertRecording.mockReset().mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }))
  mocks.updateBridgePermissions.mockReset().mockResolvedValue({ ok: true })
  mocks.trackStop.mockReset()

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: mocks.trackStop }],
      }),
    },
  })
  window.orbitDesktop = {
    ...(window.orbitDesktop || {}),
    security: {
      getBridgePermissions: vi.fn().mockResolvedValue({
        ok: true,
        permissions: { microphone: false },
      }),
      updateBridgePermissions: mocks.updateBridgePermissions,
    },
  }
})

describe('useNoteTranscription', () => {
  it('persists microphone consent before starting a recording', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useImportedNoteTranscription({ activeNoteId: 7, onTranscript }))

    act(() => result.current.requestStart())
    expect(result.current.permissionPromptOpen).toBe(true)

    await act(async () => {
      await result.current.allowMicrophone()
    })

    await waitFor(() => expect(result.current.phase).toBe('recording'))
    expect(mocks.updateBridgePermissions).toHaveBeenCalledWith(expect.objectContaining({ microphone: true }))
    expect(mocks.grantPermissions).toHaveBeenCalledWith('microphone')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.any(Object) }),
    )
  })

  it('stops, transcribes, and returns text to the active note', async () => {
    mocks.settings = { permissions_microphone: true }
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useImportedNoteTranscription({ activeNoteId: 11, onTranscript }))

    act(() => result.current.requestStart())
    await waitFor(() => expect(result.current.phase).toBe('recording'))

    act(() => result.current.stopRecording())

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(11, 'dictated note'))
    expect(mocks.convertRecording).toHaveBeenCalledTimes(1)
    expect(mocks.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ provider: 'local' }),
      expect.any(AbortSignal),
    )
    expect(mocks.trackStop).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('idle')
  })

  it('offers the fixed model download when Ollama is missing it', async () => {
    mocks.settings = { permissions_microphone: true }
    mocks.getStatus.mockResolvedValue({
      ...transcriptionStatus,
      modelInstalled: false,
    })
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useImportedNoteTranscription({ activeNoteId: 3, onTranscript }))

    act(() => result.current.requestStart())
    await waitFor(() => expect(result.current.modelPromptOpen).toBe(true))

    await act(async () => {
      await result.current.installModel()
    })

    await waitFor(() => expect(result.current.phase).toBe('recording'))
    expect(mocks.installModel).toHaveBeenCalledTimes(1)
  })

  it('offers an in-app permission recovery action after microphone denial', async () => {
    mocks.settings = { permissions_microphone: true }
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useImportedNoteTranscription({ activeNoteId: 9, onTranscript }))

    act(() => result.current.requestStart())
    await waitFor(() => expect(result.current.phase).toBe('error'))
    expect(result.current.permissionRecoveryAvailable).toBe(true)

    act(() => result.current.requestMicrophonePermission())
    expect(result.current.permissionPromptOpen).toBe(true)
  })
})

import { useNoteTranscription as useImportedNoteTranscription } from '@/platform-features/notes/useNoteTranscription'
