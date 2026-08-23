/** Protects search-history row actions and destructive confirmation behavior. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchHistorySidebar from '@/components/search/SearchHistorySidebar'

const item = {
  id: 'search-1',
  query: 'what is a cat',
  title: 'What is a cat?',
  quickStatus: 'complete',
  detailedStatus: 'idle',
  createdAt: 100,
  updatedAt: 100,
}

function renderSidebar(overrides = {}) {
  const props = {
    items: [item],
    selectedId: 'search-1',
    activeOperationSessionId: null,
    loading: false,
    onNew: vi.fn(),
    onSelect: vi.fn().mockResolvedValue(undefined),
    onCopyQuestion: vi.fn().mockResolvedValue(true),
    onCopyAnswer: vi.fn().mockResolvedValue(true),
    onDuplicate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onClear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(<SearchHistorySidebar {...props} />)
  return props
}

describe('SearchHistorySidebar', () => {
  it('opens the row menu and exposes copy, duplicate, and confirmed delete actions', async () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for What is a cat?' }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy question' }))
    await waitFor(() => expect(props.onCopyQuestion).toHaveBeenCalledWith('search-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Actions for What is a cat?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete saved search?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('search-1'))
  })

  it('requires confirmation before clearing the complete encrypted history', async () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Search history settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all history…' }))
    expect(screen.getByText('Clear all search history?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all history' }))
    await waitFor(() => expect(props.onClear).toHaveBeenCalledTimes(1))
  })
})
