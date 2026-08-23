/**
 * Implements the types part of screen capture used by Vision. It keeps browser and Electron
 * capture behavior behind one feature boundary.
 */

import type { ComponentType, ReactNode, RefCallback } from 'react'

export interface CaptureFrameOptions {
  maxWidth?: number
  quality?: number
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface ScreenCaptureController {
  stream: MediaStream | null
  isStreaming: boolean
  error: string
  startStream: () => Promise<void>
  stopStream: () => void
  captureFrame: (options?: CaptureFrameOptions) => string | null
  attachVideoElement: RefCallback<HTMLVideoElement>
}

export interface LegacyScreenCaptureController extends ScreenCaptureController {
  /** @deprecated Render ScreenShareToggle directly instead. */
  ScreenToggle: ComponentType
}

export interface ScreenCaptureProviderProps {
  children: ReactNode
}
