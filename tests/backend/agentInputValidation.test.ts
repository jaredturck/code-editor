/**
 * Exercises the observable agent input validation contract, with regression cases for
 * “preserves supported current and legacy agent roles” and “accepts known capability
 * namespaces and rejects invented privileges”. The suite documents caller-visible behavior
 * so implementation refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it } from 'vitest'
import {
  InputValidationError,
  validateAgentRole,
  validateCapabilities,
  validateStpTask,
  validateTaskResult,
  validateTrainingMessage,
} from '../../backend/desktopBridge/shared/agentInputValidation'

describe('agent input validation', () => {
  it('preserves supported current and legacy agent roles', () => {
    expect(validateAgentRole('orchestrator')).toBe('orchestrator')
    expect(validateAgentRole('executor')).toBe('executor')
    expect(validateAgentRole('scout')).toBe('scout')
    expect(validateAgentRole('claude')).toBe('claude')
    expect(validateAgentRole('deepseek')).toBe('deepseek')
    expect(validateAgentRole('local')).toBe('local')
  })

  it('accepts known capability namespaces and rejects invented privileges', () => {
    expect(validateCapabilities(['files.read', 'terminal.exec', 'screen.capture'])).toEqual([
      'files.read',
      'terminal.exec',
      'screen.capture',
    ])
    expect(() => validateCapabilities(['root_access.disable_security'])).toThrow(InputValidationError)
  })

  it('normalizes valid STP tasks without dropping compatible fields', () => {
    const task = validateStpTask({
      taskId: 'task-1',
      toAgent: 'executor',
      type: 'execute',
      goal: 'Inspect the project',
      priority: 'high',
      tools: { available: ['files.read'] },
      context: { root: '/project' },
      customField: true,
    })

    expect(task).toMatchObject({
      taskId: 'task-1',
      toAgent: 'executor',
      goal: 'Inspect the project',
      priority: 'high',
      customField: true,
    })
  })

  it('rejects oversized training input and invalid task result statuses', () => {
    expect(() => validateTrainingMessage('x'.repeat(64001))).toThrow(InputValidationError)
    expect(() => validateTaskResult({ taskId: 'task-1', status: 'exploded' })).toThrow(InputValidationError)
  })
})
