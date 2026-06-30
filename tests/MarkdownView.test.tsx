import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownView from '../src/components/MarkdownView'

describe('MarkdownView', () => {
  it('renders GitHub-flavored Markdown and highlighted code', () => {
    render(<MarkdownView content={'# Hello\n\n- [x] Task\n\n```js\nconst value = 1\n```'} />)

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(document.querySelector('.hljs')).toBeInTheDocument()
  })
})
