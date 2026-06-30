import { describe, expect, it } from 'vitest'
import { apply_editor_preset, clone_editor_settings, default_editor_settings } from '../src/editor/editorSettings'

describe('editor settings', () => {
  it('fills missing nested settings with defaults', () => {
    const partial = {
      ...default_editor_settings,
      editor: { ...default_editor_settings.editor, word_wrap: true },
      diagnostics: { ...default_editor_settings.diagnostics, delay: 4000 },
    }
    const cloned = clone_editor_settings(partial)

    expect(cloned.editor.word_wrap).toBe(true)
    expect(cloned.editor.close_brackets).toBe(true)
    expect(cloned.diagnostics.delay).toBe(4000)
    expect(cloned.ai.ollama_url).toBe('http://127.0.0.1:11434')
  })

  it('applies presets without mutating the source settings', () => {
    const source = clone_editor_settings(default_editor_settings)
    const full = apply_editor_preset(source, 'full')

    expect(full.editor.word_wrap).toBe(true)
    expect(full.appearance.highlight_trailing_whitespace).toBe(true)
    expect(source.editor.word_wrap).toBe(false)
  })
})
