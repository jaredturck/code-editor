/**
 * Guards the loop-default cutover: the stateful append-only loop is now the DEFAULT for
 * native-tool models (cheaper — state is sent once and appended, not re-serialized every
 * step), while non-native/local models still fall back to the legacy structured loop.
 */
import { describe, expect, it } from 'vitest'
import { useStatefulLoop } from '@/platform/agent/runtime/config'

const native = { ai_provider: 'anthropic', ai_model: 'claude-opus-4-8' }
const local = { ai_provider: 'local', ai_model: 'gemma3' }

describe('useStatefulLoop', () => {
  it('defaults ON for a native-tool model (no agent_stateful_loop set → auto)', () => {
    expect(useStatefulLoop({ ...native })).toBe(true)
  })

  it('stays OFF for a non-native / local model regardless of the default', () => {
    expect(useStatefulLoop({ ...local })).toBe(false)
  })

  it('honors an explicit off and native_tools_enabled:false', () => {
    expect(useStatefulLoop({ ...native, agent_stateful_loop: 'off' })).toBe(false)
    expect(useStatefulLoop({ ...native, native_tools_enabled: false })).toBe(false)
  })
})
