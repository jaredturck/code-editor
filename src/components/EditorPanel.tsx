import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject, type WheelEvent } from 'react'
import logo from '../assets/logo.png'
import type {
  EditorDiagnostic,
  EditorDocument,
  EditorSettings,
  MediaEditorDocument,
  TextEditorDocument,
  ThemeMode,
} from '../types/editor'
import BrowserPanel from './BrowserPanel'
import CodeEditor, { type CodeEditorHandle, type EditorCommandState } from './CodeEditor'
import Icon from './Icon'
import MarkdownView from './MarkdownView'
import EditorTabContextMenu from './EditorTabContextMenu'
import MediaViewer from './viewers/MediaViewer'
import close_icon from './images/close.svg'
import { get_workspace_relative_path, workspace_path_is_same_or_child } from '../workspace/workspaceTree'

interface EditorPanelProps {
  activeDocumentId: number | null
  browserVisible: boolean
  diagnostics: EditorDiagnostic[]
  documents: EditorDocument[]
  editorRef: RefObject<CodeEditorHandle | null>
  settings: EditorSettings
  theme: Exclude<ThemeMode, 'system'>
  onCloseDocument: (document_id: number) => void
  onCloseDocuments: (document_ids: number[]) => void
  onEditorCommandStateChange: (state: EditorCommandState) => void
  onFocusDocument: (document_id: number) => void
  onOpenFilePath: (file_path: string) => void
  onOpenContainingFolder: (file_path: string) => void
  onParserDiagnostics: (document_id: number, diagnostics: EditorDiagnostic[]) => void
  onSelectDocument: (document_id: number) => void
  onRevealInExplorer: (file_path: string) => void
  onToggleMarkdownView: (document_id: number, view: TextEditorDocument['markdown_view']) => void
  onUpdateDocument: (document_id: number, content: string) => void
  workspaceRoot: string | null
}

interface EditorTabMenuState {
  document_id: number
  x: number
  y: number
}

function get_document_path(document: EditorDocument) {
  return document.kind === 'text' || document.kind === 'media' ? document.file_path : null
}

function document_is_saved(document: EditorDocument) {
  return document.kind !== 'text' || !document.dirty
}

