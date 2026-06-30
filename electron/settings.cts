import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type ThemeMode = 'light' | 'dark' | 'system'
type EditorFeaturePreset = 'minimal' | 'balanced' | 'full' | 'custom'
type SuggestionMode = 'off' | 'manual' | 'typing'
type RenderWhitespaceMode = 'off' | 'all'
type IndentStyle = 'spaces' | 'tabs'
type DiagnosticsMode = 'off' | 'save' | 'typing'

export interface AppSettings {
  theme_mode: ThemeMode
  recent_files: string[]
  restore_recent_files: boolean
  confirm_unsaved_close: boolean
  default_language: string
  editor_preset: EditorFeaturePreset
  editor: {
    default_indent_style: IndentStyle
    default_indent_size: number
    auto_indent: boolean
    close_brackets: boolean
    bracket_matching: boolean
    multiple_selections: boolean
    code_folding: boolean
    fold_gutter: boolean
    word_wrap: boolean
  }
  appearance: {
    line_numbers: boolean
    highlight_active_line: boolean
    highlight_selection_matches: boolean
    render_whitespace: RenderWhitespaceMode
    highlight_trailing_whitespace: boolean
    show_special_characters: boolean
    scroll_past_end: boolean
  }
  suggestions: {
    mode: SuggestionMode
    accept_on_enter: boolean
    show_details: boolean
    show_type_icons: boolean
    delay: number
  }
  diagnostics: {
    mode: DiagnosticsMode
    delay: number
    show_squiggles: boolean
    show_gutter: boolean
    show_hover: boolean
    auto_reveal_problems: boolean
    enable_python: boolean
    enable_javascript: boolean
    enable_typescript: boolean
    enable_css: boolean
    enable_html: boolean
    enable_json: boolean
    enable_yaml: boolean
    enable_markdown: boolean
    enable_parser_fallback: boolean
  }
  ai: {
    ollama_url: string
    selected_model: string
    speech_model: string
  }
  keybindings: Record<string, { enabled: boolean; key: string | null }>
}

export const default_settings: AppSettings = {
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
  diagnostics: {
    mode: 'typing',
    delay: 2500,
    show_squiggles: true,
    show_gutter: true,
    show_hover: true,
    auto_reveal_problems: false,
    enable_python: true,
    enable_javascript: true,
    enable_typescript: true,
    enable_css: true,
    enable_html: true,
    enable_json: true,
    enable_yaml: true,
    enable_markdown: true,
    enable_parser_fallback: true,
  },
  ai: {
    ollama_url: 'http://127.0.0.1:11434',
    selected_model: '',
    speech_model: 'gabegoodhart/granite4.1-speech:2b',
  },
  keybindings: {},
}

let settings_cache: AppSettings | null = null
let settings_write_queue = Promise.resolve()

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boolean_setting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function string_setting(value: unknown, fallback: string, maximum = 500) {
  return typeof value === 'string' && value.length <= maximum ? value : fallback
}

