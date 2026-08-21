/** Protects the shared bounded web workflow used by Chat, Search, and delegated agents. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchWebResearch: vi.fn(),
  runBoundedRoleTask: vi.fn(),
  buildWebSearchProviderPolicy: vi.fn(() => ({
    providerPolicy: {
      primaryProvider: 'duckduckgo',
      fallbackProviders: ['google_cse'],
      allowPaidFallback: false,
    },
    providerSettings: {},
  })),
}));

vi.mock('@/platform/desktopBridge', () => ({
  searchWebResearch: mocks.searchWebResearch,
}));
vi.mock('@/platform/agent/boundedRoleTask', () => ({
  runBoundedRoleTask: mocks.runBoundedRoleTask,
}));
vi.mock('@/platform/agent/runtime/webSearchPolicy', () => ({
  buildWebSearchProviderPolicy: mocks.buildWebSearchProviderPolicy,
}));

import {
  answerWebResearchFollowUp,
  runWebResearchTask,
  synthesizeWebResearch,
} from '@/platform/agent/webResearchTask';

const SETTINGS = {
  agent_web_site_guard: false,
  agent_models: [
    {
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
      keyId: '1',
      primary: true,
    },
  ],
};

const WEB_DATA = {
  provider: 'duckduckgo',
  totalResults: 2,
  linesReadTotal: 18,
  charsReadTotal: 2400,
  sources: [
    {
      title: 'First result',
      url: 'https://example.test/first',
      snippet: 'First snippet',
      excerpt: 'First extracted evidence',
      status: 'ok',
      linesRead: 10,
      charsRead: 1300,
      relevanceScore: 0.9,
      fetchMs: 120,
    },
    {
      title: 'Second result',
      url: 'https://example.test/second',
      snippet: 'Second snippet',
      excerpt: 'Second extracted evidence',
      status: 'ok',
      linesRead: 8,
      charsRead: 1100,
      relevanceScore: 0.8,
      fetchMs: 90,
    },
  ],
};

describe('webResearchTask', () => {
  beforeEach(() => {
    mocks.searchWebResearch.mockReset();
    mocks.runBoundedRoleTask.mockReset();
    mocks.buildWebSearchProviderPolicy.mockClear();
  });

  it('uses the existing provider policy and a local role model for synthesis', async () => {
    mocks.searchWebResearch.mockResolvedValue(WEB_DATA);
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: 'Grounded local summary https://example.test/first',
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
    });

    const result = await runWebResearchTask('iris search architecture', {
      settings: SETTINGS,
      enablePlanning: false,
    });

    expect(mocks.searchWebResearch).toHaveBeenCalledWith(
      'iris search architecture',
      expect.objectContaining({
        includeContent: true,
        providerPolicy: expect.objectContaining({
          primaryProvider: 'duckduckgo',
          allowPaidFallback: false,
        }),
      }),
    );
    expect(mocks.runBoundedRoleTask).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredRoles: ['scout', 'orchestrator'],
        allowCloud: false,
        taskLabel: 'web-research synthesis',
      }),
    );
    expect(result).toMatchObject({
      provider: 'duckduckgo',
      summary: 'Grounded local summary https://example.test/first',
      evidenceMode: 'full-pages',
      synthesis: {
        mode: 'local-model',
        role: 'scout',
        provider: 'local',
        model: 'qwen3:4b',
      },
    });
    expect(result.sources).toHaveLength(2);
  });

  it('returns a deterministic real-source digest when local synthesis is unavailable', async () => {
    mocks.runBoundedRoleTask.mockRejectedValue(new Error('local model unavailable'));

    const result = await synthesizeWebResearch('test query', WEB_DATA, SETTINGS);

    expect(result.synthesis).toMatchObject({
      mode: 'source-digest',
      error: 'local model unavailable',
    });
    expect(result.summary).toContain('First result');
    expect(result.summary).toContain('https://example.test/first');
    expect(result.summary).not.toContain('Search error:');
  });

  it('streams model thinking separately and records generation timings', async () => {
    const onThinkingToken = vi.fn();
    const onThinkingComplete = vi.fn();
    const onAnswerToken = vi.fn();
    const progress: string[] = [];
    mocks.runBoundedRoleTask.mockImplementation(async (options) => {
      options.onModelSelected?.({
        role: 'scout',
        provider: 'local',
        model: 'qwen3:4b',
        attempt: 1,
        maxAttempts: 1,
      });
      options.onThinkingToken?.('Considering the evidence.');
      options.onToken?.('Grounded answer');
      return {
        text: 'Grounded answer',
        role: 'scout',
        provider: 'local',
        model: 'qwen3:4b',
        meta: {
          thinkingText: 'Considering the evidence.',
          timings: {
            promptEvalMs: 4200,
            thinkingStreamMs: 3100,
            firstAnswerMs: 7500,
          },
        },
      };
    });

    const result = await synthesizeWebResearch('test query', WEB_DATA, SETTINGS, 6, {
      onThinkingToken,
      onThinkingComplete,
      onAnswerToken,
      onProgress: (event) => progress.push(event.type),
    });

    expect(onThinkingToken).toHaveBeenCalledWith('Considering the evidence.');
    expect(onThinkingComplete).toHaveBeenCalledWith('Considering the evidence.');
    expect(onAnswerToken).toHaveBeenCalledWith('Grounded answer');
    expect(progress).toContain('ai.evaluating');
    expect(progress).toContain('ai.thinking');
    expect(progress).toContain('ai.generating');
    expect(result.synthesis).toMatchObject({
      thinkingEmitted: true,
      timings: {
        promptEvalMs: 4200,
        thinkingStreamMs: 3100,
        firstAnswerMs: 7500,
      },
    });
  });

  it('discovers domains first and only reads domains approved for this search', async () => {
    const discovered = {
      provider: 'duckduckgo',
      totalResults: 2,
      results: WEB_DATA.sources,
    };
    mocks.searchWebResearch.mockResolvedValueOnce(discovered).mockResolvedValueOnce(WEB_DATA);
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: 'summary',
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
    });
    const requestDomainApproval = vi.fn().mockResolvedValue(['example.test']);

    await runWebResearchTask('approved source test', {
      settings: { ...SETTINGS, agent_web_site_guard: true },
      enablePlanning: false,
      requestDomainApproval,
    });

    expect(requestDomainApproval).toHaveBeenCalledWith(['example.test']);
    expect(mocks.searchWebResearch).toHaveBeenNthCalledWith(
      1,
      'approved source test',
      expect.objectContaining({ includeContent: false, discoverOnly: true }),
    );
    expect(mocks.searchWebResearch).toHaveBeenNthCalledWith(
      2,
      'approved source test',
      expect.objectContaining({
        includeContent: true,
        allowedDomains: ['example.test'],
      }),
    );
  });

  it('answers immediately from result snippets without requesting page approval', async () => {
    const snippetData = {
      provider: 'duckduckgo',
      totalResults: 2,
      results: WEB_DATA.sources.map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
      })),
    };
    mocks.searchWebResearch.mockResolvedValue(snippetData);
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: 'Immediate answer from DuckDuckGo snippets',
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
    });
    const requestDomainApproval = vi.fn();

    const result = await runWebResearchTask('what is an AI model', {
      settings: { ...SETTINGS, agent_web_site_guard: true },
      enablePlanning: false,
      includeContent: false,
      requestDomainApproval,
    });

    expect(requestDomainApproval).not.toHaveBeenCalled();
    expect(mocks.searchWebResearch).toHaveBeenCalledTimes(1);
    expect(mocks.searchWebResearch).toHaveBeenCalledWith(
      'what is an AI model',
      expect.objectContaining({ includeContent: false }),
    );
    expect(result).toMatchObject({
      summary: 'Immediate answer from DuckDuckGo snippets',
      evidenceMode: 'snippets',
      scannedSources: 0,
    });
    const synthesisPrompt = mocks.runBoundedRoleTask.mock.calls[0][0].messages[1].content;
    expect(synthesisPrompt).toContain('Return valid GitHub-Flavored Markdown');
    expect(synthesisPrompt).toContain('[Source title](exact supplied URL)');
    expect(synthesisPrompt).toContain('search-result snippets');
  });

  it('reuses an existing effective query when a snippet answer is deepened', async () => {
    mocks.searchWebResearch.mockResolvedValue(WEB_DATA);
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: 'Detailed answer',
      role: 'scout',
      provider: 'local',
      model: 'qwen3:4b',
    });

    const result = await runWebResearchTask('compare several AI model types in plain English', {
      settings: SETTINGS,
      enablePlanning: false,
      effectiveQueryOverride: 'AI model types comparison',
      includeContent: true,
      approvedDomains: ['example.test'],
    });

    expect(mocks.searchWebResearch).toHaveBeenCalledWith(
      'AI model types comparison',
      expect.objectContaining({
        includeContent: true,
        allowedDomains: ['example.test'],
      }),
    );
    expect(result).toMatchObject({
      query: 'compare several AI model types in plain English',
      effectiveQuery: 'AI model types comparison',
      evidenceMode: 'full-pages',
    });
  });

  it('answers follow-ups from retained evidence without another network request', async () => {
    mocks.runBoundedRoleTask.mockResolvedValue({
      text: 'retained answer',
      role: 'scout',
    });

    const answer = await answerWebResearchFollowUp(
      'What did the first source say?',
      {
        query: 'test query',
        effectiveQuery: 'test query',
        provider: 'duckduckgo',
        totalResults: 2,
        scannedSources: 2,
        linesReadTotal: 18,
        charsReadTotal: 2400,
        relatedQueries: [],
        summary: 'previous summary',
        evidenceMode: 'full-pages',
        sources: WEB_DATA.sources.map((source) => ({ ...source, error: '' })),
        steps: [],
        synthesis: { mode: 'local-model' },
        raw: WEB_DATA,
      },
      SETTINGS,
    );

    expect(answer).toBe('retained answer');
    expect(mocks.searchWebResearch).not.toHaveBeenCalled();
    expect(mocks.runBoundedRoleTask.mock.calls[0][0].messages[1].content).toContain(
      'First extracted evidence',
    );
  });
});
