export type ActivitySection = 'explorer' | 'search' | 'source-control'
export type BottomPanelTab = 'problems' | 'terminal'
export type ThemeMode = 'light' | 'dark' | 'system'
export type TopMenu = 'file' | 'edit' | 'view' | 'terminal' | null

export interface EditorDocument {
  id: number
  name: string
  content: string
  saved_content: string
  file_path: string | null
  language: 'text'
  dirty: boolean
}

export interface TerminalSession {
  id: number
  name: string
  history: string[]
  input: string
  parent_id: number | null
}
