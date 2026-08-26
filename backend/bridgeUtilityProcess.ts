import { startLocalBridgeServer } from './bridgeServer.js'
import type {
  DuckDuckGoBrowserProgressEvent,
  DuckDuckGoBrowserSearchRequest,
  DuckDuckGoBrowserSearchResponse,
  DuckDuckGoSearchMode,
} from './desktopBridge/services/duckDuckGoBrowserProvider.js'
import type {
  ScreenCaptureProviderRequest,
  ScreenCaptureProviderResult,
} from './desktopBridge/services/screenCaptureProvider.js'
import type { BridgePermissionState } from './desktopBridge/shared/bridgeAuthorization.js'

interface ParentPortLike {
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
}

interface UtilityProcessLike extends NodeJS.Process {
  parentPort?: ParentPortLike | null
}

interface BridgeHandle {
  port: number
  host: string
  token: string
  getPermissions?: () => BridgePermissionState
  updatePermissions?: (permissions: Partial<BridgePermissionState>) => BridgePermissionState
  close?: () => void | Promise<void>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (event: DuckDuckGoBrowserProgressEvent) => void
  cleanup?: () => void
}

interface StartMessage {
  type: 'start'
  baseDir: string
  host: string
  port: number
  token: string
  allowedOrigins: string[]
  databasePath: string
  masterKey: Uint8Array
  duckDuckGoSearchMode: DuckDuckGoSearchMode
}

const SCREEN_CAPTURE_PROVIDER_KEY = '__irisScreenCaptureProvider'
const parent_port = (process as UtilityProcessLike).parentPort
const pending_requests = new Map<string, PendingRequest>()
let bridge_handle: BridgeHandle | null = null
let request_sequence = 0
let closing = false

if (!parent_port) throw new Error('The local bridge utility process requires an Electron parentPort.')

function error_message(value: unknown) {
  return value instanceof Error ? value.message : String(value || 'Unknown utility-process error')
}

function next_request_id(prefix: string) {
  request_sequence += 1
  return `${prefix}-${process.pid}-${request_sequence}`
}

function reject_pending_requests(message: string) {
  for (const pending of pending_requests.values()) {
    pending.cleanup?.()
    pending.reject(new Error(message))
  }
  pending_requests.clear()
}

function handle_rpc_response(message: Record<string, unknown>) {
  const id = String(message.id || '')
  const pending = pending_requests.get(id)
  if (!pending) return

  if (message.type === 'ddg-progress') {
    pending.onProgress?.(message.event as DuckDuckGoBrowserProgressEvent)
    return
  }

  pending_requests.delete(id)
  pending.cleanup?.()
  if (message.error) {
    pending.reject(new Error(String(message.error)))
    return
  }
  pending.resolve(message.result)
}

function request_screen_capture(request: ScreenCaptureProviderRequest = {}): Promise<ScreenCaptureProviderResult> {
  const id = next_request_id('screen')
  return new Promise<ScreenCaptureProviderResult>((resolve, reject) => {
    pending_requests.set(id, {
      resolve: (value) => resolve(value as ScreenCaptureProviderResult),
      reject,
    })
    parent_port.postMessage({ type: 'screen-request', id, request })
  })
}

function request_browser_search(request: DuckDuckGoBrowserSearchRequest): Promise<DuckDuckGoBrowserSearchResponse> {
  const id = next_request_id('ddg')
  return new Promise<DuckDuckGoBrowserSearchResponse>((resolve, reject) => {
    const handle_abort = () => parent_port.postMessage({ type: 'ddg-cancel', id })
    request.signal?.addEventListener('abort', handle_abort, { once: true })
    pending_requests.set(id, {
      resolve: (value) => resolve(value as DuckDuckGoBrowserSearchResponse),
      reject,
      onProgress: request.onProgress,
      cleanup: () => request.signal?.removeEventListener('abort', handle_abort),
    })
    parent_port.postMessage({
      type: 'ddg-request',
      id,
      request: {
        query: request.query,
        maxResults: request.maxResults,
        safeSearch: request.safeSearch,
        timeRange: request.timeRange,
        locale: request.locale,
        region: request.region,
      },
    })
  })
}

async function start_bridge(message: StartMessage) {
  if (bridge_handle || closing) return

  const received_key = message.masterKey instanceof Uint8Array ? message.masterKey : new Uint8Array(message.masterKey)
  const master_key = Buffer.from(received_key)
  ;(globalThis as Record<string, unknown>)[SCREEN_CAPTURE_PROVIDER_KEY] = request_screen_capture

  try {
    bridge_handle = await startLocalBridgeServer({
      baseDir: message.baseDir,
      host: message.host,
      port: message.port,
      token: message.token,
      allowedOrigins: message.allowedOrigins,
      databasePath: message.databasePath,
      masterKey: master_key,
      duckDuckGoBrowserSearch: message.duckDuckGoSearchMode === 'legacy' ? undefined : request_browser_search,
      duckDuckGoSearchMode: message.duckDuckGoSearchMode,
    })
    parent_port.postMessage({
      type: 'ready',
      port: bridge_handle.port,
      host: bridge_handle.host,
      token: bridge_handle.token,
      permissions: bridge_handle.getPermissions?.(),
    })
  } catch (error) {
    delete (globalThis as Record<string, unknown>)[SCREEN_CAPTURE_PROVIDER_KEY]
    parent_port.postMessage({ type: 'failed', error: error_message(error) })
    process.exitCode = 1
  } finally {
    master_key.fill(0)
    received_key.fill(0)
  }
}

function update_permissions(message: Record<string, unknown>) {
  if (!bridge_handle?.updatePermissions) return
  const permissions = bridge_handle.updatePermissions((message.permissions || {}) as Partial<BridgePermissionState>)
  parent_port.postMessage({ type: 'permissions-state', permissions })
}

async function close_bridge() {
  if (closing) return
  closing = true
  reject_pending_requests('Local bridge utility process is shutting down.')
  delete (globalThis as Record<string, unknown>)[SCREEN_CAPTURE_PROVIDER_KEY]
  const current = bridge_handle
  bridge_handle = null
  if (current?.close) await current.close()
  parent_port.postMessage({ type: 'closed' })
  process.exitCode = 0
}

async function handle_parent_message(value: unknown) {
  const message = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const type = String(message.type || '')

  if (type === 'start') {
    await start_bridge(message as unknown as StartMessage)
    return
  }
  if (type === 'permissions') {
    update_permissions(message)
    return
  }
  if (type === 'close') {
    await close_bridge()
    return
  }
  if (type === 'screen-result' || type === 'ddg-result' || type === 'ddg-progress') {
    handle_rpc_response(message)
  }
}

parent_port.on('message', (event) => {
  void handle_parent_message(event.data).catch((error) => {
    parent_port.postMessage({ type: 'failed', error: error_message(error) })
    process.exitCode = 1
  })
})

process.on('uncaughtException', (error) => {
  parent_port.postMessage({ type: 'fatal', error: error_message(error) })
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  parent_port.postMessage({ type: 'fatal', error: error_message(error) })
  process.exit(1)
})
