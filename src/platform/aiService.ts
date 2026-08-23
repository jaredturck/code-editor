/**
 * Routes provider-neutral AI requests through the configured adapter, resolves credentials
 * from Electron safeStorage, and falls back to the authenticated local proxy when direct
 * browser requests are unavailable. Provider-specific wire formats remain in `providers/`.
 */

import { proxyAIRequest, proxyAIStream, pullLocalOllamaModel } from '@/platform/desktopBridge'
import { getKey } from '@/platform/keyStore'
import { logAI, logError } from '@/platform/logger'
import { enforceLocalOnlyProvider } from '@/platform/agent/localOnlyPolicy'
import { consumeCloudRequest, getCloudUsageState, isCloudProvider } from '@/platform/agent/cloudUsagePolicy'

import { getErrorMessage } from '@/platform/providers/providerUtils'
import { listOpenAICompatibleModels as _listModels } from '@/platform/providers/openaiProvider'
import { DEFAULT_AI_PROVIDER_ID, findAIProvider, getAIProvider } from '@/platform/providers/providerRegistry'
import type { ProviderMeta } from '@/platform/agent/types'
import type {
  AIConnectionTestResult,
  AIMessage,
  AISettings,
  OpenAIModelDiscoveryOptions,
  ProviderCallOptions,
  ProviderFetch,
  ProviderFetchOptions,
  ProviderResponseLike,
  ProviderStreamFn,
  ProviderStreamResult,
} from '@/platform/providers/types'

export type { AIConnectionTestResult, AIMessage, AISettings, ProviderCallOptions } from '@/platform/providers/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const _DEFAULT_PROXY_TIMEOUT_MS = 90000

const _localModelPulls = new Map<string, Promise<void>>()

function _isMissingLocalModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /isn't available on the Ollama server|model[^\n]{0,160}not found|try pulling it first|ollama pull/i.test(
    message,
  )
}

async function _pullConfiguredLocalModel(settings: AISettings, model: string): Promise<void> {
  const baseUrl = String(settings.ai_local_url || '').trim()
  if (!baseUrl || !model) throw new Error('Local Ollama model or server URL is not configured.')
  const key = `${baseUrl.replace(/\/$/, '').toLowerCase()}|${model.toLowerCase()}`
  let pending = _localModelPulls.get(key)
  if (!pending) {
    pending = pullLocalOllamaModel(baseUrl, model)
      .then(() => undefined)
      .finally(() => {
        _localModelPulls.delete(key)
      })
    _localModelPulls.set(key, pending)
  }
  await pending
}

interface ProxyResponsePayload {
  ok?: boolean
  status?: number
  statusText?: string
  data?: unknown
  text?: string
}

// ── Key resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the API key for a given provider.
 * Provider credentials are read only from Electron safeStorage.
 */
function resolveProviderKey(provider: unknown, settings: AISettings): string {
  const runtime = String(settings?.ai_runtime_api_key || '').trim()
  if (runtime) return runtime
  return getKey(String(provider || '').toLowerCase())
}

// ── Header conversion ─────────────────────────────────────────────────────────

function _toPlainHeaders(headersInput?: HeadersInit): Record<string, string> {
  if (!headersInput) return {}

  if (typeof Headers !== 'undefined' && headersInput instanceof Headers) {
    const _out: Record<string, string> = {}
    headersInput.forEach((value, key) => {
      _out[key] = value
    })
    return _out
  }

  if (Array.isArray(headersInput)) {
    const _out: Record<string, string> = {}
    for (const entry of headersInput) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      _out[String(entry[0])] = String(entry[1])
    }
    return _out
  }

  if (typeof headersInput === 'object') {
    return Object.fromEntries(
      Object.entries(headersInput)
        .filter(([key]) => Boolean(String(key || '').trim()))
        .map(([key, value]) => [String(key), String(value ?? '')]),
    )
  }

  return {}
}

