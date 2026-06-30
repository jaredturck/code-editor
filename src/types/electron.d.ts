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
}

interface SavedTextFile {
  status: 'saved'
  file_path: string
  name: string
}

interface MissingTextFile {
  status: 'missing'
}

type SaveTextFileResult = SavedTextFile | MissingTextFile | null

interface FileApi {
  save_text: (options: SaveTextFileOptions) => Promise<SaveTextFileResult>
  check_paths: (file_paths: string[]) => Promise<Record<string, boolean>>
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
  file: FileApi
  window: WindowControlsApi
}

interface Window {
  editor_api: EditorApi
}
