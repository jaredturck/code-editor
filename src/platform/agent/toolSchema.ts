/**
 * Converts the canonical tool catalog into the request formats expected by Anthropic,
 * OpenAI-compatible, and Gemini providers. It also encodes and decodes tool names where
 * provider naming rules cannot represent IRIS's dotted names directly.
 */

import type { JsonSchemaTool } from '@/platform/agent/types'
import type { ToolDefinition } from '@/platform/agent/toolCatalog'

export interface JsonSchemaObject {
  type: string
  description?: string
  items?: JsonSchemaObject
  properties?: Record<string, JsonSchemaObject>
  required?: string[]
  additionalProperties?: boolean
}

type ToolHint = string | Record<string, unknown>

// Converts a compact tool hint into a provider-neutral JSON schema fragment.
function hintToSchema(hint: unknown): JsonSchemaObject {
  if (hint && typeof hint === 'object' && !Array.isArray(hint)) {
    return objectHintToSchema(hint as Record<string, unknown>)
  }

  const raw = String(hint || '')
  const normalized = raw.toLowerCase()
  let type = 'string'

  if (/\bboolean\b/.test(normalized)) type = 'boolean'
  else if (/string\s*\[\]|\[\]|\barray\b/.test(normalized)) type = 'array'
  else if (/\bnumber\b|\binteger\b/.test(normalized)) type = 'number'
  else if (/\bobject\b/.test(normalized)) type = 'object'

  const schema: JsonSchemaObject = { type, description: raw }
  if (type === 'array') schema.items = { type: 'string' }
  if (type === 'object') {
    schema.properties = {}
    schema.additionalProperties = true
  }
  return schema
}

// Converts an object-shaped tool hint into a JSON schema object definition.
function objectHintToSchema(argsObject: Record<string, unknown>): JsonSchemaObject {
  const properties: Record<string, JsonSchemaObject> = {}
  const required: string[] = []

  for (const [key, hint] of Object.entries(argsObject)) {
    properties[key] = hintToSchema(hint as ToolHint)
    const hintText = typeof hint === 'string' ? hint.toLowerCase() : ''
    if (typeof hint === 'string' && !/optional/.test(hintText)) required.push(key)
  }

  return { type: 'object', properties, required, additionalProperties: false }
}

// Builds the canonical JSON schema exposed for one tool definition.
export function toolDefinitionToJsonSchema(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'args'> | null | undefined,
): JsonSchemaTool {
  const hasArgs = Boolean(tool?.args && Object.keys(tool.args).length > 0)
  const parameters = hasArgs ? objectHintToSchema(tool?.args ?? {}) : { type: 'object', properties: {}, required: [] }

  return {
    name: String(tool?.name || ''),
    description: String(tool?.description || ''),
    parameters: parameters as unknown as Record<string, unknown>,
  }
}

// Assembles JSON schema tools from lower-level state so callers receive one consistent
// representation.
export function buildJsonSchemaTools(
  toolDefinitions: readonly Pick<ToolDefinition, 'name' | 'description' | 'args'>[] | null | undefined,
): JsonSchemaTool[] {
  return (Array.isArray(toolDefinitions) ? toolDefinitions : [])
    .filter((tool): tool is Pick<ToolDefinition, 'name' | 'description' | 'args'> => Boolean(tool?.name))
    .map(toolDefinitionToJsonSchema)
}

// Encodes tool name for the provider or persistence boundary.
export function encodeToolName(name: unknown): string {
  return String(name || '').replace(/\./g, '__')
}

// Decodes tool name into the representation consumed by the agent tool and policy layer.
export function decodeToolName(name: unknown): string {
  return String(name || '').replace(/__/g, '.')
}

export interface AnthropicToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface OpenAIToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface GeminiToolDefinition {
  functionDeclarations: Array<{
    name: string
    description: string
    parameters?: Record<string, unknown>
  }>
}

// Sanitizes Gemini schema before it is logged, displayed, or passed across a trust boundary.
function sanitizeGeminiSchema(schema: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  const { additionalProperties: _additionalProperties, _drop, ...rest } = schema as Record<string, unknown>
  const out: Record<string, unknown> = { ...rest }

  if (out.properties && typeof out.properties === 'object') {
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(out.properties as Record<string, unknown>)) {
      cleaned[key] = sanitizeGeminiSchema(value as Record<string, unknown>) ?? {
        type: 'string',
      }
    }
    out.properties = cleaned
  }
  if (out.items) out.items = sanitizeGeminiSchema(out.items as Record<string, unknown>)

  // Object schema with no properties - Gemini rejects it and drops the parameters
  if (out.type === 'object' && (!out.properties || Object.keys(out.properties as object).length === 0)) {
    return undefined
  }
  return out
}

// Converts canonical tool definitions into Anthropic tool declarations.
export function toAnthropicTools(jsonTools: readonly JsonSchemaTool[] = []): AnthropicToolDefinition[] {
  return jsonTools.map((tool) => ({
    name: encodeToolName(tool.name),
    description: tool.description,
    input_schema: tool.parameters,
  }))
}

// Converts canonical tool definitions into OpenAI-compatible function tools.
export function toOpenAITools(jsonTools: readonly JsonSchemaTool[] = []): OpenAIToolDefinition[] {
  return jsonTools.map((tool) => ({
    type: 'function',
    function: {
      name: encodeToolName(tool.name),
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

// Converts canonical tool definitions into Gemini function declarations.
export function toGeminiTools(jsonTools: readonly JsonSchemaTool[] = []): GeminiToolDefinition[] {
  return [
    {
      functionDeclarations: jsonTools.map((tool) => {
        const parameters = sanitizeGeminiSchema(tool.parameters as Record<string, unknown>)
        const decl: {
          name: string
          description: string
          parameters?: Record<string, unknown>
        } = {
          name: encodeToolName(tool.name),
          description: tool.description,
        }
        if (parameters) decl.parameters = parameters
        return decl
      }),
    },
  ]
}
