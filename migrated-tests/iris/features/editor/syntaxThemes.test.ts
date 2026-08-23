import { describe, expect, it } from 'vitest'
import { clone_editor_settings, default_editor_settings } from '@/features/editor/editor/editorSettings'
import { get_syntax_theme_palette, syntax_color_scheme_options } from '@/features/editor/editor/syntaxThemes'

describe('editor syntax color schemes', () => {
  it('offers every configured semantic palette', () => {
    expect(syntax_color_scheme_options.map((option) => option.value)).toEqual([
      'default',
      'high-contrast',
      'modern',
      'soft',
      'classic',
    ])
  })

  it('keeps the selected scheme when settings are cloned', () => {
    const settings = clone_editor_settings(default_editor_settings)
    settings.appearance.syntax_color_scheme = 'high-contrast'
    expect(clone_editor_settings(settings).appearance.syntax_color_scheme).toBe('high-contrast')
  })

  it('provides separate dark and light palettes', () => {
    const dark = get_syntax_theme_palette('modern', 'dark')
    const light = get_syntax_theme_palette('modern', 'light')

    expect(dark.keyword).toBe('#c586c0')
    expect(light.keyword).toBe('#af00db')
    expect(dark.function).not.toBe(light.function)
  })
})
