/** Verifies the Files hook connects browsing, semantic search, image preview, indexing, and save state. */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyzeFileWithAI: vi.fn(),
  browseDirectory: vi.fn(),
  cancelFileSemanticIndex: vi.fn(),
  clearFileSemanticIndex: vi.fn(),
  findSimilarFiles: vi.fn(),
  getFileIndexSources: vi.fn(),
  getFileMediaUrl: vi.fn(),
  getFileSemanticStatus: vi.fn(),
  getFileThumbnail: vi.fn(),
  installFileSemanticModels: vi.fn(),
  listDirectory: vi.fn(),
  openFileWithSystem: vi.fn(),
  revealFileInFolder: vi.fn(),
  preflightFileSemanticIndex: vi.fn(),
  readTextFile: vi.fn(),
  rebuildFileSemanticIndex: vi.fn(),
  rescanFileSemanticIndex: vi.fn(),
  searchFileSemanticConcepts: vi.fn(),
  searchFileSemanticIndex: vi.fn(),
  writeTextFile: vi.fn(),
  writeClipboard: vi.fn(),
  setOrbState: vi.fn(),
}))

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbSettings: () => ({
    settings: {
      permissions_file_read: true,
      permissions_file_write: true,
    },
  }),
  useOrbShell: () => ({ setOrbState: mocks.setOrbState }),
}))

vi.mock('@/platform/desktopBridge', () => ({
  analyzeFileWithAI: mocks.analyzeFileWithAI,
  browseDirectory: mocks.browseDirectory,
  cancelFileSemanticIndex: mocks.cancelFileSemanticIndex,
  clearFileSemanticIndex: mocks.clearFileSemanticIndex,
  findSimilarFiles: mocks.findSimilarFiles,
  getFileIndexSources: mocks.getFileIndexSources,
  getFileMediaUrl: mocks.getFileMediaUrl,
  getFileSemanticStatus: mocks.getFileSemanticStatus,
  getFileThumbnail: mocks.getFileThumbnail,
  installFileSemanticModels: mocks.installFileSemanticModels,
  listDirectory: mocks.listDirectory,
  openFileWithSystem: mocks.openFileWithSystem,
  revealFileInFolder: mocks.revealFileInFolder,
  preflightFileSemanticIndex: mocks.preflightFileSemanticIndex,
  readTextFile: mocks.readTextFile,
  rebuildFileSemanticIndex: mocks.rebuildFileSemanticIndex,
  rescanFileSemanticIndex: mocks.rescanFileSemanticIndex,
  searchFileSemanticConcepts: mocks.searchFileSemanticConcepts,
  searchFileSemanticIndex: mocks.searchFileSemanticIndex,
  writeTextFile: mocks.writeTextFile,
}))

import { useFilePanel } from '@/platform-features/files/useFilePanel'

const homeSource = {
  id: 'home',
  label: 'Home',
  path: '/home/user',
  kind: 'home' as const,
  filesystem: 'ext4',
  device: '/dev/nvme0n1p2',
  size: 0,
  uuid: '',
  removable: false,
  network: false,
  readOnly: false,
  available: true,
  alwaysSelected: true,
  selectedByDefault: true,
}

