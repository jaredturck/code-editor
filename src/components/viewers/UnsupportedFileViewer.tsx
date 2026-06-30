import type { MediaEditorDocument } from '../../types/editor'

function UnsupportedFileViewer({ document }: { document: MediaEditorDocument }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--editor-bg)] p-8">
      <div className="max-w-lg text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-3xl text-[var(--muted)]">
          ?
        </div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Preview unavailable</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {document.name} is not a text file or a media format supported by this Chromium build.
        </p>
      </div>
    </div>
  )
}

export default UnsupportedFileViewer
