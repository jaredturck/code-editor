/**
 * Builds and searches IRIS's encrypted semantic application index. The bridge talks to the
 * system Ollama service, while Ollama owns model download and weight storage. Application
 * metadata and embedding vectors are encrypted before SQLite receives them.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readEncryptedLauncherApplications,
  readEncryptedLauncherIndexMeta,
  saveEncryptedLauncherIndex,
  type EncryptedLauncherApplicationRecord,
} from '../storage/encryptedDatabase.js';
import { discoverLauncherCapabilities, resolveLauncherExecutable } from './launcherService.js';

export const LAUNCHER_EMBEDDING_MODEL = 'qwen3-embedding:0.6b';
export const LAUNCHER_OLLAMA_URL = 'http://127.0.0.1:11434';

const INDEX_SCHEMA_VERSION = 1;
const EMBEDDING_BATCH_SIZE = 16;
const MAX_DISCOVERED_APPLICATIONS = 3000;
const MAX_APPLICATION_TEXT_CHARS = 5000;
const MODEL_STATUS_CACHE_MS = 3000;
const REQUEST_TIMEOUT_MS = 120000;

export type LauncherSemanticIndexStatus = 'missing' | 'building' | 'ready' | 'error';

export interface LauncherIndexedApplication {
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
}

export interface LauncherSemanticSearchResult extends LauncherIndexedApplication {
  score: number;
}

export interface LauncherSemanticStatus {
  ollamaAvailable: boolean;
  modelInstalled: boolean;
  model: string;
  indexStatus: LauncherSemanticIndexStatus;
  applicationCount: number;
  generatedAt?: number;
  stage?: string;
  completed?: number;
  total?: number;
  error?: string;
}

export interface LauncherDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  applicationDirectories?: string[];
}

interface RuntimeIndexState {
  status: LauncherSemanticIndexStatus;
  stage: string;
  completed: number;
  total: number;
  error: string;
}

interface OllamaModelState {
  available: boolean;
  installed: boolean;
  checkedAt: number;
}

let runtimeIndexState: RuntimeIndexState = {
  status: 'missing',
  stage: '',
  completed: 0,
  total: 0,
  error: '',
};
let indexBuildPromise: Promise<void> | null = null;
let cachedApplications: EncryptedLauncherApplicationRecord[] | null = null;
let cachedModelState: OllamaModelState | null = null;
let indexGeneration = 0;

function uniqueStrings(values: unknown, limit = 80): string[] {
  const source = Array.isArray(values)
    ? values
    : String(values || '')
        .split(/[;,]/)
        .map((value) => value.trim());
  return [...new Set(source.map((value) => String(value || '').trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}

function normalizedOllamaUrl(): string {
  const url = new URL(LAUNCHER_OLLAMA_URL);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Semantic launcher search requires the local Ollama service');
  }
  return url.origin;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const text = await response.text().catch(() => '');
  let message = text;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    message = String(parsed.error || text);
  } catch {
    // Plain-text Ollama errors are already useful.
  }
  return new Error(message ? `${fallback}: ${message.slice(0, 500)}` : fallback);
}

function modelNameMatches(value: unknown): boolean {
  const name = String(value || '')
    .trim()
    .toLowerCase();
  return name === LAUNCHER_EMBEDDING_MODEL || name.startsWith(`${LAUNCHER_EMBEDDING_MODEL}@`);
}

async function readOllamaModelState(force = false): Promise<OllamaModelState> {
  if (
    !force &&
    cachedModelState &&
    Date.now() - cachedModelState.checkedAt < MODEL_STATUS_CACHE_MS
  ) {
    return cachedModelState;
  }

  try {
    const response = await fetchWithTimeout(
      `${normalizedOllamaUrl()}/api/tags`,
      {
        method: 'GET',
      },
      4000,
    );
    if (!response.ok) {
      cachedModelState = {
        available: false,
        installed: false,
        checkedAt: Date.now(),
      };
      return cachedModelState;
    }
    const data = (await response.json().catch(() => ({}))) as {
      models?: Array<{ name?: unknown; model?: unknown }>;
    };
    const installed = Array.isArray(data.models)
      ? data.models.some((model) => modelNameMatches(model.name || model.model))
      : false;
    cachedModelState = { available: true, installed, checkedAt: Date.now() };
    return cachedModelState;
  } catch {
    cachedModelState = {
      available: false,
      installed: false,
      checkedAt: Date.now(),
    };
    return cachedModelState;
  }
}

function parseDesktopExec(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += character;
  }

  if (current) tokens.push(current);
  return tokens
    .filter((token) => !token.startsWith('@@'))
    .map((token) => token.replace(/%[fFuUdDnNickvm]/g, '').replace(/%%/g, '%'))
    .filter(Boolean);
}

function normalizeDesktopExecTokens(tokens: string[]): string[] {
  if (!tokens.length || tokens[0] !== 'env') return tokens;
  let index = 1;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index += 1;
  }
  return tokens.slice(index);
}

function applicationDirectories(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const dataHome = env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
  const dataDirs = String(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean);
  const directories = [
    path.join(dataHome, 'applications'),
    ...dataDirs.map((directory) => path.join(directory, 'applications')),
    path.join(homeDir, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
  ];
  return [...new Set(directories.map((directory) => path.resolve(directory)))];
}

function parseDesktopEntry(content: string): Map<string, string> {
  const values = new Map<string, string>();
  let inDesktopEntry = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inDesktopEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inDesktopEntry || !line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!values.has(key)) values.set(key, line.slice(separator + 1).trim());
  }
  return values;
}

function applicationId(source: string, sourceId: string): string {
  return `app_${createHash('sha256').update(`${source}:${sourceId}`).digest('hex').slice(0, 32)}`;
}

function metadataDocument(
  application: Omit<LauncherIndexedApplication, 'id' | 'metadataFingerprint' | 'metadataText'>,
): string {
  return [
    `Application name: ${application.name}`,
    application.genericName ? `Generic name: ${application.genericName}` : '',
    application.description ? `Description: ${application.description}` : '',
    application.keywords.length ? `Keywords: ${application.keywords.join(', ')}` : '',
    application.categories.length ? `Categories: ${application.categories.join(', ')}` : '',
    `Executable: ${path.basename(application.executable)}`,
    `Source: ${application.source}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_APPLICATION_TEXT_CHARS);
}

function finalizeApplication(
  application: Omit<LauncherIndexedApplication, 'id' | 'metadataFingerprint' | 'metadataText'>,
): LauncherIndexedApplication {
  const metadataText = metadataDocument(application);
  const metadataFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        metadataText,
        executable: application.executable,
        args: application.args,
        terminal: application.terminal,
      }),
    )
    .digest('hex');
  return {
    ...application,
    id: applicationId(application.source, application.sourceId),
    metadataFingerprint,
    metadataText,
  };
}

function desktopEntrySource(filePath: string): string {
  if (filePath.includes('flatpak')) return 'flatpak';
  if (filePath.includes('snapd')) return 'snap';
  return 'desktop_entry';
}

async function readDesktopApplication(
  filePath: string,
  desktopId: string,
  env: NodeJS.ProcessEnv,
): Promise<LauncherIndexedApplication | null> {
  const content = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!content || content.length > 256 * 1024) return null;
  const values = parseDesktopEntry(content);
  if (values.get('Type') && values.get('Type') !== 'Application') return null;
  if (values.get('Hidden') === 'true') return null;

  const tokens = normalizeDesktopExecTokens(parseDesktopExec(values.get('Exec') || ''));
  if (!tokens.length) return null;
  const tryExecutable = values.get('TryExec');
  if (tryExecutable && !(await resolveLauncherExecutable(tryExecutable, env))) return null;
  const executable = await resolveLauncherExecutable(tokens[0], env);
  if (!executable) return null;

  const name = String(values.get('Name') || '').trim();
  if (!name) return null;
  const source = desktopEntrySource(filePath);
  return finalizeApplication({
    name,
    genericName: String(values.get('GenericName') || '').trim(),
    description: String(values.get('Comment') || '').trim(),
    keywords: uniqueStrings(values.get('Keywords')),
    categories: uniqueStrings(values.get('Categories')),
    executable,
    args: tokens.slice(1, 80),
    icon: String(values.get('Icon') || '').trim(),
    terminal: values.get('Terminal') === 'true',
    source,
    sourceId: desktopId,
    searchOnly: values.get('NoDisplay') === 'true',
  });
}

async function discoverDesktopApplications(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  directoryOverride?: string[],
): Promise<LauncherIndexedApplication[]> {
  const applications: LauncherIndexedApplication[] = [];
  const seenDesktopIds = new Set<string>();
  const directories =
    directoryOverride === undefined
      ? applicationDirectories(homeDir, env)
      : [...new Set(directoryOverride.map((directory) => path.resolve(directory)))];

  for (const directory of directories) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith('.desktop')) {
        continue;
      }
      if (seenDesktopIds.has(entry.name)) continue;
      seenDesktopIds.add(entry.name);
      const application = await readDesktopApplication(
        path.join(directory, entry.name),
        entry.name,
        env,
      );
      if (application) applications.push(application);
      if (applications.length >= MAX_DISCOVERED_APPLICATIONS) return applications;
    }
  }

  return applications;
}

function steamRoots(homeDir: string): string[] {
  return [path.join(homeDir, '.local', 'share', 'Steam'), path.join(homeDir, '.steam', 'steam')];
}

function parseVdfValue(content: string, key: string): string {
  const match = content.match(new RegExp(`"${key}"\\s+"([^"]+)"`, 'i'));
  return String(match?.[1] || '').replace(/\\\\/g, '\\');
}

async function steamLibraryDirectories(homeDir: string): Promise<string[]> {
  const libraries = new Set<string>();
  for (const root of steamRoots(homeDir)) {
    libraries.add(path.join(root, 'steamapps'));
    const content = await fs
      .readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      .catch(() => '');
    for (const match of content.matchAll(/"path"\s+"([^"]+)"/gi)) {
      const libraryPath = String(match[1] || '').replace(/\\\\/g, '\\');
      if (libraryPath) libraries.add(path.join(libraryPath, 'steamapps'));
    }
  }
  return [...libraries];
}

async function discoverSteamApplications(
  homeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<LauncherIndexedApplication[]> {
  const steam = await resolveLauncherExecutable('steam', env);
  if (!steam) return [];
  const applications: LauncherIndexedApplication[] = [];

  for (const directory of await steamLibraryDirectories(homeDir)) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/.test(entry.name)) continue;
      const content = await fs.readFile(path.join(directory, entry.name), 'utf8').catch(() => '');
      const appId = parseVdfValue(content, 'appid');
      const name = parseVdfValue(content, 'name');
      if (!appId || !name) continue;
      applications.push(
        finalizeApplication({
          name,
          genericName: 'Steam Game',
          description: 'A game installed through Steam.',
          keywords: ['game', 'steam'],
          categories: ['Game'],
          executable: steam,
          args: ['-applaunch', appId],
          icon: 'steam',
          terminal: false,
          source: 'steam',
          sourceId: appId,
          searchOnly: false,
        }),
      );
    }
  }

  return applications;
}

async function discoverCapabilityApplications(
  homeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<LauncherIndexedApplication[]> {
  const discovery = await discoverLauncherCapabilities({
    env,
    homeDir,
    force: true,
  });
  return discovery.applications.map((application) =>
    finalizeApplication({
      name: application.displayName,
      genericName: application.capability.replace(/_/g, ' '),
      description: `Installed ${application.capability.replace(/_/g, ' ')} application.`,
      keywords: [application.capability.replace(/_/g, ' ')],
      categories: ['Utility'],
      executable: application.executable,
      args: application.args || [],
      icon: '',
      terminal: false,
      source: 'launcher_capability',
      sourceId: application.capability,
      searchOnly: true,
    }),
  );
}

/** Discovers user-launchable applications from desktop registries and Steam manifests. */
export async function discoverInstalledLauncherApplications(
  options: LauncherDiscoveryOptions = {},
): Promise<LauncherIndexedApplication[]> {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const discovered = [
    ...(await discoverDesktopApplications(homeDir, env, options.applicationDirectories)),
    ...(await discoverSteamApplications(homeDir, env)),
    ...(await discoverCapabilityApplications(homeDir, env)),
  ];
  const deduplicated: LauncherIndexedApplication[] = [];
  const seenNames = new Set<string>();
  const seenLaunches = new Set<string>();

  for (const application of discovered) {
    const nameKey = application.name.trim().toLowerCase();
    const launchKey = JSON.stringify([application.executable, application.args]);
    if (!nameKey || seenNames.has(nameKey) || seenLaunches.has(launchKey)) continue;
    seenNames.add(nameKey);
    seenLaunches.add(launchKey);
    deduplicated.push(application);
    if (deduplicated.length >= MAX_DISCOVERED_APPLICATIONS) break;
  }

  return deduplicated.sort((left, right) => left.name.localeCompare(right.name));
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetchWithTimeout(`${normalizedOllamaUrl()}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LAUNCHER_EMBEDDING_MODEL,
      input: texts,
      truncate: true,
      keep_alive: '10m',
    }),
  });
  if (!response.ok) throw await responseError(response, 'Ollama embedding request failed');
  const data = (await response.json().catch(() => ({}))) as {
    embeddings?: unknown;
    embedding?: unknown;
  };
  const rawEmbeddings = Array.isArray(data.embeddings)
    ? data.embeddings
    : Array.isArray(data.embedding)
      ? [data.embedding]
      : [];
  const embeddings = rawEmbeddings.map((value) =>
    Array.isArray(value)
      ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [],
  );
  if (embeddings.length !== texts.length || embeddings.some((embedding) => !embedding.length)) {
    throw new Error('Ollama returned an invalid embedding response');
  }
  return embeddings;
}

function normalizedVector(values: number[]): number[] {
  let lengthSquared = 0;
  for (const value of values) lengthSquared += value * value;
  const length = Math.sqrt(lengthSquared);
  if (!length) return values.map(() => 0);
  return values.map((value) => value / length);
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return -1;
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] * left[index];
    rightLength += right[index] * right[index];
  }
  if (!leftLength || !rightLength) return -1;
  return dot / Math.sqrt(leftLength * rightLength);
}

function metadataFromStored(
  record: EncryptedLauncherApplicationRecord,
): LauncherIndexedApplication {
  const metadata = record.metadata;
  return {
    id: record.id,
    name: String(metadata.name || ''),
    genericName: String(metadata.genericName || ''),
    description: String(metadata.description || ''),
    keywords: uniqueStrings(metadata.keywords),
    categories: uniqueStrings(metadata.categories),
    executable: String(metadata.executable || ''),
    args: Array.isArray(metadata.args)
      ? metadata.args.map((value) => String(value)).slice(0, 80)
      : [],
    icon: String(metadata.icon || ''),
    terminal: metadata.terminal === true,
    source: String(metadata.source || ''),
    sourceId: String(metadata.sourceId || ''),
    searchOnly: metadata.searchOnly === true,
    metadataFingerprint: String(metadata.metadataFingerprint || ''),
    metadataText: String(metadata.metadataText || ''),
  };
}

async function loadStoredApplications(): Promise<EncryptedLauncherApplicationRecord[]> {
  if (!cachedApplications) cachedApplications = await readEncryptedLauncherApplications();
  return cachedApplications;
}

function indexMetaIsCurrent(meta: Record<string, unknown> | null): boolean {
  return Boolean(
    meta &&
    Number(meta.schemaVersion) === INDEX_SCHEMA_VERSION &&
    String(meta.model || '') === LAUNCHER_EMBEDDING_MODEL &&
    Number(meta.applicationCount) >= 0,
  );
}

async function buildLauncherSemanticIndex(
  generation: number,
  discoveryOptions: LauncherDiscoveryOptions = {},
): Promise<void> {
  runtimeIndexState = {
    status: 'building',
    stage: 'Discovering installed applications',
    completed: 0,
    total: 0,
    error: '',
  };
  const applications = await discoverInstalledLauncherApplications(discoveryOptions);
  runtimeIndexState = {
    status: 'building',
    stage: 'Creating application embeddings',
    completed: 0,
    total: applications.length,
    error: '',
  };

  const records: EncryptedLauncherApplicationRecord[] = [];
  for (let start = 0; start < applications.length; start += EMBEDDING_BATCH_SIZE) {
    if (generation !== indexGeneration) return;
    const batch = applications.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((application) => application.metadataText));
    if (generation !== indexGeneration) return;
    batch.forEach((application, index) => {
      const metadata = { ...application };
      records.push({
        id: application.id,
        metadata,
        embedding: normalizedVector(embeddings[index]),
      });
    });
    runtimeIndexState.completed = Math.min(applications.length, start + batch.length);
  }

  if (generation !== indexGeneration) return;
  const generatedAt = Date.now();
  await saveEncryptedLauncherIndex(
    {
      schemaVersion: INDEX_SCHEMA_VERSION,
      model: LAUNCHER_EMBEDDING_MODEL,
      applicationCount: records.length,
      generatedAt,
      status: 'complete',
    },
    records,
  );
  if (generation !== indexGeneration) return;
  cachedApplications = records;
  runtimeIndexState = {
    status: 'ready',
    stage: '',
    completed: records.length,
    total: records.length,
    error: '',
  };
}

function startIndexBuild(discoveryOptions: LauncherDiscoveryOptions = {}): void {
  if (indexBuildPromise) return;
  const generation = indexGeneration;
  indexBuildPromise = buildLauncherSemanticIndex(generation, discoveryOptions)
    .catch((error) => {
      runtimeIndexState = {
        status: 'error',
        stage: '',
        completed: 0,
        total: 0,
        error: error instanceof Error ? error.message : 'Semantic application indexing failed',
      };
    })
    .finally(() => {
      indexBuildPromise = null;
    });
}

/** Returns model and index availability, optionally starting a missing index in the background. */
export async function getLauncherSemanticStatus(
  buildIfMissing = false,
): Promise<LauncherSemanticStatus> {
  const modelState = await readOllamaModelState();
  const meta = await readEncryptedLauncherIndexMeta();
  const currentMeta = indexMetaIsCurrent(meta) ? meta : null;

  if (
    modelState.installed &&
    buildIfMissing &&
    !currentMeta &&
    runtimeIndexState.status !== 'building'
  ) {
    startIndexBuild();
  }

  const runtimeBuilding = runtimeIndexState.status === 'building';
  const runtimeError = runtimeIndexState.status === 'error' && !currentMeta;
  const indexStatus: LauncherSemanticIndexStatus = runtimeBuilding
    ? 'building'
    : runtimeError
      ? 'error'
      : currentMeta
        ? 'ready'
        : 'missing';

  return {
    ollamaAvailable: modelState.available,
    modelInstalled: modelState.installed,
    model: LAUNCHER_EMBEDDING_MODEL,
    indexStatus,
    applicationCount: Number(currentMeta?.applicationCount || 0),
    generatedAt: currentMeta ? Number(currentMeta.generatedAt || 0) : undefined,
    stage: runtimeBuilding ? runtimeIndexState.stage : undefined,
    completed: runtimeBuilding ? runtimeIndexState.completed : undefined,
    total: runtimeBuilding ? runtimeIndexState.total : undefined,
    error: runtimeError ? runtimeIndexState.error : undefined,
  };
}

/** Asks the system Ollama service to download the required model and starts indexing. */
export async function installLauncherSemanticModel(
  discoveryOptions: LauncherDiscoveryOptions = {},
): Promise<LauncherSemanticStatus> {
  const modelState = await readOllamaModelState(true);
  if (!modelState.available) throw new Error('The system Ollama service is not available');
  if (!modelState.installed) {
    const response = await fetch(`${normalizedOllamaUrl()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LAUNCHER_EMBEDDING_MODEL, stream: false }),
    });
    if (!response.ok) throw await responseError(response, 'Ollama model download failed');
    const pullResult = (await response.json().catch(() => ({}))) as {
      status?: unknown;
      error?: unknown;
    };
    if (pullResult.error) {
      throw new Error(`Ollama model download failed: ${String(pullResult.error)}`);
    }
  }
  cachedModelState = null;
  const refreshed = await readOllamaModelState(true);
  if (!refreshed.installed)
    throw new Error('Ollama did not report the embedding model as installed');
  runtimeIndexState = {
    status: 'missing',
    stage: '',
    completed: 0,
    total: 0,
    error: '',
  };
  startIndexBuild(discoveryOptions);
  return getLauncherSemanticStatus(false);
}

