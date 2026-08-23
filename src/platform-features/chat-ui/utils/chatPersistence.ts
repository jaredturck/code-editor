/**
 * Loads and saves Chat panel messages and produces provisional titles, generated titles,
 * and compacted summaries. It coordinates the renderer's conversation state with durable
 * chat storage without placing persistence rules inside the panel component.
 */

import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask'
import { DEFAULT_MESSAGES } from '../constants'
import type { ChatMessage, ChatSettings } from '../types'

// Chat content is never persisted in Chromium storage. The active encrypted chat is loaded
// from SQLite after mount; this initial value exists only until that hydration completes.
export function loadPersistedMessages(): ChatMessage[] {
  return DEFAULT_MESSAGES
}

// Retained as a presentation compatibility hook. Durable messages are written through the
// encrypted chat-session bridge, while this function deliberately performs no disk write.
export function persistMessages(_messages: ChatMessage[]): void {}

// Creates a temporary chat title from the first user message until automatic titling completes.
export function provisionalChatTitle(text: unknown): string {
  return (
    String(text || 'New chat')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'New chat'
  )
}

// Generates chat title for the next stage of the chat presentation layer.
export async function generateChatTitle(
  userText: unknown,
  assistantText: unknown,
  settings: ChatSettings,
): Promise<string> {
  try {
    const titleResult = await runBoundedRoleTask({
      settings: {
        ...settings,
        reasoning_effort: 'low',
        extended_thinking: false,
      },
      preferredRoles: ['scout', 'orchestrator'],
      requiredTags: ['general'],
      allowCloud: false,
      maxAttempts: 3,
      maxOutputTokens: 80,
      reasoningEffort: 'low',
      taskLabel: 'chat title generation',
      messages: [
        {
          role: 'system',
          content:
            'Summarize the conversation topic as one short title of at most 8 words. Reply with ONLY the title — no quotes, no trailing punctuation.',
        },
        {
          role: 'user',
          content: `User: ${String(userText || '').slice(0, 600)}\nAssistant: ${String(assistantText || '').slice(0, 600)}`,
        },
      ],
    })

    return String(titleResult.text || '')
      .split('\n')[0]
      .replace(/^["'\s]+|["'\s.]+$/g, '')
      .slice(0, 80)
  } catch {
    return ''
  }
}

// Generates compacted summary for the next stage of the chat presentation layer.
export async function generateCompactedSummary(messages: ChatMessage[], settings: ChatSettings): Promise<string> {
  try {
    const conversation = messages
      .filter((message) => message.role && typeof message.content === 'string')
      .map((message) => `${String(message.role).toUpperCase()}: ${String(message.content).slice(0, 1200)}`)
      .join('\n\n')
      .slice(0, 16_000)

    if (!conversation) return ''

    const summaryResult = await runBoundedRoleTask({
      settings: {
        ...settings,
        reasoning_effort: 'low',
        extended_thinking: false,
      },
      preferredRoles: ['scout', 'orchestrator'],
      requiredTags: ['general'],
      allowCloud: false,
      maxAttempts: 3,
      maxOutputTokens: 2200,
      reasoningEffort: 'low',
      taskLabel: 'chat compaction',
      messages: [
        {
          role: 'system',
          content:
            // Mirrors the orbit-compaction skill: throw away tokens, not information. A fresh turn
            // should be able to continue from these notes as if it had read the whole chat.
            'You compress a chat into durable working notes that free the context window without losing what matters. Read oldest→newest; the CURRENT goal overrides earlier ones. Output dense markdown under these headings (omit any that are empty), no preamble: GOAL (one line, what "done" looks like now); DECISIONS & FACTS (and why, so they are not re-litigated); CONSTRAINTS & PREFERENCES (anything the user insisted on); ARTIFACTS (files, paths, functions, commands, URLs that matter going forward); OPEN THREADS (unfinished todos, known bugs, the next concrete step); LATEST REQUEST (the live ask). DROP greetings/chit-chat, dead ends (keep only the lesson), and raw logs (keep the conclusion). This text REPLACES the transcript for recall — completeness on those points beats prose.',
        },
        {
          role: 'user',
          content: `Compact this chat into working notes so it can be recalled later:\n\n${conversation}`,
        },
      ],
    })

    return String(summaryResult.text || '').slice(0, 8000)
  } catch {
    return ''
  }
}
