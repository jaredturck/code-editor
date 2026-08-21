/**
 * Resolves the Electron-owned loopback bridge used by both desktop development and packaged
 * builds. Vite serves renderer assets only; it never owns persistence or privileged routes.
 */

import type { SystemProcess, SystemStats } from '@/platform-features/systemMonitor/useSystemMonitor';

export type BridgeRecord = Record<string, unknown>;
export type BridgeRequestBody = unknown;
export type BridgeOptions = Record<string, unknown>;

export interface BridgeWebResearchProgressEvent extends BridgeRecord {
  sequence: number;
  timestamp: number;
  type: string;
  message: string;
  current?: number;
  total?: number;
  source?: BridgeRecord;
}

export interface BridgeWebSearchHistoryItem extends BridgeRecord {
  id: string;
  query: string;
  title: string;
  quickStatus: string;
  detailedStatus: string;
  createdAt: number;
  updatedAt: number;
}

export interface BridgeFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'dir';
  children?: BridgeFileNode[];
  [key: string]: unknown;
}

export interface BridgeFileBrowserEntry extends BridgeRecord {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  extension: string;
  isImage: boolean;
  isVideo: boolean;
}

export interface BridgeFileBrowserDirectory extends BridgeRecord {
  currentPath: string;
  parentPath: string | null;
  entries: BridgeFileBrowserEntry[];
  truncated: boolean;
}

export interface BridgeFileThumbnail extends BridgeRecord {
  dataUrl: string;
  width: number;
  height: number;
  modifiedAt: number;
}

export interface BridgeSkillDefinition extends Record<string, unknown> {
  id: string;
  title?: string;
  summary?: string;
  triggers?: string[];
  instructions?: string;
  examples?: string[];
  enabled?: boolean;
  priority?: number;
  provenance?: Record<string, unknown> | null;
}

export interface BridgeChatMessage extends Record<string, unknown> {
  role: string;
  content: string;
  // Presentation metadata (run timeline, model attribution, notice, artifacts) persisted so
  // previous timelines can be restored. Bounded by the caller before being sent.
  meta?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
}

export interface BridgeAIProxyRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  provider?: string;
}

export interface BridgeAIProxyResponse extends BridgeRecord {
  ok?: boolean;
  status?: number;
  statusText?: string;
  data?: unknown;
  text?: string;
}

export interface BridgeArtifact extends BridgeRecord {
  filename?: string;
  path?: string;
  content?: string;
  summary?: string;
  type?: string;
  chatId?: string;
  createdAt?: number;
}

export interface BridgeLaunchRequest extends BridgeRecord {
  command?: string;
  executable?: string;
  args?: string[];
  category?: string;
  cwd?: string;
  approvalId?: string;
}

export interface BridgeLaunchResult extends BridgeRecord {
  command?: string;
  message?: string;
  approvalRequired?: boolean;
  approvalId?: string;
  reason?: string;
  cwd?: string;
}

export type LauncherApplicationCapability =
  | 'file_manager'
  | 'terminal'
  | 'web_browser'
  | 'code_editor'
  | 'system_settings'
  | 'calculator'
  | 'text_editor'
  | 'system_monitor'
  | 'email_client'
  | 'software_center'
  | 'password_manager';

export type LauncherToolCapability =
  | 'package_manager'
  | 'privilege_helper'
  | 'docker'
  | 'docker_desktop'
  | 'podman'
  | 'podman_desktop'
  | 'git'
  | 'shell';

export interface BridgeLauncherCapability extends BridgeRecord {
  capability: LauncherApplicationCapability | LauncherToolCapability;
  displayName: string;
  executable: string;
  args: string[];
  source: string;
  desktopEntry?: string;
  discoveredAt: number;
}

export interface BridgeLauncherDiscovery extends BridgeRecord {
  desktop: string;
  applications: BridgeLauncherCapability[];
  tools: BridgeLauncherCapability[];
}

export interface BridgeDevEnvironmentStatus extends BridgeRecord {
  configured: boolean;
  available: boolean;
  running: boolean;
  pid?: number;
  cwd?: string;
  projectName?: string;
  executable?: string;
  args?: string[];
  command?: string;
  startedAt?: number;
  reason?: string;
}

export interface BridgeClearDataResult extends BridgeLaunchResult {
  cleared?: boolean;
  reloadRequired?: boolean;
}

export type BridgeLauncherSemanticIndexStatus = 'missing' | 'building' | 'ready' | 'error';

export interface BridgeLauncherSemanticStatus extends BridgeRecord {
  ollamaAvailable: boolean;
  modelInstalled: boolean;
  model: string;
  indexStatus: BridgeLauncherSemanticIndexStatus;
  applicationCount: number;
  generatedAt?: number;
  stage?: string;
  completed?: number;
  total?: number;
  error?: string;
}

export interface BridgeLauncherSemanticApplication extends BridgeRecord {
  id: string;
  name: string;
  genericName: string;
  description: string;
  keywords: string[];
  categories: string[];
  executable: string;
  args: string[];
  icon: string;
  terminal: boolean;
  source: string;
  sourceId: string;
  searchOnly: boolean;
  metadataFingerprint: string;
  metadataText: string;
  score: number;
}

export type BridgeFileIndexSourceKind = 'home' | 'internal' | 'removable' | 'network';

export interface BridgeFileIndexSource extends BridgeRecord {
  id: string;
  label: string;
  path: string;
  kind: BridgeFileIndexSourceKind;
  filesystem: string;
  device: string;
  size: number;
  uuid: string;
  removable: boolean;
  network: boolean;
  readOnly: boolean;
  available: boolean;
  alwaysSelected: boolean;
  selectedByDefault: boolean;
}

export interface BridgeFileIndexSourceState extends BridgeRecord {
  sources: BridgeFileIndexSource[];
  selectedSourceIds: string[];
  locked: boolean;
}

