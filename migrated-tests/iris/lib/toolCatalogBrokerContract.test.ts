/**
 * Contract guard (audit C-03): every tool advertised in the canonical catalog must have a
 * live execution path. The catalog is the single source the model is told about; a catalog
 * entry with no broker/sub-agent handler would let the model call a tool that silently fails.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getToolDefinitions } from '@/platform/agent/toolCatalog'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('tool catalog ↔ broker contract', () => {
  it('every catalog tool has a handler reference in the broker or sub-agent runtime', () => {
    const dispatch =
      read('src/platform/agent/runtime/toolBroker.ts') + '\n' + read('src/platform/subAgentRuntime.ts')

    const names = getToolDefinitions().map((tool) => tool.name)
    expect(names.length).toBeGreaterThan(0)

    const missing = names.filter((name) => !dispatch.includes(`'${name}'`) && !dispatch.includes(`"${name}"`))
    expect(missing, `catalog tools without a dispatch handler: ${missing.join(', ')}`).toEqual([])
  })

  it('keeps the generic missing-handler fallback after all concrete broker handlers', () => {
    const broker = read('src/platform/agent/runtime/toolBroker.ts')
    const fallback = broker.lastIndexOf('Tool handler not implemented: ${toolName}')
    const lastSingleQuotedHandler = broker.lastIndexOf("if (toolName === '")
    const lastDoubleQuotedHandler = broker.lastIndexOf('if (toolName === "')
    const lastHandler = Math.max(lastSingleQuotedHandler, lastDoubleQuotedHandler)

    expect(fallback).toBeGreaterThan(-1)
    expect(lastHandler).toBeGreaterThan(-1)
    expect(fallback, 'generic fallback must not make later handlers unreachable').toBeGreaterThan(lastHandler)
  })

  it('catalog tool names are unique', () => {
    const names = getToolDefinitions().map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
