import { buildBridgePermissionState, readOrbSettings } from '@/platform/settingsStorage';

export interface AgentScreenFrame {
  dataUrl: string;
  source: { id: string; name: string; width: number; height: number };
}

function bridgeParam(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) || '';
}

export async function syncScreenCapturePermission(): Promise<void> {
  const security = window.orbitDesktop?.security;
  if (!security?.updateBridgePermissions) return;
  const settings = readOrbSettings();
  const permissions = {
    ...buildBridgePermissionState(settings),
    screenCapture: settings.permissions_screen_capture === true,
  } as ReturnType<typeof buildBridgePermissionState> & { screenCapture: boolean };
  const result = await (
    security.updateBridgePermissions as unknown as (
      permissions: Record<string, boolean>,
    ) => Promise<{ ok: boolean; error?: string }>
  )(permissions);
  if (result?.ok === false) throw new Error(result.error || 'Screen-capture permission sync failed.');
}

export async function captureAgentScreen(
  options: { sourceId?: string; maxWidth?: number; maxHeight?: number } = {},
): Promise<AgentScreenFrame> {
  const settings = readOrbSettings();
  if (settings.permissions_screen_capture !== true) {
    throw new Error('Screen capture permission is disabled.');
  }
  await syncScreenCapturePermission();

  const port = bridgeParam('bridgePort');
  const token = bridgeParam('bridgeToken');
  if (!/^\d+$/.test(port) || !token) throw new Error('The trusted desktop bridge is unavailable.');

  const response = await fetch(`http://127.0.0.1:${port}/api/local/screen/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iris-bridge-token': token,
    },
    body: JSON.stringify(options),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error || `Screen capture failed (${response.status}).`));
  }
  const source =
    payload.source && typeof payload.source === 'object'
      ? (payload.source as AgentScreenFrame['source'])
      : null;
  const dataUrl = String(payload.dataUrl || '');
  if (!dataUrl.startsWith('data:image/') || !source) {
    throw new Error('The trusted bridge returned an invalid screen frame.');
  }
  return { dataUrl, source };
}

let screenPermissionListenerInstalled = false;

export function installScreenCapturePermissionSync(): void {
  if (typeof window === 'undefined' || screenPermissionListenerInstalled) return;
  screenPermissionListenerInstalled = true;
  const synchronize = () => {
    void syncScreenCapturePermission().catch(() => undefined);
  };
  window.addEventListener('iris:settings-updated', synchronize);
  synchronize();
}

installScreenCapturePermissionSync();
