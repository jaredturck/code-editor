export type ActivitySection = 'explorer' | 'search' | 'source-control'
export type BottomPanelTab = 'problems' | 'terminal'
export type ThemeMode = 'light' | 'dark' | 'system'
export type TopMenu = 'file' | 'edit' | 'go' | 'view' | 'terminal' | null
export type IndentStyle = 'spaces' | 'tabs'
export type EditorFeaturePreset = 'minimal' | 'balanced' | 'full' | 'custom'
export type SuggestionMode = 'off' | 'manual' | 'typing'
export type RenderWhitespaceMode = 'off' | 'all'

export type EditorCommandId =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select_all'
  | 'select_next_occurrence'
  | 'move_line_up'
  | 'move_line_down'
  | 'copy_line_up'
  | 'copy_line_down'
  | 'delete_line'
  | 'insert_line_above'
  | 'insert_line_below'
  | 'indent'
  | 'outdent'
  | 'auto_indent_selection'
  | 'toggle_line_comment'
  | 'toggle_block_comment'
  | 'add_cursor_above'
  | 'add_cursor_below'
  | 'go_to_line'
  | 'go_to_matching_bracket'
  | 'next_match'
  | 'previous_match'
  | 'fold'
  | 'unfold'
  | 'fold_all'
  | 'unfold_all'
  | 'find'
  | 'replace'
  | 'trigger_suggestions'

export interface EditorKeybinding {
  enabled: boolean
  key: string | null
}

export type EditorKeybindingOverrides = Partial<Record<EditorCommandId, EditorKeybinding>>

export interface EditorBehaviorSettings {
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

export interface EditorAppearanceSettings {
  line_numbers: boolean
  highlight_active_line: boolean
  highlight_selection_matches: boolean
  render_whitespace: RenderWhitespaceMode
  highlight_trailing_whitespace: boolean
  show_special_characters: boolean
  scroll_past_end: boolean
}

export interface EditorSuggestionSettings {
  mode: SuggestionMode
  accept_on_enter: boolean
  show_details: boolean
  show_type_icons: boolean
  delay: number
}

export interface EditorSettings {
  theme_mode: ThemeMode
  recent_files: string[]
  restore_recent_files: boolean
  confirm_unsaved_close: boolean
  default_language: string
  editor_preset: EditorFeaturePreset
  editor: EditorBehaviorSettings
  appearance: EditorAppearanceSettings
  suggestions: EditorSuggestionSettings
  keybindings: EditorKeybindingOverrides
}

export interface TextEditorDocument {
  kind: 'text'
  id: number
  name: string
  content: string
  saved_content: string
  file_path: string | null
  language: string
  indent_style: IndentStyle
  indent_size: number
  dirty: boolean
  deleted: boolean
}

export interface BrowserEditorDocument {
  kind: 'browser'
  id: number
  name: string
  url: string
  can_go_back: boolean
  can_go_forward: boolean
  loading: boolean
}

export type EditorDocument = TextEditorDocument | BrowserEditorDocument

export interface TerminalSession {
  id: number
  name: string
  history: string[]
  input: string
  parent_id: number | null
  weight: number
}
