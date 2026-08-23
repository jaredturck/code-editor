/** Verifies the extracted agent-runtime helpers preserve their former request and parsing contracts. */

import { describe, expect, it } from 'vitest'
import { attachSessionFilesToMessages, buildAgentRequestSettings } from '../../src/lib/agent/runtime/sessionRunner'
import { buildSubAgentModelMessages, parseSubAgentModelJson } from '../../src/lib/subAgentRuntime'

const stp = {
  output: { schema: { type: 'object', required: ['answer'] } },
} as any

describe('agent runtime modular helpers', () => {
  it('merges per-call settings after the session reasoning configuration', () => {
    expect(
      buildAgentRequestSettings({ ai_model: 'session-model', extended_thinking: true }, { ai_model: 'override-model' }),
    ).toMatchObject({ ai_model: 'override-model', extended_thinking: true })
  })

  it('attaches text and image files only to the latest user message', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]
    const result = attachSessionFilesToMessages(messages, {
      attached_files: [
        { name: 'notes.txt', type: 'text/plain', content: 'hello' },
        { name: 'image.png', type: 'image/png', content: 'abc123' },
      ],
    })

    expect(result[0]).toEqual(messages[0])
    expect(result[1]).toEqual(messages[1])
    expect(result[2].content).toEqual([
      { type: 'text', text: '[Attached file: notes.txt]\nhello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      { type: 'text', text: 'second' },
    ])
  })
})

describe('sub-agent runtime modular helpers', () => {
  it('builds the same system and user thread for explicit step output', () => {
    expect(buildSubAgentModelMessages(stp, 'system prompt', 'step output')).toEqual([
      { role: 'system', content: 'system prompt' },
      {
        role: 'user',
        content: 'STEP RESULTS:\nstep output\n\nNow produce the output JSON matching the schema.',
      },
    ])
  })

  it('recovers JSON from fenced or prose-wrapped model output', () => {
    expect(parseSubAgentModelJson('```json\n{"answer":"ok"}\n```')).toEqual({
      answer: 'ok',
    })
    expect(parseSubAgentModelJson('Result follows: {"answer":"ok"} thanks')).toEqual({
      answer: 'ok',
    })
    expect(parseSubAgentModelJson('not json')).toBeNull()
  })
})
