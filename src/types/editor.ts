export type ActivitySection = 'explorer' | 'search' | 'source-control'
export type BottomPanelTab = 'problems' | 'terminal'
export type ThemeMode = 'light' | 'dark' | 'system'
export type TopMenu = 'file' | 'edit' | 'view' | 'terminal' | null

export interface TerminalSession {
  id: number
  name: string
  history: string[]
  input: string
}
