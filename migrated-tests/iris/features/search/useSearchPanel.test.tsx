/** Verifies the standalone Search panel answers from snippets first and deepens on demand. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWebResearchTask: vi.fn(),
  answerWebResearchFollowUp: vi.fn(),
  setOrbState: vi.fn(),
  listWebSearchHistory: vi.fn(),
  createWebSearchHistory: vi.fn(),
  getWebSearchHistory: vi.fn(),
  saveWebSearchHistory: vi.fn(),
  duplicateWebSearchHistory: vi.fn(),
  deleteWebSearchHistory: vi.fn(),
  clearWebSearchHistory: vi.fn(),
}))

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: {
      agent_web_site_guard: true,
      agent_models: [
        {
          role: 'scout',
          provider: 'local',
          model: 'qwen3:4b',
          keyId: '1',
          primary: true,
        },
      ],
    },
  }),
  useOrbShell: () => ({ setOrbState: mocks.setOrbState }),
}))

vi.mock('@/platform/desktopBridge', () => ({
  listWebSearchHistory: mocks.listWebSearchHistory,
  createWebSearchHistory: mocks.createWebSearchHistory,
  getWebSearchHistory: mocks.getWebSearchHistory,
  saveWebSearchHistory: mocks.saveWebSearchHistory,
  duplicateWebSearchHistory: mocks.duplicateWebSearchHistory,
  deleteWebSearchHistory: mocks.deleteWebSearchHistory,
  clearWebSearchHistory: mocks.clearWebSearchHistory,
}))

vi.mock('@/platform/agent/webResearchTask', () => ({
  runWebResearchTask: mocks.runWebResearchTask,
  answerWebResearchFollowUp: mocks.answerWebResearchFollowUp,
}))

import { useSearchPanel } from '@/platform-features/search/useSearchPanel'

const snippetResult = {
  query: 'what is an AI model',
  effectiveQuery: 'what is an AI model',
  provider: 'duckduckgo-browser',
  totalResults: 2,
  scannedSources: 0,
  linesReadTotal: 0,
  charsReadTotal: 0,
  relatedQueries: [],
  summary: 'An AI model is a system trained to recognise patterns and produce predictions.',
  sources: [
    {
      title: 'IBM AI models',
      url: 'https://www.ibm.com/topics/ai-model',
      snippet: 'An AI model is trained on data to identify patterns.',
      excerpt: 'An AI model is trained on data to identify patterns.',
      status: 'ok',
      linesRead: 0,
      charsRead: 0,
      relevanceScore: 0.9,
      fetchMs: 0,
      error: '',
    },
    {
      title: 'Google Cloud AI models',
      url: 'https://cloud.google.com/ai/models',
      snippet: 'Models perform tasks such as classification and generation.',
      excerpt: 'Models perform tasks such as classification and generation.',
      status: 'ok',
      linesRead: 0,
      charsRead: 0,
      relevanceScore: 0.8,
      fetchMs: 0,
      error: '',
    },
  ],
  steps: [],
  evidenceMode: 'snippets' as const,
  synthesis: {
    mode: 'local-model' as const,
    role: 'scout',
    provider: 'local',
    model: 'qwen3:4b',
  },
  raw: {},
}

const fullPageResult = {
  ...snippetResult,
  scannedSources: 2,
  linesReadTotal: 120,
  charsReadTotal: 15000,
  summary: 'A detailed answer rebuilt from the full source pages.',
  evidenceMode: 'full-pages' as const,
  sources: snippetResult.sources.map((source) => ({
    ...source,
    linesRead: 60,
    charsRead: 7500,
  })),
}

describe('useSearchPanel', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.listWebSearchHistory.mockResolvedValue([])
    mocks.createWebSearchHistory.mockImplementation(async (session) => ({
      id: 'search-1',
      query: session.query,
      title: session.title,
      quickStatus: session.quick.status,
      detailedStatus: session.detailed.status,
      createdAt: 100,
      updatedAt: 100,
    }))
    mocks.saveWebSearchHistory.mockImplementation(async (id, session) => ({
      id,
      query: session.query,
      title: session.title,
      quickStatus: session.quick.status,
      detailedStatus: session.detailed.status,
      createdAt: 100,
      updatedAt: 101,
    }))
    mocks.deleteWebSearchHistory.mockResolvedValue(1)
    mocks.clearWebSearchHistory.mockResolvedValue(1)
  })

  it('returns an immediate local answer from DuckDuckGo snippets', async () => {
    mocks.runWebResearchTask.mockResolvedValue(snippetResult)
    const { result } = renderHook(() => useSearchPanel())
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false))

    act(() => result.current.setQuery('what is an AI model'))
    await act(async () => {
      await result.current.search()
    })

    expect(mocks.runWebResearchTask).toHaveBeenCalledWith(
      'what is an AI model',
      expect.objectContaining({
        includeContent: false,
        enablePlanning: true,
        allowPaidFallback: false,
      }),
    )
    expect(result.current.results).toEqual(snippetResult)
    expect(result.current.error).toBe('')
    expect(result.current.isLoading).toBe(false)
  })

  it('keeps model-emitted thinking separate from the streamed answer', async () => {
    mocks.runWebResearchTask.mockImplementation(async (_query, options) => {
      options.onThinkingToken?.('Reviewing the snippets.')
      options.onThinkingComplete?.('Reviewing the snippets.')
      options.onAnswerToken?.('An AI model')
      return {
        ...snippetResult,
        synthesis: {
          ...snippetResult.synthesis,
          thinkingEmitted: true,
          timings: {
            promptEvalMs: 1200,
            thinkingStreamMs: 800,
            firstAnswerMs: 2200,
          },
        },
      }
    })
    const { result } = renderHook(() => useSearchPanel())
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false))

    act(() => result.current.setQuery('what is an AI model'))
    await act(async () => {
      await result.current.search()
    })

    expect(result.current.streamedQuickThinking).toBe('Reviewing the snippets.')
    expect(result.current.streamedQuickAnswer).toBe(snippetResult.summary)
    expect(result.current.quickResult?.synthesis.timings?.promptEvalMs).toBe(1200)
  })

  it('reads the displayed source domains only after the user asks for a deeper answer', async () => {
    mocks.runWebResearchTask.mockResolvedValueOnce(snippetResult).mockResolvedValueOnce(fullPageResult)
    const { result } = renderHook(() => useSearchPanel())
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false))

    act(() => result.current.setQuery('what is an AI model'))
    await act(async () => {
      await result.current.search()
    })
    await act(async () => {
      await result.current.readFullPages()
    })

    expect(mocks.runWebResearchTask).toHaveBeenNthCalledWith(
      2,
      'what is an AI model',
      expect.objectContaining({
        includeContent: true,
        enablePlanning: false,
        effectiveQueryOverride: 'what is an AI model',
        approvedDomains: ['www.ibm.com', 'cloud.google.com'],
        allowPaidFallback: false,
      }),
    )
    expect(result.current.results).toEqual(fullPageResult)
    expect(result.current.fullPageError).toBe('')
  })

  it('keeps the snippet answer visible when full-page reading fails', async () => {
    mocks.runWebResearchTask
      .mockResolvedValueOnce(snippetResult)
      .mockRejectedValueOnce(new Error('source fetch failed'))
    const { result } = renderHook(() => useSearchPanel())
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false))

    act(() => result.current.setQuery('what is an AI model'))
    await act(async () => {
      await result.current.search()
    })
    await act(async () => {
      await result.current.readFullPages()
    })

    await waitFor(() => expect(result.current.isReadingFullPages).toBe(false))
    expect(result.current.results).toEqual(snippetResult)
    expect(result.current.fullPageError).toContain('source fetch failed')
  })
})
