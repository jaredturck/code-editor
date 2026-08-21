import { useState, type FormEvent } from 'react'
import {
  findSimilarFiles,
  getFileSemanticStatus,
  inspectDocumentFile,
  powerFd,
  powerRipgrep,
  searchFileSemanticIndex,
  type BridgeDocumentInspection,
  type BridgeFileSemanticResult,
} from '../platform/desktopBridge'

interface SearchResult {
  path: string
  line: number | null
  content: string
  score?: number
  semantic?: boolean
  document?: boolean
}

type SearchMode = 'text' | 'files' | 'semantic' | 'documents'

const document_extensions = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.zip',
])

function normalize_path(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return window.editor_api.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function path_is_in_workspace(root_path: string, file_path: string) {
  const root = normalize_path(root_path)
  const target = normalize_path(file_path)
  return target === root || target.startsWith(`${root}/`)
}

function workspace_display_path(root_path: string, file_path: string) {
  const normalized_root = root_path.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalized_file = file_path.replace(/\\/g, '/')
  return path_is_in_workspace(root_path, file_path)
    ? normalized_file.slice(normalized_root.length).replace(/^\/+/, '') || normalized_file
    : normalized_file
}

function file_extension(file_path: string) {
  const name = file_path.replace(/\\/g, '/').split('/').pop() || ''
  const dot_index = name.lastIndexOf('.')
  return dot_index >= 0 ? name.slice(dot_index).toLowerCase() : ''
}

function is_document_path(file_path: string) {
  return document_extensions.has(file_extension(file_path))
}

function SearchToggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: string
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] transition ${active ? 'bg-[var(--selected)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function SearchPanel({ rootPath, onOpenFile }: { rootPath: string | null; onOpenFile: (file_path: string) => void }) {
  const [replace_open, set_replace_open] = useState(true)
  const [match_case, set_match_case] = useState(false)
  const [match_word, set_match_word] = useState(false)
  const [use_regex, set_use_regex] = useState(false)
  const [preserve_case, set_preserve_case] = useState(false)
  const [search_mode, set_search_mode] = useState<SearchMode>('text')
  const [query, set_query] = useState('')
  const [results, set_results] = useState<SearchResult[]>([])
  const [result_label, set_result_label] = useState('')
  const [semantic_status, set_semantic_status] = useState('')
  const [document_inspection, set_document_inspection] = useState<BridgeDocumentInspection | null>(null)
  const [loading, set_loading] = useState(false)
  const [error, set_error] = useState('')

  const semantic_results = (items: BridgeFileSemanticResult[], documents_only = false) => {
    if (!rootPath) return []

    return items
      .filter((item) => item.semanticType === 'text' && path_is_in_workspace(rootPath, item.path))
      .filter((item) => !documents_only || is_document_path(item.path))
      .map((item) => ({
        path: item.path,
        line: null,
        content: item.summary,
        score: item.score,
        semantic: true,
        document: is_document_path(item.path),
      }))
  }

  const refresh_semantic_status = async () => {
    try {
      const status = await getFileSemanticStatus(false)

      if (status.indexStatus === 'ready') {
        set_semantic_status(`${status.semanticCount.toLocaleString()} embedded files indexed`)
      } else if (status.indexStatus === 'building') {
        set_semantic_status(status.stage ? `Indexing · ${status.stage}` : 'Semantic index is building')
      } else if (!status.ollamaAvailable) {
        set_semantic_status('Semantic search requires the configured local Ollama service')
      } else if (!status.embeddingModelInstalled) {
        set_semantic_status(`Install ${status.embeddingModel} in Settings → AI → Semantic Index`)
      } else {
        set_semantic_status('Build the semantic index in Settings → AI → Semantic Index')
      }

      return status
    } catch (status_error) {
      set_semantic_status('')
      set_error(status_error instanceof Error ? status_error.message : 'Unable to read semantic index status.')
      return null
    }
  }

  const select_search_mode = (mode: SearchMode) => {
    set_search_mode(mode)
    set_results([])
    set_result_label('')
    set_document_inspection(null)
    set_error('')

    if (mode === 'semantic' || mode === 'documents') {
      void refresh_semantic_status()
    }
  }

  const run_search = async (event?: FormEvent) => {
    event?.preventDefault()
    const search_query = query.trim()

    if (!rootPath || !search_query) {
      set_results([])
      set_result_label('')
      set_error(rootPath ? '' : 'Open a folder to search the project.')
      return
    }

    set_loading(true)
    set_error('')
    set_document_inspection(null)

    try {
      if (search_mode === 'files') {
        const response = await powerFd({
          path: rootPath,
          pattern: search_query,
          maxResults: 200,
        })
        const next_results = Array.isArray(response.results)
          ? response.results
              .map((item) => {
                const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
                const path = String(source.path || '')
                return path ? { path, line: null, content: '', document: is_document_path(path) } : null
              })
              .filter((item): item is SearchResult => item !== null)
          : []
        set_results(next_results)
        set_result_label('File-name matches')
        set_error(String(response.error || ''))
      } else if (search_mode === 'semantic' || search_mode === 'documents') {
        const status = await refresh_semantic_status()

        if (!status || status.indexStatus !== 'ready') {
          set_results([])
          set_result_label('')
          if (status) set_error('Semantic index is not ready yet.')
          return
        }

        const response = await searchFileSemanticIndex(search_query, 200, 'text')
        const documents_only = search_mode === 'documents'
        set_results(semantic_results(response, documents_only))
        set_result_label(documents_only ? 'Indexed documents' : 'Semantic matches')
      } else {
        const response = await powerRipgrep(search_query, {
          path: rootPath,
          mode: 'content',
          ignoreCase: !match_case,
          fixedStrings: !use_regex,
          wordBoundary: match_word,
          contextLines: 0,
          maxResults: 200,
        })
        const next_results = Array.isArray(response.matches)
          ? response.matches
              .map((item) => {
                const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
                const path = String(source.file || '')
                return path
                  ? {
                      path,
                      line: Number(source.line) || null,
                      content: String(source.content || ''),
                      document: is_document_path(path),
                    }
                  : null
              })
              .filter((item): item is SearchResult => item !== null)
          : []
        set_results(next_results)
        set_result_label('Text matches')
        set_error(String(response.error || ''))
      }
    } catch (search_error) {
      set_results([])
      set_result_label('')
      set_error(search_error instanceof Error ? search_error.message : 'Project search failed.')
    } finally {
      set_loading(false)
    }
  }

  const find_similar = async (file_path: string) => {
    if (!rootPath) return

    set_search_mode('semantic')
    set_loading(true)
    set_error('')
    set_document_inspection(null)

    try {
      const status = await refresh_semantic_status()

      if (!status || status.indexStatus !== 'ready') {
        set_results([])
        set_result_label('')
        if (status) set_error('Semantic index is not ready yet.')
        return
      }

      const response = await findSimilarFiles(file_path, 200)
      set_results(semantic_results(response))
      set_result_label(`Similar to ${workspace_display_path(rootPath, file_path)}`)
    } catch (search_error) {
      set_results([])
      set_result_label('')
      set_error(search_error instanceof Error ? search_error.message : 'Similar-file search failed.')
    } finally {
      set_loading(false)
    }
  }

  const inspect_document = async (file_path: string) => {
    set_loading(true)
    set_error('')

    try {
      const inspection = await inspectDocumentFile(file_path)
      set_document_inspection(inspection)
    } catch (inspection_error) {
      set_document_inspection(null)
      set_error(inspection_error instanceof Error ? inspection_error.message : 'Document inspection failed.')
    } finally {
      set_loading(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <form className="shrink-0" onSubmit={(event) => void run_search(event)}>
        <div className="mb-2 grid grid-cols-4 rounded border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5 text-[10px]">
          {(['text', 'files', 'semantic', 'documents'] as SearchMode[]).map((mode) => (
            <button
              aria-pressed={search_mode === mode}
              className={`rounded px-1 py-1 ${search_mode === mode ? 'bg-[var(--selected)] text-[var(--text)]' : 'text-[var(--muted)]'}`}
              key={mode}
              onClick={() => select_search_mode(mode)}
              type="button"
            >
              {mode === 'text' ? 'Text' : mode === 'files' ? 'Files' : mode === 'semantic' ? 'Semantic' : 'Docs'}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-1.5">
          <div className="mt-1 h-6 w-5 shrink-0">
            {search_mode === 'text' && (
              <button
                aria-label={replace_open ? 'Hide replace input' : 'Show replace input'}
                aria-expanded={replace_open}
                className="flex h-6 w-5 items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
                onClick={() => set_replace_open((current_value) => !current_value)}
                title={replace_open ? 'Hide replace' : 'Show replace'}
                type="button"
              >
                <span className={`text-xs transition-transform ${replace_open ? 'rotate-90' : ''}`}>›</span>
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex h-8 items-center rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 focus-within:border-sky-500">
              <input
                aria-label="Search"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
                onChange={(event) => set_query(event.target.value)}
                placeholder={
                  search_mode === 'files'
                    ? 'Search file names'
                    : search_mode === 'semantic'
                      ? 'Describe the code or file'
                      : search_mode === 'documents'
                        ? 'Search indexed documents and PDFs'
                        : 'Search'
                }
                type="text"
                value={query}
              />

              {search_mode === 'text' && (
                <div className="ml-1 flex items-center gap-0.5">
                  <SearchToggle active={match_case} label="Match case" onClick={() => set_match_case((value) => !value)}>Aa</SearchToggle>
                  <SearchToggle active={match_word} label="Match whole word" onClick={() => set_match_word((value) => !value)}>ab</SearchToggle>
                  <SearchToggle active={use_regex} label="Use regular expression" onClick={() => set_use_regex((value) => !value)}>.*</SearchToggle>
                </div>
              )}
            </div>

            {replace_open && search_mode === 'text' && (
              <div className="flex h-8 items-center rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 focus-within:border-sky-500">
                <input
                  aria-label="Replace"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
                  placeholder="Replace"
                  type="text"
                />
                <SearchToggle active={preserve_case} label="Preserve case" onClick={() => set_preserve_case((value) => !value)}>AB</SearchToggle>
              </div>
            )}

            {(search_mode === 'semantic' || search_mode === 'documents') && (
              <div className="px-0.5 text-[10px] leading-4 text-[var(--muted)]">
                {semantic_status || 'Uses the existing encrypted IRIS text-embedding index.'}
              </div>
            )}
          </div>
        </div>
      </form>

      {document_inspection && (
        <div className="mt-3 shrink-0 rounded border border-[var(--border)] bg-[var(--input-bg)] p-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-[var(--text)]">{document_inspection.name}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--muted)]">
                {document_inspection.sourceType} · {document_inspection.extractionMethod}
                {document_inspection.pagesRead ? ` · ${document_inspection.pagesRead} page${document_inspection.pagesRead === 1 ? '' : 's'}` : ''}
              </div>
              {document_inspection.archiveEntry && (
                <div className="mt-0.5 truncate text-[9px] text-[var(--muted)]">Archive entry: {document_inspection.archiveEntry}</div>
              )}
            </div>
            <button
              className="shrink-0 rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              onClick={() => set_document_inspection(null)}
              title="Close document inspection"
              type="button"
            >
              ×
            </button>
          </div>
          <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-[var(--text)]">
            {document_inspection.text}
          </div>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-auto border-t border-[var(--border)] pt-2">
        {loading && <div className="px-1 py-2 text-xs text-[var(--muted)]">Searching…</div>}
        {!loading && error && <div className="px-1 py-2 text-xs text-red-400">{error}</div>}
        {!loading && !error && query.trim() && results.length === 0 && (
          <div className="px-1 py-2 text-xs text-[var(--muted)]">No results.</div>
        )}
        {!loading && results.length > 0 && (
          <>
            <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {result_label || `${results.length} result${results.length === 1 ? '' : 's'}`} · {results.length}
            </div>
            {results.map((result, index) => (
              <div
                className="group flex items-start gap-1 rounded hover:bg-[var(--hover)]"
                key={`${result.path}:${result.line ?? 0}:${index}`}
              >
                <button
                  className="min-w-0 flex-1 px-1.5 py-1.5 text-left"
                  onClick={() => result.document ? void inspect_document(result.path) : onOpenFile(result.path)}
                  title={result.document ? `Inspect ${result.path}` : result.path}
                  type="button"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text)]">
                      {rootPath ? workspace_display_path(rootPath, result.path) : result.path}
                      {result.line ? `:${result.line}` : ''}
                    </span>
                    {result.document && <span className="shrink-0 text-[9px] text-[var(--muted)]">DOC</span>}
                    {typeof result.score === 'number' && (
                      <span className="shrink-0 text-[9px] text-[var(--muted)]">
                        {Math.max(0, Math.round(result.score * 100))}%
                      </span>
                    )}
                  </div>
                  {result.content && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--muted)]">{result.content}</div>
                  )}
                </button>
                {result.semantic && (
                  <button
                    className="mr-1 mt-1.5 shrink-0 rounded px-1.5 py-1 text-[9px] text-[var(--muted)] opacity-70 hover:bg-[var(--selected)] hover:text-[var(--text)] group-hover:opacity-100"
                    onClick={() => void find_similar(result.path)}
                    title="Find semantically similar files"
                    type="button"
                  >
                    Similar
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default SearchPanel
