/**
 * Implements the capture strategies part of screen capture used by Vision. It keeps browser
 * and Electron capture behavior behind one feature boundary.
 */

import { hasDesktopBridge } from '@/platform/desktopShellWindow'

export interface ScreenCaptureAttempt {
  stream: MediaStream | null
  lastError: unknown
  isElectron: boolean
  strategy: 'electron-display-media' | 'browser-display-media'
}

const DISPLAY_MEDIA_CONSTRAINTS = {
  video: {
    frameRate: { ideal: 10, max: 15 },
    cursor: 'always',
  },
  audio: false,
} as unknown as DisplayMediaStreamOptions

function invalidDisplayStream(message: string): Error {
  return Object.assign(new Error(message), { name: 'NotReadableError' })
}

function validateDisplayStream(stream: MediaStream): MediaStream {
  const track = stream.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') {
    stream.getTracks().forEach((candidate) => candidate.stop())
    throw invalidDisplayStream('The selected source did not return a live video track.')
  }
  return stream
}

// Acquires one display stream. Electron owns source selection so Wayland performs exactly one
// PipeWire portal transaction instead of falling through to a second getUserMedia request.
export async function acquireScreenStream(): Promise<ScreenCaptureAttempt> {
  const isElectron = hasDesktopBridge()
  const strategy = isElectron ? 'electron-display-media' : 'browser-display-media'
  console.info('[iris][screen-capture]', {
    stage: 'renderer-requested',
    strategy,
  })
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_CONSTRAINTS)
    console.info('[iris][screen-capture]', {
      stage: 'renderer-stream-returned',
      strategy,
      trackCount: stream.getTracks().length,
      videoTrackCount: stream.getVideoTracks().length,
    })
    return {
      stream: validateDisplayStream(stream),
      lastError: null,
      isElectron,
      strategy,
    }
  } catch (error) {
    console.warn('[iris][screen-capture]', {
      stage: 'renderer-capture-failed',
      strategy,
      errorName: error instanceof Error ? error.name : 'Error',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return { stream: null, lastError: error, isElectron, strategy }
  }
}

// Returns screen capture error message without requiring callers to know where or how it is stored.
export function getScreenCaptureErrorMessage(error: unknown, isElectron: boolean): string {
  const namedError = error instanceof Error ? error : null
  const name = namedError?.name ?? ''

  if (name === 'AbortError') return ''
  if (name === 'NotAllowedError') {
    return isElectron
      ? 'Electron could not open the desktop sharing portal, or the request was cancelled. Try Share Screen again; the desktop logs now show the exact permission and portal stage reached.'
      : 'Screen sharing was denied or cancelled. Allow it when the browser prompts you.'
  }
  if (name === 'NotFoundError') {
    return 'No shareable screen or window was returned by the desktop portal.'
  }
  if (name === 'NotReadableError') {
    return namedError?.message?.includes('live video track')
      ? namedError.message
      : 'The desktop session could not open the selected screen source. Close other capture tools and try again.'
  }

  return namedError?.message ? `Screen sharing failed: ${namedError.message}` : 'Could not start screen sharing.'
}
