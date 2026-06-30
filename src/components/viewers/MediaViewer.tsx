import type { MediaEditorDocument } from '../../types/editor'
import AudioViewer from './AudioViewer'
import ImageViewer from './ImageViewer'
import PdfViewer from './PdfViewer'
import UnsupportedFileViewer from './UnsupportedFileViewer'
import VideoViewer from './VideoViewer'

function MediaViewer({ document }: { document: MediaEditorDocument }) {
  if (document.media_type === 'image') return <ImageViewer document={document} />
  if (document.media_type === 'video') return <VideoViewer document={document} />
  if (document.media_type === 'audio') return <AudioViewer document={document} />
  if (document.media_type === 'pdf') return <PdfViewer document={document} />
  return <UnsupportedFileViewer document={document} />
}

export default MediaViewer