export function sanitize_settings(value: unknown): AppSettings {
  if (!is_record(value)) {
    return structuredClone(default_settings)
  }

  const editor = is_record(value.editor) ? value.editor : {}
  const appearance = is_record(value.appearance) ? value.appearance : {}
  const suggestions = is_record(value.suggestions) ? value.suggestions : {}
  const diagnostics = is_record(value.diagnostics) ? value.diagnostics : {}
  const ai = is_record(value.ai) ? value.ai : {}
  const raw_keybindings = is_record(value.keybindings) ? value.keybindings : {}
  const keybindings: AppSettings['keybindings'] = {}

  for (const [command_id, raw_binding] of Object.entries(raw_keybindings)) {
    if (!is_record(raw_binding)) {
      continue
    }

    const key =
      typeof raw_binding.key === 'string' &&
      raw_binding.key.length > 0 &&
      raw_binding.key.length <= 64 &&
      !Array.from(raw_binding.key).some((character) => character.charCodeAt(0) < 32)
        ? raw_binding.key
        : null
    keybindings[command_id] = {
      enabled: boolean_setting(raw_binding.enabled, true),
      key,
    }
  }

  const theme_mode =
    value.theme_mode === 'light' || value.theme_mode === 'dark' || value.theme_mode === 'system'
      ? value.theme_mode
      : default_settings.theme_mode
  const recent_files = Array.isArray(value.recent_files)
    ? value.recent_files.filter((file_path): file_path is string => typeof file_path === 'string').slice(0, 5)
    : []
  const restore_recent_files = boolean_setting(value.restore_recent_files, default_settings.restore_recent_files)
  const editor_preset =
    value.editor_preset === 'minimal' ||
    value.editor_preset === 'balanced' ||
    value.editor_preset === 'full' ||
    value.editor_preset === 'custom'
      ? value.editor_preset
      : default_settings.editor_preset
  const default_indent_style =
    editor.default_indent_style === 'tabs' || editor.default_indent_style === 'spaces'
      ? editor.default_indent_style
      : default_settings.editor.default_indent_style
  const default_indent_size =
    typeof editor.default_indent_size === 'number' && [2, 4, 8].includes(editor.default_indent_size)
      ? editor.default_indent_size
      : default_settings.editor.default_indent_size
  const render_whitespace =
    appearance.render_whitespace === 'all' || appearance.render_whitespace === 'off'
      ? appearance.render_whitespace
      : default_settings.appearance.render_whitespace
  const suggestion_mode =
    suggestions.mode === 'off' || suggestions.mode === 'manual' || suggestions.mode === 'typing'
      ? suggestions.mode
      : default_settings.suggestions.mode
  const suggestion_delay =
    typeof suggestions.delay === 'number' && suggestions.delay >= 0 && suggestions.delay <= 2000
      ? Math.round(suggestions.delay)
      : default_settings.suggestions.delay
  const diagnostics_mode =
    diagnostics.mode === 'off' || diagnostics.mode === 'save' || diagnostics.mode === 'typing'
      ? diagnostics.mode
      : default_settings.diagnostics.mode
  const diagnostics_delay =
    typeof diagnostics.delay === 'number' && diagnostics.delay >= 500 && diagnostics.delay <= 10000
      ? Math.round(diagnostics.delay)
      : default_settings.diagnostics.delay

  return {
    theme_mode,
    recent_files: restore_recent_files ? recent_files : [],
    restore_recent_files,
    confirm_unsaved_close: boolean_setting(value.confirm_unsaved_close, default_settings.confirm_unsaved_close),
    default_language: string_setting(value.default_language, default_settings.default_language, 100),
    editor_preset,
    editor: {
      default_indent_style,
      default_indent_size,
      auto_indent: boolean_setting(editor.auto_indent, default_settings.editor.auto_indent),
      close_brackets: boolean_setting(editor.close_brackets, default_settings.editor.close_brackets),
      bracket_matching: boolean_setting(editor.bracket_matching, default_settings.editor.bracket_matching),
      multiple_selections: boolean_setting(editor.multiple_selections, default_settings.editor.multiple_selections),
      code_folding: boolean_setting(editor.code_folding, default_settings.editor.code_folding),
      fold_gutter: boolean_setting(editor.fold_gutter, default_settings.editor.fold_gutter),
      word_wrap: boolean_setting(editor.word_wrap, default_settings.editor.word_wrap),
    },
    appearance: {
      line_numbers: boolean_setting(appearance.line_numbers, default_settings.appearance.line_numbers),
      highlight_active_line: boolean_setting(
        appearance.highlight_active_line,
        default_settings.appearance.highlight_active_line,
      ),
      highlight_selection_matches: boolean_setting(
        appearance.highlight_selection_matches,
        default_settings.appearance.highlight_selection_matches,
      ),
      render_whitespace,
      highlight_trailing_whitespace: boolean_setting(
        appearance.highlight_trailing_whitespace,
        default_settings.appearance.highlight_trailing_whitespace,
      ),
      show_special_characters: boolean_setting(
        appearance.show_special_characters,
        default_settings.appearance.show_special_characters,
      ),
      scroll_past_end: boolean_setting(appearance.scroll_past_end, default_settings.appearance.scroll_past_end),
    },
    suggestions: {
      mode: suggestion_mode,
      accept_on_enter: boolean_setting(suggestions.accept_on_enter, default_settings.suggestions.accept_on_enter),
      show_details: boolean_setting(suggestions.show_details, default_settings.suggestions.show_details),
      show_type_icons: boolean_setting(suggestions.show_type_icons, default_settings.suggestions.show_type_icons),
      delay: suggestion_delay,
    },
    diagnostics: {
      mode: diagnostics_mode,
      delay: diagnostics_delay,
      show_squiggles: boolean_setting(diagnostics.show_squiggles, default_settings.diagnostics.show_squiggles),
      show_gutter: boolean_setting(diagnostics.show_gutter, default_settings.diagnostics.show_gutter),
      show_hover: boolean_setting(diagnostics.show_hover, default_settings.diagnostics.show_hover),
      auto_reveal_problems: boolean_setting(
        diagnostics.auto_reveal_problems,
        default_settings.diagnostics.auto_reveal_problems,
      ),
      enable_python: boolean_setting(diagnostics.enable_python, default_settings.diagnostics.enable_python),
      enable_javascript: boolean_setting(diagnostics.enable_javascript, default_settings.diagnostics.enable_javascript),
      enable_typescript: boolean_setting(diagnostics.enable_typescript, default_settings.diagnostics.enable_typescript),
      enable_css: boolean_setting(diagnostics.enable_css, default_settings.diagnostics.enable_css),
      enable_html: boolean_setting(diagnostics.enable_html, default_settings.diagnostics.enable_html),
      enable_json: boolean_setting(diagnostics.enable_json, default_settings.diagnostics.enable_json),
      enable_yaml: boolean_setting(diagnostics.enable_yaml, default_settings.diagnostics.enable_yaml),
      enable_markdown: boolean_setting(diagnostics.enable_markdown, default_settings.diagnostics.enable_markdown),
      enable_parser_fallback: boolean_setting(
        diagnostics.enable_parser_fallback,
        default_settings.diagnostics.enable_parser_fallback,
      ),
    },
    ai: {
      ollama_url: string_setting(ai.ollama_url, default_settings.ai.ollama_url, 500),
      selected_model: string_setting(ai.selected_model, default_settings.ai.selected_model, 300),
      speech_model: string_setting(ai.speech_model, default_settings.ai.speech_model, 300),
    },
    keybindings,
  }
}

export async function read_settings() {
  if (settings_cache) {
    return settings_cache
  }

  try {
    const settings_text = await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8')
    settings_cache = sanitize_settings(JSON.parse(settings_text))
  } catch {
    settings_cache = structuredClone(default_settings)
  }

  return settings_cache
}

export async function update_settings(next_settings: Partial<AppSettings>) {
  const current_settings = await read_settings()
  const settings = sanitize_settings({ ...current_settings, ...next_settings })

  settings_cache = settings
  settings_write_queue = settings_write_queue
    .catch(() => undefined)
    .then(() => writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2), 'utf8'))

  try {
    await settings_write_queue
  } catch {
    return settings
  }

  return settings
}
