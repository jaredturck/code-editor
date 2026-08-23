/**
 * Starts the Electron-owned local capability server before either development or packaged
 * renderers load. It keeps bridge startup, per-launch connection details, encrypted storage,
 * and shutdown ownership inside the desktop process.
 */

import path = require('node:path')
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { desktopCapturer, type App } from 'electron'
import '../navigationBootstrap.cjs'
import type { StorageKeyContext } from './storageKeyStore.cjs'
import {
  createDuckDuckGoSearchWindow,
  resolveDuckDuckGoSearchMode,
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

interface LocalBridgeServerModule {
  startLocalBridgeServer: (options: {
    baseDir: string
    host: string
    port: number
    token: string
    allowedOrigins: readonly string[]
    databasePath: string
    masterKey: Buffer
    duckDuckGoBrowserSearch?: (request: DuckDuckGoBrowserSearchRequest) => Promise<DuckDuckGoBrowserSearchResponse>
    duckDuckGoSearchMode?: DuckDuckGoSearchMode
  }) => Promise<LocalBridgeHandle>
}

let bridgeHandle: LocalBridgeHandle | null = null
let duckDuckGoSearchWindow: DuckDuckGoSearchWindowService | null = null

interface ScreenCaptureRequest {
  sourceId?: string
  maxWidth?: number
  maxHeight?: number
}

interface ScreenCaptureResult {
  dataUrl: string
  source: { id: string; name: string; width: number; height: number }
}

const SCREEN_CAPTURE_PROVIDER_KEY = '__irisScreenCaptureProvider'

function boundedDimension(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

async function captureDesktopFrame(request: ScreenCaptureRequest = {}): Promise<ScreenCaptureResult> {
  const width = boundedDimension(request.maxWidth, 1600, 320, 1920)
  const height = boundedDimension(request.maxHeight, 1000, 180, 1200)
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false,
  })
  const requested = String(request.sourceId || '').trim()
  const source =
    (requested ? sources.find((candidate) => candidate.id === requested) : null) ||
    sources.find((candidate) => candidate.id.startsWith('screen:')) ||
    sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('No capturable desktop source is available.')

  let jpeg = source.thumbnail.toJPEG(82)
  if (jpeg.byteLength > 4 * 1024 * 1024) jpeg = source.thumbnail.toJPEG(65)
  if (jpeg.byteLength > 5 * 1024 * 1024) jpeg = source.thumbnail.toJPEG(45)
  if (jpeg.byteLength > 6 * 1024 * 1024) throw new Error('Captured desktop frame exceeds the safe size limit.')
  const size = source.thumbnail.getSize()
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    source: { id: source.id, name: source.name, width: size.width, height: size.height },
  }
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
    const serverUrl = pathToFileURL(path.join(__dirname, '..', '..', 'backend-dist', 'bridgeServer.js')).href
    ;(globalThis as Record<string, unknown>)[SCREEN_CAPTURE_PROVIDER_KEY] = captureDesktopFrame
    const mod = (await import(serverUrl)) as LocalBridgeServerModule
    const devOrigin = process.env.CODE_EDITOR_DEV_SERVER_URL
      ? new URL(process.env.CODE_EDITOR_DEV_SERVER_URL).origin
      : 'http://localhost:5173'
    const duckDuckGoSearchMode = resolveDuckDuckGoSearchMode(process.env.IRIS_DDG_SEARCH_MODE)
    if (duckDuckGoSearchMode !== 'legacy' && !duckDuckGoSearchWindow) {
      duckDuckGoSearchWindow = createDuckDuckGoSearchWindow()
    }

    bridgeHandle = await mod.startLocalBridgeServer({
      baseDir: app.getPath('home'),
      host: '127.0.0.1',
      port: 0,
      token: randomUUID(),
      allowedOrigins: app.isPackaged ? ['null'] : [devOrigin],
      databasePath: storage.databasePath,
      masterKey: storage.masterKey,
      duckDuckGoBrowserSearch: duckDuckGoSearchWindow?.search,
      duckDuckGoSearchMode,
    })
    return bridgeHandle
  } catch (error: unknown) {
    duckDuckGoSearchWindow?.close()
    duckDuckGoSearchWindow = null
    console.warn('[iris] failed to start local bridge server')
    throw error
  }
}

function getLocalBridgeHandle(): LocalBridgeHandle | null {
  return bridgeHandle
}

function getLocalBridgePermissions(): BridgePermissionState | null {
  return bridgeHandle?.getPermissions ? bridgeHandle.getPermissions() : null
}

// Updates local bridge permissions while preserving the invariants owned by the Electron desktop
// shell.
function updateLocalBridgePermissions(
  permissions: Partial<BridgePermissionState>,
): { ok: false; error: string } | { ok: true; permissions: BridgePermissionState } {
  if (!bridgeHandle?.updatePermissions) {
    return { ok: false, error: 'local-bridge-not-ready' }
  }
  return { ok: true, permissions: bridgeHandle.updatePermissions(permissions) }
}

// Stops the packaged bridge server and clears the retained handle during application shutdown.
async function closeLocalBridge(): Promise<void> {
  const current = bridgeHandle
  const browserSearch = duckDuckGoSearchWindow
  bridgeHandle = null
  duckDuckGoSearchWindow = null
  delete (globalThis as Record<string, unknown>)[SCREEN_CAPTURE_PROVIDER_KEY]
  browserSearch?.close()
  if (!current?.close) return
  await current.close()
}

export {
  closeLocalBridge,
  ensureLocalBridge,
  getLocalBridgeHandle,
  getLocalBridgePermissions,
  updateLocalBridgePermissions,
}
