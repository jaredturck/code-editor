/**
 * Exercises the observable agent run store contract, with regression cases for “starts with
 * an empty run history” and “normalizes and sorts runs newest first”. The suite documents
 * caller-visible behavior so implementation refactors cannot silently weaken those
 * guarantees.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_STATES,
  DELEGATION_STATUS,
  appendAgentRun,
  clearAgentRuns,
  formatAgentRunMarkdown,
  readAgentRuns,
  writeAgentRuns,
} from '@/platform/agentRunStore';

describe('agentRunStore', () => {
  it('starts with an empty run history', () => {
    expect(readAgentRuns()).toEqual([]);
  });

  it('normalizes and sorts runs newest first', () => {
    const runs = writeAgentRuns([
      { id: 'older', createdAt: 100, steps: '2' },
      { id: 'newer', createdAt: 200, steps: 3 },
    ]);
    expect(runs.map((run) => run.id)).toEqual(['newer', 'older']);
    expect(runs[1].steps).toBe(2);
  });

  it('normalizes nested timeline, todo, skill, safety, and summary data', () => {
    const [run] = writeAgentRuns([
      {
        id: 'run-1',
        createdAt: 100,
        timeline: [
          {
            type: 'tool_result',
            tool: 'files.read',
            status: 'ok',
            chart: { value: '2', max: '4' },
            provider: 'openai',
            model: 'gpt-4.1',
            purpose: 'consult',
            reason: 'architecture review',
            requestNumber: '1',
            requestLimit: '3',
          },
        ],
        todos: [{ text: 'Task', status: 'INVALID' }],
        skills: {
          profile: 'openai-gpt4o',
          active: [{ id: 'one', title: 'One' }],
        },
        safety: {
          profile: 'strict',
          blockSudo: false,
          allowNetworkCommands: true,
          maxSteps: '6',
        },
        summary: {
          toolCalls: '2',
          usage: { totalTokens: '99', estimatedOnly: true },
        },
      },
    ]);

    expect(run.timeline[0]).toMatchObject({
      type: 'tool_result',
      tool: 'files.read',
      status: 'ok',
      provider: 'openai',
      model: 'gpt-4.1',
      requestNumber: 1,
      requestLimit: 3,
    });
    expect(run.timeline[0].chart).toMatchObject({ value: 2, max: 4 });
    expect(run.todos[0].status).toBe('pending');
    expect(run.skills.active).toEqual([{ id: 'one', title: 'One' }]);
    expect(run.safety).toMatchObject({
      blockSudo: false,
      allowNetworkCommands: true,
      maxSteps: 6,
    });
    expect(run.summary?.usage).toMatchObject({
      totalTokens: 99,
      estimatedOnly: true,
    });
  });

  it('truncates oversized text fields', () => {
    const [run] = writeAgentRuns([
      { id: 'run', userInput: 'x'.repeat(2000), reply: 'y'.repeat(9000) },
    ]);
    expect(run.userInput).toHaveLength(1200);
    expect(run.reply).toHaveLength(8000);
  });

  it('caps timeline and todo lengths', () => {
    const timeline = Array.from({ length: 400 }, (_, id) => ({
      id,
      type: 'event',
    }));
    const todos = Array.from({ length: 150 }, (_, id) => ({
      id,
      text: `Todo ${id}`,
    }));
    const [run] = writeAgentRuns([{ id: 'run', timeline, todos }]);
    expect(run.timeline).toHaveLength(320);
    expect(run.todos).toHaveLength(120);
  });

  it('appends runs and replaces duplicate ids', () => {
    appendAgentRun({ id: 'same', createdAt: 100, reply: 'old' });
    const runs = appendAgentRun({ id: 'same', createdAt: 200, reply: 'new' });
    expect(runs).toHaveLength(1);
    expect(runs[0].reply).toBe('new');
  });

  it('enforces the minimum history cap of five', () => {
    for (let index = 0; index < 8; index += 1) {
      appendAgentRun({ id: `run-${index}`, createdAt: index }, 1);
    }
    expect(readAgentRuns()).toHaveLength(5);
  });

  it('clears run history', () => {
    appendAgentRun({ id: 'run' });
    expect(clearAgentRuns()).toEqual([]);
    expect(readAgentRuns()).toEqual([]);
  });

  it('formats a complete Markdown trace', () => {
    const markdown = formatAgentRunMarkdown({
      id: 'run-1',
      createdAt: Date.UTC(2026, 0, 1, 12, 0, 0),
      userInput: 'Inspect the project',
      reply: 'Done',
      steps: 2,
      skills: { profile: 'openai-gpt4o', active: [] },
      safety: {
        profile: 'strict',
        blockSudo: true,
        allowNetworkCommands: false,
      },
      summary: { toolCalls: 1 },
      timeline: [
        {
          at: Date.UTC(2026, 0, 1, 12, 0, 1),
          type: 'tool_call',
          tool: 'files.read',
          argsPreview: 'README.md',
        },
        {
          at: Date.UTC(2026, 0, 1, 12, 0, 2),
          type: 'tool_result',
          tool: 'files.read',
          status: 'ok',
          outputPreview: 'content',
        },
      ],
      todos: [{ text: 'Read file', status: 'done' }],
    });

    expect(markdown).toContain('# Agent Run run-1');
    expect(markdown).toContain('## User Request');
    expect(markdown).toContain('tool_call:files.read :: README.md');
    expect(markdown).toContain('tool_result:files.read:ok :: content');
    expect(markdown).toContain('- [done] Read file');
    expect(markdown).toContain('## Assistant Reply');
  });

  it('exports stable state constants', () => {
    expect(AGENT_STATES.AWAITING_APPROVAL).toBe('awaiting_approval');
    expect(DELEGATION_STATUS.ESCALATED).toBe('escalated');
  });
});
