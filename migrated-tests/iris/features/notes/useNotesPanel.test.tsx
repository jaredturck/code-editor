/**
 * Exercises note selection, encrypted auto-save, pinning, duplication, deletion, and
 * drag-order state through the Notes panel hook.
 */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readNotes, writeNotes } from '@/platform/notesStorage'

const mocks = vi.hoisted(() => ({
  setOrbState: vi.fn(),
}))

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({ settings: {} }),
  useClipboardHistory: () => ({ clipboardHistory: [] }),
  useOrbShell: () => ({ setOrbState: mocks.setOrbState }),
}))

vi.mock('@/platform/aiService', () => ({
  callAI: vi.fn(),
}))

import { useNotesPanel } from '@/platform-features/notes/useNotesPanel'

describe('useNotesPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.setOrbState.mockReset()
    writeNotes([
      { id: 1, title: 'First', content: '# First', sortOrder: 0 },
      { id: 2, title: 'Second', content: 'Second body', sortOrder: 1 },
    ])
  })

  it('debounces encrypted auto-save and exposes current save status', () => {
    const { result } = renderHook(() => useNotesPanel())

    act(() => {
      result.current.selectNote(1)
      result.current.updateNote(1, { content: '# Updated' })
    })

    expect(result.current.activeNote?.content).toBe('# Updated')
    expect(result.current.saveStatus).toBe('saving')

    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(result.current.saveStatus).toBe('saved')
    expect(readNotes().find((note) => note.id === 1)?.content).toBe('# Updated')
  })

  it('pins, duplicates, reorders, and deletes notes without stale selection state', () => {
    const { result } = renderHook(() => useNotesPanel())

    act(() => result.current.togglePinned(2))
    expect(result.current.notes[0]).toMatchObject({ id: 2, pinned: true })

    act(() => result.current.duplicateNote(2))
    const duplicate = result.current.notes.find((note) => note.title === 'Second (Copy)')
    expect(duplicate).toBeDefined()
    expect(result.current.activeNoteId).toBe(duplicate?.id)
    expect(duplicate).toMatchObject({ pinned: true, content: 'Second body' })

    act(() => result.current.reorderNote(2, duplicate!.id))
    expect(result.current.notes.slice(0, 2).map((note) => note.id)).toEqual([duplicate!.id, 2])

    act(() => result.current.deleteNote(duplicate!.id))
    expect(result.current.notes.some((note) => note.id === duplicate!.id)).toBe(false)
    expect(result.current.activeNoteId).toBe(2)
  })

  it('creates new regular notes below pinned notes', () => {
    const { result } = renderHook(() => useNotesPanel())

    act(() => result.current.togglePinned(1))
    act(() => result.current.createNote())

    expect(result.current.notes[0]).toMatchObject({ id: 1, pinned: true })
    expect(result.current.notes[1]).toMatchObject({
      title: 'New Note',
      pinned: false,
    })
    expect(result.current.activeNoteId).toBe(result.current.notes[1].id)
  })
})