export type BridgeFileSemanticIndexStatus =
  | 'missing'
  | 'building'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface BridgeFileSemanticStatus extends BridgeRecord {
  sources: BridgeFileIndexSource[];
  ollamaAvailable: boolean;
  imageModelInstalled: boolean;
  embeddingModelInstalled: boolean;
  imageModel: string;
  embeddingModel: string;
  embeddingBatchSize?: number;
  indexStatus: BridgeFileSemanticIndexStatus;
  nodeCount: number;
  fileCount: number;
  semanticCount: number;
  conceptCount?: number;
  skippedCount: number;
  failedCount: number;
  generatedAt?: number;
  stage?: string;
  completed?: number;
  total?: number;
  estimatedRemainingMs?: number;
  stageProcessed?: number;
  stageIndexed?: number;
  stageFileTotal?: number;
  stageWorkerCount?: number;
  error?: string;
}

export interface BridgeFileSemanticPreflight extends BridgeRecord {
  rootPath: string;
  sources: Array<
    BridgeFileIndexSource & {
      nodeCount: number;
      directoryCount: number;
      fileCount: number;
      skippedCount: number;
    }
  >;
  nodeCount: number;
  directoryCount: number;
  fileCount: number;
  skippedCount: number;
  warningThreshold: number;
  requiresConfirmation: boolean;
  scannedAt: number;
}

export interface BridgeFileSemanticResult extends BridgeRecord {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  nodeType: 'file';
  size: number;
  modifiedAt: number;
  summary: string;
  semanticType: 'text' | 'image' | 'video';
  timestampMs?: number;
  score: number;
  rawScore?: number;
}

export type BridgeFileSemanticSearchKind = 'all' | 'text' | 'image' | 'video';

export interface BridgeFileSemanticConceptGroup extends BridgeRecord {
  id: string;
  title: string;
  results: BridgeFileSemanticResult[];
}

export interface BridgeFileAnalysis extends BridgeRecord {
  path: string;
  name: string;
  fileType: 'text' | 'image';
  markdown: string;
  model: string;
}

export interface BridgeAutomationCapabilities extends BridgeRecord {
  xdotoolAvailable?: boolean;
  hasDisplay?: boolean;
  canRun?: boolean;
  displayServer?: string;
  recommended?: string;
}

export interface BridgeAutomationResult extends BridgeRecord {
  executed?: number;
  attempted?: number;
  failedAction?: { index: number; type: string; error: string };
}

export interface BridgeLocalServer extends BridgeRecord {
  url: string;
  models?: string[];
}

export interface BridgeLocalModelPullStatus extends BridgeRecord {
  jobId: string;
  model: string;
  state: 'queued' | 'downloading' | 'verifying' | 'success' | 'error' | 'cancelled';
  status: string;
  completed: number;
  total: number;
  percent: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface BridgeNoteTranscriptionStatus extends BridgeRecord {
  ollamaAvailable: boolean;
  modelInstalled: boolean;
  model: string;
  modelDownloadBytes: number;
}

export interface BridgeScreenSource {
  id: string;
  name: string;
}

export interface BridgeRequestOptions {
  method?: string;
  body?: BridgeRequestBody;
  signal?: AbortSignal;
}

const PERSISTENCE_PATH_PREFIXES = [
  '/store/',
  '/chats/',
  '/artifacts/',
  '/subagent/',
  '/skills/',
  '/launcher/clear-data',
  '/web-history/',
];

function isPersistencePath(path: string): boolean {
  return PERSISTENCE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function notifyPersistentStorageFailure(path: string, error: unknown): void {
  if (!isPersistencePath(path) || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('iris:storage-fatal', {
      detail: {
        path,
        message:
          error instanceof Error ? error.message : String(error || 'Encrypted storage failed'),
      },
    }),
  );
}

export class LocalBridgeError extends Error {
  status: number;
  code?: string;
  retryAfterMs?: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LocalBridgeError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is BridgeRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getBridgeParam(name: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return new URLSearchParams(window.location.search).get(name) || '';
  } catch {
    return '';
  }
}

// Returns bridge base without requiring callers to know where or how it is stored.
function getBridgeBase(): string {
  if (typeof window === 'undefined') return '';
  const port = getBridgeParam('bridgePort');
  return /^\d+$/.test(port) ? `http://127.0.0.1:${port}` : '';
}

// Returns bridge token without requiring callers to know where or how it is stored.
function getBridgeToken(): string {
  if (typeof window === 'undefined') return '';
  return getBridgeParam('bridgeToken');
}

/** Build a fully-qualified bridge URL for a given /path. */
export function bridgeUrl(path: string): string {
  return `${getBridgeBase()}/api/local${path}`;
}

/** Build an authenticated loopback URL for media elements that cannot attach bridge headers. */
export function getFileMediaUrl(path: string, fileManager = false): string {
  const params = new URLSearchParams({ path });
  if (fileManager) params.set('scope', 'file-manager');
  const token = getBridgeToken();
  if (token) params.set('__token', token);
  return bridgeUrl(`/fs/media?${params.toString()}`);
}

/** Build a bridge URL for EventSource (token via query — SSE can't set headers). */
function bridgeStreamUrl(path: string): string {
  const base = bridgeUrl(path);
  const token = getBridgeToken();
  if (!token) return base;
  return `${base}${base.includes('?') ? '&' : '?'}__token=${encodeURIComponent(token)}`;
}

// Sends an authenticated request to the local bridge and normalizes bridge failures for renderer
// callers.
async function requestLocal<T = BridgeRecord>(
  path: string,
  { method = 'GET', body, signal }: BridgeRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getBridgeToken();
  if (token) headers['x-iris-bridge-token'] = token;

  let response: Response;
  try {
    response = await fetch(bridgeUrl(path), {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    notifyPersistentStorageFailure(path, error);
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = isRecord(data) ? data : {};
    const error = new LocalBridgeError(
      String(detail.error || `Local bridge error (${response.status})`),
      response.status,
    );
    if (detail.code) error.code = String(detail.code);
    if (Number.isFinite(Number(detail.retryAfterMs))) {
      error.retryAfterMs = Number(detail.retryAfterMs);
    }
    if (response.status >= 500) notifyPersistentStorageFailure(path, error);
    throw error;
  }

  return data as T;
}

// Sends bounded binary data to a fixed bridge route without converting it to base64 or JSON.
async function requestLocalBinary<T = BridgeRecord>(
  path: string,
  body: Blob,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': body.type || 'application/octet-stream',
    ...extraHeaders,
  };
  const token = getBridgeToken();
  if (token) headers['x-iris-bridge-token'] = token;

  let response: Response;
  try {
    response = await fetch(bridgeUrl(path), {
      method: 'POST',
      headers,
      body,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const bridgeError = new LocalBridgeError(
      'IRIS could not reach the local transcription service. The recording was not sent; restart the desktop app and try again.',
      0,
    );
    bridgeError.code = 'bridge_unreachable';
    throw bridgeError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = isRecord(data) ? data : {};
    const error = new LocalBridgeError(
      String(detail.error || `Local bridge error (${response.status})`),
      response.status,
    );
    if (detail.code) error.code = String(detail.code);
    throw error;
  }
  return data as T;
}

// Returns local bridge health without requiring callers to know where or how it is stored.
export async function getLocalBridgeHealth(): Promise<BridgeRecord> {
  return requestLocal('/health');
}

// Returns local session info without requiring callers to know where or how it is stored.
export async function getLocalSessionInfo(): Promise<BridgeRecord> {
  const data = await requestLocal<{ session?: BridgeRecord }>('/session');
  return data.session || {};
}

// Returns the available directory in the normalized form used by callers.
export async function listDirectory(
  path: string,
  depth = 3,
): Promise<{ rootPath: string; tree: BridgeFileNode }> {
  return requestLocal<{ rootPath: string; tree: BridgeFileNode }>('/fs/list', {
    method: 'POST',
    body: { path, depth },
  });
}

// Lists one directory for the graphical file browser without recursively walking descendants.
export async function browseDirectory(
  path: string,
  fileManager = false,
): Promise<BridgeFileBrowserDirectory> {
  return requestLocal<BridgeFileBrowserDirectory>('/fs/browse', {
    method: 'POST',
    body: { path, ...(fileManager ? { fileManager: true } : {}) },
  });
}

// Returns a bounded image preview generated inside the desktop bridge.
export async function getFileThumbnail(
  path: string,
  width = 240,
  height = 240,
  fileManager = false,
): Promise<BridgeFileThumbnail> {
  return requestLocal<BridgeFileThumbnail>('/fs/thumbnail', {
    method: 'POST',
    body: {
      path,
      width,
      height,
      ...(fileManager ? { fileManager: true } : {}),
    },
  });
}

// Opens a file through the operating system's associated application.
export async function openFileWithSystem(path: string, fileManager = false): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/fs/open', {
    method: 'POST',
    body: { path, ...(fileManager ? { fileManager: true } : {}) },
  });
}

// Reveals a file in the operating system's file manager.
export async function revealFileInFolder(path: string, fileManager = false): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/fs/reveal', {
    method: 'POST',
    body: { path, ...(fileManager ? { fileManager: true } : {}) },
  });
}

