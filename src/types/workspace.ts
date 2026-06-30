export type WorkspaceNodeKind = 'file' | 'directory'
export type WorkspaceClipboardOperation = 'copy' | 'cut'
export type WorkspaceConflictMode = 'ask' | 'replace' | 'keep_both'

export interface WorkspaceNode {
  path: string
  parent_path: string | null
  name: string
  kind: WorkspaceNodeKind
  is_symlink: boolean
  children: string[] | null
  loading: boolean
  error: string | null
}

export interface WorkspaceClipboardState {
  operation: WorkspaceClipboardOperation
  source_path: string
}

export interface WorkspaceConflictState {
  source_path: string
  destination_path: string
  target_directory: string
  operation: WorkspaceClipboardOperation
}

export interface WorkspaceMutationResult {
  status: 'ok'
  path: string
  old_path?: string
  kind: WorkspaceNodeKind
}

export interface WorkspaceConflictResult {
  status: 'conflict'
  source_path: string
  destination_path: string
  operation: WorkspaceClipboardOperation
}

export type WorkspacePasteResult = WorkspaceMutationResult | WorkspaceConflictResult
