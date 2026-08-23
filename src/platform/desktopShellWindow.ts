/**
 * Wraps the narrow preload API used by IRIS's native launcher, workspace, and editor windows.
 * Browser mode receives safe no-op behavior instead of importing Electron-specific objects.
 */

export interface DesktopWindowModeOptions {
  anchorX?: number
  anchorY?: number
  extraWidth?: number
}

export interface DesktopAgentStatusSummary {
  running: boolean
  thinking: string
}

export interface DesktopWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopLauncherModeResult {
  mode: 'collapsed' | 'expanded'
  position: { x: number; y: number }
  bounds: DesktopWindowBounds
}

function getDesktopBridgeCandidate(): OrbitDesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.orbitDesktop ?? null
}

function getDesktopBridge(): OrbitDesktopBridge | null {
  const bridge = getDesktopBridgeCandidate()
  if (!bridge || bridge.isDesktopShell !== true) return null
  return bridge
}

export function hasDesktopBridge(): boolean {
  return Boolean(getDesktopBridgeCandidate())
}

export function canControlDesktopWindow(): boolean {
  return Boolean(getDesktopBridge())
}

export function moveDesktopWindowBy(dx: number, dy: number): void {
  getDesktopBridge()?.moveWindowBy?.(dx, dy)
}

export async function finishDesktopLauncherDrag(
  screenX: number,
  screenY: number,
): Promise<DesktopLauncherModeResult | null> {
  const bridge = getDesktopBridge()
  if (!bridge?.finishLauncherDrag) return null

  try {
    return (await bridge.finishLauncherDrag(screenX, screenY)) as DesktopLauncherModeResult | null
  } catch {
    return null
  }
}

export function minimizeDesktopWindow(): void {
  getDesktopBridge()?.minimizeWindow?.()
}

export function hideDesktopWindow(): void {
  getDesktopBridge()?.hideWindow?.()
}

export function resizeDesktopWindow(bounds: DesktopWindowBounds): void {
  getDesktopBridge()?.resizeWindow?.(bounds)
}

export async function setDesktopLauncherExpanded(
  expanded: boolean,
  orbBounds: DesktopWindowBounds,
): Promise<DesktopLauncherModeResult | null> {
  const bridge = getDesktopBridge()
  if (!bridge?.setLauncherExpanded) return null

  try {
    return await bridge.setLauncherExpanded(expanded, orbBounds)
  } catch {
    return null
  }
}

export function openDesktopWorkspacePanel(panel: string): void {
  getDesktopBridge()?.openWorkspacePanel?.(panel)
}

export function openDesktopEditorWindow(): void {
  getDesktopBridge()?.openEditorWindow?.()
}

export function notifyDesktopWorkspaceReady(): void {
  getDesktopBridge()?.notifyWorkspaceReady?.()
}

export function onDesktopWorkspacePanel(listener: (panel: string) => void): () => void {
  return getDesktopBridge()?.onWorkspacePanel?.(listener) || (() => {})
}

export function publishDesktopAgentStatus(status: DesktopAgentStatusSummary): void {
  getDesktopBridge()?.publishAgentStatus?.(status)
}

export function onDesktopAgentStatus(listener: (status: DesktopAgentStatusSummary) => void): () => void {
  return getDesktopBridge()?.onAgentStatus?.(listener) || (() => {})
}

export function requestDesktopAgentStop(): void {
  getDesktopBridge()?.requestAgentStop?.()
}

export function onDesktopAgentStopRequest(listener: () => void): () => void {
  return getDesktopBridge()?.onAgentStopRequest?.(listener) || (() => {})
}

export async function setDesktopWindowMode(
  mode: string,
  options: DesktopWindowModeOptions = {},
): Promise<unknown | null> {
  const bridge = getDesktopBridge()
  if (!bridge?.setWindowMode) return undefined

  try {
    return await bridge.setWindowMode({
      mode,
      anchorX: options.anchorX,
      anchorY: options.anchorY,
      extraWidth: options.extraWidth,
    })
  } catch {
    return null
  }
}

export async function getDesktopScreenSources(): Promise<Array<{
  id: string
  name: string
  thumbnail?: string
}> | null> {
  const bridge = getDesktopBridgeCandidate()
  if (typeof bridge?.getScreenSources !== 'function') return null

  try {
    return await bridge.getScreenSources()
  } catch {
    return null
  }
}