const readyStatus = {
  ollamaAvailable: true,
  imageModelInstalled: true,
  embeddingModelInstalled: true,
  imageModel: 'qwen3.5:0.8b',
  embeddingModel: 'all-minilm:22m',
  indexStatus: 'ready' as const,
  nodeCount: 3,
  fileCount: 2,
  semanticCount: 2,
  skippedCount: 0,
  failedCount: 0,
  sources: [homeSource],
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.writeClipboard.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeClipboard },
  })
  mocks.browseDirectory.mockResolvedValue({
    currentPath: '/home/user',
    parentPath: null,
    truncated: false,
    entries: [
      {
        name: 'Pictures',
        path: '/home/user/Pictures',
        type: 'directory',
        size: 0,
        modifiedAt: 2,
        extension: '',
        isImage: false,
        isVideo: false,
      },
      {
        name: 'large.txt',
        path: '/home/user/large.txt',
        type: 'file',
        size: 100,
        modifiedAt: 3,
        extension: '.txt',
        isImage: false,
        isVideo: false,
      },
      {
        name: 'small.txt',
        path: '/home/user/small.txt',
        type: 'file',
        size: 10,
        modifiedAt: 1,
        extension: '.txt',
        isImage: false,
        isVideo: false,
      },
    ],
  })
  mocks.listDirectory.mockResolvedValue({
    rootPath: '/home/user',
    tree: {
      name: 'user',
      path: '/home/user',
      type: 'directory',
      children: [
        {
          name: 'Pictures',
          path: '/home/user/Pictures',
          type: 'directory',
          children: [],
        },
      ],
    },
  })
  mocks.preflightFileSemanticIndex.mockResolvedValue({
    rootPath: '/home/user',
    sources: [
      {
        ...homeSource,
        nodeCount: 4,
        directoryCount: 1,
        fileCount: 3,
        skippedCount: 0,
      },
    ],
    nodeCount: 4,
    directoryCount: 1,
    fileCount: 3,
    skippedCount: 0,
    warningThreshold: 1_000_000,
    requiresConfirmation: false,
    scannedAt: 1,
  })
  mocks.getFileIndexSources.mockResolvedValue({
    sources: [homeSource],
    selectedSourceIds: ['home'],
    locked: true,
  })
  mocks.clearFileSemanticIndex.mockResolvedValue({
    ...readyStatus,
    indexStatus: 'missing',
    semanticCount: 0,
    sources: [],
  })
  mocks.getFileSemanticStatus.mockResolvedValue(readyStatus)
  mocks.getFileMediaUrl.mockReturnValue('http://127.0.0.1:3210/api/local/fs/media?path=clip.mp4')
  mocks.readTextFile.mockResolvedValue({
    path: '/home/user/small.txt',
    content: 'original',
    isBinary: false,
  })
  mocks.getFileThumbnail.mockResolvedValue({
    dataUrl: 'data:image/png;base64,aW1hZ2U=',
    width: 100,
    height: 100,
    modifiedAt: 1,
  })
  mocks.analyzeFileWithAI.mockResolvedValue({
    path: '/home/user/small.txt',
    name: 'small.txt',
    fileType: 'text',
    markdown: '## Analysis\n\nA useful summary.',
    model: 'qwen3.5:0.8b',
  })
  mocks.findSimilarFiles.mockResolvedValue([])
  mocks.searchFileSemanticConcepts.mockResolvedValue([])
  mocks.writeTextFile.mockResolvedValue({ saved: true, modifiedAt: 10 })
})

