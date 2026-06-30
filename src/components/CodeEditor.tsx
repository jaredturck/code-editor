import { indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { editor_search_extension, open_editor_search } from '../editor/editorSearch'
import type { TextEditorDocument, ThemeMode } from '../types/editor'

export interface EditorCommandState {
  can_undo: boolean
  can_redo: boolean
  has_selection: boolean
}

export interface CodeEditorHandle {
  copy: () => void
  cut: () => void
  focus: () => void
  open_find: () => void
  open_replace: () => void
  paste: () => void
  redo: () => void
  undo: () => void
}

interface CodeEditorProps {
  activeDocument: TextEditorDocument
  documents: TextEditorDocument[]
  theme: Exclude<ThemeMode, 'system'>
  onChange: (document_id: number, content: string) => void
  onCommandStateChange: (state: EditorCommandState) => void
  onFocus: (document_id: number) => void
}

function create_editor_theme(theme: Exclude<ThemeMode, 'system'>) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text)',
        fontSize: '13px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
        lineHeight: '1.6',
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '8px 0',
        caretColor: 'var(--text)',
      },
      '.cm-line': {
        padding: '0 12px',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--muted)',
        border: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '42px',
        padding: '0 10px 0 8px',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--terminal-active)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--terminal-active)',
        color: 'var(--text)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selected)',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--text)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, #d6ad28 34%, transparent)',
        outline: '1px solid color-mix(in srgb, #d6ad28 65%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, #38bdf8 42%, transparent)',
        outline: '1px solid #38bdf8',
      },
    },
    {
      dark: theme === 'dark',
    },
  )
}

