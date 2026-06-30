import { describe, expect, it } from 'vitest'
import {
  editor_command_states_equal,
  get_diagnostics_signature,
  type EditorCommandSnapshot,
} from '../src/editor/editorPerformance'
import type { EditorDiagnostic } from '../src/types/editor'

const command_state: EditorCommandSnapshot = {
  can_undo: true,
  can_redo: false,
  can_fold: true,
  can_unfold: false,
  has_selection: false,
  selection_count: 1,
  line: 4,
  column: 8,
}

const diagnostic: EditorDiagnostic = {
  id: '1:ruff:E999',
  document_id: 1,
  file_path: '/tmp/main.py',
  source: 'Ruff',
  code: 'E999',
  severity: 'error',
  message: 'Syntax error',
  line: 2,
  column: 3,
  end_line: 2,
  end_column: 4,
}

describe('editor performance guards', () => {
  it('treats equivalent command state objects as unchanged', () => {
    expect(editor_command_states_equal(command_state, { ...command_state })).toBe(true)
    expect(
      editor_command_states_equal(command_state, {
        ...command_state,
        column: 9,
      }),
    ).toBe(false)
  })

  it('keeps the diagnostic signature stable across equivalent arrays', () => {
    const first = get_diagnostics_signature(1, [diagnostic])
    const second = get_diagnostics_signature(1, [{ ...diagnostic }])

    expect(second).toBe(first)
    expect(get_diagnostics_signature(1, [{ ...diagnostic, line: 3 }])).not.toBe(first)
    expect(get_diagnostics_signature(2, [diagnostic])).not.toBe(first)
  })
})