describe('useFilePanel', () => {
  it('loads an immediate directory and sorts its entries by metadata', async () => {
    const { result } = renderHook(() => useFilePanel())

    await waitFor(() => expect(result.current.currentPath).toBe('/home/user'))
    expect(result.current.visibleEntries.map((entry) => entry.name)).toEqual(['Pictures', 'large.txt', 'small.txt'])
    expect(result.current.tree?.path).toBe('/home/user')
    expect(mocks.listDirectory).toHaveBeenCalledWith('~', 4)

    act(() => {
      result.current.setSortField('size')
      result.current.setSortDirection('desc')
    })

    expect(result.current.visibleEntries.map((entry) => entry.name)).toEqual(['Pictures', 'large.txt', 'small.txt'])
  })

  it('sorts by modified date and groups file types with name sub-sorting', async () => {
    mocks.browseDirectory.mockResolvedValueOnce({
      currentPath: '/home/user',
      parentPath: null,
      truncated: false,
      entries: [
        {
          name: 'zoo.png',
          path: '/home/user/zoo.png',
          type: 'file',
          size: 20,
          modifiedAt: 4,
          extension: '.png',
          isImage: true,
          isVideo: false,
        },
        {
          name: 'beta.mp4',
          path: '/home/user/beta.mp4',
          type: 'file',
          size: 30,
          modifiedAt: 2,
          extension: '.mp4',
          isImage: false,
          isVideo: true,
        },
        {
          name: 'alpha.mp4',
          path: '/home/user/alpha.mp4',
          type: 'file',
          size: 40,
          modifiedAt: 3,
          extension: '.mp4',
          isImage: false,
          isVideo: true,
        },
        {
          name: 'older.txt',
          path: '/home/user/older.txt',
          type: 'file',
          size: 10,
          modifiedAt: 1,
          extension: '.txt',
          isImage: false,
          isVideo: false,
        },
      ],
    })
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.visibleEntries.length).toBe(4))

    act(() => {
      result.current.setSortField('type')
      result.current.setSortDirection('desc')
    })
    expect(result.current.visibleEntries.map((entry) => entry.name)).toEqual([
      'older.txt',
      'zoo.png',
      'alpha.mp4',
      'beta.mp4',
    ])

    act(() => {
      result.current.setSortField('modified')
      result.current.setSortDirection('desc')
    })
    expect(result.current.visibleEntries.map((entry) => entry.name)).toEqual([
      'zoo.png',
      'alpha.mp4',
      'beta.mp4',
      'older.txt',
    ])
  })

  it('clears the selected preview when tree navigation opens a folder', async () => {
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.visibleEntries.length).toBe(3))

    await act(async () => result.current.selectFile(result.current.visibleEntries[2]))
    expect(result.current.selectedFile?.name).toBe('small.txt')

    mocks.browseDirectory.mockResolvedValueOnce({
      currentPath: '/home/user/Pictures',
      parentPath: '/home/user',
      truncated: false,
      entries: [],
    })
    await act(async () => result.current.openDirectory('/home/user/Pictures'))

    expect(result.current.currentPath).toBe('/home/user/Pictures')
    expect(result.current.selectedFile).toBeNull()
  })

  it('searches the shared semantic index and defaults results to relevance order', async () => {
    mocks.searchFileSemanticIndex.mockResolvedValue([
      {
        id: '2',
        name: 'beach.jpg',
        path: '/home/user/Pictures/beach.jpg',
        relativePath: 'Pictures/beach.jpg',
        nodeType: 'file',
        size: 20,
        modifiedAt: 2,
        summary: 'A holiday beside a beach.',
        semanticType: 'image',
        score: 0.91,
      },
    ])
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.semanticStatus?.indexStatus).toBe('ready'))

    act(() => result.current.setSearchQuery('holiday near a beach'))
    await act(async () => result.current.submitSearch())

    expect(mocks.searchFileSemanticIndex).toHaveBeenCalledWith('holiday near a beach', 100, 'all')
    expect(result.current.activeSearchQuery).toBe('holiday near a beach')
    expect(result.current.sortField).toBe('relevance')
    expect(result.current.visibleEntries[0]).toMatchObject({
      name: 'beach.jpg',
      isImage: true,
    })
  })

  it('sends the selected semantic file type to the server', async () => {
    mocks.searchFileSemanticIndex.mockResolvedValue([])
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.semanticStatus?.indexStatus).toBe('ready'))

    act(() => {
      result.current.setSearchQuery('anime girl')
      result.current.setSearchKind('image')
    })
    await act(async () => result.current.submitSearch())

    expect(mocks.searchFileSemanticIndex).toHaveBeenCalledWith('anime girl', 100, 'image')
  })

  it('copies file contents and paths and reveals files in the system manager', async () => {
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.visibleEntries.length).toBe(3))
    const file = result.current.visibleEntries.find((entry) => entry.name === 'small.txt')!

    await act(async () => result.current.copyFileContents(file))
    expect(mocks.readTextFile).toHaveBeenCalledWith('/home/user/small.txt', {
      fileManager: true,
    })
    expect(mocks.writeClipboard).toHaveBeenCalledWith('original')
    expect(result.current.fileActionMessage).toContain('small.txt')

    await act(async () => result.current.copyFileLocation(file))
    expect(mocks.writeClipboard).toHaveBeenCalledWith('/home/user/small.txt')

    await act(async () => result.current.openFileLocation(file))
    expect(mocks.revealFileInFolder).toHaveBeenCalledWith('/home/user/small.txt', true)
  })

  it('loads image previews and saves edited text with visible dirty state', async () => {
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.visibleEntries.length).toBe(3))

    await act(async () =>
      result.current.selectFile({
        name: 'photo.png',
        path: '/home/user/photo.png',
        type: 'file',
        size: 20,
        modifiedAt: 1,
        extension: '.png',
        isImage: true,
        isVideo: false,
      }),
    )
    expect(result.current.imagePreview).toMatch(/^data:image\/png/)
    expect(result.current.selectedFile?.isBinary).toBe(true)

    await act(async () => result.current.selectFile(result.current.visibleEntries[2]))
    act(() => result.current.setContent('changed'))
    expect(result.current.isDirty).toBe(true)

    await act(async () => result.current.saveFile())
    expect(mocks.writeTextFile).toHaveBeenCalledWith('/home/user/small.txt', 'changed', {
      fileManager: true,
    })
    expect(result.current.isDirty).toBe(false)
    expect(result.current.saved).toBe(true)
  })

  it('opens videos through the authenticated media route and closes back to the file list', async () => {
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.visibleEntries.length).toBe(3))

    await act(async () =>
      result.current.selectFile({
        name: 'clip.mp4',
        path: '/home/user/clip.mp4',
        type: 'file',
        size: 200,
        modifiedAt: 4,
        extension: '.mp4',
        isImage: false,
        isVideo: true,
      }),
    )

    expect(mocks.getFileMediaUrl).toHaveBeenCalledWith('/home/user/clip.mp4', true)
    expect(result.current.videoPreview).toContain('/api/local/fs/media')
    expect(result.current.selectedFile).toMatchObject({
      name: 'clip.mp4',
      isBinary: true,
      isVideo: true,
    })
    expect(mocks.readTextFile).not.toHaveBeenCalledWith('/home/user/clip.mp4')

    act(() => result.current.closePreview())
    expect(result.current.selectedFile).toBeNull()
    expect(result.current.videoPreview).toBe('')
    expect(result.current.visibleEntries).toHaveLength(3)
  })

  it('installs the missing Ollama embedding model before starting the initial scan', async () => {
    const missingStatus = {
      ...readyStatus,
      imageModelInstalled: false,
      embeddingModelInstalled: false,
      indexStatus: 'missing' as const,
      semanticCount: 0,
    }
    mocks.getFileSemanticStatus.mockResolvedValue(missingStatus)
    mocks.installFileSemanticModels.mockResolvedValue({
      ...missingStatus,
      embeddingModelInstalled: true,
      indexStatus: 'building',
    })
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.semanticStatus?.indexStatus).toBe('missing'))

    await act(async () => result.current.startInitialScan())

    expect(mocks.installFileSemanticModels).toHaveBeenCalledTimes(1)
    expect(mocks.rebuildFileSemanticIndex).toHaveBeenCalledWith(false, ['home'])
  })

  it('discovers selectable index locations and unlocks them after deleting the index', async () => {
    const internalSource = {
      ...homeSource,
      id: 'uuid:projects',
      label: 'Projects',
      path: '/mnt/projects',
      kind: 'internal' as const,
      alwaysSelected: false,
    }
    mocks.getFileIndexSources
      .mockResolvedValueOnce({
        sources: [homeSource, internalSource],
        selectedSourceIds: ['home', 'uuid:projects'],
        locked: false,
      })
      .mockResolvedValue({
        sources: [homeSource, internalSource],
        selectedSourceIds: ['home', 'uuid:projects'],
        locked: false,
      })
    const { result } = renderHook(() => useFilePanel())

    await waitFor(() => expect(result.current.indexSources).toHaveLength(2))
    act(() => result.current.toggleIndexSource('uuid:projects'))
    expect(result.current.selectedSourceIds).toEqual(['home'])

    await act(async () => result.current.clearIndex())
    expect(mocks.clearFileSemanticIndex).toHaveBeenCalledTimes(1)
    expect(result.current.locationsLocked).toBe(false)
  })

  it('keeps a model-install failure visible after refreshing missing index status', async () => {
    const missingStatus = {
      ...readyStatus,
      imageModelInstalled: false,
      embeddingModelInstalled: true,
      indexStatus: 'missing' as const,
      semanticCount: 0,
    }
    mocks.getFileSemanticStatus.mockResolvedValue(missingStatus)
    mocks.installFileSemanticModels.mockRejectedValue(new Error('IRIS could not prepare the CLIP image model'))

    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.semanticStatus?.indexStatus).toBe('missing'))

    await act(async () => result.current.startInitialScan())

    expect(result.current.indexError).toBe('IRIS could not prepare the CLIP image model')
    expect(mocks.rebuildFileSemanticIndex).not.toHaveBeenCalled()
  })

  it('analyzes selected text files and images through the full-file bridge route', async () => {
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.visibleEntries.length).toBe(3))

    await act(async () => result.current.selectFile(result.current.visibleEntries[2]))
    await act(async () => result.current.analyzeFile())

    expect(mocks.analyzeFileWithAI).toHaveBeenCalledWith('/home/user/small.txt', true)
    expect(result.current.aiAnalysis).toContain('## Analysis')

    mocks.analyzeFileWithAI.mockResolvedValue({
      path: '/home/user/photo.png',
      name: 'photo.png',
      fileType: 'image',
      markdown: '## Image\n\nA beach holiday photograph.',
      model: 'qwen3.5:0.8b',
    })
    await act(async () =>
      result.current.selectFile({
        name: 'photo.png',
        path: '/home/user/photo.png',
        type: 'file',
        size: 20,
        modifiedAt: 1,
        extension: '.png',
        isImage: true,
        isVideo: false,
      }),
    )
    await act(async () => result.current.analyzeFile())

    expect(mocks.analyzeFileWithAI).toHaveBeenLastCalledWith('/home/user/photo.png', true)
    expect(result.current.aiAnalysis).toContain('beach holiday')
  })

  it('opens concept groups and selected-file similarity results', async () => {
    mocks.searchFileSemanticConcepts.mockResolvedValue([
      {
        id: 'concept_1',
        title: 'Beach Holidays',
        results: [
          {
            id: 'beach',
            name: 'beach.jpg',
            path: '/home/user/beach.jpg',
            relativePath: 'beach.jpg',
            nodeType: 'file',
            size: 20,
            modifiedAt: 2,
            summary: 'A holiday beside a beach.',
            semanticType: 'image',
            score: 0.91,
          },
        ],
      },
    ])
    mocks.findSimilarFiles.mockResolvedValue([
      {
        id: 'large',
        name: 'large.txt',
        path: '/home/user/large.txt',
        relativePath: 'large.txt',
        nodeType: 'file',
        size: 100,
        modifiedAt: 3,
        summary: 'A related text file.',
        semanticType: 'text',
        score: 0.82,
      },
    ])
    const { result } = renderHook(() => useFilePanel())
    await waitFor(() => expect(result.current.semanticStatus?.indexStatus).toBe('ready'))

    act(() => result.current.setSearchQuery('holiday near a beach'))
    await act(async () => result.current.submitConceptSearch())

    expect(mocks.searchFileSemanticConcepts).toHaveBeenCalledWith('holiday near a beach', 6, 12)
    expect(result.current.resultMode).toBe('concepts')
    expect(result.current.conceptGroups[0].title).toBe('Beach Holidays')

    await act(async () => result.current.selectFile(result.current.visibleEntries[2]))
    await act(async () => result.current.showSimilarFiles())

    expect(mocks.findSimilarFiles).toHaveBeenCalledWith('/home/user/small.txt', 100)
    expect(result.current.resultMode).toBe('similar')
    expect(result.current.visibleEntries[0].name).toBe('large.txt')
  })
})
