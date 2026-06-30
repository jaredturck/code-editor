import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CodeEditor from '../src/components/CodeEditor'
import { clone_editor_settings, default_editor_settings } from '../src/editor/editorSettings'
import type { EditorDiagnostic, TextEditorDocument } from '../src/types/editor'

const document: TextEditorDocument = {
  kind: 'text',
  id: 1,
  name: 'main.py',
  content: 'print("hello")\n',
  saved_content: 'print("hello")\n',
  file_path: '/tmp/main.py',
  language: 'Plain Text',
  indent_style: 'spaces',
  indent_size: 4,
  dirty: false,
  deleted: false,
  markdown_view: 'source',
}

const diagnostic: EditorDiagnostic = {
  id: '1:ruff:E999',
  document_id: 1,
  file_path: '/tmp/main.py',
  source: 'Ruff',
  code: 'E999',
  severity: 'error',
  message: 'Syntax error',
  line: 1,
  column: 1,
  end_line: 1,
  end_column: 2,
}

describe('CodeEditor performance guards', () => {
  it('does not emit command-state updates when equivalent diagnostics are reapplied', async () => {
    const settings = clone_editor_settings(default_editor_settings)
    const on_command_state_change = vi.fn()
    const props = {
      activeDocument: document,
      documents: [document],
      settings: { ...settings, diagnostics: { ...settings.diagnostics, mode: 'off' as const } },
      theme: 'dark' as const,
      onChange: vi.fn(),
      onCommandStateChange: on_command_state_change,
      onFocus: vi.fn(),
      onParserDiagnostics: vi.fn(),
    }
    const { rerender } = render(<CodeEditor {...props} diagnostics={[diagnostic]} />)

    await act(async () => Promise.resolve())
    const initial_calls = on_command_state_change.mock.calls.length

    rerender(<CodeEditor {...props} diagnostics={[{ ...diagnostic }]} />)
    await act(async () => Promise.resolve())

    expect(initial_calls).toBeGreaterThan(0)
    expect(on_command_state_change).toHaveBeenCalledTimes(initial_calls)
  })
})
