import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdf_worker_url from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { MediaEditorDocument } from '../../types/editor'

GlobalWorkerOptions.workerSrc = pdf_worker_url

type FitMode = 'none' | 'width' | 'page'

function PdfViewer({ document }: { document: MediaEditorDocument }) {
  const canvas_ref = useRef<HTMLCanvasElement>(null)
  const page_container_ref = useRef<HTMLDivElement>(null)
  const scroll_container_ref = useRef<HTMLDivElement>(null)
  const text_layer_ref = useRef<HTMLDivElement>(null)
  const render_task_ref = useRef<{ cancel: () => void } | null>(null)
  const text_layer_task_ref = useRef<TextLayer | null>(null)
  const [pdf, set_pdf] = useState<PDFDocumentProxy | null>(null)
  const [page_number, set_page_number] = useState(1)
  const [zoom, set_zoom] = useState(1.2)
  const [rotation, set_rotation] = useState(0)
  const [fit_mode, set_fit_mode] = useState<FitMode>('none')
  const [error, set_error] = useState('')

  useEffect(() => {
    let active = true
    const task = getDocument({ url: document.url })

    void task.promise
      .then((loaded_pdf) => {
        if (active) {
          set_pdf(loaded_pdf)
          set_page_number(1)
          set_error('')
        }
      })
      .catch((value: unknown) => {
        if (active) {
          set_error(value instanceof Error ? value.message : 'Unable to open this PDF.')
        }
      })

    return () => {
      active = false
      render_task_ref.current?.cancel()
      text_layer_task_ref.current?.cancel()
      void task.destroy()
      set_pdf(null)
    }
  }, [document.url])

  const calculate_fit_zoom = async (mode: Exclude<FitMode, 'none'>) => {
    if (!pdf || !scroll_container_ref.current) {
      return
    }

    const page = await pdf.getPage(page_number)
    const viewport = page.getViewport({ scale: 1, rotation })
    const container = scroll_container_ref.current
    const width_scale = Math.max(0.1, (container.clientWidth - 48) / viewport.width)
    const height_scale = Math.max(0.1, (container.clientHeight - 48) / viewport.height)
    set_zoom(Math.min(4, mode === 'width' ? width_scale : Math.min(width_scale, height_scale)))
  }

  const apply_fit = (mode: Exclude<FitMode, 'none'>) => {
    set_fit_mode(mode)
    void calculate_fit_zoom(mode)
  }

  useEffect(() => {
    if (fit_mode === 'none') {
      return
    }

    void calculate_fit_zoom(fit_mode)
    const container = scroll_container_ref.current

    if (!container) {
      return
    }

    const observer = new ResizeObserver(() => {
      void calculate_fit_zoom(fit_mode)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [fit_mode, page_number, pdf, rotation])

  useEffect(() => {
    if (!pdf || !canvas_ref.current || !text_layer_ref.current || !page_container_ref.current) {
      return
    }

    let active = true
    void pdf
      .getPage(page_number)
      .then(async (page) => {
        if (!active || !canvas_ref.current || !text_layer_ref.current || !page_container_ref.current) {
          return
        }

        const viewport = page.getViewport({ scale: zoom, rotation })
        const canvas = canvas_ref.current
        const page_container = page_container_ref.current
        const text_container = text_layer_ref.current
        const context = canvas.getContext('2d')

        if (!context) {
          return
        }

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        page_container.style.width = `${viewport.width}px`
        page_container.style.height = `${viewport.height}px`
        text_container.replaceChildren()
        text_container.style.width = `${viewport.width}px`
        text_container.style.height = `${viewport.height}px`

        render_task_ref.current?.cancel()
        text_layer_task_ref.current?.cancel()

        const render_task = page.render({
          canvas,
          canvasContext: context,
          viewport,
        })
        render_task_ref.current = render_task
        const text_content = await page.getTextContent()

        if (!active) {
          return
        }

        const text_layer = new TextLayer({
          container: text_container,
          textContentSource: text_content,
          viewport,
        })
        text_layer_task_ref.current = text_layer

        await Promise.all([render_task.promise, text_layer.render()])
        set_error('')
      })
      .catch((value: unknown) => {
        if (value instanceof Error && value.name !== 'RenderingCancelledException') {
          set_error(value.message)
        }
      })

    return () => {
      active = false
      render_task_ref.current?.cancel()
      text_layer_task_ref.current?.cancel()
    }
  }, [page_number, pdf, rotation, zoom])

  const change_zoom = (amount: number) => {
    set_fit_mode('none')
    set_zoom((value) => Math.min(4, Math.max(0.4, value + amount)))
  }

  if (error) {
    return <div className="flex flex-1 items-center justify-center p-8 text-sm text-red-400">{error}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--editor-bg)]">
      <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-b border-[var(--border)] text-xs">
        <button
          className="viewer-button"
          disabled={page_number <= 1}
          onClick={() => set_page_number((page) => Math.max(1, page - 1))}
          type="button"
        >
          ‹
        </button>
        <span className="min-w-24 text-center text-[var(--muted)]">
          Page {page_number} of {pdf?.numPages ?? '…'}
        </span>
        <button
          className="viewer-button"
          disabled={!pdf || page_number >= pdf.numPages}
          onClick={() => set_page_number((page) => Math.min(pdf?.numPages ?? page, page + 1))}
          type="button"
        >
          ›
        </button>
        <span className="mx-2 h-5 w-px bg-[var(--border)]" />
        <button className="viewer-button" onClick={() => change_zoom(-0.2)} type="button">
          −
        </button>
        <span className="min-w-12 text-center text-[var(--muted)]">{Math.round(zoom * 100)}%</span>
        <button className="viewer-button" onClick={() => change_zoom(0.2)} type="button">
          +
        </button>
        <button
          className={`viewer-button px-3 ${fit_mode === 'width' ? 'viewer-button-active' : ''}`}
          onClick={() => apply_fit('width')}
          type="button"
        >
          Fit width
        </button>
        <button
          className={`viewer-button px-3 ${fit_mode === 'page' ? 'viewer-button-active' : ''}`}
          onClick={() => apply_fit('page')}
          type="button"
        >
          Fit page
        </button>
        <button
          className="viewer-button px-3"
          onClick={() => set_rotation((value) => (value + 90) % 360)}
          type="button"
        >
          Rotate
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-800 p-6 text-center" ref={scroll_container_ref}>
        {!pdf && <div className="py-20 text-sm text-neutral-300">Loading PDF…</div>}
        <div className="pdf-page relative mx-auto bg-white shadow-2xl" ref={page_container_ref}>
          <canvas className="absolute inset-0" ref={canvas_ref} />
          <div className="pdf-text-layer absolute inset-0 overflow-hidden text-left" ref={text_layer_ref} />
        </div>
      </div>
    </div>
  )
}

export default PdfViewer
