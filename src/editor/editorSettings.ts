import type { EditorFeaturePreset, EditorSettings } from '../types/editor'

export const default_editor_settings: EditorSettings = {
  theme_mode: 'dark',
  recent_files: [],
  restore_recent_files: true,
  confirm_unsaved_close: true,
  default_language: 'Plain Text',
  editor_preset: 'balanced',
  editor: {
    default_indent_style: 'spaces',
    default_indent_size: 4,
    auto_indent: true,
    close_brackets: true,
    bracket_matching: true,
    multiple_selections: true,
    code_folding: true,
    fold_gutter: true,
    word_wrap: false,
  },
  appearance: {
    line_numbers: true,
    highlight_active_line: true,
    highlight_selection_matches: true,
    render_whitespace: 'off',
    highlight_trailing_whitespace: false,
    show_special_characters: true,
    scroll_past_end: false,
  },
  suggestions: {
    mode: 'typing',
    accept_on_enter: true,
    show_details: true,
    show_type_icons: true,
    delay: 100,
  },
  keybindings: {},
}

export function clone_editor_settings(settings: EditorSettings): EditorSettings {
  return {
    ...settings,
    recent_files: [...settings.recent_files],
    editor: { ...settings.editor },
    appearance: { ...settings.appearance },
    suggestions: { ...settings.suggestions },
    keybindings: Object.fromEntries(
      Object.entries(settings.keybindings).map(([command_id, keybinding]) => [command_id, { ...keybinding }]),
    ),
  }
}

export function apply_editor_preset(settings: EditorSettings, preset: Exclude<EditorFeaturePreset, 'custom'>) {
  const next_settings = clone_editor_settings(settings)

  next_settings.editor_preset = preset

  if (preset === 'minimal') {
    next_settings.editor = {
      ...next_settings.editor,
      auto_indent: true,
      close_brackets: true,
      bracket_matching: true,
      multiple_selections: false,
      code_folding: true,
      fold_gutter: false,
      word_wrap: false,
    }
    next_settings.appearance = {
      ...next_settings.appearance,
      line_numbers: true,
      highlight_active_line: false,
      highlight_selection_matches: false,
      render_whitespace: 'off',
      highlight_trailing_whitespace: false,
      show_special_characters: false,
      scroll_past_end: false,
    }
    next_settings.suggestions = {
      ...next_settings.suggestions,
      mode: 'manual',
      show_details: false,
      show_type_icons: false,
    }
  }

  if (preset === 'balanced') {
    next_settings.editor = { ...default_editor_settings.editor }
    next_settings.appearance = { ...default_editor_settings.appearance }
    next_settings.suggestions = { ...default_editor_settings.suggestions }
  }

  if (preset === 'full') {
    next_settings.editor = {
      ...default_editor_settings.editor,
      multiple_selections: true,
      word_wrap: true,
    }
    next_settings.appearance = {
      ...default_editor_settings.appearance,
      highlight_trailing_whitespace: true,
      scroll_past_end: true,
    }
    next_settings.suggestions = {
      ...default_editor_settings.suggestions,
      mode: 'typing',
      show_details: true,
      show_type_icons: true,
    }
  }

  return next_settings
}
