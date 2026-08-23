import { bridgeUrl } from './desktopBridgeBase'

export interface BridgeDocumentInspection {
  path: string
  name: string
  kind: 'document' | 'pdf' | 'archive'
  text: string
  sourceType: string
  extractionMethod: string
  pagesRead?: number
  archiveEntry?: string
}

export async function inspectDocumentFile(path: string): Promise<BridgeDocumentInspection> {
  const token =
    typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('bridgeToken') || ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['x-iris-bridge-token'] = token

  const response = await fetch(bridgeUrl('/fs/document/inspect'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    throw new Error(String(data.error || `Document inspection failed (${response.status})`))
  }

  return data as unknown as BridgeDocumentInspection
}
