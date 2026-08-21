/**
 * Exercises the observable notes storage contract, with regression cases for “returns the
 * default notes when storage is empty” and “normalizes colors, categories, tags, summaries,
 * and timestamps”. The suite documents caller-visible behavior so implementation refactors
 * cannot silently weaken those guarantees.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  MAX_NOTE_SIZE_WARNING_CHARS,
  NOTE_CATEGORIES,
  addNote,
  clearSessionScopedNotes,
  deleteNote,
  isNoteOversized,
  normalizeNoteOrder,
  queryNotes,
  readNotes,
  reindexNoteOrder,
  recordUserPreferenceNote,
  updateNote,
  writeNotes,
} from '@/platform/notesStorage';

describe('notesStorage', () => {
  it('returns the default notes when storage is empty', () => {
    const notes = readNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ title: 'Quick Ideas', category: 'general' });
  });

  it('normalizes colors, categories, tags, summaries, and timestamps', () => {
    const [note] = writeNotes([
      {
        id: '4',
        title: 'Structured',
        content: 'CATEGORY: knowledge\nTAGS: react, testing\nSUMMARY: Useful fact\n\nBody',
        color: 'PURPLE',
        tags: ['testing', 'vitest'],
        createdAt: '100',
      },
    ]);

    expect(note).toMatchObject({
      id: 4,
      color: 'purple',
      category: 'knowledge',
      tags: ['testing', 'vitest', 'react'],
      summary: 'Useful fact',
      createdAt: 100,
    });
  });

  it('normalizes pinning, timestamps, and user-defined order', () => {
    const notes = writeNotes([
      { id: 1, title: 'Later', content: '', sortOrder: 1, createdAt: 10 },
      { id: 2, title: 'Pinned', content: '', pinned: true, sortOrder: 0, createdAt: 20 },
      { id: 3, title: 'Earlier', content: '', sortOrder: 0, createdAt: 30 },
    ]);

    expect(notes.map((note) => note.id)).toEqual([2, 3, 1]);
    expect(notes[0]).toMatchObject({ pinned: true, sortOrder: 0, updatedAt: 20 });
    expect(notes[1]).toMatchObject({ pinned: false, sortOrder: 0, updatedAt: 30 });
    expect(notes[2].sortOrder).toBe(1);
  });

  it('reindexes supplied order without moving notes between pin groups', () => {
    const notes = normalizeNoteOrder(
      writeNotes([
        { id: 1, title: 'Pinned one', content: '', pinned: true, sortOrder: 0 },
        { id: 2, title: 'Pinned two', content: '', pinned: true, sortOrder: 1 },
        { id: 3, title: 'Regular', content: '', sortOrder: 0 },
      ]),
    );
    const reordered = reindexNoteOrder([notes[1], notes[0], notes[2]]);

    expect(reordered.map((note) => note.id)).toEqual([2, 1, 3]);
    expect(reordered.map((note) => note.sortOrder)).toEqual([0, 1, 0]);
  });

  it('falls back to safe values for invalid note fields', () => {
    const [note] = writeNotes([{ id: 'bad', color: 'orange', category: 'unknown' }]);
    expect(note.id).toEqual(expect.any(Number));
    expect(note.title).toBe('New Note');
    expect(note.color).toBe('default');
    expect(note.category).toBe('general');
  });

  it('preserves an intentionally empty note list', () => {
    expect(writeNotes([])).toEqual([]);
    expect(readNotes()).toEqual([]);
  });

  it('adds a note with the next numeric id', () => {
    writeNotes([{ id: 7, title: 'Existing', content: '' }]);
    const added = addNote({ title: 'Added', content: 'Hello' });
    expect(added.id).toBe(8);
    expect(readNotes()[0].title).toBe('Added');
  });

  it('truncates oversized notes with a notice', () => {
    const added = addNote({
      title: 'Large',
      content: 'x'.repeat(MAX_NOTE_SIZE_WARNING_CHARS + 20),
    });
    expect(added.content).toContain('[truncated — note exceeded size limit]');
    expect(added.content.startsWith('x'.repeat(MAX_NOTE_SIZE_WARNING_CHARS))).toBe(true);
  });

  it('updates an existing note', () => {
    const [existing] = writeNotes([{ id: 10, title: 'Before', content: 'Old' }]);
    const updated = updateNote(existing.id, { title: 'After', category: 'knowledge' });
    expect(updated).toMatchObject({ id: 10, title: 'After', category: 'knowledge' });
    expect(readNotes()[0].title).toBe('After');
  });

  it('returns null for invalid or missing note updates', () => {
    expect(updateNote('bad', { title: 'Nope' })).toBeNull();
    expect(updateNote(9999, { title: 'Nope' })).toBeNull();
  });

  it('deletes an existing note', () => {
    writeNotes([
      { id: 1, title: 'Keep', content: '' },
      { id: 2, title: 'Delete', content: '' },
    ]);
    expect(deleteNote(2)).toBe(true);
    expect(readNotes().map((note) => note.id)).toEqual([1]);
  });

  it('returns false for invalid or missing note deletions', () => {
    expect(deleteNote('bad')).toBe(false);
    expect(deleteNote(9999)).toBe(false);
  });

  it('removes only session-scoped notes', () => {
    writeNotes([
      { id: 1, title: 'Permanent', content: '', sessionScoped: false },
      { id: 2, title: 'Temporary', content: '', sessionScoped: true },
    ]);
    expect(clearSessionScopedNotes()).toBe(1);
    expect(readNotes().map((note) => note.title)).toEqual(['Permanent']);
  });

  it('returns recent note excerpts for an empty query', () => {
    writeNotes([
      { id: 1, title: 'One', content: 'First' },
      { id: 2, title: 'Two', content: 'Second' },
    ]);
    expect(queryNotes('', { limit: 1 })).toEqual([
      expect.objectContaining({ id: 1, title: 'One', score: 0.5 }),
    ]);
  });

  it('ranks title and summary matches above body-only matches', () => {
    writeNotes([
      { id: 1, title: 'React testing guide', content: 'General body', summary: 'Vitest patterns' },
      { id: 2, title: 'Other', content: 'react testing appears in body' },
    ]);
    const results = queryNotes('react testing');
    expect(results.map((note) => note.id)).toEqual([1, 2]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('filters note queries by category', () => {
    writeNotes([
      { id: 1, title: 'React', content: 'testing', category: 'knowledge' },
      { id: 2, title: 'React', content: 'testing', category: 'general' },
    ]);
    expect(queryNotes('react', { category: 'knowledge' }).map((note) => note.id)).toEqual([1]);
  });

  it('records structured user preference notes', () => {
    recordUserPreferenceNote('Use concise answers');
    const note = readNotes()[0];
    expect(note).toMatchObject({
      title: 'User preference',
      category: 'user-preference',
      color: 'green',
    });
    expect(note.content).toContain('SUMMARY: Use concise answers');
  });

  it('detects oversized note content at the exact boundary', () => {
    expect(isNoteOversized('x'.repeat(MAX_NOTE_SIZE_WARNING_CHARS))).toBe(false);
    expect(isNoteOversized('x'.repeat(MAX_NOTE_SIZE_WARNING_CHARS + 1))).toBe(true);
  });

  it('exports the expected category set', () => {
    expect(NOTE_CATEGORIES.has('continuity')).toBe(true);
    expect(NOTE_CATEGORIES.has('user-preference')).toBe(true);
  });
});
