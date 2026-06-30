import logo from '../assets/logo.png'
import type { EditorDocument, ThemeMode } from '../types/editor'
import CodeEditor from './CodeEditor'
import Icon from './Icon'
import close_icon from './images/close.svg'

interface EditorPanelProps {
  activeDocumentId: number | null
  documents: EditorDocument[]
  theme: Exclude<ThemeMode, 'system'>
  onCloseDocument: (document_id: number) => void
  onSelectDocument: (document_id: number) => void
  onUpdateDocument: (document_id: number, content: string) => void
}

function EditorPanel({
  activeDocumentId,
  documents,
  theme,
  onCloseDocument,
  onSelectDocument,
  onUpdateDocument,
}: EditorPanelProps) {
  const active_document = documents.find((document) => document.id === activeDocumentId) ?? null

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
                {document.dirty && (
                  <span aria-label="Unsaved changes" className="text-[10px] text-sky-400">
                    ●
                  </span>
                )}
                <span className="truncate">{document.name}</span>
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

      <CodeEditor activeDocument={active_document} documents={documents} onChange={onUpdateDocument} theme={theme} />
    </section>
  )
}

export default EditorPanel