// Finds files without exposing the surrounding lookup details.
export async function findFiles(
  path: string,
  query: string,
  options: BridgeOptions = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/fs/find', {
    method: 'POST',
    body: {
      path,
      query,
      ...options,
    },
  });
}

// Counts eligible files without writing filesystem or semantic index records.
export async function getFileIndexSources(): Promise<BridgeFileIndexSourceState> {
  return requestLocal<BridgeFileIndexSourceState>('/fs/index/sources', {
    method: 'POST',
    body: {},
  });
}

export async function preflightFileSemanticIndex(
  selectedSourceIds: string[] = [],
): Promise<BridgeFileSemanticPreflight> {
  return requestLocal<BridgeFileSemanticPreflight>('/fs/index/preflight', {
    method: 'POST',
    body: selectedSourceIds.length ? { selectedSourceIds } : {},
  });
}

// Reads Ollama model and encrypted filesystem-index availability.
export async function getFileSemanticStatus(
  buildIfMissing = false,
): Promise<BridgeFileSemanticStatus> {
  return requestLocal<BridgeFileSemanticStatus>('/fs/index/status', {
    method: 'POST',
    body: { buildIfMissing },
  });
}

// Downloads the Ollama text model and local CLIP image model used by semantic file search.
export async function installFileSemanticModels(): Promise<BridgeFileSemanticStatus> {
  return requestLocal<BridgeFileSemanticStatus>('/fs/index/install', {
    method: 'POST',
    body: {},
  });
}

// Starts a complete background rebuild of the encrypted semantic filesystem index.
export async function rebuildFileSemanticIndex(
  confirmLargeScan = false,
  selectedSourceIds: string[] = [],
): Promise<BridgeFileSemanticStatus> {
  return requestLocal<BridgeFileSemanticStatus>('/fs/index/rebuild', {
    method: 'POST',
    body: {
      confirmLargeScan,
      ...(selectedSourceIds.length ? { selectedSourceIds } : {}),
    },
  });
}

// Starts a lightweight comparison and processes only new or changed files.
export async function rescanFileSemanticIndex(): Promise<BridgeFileSemanticStatus> {
  return requestLocal<BridgeFileSemanticStatus>('/fs/index/rescan', {
    method: 'POST',
    body: {},
  });
}

// Cancels the active filesystem-index operation.
export async function cancelFileSemanticIndex(): Promise<BridgeFileSemanticStatus> {
  return requestLocal<BridgeFileSemanticStatus>('/fs/index/cancel', {
    method: 'POST',
    body: {},
  });
}

export async function clearFileSemanticIndex(): Promise<BridgeFileSemanticStatus> {
  return requestLocal<BridgeFileSemanticStatus>('/fs/index/clear', {
    method: 'POST',
    body: {},
  });
}