// Wraps a bridge proxy payload in the response-like interface expected by provider adapters.
function _toProxyLikeResponse(proxyResult: unknown): ProviderResponseLike {
  const _p = proxyResult && typeof proxyResult === 'object' ? (proxyResult as ProxyResponsePayload) : {}
  return {
    ok: _p.ok === true,
    status: Number(_p.status) || 500,
    statusText: String(_p.statusText || ''),
    // Returns the proxied response body parsed as JSON.
    async json(): Promise<unknown> {
      if (_p.data !== undefined && _p.data !== null) return _p.data
      if (typeof _p.text === 'string' && _p.text.trim()) {
        try {
          return JSON.parse(_p.text) as unknown
        } catch {
          return {}
        }
      }
      return {}
    },
    // Returns the proxied response body as text.
    async text(): Promise<string> {
      if (typeof _p.text === 'string') return _p.text
      if (_p.data !== undefined && _p.data !== null) {
        try {
          return JSON.stringify(_p.data)
        } catch {
          return String(_p.data)
        }
      }
      return ''
    },
  }
}

// ── Fetch with proxy fallback ─────────────────────────────────────────────────

// Transient statuses worth retrying (rate limits + overloaded/5xx). Client errors
// (400/401/403/404) are surfaced immediately — retrying won't help them.
const _RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529])
const _MAX_FETCH_RETRIES = 3
const _sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Calculates bounded retry backoff for transient provider failures.
function _retryBackoffMs(attempt: number): number {
  // Exponential backoff with full jitter, capped at 8s.
  const base = Math.min(8000, 500 * 2 ** attempt)
  return Math.round(base / 2 + Math.random() * (base / 2))
}

function _isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError',
  )
}

/**
 * Public entry point: retries the direct→proxy attempt on transient failures
 * (a network throw or a retryable status) with jittered exponential backoff.
 * Successful and client-error responses return immediately.
 */
export async function fetchWithBridgeFallback(
  url: string,
  init: RequestInit = {},
  options: ProviderFetchOptions = {},
): Promise<ProviderResponseLike> {
  const { timeoutMs = _DEFAULT_PROXY_TIMEOUT_MS, provider } = options
  let _lastRes: ProviderResponseLike | undefined
  for (let _attempt = 0; _attempt <= _MAX_FETCH_RETRIES; _attempt += 1) {
    try {
      const _res = await _attemptFetchWithBridge(url, init, {
        timeoutMs,
        provider,
      })
      if (_res?.ok) return _res
      _lastRes = _res
      if (!_RETRYABLE_STATUSES.has(Number(_res?.status)) || _attempt === _MAX_FETCH_RETRIES) {
        return _res
      }
    } catch (_err) {
      // A user-initiated abort must propagate immediately — never retry it.
      if (_isAbortError(_err) || init?.signal?.aborted) throw _err
      if (_attempt === _MAX_FETCH_RETRIES) throw _err
    }
    await _sleep(_retryBackoffMs(_attempt))
  }
  return _lastRes as ProviderResponseLike
}

/**
 * _attemptFetchWithBridge — one direct→proxy attempt.
 *
 * Strategy:
 *  1. Try a direct browser fetch.
 *  2. If the direct response is ok (2xx) → return it immediately.
 *  3. Otherwise (threw OR returned non-ok) → route through the local proxy.
 *     This handles Anthropic's browser-blocking 403 (doesn't throw, returns a
 *     non-ok response with CORS headers), as well as CORS throws from other
 *     providers.
 *  4. If the proxy also fails and we had a direct non-ok response → return it
 *     so the caller surfaces the real API error (e.g. 401 wrong key).
 *  5. If neither worked at all → throw a combined error.
 */
