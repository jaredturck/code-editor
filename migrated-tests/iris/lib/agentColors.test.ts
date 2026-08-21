/**
 * Stable per-agent colors for the multi-model transparency UI (Workstream D): known roles
 * keep fixed colors, unknown ids hash deterministically, and the mapping never changes for
 * the same input (so the legend stays meaningful across a session).
 */
import { describe, expect, it } from 'vitest';
import { colorForAgent, agentBadgeLabel } from '@/platform/agentColors';

describe('agentColors', () => {
  it('gives known roles fixed, distinct colors', () => {
    expect(colorForAgent('orchestrator')).toBe('#6C9EFF');
    expect(colorForAgent('executor')).toBe('#34D399');
    expect(colorForAgent('scout')).toBe('#F59E0B');
    expect(colorForAgent('EXECUTOR')).toBe('#34D399'); // case-insensitive
  });

  it('is deterministic for unknown ids', () => {
    const a = colorForAgent('peer-xyz');
    const b = colorForAgent('peer-xyz');
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('falls back to a neutral color for empty input', () => {
    expect(colorForAgent('')).toBe('#6C9EFF');
    expect(colorForAgent(null)).toBe('#6C9EFF');
  });

  it('labels the orchestrator as OWNER', () => {
    expect(agentBadgeLabel('orchestrator')).toBe('OWNER');
    expect(agentBadgeLabel('scout')).toBe('scout');
  });
});
