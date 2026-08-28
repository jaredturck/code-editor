import { useState, type FormEvent } from 'react'
import { searchProjectFileNames, searchProjectText } from '../platform/projectSearch'

interface SearchResult {
  path: string
  line: number | null
  content: string
}

type SearchMode = 'text' | 'files'

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
  const [replace_open, set_replace_open] = useState(false)
  const [match_case, set_match_case] = useState(false)
  const [match_word, set_match_word] = useState(false)
  const [use_regex, set_use_regex] = useState(false)
  const [preserve_case, set_preserve_case] = useState(false)
  const [search_mode, set_search_mode] = useState<SearchMode>('text')
  const [query, set_query] = useState('')
  const [results, set_results] = useState<SearchResult[]>([])
  const [result_label, set_result_label] = useState('')
  const [loading, set_loading] = useState(false)
  const [has_searched, set_has_searched] = useState(false)
  const [error, set_error] = useState('')

  const reset_pending_search = () => {
    set_results([])
    set_result_label('')
    set_has_searched(false)
    set_error('')
  }

  const select_search_mode = (mode: SearchMode) => {
    set_search_mode(mode)
    reset_pending_search()
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

    try {
      if (search_mode === 'files') {
        const matches = await searchProjectFileNames(rootPath, search_query, 200)
        set_results(matches.map((item) => ({ path: item.path, line: null, content: '' })))
        set_result_label('File-name matches')
      } else {
        const matches = await searchProjectText(rootPath, search_query, {
          ignoreCase: !match_case,
          useRegex: use_regex,
          wordBoundary: match_word,
          maxResults: 200,
        })
        set_results(matches.map((item) => ({ path: item.file, line: item.line, content: item.content })))
        set_result_label('Text matches')
      }
    } catch (search_error) {
      set_results([])
      set_result_label('')
      set_error(search_error instanceof Error ? search_error.message : 'Project search failed.')
    } finally {
      set_loading(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <form className="shrink-0" onSubmit={(event) => void run_search(event)}>
        <div className="mb-2 grid grid-cols-2 rounded border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5 text-[10px]">
          {(['text', 'files'] as SearchMode[]).map((mode) => (
            <button
              aria-pressed={search_mode === mode}
              className={`rounded px-1 py-1 ${search_mode === mode ? 'bg-[var(--selected)] text-[var(--text)]' : 'text-[var(--muted)]'}`}
              key={mode}
              onClick={() => select_search_mode(mode)}
              type="button"
            >
              {mode === 'text' ? 'Text' : 'Files'}
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
                placeholder={search_mode === 'files' ? 'Search file names' : 'Search project text'}
                type="text"
                value={query}
              />

              {search_mode === 'text' && (
                <div className="ml-1 flex items-center gap-0.5">
                  <SearchToggle
                    active={match_case}
                    label="Match case"
                    onClick={() => {
                      set_match_case((value) => !value)
                      set_has_searched(false)
                    }}
                  >
                    Aa
                  </SearchToggle>
                  <SearchToggle
                    active={match_word}
                    label="Match whole word"
                    onClick={() => {
                      set_match_word((value) => !value)
                      set_has_searched(false)
                    }}
                  >
                    ab
                  </SearchToggle>
                  <SearchToggle
                    active={use_regex}
                    label="Use regular expression"
                    onClick={() => {
                      set_use_regex((value) => !value)
                      set_has_searched(false)
                    }}
                  >
                    .*
                  </SearchToggle>
                </div>
              )}

              <button
                aria-label="Run search"
                className="ml-1 flex h-6 min-w-7 items-center justify-center rounded px-1.5 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40"
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
                <SearchToggle
                  active={preserve_case}
                  label="Preserve case"
                  onClick={() => set_preserve_case((value) => !value)}
                >
                  AB
                </SearchToggle>
              </div>
            )}
          </div>
        </div>
      </form>

      <div className="mt-3 min-h-0 flex-1 overflow-auto border-t border-[var(--border)] pt-2">
        {loading && <div className="px-1 py-2 text-xs text-[var(--muted)]">Searching project…</div>}
        {!loading && error && <div className="px-1 py-2 text-xs text-red-400">{error}</div>}
        {!loading && !error && query.trim() && !has_searched && (
          <div className="px-1 py-2 text-[10px] text-[var(--muted)]">Press Enter or Go to search.</div>
        )}
        {!loading && !error && has_searched && results.length === 0 && (
          <div className="px-1 py-2 text-xs text-[var(--muted)]">No results.</div>
        )}
        {!loading && results.length > 0 && (
          <>
            <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {result_label || `${results.length} result${results.length === 1 ? '' : 's'}`} · {results.length}
            </div>
            {results.map((result, index) => (
              <button
                className="block w-full min-w-0 rounded px-1.5 py-1.5 text-left hover:bg-[var(--hover)]"
                key={`${result.path}:${result.line ?? 0}:${index}`}
                onClick={() => onOpenFile(result.path)}
                title={result.path}
                type="button"
              >
                <div className="truncate text-[11px] text-[var(--text)]">
                  {rootPath ? workspace_display_path(rootPath, result.path) : result.path}
                  {result.line ? `:${result.line}` : ''}
                </div>
                {result.content && (
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--muted)]">{result.content}</div>
                )}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default SearchPanel
