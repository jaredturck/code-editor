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

export function getActiveChatId() {
  const id = readStorageJson(ACTIVE_CHAT_KEY, null)
  return typeof id === 'string' && id ? id : null
}

export function setActiveChatId(id: string | null) {
  writeStorageJson(ACTIVE_CHAT_KEY, id || null)
}

const SESSION_STATE_KEY_PREFIX = 'iris_chat_session_'

export interface ChatSessionState {
  todos: Array<Record<string, unknown>>
  primaryOrchestratorId: string
  executionPolicy: 'hybrid' | 'local_only' | 'primary_only'
  projectRun: Record<string, unknown> | null
  projectPlanning: Record<string, unknown> | null
  // Autonomous project database is independent from the UI run-controller record so routine
  // ProjectRunState normalization/checkpointing cannot accidentally erase long-horizon state.
  projectLedger: Record<string, unknown> | null
  updatedAt: number
}

export async function hydrateChatSessionState(id: string): Promise<void> {
  if (!id) return
  const key = `${SESSION_STATE_KEY_PREFIX}${id}`
  const values = await durableStoreGetMany([key])
  hydrateStorageValues(values)
}

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
    projectPlanning:
      raw.projectPlanning && typeof raw.projectPlanning === 'object'
        ? (raw.projectPlanning as Record<string, unknown>)
        : null,
    projectLedger:
      raw.projectLedger && typeof raw.projectLedger === 'object'
        ? (raw.projectLedger as Record<string, unknown>)
        : null,
    updatedAt: Number(raw.updatedAt) || 0,
  }
}

export function saveChatSessionState(
  id: string,
  state: {
    todos?: unknown
    primaryOrchestratorId?: unknown
    executionPolicy?: unknown
    projectRun?: unknown
    projectPlanning?: unknown
    projectLedger?: unknown
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
  const projectPlanning = Object.prototype.hasOwnProperty.call(state || {}, 'projectPlanning')
    ? state?.projectPlanning && typeof state.projectPlanning === 'object'
      ? (state.projectPlanning as Record<string, unknown>)
      : null
    : current?.projectPlanning || null
  const projectLedger = Object.prototype.hasOwnProperty.call(state || {}, 'projectLedger')
    ? state?.projectLedger && typeof state.projectLedger === 'object'
      ? (state.projectLedger as Record<string, unknown>)
      : null
    : current?.projectLedger || null
  writeStorageJson(`${SESSION_STATE_KEY_PREFIX}${id}`, {
    todos,
    primaryOrchestratorId: String(state?.primaryOrchestratorId ?? current?.primaryOrchestratorId ?? ''),
    executionPolicy,
    projectRun,
    projectPlanning,
    projectLedger,
    updatedAt: Date.now(),
  })
}

export function clearChatSessionState(id: string): void {
  if (!id) return
  writeStorageJson(`${SESSION_STATE_KEY_PREFIX}${id}`, null)
}

export async function listChats() {
  return chatsList()
}

export async function createChat({ provider = '', model = '', title = 'New chat' }: CreateChatInput = {}) {
  return chatsCreate({ title, provider, model })
}

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

export async function loadChat(id: string) {
  if (!id) return null
  const [chat] = await Promise.all([chatsGet(id), hydrateChatSessionState(id)])
  return chat
}

export async function saveCompacted(id: string, content: string) {
  if (!id) return
  await chatsSaveCompacted(id, content)
}

export async function renameChat(id: string, title: string) {
  if (!id || !title) return
  await chatsSetTitle(id, title)
}

export async function removeChat(id: string) {
  if (!id) return
  await chatsDelete(id)
  clearChatSessionState(id)
}

export async function loadChatContext(id: string): Promise<ChatContext | null> {
  if (!id) return null
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