// Embeds one query in the MiniLM and CLIP spaces and returns ranked files and images.
export async function searchFileSemanticIndex(
  query: string,
  limit = 50,
  kind: BridgeFileSemanticSearchKind = 'all',
): Promise<BridgeFileSemanticResult[]> {
  const response = await requestLocal<{ results?: BridgeFileSemanticResult[] }>(
    '/fs/semantic/search',
    {
      method: 'POST',
      body: {
        query,
        limit,
        ...(kind !== 'all' ? { kind } : {}),
      },
    },
  );
  return Array.isArray(response.results) ? response.results : [];
}

// Returns indexed files nearest to one selected file within its own embedding space.
export async function findSimilarFiles(
  path: string,
  limit = 50,
): Promise<BridgeFileSemanticResult[]> {
  const response = await requestLocal<{ results?: BridgeFileSemanticResult[] }>(
    '/fs/semantic/similar',
    {
      method: 'POST',
      body: { path, limit },
    },
  );
  return Array.isArray(response.results) ? response.results : [];
}

// Searches the persistent MiniLM and CLIP concept indexes for one query.
export async function searchFileSemanticConcepts(
  query: string,
  groupLimit = 6,
  filesPerGroup = 12,
): Promise<BridgeFileSemanticConceptGroup[]> {
  const response = await requestLocal<{
    groups?: BridgeFileSemanticConceptGroup[];
  }>('/fs/semantic/concepts', {
    method: 'POST',
    body: { query, groupLimit, filesPerGroup },
  });
  return Array.isArray(response.groups) ? response.groups : [];
}

// Reads and analyzes the complete selected text file or image through local Ollama.
export async function analyzeFileWithAI(
  path: string,
  fileManager = false,
): Promise<BridgeFileAnalysis> {
  return requestLocal<BridgeFileAnalysis>('/fs/analyze', {
    method: 'POST',
    body: { path, ...(fileManager ? { fileManager: true } : {}) },
  });
}

// Reads text file and converts it into the representation used by the renderer bridge client.
export async function readTextFile(
  path: string,
  options: BridgeOptions = {},
): Promise<{ path: string; content: string; isBinary: boolean }> {
  return requestLocal<{ path: string; content: string; isBinary: boolean }>('/fs/read', {
    method: 'POST',
    body: {
      path,
      ...options,
    },
  });
}

// Persists text file while preserving the storage and compatibility rules of this module.
export async function writeTextFile(
  path: string,
  content: string,
  options: { append?: boolean; fileManager?: boolean } = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/fs/write', {
    method: 'POST',
    body: {
      path,
      content,
      ...(options.append === true ? { append: true } : {}),
      ...(options.fileManager === true ? { fileManager: true } : {}),
    },
  });
}

// Applies an exact string replacement to a file and auto-saves it, returning a real unified diff.
// More reliable than unified-diff patching: the edit only lands when the snippet is found and
// (unless replaceAll) unambiguous.
export async function editTextFile(
  path: string,
  oldText: string,
  newText: string,
  options: { replaceAll?: boolean; fileManager?: boolean } = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/fs/edit', {
    method: 'POST',
    body: {
      path,
      oldText,
      newText,
      ...(options.replaceAll === true ? { replaceAll: true } : {}),
      ...(options.fileManager === true ? { fileManager: true } : {}),
    },
  });
}

// Saves an agent deliverable as encrypted SQLite records and returns its opaque descriptor.
export async function saveArtifact({
  filename,
  content,
  summary,
  type,
  chatId,
  append,
}: {
  filename?: string;
  content?: string;
  summary?: string;
  type?: string;
  chatId?: string;
  append?: boolean;
} = {}): Promise<BridgeArtifact | null> {
  const data = await requestLocal<{ artifact?: BridgeArtifact }>('/artifacts/save', {
    method: 'POST',
    body: {
      filename,
      content,
      summary,
      type,
      chatId,
      append: append === true,
    },
  });
  return data?.artifact || null;
}

// List stored artifacts (newest-first), optionally scoped to a chat.
export async function listArtifacts({
  limit,
  chatId,
}: { limit?: number; chatId?: string } = {}): Promise<BridgeArtifact[]> {
  const data = await requestLocal<{ artifacts?: BridgeArtifact[] }>('/artifacts/list', {
    method: 'POST',
    body: { limit, chatId },
  });
  return Array.isArray(data?.artifacts) ? data.artifacts : [];
}

// Loads one encrypted internal artifact by opaque ID.
export async function readArtifact(id: string): Promise<BridgeArtifact | null> {
  const data = await requestLocal<{ artifact?: BridgeArtifact }>('/artifacts/read', {
    method: 'POST',
    body: { id },
  });
  return data?.artifact || null;
}

// Requests the current read-only system health snapshot from the local bridge.
export async function systemStats(): Promise<SystemStats | null> {
  const data = await requestLocal<{ stats?: SystemStats }>('/system/stats', {
    method: 'POST',
    body: {},
  });
  return data?.stats || null;
}

// Requests the current bounded process list from the local bridge.
export async function systemProcesses(limit = 15): Promise<SystemProcess[]> {
  const data = await requestLocal<{ processes?: SystemProcess[] }>('/system/processes', {
    method: 'POST',
    body: { limit },
  });
  return Array.isArray(data?.processes) ? data.processes : [];
}

// Executes terminal command and converts completion or failure into the module’s standard result.
export async function executeTerminalCommand(command: string, cwd?: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/terminal/execute', {
    method: 'POST',
    body: { command, cwd },
  });
}

// Launches local command through the operating-system path owned by the renderer bridge client.
export async function launchLocalCommand(
  commandOrRequest: string | BridgeLaunchRequest,
  category = 'command',
  cwd?: string,
): Promise<BridgeLaunchResult> {
  const body =
    commandOrRequest && typeof commandOrRequest === 'object'
      ? commandOrRequest
      : { command: commandOrRequest, category, cwd };
  return requestLocal<BridgeLaunchResult>('/launcher/run', {
    method: 'POST',
    body,
  });
}

