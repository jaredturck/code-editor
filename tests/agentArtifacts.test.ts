import { describe, expect, it } from 'vitest'
import {
  appendArtifactLinks,
  withAutonomousArtifactCapability,
  type AgentSessionInput,
} from '../src/platform/agentRuntime'

function session_input(): AgentSessionInput {
  return {
    userInput: 'Analyze this project and write an architecture report.',
    conversation: [],
    settings: {
      chat_session: { id: 'chat-1' },
      agent_working_dir: '/workspace',
      agent_tool_allowlist: ['files.read', 'rag.retrieve'],
    },
  }
}

describe('autonomous artifact capability', () => {
  it('adds durable artifact creation without removing the existing autonomous tool scope', () => {
    const prepared = withAutonomousArtifactCapability(session_input())
    expect(prepared.settings.agent_tool_allowlist).toEqual(['files.read', 'rag.retrieve', 'artifact.create'])
    expect(prepared.userInput).toContain('research reports')
    expect(prepared.userInput).toContain('append additional chunks')
  })

  it('does not expose artifact creation when there is no persisted chat session', () => {
    const input = session_input()
    input.settings = { ...input.settings, chat_session: null }
    expect(withAutonomousArtifactCapability(input)).toBe(input)
  })

  it('attaches stable encrypted-artifact links to the final assistant reply', () => {
    const reply = appendArtifactLinks('Report complete.', [
      { artifactId: 'artifact-123', filename: 'test-report.md' },
      { artifactId: 'artifact-123', filename: 'test-report.md' },
      { artifactRef: '/artifacts/artifact-456', filename: 'architecture.md' },
    ])

    expect(reply).toContain('### Durable artifacts')
    expect(reply).toContain('[test-report.md](artifact:artifact-123)')
    expect(reply).toContain('[architecture.md](/artifacts/artifact-456)')
    expect(reply.match(/test-report\.md/g)).toHaveLength(1)
  })
})
