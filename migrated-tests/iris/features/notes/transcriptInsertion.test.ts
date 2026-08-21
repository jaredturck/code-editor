/**
 * Covers cursor-aware insertion of raw speech transcripts into editable note content.
 */

import { describe, expect, it } from 'vitest';
import { insertTranscriptAtSelection } from '@/platform-features/notes/transcriptInsertion';

describe('insertTranscriptAtSelection', () => {
  it('inserts dictated text at the cursor without merging words', () => {
    expect(insertTranscriptAtSelection('Hello world', 'new note', 5, 5)).toEqual({
      content: 'Hello new note world',
      cursor: 14,
    });
  });

  it('replaces the selected range and preserves nearby punctuation', () => {
    expect(insertTranscriptAtSelection('Today was bad.', 'productive', 10, 13)).toEqual({
      content: 'Today was productive.',
      cursor: 20,
    });
  });

  it('clamps invalid selections and ignores empty transcripts', () => {
    expect(insertTranscriptAtSelection('Note', '   ', 99, 120)).toEqual({
      content: 'Note',
      cursor: 4,
    });
  });
});
