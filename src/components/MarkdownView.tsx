import { memo, useEffect, useState } from 'react'
import hljs from 'highlight.js/lib/common'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readArtifact, type BridgeArtifact } from '../platform/desktopBridge'

interface MarkdownViewProps {
  content: string
  baseFilePath?: string | null
  className?: string
  onOpenLocal?: (filePath: string) => void
}

function MarkdownImage({ src, alt, baseFilePath }: { src?: string; alt?: string; baseFilePath?: string | null }) {
  const [resolved_src, set_resolved_src] = useState(src ?? '')

  useEffect(() => {
    if (!src || !baseFilePath || /^(?:https?:|data:|editor-file:)/i.test(src)) {
      set_resolved_src(src ?? '')
      return
    }

    let active = true
    void window.editor_api.file.resolve_relative(baseFilePath, src).then((result) => {
      if (active) {
        set_resolved_src(result?.resource_url ?? '')
      }
    })

    return () => {
      active = false
    }
  }, [baseFilePath, src])

  if (!resolved_src) {
    return <span className="text-xs text-red-400">[Missing image: {alt || src}]</span>
  }

  return <img alt={alt ?? ''} className="max-w-full rounded-lg border border-[var(--border)]" src={resolved_src} />
}

function MarkdownLink({
  href,
  children,
  baseFilePath,
  onOpenLocal,
  onOpenArtifact,
}: {
  href?: string
  children: React.ReactNode
  baseFilePath?: string | null
  onOpenLocal?: (filePath: string) => void
  onOpenArtifact?: (artifactId: string) => void
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (!href || href.startsWith('#')) {
          return
        }

        event.preventDefault()

        const artifact_id = artifact_id_from_href(href)
        if (artifact_id) {
          onOpenArtifact?.(artifact_id)
          return
        }

        if (/^https?:\/\//i.test(href)) {
          window.editor_api.file.open_external(href)
          return
        }

        if (baseFilePath) {
          void window.editor_api.file.resolve_relative(baseFilePath, href).then((result) => {
            if (result) {
              onOpenLocal?.(result.file_path)
            }
          })
        }
      }}
    >
      {children}
    </a>
  )
}

function artifact_id_from_href(href: string) {
  if (href.startsWith('artifact:')) {
    const encoded = href.slice('artifact:'.length).trim()
    if (!encoded) return ''
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }

  const match = /^\/artifacts\/([^/?#]+)/i.exec(href)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function markdown_url_transform(url: string) {
  if (url.startsWith('artifact:')) return url
  return defaultUrlTransform(url)
}

function ArtifactPreview({ artifact, onClose }: { artifact: BridgeArtifact; onClose: () => void }) {
  const filename = String(artifact.filename || artifact.path || 'Artifact')
  const content = String(artifact.content || '')
  const markdown = /\.(?:md|markdown)$/i.test(filename) || /markdown/i.test(String(artifact.type || ''))

  return (
    <div
      aria-label={`Artifact viewer: ${filename}`}
      aria-modal="true"
      className="fixed inset-0 z-[500] grid place-items-center bg-black/70 p-6"
      role="dialog"
    >
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-[var(--text)]">{filename}</div>
            {artifact.summary && (
              <div className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{String(artifact.summary)}</div>
            )}
          </div>
          <span className="text-[9px] text-[var(--muted)]">Encrypted artifact snapshot</span>
          <button
            aria-label="Close artifact viewer"
            className="rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {markdown ? (
            <MarkdownView content={content} />
          ) : (
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text)]">{content}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

function escape_html(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

function MarkdownView({ content, baseFilePath = null, className = 'artifact-md', onOpenLocal }: MarkdownViewProps) {
  const [artifact_preview, set_artifact_preview] = useState<BridgeArtifact | null>(null)
  const [artifact_error, set_artifact_error] = useState('')

  const open_artifact = async (artifact_id: string) => {
    set_artifact_error('')
    try {
      const artifact = await readArtifact(artifact_id)
      if (!artifact) {
        set_artifact_error('The encrypted artifact could not be found.')
        return
      }
      set_artifact_preview(artifact)
    } catch (error) {
      set_artifact_error(error instanceof Error ? error.message : 'Unable to open the encrypted artifact.')
    }
  }

  return (
    <>
      <div className={className}>
        <ReactMarkdown
          components={{
            a: ({ href, children }) => (
              <MarkdownLink
                baseFilePath={baseFilePath}
                href={href}
                onOpenArtifact={(artifact_id) => void open_artifact(artifact_id)}
                onOpenLocal={onOpenLocal}
              >
                {children}
              </MarkdownLink>
            ),
            img: ({ src, alt }) => <MarkdownImage alt={alt} baseFilePath={baseFilePath} src={src} />,
            code: ({ className: code_class_name, children }) => {
              const text = String(children ?? '').replace(/\n$/, '')
              const language = /language-([\w+#.-]+)/.exec(code_class_name ?? '')?.[1]
              const block = Boolean(language) || text.includes('\n')

              if (!block) {
                return <code>{text}</code>
              }

              let html = ''

              try {
                html =
                  language && hljs.getLanguage(language)
                    ? hljs.highlight(text, { language }).value
                    : hljs.highlightAuto(text).value
              } catch {
                html = escape_html(text)
              }

              return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
            },
          }}
          remarkPlugins={[remarkGfm]}
          urlTransform={markdown_url_transform}
        >
          {content}
        </ReactMarkdown>
      </div>
      {artifact_error && (
        <div className="mt-2 rounded border border-red-500/30 bg-red-500/8 px-2 py-1 text-[10px] text-red-300">
          {artifact_error}
        </div>
      )}
      {artifact_preview && <ArtifactPreview artifact={artifact_preview} onClose={() => set_artifact_preview(null)} />}
    </>
  )
}

export default memo(MarkdownView)
