/**
 * Exercises the observable process execution contract, with regression cases for “passes
 * shell metacharacters as literal arguments without invoking a shell”. The suite documents
 * caller-visible behavior so implementation refactors cannot silently weaken those
 * guarantees.
 */

import { describe, expect, it } from 'vitest'
import { runProcess } from '../../server/desktopBridge/shared/processExecution'

describe('structured process execution', () => {
  it('passes shell metacharacters as literal arguments without invoking a shell', async () => {
    const payload = 'literal;$(echo injected)|value'
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', payload], {
      timeoutMs: 5000,
    })

    expect(result.stdout).toBe(payload)
    expect(result.exitCode).toBe(0)
  })
})
