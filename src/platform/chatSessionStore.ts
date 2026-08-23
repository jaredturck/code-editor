/**
 * Provides the renderer facade for encrypted chat persistence. The Electron-owned bridge
 * stores titles, messages, summaries, memory, and active-chat state as encrypted records;
 * decrypted values remain in renderer memory only while the user is working with them.
 */
import {
  chatsList,
  chatsCreate,
  chatsAppend,
  chatsGet,
  chatsSaveCompacted,
  chatsSetTitle,
  chatsDelete,
  chatsReadMemory,
} from '@/platform/desktopBridge'
import { hydrateStorageValues, readStorageJson, writeStorageJson } from '@/platform/localStorageStore'
import { durableStoreGetMany } from '@/platform/secureDurableStore'

const ACTIVE_CHAT_KEY = 'iris_active_chat_id'

export interface ChatMessage {
  role: string
  content: string
  attachments?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface ChatContext {
  messages: ChatMessage[]
  compacted: string
  memory: string
}

export interface CreateChatInput {
  provider?: string
  model?: string
  title?: string
}

// Returns active chat id without requiring callers to know where or how it is stored.
export function getActiveChatId() {
  const id = readStorageJson(ACTIVE_CHAT_KEY, null)
  return typeof id === 'string' && id ? id : null
}

// Changes active chat id and performs any related synchronization required by the feature.
export function setActiveChatId(id: string | null) {
  writeStorageJson(ACTIVE_CHAT_KEY, id || null)
}

// ── Warm session state (per chat) ──────────────────────────────────────────────
// Keeps a chat's agent plan/progress (todos) warm across turns, chat switches, and
// restarts — instead of cold-restarting every message. Stored in the SAME encrypted
// renderer-state store as the active chat id (writeStorageJson write-throughs to the
// Electron-owned encrypted store), so no plaintext and no new bridge/DB schema. Skills
// are intentionally NOT carried — the skill engine re-selects per request.
const SESSION_STATE_KEY_PREFIX = 'iris_chat_session_'

export interface ChatSessionState {
  todos: Array<Record<string, unknown>>
  primaryOrchestratorId: string
  executionPolicy: 'hybrid' | 'local_only' | 'primary_only'
  projectRun: Record<string, unknown> | null
  updatedAt: number
}

// Decrypts one chat's persisted run/TODO state on demand before that chat is restored.
export async function hydrateChatSessionState(id: string): Promise<void> {
  if (!id) return
  const key = `${SESSION_STATE_KEY_PREFIX}${id}`
  const values = await durableStoreGetMany([key])
  hydrateStorageValues(values)
}

// Returns the already-loaded warm session state for one chat, or null when none/disabled.
export function getChatSessionState(id: string): ChatSessionState | null {
  if (!id) return null
  const raw = readStorageJson<Partial<ChatSessionState> | null>(`${SESSION_STATE_KEY_PREFIX}${id}`, null)
  if (!raw || typeof raw !== 'object') return null
  const executionPolicy = String(raw.executionPolicy || 'hybrid')
  return {
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    primaryOrchestratorId: String(raw.primaryOrchestratorId || ''),
    executionPolicy: ['hybrid', 'local_only', 'primary_only'].includes(executionPolicy)
      ? (executionPolicy as ChatSessionState['executionPolicy'])
      : 'hybrid',
    projectRun:
      raw.projectRun && typeof raw.projectRun === 'object' ? (raw.projectRun as Record<string, unknown>) : null,
    updatedAt: Number(raw.updatedAt) || 0,
  }
}

// Persists the warm session state (the agent's todo plan) for one chat. Bounded so it
// never grows unbounded; best-effort (never blocks the run).
export function saveChatSessionState(
  id: string,
  state: {
    todos?: unknown
    primaryOrchestratorId?: unknown
    executionPolicy?: unknown
    projectRun?: unknown
  },
): void {
  if (!id) return
  const current = getChatSessionState(id)
  const todos = Array.isArray(state?.todos)
    ? (state.todos.slice(0, 50) as Array<Record<string, unknown>>)
    : current?.todos || []
  const requestedPolicy = String(state?.executionPolicy || current?.executionPolicy || 'hybrid')
  const executionPolicy = ['hybrid', 'local_only', 'primary_only'].includes(requestedPolicy)
    ? requestedPolicy
    : 'hybrid'
  const projectRun = Object.prototype.hasOwnProperty.call(state || {}, 'projectRun')
    ? state?.projectRun && typeof state.projectRun === 'object'
      ? (state.projectRun as Record<string, unknown>)
      : null
    : current?.projectRun || null
  writeStorageJson(`${SESSION_STATE_KEY_PREFIX}${id}`, {
    todos,
    primaryOrchestratorId: String(state?.primaryOrchestratorId ?? current?.primaryOrchestratorId ?? ''),
    executionPolicy,
    projectRun,
    updatedAt: Date.now(),
  })
}

// Clears the warm session state for one chat (called on permanent delete).
export function clearChatSessionState(id: string): void {
  if (!id) return
  writeStorageJson(`${SESSION_STATE_KEY_PREFIX}${id}`, null)
}

// Returns the available chats in the normalized form used by callers.
export async function listChats() {
  return chatsList()
}

// Creates chat with the state and dependencies needed by its consumers.
export async function createChat({ provider = '', model = '', title = 'New chat' }: CreateChatInput = {}) {
  return chatsCreate({ title, provider, model })
}

// Bounds a persisted message's timeline so the encrypted store doesn't bloat: keep the last N
// events and clip large arg/output previews (mirrors the runtime's preview caps in todoTrace).
const MAX_PERSISTED_TIMELINE_EVENTS = 200
const MAX_PERSISTED_PREVIEW_CHARS = 2000
function trimChatMeta(meta?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const out: Record<string, unknown> = { ...meta }
  const timeline = out.timeline
  if (Array.isArray(timeline)) {
    out.timeline = timeline.slice(-MAX_PERSISTED_TIMELINE_EVENTS).map((event) => {
      if (!event || typeof event !== 'object') return event
      const source = event as Record<string, unknown>
      const clipped: Record<string, unknown> = { ...source }
      for (const field of ['outputPreview', 'argsPreview'] as const) {
        const value = source[field]
        if (typeof value === 'string' && value.length > MAX_PERSISTED_PREVIEW_CHARS) {
          clipped[field] = `${value.slice(0, MAX_PERSISTED_PREVIEW_CHARS)}…`
        }
      }
      return clipped
    })
  }
  return out
}

function toAttachmentRecord(attachment: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attachment))
}