/** Rebuilds the semantic application index while preserving the previous complete index on error. */
export async function rebuildLauncherSemanticIndex(): Promise<LauncherSemanticStatus> {
  const modelState = await readOllamaModelState(true);
  if (!modelState.available) throw new Error('The system Ollama service is not available');
  if (!modelState.installed)
    throw new Error(`Ollama model ${LAUNCHER_EMBEDDING_MODEL} is not installed`);
  cachedApplications = null;
  runtimeIndexState = {
    status: 'missing',
    stage: '',
    completed: 0,
    total: 0,
    error: '',
  };
  startIndexBuild();
  return getLauncherSemanticStatus(false);
}

/** Embeds one launcher query and ranks the encrypted application vectors by cosine similarity. */
export async function searchLauncherSemanticIndex(
  query: unknown,
  limit: unknown = 20,
): Promise<LauncherSemanticSearchResult[]> {
  const normalizedQuery = String(query || '')
    .trim()
    .slice(0, 1000);
  if (!normalizedQuery) return [];
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
  const applications = await loadStoredApplications();
  if (!applications.length) return [];
  const [queryEmbedding] = await embedTexts([
    `Instruct: Retrieve installed applications that best match the user's requested task.\nQuery: ${normalizedQuery}`,
  ]);
  const normalizedQueryEmbedding = normalizedVector(queryEmbedding);

  return applications
    .map((application) => ({
      ...metadataFromStored(application),
      score: cosineSimilarity(normalizedQueryEmbedding, application.embedding),
    }))
    .filter((application) => application.name && application.executable && application.score > -1)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, boundedLimit);
}

/** Cancels the active application-index build without deleting a previously completed index. */
export async function cancelLauncherSemanticIndex(): Promise<LauncherSemanticStatus> {
  indexGeneration += 1;
  runtimeIndexState = {
    status: 'missing',
    stage: '',
    completed: 0,
    total: 0,
    error: '',
  };
  return getLauncherSemanticStatus(false);
}

/** Cancels active indexing and clears bridge-memory copies before encrypted data is deleted. */
export async function clearLauncherSemanticRuntimeCache(): Promise<void> {
  indexGeneration += 1;
  const activeBuild = indexBuildPromise;
  if (activeBuild) await activeBuild.catch(() => undefined);
  cachedApplications = null;
  runtimeIndexState = {
    status: 'missing',
    stage: '',
    completed: 0,
    total: 0,
    error: '',
  };
}
