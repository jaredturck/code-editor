/**
 * Exercises the observable agent runtime definitions contract, with regression cases for
 * “returns a defensive copy of the advertised tool catalog” and “advertises unique
 * canonical names with descriptions and argument schemas”. The suite documents
 * caller-visible behavior so implementation refactors cannot silently weaken those
 * guarantees.
 */

import { describe, expect, it } from 'vitest'
import { getAgentToolDefinitions } from '@/platform/agentRuntime'

describe('agentRuntime tool definitions', () => {
  it('returns a defensive copy of the advertised tool catalog', () => {
    const first = getAgentToolDefinitions()
    const second = getAgentToolDefinitions()
    expect(first).not.toBe(second)
    first.pop()
    expect(getAgentToolDefinitions()).toHaveLength(second.length)
  })

  it('advertises unique canonical names with descriptions and argument schemas', () => {
    const definitions = getAgentToolDefinitions()
    const names = definitions.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect(definitions.length).toBeGreaterThanOrEqual(40)

    for (const tool of definitions) {
      expect(tool.name).toMatch(/^[a-z]+\.[A-Za-z]+$/)
      expect(tool.module).toEqual(expect.any(String))
      expect(tool.description).toEqual(expect.any(String))
      expect(tool.args).toEqual(expect.any(Object))
    }
  })

  it('contains the central file, terminal, search, memory, skill, and agent tools', () => {
    const names = new Set(getAgentToolDefinitions().map((tool) => tool.name))
    for (const name of [
      'files.list',
      'files.find',
      'files.read',
      'files.write',
      'terminal.exec',
      'search.web',
      'memory.query',
      'skills.list',
      'approval.request',
      'todo.update',
      'agent.delegate',
      'agent.recall',
      'agent.verify',
    ]) {
      expect(names.has(name), `missing ${name}`).toBe(true)
    }
  })
})
