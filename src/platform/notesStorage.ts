/**
 * Manages notes and clipboard history for the Notes panel and agent note tools. Durable values
 * pass through the encrypted renderer-state facade and are decrypted only while in use.
 */

import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore'

const NOTES_STORAGE_KEY = 'iris_notes'
export const MAX_NOTE_SIZE_WARNING_CHARS = 600 // Notes over this get flagged as too large

export const NOTE_COLORS = ['default', 'blue', 'purple', 'green', 'yellow', 'red'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const NOTE_CATEGORY_VALUES = [
  'continuity',
  'knowledge',
  'error-log',
  'user-preference',
  'project-context',
  'delegation-log',
  'general',
] as const
export type NoteCategory = (typeof NOTE_CATEGORY_VALUES)[number]

export interface StoredNote {
  id: number
  title: string
  content: string
  color: NoteColor
  category: NoteCategory
  tags: string[]
  summary: string
  sessionScoped: boolean
  pinned: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface NoteInput extends Record<string, unknown> {
  id?: unknown
  title?: unknown
  content?: unknown
  color?: unknown
  category?: unknown
  tags?: unknown
  summary?: unknown
  sessionScoped?: unknown
  pinned?: unknown
  sortOrder?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export interface NoteQueryOptions {
  category?: string
  limit?: number
  minScore?: number
  excludeSessionScoped?: boolean
}

export interface NoteQueryResult {
  id: number
  title: string
  excerpt: string
  score: number
  category: NoteCategory
  tags: string[]
  sessionScoped: boolean
}

export interface RelevantNoteResult {
  id: number
  title: string
  excerpt: string
  category: NoteCategory
  score: number
}

interface ParsedNoteHeader {
  category: string
  tags: string[]
  summary: string
}

const DEFAULT_NOTES: NoteInput[] = [
  {
    id: 1,
    title: 'Quick Ideas',
    content: 'Build an AI-powered terminal...\nAutomate daily backups\nLearn Rust this year',
    color: 'blue',
  },
  {
    id: 2,
    title: 'Shopping',
    content: '- Coffee beans\n- Mechanical keyboard\n- USB hub',
    color: 'yellow',
  },
]

const NOTE_COLOR_SET = new Set<string>(NOTE_COLORS)
export const NOTE_CATEGORIES: ReadonlySet<string> = new Set(NOTE_CATEGORY_VALUES)

// ── Structured header parser ───────────────────────────────────────────────────
// Notes may carry a semi-structured header block for better queryNotes() performance.
// Header format (first N lines):
//   CATEGORY: knowledge
//   TAGS: react, auth, jwt
//   SUMMARY: JWT auth pattern used in this project
//   [rest of content]

const HEADER_LINE_REGEX = /^([A-Z_]+):\s*(.*)$/
const MAX_HEADER_LINES = 8 // Stop looking for headers after this many lines

/**
 * Interprets note header and turns the source representation into structured application
 * data.
 */
function parseNoteHeader(content: unknown): {
  header: ParsedNoteHeader
  body: string
} {
  const lines = String(content || '').split('\n')
  const header: ParsedNoteHeader = { category: '', tags: [], summary: '' }
  let bodyStart = 0

  for (let i = 0; i < Math.min(lines.length, MAX_HEADER_LINES); i += 1) {
    const match = lines[i].match(HEADER_LINE_REGEX)
    if (!match) {
      // Allow blank lines between header and body
      if (lines[i].trim() === '') {
        bodyStart = i + 1
        continue
      }
      bodyStart = i
      break
    }

    const [, field, value] = match
    bodyStart = i + 1

    if (field === 'CATEGORY') header.category = value.trim().toLowerCase()
    else if (field === 'TAGS')
      header.tags = value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    else if (field === 'SUMMARY' || field === 'FACT') header.summary = value.trim()
  }

  return { header, body: lines.slice(bodyStart).join('\n') }
}

// ── Normalization ─────────────────────────────────────────────────────────────

function asNoteInput(value: unknown): NoteInput {
  return value && typeof value === 'object' ? (value as NoteInput) : {}
}

function normalizeNote(value: unknown, fallbackId: number, fallbackSortOrder = 0): StoredNote {
  const note = asNoteInput(value)
  const normalizedId = Number.isFinite(Number(note.id)) ? Number(note.id) : fallbackId
  const rawColor = String(note.color || '').toLowerCase()
  const normalizedColor: NoteColor = NOTE_COLOR_SET.has(rawColor) ? (rawColor as NoteColor) : 'default'

  const rawContent = String(note.content || '')
  const { header } = parseNoteHeader(rawContent)

  // Category: prefer explicit field on the note object, then parsed header, then 'general'
  const rawCategory = String(note.category || header.category || 'general')
    .toLowerCase()
    .trim()
  const category: NoteCategory = NOTE_CATEGORIES.has(rawCategory) ? (rawCategory as NoteCategory) : 'general'

  // Tags: merge explicit field and parsed header tags
  const explicitTags = Array.isArray(note.tags) ? note.tags.map(String) : []
  const allTags = Array.from(new Set([...explicitTags, ...header.tags])).slice(0, 24)

  // Summary: prefer explicit field, then parsed header, then nothing
  const summary = String(note.summary || header.summary || '').slice(0, 500)

  const createdAt = Number.isFinite(Number(note.createdAt)) ? Number(note.createdAt) : Date.now()

  return {
    id: normalizedId,
    title: String(note.title || 'New Note'),
    content: rawContent,
    color: normalizedColor,
    category,
    tags: allTags,
    summary,
    sessionScoped: Boolean(note.sessionScoped),
    pinned: Boolean(note.pinned),
    sortOrder: Number.isFinite(Number(note.sortOrder)) ? Number(note.sortOrder) : fallbackSortOrder,
    createdAt,
    updatedAt: Number.isFinite(Number(note.updatedAt)) ? Number(note.updatedAt) : createdAt,
  }
}

function compareNoteOrder(a: StoredNote, b: StoredNote): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return b.createdAt - a.createdAt
}

/** Reassigns stable order values while preserving the supplied display order. */
export function reindexNoteOrder(notes: StoredNote[]): StoredNote[] {
  let pinnedOrder = 0
  let regularOrder = 0

  return notes.map((note) => ({
    ...note,
    sortOrder: note.pinned ? pinnedOrder++ : regularOrder++,
  }))
}

/** Sorts pinned notes first and preserves user-defined order within each group. */
export function normalizeNoteOrder(notes: StoredNote[]): StoredNote[] {
  return reindexNoteOrder([...notes].sort(compareNoteOrder))
}

// Converts notes into the canonical representation expected by later code.
function normalizeNotes(notes: unknown): StoredNote[] {
  if (!Array.isArray(notes)) {
    return normalizeNoteOrder(DEFAULT_NOTES.map((note, index) => normalizeNote(note, Number(note.id), index)))
  }
  if (!notes.length) return []

  return normalizeNoteOrder(notes.slice(0, 200).map((note, index) => normalizeNote(note, Date.now() + index, index)))
}

// Returns the next stable note ID for notes storage.
function nextNoteId(notes: StoredNote[]): number {
  const maxId = notes.reduce((max, note) => {
    const id = Number(note.id)
    return Number.isFinite(id) ? Math.max(max, id) : max
  }, 0)

  return maxId + 1
}

// ── Storage API ───────────────────────────────────────────────────────────────

export function readNotes(): StoredNote[] {
  const parsed = readStorageJson<unknown>(NOTES_STORAGE_KEY, null)
  return normalizeNotes(parsed)
}

// Persists notes while preserving the storage and compatibility rules of this module.
export function writeNotes(notes: unknown): StoredNote[] {
  const normalized = normalizeNotes(notes)
  writeStorageJson(NOTES_STORAGE_KEY, normalized)
  return normalized
}

// Creates and persists one note after applying the configured size limit.
export function addNote(input: NoteInput): StoredNote {
  const notes = readNotes()
  // Enforce note size limit — truncate oversized content with a notice
  const rawContent = String(input.content || '')
  const content = isNoteOversized(rawContent)
    ? rawContent.slice(0, MAX_NOTE_SIZE_WARNING_CHARS) + '\n[truncated — note exceeded size limit]'
    : rawContent
  const createdAt = Date.now()
  const note = normalizeNote(
    {
      ...input,
      content,
      sortOrder: -1,
      createdAt,
      updatedAt: createdAt,
    },
    nextNoteId(notes),
    -1,
  )
  const next = [note, ...notes].slice(0, 200)
  writeNotes(next)
  return note
}

// Applies a controlled change to note and keeps dependent state consistent.
export function updateNote(noteId: string | number, updates: NoteInput = {}): StoredNote | null {
  const id = Number(noteId)
  if (!Number.isFinite(id)) return null

  const notes = readNotes()
  let updated: StoredNote | null = null

  const next = notes.map((note) => {
    if (note.id !== id) return note
    updated = normalizeNote({ ...note, ...updates, id, updatedAt: Date.now() }, id, note.sortOrder)
    return updated
  })

  if (!updated) return null
  writeNotes(next)
  return updated
}

// Removes note from the module’s owned state or persistence layer.
export function deleteNote(noteId: string | number): boolean {
  const id = Number(noteId)
  if (!Number.isFinite(id)) return false

  const notes = readNotes()
  const next = notes.filter((note) => note.id !== id)
  if (next.length === notes.length) return false

  writeNotes(next)
  return true
}

/**
 * Remove all session-scoped notes (called at session end).
 * Session-scoped notes are source caches and other ephemeral data.
 */
export function clearSessionScopedNotes(): number {
  const notes = readNotes()
  const next = notes.filter((note) => !note.sessionScoped)
  writeNotes(next)
  return notes.length - next.length // Count of removed notes
}

// ── memory.query ──────────────────────────────────────────────────────────────

/**
 * Semantic + keyword search over the notes system.
 * Returns ranked matches instead of a flat dump — far cheaper to inject than
 * the entire notes list, and more relevant to the current query.
 *
 * Used by the agent's memory.query tool.
 */
export function queryNotes(
  query: string,
  { category, limit = 5, minScore = 0, excludeSessionScoped = false }: NoteQueryOptions = {},
): NoteQueryResult[] {
  const notes = readNotes()
  let filtered = category ? notes.filter((note) => note.category === category) : notes
  if (excludeSessionScoped) filtered = filtered.filter((note) => !note.sessionScoped)

  if (!filtered.length) return []

  const queryLower = String(query || '')
    .toLowerCase()
    .trim()
  if (!queryLower) {
    return filtered.slice(0, limit).map((note) => ({
      id: note.id,
      title: note.title,
      excerpt: note.content.slice(0, 400),
      score: 0.5,
      category: note.category,
      tags: note.tags,
      sessionScoped: Boolean(note.sessionScoped),
    }))
  }

  // Simple keyword scoring — Fuse.js is server-side only, so we use lightweight
  // matching that's appropriate for the in-memory renderer state here.
  const queryTokens = queryLower.split(/\s+/).filter((token) => token.length >= 2)

  const scored = filtered.map((note) => {
    const searchText = [note.title, note.summary, note.tags.join(' '), note.content.slice(0, 800)]
      .join(' ')
      .toLowerCase()

    let score = 0
    for (const token of queryTokens) {
      if (searchText.includes(token)) {
        score += 1
        // Title/summary match is a stronger signal
        if ((note.title + ' ' + note.summary).toLowerCase().includes(token)) {
          score += 0.5
        }
      }
    }

    return { note, score: score / Math.max(1, queryTokens.length) }
  })

  return scored
    .filter((entry) => entry.score > 0 && entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map((entry) => ({
      id: entry.note.id,
      title: entry.note.title,
      excerpt: entry.note.content.slice(0, 400),
      score: Math.round(entry.score * 100) / 100,
      category: entry.note.category,
      tags: entry.note.tags,
      sessionScoped: Boolean(entry.note.sessionScoped),
    }))
}

/**
 * Relevance-gated recall for the agent. Returns only the durable notes that
 * actually relate to the current request (ranked, score-gated), excluding
 * ephemeral session-scoped caches and any legacy error-logs. Returns [] when
 * nothing clears minScore — so the agent receives memory ONLY when it's relevant,
 * never a blind dump of the whole notes list.
 */
export function recallRelevantNotes(
  query: string,
  { limit = 3, minScore = 0.5 }: Pick<NoteQueryOptions, 'limit' | 'minScore'> = {},
): RelevantNoteResult[] {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return []
  return queryNotes(normalizedQuery, {
    limit,
    minScore,
    excludeSessionScoped: true,
  })
    .filter((match) => match.category !== 'error-log')
    .map((match) => ({
      id: match.id,
      title: match.title,
      excerpt: match.excerpt,
      category: match.category,
      score: match.score,
    }))
}

/**
 * Keep at most `max` notes of a category (newest by createdAt); delete the oldest
 * beyond that. Bounds auto-written continuity notes so they never crowd out
 * durable user notes. Returns the number removed.
 */
export function pruneNotesByCategory(category: string, max: number): number {
  const cap = Math.max(0, Number(max) || 0)
  const notes = readNotes()
  const inCategory = notes
    .filter((note) => note.category === category)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
  if (inCategory.length <= cap) return 0
  const keepIds = new Set(inCategory.slice(0, cap).map((note) => note.id))
  const next = notes.filter((note) => note.category !== category || keepIds.has(note.id))
  const removed = notes.length - next.length
  if (removed > 0) writeNotes(next)
  return removed
}

// ── Auto-write helpers ─────────────────────────────────────────────────────────

/** Write a structured user-preference note from a detected correction. */
export function recordUserPreferenceNote(correction: string): void {
  addNote({
    title: 'User preference',
    category: 'user-preference',
    content: ['CATEGORY: user-preference', `SUMMARY: ${correction.slice(0, 200)}`, '', correction].join('\n'),
    color: 'green',
    tags: ['preference'],
  })
}

/** Returns true if a note is over the recommended size limit. */
export function isNoteOversized(content: unknown): boolean {
  return String(content || '').length > MAX_NOTE_SIZE_WARNING_CHARS
}
