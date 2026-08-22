import type { BridgeRequest, BridgeResponse } from '../types.js';
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js';
import { requireBridgePermission } from '../shared/bridgeAuthorization.js';
import { sendJson } from '../response.js';
import { readJsonBody } from '../services/automationAiService.js';
import { getScreenCaptureProvider } from '../services/screenCaptureProvider.js';

export async function handleScreenRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  _baseDir: string,
  _requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname !== '/api/local/screen/capture' || req.method !== 'POST') return false;

  requireBridgePermission(securityContext, 'screenCapture');
  const provider = getScreenCaptureProvider();
  if (!provider) {
    sendJson(res, 503, {
      error: 'Trusted desktop screen capture is unavailable.',
      code: 'screen_capture_unavailable',
    });
    return true;
  }

  const body = await readJsonBody(req);
  const frame = await provider({
    sourceId: String(body.sourceId || '').trim() || undefined,
    maxWidth: body.maxWidth,
    maxHeight: body.maxHeight,
  });
  sendJson(res, 200, frame);
  return true;
}
