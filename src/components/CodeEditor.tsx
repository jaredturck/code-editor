import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import type { EditorDocument, ThemeMode } from '../types/editor'

interface CodeEditorProps {
  activeDocument: EditorDocument
  documents: EditorDocument[]
  theme: Exclude<ThemeMode, 'system'>
  onChange: (document_id: number, content: string) => void
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
    },
    {
      dark: theme === 'dark',
    },
  )
}

function CodeEditor({ activeDocument, documents, theme, onChange }: CodeEditorProps) {
  const container_ref = useRef<HTMLDivElement>(null)
  const editor_view_ref = useRef<EditorView | null>(null)
  const active_document_id_ref = useRef<number | null>(null)
  const state_cache_ref = useRef(new Map<number, EditorState>())
  const theme_compartment_ref = useRef(new Compartment())
  const on_change_ref = useRef(onChange)
  const theme_ref = useRef(theme)

  on_change_ref.current = onChange
  theme_ref.current = theme

  const create_editor_state = (document: EditorDocument) => {
    return EditorState.create({
      doc: document.content,
      extensions: [
        basicSetup,
        theme_compartment_ref.current.of(create_editor_theme(theme_ref.current)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return
          }

          state_cache_ref.current.set(document.id, update.state)
          on_change_ref.current(document.id, update.state.doc.toString())
        }),
      ],
    })
  }

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
      effects: theme_compartment_ref.current.reconfigure(create_editor_theme(theme_ref.current)),
    })
    state_cache_ref.current.set(activeDocument.id, editor_view.state)
    editor_view.focus()
  }, [activeDocument])

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
    })
  }, [documents])

  return <div className="code-editor-host min-h-0 flex-1" ref={container_ref} />
}

export default CodeEditor
