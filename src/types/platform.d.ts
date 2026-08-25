/**
 * Declares TypeScript types that let renderer startup and application shell code describe
 * runtime values provided outside normal TypeScript modules.
 */

export {}

declare global {
  interface CredentialBridgeResponse {
    ok: boolean
    error?: string
    code?: string
  }

  interface CredentialStorageStatus {
    available: boolean
    persistent: boolean
    backend: string
    reason: string
  }

  interface OrbitDesktopBridge {
    isDesktopShell?: boolean
    windowRole?: 'orb' | 'workspace' | 'editor'
    onAgentStopRequest?: (listener: () => void) => () => void
    getScreenSources?: () => Promise<Array<{ id: string; name: string; thumbnail?: string }>>
    security?: {
      getBridgePermissions: () => Promise<{
        ok: boolean
        error?: string
        permissions?: Record<string, boolean> | null
      }>
      updateBridgePermissions: (permissions: {
        fileRead: boolean
        fileWrite: boolean
        terminal: boolean
        launcher: boolean
        automation: boolean
        screenCapture: boolean
        microphone: boolean
      }) => Promise<{
        ok: boolean
        error?: string
        permissions?: Record<string, boolean>
      }>
    }
    credentials?: {
      status: () => CredentialBridgeResponse & CredentialStorageStatus
      list: () => CredentialBridgeResponse & { providers?: string[] }
      get: (provider: string) => CredentialBridgeResponse & { value?: string }
      set: (provider: string, value: string) => CredentialBridgeResponse & { saved?: boolean }
      delete: (provider: string) => CredentialBridgeResponse & { deleted?: boolean }
    }
  }

  interface Window {
    orbitDesktop?: OrbitDesktopBridge
  }
}
