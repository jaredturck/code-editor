import type { EditorDiagnostic } from '../types/editor'

export interface EditorCommandSnapshot {
  can_undo: boolean
  can_redo: boolean
  can_fold: boolean
  can_unfold: boolean
  has_selection: boolean
  selection_count: number
  line: number
  column: number
}

export function editor_command_states_equal(previous: EditorCommandSnapshot | null, next: EditorCommandSnapshot) {
  return (
    previous !== null &&
    previous.can_undo === next.can_undo &&
    previous.can_redo === next.can_redo &&
    previous.can_fold === next.can_fold &&
    previous.can_unfold === next.can_unfold &&
    previous.has_selection === next.has_selection &&
    previous.selection_count === next.selection_count &&
    previous.line === next.line &&
    previous.column === next.column
  )
}

export function get_diagnostics_signature(document_id: number, diagnostics: EditorDiagnostic[]) {
  return JSON.stringify([
    document_id,
    diagnostics.map((diagnostic) => [
      diagnostic.id,
      diagnostic.source,
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.line,
      diagnostic.column,
      diagnostic.end_line,
      diagnostic.end_column,
    ]),
  ])
}
