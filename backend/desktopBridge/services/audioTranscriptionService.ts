/**
 * Owns IRIS's bounded speech-to-text integrations. Recordings remain in memory, are validated
 * as mono 16 kHz PCM WAV, and are discarded immediately after the selected provider responds.
 */

import type { BridgeRequest } from '../types.js';
import { withStatus } from './bridgeServiceRuntime.js';

export const NOTE_TRANSCRIPTION_MODEL = 'gabegoodhart/granite4.1-speech:2b';
export const NOTE_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES = 2_300_000_000;
export const MAX_NOTE_AUDIO_BYTES = 12 * 1024 * 1024;

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const OLLAMA_STATUS_TIMEOUT_MS = 4_000;
const OLLAMA_INSTALL_TIMEOUT_MS = 45 * 60 * 1_000;
const TRANSCRIPTION_TIMEOUT_MS = 10 * 60 * 1_000;
const ALLOWED_CLOUD_PROVIDERS = new Set(['openai', 'openrouter', 'gemini']);

interface OllamaModelRecord {
  name?: unknown;
  model?: unknown;
}

interface OllamaTagsResponse {
  models?: OllamaModelRecord[];
}

export interface NoteTranscriptionStatus {
  ollamaAvailable: boolean;
  modelInstalled: boolean;
  model: string;
  modelDownloadBytes: number;
}

export interface AudioTranscriptionOptions {
  provider?: unknown;
  model?: unknown;
  apiKey?: unknown;
  localFallback?: unknown;
  signal?: AbortSignal;
}

export interface AudioTranscriptionResult {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

function createTimeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function providerErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  const nested = record.error;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  if (nested && typeof nested === 'object') {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  const message = record.message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function parseJsonOrNdjson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const parsed = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((value) => value !== null);
    return parsed.at(-1) || {};
  }
}

function modelNameMatches(value: unknown): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  const expected = NOTE_TRANSCRIPTION_MODEL.toLowerCase();
  return normalized === expected || normalized.startsWith(`${expected}@`);
}

function validateWav(buffer: Buffer): void {
  if (buffer.length < 44) throw withStatus('The recording is empty or invalid.', 400);
  const validContainer =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE' &&
    buffer.subarray(12, 16).toString('ascii') === 'fmt ' &&
    buffer.subarray(36, 40).toString('ascii') === 'data';
  const validFormat =
    buffer.readUInt16LE(20) === 1 &&
    buffer.readUInt16LE(22) === 1 &&
    buffer.readUInt32LE(24) === 16_000 &&
    buffer.readUInt16LE(34) === 16;
  if (!validContainer || !validFormat) {
    throw withStatus('Transcription requires mono 16 kHz, 16-bit PCM WAV audio.', 415);
  }
}

/** Reads one bounded audio request without writing the recording to disk. */
export async function readAudioBody(req: BridgeRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > MAX_NOTE_AUDIO_BYTES) {
      throw withStatus('Recording exceeds the five-minute limit.', 413);
    }
    chunks.push(chunk);
  }

  const audio = Buffer.concat(chunks);
  validateWav(audio);
  return audio;
}

/** Returns whether Ollama is reachable and the fixed Granite speech model is installed. */
export async function getAudioTranscriptionStatus(): Promise<NoteTranscriptionStatus> {
  const timeout = createTimeoutSignal(OLLAMA_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: timeout.signal,
    });
    if (!response.ok) {
      return {
        ollamaAvailable: false,
        modelInstalled: false,
        model: NOTE_TRANSCRIPTION_MODEL,
        modelDownloadBytes: NOTE_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES,
      };
    }
    const payload = (await response.json().catch(() => ({}))) as OllamaTagsResponse;
    const modelInstalled = Array.isArray(payload.models)
      ? payload.models.some(
          (model) => modelNameMatches(model.name) || modelNameMatches(model.model),
        )
      : false;
    return {
      ollamaAvailable: true,
      modelInstalled,
      model: NOTE_TRANSCRIPTION_MODEL,
      modelDownloadBytes: NOTE_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES,
    };
  } catch {
    return {
      ollamaAvailable: false,
      modelInstalled: false,
      model: NOTE_TRANSCRIPTION_MODEL,
      modelDownloadBytes: NOTE_TRANSCRIPTION_MODEL_DOWNLOAD_BYTES,
    };
  } finally {
    timeout.clear();
  }
}

/** Pulls the fixed Granite speech model through the user's existing Ollama installation. */
export async function installAudioTranscriptionModel(): Promise<NoteTranscriptionStatus> {
  const initial = await getAudioTranscriptionStatus();
  if (!initial.ollamaAvailable) {
    throw withStatus('Ollama is not running. Start Ollama and try again.', 503);
  }
  if (initial.modelInstalled) return initial;

  const timeout = createTimeoutSignal(OLLAMA_INSTALL_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: NOTE_TRANSCRIPTION_MODEL, stream: false }),
      signal: timeout.signal,
    });
    const raw = await response.text();
    const payload = parseJsonOrNdjson(raw);
    if (!response.ok) {
      throw withStatus(
        providerErrorMessage(payload, 'Ollama could not download the transcription model.'),
        response.status || 502,
      );
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw withStatus('The transcription model download timed out.', 504);
    }
    throw error;
  } finally {
    timeout.clear();
  }

  const status = await getAudioTranscriptionStatus();
  if (!status.modelInstalled) {
    throw withStatus('Ollama finished without installing the transcription model.', 502);
  }
  return status;
}

