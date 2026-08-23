/**
 * Owns the state, persistence, and bridge interactions for the notes panel. The hook leaves
 * rendering to the panel component while keeping the feature workflow testable and
 * reusable.
 */

import { useEffect, useRef, useState } from 'react'
import { useClipboardHistory, useOrbSettings, useOrbShell } from '@/platform-context/AgentSettingsContext'
import { runBoundedRoleTask } from '@/platform/agent/boundedRoleTask'
import { normalizeNoteOrder, readNotes, reindexNoteOrder, writeNotes } from '@/platform/notesStorage'
import type { StoredNote } from '@/platform/notesStorage'
import { insertTranscriptAtSelection } from '@/platform-features/notes/transcriptInsertion'

const NOTE_SAVE_DELAY_MS = 400

export type NoteRecord = StoredNote
export type NoteUpdates = Partial<Pick<StoredNote, 'title' | 'content' | 'color'>>
export type NoteSaveStatus = 'saved' | 'saving'

function nextNoteId(notes: StoredNote[]): number {
  return notes.reduce((max, note) => Math.max(max, Number(note.id) || 0), 0) + 1
}

function createNoteRecord(notes: StoredNote[]): StoredNote {
  const createdAt = Date.now()
  return {
    id: nextNoteId(notes),
    title: 'New Note',
    content: '',
    color: 'default',
    category: 'general',
    tags: [],
    summary: '',
    sessionScoped: false,
    pinned: false,
    sortOrder: -1,
    createdAt,
    updatedAt: createdAt,
  }
}

function createDuplicateTitle(title: string): string {
  const normalized = String(title || 'New Note').trim() || 'New Note'
  return `${normalized} (Copy)`
}

function placeNoteAtGroupStart(notes: StoredNote[], note: StoredNote): StoredNote[] {
  const withoutNote = notes.filter((item) => item.id !== note.id)
  const pinned = withoutNote.filter((item) => item.pinned)
  const regular = withoutNote.filter((item) => !item.pinned)
  return reindexNoteOrder(note.pinned ? [note, ...pinned, ...regular] : [...pinned, note, ...regular])
}

function insertDuplicateAfterSource(notes: StoredNote[], sourceId: number, duplicate: StoredNote): StoredNote[] {
  const sourceIndex = notes.findIndex((note) => note.id === sourceId)
  if (sourceIndex < 0) return notes
  const next = [...notes]
  next.splice(sourceIndex + 1, 0, duplicate)
  return reindexNoteOrder(next)
}

function moveNoteWithinGroup(notes: StoredNote[], sourceId: number, targetId: number): StoredNote[] {
  if (sourceId === targetId) return notes
  const source = notes.find((note) => note.id === sourceId)
  const target = notes.find((note) => note.id === targetId)
  if (!source || !target || source.pinned !== target.pinned) return notes

  const next = [...notes]
  const sourceIndex = next.findIndex((note) => note.id === sourceId)
  const targetIndex = next.findIndex((note) => note.id === targetId)
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return reindexNoteOrder(next)
}

/**
 * Owns note loading, selection, editing, creation, deletion, pinning, duplication, ordering,
 * and clipboard-derived content for the Notes panel. Notes auto-save through the encrypted
 * renderer store after a short debounce, while unmount cleanup flushes the latest draft.
 */