// Discovers installed launcher applications, validating cached exact binaries before searching.
export async function discoverLauncherCapabilities(
  cached?: BridgeLauncherDiscovery,
  force = false,
): Promise<BridgeLauncherDiscovery> {
  return requestLocal<BridgeLauncherDiscovery>('/launcher/discover', {
    method: 'POST',
    body: { cached, force },
  });
}

// Reads the detected development command and current managed-process state.
export async function getDevEnvironmentStatus(cwd = ''): Promise<BridgeDevEnvironmentStatus> {
  return requestLocal<BridgeDevEnvironmentStatus>('/launcher/dev/status', {
    method: 'POST',
    body: { cwd },
  });
}

// Starts the exact development command detected for the configured working directory.
export async function startDevEnvironment(cwd: string): Promise<BridgeDevEnvironmentStatus> {
  return requestLocal<BridgeDevEnvironmentStatus>('/launcher/dev/start', {
    method: 'POST',
    body: { cwd },
  });
}

// Stops only the development process group started by IRIS in this bridge session.
export async function stopDevEnvironment(): Promise<BridgeDevEnvironmentStatus> {
  return requestLocal<BridgeDevEnvironmentStatus>('/launcher/dev/stop', {
    method: 'POST',
    body: {},
  });
}

// Reads Ollama model and encrypted application-index availability.
export async function getLauncherSemanticStatus(
  buildIfMissing = true,
): Promise<BridgeLauncherSemanticStatus> {
  return requestLocal<BridgeLauncherSemanticStatus>('/launcher/semantic/status', {
    method: 'POST',
    body: { buildIfMissing },
  });
}

// Downloads the fixed semantic-search model through the system Ollama service.
export async function installLauncherSemanticModel(): Promise<BridgeLauncherSemanticStatus> {
  return requestLocal<BridgeLauncherSemanticStatus>('/launcher/semantic/install', {
    method: 'POST',
    body: {},
  });
}

// Rebuilds the encrypted installed-application index using the already installed model.
export async function rebuildLauncherSemanticIndex(): Promise<BridgeLauncherSemanticStatus> {
  return requestLocal<BridgeLauncherSemanticStatus>('/launcher/semantic/rebuild', {
    method: 'POST',
    body: {},
  });
}

export async function cancelLauncherSemanticIndex(): Promise<BridgeLauncherSemanticStatus> {
  return requestLocal<BridgeLauncherSemanticStatus>('/launcher/semantic/cancel', {
    method: 'POST',
    body: {},
  });
}

// Embeds one query and returns installed applications ordered by semantic similarity.
export async function searchLauncherSemanticApplications(
  query: string,
  limit = 20,
): Promise<BridgeLauncherSemanticApplication[]> {
  const response = await requestLocal<{
    results?: BridgeLauncherSemanticApplication[];
  }>('/launcher/semantic/search', {
    method: 'POST',
    body: { query, limit },
  });
  return Array.isArray(response.results) ? response.results : [];
}

// Clears encrypted IRIS application data after exact one-time launcher approval.
export async function clearIRISData(approvalId = ''): Promise<BridgeClearDataResult> {
  return requestLocal<BridgeClearDataResult>('/launcher/clear-data', {
    method: 'POST',
    body: { approvalId },
  });
}

// Returns automation capabilities without requiring callers to know where or how it is stored.
export async function getAutomationCapabilities(): Promise<BridgeAutomationCapabilities> {
  return requestLocal<BridgeAutomationCapabilities>('/automation/capabilities');
}

/**
 * Executes automation actions and converts completion or failure into the module’s standard
 * result.
 */

export async function executeAutomationActions(
  actions: BridgeRecord[],
  {
    dryRun = false,
    cwd,
    permissions,
  }: {
    dryRun?: boolean;
    cwd?: string;
    permissions?: BridgeRecord;
  } = {},
): Promise<BridgeAutomationResult> {
  let approvalToken;
  if (!dryRun) {
    const approval = await requestLocal<{ approvalToken?: string }>('/automation/approval', {
      method: 'POST',
      body: { actions, cwd },
    });
    approvalToken = approval?.approvalToken;
  }

  return requestLocal<BridgeAutomationResult>('/automation/execute', {
    method: 'POST',
    body: {
      actions,
      dryRun,
      cwd,
      permissions,
      ...(approvalToken ? { approvalToken } : {}),
    },
  });
}

// Discovers local AI servers from the available provider or runtime capabilities.
export async function discoverLocalAIServers(): Promise<
  BridgeLocalServer[] | { servers?: BridgeLocalServer[]; preferred?: BridgeLocalServer }
> {
  return requestLocal<
    BridgeLocalServer[] | { servers?: BridgeLocalServer[]; preferred?: BridgeLocalServer }
  >('/ai/discover');
}

export interface BridgeModelInputCapabilities extends BridgeRecord {
  model: string;
  image: boolean;
  audio: boolean;
  capabilities: string[];
  family?: string;
}

export async function getLocalModelInputCapabilities(
  baseUrl: string,
  model: string,
): Promise<BridgeModelInputCapabilities> {
  return requestLocal<BridgeModelInputCapabilities>('/ai/local/capabilities', {
    method: 'POST',
    body: { baseUrl, model },
  });
}

export async function getRemoteModelInputCapabilities(
  provider: string,
  model: string,
  apiKey: string,
): Promise<BridgeModelInputCapabilities> {
  return requestLocal<BridgeModelInputCapabilities>('/ai/remote/capabilities', {
    method: 'POST',
    body: { provider, model, apiKey },
  });
}

export async function pullLocalOllamaModel(
  baseUrl: string,
  model: string,
): Promise<{ ok: boolean; model: string; status: string }> {
  return requestLocal<{ ok: boolean; model: string; status: string }>('/ai/local/pull', {
    method: 'POST',
    body: { baseUrl, model },
  });
}

export async function startLocalOllamaModelPull(
  baseUrl: string,
  model: string,
): Promise<BridgeLocalModelPullStatus> {
  return requestLocal<BridgeLocalModelPullStatus>('/ai/local/pull/start', {
    method: 'POST',
    body: { baseUrl, model },
  });
}

