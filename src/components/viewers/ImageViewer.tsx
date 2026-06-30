import { useState } from 'react'
import type { MediaEditorDocument } from '../../types/editor'

function ImageViewer({ document }: { document: MediaEditorDocument }) {
  const [zoom, set_zoom] = useState(1)
  const [fit, set_fit] = useState(true)
  const [dimensions, set_dimensions] = useState('')
  const [error, set_error] = useState('')

  if (error) {
    return <div className="flex flex-1 items-center justify-center p-8 text-sm text-red-400">{error}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--editor-bg)]">
      <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-b border-[var(--border)] text-xs">
        <button
          className="viewer-button"
          onClick={() => {
            set_fit(false)
            set_zoom((value) => Math.max(0.1, value - 0.1))
          }}
          type="button"
        >
          −
        </button>
        <span className="min-w-14 text-center text-[var(--muted)]">{Math.round(zoom * 100)}%</span>
        <button
          className="viewer-button"
          onClick={() => {
            set_fit(false)
            set_zoom((value) => Math.min(8, value + 0.1))
          }}
          type="button"
        >
          +
        </button>
        <button
          className={`viewer-button px-3 ${fit ? 'viewer-button-active' : ''}`}
          onClick={() => {
            set_fit(true)
            set_zoom(1)
          }}
          type="button"
        >
          Fit
        </button>
        <button
          className="viewer-button px-3"
          onClick={() => {
            set_fit(false)
            set_zoom(1)
          }}
          type="button"
        >
          Actual size
        </button>
        <span className="ml-3 text-[10px] text-[var(--muted)]">
          {dimensions && `${dimensions} · `}
          {(document.size / 1024).toFixed(1)} KB
        </span>
      </div>
      <div className="image-viewer-background min-h-0 flex-1 overflow-auto p-8">
        <div className="flex min-h-full min-w-full items-center justify-center">
          <img
            alt={document.name}
            className={fit ? 'max-h-full max-w-full object-contain shadow-2xl' : 'max-w-none shadow-2xl'}
            draggable={false}
            onError={() => set_error(`Unable to display ${document.name}. The image may be corrupt or unsupported.`)}
            onLoad={(event) =>
              set_dimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)
            }
            src={document.url}
            style={fit ? undefined : { transform: `scale(${zoom})`, transformOrigin: 'center' }}
          />
        </div>
      </div>
    </div>
  )
}

export default ImageViewer
