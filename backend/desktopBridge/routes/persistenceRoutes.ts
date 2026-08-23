/**
 * Maps durable-store, chat, memory, and sub-agent output requests to the persistence
 * service. It keeps HTTP parsing separate from disk-oriented implementations.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js'
import {
  appendChatMessage,
  createChatSession,
  deleteChatSession,
  deleteDurableStoreKey,
  getChatSession,
  readChatIndex,
  readChatMemory,
  readChatRecall,
  readJsonBody,
  readSubagentOutput,
  saveChatCompacted,
  sendJson,
  setChatTitle,
  writeChatMemory,
  writeDurableStoreKey,
  writeSubagentOutput,
} from '../services/persistenceService.js'
import { readRendererBootstrapStore, readRequestedDurableStoreKeys } from '../services/persistenceSecurityService.js'

/**
 * Processes persistence routes within the bridge route dispatch, including the side effects
 * and response expected by that boundary.
 */

export async function handlePersistenceRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
): Promise<boolean> {
  // Legacy startup route now returns the same bootstrap-safe subset. Sensitive per-chat/run
  // records must be requested explicitly through /store/get-many.
  if (pathname === '/api/local/store/get-all' && req.method === 'GET') {
    sendJson(res, 200, { values: await readRendererBootstrapStore() })
    return true
  }

  // Bootstrap excludes per-chat checkpoints and extended run history so Chromium does not
  // decrypt unrelated sensitive state simply because the application started.
  if (pathname === '/api/local/store/bootstrap' && req.method === 'GET') {
    sendJson(res, 200, { values: await readRendererBootstrapStore() })
    return true
  }

  // Targeted reads are used when a chat/run is actually opened. The bridge returns only the
  // requested sensitive records and never exposes unrelated durable-state values to Chromium.
  if (pathname === '/api/local/store/get-many' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { values: await readRequestedDurableStoreKeys(body?.keys) })
    return true
  }

  if (pathname === '/api/local/store/set' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const key = String(body?.key || '').trim()
    if (!key) {
      sendJson(res, 400, { error: 'key required' })
      return true
    }
    await writeDurableStoreKey(key, body?.value)
    sendJson(res, 200, { ok: true })
    return true
  }

  if (pathname === '/api/local/store/delete' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const key = String(body?.key || '').trim()
    if (!key) {
      sendJson(res, 400, { error: 'key required' })
      return true
    }
    await deleteDurableStoreKey(key)
    sendJson(res, 200, { ok: true })
    return true
  }

  // ── Encrypted chat sessions, compacted context, and memory ───────────────────
  if (pathname === '/api/local/chats/list' && req.method === 'POST') {
    sendJson(res, 200, { chats: await readChatIndex() })
    return true
  }

  if (pathname === '/api/local/chats/create' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const chat = await createChatSession({
      title: body?.title,
      provider: body?.provider,
      model: body?.model,
    })
    sendJson(res, 200, { chat })
    return true
  }

  if (pathname === '/api/local/chats/append' && req.method === 'POST') {
    const body = await readJsonBody(req)
    await appendChatMessage(body?.id, body?.message)
    sendJson(res, 200, { ok: true })
    return true
  }

  if (pathname === '/api/local/chats/get' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { chat: await getChatSession(body?.id) })
    return true
  }

  if (pathname === '/api/local/chats/save-compacted' && req.method === 'POST') {
    const body = await readJsonBody(req)
    await saveChatCompacted(body?.id, body?.content)
    sendJson(res, 200, { ok: true })
    return true
  }

  if (pathname === '/api/local/chats/set-title' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await setChatTitle(body?.id, body?.title))
    return true
  }

  if (pathname === '/api/local/chats/delete' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await deleteChatSession(body?.id))
    return true
  }

  if (pathname === '/api/local/chats/read-memory' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { memory: await readChatMemory(body?.id) })
    return true
  }

  if (pathname === '/api/local/chats/write-memory' && req.method === 'POST') {
    const body = await readJsonBody(req)
    await writeChatMemory(body?.id, body?.content, { append: body?.append === true })
    sendJson(res, 200, { ok: true })
    return true
  }

  if (pathname === '/api/local/chats/recall' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, {
      context: await readChatRecall(body?.id, String(body?.scope || 'compacted')),
    })
    return true
  }

  // Encrypted sub-agent output handoff
  if (pathname === '/api/local/subagent/write-output' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await writeSubagentOutput(body?.taskId, body?.content))
    return true
  }

  if (pathname === '/api/local/subagent/read-output' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { output: await readSubagentOutput(body?.taskId) })
    return true
  }

  return false
}
