import type { AIModel, EditorSettings } from './editor'

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
  confirm_close: (allow_close: boolean) => void
  on_close_request: (callback: () => void) => () => void
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

interface OpenedEditorFile {
  status: 'opened'
  kind: 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'unsupported'
  file_path: string
  name: string
  content?: string
  resource_url?: string
  mime_type: string
  size: number
}

interface FailedEditorFile {
  status: 'missing' | 'error'
  message: string
}

type SaveTextFileResult = SavedTextFile | MissingTextFile | null
type OpenEditorFileResult = OpenedEditorFile | FailedEditorFile

interface ResolvedRelativeFile {
  file_path: string
  resource_url: string
}

interface ReadAttachmentResult {
  name: string
  type: 'text' | 'image'
  mime_type: string
  content: string
}

interface FileApi {
  save_text: (options: SaveTextFileOptions) => Promise<SaveTextFileResult>
  open: (file_path: string) => Promise<OpenEditorFileResult>
  check_paths: (file_paths: string[]) => Promise<Record<string, boolean>>
  resolve_relative: (base_file_path: string, relative_path: string) => Promise<ResolvedRelativeFile | null>
  read_attachment: (file_path: string) => Promise<ReadAttachmentResult>
  open_external: (url: string) => void
}

interface EditApi {
  copy: () => void
  cut: () => void
  paste: () => void
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

interface TerminalApi {
  create: (terminal_id: number) => Promise<{ shell: string; cwd: string }>
  write: (terminal_id: number, data: string) => void
  resize: (terminal_id: number, cols: number, rows: number) => void
  kill: (terminal_id: number) => void
  on_data: (callback: (payload: { terminal_id: number; data: string }) => void) => () => void
  on_exit: (callback: (payload: { terminal_id: number; exit_code: number; signal: number }) => void) => () => void
}

interface RawDiagnostic {
  source: string
  code: string | null
  severity: 'error' | 'warning' | 'info'
  message: string
  line: number
  column: number
  end_line: number
  end_column: number
}

interface DiagnosticsApi {
  analyze: (input: { language: string; content: string; file_path: string | null }) => Promise<RawDiagnostic[]>
}

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
}

interface AIChatRequest {
  request_id: string
  base_url: string
  model: string
  messages: OllamaMessage[]
}

interface AIApi {
  list_models: (base_url: string) => Promise<AIModel[]>
  model_capabilities: (base_url: string, model: string) => Promise<{ image: boolean }>
  start_chat: (request: AIChatRequest) => void
  cancel_chat: (request_id: string) => void
  speech_status: (
    base_url: string,
    speech_model: string,
  ) => Promise<{
    ollama_available: boolean
    installed: boolean
  }>
  install_speech_model: (base_url: string, speech_model: string) => Promise<boolean>
  transcribe: (base_url: string, speech_model: string, audio: Uint8Array) => Promise<string>
  on_chat_chunk: (callback: (payload: { request_id: string; content: string; thinking: string }) => void) => () => void
  on_chat_complete: (callback: (payload: { request_id: string }) => void) => () => void
  on_chat_error: (callback: (payload: { request_id: string; message: string }) => void) => () => void
}

interface EditorApi {
  platform: string
  app: AppControlsApi
  ai: AIApi
  browser: BrowserApi
  diagnostics: DiagnosticsApi
  dialog: DialogApi
  edit: EditApi
  file: FileApi
  settings: SettingsApi
  terminal: TerminalApi
  window: WindowControlsApi
}

declare global {
  interface Window {
    editor_api: EditorApi
  }
}

export {}