async function transcribeWithLocalGranite(
  audio: Buffer,
  signal?: AbortSignal,
): Promise<AudioTranscriptionResult> {
  const status = await getAudioTranscriptionStatus();
  if (!status.ollamaAvailable) {
    throw withStatus('Ollama is not running. Start Ollama and try again.', 503);
  }
  if (!status.modelInstalled) {
    const error = withStatus('The local transcription model is not installed.', 409) as Error & {
      code?: string;
    };
    error.code = 'transcription_model_missing';
    throw error;
  }

  const form = new FormData();
  form.append('model', NOTE_TRANSCRIPTION_MODEL);
  form.append('file', new Blob([Uint8Array.from(audio)], { type: 'audio/wav' }), 'recording.wav');
  form.append('language', 'en');
  form.append('response_format', 'json');

  const timeout = createTimeoutSignal(TRANSCRIPTION_TIMEOUT_MS, signal);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: timeout.signal,
    });
    const raw = await response.text();
    const payload = parseJsonOrNdjson(raw);
    if (!response.ok) {
      throw withStatus(
        providerErrorMessage(payload, 'Ollama could not transcribe the recording.'),
        response.status || 502,
      );
    }
    const text =
      payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).text || '').trim()
        : '';
    if (!text) throw withStatus('Ollama returned an empty transcription.', 502);
    return {
      text,
      provider: 'local',
      model: NOTE_TRANSCRIPTION_MODEL,
      fallbackUsed: false,
    };
  } catch (error) {
    if (signal?.aborted) throw withStatus('Transcription was cancelled.', 499);
    if (isAbortError(error)) throw withStatus('The transcription request timed out.', 504);
    throw error;
  } finally {
    timeout.clear();
  }
}

async function transcribeWithOpenAI(
  audio: Buffer,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append('model', model || 'gpt-4o-mini-transcribe');
  form.append('file', new Blob([Uint8Array.from(audio)], { type: 'audio/wav' }), 'recording.wav');
  form.append('response_format', 'json');
  const timeout = createTimeoutSignal(TRANSCRIPTION_TIMEOUT_MS, signal);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw withStatus(
        providerErrorMessage(payload, 'OpenAI could not transcribe the recording.'),
        response.status || 502,
      );
    }
    return String((payload as Record<string, unknown>).text || '').trim();
  } finally {
    timeout.clear();
  }
}

async function transcribeWithOpenRouter(
  audio: Buffer,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = createTimeoutSignal(TRANSCRIPTION_TIMEOUT_MS, signal);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'iris-agentics',
        'X-Title': 'IRIS',
      },
      body: JSON.stringify({
        model: model || 'openai/whisper-1',
        input_audio: { data: audio.toString('base64'), format: 'wav' },
      }),
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw withStatus(
        providerErrorMessage(payload, 'OpenRouter could not transcribe the recording.'),
        response.status || 502,
      );
    }
    return String((payload as Record<string, unknown>).text || '').trim();
  } finally {
    timeout.clear();
  }
}

async function transcribeWithGemini(
  audio: Buffer,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const selectedModel = model || 'gemini-3.5-flash';
  const timeout = createTimeoutSignal(TRANSCRIPTION_TIMEOUT_MS, signal);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: selectedModel,
        input: [
          {
            type: 'text',
            text: 'Generate an accurate transcript of the speech. Return only the transcript, with normal punctuation and no commentary.',
          },
          {
            type: 'audio',
            data: audio.toString('base64'),
            mime_type: 'audio/wav',
          },
        ],
      }),
      signal: timeout.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw withStatus(
        providerErrorMessage(payload, 'Gemini could not transcribe the recording.'),
        response.status || 502,
      );
    }
    return String(payload.output_text || '').trim();
  } finally {
    timeout.clear();
  }
}

async function transcribeWithCloud(
  audio: Buffer,
  provider: string,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AudioTranscriptionResult> {
  if (!apiKey) throw withStatus(`No ${provider} API key was supplied.`, 401);
  let text = '';
  if (provider === 'openai') text = await transcribeWithOpenAI(audio, model, apiKey, signal);
  else if (provider === 'openrouter') {
    text = await transcribeWithOpenRouter(audio, model, apiKey, signal);
  } else if (provider === 'gemini') text = await transcribeWithGemini(audio, model, apiKey, signal);
  else throw withStatus('The selected audio provider is not supported.', 400);
  if (!text) throw withStatus('The cloud provider returned an empty transcription.', 502);
  return { text, provider, model, fallbackUsed: false };
}

/** Sends one recording to the configured provider and optionally falls back to local Granite. */
export async function transcribeAudio(
  audio: Buffer,
  options: AudioTranscriptionOptions = {},
): Promise<AudioTranscriptionResult> {
  validateWav(audio);
  const provider = String(options.provider || 'local')
    .trim()
    .toLowerCase();
  const model = String(options.model || '').trim();
  const apiKey = String(options.apiKey || '').trim();
  const localFallback = options.localFallback !== false && options.localFallback !== '0';

  if (provider === 'local') return transcribeWithLocalGranite(audio, options.signal);
  if (!ALLOWED_CLOUD_PROVIDERS.has(provider)) {
    throw withStatus('The selected audio provider is not supported.', 400);
  }

  try {
    return await transcribeWithCloud(audio, provider, model, apiKey, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!localFallback) throw error;
    const fallback = await transcribeWithLocalGranite(audio, options.signal);
    return { ...fallback, fallbackUsed: true };
  }
}

// Compatibility exports retained for existing callers and tests.
export const readNoteAudioBody = readAudioBody;
export const getNoteTranscriptionStatus = getAudioTranscriptionStatus;
export const installNoteTranscriptionModel = installAudioTranscriptionModel;
export async function transcribeNoteAudio(audio: Buffer): Promise<string> {
  return (await transcribeAudio(audio)).text;
}
