/**
 * Handles web search, encrypted search history, and direct skill management. Skills saved through
 * the user-facing editor are marked as user-originated, while model-proposed skills use the
 * separate review workflow.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js'
import { inputErrorResponse, validateSkillInput } from '../shared/agentInputValidation.js'
import { acquireOperation, operationLimitPayload } from '../shared/operationLimiter.js'
import {
  deleteSkillFromProfile,
  listSkillProfiles,
  listSkillsForProfile,
  readJsonBody,
  runWebResearch,
  sendJson,
  upsertSkillForProfile,
} from '../services/webSkillService.js'
import {
  clearWebSearchHistory,
  createWebSearchHistorySession,
  deleteWebSearchHistorySession,
  duplicateWebSearchHistorySession,
  getWebSearchHistorySession,
  listWebSearchHistory,
  saveWebSearchHistorySession,
} from '../services/webSearchHistoryService.js'

function webSearchOptions(body: Record<string, unknown>) {
  return {
    maxResults: body.maxResults,
    maxSources: body.maxSources,
    fetchTimeoutMs: body.fetchTimeoutMs,
    safeSearch: body.safeSearch,
    locale: body.locale,
    region: body.region,
    timeRange: body.timeRange,
    includeContent: body.includeContent !== false,
    discoverOnly: body.discoverOnly === true,
    allowedDomains: Array.isArray(body.allowedDomains) ? body.allowedDomains : null,
    providerPolicy: body.providerPolicy,
    providerSettings: body.providerSettings,
    allowPaidFallback: body.allowPaidFallback === true,
  }
}

function writeStreamMessage(res: BridgeResponse, value: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed) return
  res.write(`${JSON.stringify(value)}\n`)
}

/**
 * Processes web skill routes within the bridge route dispatch, including the side effects
 * and response expected by that boundary.
 */
export async function handleWebSkillRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/local/web/search' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const query = String(body.query || '').trim()
    if (!query) {
      sendJson(res, 400, { error: 'query is required' })
      return true
    }
    const permit = acquireOperation('web')
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }
    try {
      const result = await runWebResearch(query, webSearchOptions(body))
      sendJson(res, 200, result)
    } finally {
      permit.release()
    }
    return true
  }

  if (pathname === '/api/local/web/search/stream' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const query = String(body.query || '').trim()
    if (!query) {
      sendJson(res, 400, { error: 'query is required' })
      return true
    }
    const permit = acquireOperation('web')
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }

    const controller = new AbortController()
    let sequence = 0
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', () => {
      if (!res.writableEnded) abort()
    })
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    })

    try {
      const result = await runWebResearch(query, {
        ...webSearchOptions(body),
        signal: controller.signal,
        onProgress: (event: Record<string, unknown>) => {
          sequence += 1
          writeStreamMessage(res, {
            kind: 'progress',
            event: {
              sequence,
              timestamp: Date.now(),
              ...event,
            },
          })
        },
      })
      writeStreamMessage(res, { kind: 'result', result })
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed) {
        writeStreamMessage(res, {
          kind: 'error',
          error: error instanceof Error ? error.message : String(error || 'Search failed'),
          code: (error as { code?: string })?.code || '',
        })
      }
    } finally {
      req.removeListener('aborted', abort)
      permit.release()
      if (!res.writableEnded && !res.destroyed) res.end()
    }
    return true
  }

  if (pathname === '/api/local/web-history/list' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const sessions = await listWebSearchHistory(body.limit)
    sendJson(res, 200, { sessions })
    return true
  }

  if (pathname === '/api/local/web-history/create' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const session = await createWebSearchHistorySession(body.session)
    sendJson(res, 200, { session })
    return true
  }

  if (pathname === '/api/local/web-history/get' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const session = await getWebSearchHistorySession(body.id)
    if (!session) {
      sendJson(res, 404, { error: 'saved search not found' })
      return true
    }
    sendJson(res, 200, { session })
    return true
  }

  if (pathname === '/api/local/web-history/save' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const session = await saveWebSearchHistorySession(body.id, body.session)
    sendJson(res, 200, { session })
    return true
  }

  if (pathname === '/api/local/web-history/duplicate' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const session = await duplicateWebSearchHistorySession(body.id)
    sendJson(res, 200, { session })
    return true
  }

  if (pathname === '/api/local/web-history/delete' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const removed = await deleteWebSearchHistorySession(body.id)
    sendJson(res, 200, { removed })
    return true
  }

  if (pathname === '/api/local/web-history/clear' && req.method === 'POST') {
    const removed = await clearWebSearchHistory()
    sendJson(res, 200, { removed })
    return true
  }

  if (pathname === '/api/local/skills/profiles' && req.method === 'GET') {
    const profiles = await listSkillProfiles()
    sendJson(res, 200, { profiles })
    return true
  }

  if (pathname === '/api/local/skills/list' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const result = await listSkillsForProfile(body.profile || 'default-model')
    sendJson(res, 200, result)
    return true
  }

  if (pathname === '/api/local/skills/upsert' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const skill = validateSkillInput(body.skill)
      if (!skill.provenance) {
        const now = new Date().toISOString()
        skill.provenance = {
          source: 'local_user',
          sourceLabel: 'skills_panel',
          receivedAt: now,
          approvedAt: now,
          approvedBy: 'local_user',
        }
      }
      const result = await upsertSkillForProfile(body.profile || 'default-model', skill)
      sendJson(res, 200, result)
    } catch (error) {
      const detail = inputErrorResponse(error)
      sendJson(res, detail.statusCode, { error: detail.message })
    }
    return true
  }

  if (pathname === '/api/local/skills/delete' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body.skillId) {
      sendJson(res, 400, { error: 'skillId is required' })
      return true
    }
    const result = await deleteSkillFromProfile(body.profile || 'default-model', body.skillId)
    sendJson(res, 200, result)
    return true
  }

  return false
}
