import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const read_artifact = vi.hoisted(() => vi.fn())

vi.mock('../src/platform/desktopBridge', () => ({
  readArtifact: read_artifact,
}))

import MarkdownView from '../src/components/MarkdownView'

describe('MarkdownView', () => {
  it('renders GitHub-flavored Markdown and highlighted code', () => {
    render(<MarkdownView content={'# Hello\n\n- [x] Task\n\n```js\nconst value = 1\n```'} />)

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(document.querySelector('.hljs')).toBeInTheDocument()
  })

  it('opens encrypted artifact references inside the Code Editor shell', async () => {
    read_artifact.mockResolvedValueOnce({
      id: 'artifact-1',
      filename: 'architecture.md',
      type: 'markdown',
      summary: 'Architecture report',
      content: '# Architecture\n\nDurable encrypted report body.',
    })

    render(<MarkdownView content={'[Open architecture report](artifact:artifact-1)'} />)
    fireEvent.click(screen.getByRole('link', { name: 'Open architecture report' }))

    await waitFor(() => expect(read_artifact).toHaveBeenCalledWith('artifact-1'))
    expect(screen.getByRole('dialog', { name: 'Artifact viewer: architecture.md' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Architecture' })).toBeInTheDocument()
    expect(screen.getByText('Durable encrypted report body.')).toBeInTheDocument()
  })
})
