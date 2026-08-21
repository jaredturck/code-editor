/**
 * Exercises the observable agent bus shared contract, with regression cases for “preserves
 * the existing status values and result lifetime” and “places high-priority tasks at the
 * front and other tasks at the end”. The suite documents caller-visible behavior so
 * implementation refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_STATUS,
  AGENT_TASK_RESULT_TTL_MS,
  TASK_STATUS,
  applyBroadcastToQueuedTasks,
  enqueueAgentTask,
  findActiveTaskStatus,
  pruneExpiredTaskResults,
} from '../../server/desktopBridge/shared/agentBusShared.js';

interface TestTask {
  taskId: string;
  priority?: string;
  context?: Record<string, unknown>;
}

describe('shared multi-agent bus helpers', () => {
  it('preserves the existing status values and result lifetime', () => {
    expect(TASK_STATUS).toEqual({
      PENDING: 'pending',
      RUNNING: 'running',
      DONE: 'done',
      FAILED: 'failed',
      TIMEOUT: 'timeout',
      PARTIAL: 'partial',
    });
    expect(AGENT_STATUS).toEqual({
      IDLE: 'idle',
      WORKING: 'working',
      SUSPENDED: 'suspended',
    });
    expect(AGENT_TASK_RESULT_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('places high-priority tasks at the front and other tasks at the end', () => {
    const queue: TestTask[] = [{ taskId: 'existing' }];
    enqueueAgentTask(queue, { taskId: 'normal', priority: 'normal' });
    enqueueAgentTask(queue, { taskId: 'high', priority: 'high' });
    expect(queue.map((task) => task.taskId)).toEqual(['high', 'existing', 'normal']);
  });

  it('removes only results older than the configured lifetime', () => {
    const now = 1_000_000;
    const results = new Map([
      ['expired', { status: 'done' }],
      ['boundary', { status: 'done' }],
      ['fresh', { status: 'done' }],
    ]);
    const timestamps = new Map([
      ['expired', now - AGENT_TASK_RESULT_TTL_MS - 1],
      ['boundary', now - AGENT_TASK_RESULT_TTL_MS],
      ['fresh', now - 1],
    ]);

    expect(pruneExpiredTaskResults(results, timestamps, now)).toBe(1);
    expect([...results.keys()]).toEqual(['boundary', 'fresh']);
    expect([...timestamps.keys()]).toEqual(['boundary', 'fresh']);
  });

  it('reports queued, running, and unknown tasks while preserving bus precedence', () => {
    const queues = new Map([['executor', [{ taskId: 'queued' }, { taskId: 'both' }]]]);
    const roster = new Map([
      ['executor', { currentTaskId: 'running' }],
      ['scout', { currentTaskId: 'both' }],
    ]);

    expect(findActiveTaskStatus('queued', queues, roster)).toBe(TASK_STATUS.PENDING);
    expect(findActiveTaskStatus('running', queues, roster)).toBe(TASK_STATUS.RUNNING);
    expect(findActiveTaskStatus('missing', queues, roster)).toBe('unknown');
    expect(findActiveTaskStatus('both', queues, roster)).toBe(TASK_STATUS.PENDING);
    expect(findActiveTaskStatus('both', queues, roster, { preferRunning: true })).toBe(
      TASK_STATUS.RUNNING,
    );
  });

  it('merges broadcasts into queued task context only', () => {
    const first: TestTask = {
      taskId: 'a',
      context: { existing: true, root: '/old' },
    };
    const second: TestTask = { taskId: 'b' };
    const queues = new Map([
      ['executor', [first]],
      ['scout', [second]],
    ]);

    applyBroadcastToQueuedTasks(queues, 'updated intent', { root: '/project' });

    expect(first.context).toEqual({
      existing: true,
      root: '/project',
      broadcast: 'updated intent',
    });
    expect(second.context).toEqual({
      root: '/project',
      broadcast: 'updated intent',
    });
  });
});
