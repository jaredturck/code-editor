/** Pure permission decisions shared by Electron's display-capture request and check handlers. */

export interface ScreenCapturePermissionCheckInput {
  trusted: boolean
  permission: string
  mediaType?: string
  microphoneAllowed: boolean
}

export interface ScreenCapturePermissionRequestInput {
  trusted: boolean
  permission: string
  mediaTypes?: readonly string[]
  microphoneAllowed: boolean
}

export function decideScreenCapturePermissionCheck({
  trusted,
  permission,
  mediaType = '',
  microphoneAllowed,
}: ScreenCapturePermissionCheckInput): boolean {
  if (!trusted) return false
  if (permission === 'display-capture' || permission === 'mediaKeySystem') return true
  if (permission !== 'media') return false

  const normalized = String(mediaType || '').toLowerCase()
  if (normalized === 'audio') return microphoneAllowed
  return normalized === '' || normalized === 'unknown' || normalized === 'video'
}

export function decideScreenCapturePermissionRequest({
  trusted,
  permission,
  mediaTypes = [],
  microphoneAllowed,
}: ScreenCapturePermissionRequestInput): boolean {
  if (!trusted) return false
  if (permission === 'display-capture' || permission === 'mediaKeySystem') return true
  if (permission !== 'media') return false

  const normalized = mediaTypes.map((mediaType) => String(mediaType || '').toLowerCase())
  if (!normalized.length) return true

  const containsAudio = normalized.includes('audio')
  const containsVideo = normalized.includes('video')
  if (containsVideo && !containsAudio) return true
  if (containsAudio && !containsVideo) return microphoneAllowed
  if (containsAudio && containsVideo) return microphoneAllowed
  return false
}