// Appends chat message while preserving the storage and size rules owned by the chat persistence
// service. `meta` (the run timeline + model attribution) is bounded then persisted so previous
// timelines can be restored on reload.
export async function appendChatMessage(
  id: string,
  role: string,
  content: unknown,
  meta?: Record<string, unknown> | null,
  attachments?: object[] | null,
) {
  if (!id) return
  const trimmedMeta = trimChatMeta(meta)
  const persistedAttachments = Array.isArray(attachments) ? attachments.slice(0, 4).map(toAttachmentRecord) : []
  await chatsAppend(id, {
    role: String(role || 'user'),
    content: String(content ?? ''),
    ...(trimmedMeta ? { meta: trimmedMeta } : {}),
    ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
  })
}

// Loads chat and applies the normalization or fallback behavior expected by callers.
export async function loadChat(id: string) {
  if (!id) return null
  const [chat] = await Promise.all([chatsGet(id), hydrateChatSessionState(id)])
  return chat
}

// Saves compacted so it remains available to later operations or sessions.
export async function saveCompacted(id: string, content: string) {
  if (!id) return
  await chatsSaveCompacted(id, content)
}

// Updates the persisted title of one chat without rewriting its transcript.
export async function renameChat(id: string, title: string) {
  if (!id || !title) return
  await chatsSetTitle(id, title)
}

// Removes chat and releases related state owned by the chat persistence service.
export async function removeChat(id: string) {
  if (!id) return
  await chatsDelete(id)
  clearChatSessionState(id)
}

/**
 * Load a chat's full context in a single encrypted database round-trip.
 *
 * Returns:
 *   {
 *     messages:  Array<{ role, content }>   — decrypted message rows
 *     compacted: string                     — decrypted rolling summary
 *     memory:    string                     — decrypted agent working memory
 *   }
 *
 * Used by:
 *   • ChatPanel.switchToChat() — to warm the context cache on chat switch
 *   • ChatPanel (mount effect) — to warm the cache for the initially-active chat
 *   • chatContextBuilder.buildConversationContext() — as the secure source when cache is cold
 *
 * Returns null only when the requested chat does not exist. Bridge, database, or decryption
 * failures propagate so the desktop can fail closed instead of using a hidden fallback.
 */
export async function loadChatContext(id: string): Promise<ChatContext | null> {
  if (!id) return null
  // chatsGet returns encrypted-record content after bridge-side decryption; memory is
  // requested separately to preserve the existing public API.
  const [chat, memory] = await Promise.all([chatsGet(id), chatsReadMemory(id)])
  if (!chat) return null
  return {
    messages: Array.isArray(chat.messages)
      ? (chat.messages.filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string') as ChatMessage[])
      : [],
    compacted: typeof chat.compacted === 'string' ? chat.compacted : '',
    memory: typeof memory === 'string' ? memory : '',
  }
}
