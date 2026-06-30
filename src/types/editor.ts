export type ActivitySection = 'explorer' | 'search' | 'source-control'
export type BottomPanelTab = 'problems' | 'terminal'
export type ThemeMode = 'light' | 'dark' | 'system'
export type TopMenu = 'file' | 'edit' | 'view' | 'terminal' | null
export type IndentStyle = 'spaces' | 'tabs'

export interface EditorSettings {
  theme_mode: ThemeMode
  recent_files: string[]
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
