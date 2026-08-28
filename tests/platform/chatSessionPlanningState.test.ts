import { beforeEach, describe, expect, it } from 'vitest'
import { getChatSessionState, saveChatSessionState } from '@/platform/chatSessionStore'
import { initializeStorageForTests } from '@/platform/localStorageStore'

const CHAT_ID = 'planning-state-test'

beforeEach(() => {
  initializeStorageForTests()
})

describe('chat session planning state', () => {
  it('persists completed project planning with the session', () => {
    const projectPlanning = {
      goal: 'Build the project',
      artifacts: [
        { id: 'ideas', label: 'Exploring ideas', content: 'Several directions.' },
        { id: 'expand', label: 'Developing ideas', content: 'Expanded directions.' },
        { id: 'direction', label: 'Choosing direction', content: 'Chosen direction.' },
        { id: 'plan', label: 'Planning implementation', content: 'Implementation plan.' },
      ],
      context: '[PROJECT PLANNING]\nImplementation plan.\n[END PROJECT PLANNING]',
      completedAt: 100,
    }

    saveChatSessionState(CHAT_ID, { projectPlanning })

    expect(getChatSessionState(CHAT_ID)?.projectPlanning).toEqual(projectPlanning)
  })

  it('preserves planning when unrelated session state changes', () => {
    const projectPlanning = {
      goal: 'Build the project',
      artifacts: [{ id: 'plan', label: 'Planning implementation', content: 'Implementation plan.' }],
      context: '[PROJECT PLANNING]',
      completedAt: 100,
    }

    saveChatSessionState(CHAT_ID, { projectPlanning })
    saveChatSessionState(CHAT_ID, { todos: [{ id: '1', text: 'Continue implementation' }] })

    expect(getChatSessionState(CHAT_ID)?.projectPlanning).toEqual(projectPlanning)
  })
})
