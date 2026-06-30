import { useState } from 'react'
import type { MediaEditorDocument } from '../../types/editor'

function AudioViewer({ document }: { document: MediaEditorDocument }) {
  const [error, set_error] = useState('')

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--editor-bg)] p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-sky-500/15 text-4xl text-sky-400">
            ♪
          </div>
          <h2 className="truncate text-lg font-semibold text-[var(--text)]">{document.name}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{(document.size / 1024 / 1024).toFixed(2)} MB</p>
        </div>
        {error ? (
          <p className="text-center text-sm text-red-400">{error}</p>
        ) : (
          <audio
            className="w-full"
            controls
            onError={() =>
              set_error(`This Chromium build cannot decode ${document.name}. The codec may be unsupported.`)
            }
            src={document.url}
          />
        )}
      </div>
    </div>
  )
}

export default AudioViewer
