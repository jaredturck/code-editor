// @ts-nocheck
/**
 * Exposes registration, roster, task posting, polling, result submission, status,
 * broadcast, and SSE endpoints for orchestrator and sub-agent coordination. Requests are
 * validated and bounded before shared task-bus state is changed.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js';
import {
  AGENT_SUSPEND_DURATION_MS,
  AGENT_SUSPEND_THRESHOLD,
  agentBusBroadcast,
  agentRoster,
  agentSSEClients,
  agentTaskQueue,
  agentTaskResults,
  agentTaskTimestamps,
  ensureBusAgent,
  pruneAgentTaskResults,
  readJsonBody,
  sendJson,
} from '../services/agentService.js';
import {
  AGENT_STATUS,
  TASK_STATUS,
  applyBroadcastToQueuedTasks,
  enqueueAgentTask,
  findActiveTaskStatus,
} from '../shared/agentBusShared.js';
import {
  inputErrorResponse,
  validateAgentId,
  validateBroadcastInput,
  validateCapabilities,
  validateStpTask,
  validateTaskId,
  validateTaskResult,
} from '../shared/agentInputValidation.js';
import {
  WORKLOAD_LIMITS,
  assertBelowLimit,
  hasQueuedTask,
  pruneOldestMapEntries,
  totalQueuedTasks,
  totalSseClients,
  workloadErrorResponse,
} from '../shared/workloadLimits.js';

let agentBusSeq = 0;

// Sends route error through the protocol owned by the local bridge router.
function sendRouteError(res, error) {
  const input = inputErrorResponse(error);
  const workload = workloadErrorResponse(error);
  const detail = error?.name === 'WorkloadLimitError' ? workload : input;
  sendJson(res, detail.statusCode, {
    error: detail.message,
    ...(detail.retryAfterMs ? { retryAfterMs: detail.retryAfterMs } : {}),
  });
}

/**
 * Handles the local multi-agent task bus: roster registration, task queues, results,
 * broadcasts, status, and event streams. Requests are validated and bounded before they can
 * add work or retained state to the shared runtime.
 */

