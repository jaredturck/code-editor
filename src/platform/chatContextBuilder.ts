/**
 * Builds the provider-neutral conversation context used for each agent turn. It combines the
 * active decrypted message window with encrypted compacted history and per-chat memory, then
 * trims the result to the selected model's context budget without persisting injected context.
 */

import { resolveContextWindow } from '@/platform/modelProfiles'
import { loadChatContext } from '@/platform/chatSessionStore'

export interface ContextMessage extends Record<string, unknown> {
  role: string
  content: unknown
  _injected?: boolean
}

interface BuildConversationContextOptions {
  chatId: string | null
  messages: ContextMessage[]
  settings: Record<string, unknown>
  cachedCompacted?: string
  cachedMemory?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Tokens reserved for the model's response + the agent system prompt.
 * Prevents context injection from crowding out the answer.
 * 8k is conservative; Claude/GPT-4o can produce more, but the system prompt
 * also consumes tokens not counted in the user message array.
 */
const RESPONSE_TOKEN_HEADROOM = 8000

/**
 * Hard cap on messages regardless of token math.
 * Prevents runaway context growth on very fast exchanges.
 */
const HARD_MESSAGE_CAP = 200

/**
 * Conservative chars-per-token ratio (errs toward over-counting).
 * Code-heavy conversations average ~3 chars/token; prose is ~4.
 * We use 3.5 as a safe middle ground.
 */
const CHARS_PER_TOKEN = 3.5

/**
 * Minimum token budget before we give up and just send what fits.
 * Protects against extremely small context windows (e.g. 4k local models).
 */
const MIN_TOKEN_BUDGET = 2000

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * Rough token count for a string.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCount(text: unknown) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN)
}

/**
 * Aggregate token cost of a message array.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages: unknown) {
  if (!Array.isArray(messages)) return 0
  // +4 per message for role tag overhead (matches OpenAI's counting heuristic).
  return messages.reduce((sum, m) => sum + 4 + estimateTokenCount(String(m?.content ?? '')), 0)
}

// ── Context injection ─────────────────────────────────────────────────────────

/**
 * Build the context injection message pair.
 *
 * We use a synthetic user/assistant exchange (not a bare system message) so
 * the turn-ordering is valid across ALL provider APIs:
 *   • Anthropic requires alternating user/assistant turns
 *   • OpenAI accepts system messages at any position but user/assistant
 *     is cleaner for conversation history
 *   • Gemini, OpenRouter, and local models all handle user/assistant pairs fine
 *
 * Messages are flagged with `_injected: true` so ChatPanel never persists
 * them back to the encrypted transcript because they are derived context rather than real turns.
 *
 * @param {string} compacted - decrypted rolling summary
 * @param {string} memory    - decrypted agent working memory
 * @returns {Array} 0 or 2 messages
 */
function buildContextInjectionPair(compacted: unknown, memory: unknown): ContextMessage[] {
  const parts: string[] = []

  // Rolling conversation summary
  const compactedClean = String(compacted || '').trim()
  if (compactedClean) {
    parts.push(`**PRIOR CONVERSATION SUMMARY**\n\n${compactedClean}`)
  }

  // Agent working memory — strip the default header/placeholder the server
  // seeds on chat creation so we only inject real content.
  const memoryClean = String(memory || '')
    .replace(/^#\s*Chat memory\s*\n+/im, '')
    .replace(/_\(The agent maintains[^)]*\)_\n?/g, '')
    .trim()
  if (memoryClean) {
    parts.push(`**AGENT WORKING MEMORY**\n\n${memoryClean}`)
  }

  if (parts.length === 0) return []

  const body = parts.join('\n\n---\n\n')

  return [
    {
      role: 'user',
      content:
        `[CONTEXT FROM PRIOR CONVERSATION]\n\n${body}\n\n` +
        `---\n` +
        `The above summarizes what we discussed before this context window. ` +
        `Continue from here as if you remember everything.`,
      _injected: true,
    },
    {
      role: 'assistant',
      content: `Understood — I have the prior context and will continue from where we left off.`,
      _injected: true,
    },
  ]
}

// ── Core export ───────────────────────────────────────────────────────────────

