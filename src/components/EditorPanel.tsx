import type { RefObject } from 'react'
import logo from '../assets/logo.png'
import type { EditorDocument, EditorSettings, TextEditorDocument, ThemeMode } from '../types/editor'
import BrowserPanel from './BrowserPanel'
import CodeEditor, { type CodeEditorHandle, type EditorCommandState } from './CodeEditor'
import Icon from './Icon'
import close_icon from './images/close.svg'

interface EditorPanelProps {
  activeDocumentId: number | null
  browserVisible: boolean
  documents: EditorDocument[]
  editorRef: RefObject<CodeEditorHandle | null>
  settings: EditorSettings
  theme: Exclude<ThemeMode, 'system'>
  onCloseDocument: (document_id: number) => void
  onEditorCommandStateChange: (state: EditorCommandState) => void
  onFocusDocument: (document_id: number) => void
  onSelectDocument: (document_id: number) => void
  onUpdateDocument: (document_id: number, content: string) => void
}

function FileBreadcrumbs({ document }: { document: TextEditorDocument }) {
  const path_segments = document.file_path ? document.file_path.split(/[\\/]/).filter(Boolean) : []

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b border-[var(--border)] bg-[var(--editor-bg)] px-3 text-[11px] text-[var(--muted)]">
      {document.file_path ? (
        path_segments.map((segment, index) => (
          <span className="flex min-w-0 items-center gap-1" key={`${segment}-${index}`}>
            {index > 0 && <span className="text-[var(--muted)]/60">›</span>}
            <span className="truncate">{segment}</span>
          </span>
        ))
      ) : (
        <>
          <span>Unsaved</span>
          <span className="text-[var(--muted)]/60">›</span>
          <span className="truncate">{document.name}</span>
        </>
      )}
    </div>
  )
}

function EditorPanel({
  activeDocumentId,
  browserVisible,
  documents,
  editorRef,
  settings,
  theme,
  onCloseDocument,
  onEditorCommandStateChange,
  onFocusDocument,
  onSelectDocument,
  onUpdateDocument,
}: EditorPanelProps) {
  const active_document = documents.find((document) => document.id === activeDocumentId) ?? null
  const text_documents = documents.filter((document): document is TextEditorDocument => document.kind === 'text')
  const editor_document =
    active_document?.kind === 'text'
      ? active_document
      : (text_documents.find((document) => document.id === activeDocumentId) ?? text_documents[0] ?? null)

  if (!active_document) {
    return (
      <section aria-label="Editor panel" className="relative min-h-0 overflow-hidden bg-[var(--editor-bg)]">
        <div className="flex h-full items-center justify-center">
          <img
            alt="Code editor"
            className="app-logo h-auto w-[clamp(280px,34vw,520px)] max-h-[62%] max-w-[72%] select-none object-contain opacity-[0.08]"
            draggable={false}
            src={logo}
          />
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Editor panel" className="flex min-h-0 flex-col overflow-hidden bg-[var(--editor-bg)]">
      <div
        className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-3)]"
        role="tablist"
      >
        {documents.map((document) => {
          const is_active = document.id === active_document.id
          const deleted = document.kind === 'text' && document.deleted
          const dirty = document.kind === 'text' && document.dirty

          return (
            <div
              className={`flex min-w-32 max-w-56 items-center border-r border-[var(--border)] ${
                is_active ? 'bg-[var(--editor-bg)] text-[var(--text)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'
              }`}
              key={document.id}
            >
              <button
                aria-selected={is_active}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs"
                onClick={() => onSelectDocument(document.id)}
                role="tab"
                type="button"
              >
                {dirty && (
                  <span aria-label="Unsaved changes" className="text-[10px] text-sky-400">
                    ●
                  </span>
                )}
                <span className={`truncate ${deleted ? 'text-red-400 line-through decoration-2' : ''}`}>
                  {document.name}
                </span>
              </button>

              <button
                aria-label={`Close ${document.name}`}
                className="group mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[var(--hover)]"
                onClick={() => onCloseDocument(document.id)}
                title={`Close ${document.name}`}
                type="button"
              >
                <Icon className="h-3 w-3 opacity-60 group-hover:opacity-100" src={close_icon} />
              </button>
            </div>
          )
        })}
      </div>

      {editor_document && (
        <div className={`${active_document.kind === 'text' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
          <FileBreadcrumbs document={editor_document} />
          <CodeEditor
            activeDocument={editor_document}
            documents={text_documents}
            onChange={onUpdateDocument}
            onCommandStateChange={onEditorCommandStateChange}
            onFocus={onFocusDocument}
            ref={editorRef}
            settings={settings}
            theme={theme}
          />
        </div>
      )}

      {active_document.kind === 'browser' && <BrowserPanel document={active_document} visible={browserVisible} />}
    </section>
  )
}

export default EditorPanel
