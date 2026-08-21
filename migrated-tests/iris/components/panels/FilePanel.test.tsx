/** Verifies the Files panel exposes semantic indexing, search, thumbnails, sorting, and save controls. */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setPathInput: vi.fn(),
  setSearchQuery: vi.fn(),
  setSearchKind: vi.fn(),
  setSortField: vi.fn(),
  setSortDirection: vi.fn(),
  setScanConfirmationOpen: vi.fn(),
  setLocationsOpen: vi.fn(),
  selectFile: vi.fn(),
  closePreview: vi.fn(),
  openDirectory: vi.fn(),
  openSelectedWithSystem: vi.fn(),
  copyFileContents: vi.fn(),
  copyFileLocation: vi.fn(),
  openFileLocation: vi.fn(),
  saveFile: vi.fn(),
  analyzeFile: vi.fn(),
  submitPath: vi.fn(),
  refreshDirectory: vi.fn(),
  refreshTree: vi.fn(),
  goToParent: vi.fn(),
  submitSearch: vi.fn(),
  submitConceptSearch: vi.fn(),
  showSimilarFiles: vi.fn(),
  clearSearch: vi.fn(),
  prepareInitialScan: vi.fn(),
  startInitialScan: vi.fn(),
  refreshIndex: vi.fn(),
  cancelIndex: vi.fn(),
  openLocations: vi.fn(),
  toggleIndexSource: vi.fn(),
  clearIndex: vi.fn(),
}));

let hookState: Record<string, unknown>;

vi.mock('@/components/panels/PanelBase', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/permissions/PermissionRequestCard', () => ({
  default: () => <div>permission request</div>,
}));

vi.mock('@/components/files/FileThumbnail', () => ({
  default: ({ name, isVideo }: { name: string; isVideo?: boolean }) => (
    <div data-testid={`thumbnail-${name}`} data-video={isVideo ? 'true' : 'false'} />
  ),
}));

vi.mock('@/components/ui/MarkdownView', () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-analysis">{content}</div>
  ),
}));

vi.mock('@/platform-features/files/useFilePanel', () => ({
  useFilePanel: () => hookState,
}));

import FilePanel from '@/components/panels/FilePanel';

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  hookState = {
    settings: { permissions_file_read: true, permissions_file_write: true },
    currentPath: '/home/user',
    parentPath: null,
    pathInput: '/home/user',
    setPathInput: mocks.setPathInput,
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
    treeError: '',
    isTreeLoading: false,
    visibleEntries: [
      {
        name: 'Pictures',
        path: '/home/user/Pictures',
        type: 'directory',
        size: 0,
        modifiedAt: 1,
        extension: '',
        isImage: false,
        isVideo: false,
      },
      {
        name: 'beach.png',
        path: '/home/user/beach.png',
        type: 'file',
        size: 20,
        modifiedAt: 2,
        extension: '.png',
        isImage: true,
        isVideo: false,
      },
    ],
    directoryTruncated: false,
    browserError: '',
    isDirectoryLoading: false,
    selectedFile: null,
    content: '',
    setContent: vi.fn(),
    imagePreview: '',
    videoPreview: '',
    aiAnalysis: '',
    analysisError: '',
    isAnalyzing: false,
    isFileLoading: false,
    isSaving: false,
    saved: false,
    saveError: '',
    isDirty: false,
    searchQuery: '',
    setSearchQuery: mocks.setSearchQuery,
    searchKind: 'all',
    setSearchKind: mocks.setSearchKind,
    activeSearchQuery: '',
    isSearching: false,
    searchError: '',
    conceptGroups: [],
    isGrouping: false,
    conceptError: '',
    resultMode: 'browse',
    similarSourceName: '',
    sortField: 'name',
    setSortField: mocks.setSortField,
    sortDirection: 'asc',
    setSortDirection: mocks.setSortDirection,
    semanticStatus: {
      ollamaAvailable: true,
      imageModelInstalled: false,
      embeddingModelInstalled: false,
      imageModel: 'qwen3.5:0.8b',
      embeddingModel: 'all-minilm:22m',
      indexStatus: 'missing',
      nodeCount: 0,
      fileCount: 0,
      semanticCount: 0,
      skippedCount: 0,
      failedCount: 0,
      sources: [],
    },
    indexError: '',
    indexAction: '',
    scanConfirmationOpen: false,
    setScanConfirmationOpen: mocks.setScanConfirmationOpen,
    scanPreflight: {
      rootPath: '/home/user',
      sources: [],
      nodeCount: 4,
      directoryCount: 1,
      fileCount: 3,
      skippedCount: 0,
      warningThreshold: 1_000_000,
      requiresConfirmation: false,
      scannedAt: 1,
    },
    locationsOpen: false,
    setLocationsOpen: mocks.setLocationsOpen,
    indexSources: [],
    selectedSourceIds: [],
    locationsLocked: false,
    locationsLoading: false,
    locationsError: '',
    clearIndexBusy: false,
    fileActionMessage: '',
    selectFile: mocks.selectFile,
    closePreview: mocks.closePreview,
    openDirectory: mocks.openDirectory,
    openSelectedWithSystem: mocks.openSelectedWithSystem,
    copyFileContents: mocks.copyFileContents,
    copyFileLocation: mocks.copyFileLocation,
    openFileLocation: mocks.openFileLocation,
    saveFile: mocks.saveFile,
    analyzeFile: mocks.analyzeFile,
    submitPath: mocks.submitPath,
    refreshDirectory: mocks.refreshDirectory,
    refreshTree: mocks.refreshTree,
    goToParent: mocks.goToParent,
    submitSearch: mocks.submitSearch,
    submitConceptSearch: mocks.submitConceptSearch,
    showSimilarFiles: mocks.showSimilarFiles,
    clearSearch: mocks.clearSearch,
    prepareInitialScan: mocks.prepareInitialScan,
    startInitialScan: mocks.startInitialScan,
    refreshIndex: mocks.refreshIndex,
    cancelIndex: mocks.cancelIndex,
    openLocations: mocks.openLocations,
    toggleIndexSource: mocks.toggleIndexSource,
    clearIndex: mocks.clearIndex,
  };
});

