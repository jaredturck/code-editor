import { useState, type FormEvent } from 'react'
import {
  findSimilarFiles,
  getFileSemanticStatus,
  inspectDocumentFile,
  searchFileSemanticConcepts,
  searchFileSemanticIndex,
  type BridgeDocumentInspection,
  type BridgeFileSemanticConceptGroup,
  type BridgeFileSemanticResult,
} from '../platform/desktopBridge'
import { searchProjectFileNames, searchProjectText } from '../platform/projectSearch'

interface SearchResult {
  path: string
  line: number | null
  content: string
  score?: number
  semantic?: boolean
  document?: boolean
  semantic_type?: 'text' | 'image' | 'video'
  timestamp_ms?: number
  concept_title?: string
}

type SearchMode = 'text' | 'files' | 'semantic' | 'documents' | 'media' | 'concepts'

const document_extensions = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.zip'])

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

function format_timestamp(value?: number) {
  if (!Number.isFinite(value) || Number(value) < 0) return ''
  const total_seconds = Math.floor(Number(value) / 1000)
  const minutes = Math.floor(total_seconds / 60)
  const seconds = total_seconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function concept_results_for_workspace(root_path: string, groups: BridgeFileSemanticConceptGroup[]) {
  let visible_groups = 0
  const results: SearchResult[] = []

  for (const group of groups) {
    const members = group.results.filter((item) => path_is_in_workspace(root_path, item.path))
    if (!members.length) continue
    visible_groups += 1
    for (const item of members) {
      results.push({
        path: item.path,
        line: null,
        content: item.summary,
        score: item.score,
        semantic: true,
        document: item.semanticType === 'text' && is_document_path(item.path),
        semantic_type: item.semanticType,
        timestamp_ms: item.timestampMs,
        concept_title: group.title,
      })
    }
  }

  return { results, visible_groups }
}

function SearchToggle({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: string }) {
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
  const [replace_open, set_replace_open] = useState(false)
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
  const [has_searched, set_has_searched] = useState(false)
  const [error, set_error] = useState('')

  const semantic_results = (items: BridgeFileSemanticResult[], target: 'text' | 'media' = 'text', documents_only = false) => {
    if (!rootPath) return []
    return items
      .filter((item) => path_is_in_workspace(rootPath, item.path))
      .filter((item) => target === 'media' ? item.semanticType === 'image' || item.semanticType === 'video' : item.semanticType === 'text')
      .filter((item) => !documents_only || is_document_path(item.path))
      .map((item) => ({
        path: item.path,
        line: null,
        content: item.summary,
        score: item.score,
        semantic: true,
        document: item.semanticType === 'text' && is_document_path(item.path),
        semantic_type: item.semanticType,
        timestamp_ms: item.timestampMs,
      }))
  }

  const refresh_semantic_status = async (mode: SearchMode = search_mode) => {
    try {
      const status = await getFileSemanticStatus(false)
      const media_mode = mode === 'media'
      const concept_mode = mode === 'concepts'
      if (status.indexStatus === 'ready') {
        set_semantic_status(
          concept_mode
            ? `${Number(status.conceptCount || 0).toLocaleString()} concept centroids indexed`
            : media_mode
              ? `${status.semanticCount.toLocaleString()} semantic records · CLIP ${status.imageModel}`
              : `${status.semanticCount.toLocaleString()} embedded files indexed`,
        )
      } else if (status.indexStatus === 'building') {
        set_semantic_status(status.stage ? `Indexing · ${status.stage}` : 'Semantic index is building')
      } else if (media_mode && !status.imageModelInstalled) {
        set_semantic_status(`Install ${status.imageModel} in Settings → AI → Semantic Index`)
      } else if (!media_mode && !status.ollamaAvailable) {
        set_semantic_status('Semantic search requires the configured local Ollama service')
      } else if (!media_mode && !status.embeddingModelInstalled) {
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

  const reset_pending_search = () => {
    set_results([])
    set_result_label('')
    set_has_searched(false)
    set_error('')
  }

  const select_search_mode = (mode: SearchMode) => {
    set_search_mode(mode)
    reset_pending_search()
    set_document_inspection(null)
    if (mode === 'semantic' || mode === 'documents' || mode === 'media' || mode === 'concepts') void refresh_semantic_status(mode)
  }

  const run_search = async (event?: FormEvent) => {
    event?.preventDefault()
    const search_query = query.trim()
    if (!rootPath || !search_query) {
      set_results([])
      set_result_label('')
      set_has_searched(Boolean(search_query))
      set_error(rootPath ? '' : 'Open a folder to search the project.')
      return
    }

    set_loading(true)
    set_has_searched(true)
    set_error('')
    set_document_inspection(null)

    try {
      if (search_mode === 'files') {
        const matches = await searchProjectFileNames(rootPath, search_query, 200)
        set_results(matches.map((item) => ({ path: item.path, line: null, content: '', document: is_document_path(item.path) })))
        set_result_label('File-name matches')
      } else if (search_mode === 'text') {
        const matches = await searchProjectText(rootPath, search_query, {
          ignoreCase: !match_case,
          useRegex: use_regex,
          wordBoundary: match_word,
          maxResults: 200,
        })
        set_results(matches.map((item) => ({ path: item.file, line: item.line, content: item.content })))
        set_result_label('Text matches')
      } else {
        const status = await refresh_semantic_status(search_mode)
        if (!status || status.indexStatus !== 'ready') {
          set_results([])
          set_result_label('')
          if (status) set_error('Semantic index is not ready yet.')
          return
        }

        if (search_mode === 'media') {
          if (!status.imageModelInstalled) {
            set_results([])
            set_result_label('')
            set_error(`CLIP model ${status.imageModel} is not installed.`)
            return
          }
          const [images, videos] = await Promise.all([
            searchFileSemanticIndex(search_query, 100, 'image'),
            searchFileSemanticIndex(search_query, 100, 'video'),
          ])
          const media = [...images, ...videos].sort((left, right) => right.score - left.score).slice(0, 200)
          set_results(semantic_results(media, 'media'))
          set_result_label('Image and video matches')
        } else if (search_mode === 'concepts') {
          if (!Number(status.conceptCount || 0)) {
            set_results([])
            set_result_label('')
            set_error('Concept index is empty. Rebuild the semantic index in Settings → AI → Semantic Index.')
            return
          }
          const groups = await searchFileSemanticConcepts(search_query, 10, 20)
          const discovered = concept_results_for_workspace(rootPath, groups)
          set_results(discovered.results)
          set_result_label(`${discovered.visible_groups} concept cluster${discovered.visible_groups === 1 ? '' : 's'}`)
        } else {
          const response = await searchFileSemanticIndex(search_query, 200, 'text')
          const documents_only = search_mode === 'documents'
          set_results(semantic_results(response, 'text', documents_only))
          set_result_label(documents_only ? 'Indexed documents' : 'Semantic matches')
        }
      }
    } catch (search_error) {
      set_results([])
      set_result_label('')
      set_error(search_error instanceof Error ? search_error.message : 'Project search failed.')
    } finally {
      set_loading(false)
    }
  }

  const find_similar = async (result: SearchResult) => {
    if (!rootPath) return
    const media = result.semantic_type === 'image' || result.semantic_type === 'video'
    set_search_mode(media ? 'media' : 'semantic')
    set_loading(true)
    set_has_searched(true)
    set_error('')
    set_document_inspection(null)
    try {
      const status = await refresh_semantic_status(media ? 'media' : 'semantic')
      if (!status || status.indexStatus !== 'ready') {
        set_results([])
        set_result_label('')
        if (status) set_error('Semantic index is not ready yet.')
        return
      }
      const response = await findSimilarFiles(result.path, 200)
      set_results(semantic_results(response, media ? 'media' : 'text'))
      set_result_label(`Similar to ${workspace_display_path(rootPath, result.path)}`)
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
      set_document_inspection(await inspectDocumentFile(file_path))
    } catch (inspection_error) {
      set_document_inspection(null)
      set_error(inspection_error instanceof Error ? inspection_error.message : 'Document inspection failed.')
    } finally {
      set_loading(false)
    }
  }

  const open_result = (result: SearchResult) => {
    if (result.document) {
      void inspect_document(result.path)
      return
    }
    onOpenFile(result.path)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <form className="shrink-0" onSubmit={(event) => void run_search(event)}>
        <div className="mb-2 grid grid-cols-6 rounded border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5 text-[10px]">
          {(['text', 'files', 'semantic', 'documents', 'media', 'concepts'] as SearchMode[]).map((mode) => (
            <button
              aria-pressed={search_mode === mode}
              className={`rounded px-1 py-1 ${search_mode === mode ? 'bg-[var(--selected)] text-[var(--text)]' : 'text-[var(--muted)]'}`}
              key={mode}
              onClick={() => select_search_mode(mode)}
              type="button"
            >
              {mode === 'text' ? 'Text' : mode === 'files' ? 'Files' : mode === 'semantic' ? 'Semantic' : mode === 'documents' ? 'Docs' : mode === 'media' ? 'Media' : 'Concepts'}
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
                onChange={(event) => {
                  set_query(event.target.value)
                  reset_pending_search()
                }}
                placeholder={
                  search_mode === 'files'
                    ? 'Search file names'
                    : search_mode === 'semantic'
                      ? 'Describe the code or file'
                      : search_mode === 'documents'
                        ? 'Search indexed documents and PDFs'
                        : search_mode === 'media'
                          ? 'Describe an image or video'
                          : search_mode === 'concepts'
                            ? 'Describe a concept or project theme'
                            : 'Search project text'
                }
                type="text"
                value={query}
              />

              {search_mode === 'text' && (
                <div className="ml-1 flex items-center gap-0.5">
                  <SearchToggle active={match_case} label="Match case" onClick={() => { set_match_case((value) => !value); set_has_searched(false) }}>Aa</SearchToggle>
                  <SearchToggle active={match_word} label="Match whole word" onClick={() => { set_match_word((value) => !value); set_has_searched(false) }}>ab</SearchToggle>
                  <SearchToggle active={use_regex} label="Use regular expression" onClick={() => { set_use_regex((value) => !value); set_has_searched(false) }}>.*</SearchToggle>
                </div>
              )}

              <button
                aria-label="Run search"
                className="ml-1 flex h-6 min-w-7 items-center justify-center rounded px-1.5 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                disabled={loading || !query.trim()}
                title="Search (Enter)"
                type="submit"
              >
                {loading ? '…' : 'Go'}
              </button>
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

            {(search_mode === 'semantic' || search_mode === 'documents' || search_mode === 'media' || search_mode === 'concepts') && (
              <div className="px-0.5 text-[10px] leading-4 text-[var(--muted)]">
                {semantic_status || (search_mode === 'media' ? 'Uses the existing encrypted IRIS CLIP image/video index.' : search_mode === 'concepts' ? 'Uses the existing encrypted IRIS concept centroids and memberships.' : 'Uses the existing encrypted IRIS text-embedding index.')}
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
              {document_inspection.archiveEntry && <div className="mt-0.5 truncate text-[9px] text-[var(--muted)]">Archive entry: {document_inspection.archiveEntry}</div>}
            </div>
            <button className="shrink-0 rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => set_document_inspection(null)} title="Close document inspection" type="button">×</button>
          </div>
          <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-[var(--text)]">{document_inspection.text}</div>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-auto border-t border-[var(--border)] pt-2">
        {loading && <div className="px-1 py-2 text-xs text-[var(--muted)]">Searching project…</div>}
        {!loading && error && <div className="px-1 py-2 text-xs text-red-400">{error}</div>}
        {!loading && !error && query.trim() && !has_searched && <div className="px-1 py-2 text-[10px] text-[var(--muted)]">Press Enter or Go to search.</div>}
        {!loading && !error && has_searched && results.length === 0 && <div className="px-1 py-2 text-xs text-[var(--muted)]">No results.</div>}
        {!loading && results.length > 0 && (
          <>
            <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">{result_label || `${results.length} result${results.length === 1 ? '' : 's'}`} · {results.length}</div>
            {results.map((result, index) => (
              <div className="group flex items-start gap-1 rounded hover:bg-[var(--hover)]" key={`${result.path}:${result.line ?? 0}:${result.timestamp_ms ?? 0}:${result.concept_title || ''}:${index}`}>
                <button className="min-w-0 flex-1 px-1.5 py-1.5 text-left" onClick={() => open_result(result)} title={result.document ? `Inspect ${result.path}` : result.path} type="button">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text)]">{rootPath ? workspace_display_path(rootPath, result.path) : result.path}{result.line ? `:${result.line}` : ''}</span>
                    {result.document && <span className="shrink-0 text-[9px] text-[var(--muted)]">DOC</span>}
                    {result.semantic_type === 'image' && <span className="shrink-0 text-[9px] text-[var(--muted)]">IMG</span>}
                    {result.semantic_type === 'video' && <span className="shrink-0 text-[9px] text-[var(--muted)]">VIDEO</span>}
                    {result.semantic_type === 'video' && format_timestamp(result.timestamp_ms) && <span className="shrink-0 text-[9px] text-[var(--muted)]">{format_timestamp(result.timestamp_ms)}</span>}
                    {typeof result.score === 'number' && <span className="shrink-0 text-[9px] text-[var(--muted)]">{Math.max(0, Math.round(result.score * 100))}%</span>}
                  </div>
                  {result.concept_title && <div className="mt-0.5 truncate text-[9px] font-medium text-[var(--muted)]">Concept · {result.concept_title}</div>}
                  {result.content && <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--muted)]">{result.content}</div>}
                </button>
                {result.semantic && (
                  <button className="mr-1 mt-1.5 shrink-0 rounded px-1.5 py-1 text-[9px] text-[var(--muted)] opacity-70 hover:bg-[var(--selected)] hover:text-[var(--text)] group-hover:opacity-100" onClick={() => void find_similar(result)} title="Find semantically similar files" type="button">Similar</button>
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
