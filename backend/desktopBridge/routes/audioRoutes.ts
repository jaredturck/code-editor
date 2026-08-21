/** Handles microphone model status, installation, and bounded local/cloud transcription. */

import type { BridgeRequest, BridgeResponse } from '../types.js';
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js';
import { requireBridgePermission } from '../shared/bridgeAuthorization.js';
import { sendJson } from '../response.js';
import {
  getAudioTranscriptionStatus,
  installAudioTranscriptionModel,
  readAudioBody,
  transcribeAudio,
} from '../services/audioTranscriptionService.js';

function requestHeader(req: BridgeRequest, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export async function handleAudioRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  _baseDir: string,
  _requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/audio/transcription/status' && req.method === 'GET') {
    sendJson(res, 200, await getAudioTranscriptionStatus());
    return true;
  }

  if (pathname === '/api/local/audio/transcription/install' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'microphone');
    sendJson(res, 200, await installAudioTranscriptionModel());
    return true;
  }

  if (pathname === '/api/local/audio/transcriptions' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'microphone');
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const audio = await readAudioBody(req);
    const result = await transcribeAudio(audio, {
      provider: requestHeader(req, 'x-iris-audio-provider'),
      model: requestHeader(req, 'x-iris-audio-model'),
      apiKey: requestHeader(req, 'x-iris-audio-key'),
      localFallback: requestHeader(req, 'x-iris-audio-local-fallback') !== '0',
      signal: controller.signal,
    });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