export async function getLocalOllamaModelPull(jobId: string): Promise<BridgeLocalModelPullStatus> {
  return requestLocal<BridgeLocalModelPullStatus>('/ai/local/pull/status', {
    method: 'POST',
    body: { jobId },
  });
}

export async function cancelLocalOllamaModelPull(
  jobId: string,
): Promise<BridgeLocalModelPullStatus> {
  return requestLocal<BridgeLocalModelPullStatus>('/ai/local/pull/cancel', {
    method: 'POST',
    body: { jobId },
  });
}

export interface BridgeAudioTranscriptionOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  localFallback?: boolean;
}

export interface BridgeAudioTranscriptionResult extends BridgeRecord {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

// Returns local Ollama availability and the fixed Granite model state.
export async function getAudioTranscriptionStatus(): Promise<BridgeNoteTranscriptionStatus> {
  return requestLocal<BridgeNoteTranscriptionStatus>('/audio/transcription/status');
}

// Downloads the fixed Granite transcription model through Ollama.
export async function installAudioTranscriptionModel(): Promise<BridgeNoteTranscriptionStatus> {
  return requestLocal<BridgeNoteTranscriptionStatus>('/audio/transcription/install', {
    method: 'POST',
    body: {},
  });
}

// Sends one in-memory PCM WAV recording to the configured transcription provider.
export async function transcribeAudio(
  audio: Blob,
  options: BridgeAudioTranscriptionOptions = {},
  signal?: AbortSignal,
): Promise<BridgeAudioTranscriptionResult> {
  const headers: Record<string, string> = {
    'x-iris-audio-provider': String(options.provider || 'local'),
    'x-iris-audio-model': String(options.model || ''),
    'x-iris-audio-local-fallback': options.localFallback === false ? '0' : '1',
  };
  if (options.apiKey) headers['x-iris-audio-key'] = String(options.apiKey);

  return requestLocalBinary<BridgeAudioTranscriptionResult>(
    '/audio/transcriptions',
    audio,
    signal,
    headers,
  );
}

// Compatibility aliases retained for the existing Notes integration.
export const getNoteTranscriptionStatus = getAudioTranscriptionStatus;
export const installNoteTranscriptionModel = installAudioTranscriptionModel;
export async function transcribeNoteAudio(audio: Blob, signal?: AbortSignal): Promise<string> {
  return (await transcribeAudio(audio, {}, signal)).text;
}

// Forwards an approved provider request through the local bridge proxy.
export async function proxyAIRequest({
  url,
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs,
  signal,
  provider,
}: BridgeAIProxyRequest = {}): Promise<BridgeAIProxyResponse> {
  return requestLocal<BridgeAIProxyResponse>('/ai/proxy', {
    method: 'POST',
    body: {
      url,
      method,
      headers,
      body,
      timeoutMs,
      provider,
    },
    signal,
  });
}

// ── Encrypted renderer state store ───────────────────────────────────────────

export async function durableStoreGetAll(): Promise<Record<string, string>> {
  const data = await requestLocal<{ values?: Record<string, string> }>('/store/get-all');
  return data && typeof data.values === 'object' && data.values ? data.values : {};
}

// Writes one small renderer value to the bridge-owned durable store.
export async function durableStoreSet(key: string, value: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/store/set', {
    method: 'POST',
    body: { key, value },
  });
}

// Removes one encrypted renderer value from the bridge-owned store.
export async function durableStoreDelete(key: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/store/delete', {
    method: 'POST',
    body: { key },
  });
}

// ── Chat sessions (Phase F) — durable per-chat transcript/compacted/memory ─────

export async function chatsList(): Promise<BridgeRecord[]> {
  const data = await requestLocal<{ chats?: BridgeRecord[] }>('/chats/list', {
    method: 'POST',
    body: {},
  });
  return Array.isArray(data?.chats) ? data.chats : [];
}

// Requests the chat create operation through the renderer bridge client.
export async function chatsCreate({
  title,
  provider,
  model,
}: {
  title?: string;
  provider?: string;
  model?: string;
} = {}): Promise<BridgeRecord | null> {
  const data = await requestLocal<{ chat?: BridgeRecord }>('/chats/create', {
    method: 'POST',
    body: { title, provider, model },
  });
  return data?.chat || null;
}

// Persists the chat append operation through the renderer bridge client.
export async function chatsAppend(id: string, message: BridgeChatMessage): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/chats/append', {
    method: 'POST',
    body: { id, message },
  });
}

// Requests the chat get operation through the renderer bridge client.
export async function chatsGet(id: string): Promise<{
  meta?: BridgeRecord;
  messages?: BridgeChatMessage[];
  compacted?: string;
  paths?: Record<string, string>;
} | null> {
  const data = await requestLocal<{
    chat?: {
      meta?: BridgeRecord;
      messages?: BridgeChatMessage[];
      compacted?: string;
      paths?: Record<string, string>;
    };
  }>('/chats/get', {
    method: 'POST',
    body: { id },
  });
  return data?.chat || null;
}

// Persists the chat save compacted operation through the renderer bridge client.
export async function chatsSaveCompacted(id: string, content: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/chats/save-compacted', {
    method: 'POST',
    body: { id, content },
  });
}

// Persists the chat set title operation through the renderer bridge client.
export async function chatsSetTitle(id: string, title: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/chats/set-title', {
    method: 'POST',
    body: { id, title },
  });
}

// Requests the chat delete operation through the renderer bridge client.
export async function chatsDelete(id: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/chats/delete', {
    method: 'POST',
    body: { id },
  });
}

// Requests the chat read memory operation through the renderer bridge client.
export async function chatsReadMemory(id: string): Promise<string> {
  const data = await requestLocal<{ memory?: string }>('/chats/read-memory', {
    method: 'POST',
    body: { id },
  });
  return typeof data?.memory === 'string' ? data.memory : '';
}

