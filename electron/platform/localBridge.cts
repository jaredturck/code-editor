/**
 * Starts the Electron-owned local capability server before either development or packaged
 * renderers load. Heavy bridge work runs in a dedicated Electron utility process so semantic
 * indexing, native inference, SQLite, and other backend work cannot block the desktop event loop.
 */

import path = require('node:path')
import { randomUUID } from 'node:crypto'
import { utilityProcess, type App } from 'electron'
import '../navigationBootstrap.cjs'
import type { StorageKeyContext } from './storageKeyStore.cjs'
import {
  createDuckDuckGoSearchWindow,
  resolveDuckDuckGoSearchMode,
  type DuckDuckGoBrowserProgressEvent,
  type DuckDuckGoBrowserSearchRequest,
  type DuckDuckGoBrowserSearchResponse,
  type DuckDuckGoSearchMode,
  type DuckDuckGoSearchWindowService,
} from './duckDuckGoSearchWindow.cjs'

export interface BridgePermissionState {
  fileRead: boolean
  fileWrite: boolean
  terminal: boolean
  launcher: boolean
  automation: boolean
  screenCapture: boolean
  microphone: boolean
}

export interface LocalBridgeHandle {
  port: number
  host: string
  token: string
  getPermissions?: () => BridgePermissionState
  updatePermissions?: (permissions: Partial<BridgePermissionState>) => BridgePermissionState
  close?: () => void | Promise<void>
}

interface BridgeReadyMessage {
  type: 'ready'
  port: number
  host: string
  token: string
  permissions?: Partial<BridgePermissionState>
}

const BRIDGE_START_TIMEOUT_MS = 30_000
const BRIDGE_CLOSE_TIMEOUT_MS = 4_000
const DEFAULT_PERMISSIONS: BridgePermissionState = Object.freeze({
  fileRead: false,
  fileWrite: false,
  terminal: false,
  launcher: false,
  automation: false,
  screenCapture: false,
  microphone: false,
})

let bridgeHandle: LocalBridgeHandle | null = null
let bridge_process: ReturnType<typeof utilityProcess.fork> | null = null
let bridge_permissions: BridgePermissionState = { ...DEFAULT_PERMISSIONS }
let bridge_start_resolve: ((handle: LocalBridgeHandle) => void) | null = null
let bridge_start_reject: ((error: Error) => void) | null = null
let bridge_start_timer: ReturnType<typeof setTimeout> | null = null
let bridge_close_resolve: (() => void) | null = null
let bridge_close_timer: ReturnType<typeof setTimeout> | null = null
let bridge_closing = false
let duckDuckGoSearchWindow: DuckDuckGoSearchWindowService | null = null
const duckDuckGoAbortControllers = new Map<string, AbortController>()

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value || 'Unknown local bridge error')
}

function normalizePermissions(
  value: Partial<BridgePermissionState> | null | undefined,
  fallback: BridgePermissionState = bridge_permissions,
): BridgePermissionState {
  return {
    fileRead: value?.fileRead === undefined ? fallback.fileRead : value.fileRead === true,
    fileWrite: value?.fileWrite === undefined ? fallback.fileWrite : value.fileWrite === true,
    terminal: value?.terminal === undefined ? fallback.terminal : value.terminal === true,
    launcher: value?.launcher === undefined ? fallback.launcher : value.launcher === true,
    automation: value?.automation === undefined ? fallback.automation : value.automation === true,
    screenCapture: value?.screenCapture === undefined ? fallback.screenCapture : value.screenCapture === true,
    microphone: value?.microphone === undefined ? fallback.microphone : value.microphone === true,
  }
}

function postBridgeMessage(message: unknown): void {
  if (!bridge_process) return
  bridge_process.postMessage(message)
}

function browserSearchRequest(value: unknown): DuckDuckGoBrowserSearchRequest {
  const request = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    query: String(request.query || ''),
    maxResults: Number(request.maxResults) || 8,
    safeSearch: String(request.safeSearch || 'moderate'),
    timeRange: String(request.timeRange || 'all'),
    locale: String(request.locale || 'en-us'),
    region: String(request.region || 'wt-wt'),
  }
}

