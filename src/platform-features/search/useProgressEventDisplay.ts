/**
 * Coalesces fast progress bursts for display without slowing the underlying operation. Every
 * event is retained in history, while the visible status advances to the newest pending event at
 * a readable interval. Terminal events and direct user feedback display immediately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebResearchProgressEvent } from '@/platform/agent/webResearchTask';

const DEFAULT_PROGRESS_INTERVAL_MS = 800;
const MAX_PROGRESS_HISTORY = 300;

export interface ProgressEventDisplay {
  currentEvent: WebResearchProgressEvent | null;
  eventHistory: WebResearchProgressEvent[];
  addEvent: (event: WebResearchProgressEvent, immediate?: boolean) => void;
  resetEvents: (initialEvent?: WebResearchProgressEvent) => void;
}

export function useProgressEventDisplay(
  intervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
): ProgressEventDisplay {
  const pendingEventsRef = useRef<WebResearchProgressEvent[]>([]);
  const currentEventRef = useRef<WebResearchProgressEvent | null>(null);
  const lastSequenceRef = useRef(0);
  const [currentEvent, setCurrentEvent] = useState<WebResearchProgressEvent | null>(null);
  const [eventHistory, setEventHistory] = useState<WebResearchProgressEvent[]>([]);

  const showEvent = useCallback((event: WebResearchProgressEvent) => {
    currentEventRef.current = event;
    setCurrentEvent(event);
  }, []);

  const addEvent = useCallback(
    (event: WebResearchProgressEvent, immediate = false) => {
      const sequence = Number(event.sequence || 0);
      if (sequence > 0 && sequence <= lastSequenceRef.current) return;
      if (sequence > 0) lastSequenceRef.current = sequence;

      const normalized = {
        ...event,
        timestamp: Number(event.timestamp || Date.now()),
      };
      setEventHistory((current) => [...current.slice(-(MAX_PROGRESS_HISTORY - 1)), normalized]);

      if (!currentEventRef.current || immediate || normalized.terminal) {
        pendingEventsRef.current = [];
        showEvent(normalized);
        return;
      }
      pendingEventsRef.current.push(normalized);
    },
    [showEvent],
  );

  const resetEvents = useCallback(
    (initialEvent?: WebResearchProgressEvent) => {
      pendingEventsRef.current = [];
      currentEventRef.current = null;
      lastSequenceRef.current = 0;
      setCurrentEvent(null);
      setEventHistory([]);
      if (initialEvent) addEvent(initialEvent, true);
    },
    [addEvent],
  );

  useEffect(() => {
    const intervalId = window.setInterval(
      () => {
        const pending = pendingEventsRef.current;
        if (!pending.length) return;
        const newest = pending[pending.length - 1];
        pendingEventsRef.current = [];
        showEvent(newest);
      },
      Math.max(100, intervalMs),
    );
    return () => window.clearInterval(intervalId);
  }, [intervalMs, showEvent]);

  return { currentEvent, eventHistory, addEvent, resetEvents };
}