// Persists the chat write memory operation through the renderer bridge client.
export async function chatsWriteMemory(
  id: string,
  content: string,
  { append = false }: { append?: boolean } = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/chats/write-memory', {
    method: 'POST',
    body: { id, content, append },
  });
}

// Requests the chat recall operation through the renderer bridge client.
export async function chatsRecall(id: string, scope = 'compacted'): Promise<string> {
  const data = await requestLocal<{ context?: string }>('/chats/recall', {
    method: 'POST',
    body: { id, scope },
  });
  return typeof data?.context === 'string' ? data.context : '';
}

// ── Sub-agent output handoff (Phase E) ─────────────────────────────────────────

export async function subagentWriteOutput(taskId: string, content: string): Promise<string> {
  const data = await requestLocal<{ path?: string }>('/subagent/write-output', {
    method: 'POST',
    body: { taskId, content },
  });
  return typeof data?.path === 'string' ? data.path : '';
}

// Reads a completed sub-agent's encrypted output record through the local bridge.
export async function subagentReadOutput(taskId: string): Promise<string> {
  const data = await requestLocal<{ output?: string }>('/subagent/read-output', {
    method: 'POST',
    body: { taskId },
  });
  return typeof data?.output === 'string' ? data.output : '';
}

/**
 * Stream an AI request through the bridge proxy (SSE passthrough). POSTs the
 * request and reads the chunked response body, invoking onChunk(textChunk) as
 * bytes arrive. Resolves { ok, status } when the stream completes.
 */
export async function proxyAIStream(
  {
    url,
    method = 'POST',
    headers = {},
    body = null,
    timeoutMs,
    signal,
    provider,
  }: BridgeAIProxyRequest = {},
  onChunk?: (chunk: string) => void,
): Promise<{ ok: boolean; status: number }> {
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getBridgeToken();
  if (token) reqHeaders['x-iris-bridge-token'] = token;

  const response = await fetch(bridgeUrl('/ai/proxy/stream'), {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ url, method, headers, body, timeoutMs, provider }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Stream proxy error (${response.status})${errText ? `: ${errText.slice(0, 200)}` : ''}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && typeof onChunk === 'function') onChunk(decoder.decode(value, { stream: true }));
  }
  return { ok: true, status: response.status };
}

// Searches for web research using the policy owned by the renderer bridge client.
export async function searchWebResearch(
  query: string,
  options: BridgeOptions = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/web/search', {
    method: 'POST',
    body: {
      query,
      ...options,
    },
  });
}

export async function streamWebResearch(
  query: string,
  options: BridgeOptions = {},
  onProgress?: (event: BridgeWebResearchProgressEvent) => void,
  signal?: AbortSignal,
): Promise<BridgeRecord> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getBridgeToken();
  if (token) headers['x-iris-bridge-token'] = token;

  const response = await fetch(bridgeUrl('/web/search/stream'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, ...options }),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    const detail = isRecord(data) ? data : {};
    throw new LocalBridgeError(
      String(detail.error || `Local bridge error (${response.status})`),
      response.status,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: BridgeRecord | null = null;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message = JSON.parse(trimmed) as BridgeRecord;
    if (message.kind === 'progress' && isRecord(message.event)) {
      onProgress?.(message.event as BridgeWebResearchProgressEvent);
      return;
    }
    if (message.kind === 'result' && isRecord(message.result)) {
      result = message.result;
      return;
    }
    if (message.kind === 'error') {
      throw new Error(String(message.error || 'Web search failed'));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);
  if (!result) throw new Error('Web search stream ended without a result.');
  return result;
}

export async function listWebSearchHistory(limit = 100): Promise<BridgeWebSearchHistoryItem[]> {
  const data = await requestLocal<{ sessions?: BridgeWebSearchHistoryItem[] }>(
    '/web-history/list',
    { method: 'POST', body: { limit } },
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function createWebSearchHistory(
  session: BridgeRecord,
): Promise<BridgeWebSearchHistoryItem> {
  const data = await requestLocal<{ session?: BridgeWebSearchHistoryItem }>('/web-history/create', {
    method: 'POST',
    body: { session },
  });
  if (!data.session) throw new Error('Saved search was not created.');
  return data.session;
}

export async function getWebSearchHistory(id: string): Promise<BridgeRecord> {
  const data = await requestLocal<{ session?: BridgeRecord }>('/web-history/get', {
    method: 'POST',
    body: { id },
  });
  if (!data.session) throw new Error('Saved search was not found.');
  return data.session;
}

export async function saveWebSearchHistory(
  id: string,
  session: BridgeRecord,
): Promise<BridgeWebSearchHistoryItem> {
  const data = await requestLocal<{ session?: BridgeWebSearchHistoryItem }>('/web-history/save', {
    method: 'POST',
    body: { id, session },
  });
  if (!data.session) throw new Error('Saved search was not updated.');
  return data.session;
}

export async function duplicateWebSearchHistory(id: string): Promise<BridgeWebSearchHistoryItem> {
  const data = await requestLocal<{ session?: BridgeWebSearchHistoryItem }>(
    '/web-history/duplicate',
    { method: 'POST', body: { id } },
  );
  if (!data.session) throw new Error('Saved search was not duplicated.');
  return data.session;
}

export async function deleteWebSearchHistory(id: string): Promise<number> {
  const data = await requestLocal<{ removed?: number }>('/web-history/delete', {
    method: 'POST',
    body: { id },
  });
  return Number(data.removed || 0);
}

export async function clearWebSearchHistory(): Promise<number> {
  const data = await requestLocal<{ removed?: number }>('/web-history/clear', {
    method: 'POST',
  });
  return Number(data.removed || 0);
}

// Returns the available skill profiles in the normalized form used by callers.
export async function listSkillProfiles(): Promise<{ profiles?: string[] }> {
  return requestLocal<{ profiles?: string[] }>('/skills/profiles');
}

// Returns the available skill definitions in the normalized form used by callers.
export async function listSkillDefinitions(
  profile: string,
): Promise<{ profile?: string; skills?: BridgeSkillDefinition[] }> {
  return requestLocal<{ profile?: string; skills?: BridgeSkillDefinition[] }>('/skills/list', {
    method: 'POST',
    body: { profile },
  });
}

// Creates or updates skill definition using the canonical persistence contract.
export async function upsertSkillDefinition(
  profile: string,
  skill: BridgeSkillDefinition,
): Promise<{ profile?: string; skill?: BridgeSkillDefinition }> {
  return requestLocal<{ profile?: string; skill?: BridgeSkillDefinition }>('/skills/upsert', {
    method: 'POST',
    body: { profile, skill },
  });
}

// Deletes skill definition through the persistence path owned by the renderer bridge client.
export async function deleteSkillDefinition(
  profile: string,
  skillId: string,
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/skills/delete', {
    method: 'POST',
    body: { profile, skillId },
  });
}

