import type { AIModel, EditorSettings } from './editor'
import type { GitAgentCommitResult, GitCommitSummary, GitDiffResult, GitRepositoryStatus } from './git'
import type { WorkspaceNodeKind, WorkspacePasteResult } from './workspace'

interface WorkspaceEntryResult {
  path: string
  parent_path: string | null
  name: string
  kind: WorkspaceNodeKind
  is_symlink: boolean
}

interface WorkspaceApi {
  read_directory: (root_path: string, directory_path: string) => Promise<WorkspaceEntryResult[]>
  agent_read_file: (
    root_path: string,
    target_path: string,
  ) => Promise<{
    path: string
    content: string
    revision: string
    size: number
    modified_time: number
  }>
  agent_write_file: (
    root_path: string,
    target_path: string,
    content: string,
    expected_revision: string | null,
  ) => Promise<{ path: string; revision: string; size: number }>
  agent_stat: (
    root_path: string,
    target_path: string,
  ) => Promise<{
    path: string
    name: string
    type: 'file' | 'directory' | 'other'
    size: number
    modifiedTime: number
  }>
  agent_list: (
    root_path: string,
    target_path: string,
    depth: number,
  ) => Promise<{
    rootPath: string
    tree: { name: string; path: string; type: 'file' | 'directory'; children?: unknown[] }
    truncated: boolean
  }>
  create_entry: (
    root_path: string,
    parent_path: string,
    name: string,
    kind: WorkspaceNodeKind,
  ) => Promise<WorkspaceEntryResult>
  rename_entry: (root_path: string, source_path: string, name: string) => Promise<WorkspaceEntryResult>
  paste_entry: (
    root_path: string,
    source_path: string,
    target_directory: string,
    operation: 'copy' | 'cut',
    conflict_mode: 'ask' | 'replace' | 'keep_both',
  ) => Promise<WorkspacePasteResult>
  trash_entry: (root_path: string, target_path: string) => Promise<{ path: string; kind: WorkspaceNodeKind }>
  reveal_entry: (root_path: string, target_path: string) => void
  copy_text: (value: string) => void
  watch: (root_path: string) => Promise<boolean>
  unwatch: () => void
  on_change: (callback: (payload: { root_path: string; event_type: string; file_path: string }) => void) => () => void
  on_watch_error: (callback: (payload: { root_path: string; message: string }) => void) => () => void
}

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

interface GitApi {
  ensure_repository: (root_path: string) => Promise<{
    root_path: string
    initialized: boolean
    nested_repositories: string[]
  }>
  status: (root_path: string) => Promise<GitRepositoryStatus>
  history: (root_path: string, limit?: number) => Promise<GitCommitSummary[]>
  diff: (root_path: string, file_path: string) => Promise<GitDiffResult>
  stage: (root_path: string, file_paths: string[]) => Promise<GitRepositoryStatus>
  unstage: (root_path: string, file_paths: string[]) => Promise<GitRepositoryStatus>
  commit: (root_path: string, message: string) => Promise<{ hash: string | null; status: GitRepositoryStatus }>
  remove_nested_repository: (root_path: string, git_path: string) => Promise<GitRepositoryStatus>
  prepare_agent_run: (
    root_path: string,
    run_id: string,
  ) => Promise<{
    root_path: string
    baseline_commit: string | null
    head: string | null
  }>
  commit_agent_changes: (root_path: string, run_id: string, goal: string) => Promise<GitAgentCommitResult>
  abandon_agent_run: (run_id: string) => Promise<void>
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

interface BrowserRuntimeConsoleMessage {
  level: string
  message: string
  line: number
  source: string
}

interface BrowserRuntimeInspection {
  ok: boolean
  requestedUrl: string
  finalUrl: string
  title: string
  loadFailure: { code: number; description: string; url: string } | null
  blockedNavigation: string | null
  console: BrowserRuntimeConsoleMessage[]
  consoleErrors: BrowserRuntimeConsoleMessage[]
  blockedRequests: string[]
  failedRequests: Array<{ url: string; error: string }>
  dom: {
    readyState?: string
    title?: string
    bodyText?: string
    bodyChildCount?: number
    bodyHtmlLength?: number
    visibleElementCount?: number
    root?: { id?: string; text?: string; childCount?: number; htmlLength?: number } | null
  } | null
  domError: string | null
  blankPage: boolean
  settleMs: number
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
  inspect_runtime: (
    url: string,
    options?: { settle_ms?: number; timeout_ms?: number; max_text_chars?: number },
  ) => Promise<BrowserRuntimeInspection>
  on_state_change: (callback: (state: BrowserState) => void) => () => void
}

interface TerminalApi {
  create: (terminal_id: number, cwd?: string | null) => Promise<{ shell: string; cwd: string }>
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
  git: GitApi
  settings: SettingsApi
  terminal: TerminalApi
  workspace: WorkspaceApi
  window: WindowControlsApi
}

declare global {
  interface Window {
    editor_api: EditorApi
  }
}

export {}
