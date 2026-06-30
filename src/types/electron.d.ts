interface WindowControlsApi {
  minimize: () => void
  toggle_maximize: () => void
  close: () => void
  is_maximized: () => Promise<boolean>
  on_maximized_change: (callback: (is_maximized: boolean) => void) => () => void
  on_focus: (callback: () => void) => () => void
}

interface AppControlsApi {
  exit: () => void
}

interface DialogApi {
  open_file: () => Promise<string | null>
  open_folder: () => Promise<string | null>
}

interface SaveTextFileOptions {
  content: string
  file_path: string | null
  save_as: boolean
  suggested_name: string
  file_type_name: string
  file_extensions: string[]
}

interface SavedTextFile {
  status: 'saved'
  file_path: string
  name: string
}

interface MissingTextFile {
  status: 'missing'
}

interface OpenedTextFile {
  status: 'opened'
  file_path: string
  name: string
  content: string
}

interface FailedTextFile {
  status: 'missing' | 'unsupported' | 'error'
  message: string
}

type SaveTextFileResult = SavedTextFile | MissingTextFile | null
type ReadTextFileResult = OpenedTextFile | FailedTextFile

interface FileApi {
  save_text: (options: SaveTextFileOptions) => Promise<SaveTextFileResult>
  read_text: (file_path: string) => Promise<ReadTextFileResult>
  check_paths: (file_paths: string[]) => Promise<Record<string, boolean>>
}

interface EditApi {
  copy: () => void
  cut: () => void
  paste: () => void
}

interface EditorSettings {
  theme_mode: 'light' | 'dark' | 'system'
  recent_files: string[]
  restore_recent_files: boolean
  confirm_unsaved_close: boolean
  default_language: string
  editor_preset: 'minimal' | 'balanced' | 'full' | 'custom'
  editor: {
    default_indent_style: 'spaces' | 'tabs'
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
    render_whitespace: 'off' | 'all'
    highlight_trailing_whitespace: boolean
    show_special_characters: boolean
    scroll_past_end: boolean
  }
  suggestions: {
    mode: 'off' | 'manual' | 'typing'
    accept_on_enter: boolean
    show_details: boolean
    show_type_icons: boolean
    delay: number
  }
  keybindings: Partial<Record<string, { enabled: boolean; key: string | null }>>
}

interface SettingsApi {
  get: () => Promise<EditorSettings>
  update: (settings: Partial<EditorSettings>) => Promise<EditorSettings>
}

interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

interface BrowserState {
  id: number
  title: string
  url: string
  can_go_back: boolean
  can_go_forward: boolean
  loading: boolean
}

interface BrowserApi {
  create: (id: number, url: string) => Promise<BrowserState>
  destroy: (id: number) => void
  set_bounds: (id: number, bounds: BrowserBounds) => void
  set_visible: (id: number, visible: boolean) => void
  navigate: (id: number, value: string) => void
  go_back: (id: number) => void
  go_forward: (id: number) => void
  reload: (id: number) => void
  on_state_change: (callback: (state: BrowserState) => void) => () => void
}

interface EditorApi {
  platform: string
  app: AppControlsApi
  browser: BrowserApi
  dialog: DialogApi
  edit: EditApi
  file: FileApi
  settings: SettingsApi
  window: WindowControlsApi
}

interface Window {
  editor_api: EditorApi
}
