export interface ScreenCaptureProviderRequest {
  sourceId?: string;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ScreenCaptureProviderResult {
  dataUrl: string;
  source: { id: string; name: string; width: number; height: number };
}

type ScreenCaptureProvider = (
  request?: ScreenCaptureProviderRequest,
) => Promise<ScreenCaptureProviderResult>;

const SCREEN_CAPTURE_PROVIDER_KEY = '__irisScreenCaptureProvider';

export function getScreenCaptureProvider(): ScreenCaptureProvider | null {
  const candidate = (globalThis as Record<string, unknown>)[SCREEN_CAPTURE_PROVIDER_KEY];
  return typeof candidate === 'function' ? (candidate as ScreenCaptureProvider) : null;
}
