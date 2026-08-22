import { describe, expect, it } from 'vitest'

import {
  is_privileged_editor_preload,
  is_trusted_renderer_navigation,
} from '../electron/navigationSecurity.cts'

describe('privileged renderer navigation security', () => {
  it('identifies only the privileged editor preload', () => {
    expect(is_privileged_editor_preload('/opt/code-editor/dist-electron/preload.cjs')).toBe(true)
    expect(is_privileged_editor_preload('C:\\CodeEditor\\preload.cjs')).toBe(true)
    expect(is_privileged_editor_preload('/opt/code-editor/other-preload.cjs')).toBe(false)
    expect(is_privileged_editor_preload(undefined)).toBe(false)
  })

  it('keeps development navigation on the trusted renderer origin', () => {
    const trusted = 'http://localhost:5173'
    expect(is_trusted_renderer_navigation('http://localhost:5173/', trusted)).toBe(true)
    expect(is_trusted_renderer_navigation('http://localhost:5173/?bridgePort=123#chat', trusted)).toBe(true)
    expect(is_trusted_renderer_navigation('https://example.com/', trusted)).toBe(false)
    expect(is_trusted_renderer_navigation('http://127.0.0.1:5173/', trusted)).toBe(false)
    expect(is_trusted_renderer_navigation('file:///tmp/index.html', trusted)).toBe(false)
  })

  it('allows only the packaged editor entry document plus query/hash changes', () => {
    const trusted = 'file:///opt/code-editor/dist/index.html'
    expect(is_trusted_renderer_navigation('file:///opt/code-editor/dist/index.html?bridgePort=123#chat', trusted)).toBe(true)
    expect(is_trusted_renderer_navigation('file:///opt/code-editor/dist/other.html', trusted)).toBe(false)
    expect(is_trusted_renderer_navigation('https://example.com/', trusted)).toBe(false)
  })
})