async function _attemptFetchWithBridge(
  url: string,
  init: RequestInit = {},
  { timeoutMs = _DEFAULT_PROXY_TIMEOUT_MS, provider }: ProviderFetchOptions = {},
): Promise<ProviderResponseLike> {
  let _directRes: Response | undefined
  let _directErr: unknown

  try {
    _directRes = await fetch(url, init)
  } catch (err) {
    _directErr = err
  }

  // A user-initiated abort must propagate — don't silently retry via the proxy.
  if (_isAbortError(_directErr) || init?.signal?.aborted) {
    throw _directErr || new DOMException('Aborted', 'AbortError')
  }

  // Fast path — direct fetch succeeded cleanly
  if (_directRes?.ok) return _directRes

  // Slow path — direct failed (threw or returned non-ok); route through the local proxy
  try {
    const _proxied = await proxyAIRequest({
      url,
      method: init?.method || 'GET',
      headers: _toPlainHeaders(init?.headers),
      body: init?.body ?? null,
      timeoutMs,
      signal: init?.signal ?? undefined,
      provider,
    })
    return _toProxyLikeResponse(_proxied)
  } catch (_proxyErr) {
    // Proxy also failed — if we have a non-ok direct response, return it so the
    // caller can surface the real API error (e.g. 401 wrong key after a fresh save)
    if (_directRes) return _directRes
    throw new Error(
      `${getErrorMessage(_directErr, 'Failed to fetch')} (proxy fallback failed: ${getErrorMessage(_proxyErr, 'unknown error')})`,
    )
  }
}

// ── Streaming fetch (direct → bridge SSE proxy) ───────────────────────────────

/**
 * Stream an AI request, invoking onChunk(textChunk) as bytes arrive. Tries a
 * direct streaming fetch first (local / CORS-friendly endpoints); on CORS/non-ok
 * it falls back to the bridge streaming proxy (cloud providers). Returns
 * { ok, status } when the stream completes.
 */
export async function fetchAIStream(
  url: string,
  init: RequestInit = {},
  onChunk?: (chunk: string) => void,
  { timeoutMs = _DEFAULT_PROXY_TIMEOUT_MS, provider }: ProviderFetchOptions = {},
): Promise<ProviderStreamResult> {
  try {
    const res = await fetch(url, init)
    if (res.ok && res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && typeof onChunk === 'function') {
          onChunk(decoder.decode(value, { stream: true }))
        }
      }
      return { ok: true, status: res.status }
    }
  } catch (err) {
    // A user-initiated abort must propagate — don't start a fresh proxy stream.
    if (_isAbortError(err) || init?.signal?.aborted) throw err
    /* otherwise CORS / network failure → bridge proxy fallback */
  }

  return proxyAIStream(
    {
      url,
      method: init?.method || 'POST',
      headers: _toPlainHeaders(init?.headers),
      body: init?.body ?? null,
      timeoutMs,
      signal: init?.signal ?? undefined,
      provider,
    },
    onChunk,
  )
}

// ── Model listing (re-exported with bound fetchFn) ────────────────────────────

export async function listOpenAICompatibleModels(options: OpenAIModelDiscoveryOptions): Promise<string[]> {
  return _listModels(options, fetchWithBridgeFallback)
}

/**
 * Discover the models a given provider key (or local server) can access.
 * Returns a sorted string[] of model ids, or [] if discovery isn't possible.
 * Never throws — a failed discovery simply yields [].
 */
export async function discoverModelsForProvider(
  provider: unknown,
  settings: AISettings,
  keyId?: unknown,
): Promise<string[]> {
  const _registration = findAIProvider(provider)
  if (!_registration) return []

  try {
    const providerFetch: ProviderFetch = (url, init = {}, options = {}) =>
      fetchWithBridgeFallback(url, init, {
        ...options,
        provider: _registration.id,
      })
    // Detect with the SPECIFIC key slot when one is given (so the Agents UI lists the models that
    // key can see); otherwise the provider's primary key.
    const apiKey = keyId
      ? getKey(_registration.id, keyId) || resolveProviderKey(_registration.id, settings)
      : resolveProviderKey(_registration.id, settings)
    return await _registration.discoverModels({
      settings,
      apiKey,
      fetchFn: providerFetch,
    })
  } catch {
    return []
  }
}

// ── Provider routing ──────────────────────────────────────────────────────────

