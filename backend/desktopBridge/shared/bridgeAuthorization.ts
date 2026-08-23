/**
 * Defines the operating-system capabilities enforced by the local bridge itself. Renderer
 * checks remain useful for interface feedback, but these permissions are consulted again at
 * the route that can actually read files, run programs, or control the desktop.
 */

export type BridgePermission =
  'fileRead' | 'fileWrite' | 'terminal' | 'launcher' | 'automation' | 'screenCapture' | 'microphone'

export interface BridgePermissionState {
  fileRead: boolean
  fileWrite: boolean
  terminal: boolean
  launcher: boolean
  automation: boolean
  screenCapture: boolean
  microphone: boolean
}

export interface BridgeSecurityContext {
  permissions: BridgePermissionState
}

export const DEFAULT_BRIDGE_PERMISSIONS: Readonly<BridgePermissionState> = Object.freeze({
  fileRead: false,
  fileWrite: false,
  terminal: false,
  launcher: false,
  automation: false,
  screenCapture: false,
  microphone: false,
})

export const DEVELOPMENT_BRIDGE_PERMISSIONS: Readonly<BridgePermissionState> = Object.freeze({
  fileRead: true,
  fileWrite: true,
  terminal: true,
  launcher: true,
  automation: true,
  screenCapture: true,
  microphone: true,
})

// Normalizes bridge-owned permission state and fills missing values with restrictive defaults.
export function normalizeBridgePermissions(
  value: Partial<BridgePermissionState> | null | undefined,
  fallback: Readonly<BridgePermissionState> = DEFAULT_BRIDGE_PERMISSIONS,
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

export class BridgePermissionError extends Error {
  statusCode = 403
  code = 'bridge_permission_denied'

  // Creates a permission error carrying the denied capability for stable route responses.
  constructor(permission: BridgePermission) {
    super(`Bridge permission is disabled: ${permission}`)
    this.name = 'BridgePermissionError'
  }
}

/** Enforces a capability at the final HTTP route rather than trusting request-body claims. */
export function requireBridgePermission(
  context: BridgeSecurityContext | undefined,
  permission: BridgePermission,
): void {
  if (context?.permissions?.[permission] === true) return
  throw new BridgePermissionError(permission)
}