function FileBreadcrumbs({ document }: { document: TextEditorDocument | MediaEditorDocument }) {
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

function is_markdown(document: TextEditorDocument) {
  return document.language === 'Markdown' || /(?:^readme(?:\.[^.]+)?$|\.(?:md|markdown)$)/i.test(document.name)
}

function EditorPanel({
  activeDocumentId,
  browserVisible,
  diagnostics,
  documents,
  editorRef,
  settings,
  theme,
  onCloseDocument,
  onCloseDocuments,
  onEditorCommandStateChange,
  onFocusDocument,
  onOpenFilePath,
  onOpenContainingFolder,
  onParserDiagnostics,
  onSelectDocument,
  onRevealInExplorer,
  onToggleMarkdownView,
  onUpdateDocument,
  workspaceRoot,
}: EditorPanelProps) {
  const active_document = documents.find((document) => document.id === activeDocumentId) ?? null
  const text_documents = documents.filter((document): document is TextEditorDocument => document.kind === 'text')
  const editor_document =
    active_document?.kind === 'text'
      ? active_document
      : (text_documents.find((document) => document.id === activeDocumentId) ?? text_documents[0] ?? null)
  const active_markdown = active_document?.kind === 'text' && is_markdown(active_document)
  const editor_diagnostics = useMemo(
    () => diagnostics.filter((diagnostic) => diagnostic.document_id === editor_document?.id),
    [diagnostics, editor_document?.id],
  )
  const [tab_menu_state, set_tab_menu_state] = useState<EditorTabMenuState | null>(null)
  const tab_button_refs = useRef(new Map<number, HTMLButtonElement>())
  const pending_tab_focus_ref = useRef<number | null>(null)
  const context_document = tab_menu_state
    ? (documents.find((document) => document.id === tab_menu_state.document_id) ?? null)
    : null
  const context_document_path = context_document ? get_document_path(context_document) : null
  const context_path_in_workspace = Boolean(
    context_document_path && workspaceRoot && workspace_path_is_same_or_child(workspaceRoot, context_document_path),
  )

  useEffect(() => {
    if (pending_tab_focus_ref.current === null || pending_tab_focus_ref.current !== activeDocumentId) {
      return
    }

    const tab = tab_button_refs.current.get(pending_tab_focus_ref.current)
    pending_tab_focus_ref.current = null
    tab?.focus()
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeDocumentId])

  const focus_tab = (document_id: number) => {
    pending_tab_focus_ref.current = document_id
    const tab = tab_button_refs.current.get(document_id)
    tab?.focus()
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    onSelectDocument(document_id)
  }

  const handle_tab_key = (event: KeyboardEvent<HTMLButtonElement>, document_index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const next_index = Math.min(documents.length - 1, Math.max(0, document_index + offset))

    if (next_index !== document_index) {
      focus_tab(documents[next_index].id)
    }
  }

  const handle_tab_wheel = (event: WheelEvent<HTMLDivElement>) => {
    const horizontal_delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY

    if (horizontal_delta === 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.scrollLeft += horizontal_delta
  }

  const close_tab_menu = () => set_tab_menu_state(null)

  const run_tab_menu_action = (action: () => void) => {
    close_tab_menu()
    action()
  }

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
        className="editor-tabs-scroll flex h-9 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-[var(--border)] bg-[var(--surface-3)]"
        onWheel={handle_tab_wheel}
        role="tablist"
      >
        {documents.map((document, document_index) => {
          const is_active = document.id === active_document.id
          const deleted = (document.kind === 'text' || document.kind === 'media') && document.deleted
          const dirty = document.kind === 'text' && document.dirty

          return (
            <div
              className={`flex min-w-32 max-w-56 items-center border-r border-[var(--border)] ${
                is_active ? 'bg-[var(--editor-bg)] text-[var(--text)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'
              }`}
              key={document.id}
              onContextMenu={(event) => {
                event.preventDefault()
                set_tab_menu_state({ document_id: document.id, x: event.clientX, y: event.clientY })
              }}
            >
              <button
                aria-selected={is_active}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-500/70"
                onClick={() => focus_tab(document.id)}
                onKeyDown={(event) => handle_tab_key(event, document_index)}
                ref={(element) => {
                  if (element) {
                    tab_button_refs.current.set(document.id, element)
                  } else {
                    tab_button_refs.current.delete(document.id)
                  }
                }}
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
        <div
          className={`${active_document.kind === 'text' && (!active_markdown || active_document.markdown_view === 'source') ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
        >
          <div className="relative">
            <FileBreadcrumbs document={editor_document} />
            {active_markdown && active_document.kind === 'text' && (
              <div className="absolute right-2 top-0 flex h-7 items-center gap-1">
                <button className="markdown-mode-button active" type="button">
                  Source
                </button>
                <button
                  className="markdown-mode-button"
                  onClick={() => onToggleMarkdownView(active_document.id, 'preview')}
                  type="button"
                >
                  Preview
                </button>
              </div>
            )}
          </div>
          <CodeEditor
            activeDocument={editor_document}
            diagnostics={editor_diagnostics}
            documents={text_documents}
            onChange={onUpdateDocument}
            onCommandStateChange={onEditorCommandStateChange}
            onFocus={onFocusDocument}
            onParserDiagnostics={onParserDiagnostics}
            ref={editorRef}
            settings={settings}
            theme={theme}
          />
        </div>
      )}

      {active_markdown && active_document.kind === 'text' && active_document.markdown_view === 'preview' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative">
            <FileBreadcrumbs document={active_document} />
            <div className="absolute right-2 top-0 flex h-7 items-center gap-1">
              <button
                className="markdown-mode-button"
                onClick={() => onToggleMarkdownView(active_document.id, 'source')}
                type="button"
              >
                Source
              </button>
              <button className="markdown-mode-button active" type="button">
                Preview
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--editor-bg)] px-8 py-6">
            <MarkdownView
              baseFilePath={active_document.file_path}
              content={active_document.content}
              onOpenLocal={onOpenFilePath}
            />
          </div>
        </div>
      )}

      {active_document.kind === 'browser' && <BrowserPanel document={active_document} visible={browserVisible} />}
      {active_document.kind === 'media' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <FileBreadcrumbs document={active_document} />
          <MediaViewer document={active_document} />
        </div>
      )}

      {tab_menu_state && context_document && (
        <EditorTabContextMenu
          canCloseOthers={documents.length > 1}
          canCloseSaved={documents.some(document_is_saved)}
          canCloseToRight={
            documents.findIndex((document) => document.id === context_document.id) < documents.length - 1
          }
          canCopyPath={Boolean(context_document_path)}
          canCopyRelativePath={context_path_in_workspace}
          onClose={close_tab_menu}
          onCloseAll={() => run_tab_menu_action(() => onCloseDocuments(documents.map((document) => document.id)))}
          onCloseOthers={() =>
            run_tab_menu_action(() =>
              onCloseDocuments(
                documents.filter((document) => document.id !== context_document.id).map((document) => document.id),
              ),
            )
          }
          onCloseSaved={() =>
            run_tab_menu_action(() =>
              onCloseDocuments(documents.filter(document_is_saved).map((document) => document.id)),
            )
          }
          onCloseTab={() => run_tab_menu_action(() => onCloseDocument(context_document.id))}
          onCloseToRight={() =>
            run_tab_menu_action(() => {
              const document_index = documents.findIndex((document) => document.id === context_document.id)
              onCloseDocuments(documents.slice(document_index + 1).map((document) => document.id))
            })
          }
          onCopyBreadcrumbsPath={() =>
            run_tab_menu_action(() => {
              if (!context_document_path || !workspaceRoot || !context_path_in_workspace) return
              const relative_path = get_workspace_relative_path(workspaceRoot, context_document_path)
              window.editor_api.workspace.copy_text(relative_path.split('/').join(' > '))
            })
          }
          onCopyPath={() =>
            run_tab_menu_action(() => {
              if (context_document_path) window.editor_api.workspace.copy_text(context_document_path)
            })
          }
          onCopyRelativePath={() =>
            run_tab_menu_action(() => {
              if (!context_document_path || !workspaceRoot || !context_path_in_workspace) return
              window.editor_api.workspace.copy_text(get_workspace_relative_path(workspaceRoot, context_document_path))
            })
          }
          onOpenContainingFolder={() =>
            run_tab_menu_action(() => {
              if (context_document_path) onOpenContainingFolder(context_document_path)
            })
          }
          onRevealInExplorer={() =>
            run_tab_menu_action(() => {
              if (context_document_path && context_path_in_workspace) onRevealInExplorer(context_document_path)
            })
          }
          x={Math.max(4, Math.min(tab_menu_state.x, window.innerWidth - 240))}
          y={Math.max(4, Math.min(tab_menu_state.y, window.innerHeight - 360))}
        />
      )}
    </section>
  )
}

export default EditorPanel
