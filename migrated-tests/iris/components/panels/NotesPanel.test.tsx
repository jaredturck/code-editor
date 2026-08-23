/**
 * Verifies the Notes panel exposes Markdown preview, row actions, confirmation, and native
 * drag ordering through the feature hook contract.
 */

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeNoteId: 1,
  notes: [
    {
      id: 1,
      title: 'Alpha',
      content: '# Alpha',
      color: 'default',
      category: 'general',
      tags: [],
      summary: '',
      sessionScoped: false,
      pinned: false,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 2,
      title: 'Beta',
      content: 'Beta body',
      color: 'default',
      category: 'general',
      tags: [],
      summary: '',
      sessionScoped: false,
      pinned: false,
      sortOrder: 1,
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  selectNote: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  togglePinned: vi.fn(),
  duplicateNote: vi.fn(),
  reorderNote: vi.fn(),
  copyClipboard: vi.fn(),
  summarizeNote: vi.fn(),
  insertTranscript: vi.fn(),
  requestStart: vi.fn(),
  allowMicrophone: vi.fn(),
  denyMicrophone: vi.fn(),
  installModel: vi.fn(),
  dismissModelPrompt: vi.fn(),
  stopRecording: vi.fn(),
  cancelTranscription: vi.fn(),
}))

vi.mock('@/components/panels/PanelBase', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div>,
}))

vi.mock('@/platform-features/notes/useNotesPanel', () => ({
  useNotesPanel: () => ({
    tab: 'notes',
    setTab: vi.fn(),
    notes: mocks.notes,
    activeNote: mocks.notes.find((note) => note.id === mocks.activeNoteId) || null,
    activeNoteId: mocks.activeNoteId,
    selectNote: mocks.selectNote,
    copiedIdx: null,
    isAiWorking: false,
    saveStatus: 'saved',
    clipboardHistory: [],
    createNote: mocks.createNote,
    updateNote: mocks.updateNote,
    deleteNote: mocks.deleteNote,
    togglePinned: mocks.togglePinned,
    duplicateNote: mocks.duplicateNote,
    reorderNote: mocks.reorderNote,
    copyClipboard: mocks.copyClipboard,
    summarizeNote: mocks.summarizeNote,
    insertTranscript: mocks.insertTranscript,
  }),
}))

vi.mock('@/platform-features/notes/useNoteTranscription', () => ({
  useNoteTranscription: () => ({
    phase: 'idle',
    elapsedSeconds: 0,
    error: '',
    permissionPromptOpen: false,
    modelPromptOpen: false,
    modelStatus: null,
    requestStart: mocks.requestStart,
    allowMicrophone: mocks.allowMicrophone,
    denyMicrophone: mocks.denyMicrophone,
    installModel: mocks.installModel,
    dismissModelPrompt: mocks.dismissModelPrompt,
    stopRecording: mocks.stopRecording,
    cancel: mocks.cancelTranscription,
  }),
}))

import NotesPanel from '@/components/panels/NotesPanel'

describe('NotesPanel', () => {
  beforeEach(() => {
    mocks.activeNoteId = 1
    mocks.notes = [
      {
        id: 1,
        title: 'Alpha',
        content: '# Alpha',
        color: 'default',
        category: 'general',
        tags: [],
        summary: '',
        sessionScoped: false,
        pinned: false,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 2,
        title: 'Beta',
        content: 'Beta body',
        color: 'default',
        category: 'general',
        tags: [],
        summary: '',
        sessionScoped: false,
        pinned: false,
        sortOrder: 1,
        createdAt: 2,
        updatedAt: 2,
      },
    ]
    for (const value of Object.values(mocks)) {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
    }
  })

  it('renders Markdown preview and exposes pin, duplicate, and delete row actions', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<NotesPanel />)

    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(mocks.togglePinned).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(mocks.duplicateNote).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Alpha' }))
    const actionMenu = screen.getByRole('button', {
      name: 'Duplicate',
    }).parentElement!
    fireEvent.click(within(actionMenu).getByRole('button', { name: 'Delete' }))
    expect(window.confirm).toHaveBeenCalledWith('Delete "Alpha"?')
    expect(mocks.deleteNote).toHaveBeenCalledWith(1)
  })

  it('opens existing notes in selectable preview and double-clicks into the focused editor', () => {
    render(<NotesPanel />)

    const preview = screen.getByLabelText('Rendered note preview')
    expect(preview).toHaveStyle({ userSelect: 'text' })
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.doubleClick(preview)

    const editor = screen.getByRole('textbox', { name: 'Note content' })
    expect(editor).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('returns to preview when a note is selected and opens a new blank note in edit mode', () => {
    const { rerender } = render(<NotesPanel />)

    fireEvent.doubleClick(screen.getByLabelText('Rendered note preview'))
    fireEvent.click(screen.getByRole('button', { name: 'Open note Beta' }))
    expect(mocks.selectNote).toHaveBeenCalledWith(2)
    expect(screen.getByLabelText('Rendered note preview')).toBeInTheDocument()

    mocks.createNote.mockImplementation(() => {
      mocks.notes = [
        ...mocks.notes,
        {
          id: 3,
          title: 'New Note',
          content: '',
          color: 'default',
          category: 'general',
          tags: [],
          summary: '',
          sessionScoped: false,
          pinned: false,
          sortOrder: 2,
          createdAt: 3,
          updatedAt: 3,
        },
      ]
      mocks.activeNoteId = 3
    })

    fireEvent.click(screen.getByRole('button', { name: 'New Note' }))
    rerender(<NotesPanel />)

    expect(screen.getByRole('textbox', { name: 'Note content' })).toHaveFocus()
  })

  it('starts voice recording from the microphone button', () => {
    render(<NotesPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Start voice transcription' }))

    expect(mocks.requestStart).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Note content' })).toBeInTheDocument()
  })

  it('reorders notes through native drag and drop', () => {
    render(<NotesPanel />)
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) || '',
    }

    fireEvent.dragStart(screen.getByRole('button', { name: 'Open note Alpha' }), {
      dataTransfer,
    })
    fireEvent.dragOver(screen.getByRole('button', { name: 'Open note Beta' }), {
      dataTransfer,
    })
    fireEvent.drop(screen.getByRole('button', { name: 'Open note Beta' }), {
      dataTransfer,
    })

    expect(mocks.reorderNote).toHaveBeenCalledWith(1, 2)
  })
})
