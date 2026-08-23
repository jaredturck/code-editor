/**
 * Handles desktop automation capabilities/actions and AI discovery or proxy requests. It
 * applies activity limits before invoking automation or opening remote provider
 * connections.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js'
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js'
import { requireBridgePermission } from '../shared/bridgeAuthorization.js'
import {
  cancelLocalOllamaModelPull,
  discoverLocalAIServers,
  getLocalModelInputCapabilities,
  getRemoteModelInputCapabilities,
  getLocalOllamaModelPull,
  executeAutomationActions,
  getAutomationCapabilities,
  pullLocalOllamaModel,
  startLocalOllamaModelPull,
  proxyRemoteRequest,
  proxyRemoteStream,
  readJsonBody,
  sendJson,
} from '../services/automationAiService.js'
import { resolveDirectoryWithinRoot } from '../shared/filesystemBoundary.js'
import { acquireOperation, operationLimitPayload } from '../shared/operationLimiter.js'
import { consumeAutomationApproval, createAutomationApproval } from '../shared/automationApproval.js'

/**
 * Processes automation ai routes within the bridge route dispatch, including the side
 * effects and response expected by that boundary.
 */

export async function handleAutomationAiRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/automation/capabilities' && req.method === 'GET') {
    const capabilities = await getAutomationCapabilities()
    sendJson(res, 200, capabilities)
    return true
  }

  if (pathname === '/api/local/automation/approval' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'automation')
    const body = await readJsonBody(req)
    const actions = Array.isArray(body.actions) ? body.actions : []
    if (!actions.length) {
      sendJson(res, 400, { error: 'Automation actions are required' })
      return true
    }
    const cwd = await resolveDirectoryWithinRoot(body.cwd || '.', baseDir)
    sendJson(res, 200, {
      approvalToken: createAutomationApproval({ actions, cwd }),
      expiresInMs: 60_000,
    })
    return true
  }

  if (pathname === '/api/local/automation/execute' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const dryRun = Boolean(body.dryRun)
    if (!dryRun) requireBridgePermission(securityContext, 'automation')
    const actions = Array.isArray(body.actions) ? body.actions : []
    if (!actions.length) {
      sendJson(res, 400, { error: 'Automation actions are required' })
      return true
    }
    const cwd = await resolveDirectoryWithinRoot(body.cwd || '.', baseDir)
    if (!dryRun && !consumeAutomationApproval(body.approvalToken, { actions, cwd })) {
      sendJson(res, 403, {
        error: 'Automation approval is invalid, expired, mismatched, or already used',
        code: 'automation_approval_invalid',
      })
      return true
    }
    const permit = acquireOperation('automation', Math.max(1, Math.ceil(actions.length / 5)))
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }
    try {
      const result = await executeAutomationActions(actions, {
        dryRun,
        cwd,
        allowMouseControl: !dryRun && securityContext?.permissions.automation === true,
      })
      sendJson(res, 200, result)
    } finally {
      permit.release()
    }
    return true
  }

  if (pathname === '/api/local/ai/discover' && req.method === 'GET') {
    const result = await discoverLocalAIServers()
    sendJson(res, 200, result)
    return true
  }

  if (pathname === '/api/local/ai/local/capabilities' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const result = await getLocalModelInputCapabilities(body.baseUrl, body.model)
    sendJson(res, 200, result)
    return true
  }

  if (pathname === '/api/local/ai/remote/capabilities' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const permit = acquireOperation('web')
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }
    try {
      const result = await getRemoteModelInputCapabilities(body.provider, body.model, body.apiKey)
      sendJson(res, 200, result)
    } finally {
      permit.release()
    }
    return true
  }

  if (pathname === '/api/local/ai/local/pull' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const permit = acquireOperation('web')
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }
    try {
      const result = await pullLocalOllamaModel(body.baseUrl, body.model)
      sendJson(res, 200, result)
    } finally {
      permit.release()
    }
    return true
  }

  if (pathname === '/api/local/ai/local/pull/start' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const result = startLocalOllamaModelPull(body.baseUrl, body.model)
    sendJson(res, 202, result)
    return true
  }

  if (pathname === '/api/local/ai/local/pull/status' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, getLocalOllamaModelPull(body.jobId))
    return true
  }

  if (pathname === '/api/local/ai/local/pull/cancel' && req.method === 'POST') {
    const body = await readJsonBody(req)
    sendJson(res, 200, cancelLocalOllamaModelPull(body.jobId))
    return true
  }

  if (pathname === '/api/local/ai/proxy' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const permit = acquireOperation('web')
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }
    try {
      const result = await proxyRemoteRequest({
        url: body.url,
        method: body.method,
        headers: body.headers,
        body: body.body,
        timeoutMs: body.timeoutMs,
        provider: body.provider,
      })
      sendJson(res, 200, result)
    } finally {
      permit.release()
    }
    return true
  }

  // Streaming AI proxy (SSE passthrough) — same SSRF guard, body piped live.
  if (pathname === '/api/local/ai/proxy/stream' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const permit = acquireOperation('web')
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit))
      return true
    }
    try {
      await proxyRemoteStream(body, res)
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string }
      if (!res.headersSent)
        sendJson(res, err.statusCode || 502, {
          error: err.message || 'stream failed',
        })
      else {
        try {
          res.end()
        } catch {
          /* already ended */
        }
      }
    } finally {
      permit.release()
    }
    return true
  }

  return false
}
