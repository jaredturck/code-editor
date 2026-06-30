import { useEffect, useState } from 'react'
import hljs from 'highlight.js/lib/common'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
}: {
  href?: string
  children: React.ReactNode
  baseFilePath?: string | null
  onOpenLocal?: (filePath: string) => void
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (!href || href.startsWith('#')) {
          return
        }

        event.preventDefault()

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

function escape_html(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

function MarkdownView({ content, baseFilePath = null, className = 'artifact-md', onOpenLocal }: MarkdownViewProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <MarkdownLink baseFilePath={baseFilePath} href={href} onOpenLocal={onOpenLocal}>
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
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownView
