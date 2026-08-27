/**
 * Local Qwen agent transport.
 *
 * The coding runtime talks to one local OpenAI-compatible inference endpoint (llama.cpp,
 * vLLM, SGLang, or an equivalent local server). Qwen owns tool selection and emits native
 * tool_calls; this adapter only translates messages and normalizes the server response.
 */
import { decodeToolName, encodeToolName, toOpenAITools } from '@/platform/agent/toolSchema'
import type { ToolCall } from '@/platform/agent/types'
import {
  contentToText,
  normalizeContentToArray,
  normalizeUsage,
  parseToolArguments,
  toMetaResponse,
} from '@/platform/providers/providerUtils'
import type { AIMessage, ProviderCallOptions, ProviderFetch } from '@/platform/providers/types'

function endpointRoot(baseUrl: string) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/$/, '')
    .replace(/\/v1$/i, '')
    .replace(/(^https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1')
}

function normalizeMessages(messages: readonly AIMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool' && Array.isArray(message.toolResults)) {
      for (const result of message.toolResults) {
        output.push({
          role: 'tool',
          tool_call_id: result.id,
          name: encodeToolName(result.name),
          content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content ?? null),
        })
      }
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      output.push({
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : contentToText(message.content) || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: encodeToolName(call.name),
            arguments: JSON.stringify(call.args || {}),
          },
        })),
        ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      })
      continue
    }
    output.push({ role: message.role, content: normalizeContentToArray(message.content) })
  }
  return output
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => Boolean(entry?.function?.name))
    .map((entry, index) => {
      const parsed =
        entry?.function?.arguments && typeof entry.function.arguments === 'object'
          ? { args: entry.function.arguments as Record<string, unknown>, argsError: false, rawArgs: '' }
          : parseToolArguments(entry?.function?.arguments)
      return {
        id: String(entry?.id || `tool-${index + 1}`),
        name: decodeToolName(entry.function.name),
        args: parsed.args,
        argsError: parsed.argsError,
        rawArgs: parsed.rawArgs,
      }
    })
}

export async function callLocalLLM(
  messages: readonly AIMessage[],
  baseUrl: string,
  model: string,
  fetchFn: ProviderFetch,
  options: ProviderCallOptions = {},
) {
  const root = endpointRoot(baseUrl)
  if (!root) throw new Error('Local model server URL is not configured.')

  const tools = Array.isArray(options.tools) && options.tools.length ? toOpenAITools(options.tools) : []
  const body: Record<string, unknown> = {
    model,
    messages: normalizeMessages(messages),
    stream: false,
  }
  if (tools.length) {
    body.tools = tools
    body.tool_choice = options.toolChoice || 'auto'
    body.parallel_tool_calls = true
  }

  const response = await fetchFn(
    `${root}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    },
    { provider: 'local' },
  )

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    let detail = raw.slice(0, 500)
    try {
      const parsed = JSON.parse(raw)
      detail = String(parsed?.error?.message || parsed?.error || detail)
    } catch {
      // Keep bounded response text.
    }
    throw new Error(`Local Qwen server request failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  const data: any = await response.json()
  const choice = data?.choices?.[0] || {}
  const message = choice?.message || {}
  const text = typeof message.content === 'string' ? message.content : contentToText(message.content)
  const toolCalls = normalizeToolCalls(message.tool_calls)
  const thinking = String(message.reasoning_content || message.reasoning || '')

  if (text) options.onToken?.(text)
  if (thinking) options.onThinkingToken?.(thinking)

  return toMetaResponse({
    provider: 'Local Qwen',
    model,
    text: text || '',
    usage: normalizeUsage(data?.usage),
    toolCalls,
    stopReason: String(choice?.finish_reason || ''),
    thinkingText: thinking,
  })
}

export async function listLocalModels(baseUrl: string, fetchFn: ProviderFetch): Promise<string[]> {
  const root = endpointRoot(baseUrl)
  if (!root) return []
  try {
    const response = await fetchFn(`${root}/v1/models`, { method: 'GET' }, { provider: 'local' })
    if (!response.ok) return []
    const data: any = await response.json().catch(() => ({}))
    const models = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
    return models
      .map((entry: any) => String(entry?.id || entry?.name || '').trim())
      .filter(Boolean)
      .sort((left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  } catch {
    return []
  }
}