async function handleDuckDuckGoRequest(message: Record<string, unknown>): Promise<void> {
  const id = String(message.id || '')
  const search = duckDuckGoSearchWindow
  if (!id) return
  if (!search) {
    postBridgeMessage({ type: 'ddg-result', id, error: 'DuckDuckGo browser search is unavailable.' })
    return
  }

  const controller = new AbortController()
  duckDuckGoAbortControllers.set(id, controller)
  const request = browserSearchRequest(message.request)
  try {
    const result: DuckDuckGoBrowserSearchResponse = await search.search({
      ...request,
      signal: controller.signal,
      onProgress: (event: DuckDuckGoBrowserProgressEvent) => {
        postBridgeMessage({ type: 'ddg-progress', id, event })
      },
    })
    postBridgeMessage({ type: 'ddg-result', id, result })
  } catch (error) {
    postBridgeMessage({ type: 'ddg-result', id, error: errorMessage(error) })
  } finally {
    duckDuckGoAbortControllers.delete(id)
  }
}

function cancelDuckDuckGoRequest(message: Record<string, unknown>): void {
  const id = String(message.id || '')
  duckDuckGoAbortControllers.get(id)?.abort()
}

function clearBridgeStartTimer(): void {
  if (bridge_start_timer) clearTimeout(bridge_start_timer)
  bridge_start_timer = null
}

function settleBridgeStart(handle: LocalBridgeHandle): void {
  clearBridgeStartTimer()
  const resolve = bridge_start_resolve
  bridge_start_resolve = null
  bridge_start_reject = null
  resolve?.(handle)
}

function rejectBridgeStart(error: Error): void {
  clearBridgeStartTimer()
  const reject = bridge_start_reject
  bridge_start_resolve = null
  bridge_start_reject = null
  reject?.(error)
}

function settleBridgeClose(): void {
  if (bridge_close_timer) clearTimeout(bridge_close_timer)
  bridge_close_timer = null
  const resolve = bridge_close_resolve
  bridge_close_resolve = null
  resolve?.()
}

function createBridgeHandle(message: BridgeReadyMessage): LocalBridgeHandle {
  bridge_permissions = normalizePermissions(message.permissions, { ...DEFAULT_PERMISSIONS })
  return {
    port: Number(message.port),
    host: String(message.host || '127.0.0.1'),
    token: String(message.token || ''),
    getPermissions: () => ({ ...bridge_permissions }),
    updatePermissions: (permissions) => {
      bridge_permissions = normalizePermissions(permissions)
      postBridgeMessage({ type: 'permissions', permissions })
      return { ...bridge_permissions }
    },
    close: closeLocalBridge,
  }
}

function handleBridgeMessage(value: unknown): void {
  const message = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const type = String(message.type || '')

  if (type === 'ready') {
    bridgeHandle = createBridgeHandle(message as unknown as BridgeReadyMessage)
    settleBridgeStart(bridgeHandle)
    return
  }
  if (type === 'failed') {
    const error = new Error(String(message.error || 'Local bridge utility process failed to start.'))
    rejectBridgeStart(error)
    console.error('[iris] local bridge utility process failure:', error.message)
    return
  }
  if (type === 'fatal') {
    console.error('[iris] local bridge utility process fatal error:', String(message.error || 'unknown error'))
    return
  }
  if (type === 'permissions-state') {
    bridge_permissions = normalizePermissions(message.permissions as Partial<BridgePermissionState>)
    return
  }
  if (type === 'ddg-request') {
    void handleDuckDuckGoRequest(message)
    return
  }
  if (type === 'ddg-cancel') {
    cancelDuckDuckGoRequest(message)
    return
  }
  if (type === 'closed') settleBridgeClose()
}

function handleBridgeExit(code: number): void {
  const unexpected = !bridge_closing
  bridge_process = null
  bridgeHandle = null
  for (const controller of duckDuckGoAbortControllers.values()) controller.abort()
  duckDuckGoAbortControllers.clear()
  rejectBridgeStart(new Error(`Local bridge utility process exited before startup completed (code ${code}).`))
  settleBridgeClose()
  if (unexpected) {
    console.error(
      `[iris] local bridge utility process exited unexpectedly with code ${code}; the desktop window remains isolated.`,
    )
  }
}

