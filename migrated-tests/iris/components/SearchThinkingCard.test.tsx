/** Protects the expandable live-thinking presentation used by Search answers. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SearchThinkingCard from '@/components/search/SearchThinkingCard'

describe('SearchThinkingCard', () => {
  it('shows streamed thinking live, collapses when the answer starts, and remains expandable', () => {
    const view = render(<SearchThinkingCard content="Reviewing **source evidence**" active answerStarted={false} />)

    expect(screen.getByText('source evidence')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /model thinking/i })).toHaveAttribute('aria-expanded', 'true')

    view.rerender(<SearchThinkingCard content="Reviewing **source evidence**" active answerStarted />)

    expect(screen.queryByText('source evidence')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /model thinking/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(screen.getByText('source evidence')).toBeInTheDocument()
  })
})