function create_indentation_extensions(document: TextEditorDocument) {
  const indentation = document.indent_style === 'tabs' ? '\t' : ' '.repeat(document.indent_size)

  return [EditorState.tabSize.of(document.indent_size), indentUnit.of(indentation), keymap.of([indentWithTab])]
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { activeDocument, documents, theme, onChange, onCommandStateChange, onFocus },
  ref,
) {
  const container_ref = useRef<HTMLDivElement>(null)
  const editor_view_ref = useRef<EditorView | null>(null)
  const active_document_id_ref = useRef<number | null>(null)
  const state_cache_ref = useRef(new Map<number, EditorState>())
  const theme_compartment_ref = useRef(new Compartment())
  const language_compartment_ref = useRef(new Compartment())
  const indentation_compartment_ref = useRef(new Compartment())
  const language_request_ref = useRef(0)
  const on_change_ref = useRef(onChange)
  const on_command_state_change_ref = useRef(onCommandStateChange)
  const on_focus_ref = useRef(onFocus)
  const theme_ref = useRef(theme)

  on_change_ref.current = onChange
  on_command_state_change_ref.current = onCommandStateChange
  on_focus_ref.current = onFocus
  theme_ref.current = theme

  const notify_command_state = (state: EditorState) => {
    on_command_state_change_ref.current({
      can_undo: undoDepth(state) > 0,
      can_redo: redoDepth(state) > 0,
      has_selection: state.selection.ranges.some((selection) => !selection.empty),
    })
  }

  const create_editor_state = (document: TextEditorDocument) => {
    return EditorState.create({
      doc: document.content,
      extensions: [
        basicSetup,
        editor_search_extension,
        theme_compartment_ref.current.of(create_editor_theme(theme_ref.current)),
        language_compartment_ref.current.of([]),
        indentation_compartment_ref.current.of(create_indentation_extensions(document)),
        EditorView.updateListener.of((update) => {
          state_cache_ref.current.set(document.id, update.state)
          notify_command_state(update.state)

          if (update.docChanged) {
            on_change_ref.current(document.id, update.state.doc.toString())
          }
        }),
        EditorView.domEventHandlers({
          focus: () => {
            on_focus_ref.current(document.id)
            return false
          },
        }),
      ],
    })
  }

  const run_edit_command = (command: 'copy' | 'cut' | 'paste') => {
    const editor_view = editor_view_ref.current

    if (!editor_view) {
      return
    }

    editor_view.focus()
    requestAnimationFrame(() => window.editor_api.edit[command]())
  }

  useImperativeHandle(ref, () => ({
    copy: () => run_edit_command('copy'),
    cut: () => run_edit_command('cut'),
    focus: () => editor_view_ref.current?.focus(),
    open_find: () => {
      const editor_view = editor_view_ref.current

      if (editor_view) {
        open_editor_search(editor_view, false)
      }
    },
    open_replace: () => {
      const editor_view = editor_view_ref.current

      if (editor_view) {
        open_editor_search(editor_view, true)
      }
    },
    paste: () => run_edit_command('paste'),
    redo: () => {
      const editor_view = editor_view_ref.current

      if (editor_view) {
        editor_view.focus()
        redo(editor_view)
      }
    },
    undo: () => {
      const editor_view = editor_view_ref.current

      if (editor_view) {
        editor_view.focus()
        undo(editor_view)
      }
    },
  }))

  useEffect(() => {
    if (!container_ref.current) {
      return
    }

    const initial_state = create_editor_state(activeDocument)
    const editor_view = new EditorView({
      parent: container_ref.current,
      state: initial_state,
    })

    editor_view_ref.current = editor_view
    active_document_id_ref.current = activeDocument.id
    state_cache_ref.current.set(activeDocument.id, initial_state)
    notify_command_state(initial_state)
    editor_view.focus()

    return () => {
      editor_view.destroy()
      editor_view_ref.current = null
      active_document_id_ref.current = null
    }
  }, [])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view || active_document_id_ref.current === activeDocument.id) {
      return
    }

    if (active_document_id_ref.current !== null) {
      state_cache_ref.current.set(active_document_id_ref.current, editor_view.state)
    }

    const next_state = state_cache_ref.current.get(activeDocument.id) ?? create_editor_state(activeDocument)

    state_cache_ref.current.set(activeDocument.id, next_state)
    active_document_id_ref.current = activeDocument.id
    editor_view.setState(next_state)
    editor_view.dispatch({
      effects: [
        theme_compartment_ref.current.reconfigure(create_editor_theme(theme_ref.current)),
        indentation_compartment_ref.current.reconfigure(create_indentation_extensions(activeDocument)),
      ],
    })
    state_cache_ref.current.set(activeDocument.id, editor_view.state)
    notify_command_state(editor_view.state)
    editor_view.focus()
  }, [activeDocument.id])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view) {
      return
    }

    editor_view.dispatch({
      effects: theme_compartment_ref.current.reconfigure(create_editor_theme(theme)),
    })

    if (active_document_id_ref.current !== null) {
      state_cache_ref.current.set(active_document_id_ref.current, editor_view.state)
    }
  }, [theme])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view || active_document_id_ref.current !== activeDocument.id) {
      return
    }

    editor_view.dispatch({
      effects: indentation_compartment_ref.current.reconfigure(create_indentation_extensions(activeDocument)),
    })
    state_cache_ref.current.set(activeDocument.id, editor_view.state)
  }, [activeDocument.id, activeDocument.indent_size, activeDocument.indent_style])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    const request_id = language_request_ref.current + 1

    language_request_ref.current = request_id

    if (!editor_view || active_document_id_ref.current !== activeDocument.id) {
      return
    }

    if (activeDocument.language === 'Plain Text') {
      editor_view.dispatch({
        effects: language_compartment_ref.current.reconfigure([]),
      })
      state_cache_ref.current.set(activeDocument.id, editor_view.state)
      return
    }

    const language_description = languages.find((language) => language.name === activeDocument.language)

    if (!language_description) {
      return
    }

    void language_description.load().then((language_support) => {
      const current_editor = editor_view_ref.current

      if (
        request_id !== language_request_ref.current ||
        !current_editor ||
        active_document_id_ref.current !== activeDocument.id
      ) {
        return
      }

      current_editor.dispatch({
        effects: language_compartment_ref.current.reconfigure(language_support),
      })
      state_cache_ref.current.set(activeDocument.id, current_editor.state)
    })
  }, [activeDocument.id, activeDocument.language])

  useEffect(() => {
    const active_ids = new Set(documents.map((document) => document.id))

    for (const document_id of state_cache_ref.current.keys()) {
      if (!active_ids.has(document_id)) {
        state_cache_ref.current.delete(document_id)
      }
    }
  }, [documents])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view) {
      return
    }

    const current_document = documents.find((document) => document.id === active_document_id_ref.current)

    if (!current_document) {
      return
    }

    const current_content = editor_view.state.doc.toString()

    if (current_content === current_document.content) {
      return
    }

    editor_view.dispatch({
      changes: {
        from: 0,
        to: editor_view.state.doc.length,
        insert: current_document.content,
      },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [documents])

  return <div className="code-editor-host min-h-0 flex-1" ref={container_ref} />
})

export default CodeEditor