export async function callAIWithMeta(
  messages: readonly AIMessage[],
  settings: AISettings,
  options: ProviderCallOptions = {},
): Promise<ProviderMeta> {
  const _settings = enforceLocalOnlyProvider(settings)
  const { ai_provider, ai_model } = _settings
  const _apiKey = resolveProviderKey(ai_provider, _settings)

  // Every remote inference made during an agent turn shares one runtime safety budget. Health
  // discovery and connection tests do not carry this state, so they never consume inference budget.
  const _cloudState = getCloudUsageState(_settings)
  if (isCloudProvider(ai_provider) && _cloudState) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const requestNumber = consumeCloudRequest(_cloudState, options.cloudPurpose || 'agent')
    try {
      logAI(`cloud budget ${requestNumber}/${_cloudState.max}`, {
        provider: ai_provider,
        model: ai_model || '',
        purpose: options.cloudPurpose || 'agent',
      })
    } catch {
      /* non-fatal */
    }
  }

  // An optional AbortSignal (e.g. the chat Stop button) is woven into every
  // request `init` so the in-flight call — direct, proxied, or streaming — is
  // genuinely cancellable, not just checked between agent steps.
  const _signal = options.signal
  // Invokes the selected provider through the normal request path for this model call.
  const _fetch: ProviderFetch = (url, init = {}, opts = {}) =>
    fetchWithBridgeFallback(url, { ...init, signal: init?.signal ?? _signal }, { ...opts, provider: ai_provider })

  let _options = options

  // When the runtime requests token streaming (options.onToken for answer text,
  // options.onThinkingToken for reasoning), hand adapters the streaming fetch so
  // they can stream the response instead of buffering it.
  if ((_options.onToken || _options.onThinkingToken || _options.onToolCall) && !_options.streamFn) {
    // Invokes the selected provider through the streaming request path for this model call.
    const _stream: ProviderStreamFn = (url, init, onStreamChunk, opts = {}) =>
      fetchAIStream(url, { ...init, signal: init?.signal ?? _signal }, onStreamChunk, {
        ...opts,
        provider: ai_provider,
      })
    _options = { ..._options, streamFn: _stream }
  }

  // Thread settings through options so every adapter (OpenAI-compatible, Gemini)
  // can honor the `agent_max_output_tokens` heavy-work cap — Anthropic already
  // takes settings as its own parameter.
  _options = { ..._options, settings: _settings }

  // Passive activity logging — record every AI API request + its outcome into the
  // session log without altering routing, timing, or the returned promise.
  const _startedAt = Date.now()
  try {
    logAI(`request → ${ai_provider}/${ai_model || ''}`, {
      messages: Array.isArray(messages) ? messages.length : 0,
      tools: Array.isArray(_options.tools) ? _options.tools.length : 0,
      streaming: Boolean(_options.onToken || _options.onThinkingToken),
    })
  } catch {
    /* non-fatal */
  }

  // Registry handlers are deliberately thin: provider-specific request,
  // streaming, and response logic remains in each existing adapter file.
  const _registration = getAIProvider(ai_provider)
  const _model = String(ai_model || _registration.defaultModel)
  const _invoke = () =>
    _registration.invoke({
      messages,
      settings: _settings,
      apiKey: _apiKey,
      model: _model,
      fetchFn: _fetch,
      options: _options,
    })

  let _dispatch = Promise.resolve().then(_invoke)
  if (String(ai_provider || '').toLowerCase() === 'local') {
    _dispatch = _dispatch.catch(async (error) => {
      if (!_isMissingLocalModelError(error)) throw error
      if (_signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      try {
        logAI(`pulling configured local model → ${_model}`)
      } catch {
        /* non-fatal */
      }
      await _pullConfiguredLocalModel(_settings, _model)
      if (_signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return _invoke()
    })
  }

  _dispatch.then(
    (meta) => {
      try {
        logAI(`response ← ${ai_provider}/${ai_model || ''}`, {
          ms: Date.now() - _startedAt,
          toolCalls: Array.isArray(meta?.toolCalls) ? meta.toolCalls.length : 0,
          stopReason: meta?.stopReason || '',
          promptTokens: meta?.usage?.promptTokens,
          completionTokens: meta?.usage?.completionTokens,
          totalMs: meta?.timings?.totalMs,
          loadMs: meta?.timings?.loadMs,
          promptEvalMs: meta?.timings?.promptEvalMs,
          firstThinkingMs: meta?.timings?.firstThinkingMs,
          firstAnswerMs: meta?.timings?.firstAnswerMs,
          thinkingStreamMs: meta?.timings?.thinkingStreamMs,
          answerStreamMs: meta?.timings?.answerStreamMs,
        })
      } catch {
        /* non-fatal */
      }
    },
    (err: unknown) => {
      try {
        logError('ai', `error ${ai_provider}/${ai_model || ''}`, {
          ms: Date.now() - _startedAt,
          error: err instanceof Error ? err.message : String(err),
        })
      } catch {
        /* non-fatal */
      }
    },
  )

  return _dispatch
}

// Invokes AI and converts the response into the application's provider-neutral shape.
export async function callAI(messages: readonly AIMessage[], settings: AISettings): Promise<string> {
  const _meta = await callAIWithMeta(messages, settings)
  return String(_meta?.text || '')
}

// ── Connection test ───────────────────────────────────────────────────────────

/**
 * Test a provider connection. The contract (per product spec):
 *  - Verify the KEY / endpoint works, and report which models it can access.
 *  - NEVER fail just because the currently-selected model isn't accessible —
 *    that's surfaced as a soft warning; access errors for a specific model are
 *    raised at chat time instead.
 *
 * Strategy: discover models first. A successful discovery proves the key works,
 * so we report success without a live completion (which could 404 on a model the
 * key lacks). Only when discovery yields nothing (e.g. an endpoint without a
 * model list) do we fall back to a live call to confirm connectivity.
 */
export async function testConnection(settings: AISettings, keyId: unknown = '1'): Promise<AIConnectionTestResult> {
  const _provider = String(settings?.ai_provider || DEFAULT_AI_PROVIDER_ID).toLowerCase()
  const _selectedModel = String(settings?.ai_model || '').trim()

  let _availableModels: string[] = []

  try {
    const _specificKey = getKey(_provider, keyId)
    const _testSettings = _specificKey ? { ...settings, ai_runtime_api_key: _specificKey } : settings
    _availableModels = await discoverModelsForProvider(_provider, _testSettings, keyId)

    if (_availableModels.length > 0) {
      const _mismatch = _selectedModel && !_availableModels.includes(_selectedModel)
      // Listing models proves a hosted KEY works, but for a LOCAL server it does NOT prove the
      // SELECTED model can actually run a chat (wrong tag, not pulled, no VRAM). Local calls are
      // free, so verify the real /chat path here — otherwise the test shows green and the failure
      // only surfaces later in chat ("can't connect"). Confirmed: this was the test/runtime gap.
      if (_provider === 'local' && _selectedModel) {
        try {
          const _live = await callAI([{ role: 'user', content: 'Reply with OK only.' }], settings)
          const _liveOk = typeof _live === 'string' ? _live.trim().length > 0 : Boolean(_live)
          return {
            ok: _liveOk,
            models: _availableModels,
            message: _liveOk
              ? `Connected — "${_selectedModel}" responded. ${_availableModels.length} models available.`
              : `Server reachable but "${_selectedModel}" returned an empty response — try another model.`,
          }
        } catch (liveErr) {
          return {
            ok: false,
            models: _availableModels,
            message: `Server reachable (${_availableModels.length} models) but "${_selectedModel}" failed: ${getErrorMessage(liveErr, 'chat call failed')}`,
          }
        }
      }
      return {
        ok: true,
        models: _availableModels,
        message: _mismatch
          ? `Connected. ${_availableModels.length} models available — your selected "${_selectedModel}" isn't in the list, but you can still try it (errors will show in chat).`
          : `Connected. ${_availableModels.length} models available for this key.`,
      }
    }

    // No model list available — verify connectivity with a minimal live call.
    const _response = await callAI([{ role: 'user', content: 'Reply with OK only.' }], _testSettings)
    const _isOk = typeof _response === 'string' ? _response.trim().length > 0 : Boolean(_response)

    return {
      ok: _isOk,
      models: _availableModels,
      message: _isOk
        ? 'Connection succeeded (model list not exposed by this provider).'
        : 'Connection established but received an empty response.',
    }
  } catch (err) {
    return {
      ok: false,
      models: _availableModels,
      message: getErrorMessage(err, 'Connection test failed.'),
    }
  }
}
