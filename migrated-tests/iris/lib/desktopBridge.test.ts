/**
 * Exercises the observable desktop bridge contract, with regression cases for “returns the
 * session payload rather than the wrapper” and “throws the server error message for
 * non-success responses”. The suite documents caller-visible behavior so implementation
 * refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it, vi } from 'vitest'
import * as bridgeModule from '@/platform/desktopBridge'

type BridgeFunction = (...args: any[]) => any
type BridgeCase = [string, () => Promise<unknown>, string, string, unknown]

const bridge = bridgeModule as typeof bridgeModule & Record<string, BridgeFunction>
import { jsonResponse, parseFetchCall } from '../helpers/http'

// Installs a deterministic fetch mock and returns the captured bridge calls.
function mockFetch(data: unknown = { ok: true }) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(data))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('desktopBridge', () => {
  it('builds authenticated media URLs for browser video elements', () => {
    window.history.replaceState({}, '', '/?bridgePort=3210&bridgeToken=media-secret')

    const url = new URL(bridge.getFileMediaUrl('/home/user/My Clip.mp4'))

    expect(url.origin).toBe('http://127.0.0.1:3210')
    expect(url.pathname).toBe('/api/local/fs/media')
    expect(url.searchParams.get('path')).toBe('/home/user/My Clip.mp4')
    expect(url.searchParams.get('__token')).toBe('media-secret')
    window.history.replaceState({}, '', '/')
  })

  const cases: BridgeCase[] = [
    ['getLocalBridgeHealth', () => bridge.getLocalBridgeHealth(), '/api/local/health', 'GET', undefined],
    ['getLocalSessionInfo', () => bridge.getLocalSessionInfo(), '/api/local/session', 'GET', undefined],
    ['listDirectory', () => bridge.listDirectory('/tmp', 2), '/api/local/fs/list', 'POST', { path: '/tmp', depth: 2 }],
    ['browseDirectory', () => bridge.browseDirectory('/tmp'), '/api/local/fs/browse', 'POST', { path: '/tmp' }],
    [
      'getFileThumbnail',
      () => bridge.getFileThumbnail('/tmp/photo.png', 160, 120),
      '/api/local/fs/thumbnail',
      'POST',
      { path: '/tmp/photo.png', width: 160, height: 120 },
    ],
    [
      'openFileWithSystem',
      () => bridge.openFileWithSystem('/tmp/report.pdf'),
      '/api/local/fs/open',
      'POST',
      { path: '/tmp/report.pdf' },
    ],
    [
      'revealFileInFolder',
      () => bridge.revealFileInFolder('/tmp/report.pdf'),
      '/api/local/fs/reveal',
      'POST',
      { path: '/tmp/report.pdf' },
    ],
    [
      'findFiles',
      () => bridge.findFiles('.', 'config', { depth: 4 }),
      '/api/local/fs/find',
      'POST',
      { path: '.', query: 'config', depth: 4 },
    ],
    ['getFileIndexSources', () => bridge.getFileIndexSources(), '/api/local/fs/index/sources', 'POST', {}],
    [
      'getFileSemanticStatus',
      () => bridge.getFileSemanticStatus(true),
      '/api/local/fs/index/status',
      'POST',
      { buildIfMissing: true },
    ],
    ['installFileSemanticModels', () => bridge.installFileSemanticModels(), '/api/local/fs/index/install', 'POST', {}],
    [
      'rebuildFileSemanticIndex',
      () => bridge.rebuildFileSemanticIndex(),
      '/api/local/fs/index/rebuild',
      'POST',
      { confirmLargeScan: false },
    ],
    [
      'preflightFileSemanticIndex',
      () => bridge.preflightFileSemanticIndex(),
      '/api/local/fs/index/preflight',
      'POST',
      {},
    ],
    ['rescanFileSemanticIndex', () => bridge.rescanFileSemanticIndex(), '/api/local/fs/index/rescan', 'POST', {}],
    ['cancelFileSemanticIndex', () => bridge.cancelFileSemanticIndex(), '/api/local/fs/index/cancel', 'POST', {}],
    ['clearFileSemanticIndex', () => bridge.clearFileSemanticIndex(), '/api/local/fs/index/clear', 'POST', {}],
    [
      'searchFileSemanticIndex',
      () => bridge.searchFileSemanticIndex('calculator app', 25),
      '/api/local/fs/semantic/search',
      'POST',
      { query: 'calculator app', limit: 25 },
    ],
    [
      'searchFileSemanticIndex image filter',
      () => bridge.searchFileSemanticIndex('anime girl', 25, 'image'),
      '/api/local/fs/semantic/search',
      'POST',
      { query: 'anime girl', limit: 25, kind: 'image' },
    ],
    [
      'findSimilarFiles',
      () => bridge.findSimilarFiles('/tmp/calculator.py', 20),
      '/api/local/fs/semantic/similar',
      'POST',
      { path: '/tmp/calculator.py', limit: 20 },
    ],
    [
      'searchFileSemanticConcepts',
      () => bridge.searchFileSemanticConcepts('holiday', 4, 8),
      '/api/local/fs/semantic/concepts',
      'POST',
      { query: 'holiday', groupLimit: 4, filesPerGroup: 8 },
    ],
    [
      'analyzeFileWithAI',
      () => bridge.analyzeFileWithAI('/tmp/calculator.py'),
      '/api/local/fs/analyze',
      'POST',
      { path: '/tmp/calculator.py' },
    ],
    [
      'readTextFile',
      () => bridge.readTextFile('README.md', { startLine: 2 }),
      '/api/local/fs/read',
      'POST',
      { path: 'README.md', startLine: 2 },
    ],
    [
      'writeTextFile',
      () => bridge.writeTextFile('a.txt', 'content'),
      '/api/local/fs/write',
      'POST',
      { path: 'a.txt', content: 'content' },
    ],
    [
      'executeTerminalCommand',
      () => bridge.executeTerminalCommand('pwd', '/project'),
      '/api/local/terminal/execute',
      'POST',
      { command: 'pwd', cwd: '/project' },
    ],
    [
      'launchLocalCommand',
      () => bridge.launchLocalCommand('code .', 'app', '/project'),
      '/api/local/launcher/run',
      'POST',
      { command: 'code .', category: 'app', cwd: '/project' },
    ],
    [
      'discoverLauncherCapabilities',
      () => bridge.discoverLauncherCapabilities({ desktop: 'kde', applications: [], tools: [] }, true),
      '/api/local/launcher/discover',
      'POST',
      {
        cached: { desktop: 'kde', applications: [], tools: [] },
        force: true,
      },
    ],
    [
      'getDevEnvironmentStatus',
      () => bridge.getDevEnvironmentStatus('/project'),
      '/api/local/launcher/dev/status',
      'POST',
      { cwd: '/project' },
    ],
    [
      'startDevEnvironment',
      () => bridge.startDevEnvironment('/project'),
      '/api/local/launcher/dev/start',
      'POST',
      { cwd: '/project' },
    ],
    ['stopDevEnvironment', () => bridge.stopDevEnvironment(), '/api/local/launcher/dev/stop', 'POST', {}],
    [
      'clearIRISData',
      () => bridge.clearIRISData('approval-id'),
      '/api/local/launcher/clear-data',
      'POST',
      { approvalId: 'approval-id' },
    ],
    [
      'getLauncherSemanticStatus',
      () => bridge.getLauncherSemanticStatus(false),
      '/api/local/launcher/semantic/status',
      'POST',
      { buildIfMissing: false },
    ],
    [
      'installLauncherSemanticModel',
      () => bridge.installLauncherSemanticModel(),
      '/api/local/launcher/semantic/install',
      'POST',
      {},
    ],
    [
      'rebuildLauncherSemanticIndex',
      () => bridge.rebuildLauncherSemanticIndex(),
      '/api/local/launcher/semantic/rebuild',
      'POST',
      {},
    ],
    [
      'searchLauncherSemanticApplications',
      () => bridge.searchLauncherSemanticApplications('3D modelling', 12),
      '/api/local/launcher/semantic/search',
      'POST',
      { query: '3D modelling', limit: 12 },
    ],
    [
      'getAutomationCapabilities',
      () => bridge.getAutomationCapabilities(),
      '/api/local/automation/capabilities',
      'GET',
      undefined,
    ],
    [
      'executeAutomationActions',
      () =>
        bridge.executeAutomationActions([{ type: 'wait' }], {
          dryRun: true,
          cwd: '/project',
          permissions: { mouse: true },
        }),
      '/api/local/automation/execute',
      'POST',
      {
        actions: [{ type: 'wait' }],
        dryRun: true,
        cwd: '/project',
        permissions: { mouse: true },
      },
    ],
    ['discoverLocalAIServers', () => bridge.discoverLocalAIServers(), '/api/local/ai/discover', 'GET', undefined],
    [
      'getNoteTranscriptionStatus',
      () => bridge.getNoteTranscriptionStatus(),
      '/api/local/audio/transcription/status',
      'GET',
      undefined,
    ],
    [
      'installNoteTranscriptionModel',
      () => bridge.installNoteTranscriptionModel(),
      '/api/local/audio/transcription/install',
      'POST',
      {},
    ],
    [
      'proxyAIRequest',
      () =>
        bridge.proxyAIRequest({
          url: 'https://example.test',
          method: 'POST',
          headers: { a: 'b' },
          body: '{}',
          timeoutMs: 100,
        }),
      '/api/local/ai/proxy',
      'POST',
      {
        url: 'https://example.test',
        method: 'POST',
        headers: { a: 'b' },
        body: '{}',
        timeoutMs: 100,
      },
    ],
    [
      'searchWebResearch',
      () => bridge.searchWebResearch('query', { maxResults: 4 }),
      '/api/local/web/search',
      'POST',
      { query: 'query', maxResults: 4 },
    ],
    ['listSkillProfiles', () => bridge.listSkillProfiles(), '/api/local/skills/profiles', 'GET', undefined],
    [
      'listSkillDefinitions',
      () => bridge.listSkillDefinitions('profile'),
      '/api/local/skills/list',
      'POST',
      { profile: 'profile' },
    ],
    [
      'upsertSkillDefinition',
      () => bridge.upsertSkillDefinition('profile', { id: 'skill' }),
      '/api/local/skills/upsert',
      'POST',
      { profile: 'profile', skill: { id: 'skill' } },
    ],
    [
      'deleteSkillDefinition',
      () => bridge.deleteSkillDefinition('profile', 'skill'),
      '/api/local/skills/delete',
      'POST',
      { profile: 'profile', skillId: 'skill' },
    ],
    [
      'registerAgent',
      () => bridge.registerAgent('executor', ['files.read']),
      '/api/local/agent/register',
      'POST',
      { agentId: 'executor', capabilities: ['files.read'] },
    ],
    ['getAgentRosterRemote', () => bridge.getAgentRosterRemote(), '/api/local/agent/roster', 'GET', undefined],
    [
      'postAgentTask',
      () => bridge.postAgentTask({ taskId: 'task' }),
      '/api/local/agent/task/post',
      'POST',
      { stp: { taskId: 'task' } },
    ],
    [
      'pollAgentTask',
      () => bridge.pollAgentTask('agent one'),
      '/api/local/agent/task/poll?agentId=agent%20one',
      'GET',
      undefined,
    ],
    [
      'postAgentTaskResult',
      () => bridge.postAgentTaskResult({ taskId: 'task', status: 'done' }),
      '/api/local/agent/task/result',
      'POST',
      { taskId: 'task', status: 'done' },
    ],
    [
      'getAgentTaskStatus',
      () => bridge.getAgentTaskStatus('task one'),
      '/api/local/agent/task/status?taskId=task%20one',
      'GET',
      undefined,
    ],
    [
      'broadcastAgentMessage',
      () => bridge.broadcastAgentMessage('update', { root: '/project' }),
      '/api/local/agent/broadcast',
      'POST',
      { message: 'update', contextUpdate: { root: '/project' } },
    ],
    [
      'powerRipgrep',
      () => bridge.powerRipgrep('needle', { path: '.' }),
      '/api/local/power/ripgrep',
      'POST',
      { pattern: 'needle', path: '.' },
    ],
    ['powerStat', () => bridge.powerStat('README.md'), '/api/local/power/stat', 'POST', { path: ['README.md'] }],
    [
      'powerFind',
      () => bridge.powerFind({ path: '.', name: '*.js' }),
      '/api/local/power/find',
      'POST',
      { path: '.', name: '*.js' },
    ],
    ['powerFd', () => bridge.powerFd({ query: 'test' }), '/api/local/power/fd', 'POST', { query: 'test' }],
    ['powerLocate', () => bridge.powerLocate({ query: 'file' }), '/api/local/power/locate', 'POST', { query: 'file' }],
    [
      'powerDiff',
      () => bridge.powerDiff('a.txt', 'new', 5),
      '/api/local/power/diff',
      'POST',
      { path: 'a.txt', newContent: 'new', contextLines: 5 },
    ],
    [
      'powerPatch',
      () => bridge.powerPatch('a.txt', 'patch', true),
      '/api/local/power/patch',
      'POST',
      { path: 'a.txt', patch: 'patch', dryRun: true },
    ],
    [
      'powerWebFetch',
      () => bridge.powerWebFetch('https://example.test', { maxChars: 100 }),
      '/api/local/power/webfetch',
      'POST',
      { url: 'https://example.test', maxChars: 100 },
    ],
    [
      'powerEnvInspect',
      () => bridge.powerEnvInspect(['tools']),
      '/api/local/power/env',
      'POST',
      { include: ['tools'] },
    ],
    ['powerClipboardRead', () => bridge.powerClipboardRead(), '/api/local/power/clipboard/read', 'GET', undefined],
    [
      'powerClipboardWrite',
      () => bridge.powerClipboardWrite('text'),
      '/api/local/power/clipboard/write',
      'POST',
      { content: 'text' },
    ],
    [
      'powerScript',
      () => bridge.powerScript('snapshot', { depth: 2 }, '/project'),
      '/api/local/power/script',
      'POST',
      { script: 'snapshot', args: { depth: 2 }, cwd: '/project' },
    ],
    [
      'showOpenFileDialog',
      () => bridge.showOpenFileDialog({ multiple: true }),
      '/api/local/system/open-file-dialog',
      'POST',
      { multiple: true },
    ],
  ]

  it.each(cases)('%s preserves its HTTP contract', async (_name, call, expectedUrl, expectedMethod, expectedBody) => {
    const responseData = _name === 'getLocalSessionInfo' ? { session: { id: 'local' } } : { ok: true }
    const fetchMock = mockFetch(responseData)

    await call()

    const { url, options, body } = parseFetchCall(fetchMock)
    expect(url).toBe(expectedUrl)
    expect(options.method).toBe(expectedMethod)
    expect(body).toEqual(expectedBody)
    if (expectedBody) {
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
    } else {
      expect(options.headers).toBeUndefined()
    }
  })

  it('sends note audio as an in-memory WAV request', async () => {
    const fetchMock = mockFetch({ text: 'dictated note' })
    const audio = new Blob([new Uint8Array([82, 73, 70, 70])], {
      type: 'audio/wav',
    })

    await expect(bridge.transcribeNoteAudio(audio)).resolves.toBe('dictated note')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/local/audio/transcriptions')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'audio/wav',
      'x-iris-audio-provider': 'local',
      'x-iris-audio-local-fallback': '1',
    })
    expect(options.body).toBe(audio)
  })

  it('marks File Manager requests and selected index locations explicitly', async () => {
    const fetchMock = mockFetch({ ok: true })

    await bridge.browseDirectory('/mnt/projects', true)
    await bridge.getFileThumbnail('/mnt/projects/photo.png', 160, 120, true)
    await bridge.preflightFileSemanticIndex(['home', 'uuid:projects'])
    await bridge.rebuildFileSemanticIndex(true, ['home', 'uuid:projects'])

    expect(parseFetchCall(fetchMock, 0).body).toEqual({
      path: '/mnt/projects',
      fileManager: true,
    })
    expect(parseFetchCall(fetchMock, 1).body).toEqual({
      path: '/mnt/projects/photo.png',
      width: 160,
      height: 120,
      fileManager: true,
    })
    expect(parseFetchCall(fetchMock, 2).body).toEqual({
      selectedSourceIds: ['home', 'uuid:projects'],
    })
    expect(parseFetchCall(fetchMock, 3).body).toEqual({
      confirmLargeScan: true,
      selectedSourceIds: ['home', 'uuid:projects'],
    })
  })

  it('obtains a single-use approval token before a non-dry-run automation execute', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ approvalToken: 'tok-123', expiresInMs: 60000 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await bridge.executeAutomationActions([{ type: 'click' }], {
      dryRun: false,
      cwd: '/project',
      permissions: { mouse: true },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const approval = parseFetchCall(fetchMock, 0)
    expect(approval.url).toBe('/api/local/automation/approval')
    expect(approval.body).toEqual({
      actions: [{ type: 'click' }],
      cwd: '/project',
    })

    const execute = parseFetchCall(fetchMock, 1)
    expect(execute.url).toBe('/api/local/automation/execute')
    expect(execute.body).toEqual({
      actions: [{ type: 'click' }],
      dryRun: false,
      cwd: '/project',
      permissions: { mouse: true },
      approvalToken: 'tok-123',
    })
  })

  it('returns the session payload rather than the wrapper', async () => {
    mockFetch({ session: { id: 'local-session' } })
    await expect(bridge.getLocalSessionInfo()).resolves.toEqual({
      id: 'local-session',
    })
  })

  it('throws the server error message for non-success responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'denied' }, { ok: false, status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(bridge.getLocalBridgeHealth()).rejects.toThrow('denied')
  })

  it('falls back to the status code when an error body is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('invalid json')
        },
      }),
    )
    await expect(bridge.getLocalBridgeHealth()).rejects.toThrow('Local bridge error (500)')
  })

  it('returns null when the optional screen source endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not available')))
    await expect(bridge.getScreenSources()).resolves.toBeNull()
  })

  it('returns screen sources from a supported endpoint', async () => {
    mockFetch({ sources: [{ id: 'screen:1', name: 'Screen 1' }] })
    await expect(bridge.getScreenSources()).resolves.toEqual([{ id: 'screen:1', name: 'Screen 1' }])
  })

  it('normalizes scalar and array paths for powerStat', async () => {
    const fetchMock = mockFetch({ ok: true })
    await bridge.powerStat(['one', 'two'])
    expect(parseFetchCall(fetchMock).body).toEqual({ path: ['one', 'two'] })
  })

  it('opens the expected agent EventSource URL', () => {
    const EventSourceMock = vi.fn(function EventSource(this: { url: string }, url: string) {
      this.url = url
    })
    vi.stubGlobal('EventSource', EventSourceMock)
    const source = bridge.openAgentStream('agent one') as { url: string }
    expect(source.url).toBe('/api/local/agent/stream/agent%20one')
  })
})