export function useNotesPanel() {
  const { settings } = useOrbSettings()
  const { clipboardHistory } = useClipboardHistory()
  const { setOrbState } = useOrbShell()
  const [tab, setTab] = useState('notes')
  const [notes, setNotes] = useState(() => readNotes())
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [isAiWorking, setIsAiWorking] = useState(false)
  const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>('saved')
  const notesRef = useRef(notes)
  const initialSaveSkippedRef = useRef(false)

  const activeNote = notes.find((note) => note.id === activeNoteId) || null

  useEffect(() => {
    notesRef.current = notes
    if (!initialSaveSkippedRef.current) {
      initialSaveSkippedRef.current = true
      return
    }

    setSaveStatus('saving')
    const timer = window.setTimeout(() => {
      writeNotes(notesRef.current)
      setSaveStatus('saved')
    }, NOTE_SAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [notes])

  useEffect(
    () => () => {
      writeNotes(notesRef.current)
    },
    [],
  )

  const selectNote = (id: StoredNote['id']) => {
    setActiveNoteId(id)
  }

  const createNote = () => {
    const note = createNoteRecord(notes)
    setNotes((previous) => placeNoteAtGroupStart(normalizeNoteOrder(previous), note))
    setActiveNoteId(note.id)
  }

  const updateNote = (id: StoredNote['id'], updates: NoteUpdates) => {
    const updatedAt = Date.now()
    setNotes((previous) => previous.map((note) => (note.id === id ? { ...note, ...updates, updatedAt } : note)))
  }

  const deleteNote = (id: StoredNote['id']) => {
    const index = notes.findIndex((note) => note.id === id)
    const remaining = notes.filter((note) => note.id !== id)
    setNotes(reindexNoteOrder(remaining))

    if (activeNoteId === id) {
      const nextIndex = Math.min(Math.max(index, 0), remaining.length - 1)
      setActiveNoteId(remaining[nextIndex]?.id ?? null)
    }
  }

  const togglePinned = (id: StoredNote['id']) => {
    const note = notes.find((item) => item.id === id)
    if (!note) return
    const updated = {
      ...note,
      pinned: !note.pinned,
      updatedAt: Date.now(),
    }
    setNotes(placeNoteAtGroupStart(notes, updated))
  }

  const duplicateNote = (id: StoredNote['id']) => {
    const source = notes.find((note) => note.id === id)
    if (!source) return
    const createdAt = Date.now()
    const duplicate: StoredNote = {
      ...source,
      id: nextNoteId(notes),
      title: createDuplicateTitle(source.title),
      createdAt,
      updatedAt: createdAt,
    }
    setNotes(insertDuplicateAfterSource(notes, source.id, duplicate))
    setActiveNoteId(duplicate.id)
  }

  const reorderNote = (sourceId: StoredNote['id'], targetId: StoredNote['id']) => {
    setNotes((previous) => moveNoteWithinGroup(previous, sourceId, targetId))
  }

  const insertTranscript = (
    id: StoredNote['id'],
    transcript: string,
    selectionStart: number,
    selectionEnd: number,
  ): number => {
    const note = notesRef.current.find((item) => item.id === id)
    if (!note) return selectionStart
    const inserted = insertTranscriptAtSelection(note.content, transcript, selectionStart, selectionEnd)
    updateNote(id, { content: inserted.content })
    return inserted.cursor
  }

  const copyClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedIdx(index)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  const summarizeNote = async () => {
    if (!activeNote?.content) return
    setIsAiWorking(true)
    setOrbState('processing')
    const result = await runBoundedRoleTask({
      settings,
      preferredRoles: ['scout', 'orchestrator'],
      requiredTags: ['general'],
      allowCloud: false,
      maxAttempts: 3,
      maxOutputTokens: 1200,
      reasoningEffort: 'low',
      taskLabel: 'note summarization',
      messages: [
        {
          role: 'system',
          content: 'Summarize and improve the following note concisely. Preserve important facts and action items.',
        },
        { role: 'user', content: activeNote.content },
      ],
    }).catch((error: unknown) => ({
      text: `Error: ${(error as { message?: string }).message || 'No local model was available.'}`,
    }))
    updateNote(activeNote.id, { content: result.text })
    setIsAiWorking(false)
    setOrbState('idle')
  }

  return {
    tab,
    setTab,
    notes,
    activeNote,
    activeNoteId,
    selectNote,
    copiedIdx,
    isAiWorking,
    saveStatus,
    clipboardHistory,
    createNote,
    updateNote,
    deleteNote,
    togglePinned,
    duplicateNote,
    reorderNote,
    insertTranscript,
    copyClipboard,
    summarizeNote,
  }
}