/**
 * Assemble the conversation context array to pass as `conversation` to
 * `runAgentSession()`.
 *
 * Call this in ChatPanel.sendMessage() BEFORE calling runAgentSession().
 *
 * @param {object}      opts
 * @param {string|null} opts.chatId            - active durable chat id (null → no stored context)
 * @param {Array}       opts.messages          - current in-memory messages (includes new user turn)
 * @param {object}      opts.settings          - OrbContext settings (provider, model, etc.)
 * @param {string}      [opts.cachedCompacted] - compacted summary already in state
 * @param {string}      [opts.cachedMemory]    - chat memory already in state
 * @returns {Promise<Array>}
 */
export async function buildConversationContext({
  chatId,
  messages,
  settings,
  cachedCompacted = '',
  cachedMemory = '',
}: BuildConversationContextOptions): Promise<ContextMessage[]> {
  // Strip any previously injected context messages so they never double-stack.
  const cleanMessages = (messages || []).filter((m) => !m?._injected)

  // ── No durable session ────────────────────────────────────────────────────
  // Just enforce the hard cap and return. No persisted context is needed.
  if (!chatId) {
    return cleanMessages.slice(-HARD_MESSAGE_CAP)
  }

  // ── Load encrypted context (use cache when warm) ──────────────────────────
  let compacted = cachedCompacted || ''
  let memory = cachedMemory || ''

  // Only query the encrypted store if the cache is cold (e.g. first send after reload).
  if (!compacted && !memory) {
    const storedContext = await loadChatContext(chatId)
    if (!storedContext) throw new Error('Encrypted chat context is unavailable')
    compacted = storedContext.compacted || ''
    memory = storedContext.memory || ''
  }

  // ── Token budget ──────────────────────────────────────────────────────────
  const contextWindow = resolveContextWindow(settings)
  const tokenBudget = Math.max(MIN_TOKEN_BUDGET, contextWindow - RESPONSE_TOKEN_HEADROOM)

  const fullTokens = estimateMessagesTokens(cleanMessages)
  const injectionCost = estimateTokenCount(compacted) + estimateTokenCount(memory) + 300 // overhead

  // ── Fast path: everything fits ────────────────────────────────────────────
  // If the full message list fits within the token budget, send it all.
  // We still prepend memory so the agent's goals are always visible even on
  // short conversations — it's cheap and high-value.
  if (fullTokens + injectionCost <= tokenBudget && cleanMessages.length <= HARD_MESSAGE_CAP) {
    const memoryOnly = buildContextInjectionPair('', memory)
    if (memoryOnly.length > 0) {
      return [...memoryOnly, ...cleanMessages]
    }
    return cleanMessages
  }

  // ── Sliding window: fit as many recent messages as possible ──────────────
  // Walk newest-first, accumulating tokens until we hit the budget.
  const windowMessages: ContextMessage[] = []
  let windowTokens = 0
  const windowBudget = tokenBudget - injectionCost

  for (let i = cleanMessages.length - 1; i >= 0; i--) {
    const cost = 4 + estimateTokenCount(String(cleanMessages[i]?.content ?? ''))
    if (windowTokens + cost > windowBudget || windowMessages.length >= HARD_MESSAGE_CAP) {
      break
    }
    windowMessages.unshift(cleanMessages[i])
    windowTokens += cost
  }

  // ── Context injection ─────────────────────────────────────────────────────
  // We are truncating history — inject the compacted summary so the model
  // knows what happened before the window. Always include durable chat memory.
  const isWindowTruncated = windowMessages.length < cleanMessages.length

  const injectionPair = buildContextInjectionPair(isWindowTruncated ? compacted : '', memory)

  if (injectionPair.length > 0) {
    return [...injectionPair, ...windowMessages]
  }

  return windowMessages
}

// ── Utility export ────────────────────────────────────────────────────────────

/**
 * Determine whether the current conversation is approaching the context
 * window limit and should trigger an early compaction.
 *
 * Used by ChatPanel to run compactedSummary generation more aggressively
 * when context pressure is building up, not just on the fixed 4-turn cadence.
 *
 * @param {Array}  messages
 * @param {object} settings
 * @returns {boolean}
 */
export function shouldEarlyCompact(messages: ContextMessage[], settings: Record<string, unknown>) {
  if (!Array.isArray(messages) || messages.length < 12) return false

  const contextWindow = resolveContextWindow(settings)
  const usedTokens = estimateMessagesTokens(messages)
  const usedRatio = usedTokens / contextWindow

  // Trigger early compaction when > 60% of context window is consumed by
  // the message history alone (before adding the system prompt).
  return usedRatio > 0.6
}
