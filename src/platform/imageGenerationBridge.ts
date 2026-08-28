import { bridgeUrl, type BridgeRecord } from '@/platform/desktopBridgeBase'

export type ImageGenerationFormat = 'square' | 'landscape' | 'portrait'

export interface ImageGenerationStatus extends BridgeRecord {
  configured: boolean
  installed: boolean
  engineAvailable: boolean
  ready: boolean
  running: boolean
  installing: boolean
  installCompletedBytes: number
  installTotalBytes: number
  installPercent: number
  modelDir: string
  enginePath: string
  gpuIndex: number
  missingFiles: string[]
  error: string
}

function bridgeToken() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('bridgeToken') || ''
}

async function imageRequest<T = BridgeRecord>(path: string, method = 'GET', body?: BridgeRecord): Promise<T> {
  const token = bridgeToken()
  const response = await fetch(bridgeUrl(path), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-iris-bridge-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(String(data?.error || `Image generation request failed (${response.status}).`))
  return data as T
}

export function getImageGenerationStatus() {
  return imageRequest<ImageGenerationStatus>('/image/status')
}

export function installImageGenerationModels() {
  return imageRequest<ImageGenerationStatus>('/image/install', 'POST')
}

export function generateProjectImage(
  prompt: string,
  path: string,
  format: ImageGenerationFormat,
  workspaceRoot: string,
) {
  return imageRequest('/image/generate', 'POST', { prompt, path, format, workspaceRoot })
}

export function unloadImageGeneration() {
  return imageRequest('/image/unload', 'POST')
}