describe('FilePanel', () => {
  it('keeps the directory tree on the left and file tiles in the main pane', () => {
    hookState.visibleEntries = [
      ...(hookState.visibleEntries as Array<Record<string, unknown>>),
      {
        name: 'clip.mp4',
        path: '/home/user/clip.mp4',
        type: 'file',
        size: 30,
        modifiedAt: 3,
        extension: '.mp4',
        isImage: false,
        isVideo: true,
      },
    ];
    render(<FilePanel />);

    expect(screen.getByTestId('thumbnail-beach.png')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-clip.mp4')).toHaveAttribute('data-video', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pictures' }));
    expect(mocks.openDirectory).toHaveBeenCalledWith('/home/user/Pictures');

    fireEvent.change(screen.getByPlaceholderText('Search files by meaning...'), {
      target: { value: 'holiday near a beach' },
    });
    expect(mocks.setSearchQuery).toHaveBeenCalledWith('holiday near a beach');

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(mocks.submitSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Filter semantic search' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Images' }));
    expect(mocks.setSearchKind).toHaveBeenCalledWith('image');

    fireEvent.click(screen.getByRole('button', { name: 'Filter semantic search' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Videos' }));
    expect(mocks.setSearchKind).toHaveBeenCalledWith('video');

    fireEvent.click(screen.getByRole('button', { name: 'Sort files' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Size' }));
    expect(mocks.setSortField).toHaveBeenCalledWith('size');

    fireEvent.click(screen.getByRole('button', { name: 'Sort files' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Modified date' }));
    expect(mocks.setSortField).toHaveBeenCalledWith('modified');

    fireEvent.click(screen.getByRole('button', { name: 'Sort files' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'File type' }));
    expect(mocks.setSortField).toHaveBeenCalledWith('type');

    fireEvent.click(screen.getByRole('button', { name: 'Concepts' }));
    expect(mocks.submitConceptSearch).toHaveBeenCalledTimes(1);
  });

  it('opens file actions from a right-click context menu', () => {
    render(<FilePanel />);

    const tile = screen.getByRole('button', { name: 'Select file beach.png' });
    fireEvent.contextMenu(tile, { clientX: 180, clientY: 140 });

    expect(screen.getByRole('menu', { name: 'File actions for beach.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy location' }));
    expect(mocks.copyFileLocation).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/user/beach.png' }),
    );
  });

  it('shows the sliding-window indexing estimate beside progress', () => {
    hookState.semanticStatus = {
      ...(hookState.semanticStatus as Record<string, unknown>),
      indexStatus: 'building',
      stage: 'Embedding text files',
      completed: 44032,
      total: 89266,
      estimatedRemainingMs: 300000,
    };

    render(<FilePanel />);

    expect(screen.getByText('44032 of 89266')).toBeInTheDocument();
    expect(screen.getByText('EST: 5 min')).toBeInTheDocument();
  });

  it('asks for confirmation before starting the expensive initial scan', () => {
    hookState.scanConfirmationOpen = true;
    render(<FilePanel />);

    expect(screen.getByText('Scan your files?')).toBeInTheDocument();
    expect(screen.getByText(/IRIS found 3 eligible files/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    expect(mocks.startInitialScan).toHaveBeenCalledTimes(1);
  });

  it('shows a stronger warning before an unusually large scan', () => {
    hookState.scanConfirmationOpen = true;
    hookState.scanPreflight = {
      rootPath: '/home/user',
      sources: [],
      nodeCount: 1_200_100,
      directoryCount: 100,
      fileCount: 1_200_000,
      skippedCount: 50_000,
      warningThreshold: 1_000_000,
      requiresConfirmation: true,
      scannedAt: 1,
    };
    render(<FilePanel />);

    expect(screen.getByText(/1,200,000 eligible files/i)).toBeInTheDocument();
    expect(screen.getByText(/significant disk space/i)).toBeInTheDocument();
  });

  it('opens the index locations control and renders locked source details', () => {
    hookState.locationsOpen = true;
    hookState.locationsLocked = true;
    hookState.selectedSourceIds = ['home', 'uuid:projects'];
    hookState.indexSources = [
      {
        id: 'home',
        label: 'Home',
        path: '/home/user',
        kind: 'home',
        filesystem: 'ext4',
        device: '/dev/nvme0n1p2',
        size: 0,
        removable: false,
        network: false,
        readOnly: false,
        available: true,
        alwaysSelected: true,
        selectedByDefault: true,
      },
      {
        id: 'uuid:projects',
        label: 'Projects',
        path: '/mnt/projects',
        kind: 'internal',
        filesystem: 'btrfs',
        device: '/dev/sdb1',
        size: 2_000_000_000_000,
        removable: false,
        network: false,
        readOnly: false,
        available: true,
        alwaysSelected: false,
        selectedByDefault: true,
      },
    ];

    render(<FilePanel />);

    expect(screen.getByText('Indexed locations')).toBeInTheDocument();
    expect(screen.getByText('/mnt/projects')).toBeInTheDocument();
    expect(screen.getByText(/locked to the current index/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Delete file index/i }));
    expect(mocks.clearIndex).toHaveBeenCalledTimes(1);
  });

  it('renders concept groups in the main pane', () => {
    hookState.resultMode = 'concepts';
    hookState.conceptGroups = [
      {
        id: 'concept_1',
        title: 'Beach Holidays',
        results: [
          {
            name: 'beach.png',
            path: '/home/user/beach.png',
            type: 'file',
            size: 20,
            modifiedAt: 2,
            extension: '.png',
            isImage: true,
            isVideo: false,
            score: 0.91,
          },
        ],
      },
    ];
    render(<FilePanel />);

    expect(screen.getByText('Beach Holidays')).toBeInTheDocument();
  });

  it('renders Markdown AI analysis for selected images', () => {
    hookState.selectedFile = {
      name: 'beach.png',
      path: '/home/user/beach.png',
      type: 'file',
      size: 20,
      modifiedAt: 2,
      extension: '.png',
      isImage: true,
      isVideo: false,
      isBinary: true,
    };
    hookState.imagePreview = 'data:image/png;base64,aW1hZ2U=';
    hookState.aiAnalysis = '## Image analysis\n\nA beach holiday.';
    hookState.semanticStatus = {
      ...(hookState.semanticStatus as Record<string, unknown>),
      indexStatus: 'ready',
    };

    render(<FilePanel />);

    expect(screen.getByTestId('markdown-analysis')).toHaveTextContent('Image analysis');
    expect(screen.getByRole('button', { name: /AI Analyze/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Similar' }));
    expect(mocks.showSimilarFiles).toHaveBeenCalledTimes(1);
  });

  it('previews videos and returns to the previous file grid', () => {
    hookState.selectedFile = {
      name: 'clip.mp4',
      path: '/home/user/clip.mp4',
      type: 'file',
      size: 200,
      modifiedAt: 3,
      extension: '.mp4',
      isImage: false,
      isVideo: true,
      isBinary: true,
      semanticType: 'video',
      timestampMs: 15_000,
    };
    hookState.videoPreview = 'http://127.0.0.1:3210/api/local/fs/media?path=clip.mp4';

    render(<FilePanel />);

    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/local/fs/media'),
    );
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: 30, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'Back to folder' }));
    expect(mocks.closePreview).toHaveBeenCalledTimes(1);
  });
});
