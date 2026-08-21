/**
 * Owns the graphical file browser, semantic index controls, search, selection, and editing
 * state for the Files panel. Privileged filesystem work remains behind the desktop bridge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrbSettings, useOrbShell } from '@/platform-context/AgentSettingsContext';
import {
  analyzeFileWithAI,
  browseDirectory,
  cancelFileSemanticIndex,
  clearFileSemanticIndex,
  findSimilarFiles,
  getFileIndexSources,
  getFileMediaUrl,
  getFileSemanticStatus,
  getFileThumbnail,
  installFileSemanticModels,
  listDirectory,
  openFileWithSystem,
  preflightFileSemanticIndex,
  readTextFile,
  rebuildFileSemanticIndex,
  revealFileInFolder,
  rescanFileSemanticIndex,
  searchFileSemanticConcepts,
  searchFileSemanticIndex,
  writeTextFile,
} from '@/platform/desktopBridge';
import type {
  BridgeFileBrowserEntry,
  BridgeFileIndexSource,
  BridgeFileNode,
  BridgeFileSemanticPreflight,
  BridgeFileSemanticResult,
  BridgeFileSemanticSearchKind,
  BridgeFileSemanticStatus,
} from '@/platform/desktopBridge';

export type FileSortField = 'name' | 'size' | 'modified' | 'type' | 'relevance';
export type FileSortDirection = 'asc' | 'desc';
export type FileResultMode = 'browse' | 'search' | 'similar' | 'concepts';
export type FileSearchKind = BridgeFileSemanticSearchKind;
export type FileTreeNode = BridgeFileNode;

export interface FileDisplayEntry extends BridgeFileBrowserEntry {
  summary?: string;
  score?: number;
  semanticType?: 'text' | 'image' | 'video';
  timestampMs?: number;
}

export interface SelectedFile extends FileDisplayEntry {
  isBinary: boolean;
}

export interface FileConceptGroup {
  id: string;
  title: string;
  results: FileDisplayEntry[];
}

const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.ogv', '.webm']);

function extensionForName(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index).toLowerCase() : '';
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy renderer copy path.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

function semanticResultEntry(result: BridgeFileSemanticResult): FileDisplayEntry {
  const extension = extensionForName(result.name);
  return {
    name: result.name,
    path: result.path,
    type: 'file',
    size: result.size,
    modifiedAt: result.modifiedAt,
    extension,
    isImage: result.semanticType === 'image',
    isVideo: result.semanticType === 'video' || VIDEO_EXTENSIONS.has(extension),
    semanticType: result.semanticType,
    timestampMs: result.timestampMs,
    summary: result.summary,
    score: result.score,
  };
}

function compareEntries(
  left: FileDisplayEntry,
  right: FileDisplayEntry,
  sortField: FileSortField,
  direction: FileSortDirection,
  searchMode: boolean,
): number {
  if (!searchMode && left.type !== right.type) return left.type === 'directory' ? -1 : 1;
  let comparison = 0;
  if (sortField === 'size') comparison = left.size - right.size;
  else if (sortField === 'modified') comparison = left.modifiedAt - right.modifiedAt;
  else if (sortField === 'type') {
    comparison = left.extension.localeCompare(right.extension, undefined, {
      sensitivity: 'base',
    });
    if (!comparison) {
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
      });
    }
  } else if (sortField === 'relevance') comparison = (left.score || 0) - (right.score || 0);
  else
    comparison = left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    });
  if (!comparison)
    comparison = left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    });
  return direction === 'asc' ? comparison : -comparison;
}

/** Owns the complete user-facing file-manager workflow. */
export function useFilePanel() {
  const { settings } = useOrbSettings();
  const { setOrbState } = useOrbShell();
  const [currentPath, setCurrentPath] = useState('~');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [treeError, setTreeError] = useState('');
  const [isTreeLoading, setIsTreeLoading] = useState(false);
  const [directoryEntries, setDirectoryEntries] = useState<FileDisplayEntry[]>([]);
  const [directoryTruncated, setDirectoryTruncated] = useState(false);
  const [browserError, setBrowserError] = useState('');
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [content, setContentState] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [videoPreview, setVideoPreview] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchKind, setSearchKind] = useState<FileSearchKind>('all');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileDisplayEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [conceptGroups, setConceptGroups] = useState<FileConceptGroup[]>([]);
  const [isGrouping, setIsGrouping] = useState(false);
  const [conceptError, setConceptError] = useState('');
  const [resultMode, setResultMode] = useState<FileResultMode>('browse');
  const [similarSourceName, setSimilarSourceName] = useState('');
  const [sortField, setSortField] = useState<FileSortField>('name');
  const [sortDirection, setSortDirection] = useState<FileSortDirection>('asc');
  const [semanticStatus, setSemanticStatus] = useState<BridgeFileSemanticStatus | null>(null);
  const [indexError, setIndexError] = useState('');
  const [indexAction, setIndexAction] = useState<
    'preflighting' | 'installing' | 'starting' | 'refreshing' | ''
  >('');
  const [scanConfirmationOpen, setScanConfirmationOpen] = useState(false);
  const [scanPreflight, setScanPreflight] = useState<BridgeFileSemanticPreflight | null>(null);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [indexSources, setIndexSources] = useState<BridgeFileIndexSource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [locationsLocked, setLocationsLocked] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState('');
  const [clearIndexBusy, setClearIndexBusy] = useState(false);
  const [fileActionMessage, setFileActionMessage] = useState('');
  const fileActionTimerRef = useRef<number | null>(null);
  const semanticStatusRef = useRef<BridgeFileSemanticStatus | null>(null);

  const searchMode = resultMode === 'search' || resultMode === 'similar';
  const isDirty = Boolean(selectedFile && !selectedFile.isBinary && content !== originalContent);

  const showFileActionMessage = useCallback((message: string) => {
    if (fileActionTimerRef.current !== null) {
      window.clearTimeout(fileActionTimerRef.current);
    }
    setFileActionMessage(message);
    fileActionTimerRef.current = window.setTimeout(() => {
      setFileActionMessage('');
      fileActionTimerRef.current = null;
    }, 2500);
  }, []);

  useEffect(
    () => () => {
      if (fileActionTimerRef.current !== null) {
        window.clearTimeout(fileActionTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    semanticStatusRef.current = semanticStatus;
  }, [semanticStatus]);

  const visibleEntries = useMemo(() => {
    const entries = searchMode ? searchResults : directoryEntries;
    return [...entries].sort((left, right) =>
      compareEntries(left, right, sortField, sortDirection, searchMode),
    );
  }, [directoryEntries, searchMode, searchResults, sortDirection, sortField]);

  const refreshSemanticStatus = useCallback(
    async (preserveExistingError = false) => {
      if (!settings.permissions_file_read) {
        setSemanticStatus(null);
        return null;
      }
      try {
        const status = await getFileSemanticStatus(false);
        setSemanticStatus(status);
        const sources = Array.isArray(status.sources) ? status.sources : [];
        if (sources.length) {
          setIndexSources(sources);
          setSelectedSourceIds(sources.map((source) => source.id));
        }
        setLocationsLocked(status.indexStatus === 'ready' || status.indexStatus === 'building');
        if (status.indexStatus === 'error') {
          setIndexError(status.error || 'Semantic indexing failed');
        } else if (!preserveExistingError) {
          setIndexError('');
        }
        return status;
      } catch (error) {
        setIndexError((error as { message?: string }).message || 'Failed to read index status');
        return null;
      }
    },
    [settings.permissions_file_read],
  );

  const refreshTree = useCallback(
    async (permissionGranted = false) => {
      if (!settings.permissions_file_read && !permissionGranted) {
        setTree(null);
        setTreeError('');
        return;
      }
      setIsTreeLoading(true);
      setTreeError('');
      try {
        const result = await listDirectory('~', 4);
        setTree(result.tree);
      } catch (error) {
        setTree(null);
        setTreeError((error as { message?: string }).message || 'Failed to load directory tree');
      } finally {
        setIsTreeLoading(false);
      }
    },
    [settings.permissions_file_read],
  );

  const loadDirectory = useCallback(
    async (path: string, permissionGranted = false) => {
      if (!settings.permissions_file_read && !permissionGranted) {
        setDirectoryEntries([]);
        setBrowserError('');
        return;
      }
      setIsDirectoryLoading(true);
      setBrowserError('');
      try {
        const directory = await browseDirectory(path || '~', true);
        setCurrentPath(directory.currentPath);
        setParentPath(directory.parentPath);
        setDirectoryEntries(directory.entries);
        setDirectoryTruncated(directory.truncated);
        setSelectedFile(null);
        setContentState('');
        setOriginalContent('');
        setImagePreview('');
        setVideoPreview('');
        setAiAnalysis('');
        setAnalysisError('');
        setSaveError('');
        setSaved(false);
        setFileActionMessage('');
        setActiveSearchQuery('');
        setSearchResults([]);
        setSearchError('');
        setConceptGroups([]);
        setConceptError('');
        setResultMode('browse');
        setSimilarSourceName('');
        setSortField('name');
        setSortDirection('asc');
      } catch (error) {
        setBrowserError((error as { message?: string }).message || 'Failed to open directory');
      } finally {
        setIsDirectoryLoading(false);
      }
    },
    [settings.permissions_file_read],
  );

  useEffect(() => {
    void loadDirectory('~');
    void refreshTree();
    void refreshSemanticStatus();
  }, [loadDirectory, refreshSemanticStatus, refreshTree]);

  useEffect(() => {
    if (!semanticStatus || (semanticStatus.indexStatus !== 'building' && !indexAction)) return;
    const timer = window.setInterval(() => void refreshSemanticStatus(), 250);
    return () => window.clearInterval(timer);
  }, [indexAction, refreshSemanticStatus, semanticStatus]);

  const selectFile = async (file: FileDisplayEntry) => {
    if (file.type === 'directory') {
      await loadDirectory(file.path);
      return;
    }
    if (!settings.permissions_file_read) {
      setBrowserError('Enable File System Read permission to open files.');
      return;
    }

    setIsFileLoading(true);
    setBrowserError('');
    setSaveError('');
    setSaved(false);
    setAiAnalysis('');
    setAnalysisError('');
    setImagePreview('');
    setVideoPreview('');

    try {
      if (file.isImage) {
        const preview = await getFileThumbnail(file.path, 1200, 1200, true);
        setSelectedFile({ ...file, isBinary: true });
        setContentState('');
        setOriginalContent('');
        setImagePreview(preview.dataUrl);
      } else if (file.isVideo) {
        setSelectedFile({ ...file, isBinary: true });
        setContentState('');
        setOriginalContent('');
        setVideoPreview(getFileMediaUrl(file.path, true));
      } else {
        const result = await readTextFile(file.path, { fileManager: true });
        const nextContent = result.isBinary
          ? '[Binary file preview is unavailable.]'
          : result.content;
        setSelectedFile({
          ...file,
          path: result.path,
          isBinary: result.isBinary,
        });
        setContentState(nextContent);
        setOriginalContent(nextContent);
      }
    } catch (error) {
      setBrowserError((error as { message?: string }).message || 'Failed to open file');
    } finally {
      setIsFileLoading(false);
    }
  };

  const openSelectedWithSystem = async (file: FileDisplayEntry) => {
    if (file.type === 'directory') {
      await loadDirectory(file.path);
      return;
    }
    try {
      await openFileWithSystem(file.path, true);
      setBrowserError('');
    } catch (error) {
      setBrowserError((error as { message?: string }).message || 'Failed to open file');
    }
  };

  const copyFileContents = async (file: FileDisplayEntry) => {
    if (file.type !== 'file') return;
    setBrowserError('');
    setFileActionMessage('');
    try {
      const result = await readTextFile(file.path, { fileManager: true });
      if (result.isBinary) {
        setBrowserError('Only text-based file contents can be copied.');
        return;
      }
      if (!(await copyTextToClipboard(result.content))) {
        setBrowserError('The file contents could not be copied.');
        return;
      }
      showFileActionMessage(`Copied contents of ${file.name}`);
    } catch (error) {
      setBrowserError(
        (error as { message?: string }).message || 'Failed to copy the file contents',
      );
    }
  };

  const copyFileLocation = async (file: FileDisplayEntry) => {
    setBrowserError('');
    setFileActionMessage('');
    if (!(await copyTextToClipboard(file.path))) {
      setBrowserError('The file location could not be copied.');
      return;
    }
    showFileActionMessage('Copied file location');
  };

  const openFileLocation = async (file: FileDisplayEntry) => {
    setBrowserError('');
    setFileActionMessage('');
    try {
      await revealFileInFolder(file.path, true);
      showFileActionMessage('Opened file location');
    } catch (error) {
      setBrowserError(
        (error as { message?: string }).message || 'Failed to open the file location',
      );
    }
  };

  const setContent = (value: string) => {
    setContentState(value);
    setSaved(false);
    setSaveError('');
  };

  const closePreview = () => {
    setSelectedFile(null);
    setContentState('');
    setOriginalContent('');
    setImagePreview('');
    setVideoPreview('');
    setAiAnalysis('');
    setAnalysisError('');
    setSaveError('');
    setSaved(false);
  };

  const saveFile = async (permissionGranted = false) => {
    if (!selectedFile || selectedFile.isBinary) return;
    if (!settings.permissions_file_write && !permissionGranted) return;
    setIsSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const result = await writeTextFile(selectedFile.path, content, {
        fileManager: true,
      });
      const modifiedAt = Number(result.modifiedAt) || selectedFile.modifiedAt;
      setSelectedFile({ ...selectedFile, modifiedAt });
      setOriginalContent(content);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError((error as { message?: string }).message || 'Failed to save file');
    } finally {
      setIsSaving(false);
    }
  };

  const analyzeFile = async () => {
    if (!selectedFile || (selectedFile.isBinary && !selectedFile.isImage)) return;
    setIsAnalyzing(true);
    setAnalysisError('');
    setAiAnalysis('');
    setOrbState('processing');
    try {
      const result = await analyzeFileWithAI(selectedFile.path, true);
      setAiAnalysis(result.markdown);
    } catch (error) {
      setAnalysisError((error as { message?: string }).message || 'AI analysis failed');
    } finally {
      setIsAnalyzing(false);
      setOrbState('idle');
    }
  };

  const refreshDirectory = (permissionGranted = false) =>
    loadDirectory(currentPath, permissionGranted);
  const goToParent = () => parentPath && void loadDirectory(parentPath);

  const submitSearch = async () => {
    const query = searchQuery.trim();
    if (!query) {
      setActiveSearchQuery('');
      setSearchResults([]);
      setSearchError('');
      setConceptGroups([]);
      setConceptError('');
      setResultMode('browse');
      setSimilarSourceName('');
      setSortField('name');
      setSortDirection('asc');
      return;
    }
    if (semanticStatus?.indexStatus !== 'ready') {
      setSearchError('Create the semantic file index before searching by meaning.');
      return;
    }
    setIsSearching(true);
    setSearchError('');
    setOrbState('processing');
    try {
      const results = await searchFileSemanticIndex(query, 100, searchKind);
      setSearchResults(results.map(semanticResultEntry));
      setActiveSearchQuery(query);
      setConceptGroups([]);
      setConceptError('');
      setResultMode('search');
      setSimilarSourceName('');
      setSelectedFile(null);
      setImagePreview('');
      setVideoPreview('');
      setAiAnalysis('');
      setSortField('relevance');
      setSortDirection('desc');
    } catch (error) {
      setSearchError((error as { message?: string }).message || 'Semantic search failed');
    } finally {
      setIsSearching(false);
      setOrbState('idle');
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveSearchQuery('');
    setSearchResults([]);
    setSearchError('');
    setConceptGroups([]);
    setConceptError('');
    setResultMode('browse');
    setSimilarSourceName('');
    setSelectedFile(null);
    setImagePreview('');
    setVideoPreview('');
    setAiAnalysis('');
    setSortField('name');
    setSortDirection('asc');
  };

  const submitConceptSearch = async () => {
    const query = searchQuery.trim();
    if (!query) {
      setConceptError('Enter an idea before opening the concept view.');
      return;
    }
    if (semanticStatus?.indexStatus !== 'ready') {
      setConceptError('Create the semantic file index before grouping files by concept.');
      return;
    }
    setIsGrouping(true);
    setConceptError('');
    setSearchError('');
    setOrbState('processing');
    try {
      const groups = await searchFileSemanticConcepts(query, 6, 12);
      setConceptGroups(
        groups.map((group) => ({
          ...group,
          results: group.results.map(semanticResultEntry),
        })),
      );
      setSearchResults([]);
      setActiveSearchQuery(query);
      setResultMode('concepts');
      setSimilarSourceName('');
      setSelectedFile(null);
      setImagePreview('');
      setVideoPreview('');
      setAiAnalysis('');
      setSortField('relevance');
      setSortDirection('desc');
    } catch (error) {
      setConceptError((error as { message?: string }).message || 'Concept grouping failed');
    } finally {
      setIsGrouping(false);
      setOrbState('idle');
    }
  };

  const showSimilarFiles = async () => {
    if (!selectedFile) return;
    const sourceFile = selectedFile;
    if (semanticStatus?.indexStatus !== 'ready') {
      setSearchError('Create the semantic file index before finding similar files.');
      return;
    }
    setIsSearching(true);
    setSearchError('');
    setConceptError('');
    setOrbState('processing');
    try {
      const results = await findSimilarFiles(sourceFile.path, 100);
      setSearchResults(results.map(semanticResultEntry));
      setConceptGroups([]);
      setActiveSearchQuery('');
      setResultMode('similar');
      setSimilarSourceName(sourceFile.name);
      setSelectedFile(null);
      setImagePreview('');
      setVideoPreview('');
      setAiAnalysis('');
      setSortField('relevance');
      setSortDirection('desc');
    } catch (error) {
      setSearchError((error as { message?: string }).message || 'Finding similar files failed');
    } finally {
      setIsSearching(false);
      setOrbState('idle');
    }
  };

  const refreshIndexSources = useCallback(async () => {
    if (!settings.permissions_file_read) return null;
    setLocationsLoading(true);
    setLocationsError('');
    try {
      const state = await getFileIndexSources();
      const activeStatus = semanticStatusRef.current;
      const buildingSources =
        activeStatus?.indexStatus === 'building' && Array.isArray(activeStatus.sources)
          ? activeStatus.sources
          : [];
      setIndexSources(buildingSources.length ? buildingSources : state.sources);
      setSelectedSourceIds(
        buildingSources.length
          ? buildingSources.map((source) => source.id)
          : state.selectedSourceIds,
      );
      setLocationsLocked(state.locked || activeStatus?.indexStatus === 'building');
      return state;
    } catch (error) {
      setLocationsError(
        (error as { message?: string }).message || 'Failed to discover index locations',
      );
      return null;
    } finally {
      setLocationsLoading(false);
    }
  }, [settings.permissions_file_read]);

  const openLocations = async () => {
    setLocationsOpen(true);
    await refreshIndexSources();
  };

  useEffect(() => {
    if (settings.permissions_file_read) void refreshIndexSources();
  }, [refreshIndexSources, settings.permissions_file_read]);

  const toggleIndexSource = (sourceId: string) => {
    if (locationsLocked) return;
    const source = indexSources.find((item) => item.id === sourceId);
    if (!source || source.alwaysSelected) return;
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    );
  };

  const clearIndex = async () => {
    setClearIndexBusy(true);
    setIndexError('');
    try {
      const status = await clearFileSemanticIndex();
      setSemanticStatus(status);
      setScanPreflight(null);
      setSearchResults([]);
      setConceptGroups([]);
      setResultMode('browse');
      await refreshIndexSources();
    } catch (error) {
      setIndexError((error as { message?: string }).message || 'Failed to delete file index');
    } finally {
      setClearIndexBusy(false);
    }
  };

  const prepareInitialScan = async () => {
    setIndexError('');
    setIndexAction('preflighting');
    try {
      let sourceIds = selectedSourceIds;
      if (!sourceIds.length) {
        const state = await refreshIndexSources();
        sourceIds = state?.selectedSourceIds || [];
      }
      const preflight = await preflightFileSemanticIndex(sourceIds);
      setScanPreflight(preflight);
      setScanConfirmationOpen(true);
    } catch (error) {
      setIndexError((error as { message?: string }).message || 'Failed to inspect the filesystem');
    } finally {
      setIndexAction('');
    }
  };

  const startInitialScan = async () => {
    setScanConfirmationOpen(false);
    setIndexError('');
    setIndexAction(
      semanticStatus?.embeddingModelInstalled && semanticStatus?.imageModelInstalled
        ? 'starting'
        : 'installing',
    );
    try {
      if (!semanticStatus?.embeddingModelInstalled || !semanticStatus?.imageModelInstalled) {
        const installedStatus = await installFileSemanticModels();
        setSemanticStatus(installedStatus);
      }
      const status = await rebuildFileSemanticIndex(
        Boolean(scanPreflight?.requiresConfirmation),
        scanPreflight?.sources?.map((source) => source.id) || selectedSourceIds,
      );
      setSemanticStatus(status);
    } catch (error) {
      setIndexError((error as { message?: string }).message || 'Failed to start indexing');
    } finally {
      setIndexAction('');
      await refreshSemanticStatus(true);
    }
  };

  const refreshIndex = async () => {
    setIndexError('');
    setIndexAction('refreshing');
    try {
      const status = await rescanFileSemanticIndex();
      setSemanticStatus(status);
    } catch (error) {
      setIndexError((error as { message?: string }).message || 'Failed to refresh index');
    } finally {
      setIndexAction('');
      void refreshSemanticStatus();
    }
  };

  const cancelIndex = async () => {
    setIndexError('');
    try {
      const status = await cancelFileSemanticIndex();
      setSemanticStatus(status);
    } catch (error) {
      setIndexError((error as { message?: string }).message || 'Failed to cancel indexing');
    }
  };

  return {
    settings,
    currentPath,
    parentPath,
    tree,
    treeError,
    isTreeLoading,
    visibleEntries,
    directoryTruncated,
    browserError,
    isDirectoryLoading,
    selectedFile,
    content,
    setContent,
    imagePreview,
    videoPreview,
    aiAnalysis,
    analysisError,
    isAnalyzing,
    isFileLoading,
    isSaving,
    saved,
    saveError,
    isDirty,
    searchQuery,
    setSearchQuery,
    searchKind,
    setSearchKind,
    activeSearchQuery,
    isSearching,
    searchError,
    conceptGroups,
    isGrouping,
    conceptError,
    resultMode,
    similarSourceName,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    semanticStatus,
    indexError,
    indexAction,
    scanConfirmationOpen,
    setScanConfirmationOpen,
    scanPreflight,
    locationsOpen,
    setLocationsOpen,
    indexSources,
    selectedSourceIds,
    locationsLocked,
    locationsLoading,
    locationsError,
    clearIndexBusy,
    fileActionMessage,
    selectFile,
    closePreview,
    openDirectory: loadDirectory,
    openSelectedWithSystem,
    copyFileContents,
    copyFileLocation,
    openFileLocation,
    saveFile,
    analyzeFile,
    refreshDirectory,
    refreshTree,
    goToParent,
    submitSearch,
    submitConceptSearch,
    showSimilarFiles,
    clearSearch,
    openLocations,
    toggleIndexSource,
    clearIndex,
    refreshIndexSources,
    prepareInitialScan,
    startInitialScan,
    refreshIndex,
    cancelIndex,
    refreshSemanticStatus,
  };
}
