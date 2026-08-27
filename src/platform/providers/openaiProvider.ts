/**
 * Local OpenAI-compatible wire-format helpers.
 *
 * This file no longer implements or invokes OpenAI cloud services. It only retains the two
 * normalization helpers used by local servers that expose an OpenAI-compatible HTTP endpoint.
 * Phase B can rename this module once the remaining local-provider import is cleaned up.
 */
import { contentToText, normalizeContentToArray, normalizeUsage, parseToolArguments, toMetaResponse } from '@/platform/providers/providerUtils'
import { decodeToolName, encodeToolName } from '@/platform/agent/toolSchema'
import type { ProviderMeta } from '@/platform/agent/types'
import type { AIMessage } from '@/platform/providers/types'

interface LocalCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string
      reasoning_content?: string
      reasoning?: string
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  usage?: Parameters<typeof normalizeUsage>[0]
}

export function normalizeOpenAIMessages(messages: readonly AIMessage[]): Array<Record<string, unknown>> {
  const normalized: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool' && Array.isArray(message.toolResults)) {
      for (const result of message.toolResults) {
        normalized.push({ role: 'tool', tool_call_id: result.id, content: String(result.content ?? '') })
      }
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      normalized.push({
        role: 'assistant',
        content: (typeof message.content === 'string' ? message.content : contentToText(message.content)) || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: { name: encodeToolName(toolCall.name), arguments: JSON.stringify(toolCall.args || {}) },
        })),
      })
      continue
    }
    normalized.push({ role: message.role, content: normalizeContentToArray(message.content) })
  }
  return normalized
}

export function parseOpenAIChatResponse(data: LocalCompatibleResponse, providerLabel: string, model: string): ProviderMeta {
  const message = data?.choices?.[0]?.message || {}
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter((toolCall) => Boolean(toolCall?.function?.name))
        .map((toolCall) => {
          const parsed = parseToolArguments(toolCall.function?.arguments)
          return {
            id: String(toolCall.id || ''),
            name: decodeToolName(toolCall.function?.name),
            args: parsed.args,
            argsError: parsed.argsError,
            rawArgs: parsed.rawArgs,
          }
        })
    : []
  return toMetaResponse({
    provider: providerLabel,
    model,
    text: message.content || '',
    usage: normalizeUsage(data?.usage),
    toolCalls,
    stopReason: data?.choices?.[0]?.finish_reason || '',
    thinkingText:
      (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
      (typeof message.reasoning === 'string' && message.reasoning) ||
      '',
  })
}
