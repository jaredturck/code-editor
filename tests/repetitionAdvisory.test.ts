import { beforeEach, describe, expect, it } from 'vitest'
import {
  recordAgentEvidence,
  resetRepetitionAdvisoryForTests,
  terminalCommandLikelyMutatesSource,
} from '../src/platform/agent/repetitionAdvisory'

describe('agent repetition advisory', () => {
  beforeEach(() => {
    resetRepetitionAdvisoryForTests()
  })

  it('advises after equivalent verification repeats without blocking the action', () => {
    const first = recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'terminal.exec',
      args: { command: 'cd /project && npm run build 2>&1 | tail -20' },
    })
    const second = recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'terminal.exec',
      args: { command: 'npm run build' },
    })

    expect(first).toBe('')
    expect(second).toContain('REPETITION ADVISORY (non-blocking)')
    expect(second).toContain('build verification')
  })

  it('resets repeated evidence after a meaningful workspace mutation', () => {
    recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'terminal.exec',
      args: { command: 'npm run build' },
    })
    recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'files.edit',
      args: { path: '/project/src/App.jsx' },
      workspace_mutated: true,
    })

    const after_mutation = recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'terminal.exec',
      args: { command: 'npm run build' },
    })

    expect(after_mutation).toBe('')
  })

  it('treats localhost port changes as equivalent browser evidence', () => {
    recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'browser.inspect',
      args: { url: 'http://localhost:5174/' },
    })
    const repeated = recordAgentEvidence({
      scope_id: '/project::chat-1',
      tool_name: 'browser.inspect',
      args: { url: 'http://localhost:5177/' },
    })

    expect(repeated).toContain('browser runtime inspection')
  })

  it('distinguishes source-changing terminal commands from verification commands', () => {
    expect(terminalCommandLikelyMutatesSource('npm run build')).toBe(false)
    expect(terminalCommandLikelyMutatesSource('npx prettier --write src/App.jsx')).toBe(true)
    expect(terminalCommandLikelyMutatesSource('npm install tailwindcss')).toBe(true)
  })
})
