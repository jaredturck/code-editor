/**
 * Guards the todo list against tool-usage flooding: the lifecycle helpers
 * (ensureInProgress / completeInProgress / blockInProgress) advance the MODEL's own todos but
 * must NEVER fabricate a synthetic "Run <tool>" / "Completed <tool>" entry — that buried the
 * real, model-authored todos and misguided the agent.
 */
import { describe, expect, it } from 'vitest';
import { createTodoTool } from '@/platform/agent/runtime/todoTrace';

const stubTrace = () => ({ todo: () => {} });
const noop = () => {};

describe('todoTool anti-flood', () => {
  it('never fabricates a todo from tool-usage lifecycle calls', () => {
    const tool = createTodoTool([], stubTrace(), noop);
    // Simulate a run where the model created NO todos but tools ran.
    tool.ensureInProgress('Run terminal.exec');
    tool.completeInProgress('Completed terminal.exec');
    tool.blockInProgress('Blocked on files.read');
    tool.ensureInProgress('Run search.web');
    expect(tool.list()).toEqual([]); // stays empty — only model todos ever appear
  });

  it("still advances the model's own todos through the lifecycle", () => {
    const tool = createTodoTool([], stubTrace(), noop);
    tool.applyUpdates([{ op: 'add', text: 'real task', status: 'pending' }] as never);
    tool.ensureInProgress(); // promotes the model's pending todo, does not add one
    expect(tool.list()).toHaveLength(1);
    expect(tool.list()[0].status).toBe('in_progress');
    tool.completeInProgress();
    expect(tool.list()[0].status).toBe('done');
    expect(tool.list()).toHaveLength(1); // no extra synthetic entry
  });
});
