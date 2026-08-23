/**
 * Exercises the observable use screen capture contract, with regression cases for “starts
 * and stops a browser display stream” and “shows a browser-specific denial message”. The
 * suite documents caller-visible behavior so implementation refactors cannot silently
 * weaken those guarantees.
 */

import React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScreenCapture } from '@/hooks/useScreenCapture'

// Creates stream with the state and dependencies required by the renderer feature workflow.
function createStream() {
  const endedListeners: EventListener[] = []
  const videoTrack = {
    readyState: 'live',
    addEventListener: vi.fn((name: string, callback: EventListener) => {
      if (name === 'ended') endedListeners.push(callback)
    }),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  }
  return {
    stream: {
      getTracks: vi.fn(() => [videoTrack]),
      getVideoTracks: vi.fn(() => [videoTrack]),
    } as unknown as MediaStream,
    videoTrack,
    endedListeners,
  }
}

describe('useScreenCapture', () => {
  beforeEach(() => {
    delete window.orbitDesktop
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: vi.fn(),
        getUserMedia: vi.fn(),
      },
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      value: 1920,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      value: 1080,
    })
  })

  afterEach(() => {
    document.getElementById('__iris_screen_video__')?.remove()
    delete window.orbitDesktop
  })

  it('starts and stops a browser display stream', async () => {
    const { stream, videoTrack } = createStream()
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(stream)
    const { result } = renderHook(() => useScreenCapture())

    await act(async () => result.current.startStream())
    expect(result.current.isStreaming).toBe(true)
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce()

    act(() => result.current.stopStream())
    expect(videoTrack.stop).toHaveBeenCalledOnce()
    expect(result.current.isStreaming).toBe(false)
  })

  it('shows a browser-specific denial message', async () => {
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    )
    const { result } = renderHook(() => useScreenCapture())
    await act(async () => result.current.startStream())
    expect(result.current.error).toContain('Screen sharing was denied')
  })

  it('does not show an error when the picker is cancelled', async () => {
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    )
    const { result } = renderHook(() => useScreenCapture())
    await act(async () => result.current.startStream())
    expect(result.current.error).toBe('')
  })

  it('does not start a second Electron capture flow after the Wayland picker fails', async () => {
    window.orbitDesktop = {
      getScreenSources: vi.fn(),
    }
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValue(new Error('portal failed'))
    const { result } = renderHook(() => useScreenCapture())

    await act(async () => result.current.startStream())
    expect(window.orbitDesktop.getScreenSources).not.toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toContain('portal failed')
  })

  it('captures a frame from the hidden video element', async () => {
    const { stream } = createStream()
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(stream)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,FAKE')
    const { result } = renderHook(() => useScreenCapture())
    await act(async () => result.current.startStream())

    const video = document.getElementById('__iris_screen_video__') as HTMLVideoElement
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      value: 1920,
    })
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      value: 1080,
    })
    expect(result.current.captureFrame()).toBe('data:image/jpeg;base64,FAKE')
  })

  it('renders a toggle wired to the stream controls', async () => {
    const { stream } = createStream()
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(stream)
    const { result } = renderHook(() => useScreenCapture())
    const Toggle = result.current.ScreenToggle
    render(<Toggle />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /share screen/i })))
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce()
  })
})
