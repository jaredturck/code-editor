import { useState } from 'react'
import type { MediaEditorDocument } from '../../types/editor'

function VideoViewer({ document }: { document: MediaEditorDocument }) {
  const [error, set_error] = useState('')

  if (error) {
    return <div className="flex flex-1 items-center justify-center bg-black p-8 text-sm text-red-300">{error}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-6">
      <video
        className="max-h-full max-w-full rounded-lg shadow-2xl"
        controls
        onError={() =>
          set_error(`This Chromium build cannot decode ${document.name}. The container or codec may be unsupported.`)
        }
        src={document.url}
      >
        This Chromium build cannot play {document.name}.
      </video>
    </div>
  )
}

export default VideoViewer
