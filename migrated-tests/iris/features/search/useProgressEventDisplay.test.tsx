/** Verifies that progress events remain truthful while fast visual bursts are coalesced. */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProgressEventDisplay } from '@/platform-features/search/useProgressEventDisplay';

describe('useProgressEventDisplay', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the first event immediately and then the newest pending event on the next tick', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useProgressEventDisplay(800));

    act(() => {
      result.current.addEvent({
        type: 'one',
        message: 'Opening browser',
        sequence: 1,
      });
      result.current.addEvent({
        type: 'two',
        message: 'Loading DuckDuckGo',
        sequence: 2,
      });
      result.current.addEvent({
        type: 'three',
        message: 'Parsing results',
        sequence: 3,
      });
    });

    expect(result.current.currentEvent?.message).toBe('Opening browser');
    expect(result.current.eventHistory.map((event) => event.message)).toEqual([
      'Opening browser',
      'Loading DuckDuckGo',
      'Parsing results',
    ]);

    act(() => vi.advanceTimersByTime(800));
    expect(result.current.currentEvent?.message).toBe('Parsing results');
  });

  it('shows terminal events immediately and ignores stale sequence numbers', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useProgressEventDisplay(800));

    act(() => {
      result.current.addEvent({
        type: 'one',
        message: 'Searching',
        sequence: 4,
      });
      result.current.addEvent({
        type: 'stale',
        message: 'Old event',
        sequence: 3,
      });
      result.current.addEvent({
        type: 'done',
        message: 'Answer ready',
        sequence: 5,
        terminal: true,
      });
    });

    expect(result.current.currentEvent?.message).toBe('Answer ready');
    expect(result.current.eventHistory.map((event) => event.message)).toEqual([
      'Searching',
      'Answer ready',
    ]);
  });
});