function startBridgeProcess(
  app: Pick<App, 'getPath' | 'isPackaged'>,
  storage: StorageKeyContext,
  duckDuckGoSearchMode: DuckDuckGoSearchMode,
): Promise<LocalBridgeHandle> {
  return new Promise<LocalBridgeHandle>((resolve, reject) => {
    bridge_start_resolve = resolve
    bridge_start_reject = reject
    bridge_start_timer = setTimeout(() => {
      rejectBridgeStart(new Error('Local bridge utility process did not become ready before the startup timeout.'))
      bridge_process?.kill()
    }, BRIDGE_START_TIMEOUT_MS)

    const utilityPath = path.join(__dirname, '..', '..', 'backend-dist', 'bridgeUtilityProcess.js')
    const child = utilityProcess.fork(utilityPath, [], {
      stdio: 'inherit',
      serviceName: 'Code Editor Local Bridge',
    })
    bridge_process = child
    child.on('message', handleBridgeMessage)
    child.on('exit', handleBridgeExit)

    const devOrigin = process.env.CODE_EDITOR_DEV_SERVER_URL
      ? new URL(process.env.CODE_EDITOR_DEV_SERVER_URL).origin
      : 'http://localhost:5173'
    const masterKey = new Uint8Array(storage.masterKey)
    child.postMessage({
      type: 'start',
      baseDir: app.getPath('home'),
      host: '127.0.0.1',
      port: 0,
      token: randomUUID(),
      allowedOrigins: app.isPackaged ? ['null'] : [devOrigin],
      databasePath: storage.databasePath,
      masterKey,
      duckDuckGoSearchMode,
    })
    masterKey.fill(0)
  })
}

/**
 * Starts the bridge once and reuses the retained handle for every renderer window. Bridge
 * startup occurs only after the encrypted database path and in-memory master key are ready.
 */
async function ensureLocalBridge(
  app: Pick<App, 'getPath' | 'isPackaged'>,
  storage: StorageKeyContext,
): Promise<LocalBridgeHandle> {
  if (bridgeHandle) return bridgeHandle

  try {
    const duckDuckGoSearchMode = resolveDuckDuckGoSearchMode(process.env.IRIS_DDG_SEARCH_MODE)
    if (duckDuckGoSearchMode !== 'legacy' && !duckDuckGoSearchWindow) {
      duckDuckGoSearchWindow = createDuckDuckGoSearchWindow()
    }
    bridge_closing = false
    return await startBridgeProcess(app, storage, duckDuckGoSearchMode)
  } catch (error: unknown) {
    duckDuckGoSearchWindow?.close()
    duckDuckGoSearchWindow = null
    bridge_process?.kill()
    bridge_process = null
    console.warn('[iris] failed to start local bridge utility process')
    throw error
  }
}

function getLocalBridgeHandle(): LocalBridgeHandle | null {
  return bridgeHandle
}

function getLocalBridgePermissions(): BridgePermissionState | null {
  return bridgeHandle ? { ...bridge_permissions } : null
}

// Updates local bridge permissions while preserving the invariants owned by the Electron desktop
// shell.
function updateLocalBridgePermissions(
  permissions: Partial<BridgePermissionState>,
): { ok: false; error: string } | { ok: true; permissions: BridgePermissionState } {
  if (!bridgeHandle?.updatePermissions || !bridge_process) {
    return { ok: false, error: 'local-bridge-not-ready' }
  }
  return { ok: true, permissions: bridgeHandle.updatePermissions(permissions) }
}

// Stops the isolated bridge process and clears retained browser resources during application shutdown.
async function closeLocalBridge(): Promise<void> {
  const child = bridge_process
  bridgeHandle = null
  bridge_closing = true
  duckDuckGoSearchWindow?.close()
  duckDuckGoSearchWindow = null
  for (const controller of duckDuckGoAbortControllers.values()) controller.abort()
  duckDuckGoAbortControllers.clear()
  if (!child) {
    bridge_closing = false
    return
  }

  await new Promise<void>((resolve) => {
    bridge_close_resolve = resolve
    bridge_close_timer = setTimeout(() => {
      child.kill()
      settleBridgeClose()
    }, BRIDGE_CLOSE_TIMEOUT_MS)
    child.postMessage({ type: 'close' })
  })
  if (bridge_process === child) {
    child.kill()
    bridge_process = null
  }
  bridge_closing = false
}

export {
  closeLocalBridge,
  ensureLocalBridge,
  getLocalBridgeHandle,
  getLocalBridgePermissions,
  updateLocalBridgePermissions,
}
