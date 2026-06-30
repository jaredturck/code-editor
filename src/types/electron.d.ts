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
