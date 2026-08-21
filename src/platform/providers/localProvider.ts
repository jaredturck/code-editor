/**
 * localProvider.js
 * Local LLM adapter — Ollama (/api/chat) with fallback to LM Studio (/v1/chat/completions).
 * Multimodal requests are preserved for vision-capable Ollama and LM Studio models.
 */

import {
  contentToText,
  normalizeUsage,
  safeNumber,
  toMetaResponse,
} from '@/platform/providers/providerUtils';
import type {
  AIMessage,
  ProviderCallOptions,
  ProviderFetch,
  ProviderStreamFn,
} from '@/platform/providers/types';
import type { ProviderGenerationTimings } from '@/platform/agent/types';

/**
 * Sends a provider-neutral request to the configured local model server and normalizes its
 * completion into the same result shape used by hosted providers. Endpoint differences
 * remain here so the agent loop does not need a separate local execution path.
 */

interface LocalStreamResult {
  text: string;
  thinking: string;
  usage: ReturnType<typeof normalizeUsage>;
  emitted: boolean;
  timings: ProviderGenerationTimings;
}

function localStreamError(message: string, partial = false): Error & { partial?: boolean } {
  const error = new Error(message) as Error & { partial?: boolean };
  if (partial) error.partial = true;
  return error;
}

function emitLocalToken(options: ProviderCallOptions, token: unknown): string {
  const text = String(token || '');
  if (text) options.onToken?.(text);
  return text;
}

function emitLocalThinkingToken(options: ProviderCallOptions, token: unknown): string {
  const text = String(token || '');
  if (text) options.onThinkingToken?.(text);
  return text;
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const nanoseconds = Number(value);
  if (!Number.isFinite(nanoseconds) || nanoseconds < 0) return undefined;
  return nanoseconds / 1_000_000;
}

function elapsedMilliseconds(startedAt: number, timestamp: number | null): number | undefined {
  if (timestamp === null) return undefined;
  return Math.max(0, timestamp - startedAt);
}

function streamPhaseMilliseconds(
  startedAt: number | null,
  completedAt: number | null,
): number | undefined {
  if (startedAt === null || completedAt === null) return undefined;
  return Math.max(0, completedAt - startedAt);
}

function buildLocalStreamTimings(
  startedAt: number,
  completedAt: number,
  firstResponseAt: number | null,
  firstThinkingAt: number | null,
  lastThinkingAt: number | null,
  firstAnswerAt: number | null,
  finalData: Record<string, unknown> | null = null,
): ProviderGenerationTimings {
  const thinkingCompletedAt =
    firstAnswerAt === null
      ? lastThinkingAt
      : lastThinkingAt === null
        ? firstAnswerAt
        : Math.max(firstAnswerAt, lastThinkingAt);
  return {
    totalMs:
      nanosecondsToMilliseconds(finalData?.total_duration) ?? Math.max(0, completedAt - startedAt),
    loadMs: nanosecondsToMilliseconds(finalData?.load_duration),
    promptEvalMs: nanosecondsToMilliseconds(finalData?.prompt_eval_duration),
    generationMs: nanosecondsToMilliseconds(finalData?.eval_duration),
    firstResponseMs: elapsedMilliseconds(startedAt, firstResponseAt),
    firstThinkingMs: elapsedMilliseconds(startedAt, firstThinkingAt),
    firstAnswerMs: elapsedMilliseconds(startedAt, firstAnswerAt),
    thinkingStreamMs: streamPhaseMilliseconds(firstThinkingAt, thinkingCompletedAt),
    answerStreamMs: streamPhaseMilliseconds(firstAnswerAt, completedAt),
  };
}

function buildOllamaTimings(data: Record<string, unknown>): ProviderGenerationTimings {
  return {
    totalMs: nanosecondsToMilliseconds(data.total_duration),
    loadMs: nanosecondsToMilliseconds(data.load_duration),
    promptEvalMs: nanosecondsToMilliseconds(data.prompt_eval_duration),
    generationMs: nanosecondsToMilliseconds(data.eval_duration),
  };
}

