/**
 * Declares TypeScript types that let renderer startup and application shell code describe
 * runtime values provided outside normal TypeScript modules.
 */

export {};

declare global {
  interface CredentialBridgeResponse {
    ok: boolean;
    error?: string;
    code?: string;
  }

  interface CredentialStorageStatus {
    available: boolean;
    persistent: boolean;
    backend: string;
    reason: string;
  }

  interface OrbitDesktopBridge {
    isDesktopShell?: boolean;
    windowRole?: 'orb' | 'workspace' | 'editor';
    moveWindowBy?: (dx: number, dy: number) => void;
    finishLauncherDrag?: (screenX: number, screenY: number) => Promise<unknown>;
    minimizeWindow?: () => void;
    hideWindow?: () => void;
    resizeWindow?: (bounds: { x: number; y: number; width: number; height: number }) => void;
    setLauncherExpanded?: (
      expanded: boolean,
      orbBounds: { x: number; y: number; width: number; height: number },
    ) => Promise<{
      mode: 'collapsed' | 'expanded';
      position: { x: number; y: number };
      bounds: { x: number; y: number; width: number; height: number };
    } | null>;
    openWorkspacePanel?: (panel: string) => void;
    openEditorWindow?: () => void;
    notifyWorkspaceReady?: () => void;
    onWorkspacePanel?: (listener: (panel: string) => void) => () => void;
    publishAgentStatus?: (status: { running: boolean; thinking: string }) => void;
    onAgentStatus?: (
      listener: (status: { running: boolean; thinking: string }) => void,
    ) => () => void;
    requestAgentStop?: () => void;
    onAgentStopRequest?: (listener: () => void) => () => void;
    setWindowMode?: (
      options:
        | {
            mode: string;
            anchorX?: number;
            anchorY?: number;
            extraWidth?: number;
          }
        | string,
    ) => Promise<string>;
    getWindowMode?: () => Promise<string>;
    getScreenSources?: () => Promise<Array<{ id: string; name: string; thumbnail?: string }>>;
    security?: {
      getBridgePermissions: () => Promise<{
        ok: boolean;
        error?: string;
        permissions?: Record<string, boolean> | null;
      }>;
      updateBridgePermissions: (permissions: {
        fileRead: boolean;
        fileWrite: boolean;
        terminal: boolean;
        launcher: boolean;
        automation: boolean;
        microphone: boolean;
      }) => Promise<{
        ok: boolean;
        error?: string;
        permissions?: Record<string, boolean>;
      }>;
    };
    credentials?: {
      status: () => CredentialBridgeResponse & CredentialStorageStatus;
      list: () => CredentialBridgeResponse & { providers?: string[] };
      get: (provider: string) => CredentialBridgeResponse & { value?: string };
      set: (provider: string, value: string) => CredentialBridgeResponse & { saved?: boolean };
      delete: (provider: string) => CredentialBridgeResponse & { deleted?: boolean };
    };
    log?: (payload: unknown) => void;
    showLogs?: () => Promise<{
      ok: boolean;
      error?: string;
      file?: string;
      terminal?: string;
    }>;
  }

  interface Window {
    orbitDesktop?: OrbitDesktopBridge;
  }
}
