/**
 * Owns standalone web research, live progress, streamed answer text, and encrypted saved-search
 * sessions. Quick snippet answers and optional full-page research remain separate so expensive
 * completed work can be reopened without repeating retrieval or model generation.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useOrbSettings, useOrbShell } from '@/platform-context/AgentSettingsContext';
import { copyTextToClipboard } from '@/platform-features/chat-ui/utils/chatExport';
import {
  clearWebSearchHistory,
  createWebSearchHistory,
  deleteWebSearchHistory,
  duplicateWebSearchHistory,
  getWebSearchHistory,
  listWebSearchHistory,
  saveWebSearchHistory,
  type BridgeWebSearchHistoryItem,
} from '@/platform/desktopBridge';
import {
  answerWebResearchFollowUp,
  runWebResearchTask,
  type WebResearchProgressEvent,
  type WebResearchResult,
} from '@/platform/agent/webResearchTask';
import { useProgressEventDisplay } from '@/platform-features/search/useProgressEventDisplay';

export type SearchPhaseStatus =
  | 'idle'
  | 'running'
  | 'reading'
  | 'generating'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface StoredSearchPhase {
  status: SearchPhaseStatus;
  result: WebResearchResult | null;
  partialAnswer: string;
  error: string;
}

export interface StoredSearchFollowUp {
  id: string;
  question: string;
  answer: string;
  createdAt: number;
  model?: string;
}

export interface StoredWebSearchSession {
  id: string;
  query: string;
  title: string;
  effectiveQuery: string;
  quick: StoredSearchPhase;
  detailed: StoredSearchPhase;
  followUps: StoredSearchFollowUp[];
  createdAt: number;
  updatedAt: number;
}

export interface SearchSourceProgress {
  url: string;
  title: string;
  status: string;
  linesRead: number;
  charsRead: number;
  error: string;
  current?: number;
  total?: number;
}

export interface SearchPanelState {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  historyItems: BridgeWebSearchHistoryItem[];
  isHistoryLoading: boolean;
  selectedSession: StoredWebSearchSession | null;
  selectedSessionId: string | null;
  quickResult: WebResearchResult | null;
  detailedResult: WebResearchResult | null;
  results: WebResearchResult | null;
  streamedQuickAnswer: string;
  streamedDetailedAnswer: string;
  streamedQuickThinking: string;
  streamedDetailedThinking: string;
  error: string;
  isLoading: boolean;
  isReadingFullPages: boolean;
  fullPageError: string;
  followUp: string;
  setFollowUp: Dispatch<SetStateAction<string>>;
  followUps: StoredSearchFollowUp[];
  streamedFollowUpAnswer: string;
  streamedFollowUpThinking: string;
  isFollowUpLoading: boolean;
  currentProgress: WebResearchProgressEvent | null;
  progressHistory: WebResearchProgressEvent[];
  sourceProgress: SearchSourceProgress[];
  activeOperationSessionId: string | null;
  activeOperationKind: 'quick' | 'detailed' | 'follow-up' | null;
  search: () => Promise<void>;
  readFullPages: () => Promise<void>;
  askFollowUp: () => Promise<void>;
  cancelOperation: () => void;
  startNewSearch: () => void;
  selectHistory: (id: string) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  duplicateHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  copyHistoryQuestion: (id: string) => Promise<boolean>;
  copyHistoryAnswer: (id: string) => Promise<boolean>;
}

interface ActiveOperation {
  sessionId: string;
  kind: 'quick' | 'detailed' | 'follow-up';
  controller: AbortController;
}

interface StreamedAnswers {
  quick: string;
  detailed: string;
  followUp: string;
  quickThinking: string;
  detailedThinking: string;
  followUpThinking: string;
}

const EMPTY_STREAMED_ANSWERS: StreamedAnswers = {
  quick: '',
  detailed: '',
  followUp: '',
  quickThinking: '',
  detailedThinking: '',
  followUpThinking: '',
};
const TOKEN_DISPLAY_INTERVAL_MS = 80;

function emptyPhase(): StoredSearchPhase {
  return { status: 'idle', result: null, partialAnswer: '', error: '' };
}

function createSession(query: string, id = ''): StoredWebSearchSession {
  const now = Date.now();
  return {
    id,
    query,
    title: query,
    effectiveQuery: query,
    quick: { ...emptyPhase(), status: 'running' },
    detailed: emptyPhase(),
    followUps: [],
    createdAt: now,
    updatedAt: now,
  };
}

function resultForStorage(result: WebResearchResult): WebResearchResult {
  return { ...result, raw: {} };
}

function sessionPayload(session: StoredWebSearchSession): Record<string, unknown> {
  return {
    query: session.query,
    title: session.title,
    effectiveQuery: session.effectiveQuery,
    quick: session.quick,
    detailed: session.detailed,
    followUps: session.followUps,
  };
}

function normalizePhase(value: unknown): StoredSearchPhase {
  const phase = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    status: String(phase.status || 'idle') as SearchPhaseStatus,
    result:
      phase.result && typeof phase.result === 'object' ? (phase.result as WebResearchResult) : null,
    partialAnswer: String(phase.partialAnswer || ''),
    error: String(phase.error || ''),
  };
}

function normalizeSession(value: Record<string, unknown>): StoredWebSearchSession {
  const query = String(value.query || value.title || 'Saved search');
  return {
    id: String(value.id || ''),
    query,
    title: String(value.title || query),
    effectiveQuery: String(value.effectiveQuery || query),
    quick: normalizePhase(value.quick),
    detailed: normalizePhase(value.detailed),
    followUps: Array.isArray(value.followUps)
      ? (value.followUps as StoredSearchFollowUp[]).slice(0, 100)
      : [],
    createdAt: Number(value.createdAt || Date.now()),
    updatedAt: Number(value.updatedAt || Date.now()),
  };
}

function sourceDomains(result: WebResearchResult): string[] {
  const domains = new Set<string>();
  for (const source of result.sources) {
    try {
      const hostname = new URL(source.url).hostname.toLowerCase();
      if (hostname) domains.add(hostname);
    } catch {
      // Ignore malformed source URLs; the bridge already validates usable web results.
    }
  }
  return Array.from(domains).slice(0, 5);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function historyItemFromSession(session: StoredWebSearchSession): BridgeWebSearchHistoryItem {
  return {
    id: session.id,
    query: session.query,
    title: session.title,
    quickStatus: session.quick.status,
    detailedStatus: session.detailed.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function useSearchPanel(): SearchPanelState {
  const { settings } = useOrbSettings();
  const { setOrbState } = useOrbShell();
  const { currentEvent, eventHistory, addEvent, resetEvents } = useProgressEventDisplay(800);
  const [query, setQuery] = useState('');
  const [historyItems, setHistoryItems] = useState<BridgeWebSearchHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<StoredWebSearchSession | null>(null);
  const [error, setError] = useState('');
  const [fullPageError, setFullPageError] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [streamedAnswers, setStreamedAnswers] = useState<Record<string, StreamedAnswers>>({});
  const [sourceProgressBySession, setSourceProgressBySession] = useState<
    Record<string, Record<string, SearchSourceProgress>>
  >({});

  const selectedSessionRef = useRef<StoredWebSearchSession | null>(null);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const sessionCacheRef = useRef(new Map<string, StoredWebSearchSession>());
  const deletedSessionIdsRef = useRef(new Set<string>());
  const pendingTextRef = useRef(new Map<string, string>());
  const streamedAnswersRef = useRef<Record<string, StreamedAnswers>>({});

  const setSelected = useCallback((session: StoredWebSearchSession | null) => {
    selectedSessionRef.current = session;
    setSelectedSession(session);
    if (session) {
      sessionCacheRef.current.set(session.id, session);
      setQuery(session.query);
    }
  }, []);

  const setActive = useCallback((operation: ActiveOperation | null) => {
    activeOperationRef.current = operation;
    setActiveOperation(operation);
  }, []);

  const updateStreamedAnswers = useCallback(
    (updater: (current: Record<string, StreamedAnswers>) => Record<string, StreamedAnswers>) => {
      setStreamedAnswers((current) => {
        const next = updater(current);
        streamedAnswersRef.current = next;
        return next;
      });
    },
    [],
  );

  const resetStream = useCallback(
    (sessionId: string, kind: keyof StreamedAnswers) => {
      pendingTextRef.current.set(`${sessionId}:${kind}`, '');
      updateStreamedAnswers((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] || EMPTY_STREAMED_ANSWERS),
          [kind]: '',
        },
      }));
    },
    [updateStreamedAnswers],
  );

  const queueToken = useCallback(
    (sessionId: string, kind: keyof StreamedAnswers, token: string) => {
      const key = `${sessionId}:${kind}`;
      pendingTextRef.current.set(key, `${pendingTextRef.current.get(key) || ''}${token}`);
    },
    [],
  );

  const finalizeStream = useCallback(
    (sessionId: string, kind: keyof StreamedAnswers, text: string) => {
      pendingTextRef.current.set(`${sessionId}:${kind}`, '');
      updateStreamedAnswers((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] || EMPTY_STREAMED_ANSWERS),
          [kind]: text,
        },
      }));
    },
    [updateStreamedAnswers],
  );

  const currentStreamText = useCallback(
    (sessionId: string, kind: keyof StreamedAnswers) =>
      `${streamedAnswersRef.current[sessionId]?.[kind] || ''}${
        pendingTextRef.current.get(`${sessionId}:${kind}`) || ''
      }`,
    [],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const pending = Array.from(pendingTextRef.current.entries()).filter(([, text]) => text);
      if (!pending.length) return;
      for (const [key] of pending) pendingTextRef.current.set(key, '');
      updateStreamedAnswers((current) => {
        const next = { ...current };
        for (const [key, text] of pending) {
          const separator = key.lastIndexOf(':');
          const sessionId = key.slice(0, separator);
          const kind = key.slice(separator + 1) as keyof StreamedAnswers;
          next[sessionId] = {
            ...(next[sessionId] || EMPTY_STREAMED_ANSWERS),
            [kind]: `${next[sessionId]?.[kind] || ''}${text}`,
          };
        }
        return next;
      });
    }, TOKEN_DISPLAY_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [updateStreamedAnswers]);

  const updateHistoryItem = useCallback((session: StoredWebSearchSession) => {
    const item = historyItemFromSession(session);
    setHistoryItems((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== session.id)];
      return next.sort((left, right) => right.updatedAt - left.updatedAt);
    });
  }, []);

  const persistSession = useCallback(
    async (session: StoredWebSearchSession) => {
      if (!session.id || deletedSessionIdsRef.current.has(session.id)) return;
      session.updatedAt = Date.now();
      sessionCacheRef.current.set(session.id, session);
      updateHistoryItem(session);
      if (selectedSessionRef.current?.id === session.id) setSelected({ ...session });
      await saveWebSearchHistory(session.id, sessionPayload(session));
    },
    [setSelected, updateHistoryItem],
  );

  const handleProgress = useCallback(
    (sessionId: string, event: WebResearchProgressEvent) => {
      if (activeOperationRef.current?.sessionId !== sessionId) return;
      addEvent(event);
      const source = event.source || {};
      const url = String(source.url || '');
      if (!url) return;
      setSourceProgressBySession((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] || {}),
          [url]: {
            url,
            title: String(source.title || url),
            status: String(source.status || event.type),
            linesRead: Number(source.linesRead || 0),
            charsRead: Number(source.charsRead || 0),
            error: String(source.error || ''),
            current: event.current,
            total: event.total,
          },
        },
      }));
    },
    [addEvent],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const items = await listWebSearchHistory(200);
        if (cancelled) return;
        setHistoryItems(items);
        if (items[0]) {
          const stored = normalizeSession(await getWebSearchHistory(items[0].id));
          if (!cancelled) setSelected(stored);
        }
      } catch (historyError) {
        if (!cancelled) {
          setError(
            historyError instanceof Error
              ? historyError.message
              : String(historyError || 'Search history failed to load'),
          );
        }
      } finally {
        if (!cancelled) setIsHistoryLoading(false);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [setSelected]);

  const search = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || activeOperationRef.current) return;
    setError('');
    setFullPageError('');
    setFollowUp('');
    resetEvents({
      type: 'search.preparing',
      message: 'Preparing your search…',
      timestamp: Date.now(),
    });
    setOrbState('processing');

    let session = createSession(trimmed);
    try {
      const created = await createWebSearchHistory(sessionPayload(session));
      session = {
        ...session,
        id: created.id,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
      sessionCacheRef.current.set(session.id, session);
      setSelected(session);
      updateHistoryItem(session);
      resetStream(session.id, 'quick');
      resetStream(session.id, 'quickThinking');
      setSourceProgressBySession((current) => ({
        ...current,
        [session.id]: {},
      }));

      const controller = new AbortController();
      const operation: ActiveOperation = {
        sessionId: session.id,
        kind: 'quick',
        controller,
      };
      setActive(operation);
      const next = await runWebResearchTask(trimmed, {
        settings,
        maxResults: 8,
        maxSources: 5,
        enablePlanning: true,
        includeContent: false,
        allowPaidFallback: false,
        signal: controller.signal,
        onProgress: (event) => handleProgress(session.id, event),
        onAnswerToken: (token) => queueToken(session.id, 'quick', token),
        onAnswerReset: () => resetStream(session.id, 'quick'),
        onThinkingToken: (token) => queueToken(session.id, 'quickThinking', token),
        onThinkingReset: () => resetStream(session.id, 'quickThinking'),
        onThinkingComplete: (text) => finalizeStream(session.id, 'quickThinking', text),
      });
      session = {
        ...session,
        effectiveQuery: next.effectiveQuery,
        quick: {
          status: 'complete',
          result: resultForStorage(next),
          partialAnswer: '',
          error: '',
        },
      };
      finalizeStream(session.id, 'quick', next.summary);
      await persistSession(session);
    } catch (searchError) {
      if (session.id && isAbortError(searchError)) {
        session = {
          ...session,
          quick: {
            ...session.quick,
            status: 'cancelled',
            partialAnswer: currentStreamText(session.id, 'quick'),
          },
        };
        addEvent(
          {
            type: 'search.cancelled',
            message: 'Search cancelled',
            terminal: true,
          },
          true,
        );
        await persistSession(session).catch(() => undefined);
      } else {
        const message =
          searchError instanceof Error
            ? searchError.message
            : String(searchError || 'Search failed');
        setError(message);
        if (session.id) {
          session = {
            ...session,
            quick: { ...session.quick, status: 'failed', error: message },
          };
          await persistSession(session).catch(() => undefined);
        }
      }
    } finally {
      setActive(null);
      setOrbState('idle');
    }
  }, [
    addEvent,
    currentStreamText,
    finalizeStream,
    handleProgress,
    persistSession,
    query,
    queueToken,
    resetEvents,
    resetStream,
    setActive,
    setOrbState,
    setSelected,
    settings,
    updateHistoryItem,
  ]);

  const readFullPages = useCallback(async () => {
    const baseSession = selectedSessionRef.current;
    const quickResult = baseSession?.quick.result;
    if (!baseSession || !quickResult || activeOperationRef.current) return;
    if (baseSession.detailed.status === 'complete') return;

    const approvedDomains = sourceDomains(quickResult);
    if (!approvedDomains.length) {
      setFullPageError('No valid source pages were available to read.');
      return;
    }

    let session: StoredWebSearchSession = {
      ...baseSession,
      detailed: { ...emptyPhase(), status: 'reading' },
    };
    setFullPageError('');
    resetEvents({
      type: 'pages.preparing',
      message: 'Preparing detailed research…',
      timestamp: Date.now(),
    });
    resetStream(session.id, 'detailed');
    resetStream(session.id, 'detailedThinking');
    setSourceProgressBySession((current) => ({ ...current, [session.id]: {} }));
    await persistSession(session);
    setOrbState('processing');

    const controller = new AbortController();
    setActive({ sessionId: session.id, kind: 'detailed', controller });
    try {
      const next = await runWebResearchTask(quickResult.query, {
        settings,
        maxResults: 8,
        maxSources: 5,
        enablePlanning: false,
        effectiveQueryOverride: quickResult.effectiveQuery,
        includeContent: true,
        approvedDomains,
        allowPaidFallback: false,
        signal: controller.signal,
        onProgress: (event) => {
          if (event.type.startsWith('ai.')) {
            session = {
              ...session,
              detailed: { ...session.detailed, status: 'generating' },
            };
          }
          handleProgress(session.id, event);
        },
        onAnswerToken: (token) => queueToken(session.id, 'detailed', token),
        onAnswerReset: () => resetStream(session.id, 'detailed'),
        onThinkingToken: (token) => queueToken(session.id, 'detailedThinking', token),
        onThinkingReset: () => resetStream(session.id, 'detailedThinking'),
        onThinkingComplete: (text) => finalizeStream(session.id, 'detailedThinking', text),
      });
      session = {
        ...session,
        detailed: {
          status: 'complete',
          result: resultForStorage(next),
          partialAnswer: '',
          error: '',
        },
      };
      finalizeStream(session.id, 'detailed', next.summary);
      await persistSession(session);
    } catch (readError) {
      if (isAbortError(readError)) {
        session = {
          ...session,
          detailed: {
            ...session.detailed,
            status: 'cancelled',
            partialAnswer: currentStreamText(session.id, 'detailed'),
          },
        };
        addEvent(
          {
            type: 'pages.cancelled',
            message: 'Detailed research cancelled',
            terminal: true,
          },
          true,
        );
      } else {
        const message = readError instanceof Error ? readError.message : String(readError);
        setFullPageError(`Could not read the full source pages: ${message}`);
        session = {
          ...session,
          detailed: { ...session.detailed, status: 'failed', error: message },
        };
      }
      await persistSession(session).catch(() => undefined);
    } finally {
      setActive(null);
      setOrbState('idle');
    }
  }, [
    addEvent,
    currentStreamText,
    finalizeStream,
    handleProgress,
    persistSession,
    queueToken,
    resetEvents,
    resetStream,
    setActive,
    setOrbState,
    settings,
  ]);

  const askFollowUp = useCallback(async () => {
    const trimmed = followUp.trim();
    const session = selectedSessionRef.current;
    const result = session?.detailed.result || session?.quick.result;
    if (!trimmed || !session || !result || activeOperationRef.current) return;

    setFollowUp('');
    resetStream(session.id, 'followUp');
    resetStream(session.id, 'followUpThinking');
    resetEvents({
      type: 'followup.preparing',
      message: 'Preparing the follow-up…',
      timestamp: Date.now(),
    });
    const controller = new AbortController();
    setActive({ sessionId: session.id, kind: 'follow-up', controller });
    setOrbState('processing');
    try {
      const answer = await answerWebResearchFollowUp(trimmed, result, settings, {
        signal: controller.signal,
        onProgress: (event) => handleProgress(session.id, event),
        onAnswerToken: (token) => queueToken(session.id, 'followUp', token),
        onAnswerReset: () => resetStream(session.id, 'followUp'),
        onThinkingToken: (token) => queueToken(session.id, 'followUpThinking', token),
        onThinkingReset: () => resetStream(session.id, 'followUpThinking'),
        onThinkingComplete: (text) => finalizeStream(session.id, 'followUpThinking', text),
      });
      finalizeStream(session.id, 'followUp', answer);
      const nextSession = {
        ...session,
        followUps: [
          ...session.followUps,
          {
            id: `f${Date.now().toString(36)}`,
            question: trimmed,
            answer,
            createdAt: Date.now(),
          },
        ],
      };
      await persistSession(nextSession);
      resetStream(session.id, 'followUp');
    } catch (followUpError) {
      if (!isAbortError(followUpError)) {
        addEvent(
          {
            type: 'followup.failed',
            message: `Could not answer locally: ${
              followUpError instanceof Error ? followUpError.message : String(followUpError)
            }`,
            terminal: true,
          },
          true,
        );
      }
    } finally {
      setActive(null);
      setOrbState('idle');
    }
  }, [
    addEvent,
    finalizeStream,
    followUp,
    handleProgress,
    persistSession,
    queueToken,
    resetEvents,
    resetStream,
    setActive,
    setOrbState,
    settings,
  ]);

  const cancelOperation = useCallback(() => {
    const operation = activeOperationRef.current;
    if (!operation) return;
    addEvent(
      {
        type: 'operation.cancelling',
        message:
          operation.kind === 'detailed'
            ? 'Cancelling detailed research…'
            : operation.kind === 'follow-up'
              ? 'Cancelling follow-up…'
              : 'Cancelling search…',
      },
      true,
    );
    operation.controller.abort();
  }, [addEvent]);

  const startNewSearch = useCallback(() => {
    setSelected(null);
    setQuery('');
    setError('');
    setFullPageError('');
    setFollowUp('');
    resetEvents();
  }, [resetEvents, setSelected]);

  const selectHistory = useCallback(
    async (id: string) => {
      const cached = sessionCacheRef.current.get(id);
      if (cached) {
        setSelected({ ...cached });
        resetEvents();
        return;
      }
      const session = normalizeSession(await getWebSearchHistory(id));
      sessionCacheRef.current.set(id, session);
      setSelected(session);
      resetEvents();
    },
    [resetEvents, setSelected],
  );

  const deleteHistory = useCallback(
    async (id: string) => {
      deletedSessionIdsRef.current.add(id);
      if (activeOperationRef.current?.sessionId === id)
        activeOperationRef.current.controller.abort();
      await deleteWebSearchHistory(id);
      sessionCacheRef.current.delete(id);
      setHistoryItems((current) => current.filter((item) => item.id !== id));
      setStreamedAnswers((current) => {
        const next = { ...current };
        delete next[id];
        streamedAnswersRef.current = next;
        return next;
      });
      if (selectedSessionRef.current?.id === id) {
        const remaining = historyItems.filter((item) => item.id !== id);
        if (remaining[0]) await selectHistory(remaining[0].id);
        else startNewSearch();
      }
    },
    [historyItems, selectHistory, startNewSearch],
  );

  const duplicateHistory = useCallback(
    async (id: string) => {
      const item = await duplicateWebSearchHistory(id);
      setHistoryItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      const session = normalizeSession(await getWebSearchHistory(item.id));
      sessionCacheRef.current.set(item.id, session);
      setSelected(session);
    },
    [setSelected],
  );

  const clearHistory = useCallback(async () => {
    activeOperationRef.current?.controller.abort();
    for (const item of historyItems) deletedSessionIdsRef.current.add(item.id);
    await clearWebSearchHistory();
    sessionCacheRef.current.clear();
    setHistoryItems([]);
    setStreamedAnswers({});
    streamedAnswersRef.current = {};
    setSourceProgressBySession({});
    startNewSearch();
  }, [historyItems, startNewSearch]);

  const getSessionForAction = useCallback(async (id: string) => {
    const cached = sessionCacheRef.current.get(id);
    if (cached) return cached;
    const session = normalizeSession(await getWebSearchHistory(id));
    sessionCacheRef.current.set(id, session);
    return session;
  }, []);

  const copyHistoryQuestion = useCallback(
    async (id: string) => copyTextToClipboard((await getSessionForAction(id)).query),
    [getSessionForAction],
  );

  const copyHistoryAnswer = useCallback(
    async (id: string) => {
      const session = await getSessionForAction(id);
      const answer = session.detailed.result?.summary || session.quick.result?.summary || '';
      return copyTextToClipboard(answer);
    },
    [getSessionForAction],
  );

  const selectedSessionId = selectedSession?.id || null;
  const selectedStreams = selectedSessionId
    ? streamedAnswers[selectedSessionId] || EMPTY_STREAMED_ANSWERS
    : EMPTY_STREAMED_ANSWERS;
  const quickResult = selectedSession?.quick.result || null;
  const detailedResult = selectedSession?.detailed.result || null;
  const results = detailedResult || quickResult;
  const sourceProgress = useMemo(
    () =>
      selectedSessionId
        ? Object.values(sourceProgressBySession[selectedSessionId] || {}).sort(
            (left, right) => Number(left.current || 0) - Number(right.current || 0),
          )
        : [],
    [selectedSessionId, sourceProgressBySession],
  );
  const selectedIsActive = Boolean(
    activeOperation && selectedSessionId && activeOperation.sessionId === selectedSessionId,
  );

  return {
    query,
    setQuery,
    historyItems,
    isHistoryLoading,
    selectedSession,
    selectedSessionId,
    quickResult,
    detailedResult,
    results,
    streamedQuickAnswer: selectedStreams.quick,
    streamedDetailedAnswer: selectedStreams.detailed,
    streamedQuickThinking: selectedStreams.quickThinking,
    streamedDetailedThinking: selectedStreams.detailedThinking,
    error,
    isLoading: Boolean(selectedIsActive && activeOperation?.kind === 'quick'),
    isReadingFullPages: Boolean(selectedIsActive && activeOperation?.kind === 'detailed'),
    fullPageError,
    followUp,
    setFollowUp,
    followUps: selectedSession?.followUps || [],
    streamedFollowUpAnswer: selectedStreams.followUp,
    streamedFollowUpThinking: selectedStreams.followUpThinking,
    isFollowUpLoading: Boolean(selectedIsActive && activeOperation?.kind === 'follow-up'),
    currentProgress: selectedIsActive ? currentEvent : null,
    progressHistory: selectedIsActive ? eventHistory : [],
    sourceProgress,
    activeOperationSessionId: activeOperation?.sessionId || null,
    activeOperationKind: activeOperation?.kind || null,
    search,
    readFullPages,
    askFollowUp,
    cancelOperation,
    startNewSearch,
    selectHistory,
    deleteHistory,
    duplicateHistory,
    clearHistory,
    copyHistoryQuestion,
    copyHistoryAnswer,
  };
}