export async function handleAgentRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/local/agent/register' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const agentId = validateAgentId(body?.agentId);
      if (!agentRoster.has(agentId)) {
        assertBelowLimit(agentRoster.size, WORKLOAD_LIMITS.agentRoster, 'Agent roster');
      }
      ensureBusAgent(agentId);
      const entry = agentRoster.get(agentId);
      entry.lastSeen = Date.now();
      entry.capabilities = validateCapabilities(body?.capabilities);
      sendJson(res, 200, { ok: true, agentId });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  if (pathname === '/api/local/agent/roster' && req.method === 'GET') {
    pruneAgentTaskResults();
    const agents = [];
    for (const [id, entry] of agentRoster) {
      agents.push({
        id,
        status: entry.status,
        lastSeen: entry.lastSeen,
        queueDepth: (agentTaskQueue.get(id) || []).length,
        health: { ...entry.health },
        capabilities: entry.capabilities || [],
      });
    }
    sendJson(res, 200, { agents });
    return true;
  }

  if (pathname === '/api/local/agent/task/post' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const stp = validateStpTask(body?.stp);
      const toAgent = stp.toAgent;
      const taskId = stp.taskId;
      if (agentTaskResults.has(taskId) || hasQueuedTask(agentTaskQueue, taskId)) {
        sendJson(res, 409, { error: `Task ${taskId} already exists` });
        return true;
      }
      if (!agentRoster.has(toAgent)) {
        assertBelowLimit(agentRoster.size, WORKLOAD_LIMITS.agentRoster, 'Agent roster');
      }
      ensureBusAgent(toAgent);
      const queue = agentTaskQueue.get(toAgent);
      assertBelowLimit(queue.length, WORKLOAD_LIMITS.agentQueuePerAgent, `${toAgent} queue`);
      assertBelowLimit(
        totalQueuedTasks(agentTaskQueue),
        WORKLOAD_LIMITS.agentQueueGlobal,
        'Global agent queue',
      );
      enqueueAgentTask(queue, stp);
      agentBusBroadcast(toAgent, { type: 'task_posted', taskId });
      sendJson(res, 200, { ok: true, taskId, queueDepth: queue.length });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  if (pathname === '/api/local/agent/task/poll' && req.method === 'GET') {
    try {
      const { searchParams } = new URL(req.url, 'http://localhost');
      const agentId = validateAgentId(searchParams.get('agentId'));
      if (!agentRoster.has(agentId)) {
        assertBelowLimit(agentRoster.size, WORKLOAD_LIMITS.agentRoster, 'Agent roster');
      }
      ensureBusAgent(agentId);
      const entry = agentRoster.get(agentId);
      entry.lastSeen = Date.now();
      const queue = agentTaskQueue.get(agentId);
      const nextTask = queue.shift() || null;
      if (nextTask) {
        entry.status = AGENT_STATUS.WORKING;
        entry.currentTaskId = nextTask.taskId;
      } else {
        entry.status = AGENT_STATUS.IDLE;
        entry.currentTaskId = null;
      }
      sendJson(res, 200, { task: nextTask });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  if (pathname === '/api/local/agent/task/result' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const normalized = validateTaskResult(body);
      const taskId = normalized.taskId;
      const agentId = normalized.agentId;
      const result = {
        ...normalized,
        result: normalized.result ?? null,
        completedAt: Date.now(),
      };
      agentTaskResults.set(taskId, result);
      agentTaskTimestamps.set(taskId, Date.now());
      pruneAgentTaskResults();
      pruneOldestMapEntries(agentTaskResults, WORKLOAD_LIMITS.agentResults);
      for (const key of agentTaskTimestamps.keys()) {
        if (!agentTaskResults.has(key)) agentTaskTimestamps.delete(key);
      }
      if (agentId) {
        if (!agentRoster.has(agentId)) {
          assertBelowLimit(agentRoster.size, WORKLOAD_LIMITS.agentRoster, 'Agent roster');
        }
        ensureBusAgent(agentId);
        const entry = agentRoster.get(agentId);
        entry.status = AGENT_STATUS.IDLE;
        entry.currentTaskId = null;
        entry.lastSeen = Date.now();
        if (result.status === TASK_STATUS.DONE) {
          entry.health.consecutiveFailures = 0;
          entry.health.suspended = false;
        } else {
          entry.health.consecutiveFailures += 1;
          if (entry.health.consecutiveFailures >= AGENT_SUSPEND_THRESHOLD) {
            entry.health.suspended = true;
            entry.health.suspendedUntil = Date.now() + AGENT_SUSPEND_DURATION_MS;
          }
        }
      }
      agentBusBroadcast('claude', { type: 'task_complete', taskId, result });
      ++agentBusSeq;
      sendJson(res, 200, { ok: true, taskId, seq: agentBusSeq });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  if (pathname === '/api/local/agent/task/status' && req.method === 'GET') {
    try {
      const { searchParams } = new URL(req.url, 'http://localhost');
      const taskId = validateTaskId(searchParams.get('taskId'));
      const result = agentTaskResults.get(taskId);
      if (result) {
        sendJson(res, 200, { taskId, status: result.status, ready: true });
        return true;
      }
      const status = findActiveTaskStatus(taskId, agentTaskQueue, agentRoster, {
        preferRunning: true,
      });
      sendJson(res, 200, { taskId, status, ready: false });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  if (pathname === '/api/local/agent/broadcast' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { message, contextUpdate } = validateBroadcastInput(body);
      applyBroadcastToQueuedTasks(agentTaskQueue, message, contextUpdate);
      for (const [agentId] of agentRoster) {
        agentBusBroadcast(agentId, { type: 'broadcast', message, contextUpdate });
      }
      sendJson(res, 200, { ok: true, message });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  if (pathname.startsWith('/api/local/agent/stream/') && req.method === 'GET') {
    try {
      const agentId = validateAgentId(pathname.replace('/api/local/agent/stream/', ''));
      if (!agentRoster.has(agentId)) {
        assertBelowLimit(agentRoster.size, WORKLOAD_LIMITS.agentRoster, 'Agent roster');
      }
      ensureBusAgent(agentId);
      const clients = agentSSEClients.get(agentId);
      assertBelowLimit(clients.size, WORKLOAD_LIMITS.agentSsePerAgent, `${agentId} SSE clients`);
      assertBelowLimit(
        totalSseClients(agentSSEClients),
        WORKLOAD_LIMITS.agentSseGlobal,
        'Global agent SSE clients',
      );
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`: connected to agent stream ${agentId}\n\n`);
      clients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(ping);
          clients.delete(res);
        }
      }, 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
    } catch (error) {
      sendRouteError(res, error);
    }
    return true;
  }

  return false;
}