/**
 * getScreenSources
 *
 * Asks the local bridge (Electron main process) for available screen/window
 * capture sources.  The main process should handle this via desktopCapturer
 * and return an array of { id, name } objects.
 *
 * Returns null if the bridge doesn't support this endpoint yet (older builds),
 * in which case the renderer falls back to getDisplayMedia.
 */
export async function getScreenSources(): Promise<BridgeScreenSource[] | null> {
  try {
    const result = await requestLocal<{ sources?: BridgeScreenSource[] }>('/screen/sources');
    return Array.isArray(result?.sources) ? result.sources : null;
  } catch {
    return null;
  }
}

// ── Multi-Agent Orchestration Bus ─────────────────────────────────────────────

export async function registerAgent(
  agentId: string,
  capabilities: string[] = [],
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/agent/register', {
    method: 'POST',
    body: { agentId, capabilities },
  });
}

// Returns agent roster remote used by the renderer bridge client.
export async function getAgentRosterRemote(): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/agent/roster');
}

// Posts one structured task to the bridge agent bus.
export async function postAgentTask(stp: BridgeRecord): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/agent/task/post', {
    method: 'POST',
    body: { stp },
  });
}

// Polls the bridge agent bus for the current state of one delegated task.
export async function pollAgentTask(agentId: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>(`/agent/task/poll?agentId=${encodeURIComponent(agentId)}`);
}

// Posts the terminal result of one delegated task back to the bridge agent bus.
export async function postAgentTaskResult(result: BridgeRecord): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/agent/task/result', {
    method: 'POST',
    body: result,
  });
}

// Returns agent task status used by the renderer bridge client.
export async function getAgentTaskStatus(taskId: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>(`/agent/task/status?taskId=${encodeURIComponent(taskId)}`);
}

// Broadcasts agent message to the active consumers coordinated by the renderer bridge client.
export async function broadcastAgentMessage(
  message: string,
  contextUpdate: BridgeRecord = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/agent/broadcast', {
    method: 'POST',
    body: { message, contextUpdate },
  });
}

/** Open a live SSE stream for a specific agent. Returns an EventSource. */
export function openAgentStream(agentId: string): EventSource {
  return new EventSource(bridgeStreamUrl(`/agent/stream/${encodeURIComponent(agentId)}`));
}

// ── Power Tools ────────────────────────────────────────────────────────────────

export async function powerRipgrep(
  pattern: string,
  options: BridgeOptions = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/ripgrep', {
    method: 'POST',
    body: { pattern, ...options },
  });
}

// Invokes the stat power-tool endpoint through the renderer bridge client.
export async function powerStat(pathOrPaths: string | string[]): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/stat', {
    method: 'POST',
    body: { path: Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths] },
  });
}

// Invokes the find power-tool endpoint through the renderer bridge client.
export async function powerFind(options: BridgeOptions = {}): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/find', {
    method: 'POST',
    body: options,
  });
}

// Invokes the fd power-tool endpoint through the renderer bridge client.
export async function powerFd(options: BridgeOptions = {}): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/fd', {
    method: 'POST',
    body: options,
  });
}

// Invokes the locate power-tool endpoint through the renderer bridge client.
export async function powerLocate(options: BridgeOptions = {}): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/locate', {
    method: 'POST',
    body: options,
  });
}

// Invokes the diff power-tool endpoint through the renderer bridge client.
export async function powerDiff(
  path: string,
  newContent: string,
  contextLines = 3,
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/diff', {
    method: 'POST',
    body: { path, newContent, contextLines },
  });
}

// Invokes the patch power-tool endpoint through the renderer bridge client.
export async function powerPatch(
  path: string,
  patch: string,
  dryRun = false,
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/patch', {
    method: 'POST',
    body: { path, patch, dryRun },
  });
}

// Invokes the web fetch power-tool endpoint through the renderer bridge client.
export async function powerWebFetch(
  url: string,
  options: BridgeOptions = {},
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/webfetch', {
    method: 'POST',
    body: { url, ...options },
  });
}

// Invokes the env inspect power-tool endpoint through the renderer bridge client.
export async function powerEnvInspect(
  include: string[] = ['processes', 'ports', 'tools', 'env'],
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/env', {
    method: 'POST',
    body: { include },
  });
}

// Invokes the clipboard read power-tool endpoint through the renderer bridge client.
export async function powerClipboardRead(): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/clipboard/read', { method: 'GET' });
}

// Invokes the clipboard write power-tool endpoint through the renderer bridge client.
export async function powerClipboardWrite(content: string): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/clipboard/write', {
    method: 'POST',
    body: { content },
  });
}

// Invokes the script power-tool endpoint through the renderer bridge client.
export async function powerScript(
  script: string,
  args: BridgeRecord = {},
  cwd?: string,
): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/power/script', {
    method: 'POST',
    body: { script, args, cwd },
  });
}

// Renders the show open file dialog and coordinates its user-facing state.
export async function showOpenFileDialog(options: BridgeOptions = {}): Promise<BridgeRecord> {
  return requestLocal<BridgeRecord>('/system/open-file-dialog', {
    method: 'POST',
    body: options,
  });
}