async function streamOllamaCompletion(
  url: string,
  model: string,
  messages: unknown[],
  streamFn: ProviderStreamFn,
  options: ProviderCallOptions,
): Promise<LocalStreamResult> {
  let buffer = '';
  let text = '';
  let thinking = '';
  let usage = normalizeUsage(null);
  let emitted = false;
  let finalData: Record<string, unknown> | null = null;
  const startedAt = Date.now();
  let firstResponseAt: number | null = null;
  let firstThinkingAt: number | null = null;
  let lastThinkingAt: number | null = null;
  let firstAnswerAt: number | null = null;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const data = JSON.parse(trimmed);
    if (data?.error) throw localStreamError(String(data.error), emitted);
    const thinkingDelta = emitLocalThinkingToken(
      options,
      data?.message?.thinking ?? data?.message?.reasoning_content,
    );
    if (thinkingDelta) {
      const now = Date.now();
      if (firstThinkingAt === null) firstThinkingAt = now;
      lastThinkingAt = now;
      emitted = true;
      thinking += thinkingDelta;
    }
    const delta = emitLocalToken(options, data?.message?.content);
    if (delta) {
      if (firstAnswerAt === null) firstAnswerAt = Date.now();
      emitted = true;
      text += delta;
    }
    if (data?.done) {
      finalData = data;
      usage = normalizeUsage(data?.usage, {
        promptTokens: safeNumber(data?.prompt_eval_count),
        completionTokens: safeNumber(data?.eval_count),
      });
    }
  };

  const streamResult = await streamFn(
    `${url}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: options.signal,
    },
    (chunk) => {
      if (firstResponseAt === null) firstResponseAt = Date.now();
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    },
    { provider: 'local' },
  );
  if (buffer.trim()) consumeLine(buffer);
  if (streamResult && streamResult.ok === false) {
    throw localStreamError(`Ollama streaming request failed (${streamResult.status})`, emitted);
  }
  if (!text) throw localStreamError('Ollama returned no streamed text.', emitted);
  const completedAt = Date.now();
  return {
    text,
    thinking,
    usage,
    emitted,
    timings: buildLocalStreamTimings(
      startedAt,
      completedAt,
      firstResponseAt,
      firstThinkingAt,
      lastThinkingAt,
      firstAnswerAt,
      finalData,
    ),
  };
}

async function streamOpenAICompatibleCompletion(
  url: string,
  model: string,
  messages: unknown[],
  streamFn: ProviderStreamFn,
  options: ProviderCallOptions,
): Promise<LocalStreamResult> {
  let buffer = '';
  let text = '';
  let thinking = '';
  let usage = normalizeUsage(null);
  let emitted = false;
  const startedAt = Date.now();
  let firstResponseAt: number | null = null;
  let firstThinkingAt: number | null = null;
  let lastThinkingAt: number | null = null;
  let firstAnswerAt: number | null = null;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const data = JSON.parse(payload);
    if (data?.error) {
      throw localStreamError(
        String(data.error?.message || data.error || 'Local stream failed'),
        emitted,
      );
    }
    const reasoning =
      data?.choices?.[0]?.delta?.reasoning_content ??
      data?.choices?.[0]?.delta?.reasoning ??
      data?.choices?.[0]?.delta?.thinking;
    const thinkingDelta = emitLocalThinkingToken(options, reasoning);
    if (thinkingDelta) {
      const now = Date.now();
      if (firstThinkingAt === null) firstThinkingAt = now;
      lastThinkingAt = now;
      emitted = true;
      thinking += thinkingDelta;
    }
    const delta = emitLocalToken(options, data?.choices?.[0]?.delta?.content);
    if (delta) {
      if (firstAnswerAt === null) firstAnswerAt = Date.now();
      emitted = true;
      text += delta;
    }
    if (data?.usage) usage = normalizeUsage(data.usage);
  };

  const streamResult = await streamFn(
    `${url}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options.signal,
    },
    (chunk) => {
      if (firstResponseAt === null) firstResponseAt = Date.now();
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    },
    { provider: 'local' },
  );
  if (buffer.trim()) consumeLine(buffer);
  if (streamResult && streamResult.ok === false) {
    throw localStreamError(`LM Studio streaming request failed (${streamResult.status})`, emitted);
  }
  if (!text) throw localStreamError('LM Studio returned no streamed text.', emitted);
  const completedAt = Date.now();
  return {
    text,
    thinking,
    usage,
    emitted,
    timings: buildLocalStreamTimings(
      startedAt,
      completedAt,
      firstResponseAt,
      firstThinkingAt,
      lastThinkingAt,
      firstAnswerAt,
    ),
  };
}

export async function callLocalLLM(
  messages: readonly AIMessage[],
  baseUrl: string,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
) {
  if (!baseUrl) throw new Error('Local server URL not configured.');
  // `localhost` can resolve to IPv6 ::1 while Ollama/LM Studio listen only on IPv4 127.0.0.1 →
  // connection refused. Pin to 127.0.0.1 so a working server isn't missed on the first attempt.
  const _url = baseUrl
    .replace(/\/$/, '')
    .replace(/(^https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');

  const toDataUrl = (part: any): string => {
    const image = part?.image_url;
    if (typeof image === 'string') return image;
    if (image && typeof image.url === 'string') return image.url;
    if (part?.inline_data?.data) {
      return `data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`;
    }
    return '';
  };

  const toOllamaMessage = (message: AIMessage) => {
    if (!Array.isArray(message.content)) {
      return { role: message.role, content: String(message.content || '') };
    }
    const text = contentToText(message.content);
    const images = message.content
      .map((part: any) => toDataUrl(part))
      .filter((url: string) => /^data:image\/[^;]+;base64,/i.test(url))
      .map((url: string) => url.replace(/^data:image\/[^;]+;base64,/i, ''));
    return {
      role: message.role,
      content: text,
      ...(images.length ? { images } : {}),
    };
  };

  const ollamaMessages = messages.map(toOllamaMessage);
  const openAiMessages = messages.map((message) => ({
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content
          .map((part: any) => {
            if (part?.type === 'image_url' || part?.image_url) {
              const url = toDataUrl(part);
              return url ? { type: 'image_url', image_url: { url } } : null;
            }
            if (part?.inline_data?.data) {
              const url = toDataUrl(part);
              return { type: 'image_url', image_url: { url } };
            }
            return { type: 'text', text: String(part?.text || '') };
          })
          .filter(Boolean)
      : String(message.content || ''),
  }));

  // Stream local completions when the caller wants live answer tokens. The same ordinary HTTP
  // connection remains open for the complete response; no polling or WebSocket is required.
  if ((options.onToken || options.onThinkingToken) && options.streamFn) {
    let ollamaError = '';
    try {
      const streamed = await streamOllamaCompletion(
        _url,
        model,
        ollamaMessages,
        options.streamFn,
        options,
      );
      return toMetaResponse({
        provider: 'Local',
        model,
        text: streamed.text,
        usage: streamed.usage,
        thinkingText: streamed.thinking,
        timings: streamed.timings,
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      if ((error as { partial?: boolean })?.partial) throw error;
      ollamaError = error instanceof Error ? error.message : String(error || 'stream failed');
    }

    try {
      const streamed = await streamOpenAICompatibleCompletion(
        _url,
        model,
        openAiMessages,
        options.streamFn,
        options,
      );
      return toMetaResponse({
        provider: 'Local',
        model,
        text: streamed.text,
        usage: streamed.usage,
        thinkingText: streamed.thinking,
        timings: streamed.timings,
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      throw new Error(
        `Local streaming failed for Ollama and LM Studio. [Ollama: ${ollamaError}; LM Studio: ${
          error instanceof Error ? error.message : String(error || 'stream failed')
        }]`,
      );
    }
  }

  // ── Try Ollama /api/chat first ────────────────────────────────────────────
  let _ollamaNote = '';
  try {
    const _res = await fetchFn(`${_url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: ollamaMessages, stream: false }),
    });

    if (_res.ok) {
      const _data: any = await _res.json();
      const _usage = normalizeUsage(_data?.usage, {
        promptTokens: safeNumber(_data?.prompt_eval_count),
        completionTokens: safeNumber(_data?.eval_count),
      });
      return toMetaResponse({
        provider: 'Local',
        model,
        text:
          _data?.message?.content || _data?.choices?.[0]?.message?.content || JSON.stringify(_data),
        usage: _usage,
        thinkingText: _data?.message?.thinking || _data?.message?.reasoning_content || '',
        timings: buildOllamaTimings(_data),
      });
    }

    // Surface Ollama's real error — it returns { error: "model '…' not found, try pulling it first" }.
    const _body = await _res.text().catch(() => '');
    let _serverMsg = '';
    try {
      _serverMsg = String(JSON.parse(_body)?.error || '');
    } catch {
      _serverMsg = _body.slice(0, 200);
    }
    // A model/parameter error from Ollama means the SERVER IS REACHABLE — don't mask it by retrying
    // the LM Studio endpoint on the same port (which would 404 and hide the real cause).
    if (/model|not found|pull|no such/i.test(_serverMsg)) {
      throw new Error(
        `Local model "${model}" isn't available on the Ollama server (${_serverMsg}). Pull it with \`ollama pull ${model}\`, or pick an installed model in Settings → Agents.`,
      );
    }
    _ollamaNote = `Ollama ${_res.status}${_serverMsg ? `: ${_serverMsg}` : ''}`;
  } catch (err) {
    // Re-throw the actionable model error; otherwise record the connection failure and try LM Studio.
    if (err instanceof Error && /isn't available on the Ollama server/.test(err.message)) throw err;
    _ollamaNote = `Ollama unreachable (${err instanceof Error ? err.message : 'connection failed'})`;
  }

  // ── Fallback to LM Studio /v1/chat/completions ────────────────────────────
  let _res2: Awaited<ReturnType<ProviderFetch>>;
  try {
    _res2 = await fetchFn(`${_url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: openAiMessages, stream: false }),
    });
  } catch (err) {
    throw new Error(
      `Can't reach a local model server at ${_url} (tried Ollama /api/chat and LM Studio /v1/chat/completions). ` +
        `Is Ollama or LM Studio running and serving "${model}"? [${_ollamaNote}; LM Studio: ${err instanceof Error ? err.message : 'connection failed'}]`,
    );
  }

  if (!_res2.ok) {
    const _body2 = await _res2.text().catch(() => '');
    let _msg2 = '';
    try {
      _msg2 = String(JSON.parse(_body2)?.error?.message || JSON.parse(_body2)?.error || '');
    } catch {
      _msg2 = _body2.slice(0, 200);
    }
    throw new Error(
      `Local server error: LM Studio ${_res2.status}${_msg2 ? `: ${_msg2}` : ''}${_ollamaNote ? ` (after ${_ollamaNote})` : ''}`,
    );
  }

  const _data2: any = await _res2.json();
  const _usage2 = normalizeUsage(_data2?.usage);

  return toMetaResponse({
    provider: 'Local',
    model,
    text: _data2?.choices?.[0]?.message?.content || '',
    usage: _usage2,
    thinkingText:
      _data2?.choices?.[0]?.message?.reasoning_content ||
      _data2?.choices?.[0]?.message?.reasoning ||
      '',
  });
}

/**
 * List models served by a local Ollama / LM Studio endpoint.
 * Tries Ollama /api/tags first, then LM Studio /v1/models. Returns [] on failure.
 */
export async function listLocalModels(baseUrl: string, fetchFn: ProviderFetch): Promise<string[]> {
  const _url = String(baseUrl || '')
    .replace(/\/$/, '')
    .replace(/(^https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
  if (!_url) return [];

  // Ollama
  try {
    const _res = await fetchFn(`${_url}/api/tags`, { method: 'GET' });
    if (_res.ok) {
      const _data: any = await _res.json().catch(() => ({}));
      const _names = Array.isArray(_data?.models)
        ? _data.models.map((m: any) => String(m?.name || m?.model || '')).filter(Boolean)
        : [];
      if (_names.length)
        return (_names as string[]).sort((a: string, b: string) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
    }
  } catch {
    /* try next */
  }

  // LM Studio / OpenAI-compatible
  try {
    const _res = await fetchFn(`${_url}/v1/models`, { method: 'GET' });
    if (_res.ok) {
      const _data: any = await _res.json().catch(() => ({}));
      const _raw = Array.isArray(_data?.data) ? _data.data : Array.isArray(_data) ? _data : [];
      return _raw
        .map((m: any) => String(m?.id || m?.name || ''))
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
  } catch {
    /* give up */
  }

  return [];
}
