// @ts-nocheck
/**
 * Provides the shared implementation behind the local bridge route modules. Active internal
 * persistence delegates to the encrypted SQLite repositories; filesystem operations in this
 * module are reserved for explicit user-directed files and compatibility cleanup helpers.
 */
import { exec, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import Fuse from 'fuse.js';
import { search as ddgSearch, SafeSearchType, SearchTimeType } from 'duck-duck-scrape';
import {
  getDuckDuckGoBrowserProviderState,
  searchDuckDuckGoWithBrowser,
} from './duckDuckGoBrowserProvider.js';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { BUILTIN_SKILLS } from '../../builtinSkills.js';
import { AGENT_TASK_RESULT_TTL_MS, pruneExpiredTaskResults } from '../shared/agentBusShared.js';
import { acquireOperation } from '../shared/operationLimiter.js';
import { atomicWriteFile, atomicWriteJson } from '../shared/atomicFile.js';
import { isExcludedDirectoryName } from '../shared/fileExclusions.js';
import {
  appendEncryptedChatMessage,
  createEncryptedChat,
  deleteEncryptedChat,
  deleteEncryptedStoreKey,
  deleteEncryptedUserSkill,
  getEncryptedChat,
  listEncryptedArtifacts,
  listEncryptedChats,
  listEncryptedSkillProfiles,
  listEncryptedUserSkills,
  readEncryptedArtifact,
  readEncryptedChatMemory,
  readEncryptedChatRecall,
  readEncryptedStoreAll,
  readEncryptedSubagentOutput,
  saveEncryptedArtifact,
  saveEncryptedChatCompacted,
  setEncryptedChatTitle,
  upsertEncryptedUserSkill,
  writeEncryptedChatMemory,
  writeEncryptedStoreKey,
  writeEncryptedSubagentOutput,
} from '../storage/encryptedDatabase.js';
import {
  assertInternalStoragePath,
  ensureInternalStorageDirectory,
  resolveDirectoryWithinRoot,
} from '../shared/filesystemBoundary.js';
import {
  commandExists as structuredCommandExists,
  runProcess as runStructuredProcess,
} from '../shared/processExecution.js';
import { openSafeRemoteResponse, safeRemoteRequestBuffer } from '../shared/networkSecurity.js';
import {
  createProviderProxyRequestPolicy,
  normalizeProviderProxyHeaders,
} from '../shared/providerProxyPolicy.js';

export const execAsync = promisify(exec);

export const MAX_BODY_SIZE = 2 * 1024 * 1024;
export const MAX_OUTPUT_SIZE = 50 * 1024;
export const MAX_TREE_ENTRIES = 200;
export const DEFAULT_TREE_DEPTH = 3;
export const DEFAULT_FIND_DEPTH = 5;
export const MAX_FIND_DEPTH = 8;
export const DEFAULT_FIND_RESULTS = 24;
export const MAX_FIND_RESULTS = 80;
export const DEFAULT_READ_LINE_COUNT = 1000;

export const MAX_READ_LINE_COUNT = 8000;
export const MAX_READ_CHARS = 400000;
export const DEFAULT_FIND_FUZZY_THRESHOLD = 0.42;
export const MAX_FIND_FILES_SCANNED = 4000;
export const MAX_FIND_FUZZY_CANDIDATES = 1800;
export const MAX_FIND_FILE_BYTES = 1500000;

export const DEFAULT_PROXY_TIMEOUT_MS = 16000;
export const MAX_PROXY_TIMEOUT_MS = 120000;
export const MAX_PROXY_RESPONSE_CHARS = 200000;
export const MAX_PROXY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_PROXY_STREAM_BYTES = 16 * 1024 * 1024;
export const DEFAULT_PROXY_IDLE_TIMEOUT_MS = 30000;

export const DEFAULT_WEB_SEARCH_RESULTS = 6;
export const MAX_WEB_SEARCH_RESULTS = 16;
export const DEFAULT_WEB_SOURCE_COUNT = 4;
export const MAX_WEB_SOURCE_COUNT = 10;
export const DEFAULT_WEB_FETCH_TIMEOUT_MS = 16000;
export const MAX_WEB_FETCH_TIMEOUT_MS = 45000;
export const MAX_WEB_HTML_CHARS = 500000;
export const MAX_WEB_TEXT_CHARS = 30000;
export const WEB_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const WEB_RESEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
export const WEB_RESEARCH_STALE_CACHE_TTL_MS = 90 * 60 * 1000;
export const WEB_RESEARCH_CACHE_MAX_ENTRIES = 40;
export const WEB_SEARCH_MIN_INTERVAL_MS = 1200;
export const WEB_SEARCH_RATE_LIMIT_COOLDOWN_MS = 25000;
export const WEB_SEARCH_MAX_ATTEMPTS = 2;
export const WEB_SEARCH_RETRY_BASE_DELAY_MS = 1200;

export const WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER = 'duckduckgo';
export const WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS = [
  'google_cse',
  'tavily',
  'exa',
  'serper',
  'brave',
  'serpapi',
];
export const WEB_SEARCH_PAID_PROVIDER_IDS = new Set([
  'google_cse',
  'tavily',
  'exa',
  'serper',
  'brave',
  'serpapi',
]);
export const WEB_SEARCH_KNOWN_PROVIDERS = new Set([
  'duckduckgo',
  'google_cse',
  'tavily',
  'exa',
  'serper',
  'brave',
  'serpapi',
]);

export const DOCUMENTS_ALIAS_TOKENS = new Set([
  'doc',
  'docs',
  'document',
  'documents',
  'mydocument',
  'mydocuments',
]);
export const FIND_QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
  'project',
  'folder',
  'file',
  'files',
  'directory',
  'documents',
  'document',
  'doc',
  'docs',
]);

export const MAX_AUTOMATION_ACTIONS = 30;
export const MAX_AUTOMATION_TEXT_LENGTH = 2000;
export const MAX_AUTOMATION_WAIT_MS = 20000;
export const AUTOMATION_KEY_REGEX = /^[a-zA-Z0-9_+\-]+(?:\+[a-zA-Z0-9_+\-]+)*$/;

export const LOCAL_AI_DISCOVERY_TIMEOUT_MS = 2500;
export const LOCAL_AI_DISCOVERY_CANDIDATES = [
  { kind: 'ollama', url: 'http://127.0.0.1:11434', checkPath: '/api/tags' },
  { kind: 'lmstudio', url: 'http://127.0.0.1:1234', checkPath: '/v1/models' },
  { kind: 'openwebui', url: 'http://127.0.0.1:3000', checkPath: '/api/models' },
  { kind: 'koboldcpp', url: 'http://127.0.0.1:5001', checkPath: '/v1/models' },
];

// Legacy path constants retained for compatibility helpers and cleanup tests. Runtime
// application persistence uses storage/encryptedDatabase.ts.
export const SKILLS_ROOT_DIR = path.join(os.homedir(), '.iris-ai', 'skills');
export const STORE_ROOT_DIR = path.join(os.homedir(), '.iris-ai', 'store');
export const ARTIFACTS_ROOT_DIR = path.join(os.homedir(), '.iris-ai', 'artifacts');
export const PROFILE_NAME_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SKILL_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,79}$/;

// Canonical built-in skill library. Built-ins remain packaged resources; encrypted
// SQLite stores only user-created skills, overrides, and disabled markers.
export const BUILT_IN_SKILLS = BUILTIN_SKILLS;

export const WEB_PROVIDER_REQUEST_STATE = new Map();
export const WEB_RESEARCH_CACHE = new Map();

export function webResearchAbortError() {
  const error = new Error('Search cancelled');
  error.name = 'AbortError';
  return error;
}

export function throwIfWebResearchAborted(signal) {
  if (signal?.aborted) throw webResearchAbortError();
}

export function emitWebResearchProgress(context, type, message, detail = {}) {
  if (typeof context?.onProgress !== 'function') return;
  context.onProgress({
    type,
    message,
    ...detail,
  });
}

export function waitForWebResearch(milliseconds, signal) {
  throwIfWebResearchAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, Number(milliseconds) || 0),
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(webResearchAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ── Multi-Agent Orchestration Bus (in-process, no network hop) ─────────────────

export { AGENT_TASK_RESULT_TTL_MS };
export const AGENT_SUSPEND_THRESHOLD = 3;
export const AGENT_SUSPEND_DURATION_MS = 5 * 60 * 1000;

export const agentRoster = new Map(); // agentId → { status, lastSeen, capabilities, health }
export const agentTaskQueue = new Map(); // agentId → Task[]
export const agentTaskResults = new Map(); // taskId  → Result
export const agentTaskTimestamps = new Map(); // taskId  → createdAt
export const agentSSEClients = new Map(); // agentId → Set<res>
export const MAX_ACTIVE_LAUNCH_PROCESSES = 64;
export const activeLaunchProcesses = new Set();

/**
 * Guarantees that bus agent exists or is initialized before later code relies on it.
 */

export function ensureBusAgent(agentId) {
  if (!agentRoster.has(agentId)) {
    agentRoster.set(agentId, {
      status: 'idle',
      lastSeen: Date.now(),
      capabilities: [],
      health: {
        successRate: 1.0,
        consecutiveFailures: 0,
        suspended: false,
        suspendedUntil: 0,
      },
    });
  }
  if (!agentTaskQueue.has(agentId)) {
    agentTaskQueue.set(agentId, []);
  }
  if (!agentSSEClients.has(agentId)) {
    agentSSEClients.set(agentId, new Set());
  }
}

// Removes expired or excess agent task results so retained in-memory state remains bounded.
export function pruneAgentTaskResults() {
  pruneExpiredTaskResults(
    agentTaskResults,
    agentTaskTimestamps,
    Date.now(),
    AGENT_TASK_RESULT_TTL_MS,
  );
}

// Broadcasts one agent-bus event to the currently connected SSE clients for that agent.
export function agentBusBroadcast(agentId, payload) {
  const clients = agentSSEClients.get(agentId);
  if (!clients || clients.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

// ── Power Tool Constants ───────────────────────────────────────────────────────

export const POWER_TOOL_RG_MAX_RESULTS = 40;
export const POWER_TOOL_STAT_BATCH_MAX = 20;

// Sends JSON using the bridge's stable HTTP response shape.
export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload ?? {});
  res.statusCode = Number.isInteger(statusCode) ? statusCode : 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // SECURITY: the bridge is same-origin with the renderer (both served by the
  // Vite dev/preview server). It must NOT advertise a wildcard CORS policy —
  // doing so let any visited website read local file/terminal/proxy responses.
  // Cross-origin access is rejected at the middleware boundary (see
  // isLoopbackHost / assertLocalRequest below); no CORS header is emitted.
  res.end(body);
}

// ── Local-only request boundary (SSRF / cross-site hardening) ──────────────────
// The bridge exposes file-system, terminal and outbound-proxy capabilities. It is
// only ever meant to be called by the IRIS renderer running on the same
// loopback origin. We reject any request whose Origin/Host is not loopback so a
// malicious web page (or DNS-rebinding host) cannot drive these endpoints.

export function isLoopbackHost(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === '0.0.0.0') return true;
  // IPv4 loopback block 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

// Extracts a normalized hostname from an HTTP Host header.
export function hostnameFromHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    // Works for both "host:port" and full origins like "http://host:port".
    const url = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? new URL(raw) : new URL(`http://${raw}`);
    return url.hostname;
  } catch {
    return raw.split(':')[0];
  }
}

/**
 * Returns true if the request originates from the local renderer.
 * - A missing Origin (same-origin navigations, non-browser callers) is allowed.
 * - A present Origin must be loopback.
 * - The Host header must also be loopback (blocks DNS-rebinding).
 */
export function isLocalBridgeRequest(req) {
  const origin = req.headers?.origin;
  if (origin && !isLoopbackHost(hostnameFromHeader(origin))) return false;

  const host = req.headers?.host;
  // If a Host header is present it must be loopback. (Vite always serves on loopback.)
  if (host && !isLoopbackHost(hostnameFromHeader(host))) return false;

  return true;
}

/** Escape a value for safe embedding in a single-quoted shell argument. */
export function escapeSingleQuotedShellArg(value) {
  return `'${String(value || '').replace(/'/g, "'\\''")}'`;
}

// Attaches an HTTP status to an error so bridge routes can return a stable failure response.
export function withStatus(message, statusCode = 500) {
  const error = new Error(String(message || 'Unexpected local bridge error'));
  error.statusCode = Number.isInteger(statusCode) ? statusCode : 500;
  return error;
}

// Trims text to the size accepted by the local bridge service layer.
export function trimText(value, maxLength = 3000, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.slice(0, Math.max(1, Number(maxLength) || 1));
}

// Trims output to the size accepted by the local bridge service layer.
export function trimOutput(value, maxLength = MAX_OUTPUT_SIZE) {
  const text = String(value || '');
  if (!text) return '';
  const safeMax = Math.max(1, Number(maxLength) || 1);
  return text.length > safeMax ? text.slice(0, safeMax) : text;
}

// Escapes reg exp for safe use in its target representation.
export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Converts find mode into the canonical representation expected by later code.
export function normalizeFindMode(value) {
  const mode = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (mode === 'name' || mode === 'content') return mode;
  return 'auto';
}

// Converts string list into the canonical representation expected by later code.
export function normalizeStringList(
  value,
  maxItems = 20,
  maxItemLength = 140,
  toLowerCase = false,
) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((entry) => entry.trim());

  return raw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxItemLength))
    .map((entry) => (toLowerCase ? entry.toLowerCase() : entry))
    .slice(0, maxItems);
}

// Converts name into a stable filesystem-safe slug.
export function slugifyName(value, fallback = 'default') {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return text || fallback;
}

// Converts profile name into the canonical representation expected by later code.
export function normalizeProfileName(value, fallback = 'default-model') {
  return slugifyName(value, fallback);
}

// Converts skill id into the canonical representation expected by later code.
export function normalizeSkillId(value, fallback = 'skill') {
  const id = slugifyName(value, fallback).slice(0, 80);
  if (SKILL_ID_REGEX.test(id)) return id;
  return fallback;
}

/**
 * Normalizes persisted skill role targeting and accepts legacy role aliases that may still
 * exist on disk. The result is the canonical target used by profile listing and renderer
 * skill selection.
 */

export function normalizeSkillAgentTarget(value) {
  const src = value === undefined ? undefined : value;
  if (Array.isArray(src)) {
    return src
      .map((v) =>
        String(v || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean)
      .slice(0, 6);
  }
  const single = String(src || '')
    .trim()
    .toLowerCase();
  if (!single) return [];
  return single
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Converts a JSON or Markdown skill loaded from disk into the bridge's complete skill
 * record, including provenance and bounded metadata. Malformed files are rejected here so
 * callers never receive partially interpreted persistent behavior.
 */

export function normalizeSkillFromDisk(rawSkill, fallbackId = 'skill') {
  const raw = rawSkill && typeof rawSkill === 'object' ? rawSkill : {};
  const id = normalizeSkillId(raw.id || fallbackId, fallbackId);

  // Structural fields the engine relies on (role targeting, guard injection,
  // model variants, dependency chaining, reflex triggers). Persist them so they
  // survive the save/load round-trip instead of being silently dropped.
  const modelVariants =
    raw.modelVariants && typeof raw.modelVariants === 'object' && !Array.isArray(raw.modelVariants)
      ? raw.modelVariants
      : {};
  const reflexTrigger =
    raw.reflexTrigger && typeof raw.reflexTrigger === 'object' && !Array.isArray(raw.reflexTrigger)
      ? raw.reflexTrigger
      : null;
  const provenance =
    raw.provenance && typeof raw.provenance === 'object' && !Array.isArray(raw.provenance)
      ? {
          source: trimText(raw.provenance.source, 80, ''),
          sourceLabel: trimText(raw.provenance.sourceLabel, 160, ''),
          proposalId: trimText(raw.provenance.proposalId, 80, ''),
          provider: trimText(raw.provenance.provider, 80, ''),
          model: trimText(raw.provenance.model, 160, ''),
          receivedAt: trimText(raw.provenance.receivedAt, 64, ''),
          approvedAt: trimText(raw.provenance.approvedAt, 64, ''),
          approvedBy: trimText(raw.provenance.approvedBy, 80, ''),
        }
      : null;

  return {
    id,
    title: trimText(raw.title || id, 120, id),
    summary: trimText(raw.summary, 500, ''),
    instructions: trimText(raw.instructions, 24000, ''),
    triggers: normalizeStringList(raw.triggers, 24, 80, true),
    examples: normalizeStringList(raw.examples, 16, 500, false),
    enabled: raw.enabled !== false,
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    type: trimText(raw.type, 32, 'standard').toLowerCase() || 'standard',
    agentTarget: normalizeSkillAgentTarget(
      raw.agentTarget ?? raw.agent_target ?? raw.role ?? raw.roles,
    ),
    guard: raw.guard === true,
    dependencies: normalizeStringList(raw.dependencies, 12, 80, false),
    modelVariants,
    reflexTrigger,
    provenance,
    createdAt: trimText(raw.createdAt, 64, new Date().toISOString()),
    updatedAt: trimText(raw.updatedAt, 64, new Date().toISOString()),
  };
}

// ── SKILL.md (Agent Skills open standard) parsing ─────────────────────────────

export function stripYamlScalar(value) {
  let v = String(value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/**
 * Parse a SKILL.md file (open standard: YAML-ish frontmatter + markdown body)
 * into the raw skill shape consumed by normalizeSkillFromDisk. Frontmatter
 * supplies name/description/triggers/etc.; the markdown body is the instructions.
 * Supports scalar, inline-list (`[a, b]`), and block-list (`- item`) frontmatter.
 */
export function parseSkillMarkdown(content, fallbackId = 'skill') {
  const text = String(content || '').replace(/^﻿/, '');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);

  if (!match) {
    return { id: fallbackId, title: fallbackId, instructions: text.trim() };
  }

  const [, fmBlock, body] = match;
  const meta = {};
  let currentListKey = null;

  // Keys whose values may be JSON-encoded (arrays/objects) by our writer — these
  // round-trip the structural fields the engine relies on (lists, modelVariants,
  // reflexTrigger). Restricted so a scalar title/description starting with [ or {
  // is never mis-parsed as JSON.
  const COMPLEX_KEYS = new Set([
    'triggers',
    'examples',
    'dependencies',
    'agenttarget',
    'roles',
    'modelvariants',
    'reflextrigger',
    'provenance',
  ]);

  for (const line of fmBlock.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      if (!Array.isArray(meta[currentListKey])) meta[currentListKey] = [];
      meta[currentListKey].push(stripYamlScalar(listItem[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1].trim();
    const rawValue = kv[2].trim();

    if (rawValue === '') {
      meta[key] = [];
      currentListKey = key;
      continue;
    }

    // JSON-encoded array/object (canonical round-trip form) for complex keys.
    const looksJson =
      (rawValue.startsWith('[') && rawValue.endsWith(']')) ||
      (rawValue.startsWith('{') && rawValue.endsWith('}'));
    if (COMPLEX_KEYS.has(key.toLowerCase()) && looksJson) {
      try {
        meta[key] = JSON.parse(rawValue);
        currentListKey = null;
        continue;
      } catch {
        /* fall through to list/scalar */
      }
    }

    const inlineList = rawValue.match(/^\[(.*)\]$/);
    if (inlineList) {
      meta[key] = inlineList[1]
        .split(',')
        .map((s) => stripYamlScalar(s))
        .filter(Boolean);
    } else {
      meta[key] = stripYamlScalar(rawValue);
    }
    currentListKey = null;
  }

  const name = String(meta.name || fallbackId).trim() || fallbackId;
  return {
    id: meta.id || name,
    title: meta.title || name,
    summary: meta.description || meta.summary || '',
    instructions: String(body || '').trim(),
    triggers: meta.triggers,
    examples: meta.examples,
    priority: meta.priority,
    enabled: meta.enabled === undefined ? true : meta.enabled !== 'false' && meta.enabled !== false,
    type: meta.type,
    agentTarget: meta.agentTarget ?? meta.role ?? meta.roles,
    guard: meta.guard === true || meta.guard === 'true',
    // Bespoke structural fields preserved for a lossless round-trip (the engine
    // uses these; they are not part of the minimal open standard but valid extra
    // frontmatter). normalizeSkillFromDisk reads each of these.
    dependencies: meta.dependencies,
    modelVariants: meta.modelVariants,
    reflexTrigger: meta.reflexTrigger,
    provenance: meta.provenance,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

/**
 * Serialize a normalized skill into SKILL.md (Agent Skills open standard:
 * YAML-ish frontmatter + markdown body). Inverse of parseSkillMarkdown — keeps
 * the bespoke structural fields (dependencies/modelVariants/reflexTrigger) so the
 * save→load round-trip is lossless. Lists/objects are emitted as compact JSON,
 * which the parser decodes for COMPLEX_KEYS.
 */
export function serializeSkillToMarkdown(skill) {
  const s = skill && typeof skill === 'object' ? skill : {};
  const fm = [];
  const scalar = (k, v) => {
    if (v !== undefined && v !== null && v !== '') fm.push(`${k}: ${String(v)}`);
  };
  const jsonArr = (k, v) => {
    if (Array.isArray(v) && v.length) fm.push(`${k}: ${JSON.stringify(v)}`);
  };
  // Adds a non-empty object field to skill frontmatter as compact JSON.
  const jsonObj = (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length)
      fm.push(`${k}: ${JSON.stringify(v)}`);
  };

  scalar('name', s.id); // open standard: `name` is the skill identifier
  scalar('id', s.id);
  scalar('title', s.title);
  scalar('description', s.summary);
  scalar('type', s.type || 'standard');
  scalar('priority', Number.isFinite(Number(s.priority)) ? Number(s.priority) : 0);
  fm.push(`enabled: ${s.enabled !== false}`);
  if (s.guard === true) fm.push('guard: true');
  jsonArr('triggers', s.triggers);
  jsonArr('agentTarget', s.agentTarget);
  jsonArr('dependencies', s.dependencies);
  jsonArr('examples', s.examples);
  jsonObj('modelVariants', s.modelVariants);
  jsonObj('reflexTrigger', s.reflexTrigger);
  jsonObj('provenance', s.provenance);
  scalar('createdAt', s.createdAt);
  scalar('updatedAt', s.updatedAt);
  // Stamp for built-in seeds only: lets ensureBuiltInSkills refresh a pristine
  // built-in when its code definition changes, while leaving user-edited copies
  // (whose on-disk signature no longer matches the stamp) untouched.
  scalar('builtinHash', s.builtinHash);

  const body = String(s.instructions || '').trim();
  return `---\n${fm.join('\n')}\n---\n\n${body}\n`;
}

// Content signature over a skill's SEMANTIC fields only (no timestamps, no the
// stamp itself), so it's stable across re-serialization and changes exactly when
// the meaningful content does. Computed identically for a code built-in and a
// parsed on-disk skill (both are normalizeSkillFromDisk shapes).
export function builtinSkillSignature(skill) {
  const s = skill && typeof skill === 'object' ? skill : {};
  const canonical = JSON.stringify([
    s.id || '',
    s.title || '',
    s.summary || '',
    s.instructions || '',
    Array.isArray(s.triggers) ? s.triggers : [],
    Array.isArray(s.examples) ? s.examples : [],
    Number(s.priority) || 0,
    s.type || 'standard',
    s.guard === true,
    Array.isArray(s.agentTarget) ? s.agentTarget : [],
    Array.isArray(s.dependencies) ? s.dependencies : [],
    s.modelVariants && typeof s.modelVariants === 'object' ? s.modelVariants : {},
    s.reflexTrigger && typeof s.reflexTrigger === 'object' ? s.reflexTrigger : null,
  ]);
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Read an existing skill by id from its canonical SKILL.md directory, falling
 * back to the legacy `<id>.json` flat file. Returns null when neither exists.
 */
export async function readExistingSkill(profileDir, id) {
  const skillDir = await assertInternalStoragePath(profileDir, path.join(profileDir, id), {
    writable: true,
  });
  const legacyPath = await assertInternalStoragePath(
    profileDir,
    path.join(profileDir, `${id}.json`),
    {
      writable: true,
    },
  );
  try {
    const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    return normalizeSkillFromDisk(parseSkillMarkdown(content, id), id);
  } catch {
    /* no canonical SKILL.md */
  }
  try {
    const raw = await fs.readFile(legacyPath, 'utf8');
    return normalizeSkillFromDisk(JSON.parse(raw), id);
  } catch {
    /* no legacy json */
  }
  return null;
}

// Converts skill for storage into the canonical representation expected by later code.
export function normalizeSkillForStorage(skillInput, existingSkill = null) {
  const existing = existingSkill && typeof existingSkill === 'object' ? existingSkill : null;
  const merged = {
    ...(existing || {}),
    ...(skillInput && typeof skillInput === 'object' ? skillInput : {}),
  };

  const normalized = normalizeSkillFromDisk(merged, existing?.id || merged.id || 'skill');
  normalized.createdAt = existing?.createdAt || normalized.createdAt;
  normalized.updatedAt = new Date().toISOString();
  return normalized;
}

// Match a `builtinHash: <hex>` line in the SKILL.md frontmatter (the stamp we
// wrote at seed time). Absent on legacy seeds and on user-authored skills.
export const BUILTIN_HASH_LINE = /^builtinHash:\s*([a-f0-9]+)\s*$/m;

/**
 * Guarantees that built in skills exists or is initialized before later code relies on it.
 */

export async function ensureBuiltInSkills(profileDir) {
  if (!Array.isArray(BUILT_IN_SKILLS) || BUILT_IN_SKILLS.length === 0) {
    return;
  }

  await Promise.all(
    BUILT_IN_SKILLS.map(async (entry) => {
      const normalized = normalizeSkillForStorage(entry);
      const currentSig = builtinSkillSignature(normalized);
      const skillDir = await assertInternalStoragePath(
        profileDir,
        path.join(profileDir, normalized.id),
        {
          writable: true,
        },
      );
      const mdPath = path.join(skillDir, 'SKILL.md');
      const legacyJson = await assertInternalStoragePath(
        profileDir,
        path.join(profileDir, `${normalized.id}.json`),
        {
          writable: true,
        },
      );

      // Writes seed while preserving the storage and boundary rules owned by the local bridge
      // service layer.
      const writeSeed = async () => {
        await ensureInternalStorageDirectory(skillDir);
        await atomicWriteFile(
          mdPath,
          serializeSkillToMarkdown({ ...normalized, builtinHash: currentSig }),
          {
            encoding: 'utf8',
          },
        );
      };

      // A legacy <id>.json copy means the skill predates SKILL.md seeding — leave it
      // alone (it may carry user edits) and don't shadow it with a fresh SKILL.md.
      try {
        await fs.access(legacyJson);
        return;
      } catch {
        /* no legacy json */
      }

      let existingRaw = null;
      try {
        existingRaw = await fs.readFile(mdPath, 'utf8');
      } catch {
        /* not seeded yet */
      }

      // First seed for this id → write it with the current stamp.
      if (existingRaw === null) {
        await writeSeed();
        return;
      }

      // Already seeded. Refresh ONLY when the on-disk copy is a pristine built-in
      // (its content still matches the stamp we wrote) AND the code definition has
      // since changed. A missing stamp (legacy) or a drifted signature (user edited
      // it on disk) means we leave it untouched — user edits are never clobbered.
      const stampMatch = existingRaw.match(BUILTIN_HASH_LINE);
      const storedSig = stampMatch ? stampMatch[1] : '';
      if (!storedSig) return; // legacy/user-owned — preserve

      let onDiskSig = '';
      try {
        onDiskSig = builtinSkillSignature(
          normalizeSkillFromDisk(parseSkillMarkdown(existingRaw, normalized.id), normalized.id),
        );
      } catch {
        return;
      } // unparseable — don't risk overwriting

      if (onDiskSig !== storedSig) return; // user edited since seed — preserve
      if (storedSig === currentSig) return; // pristine and already current — nothing to do
      await writeSeed(); // pristine + built-in changed — refresh
    }),
  );
}

// Converts web provider id into the canonical representation expected by later code.
export function normalizeWebProviderId(value, fallback = WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  if (!token) return fallback;

  if (token === 'google') return 'google_cse';
  if (token === 'ddg') return 'duckduckgo';
  return WEB_SEARCH_KNOWN_PROVIDERS.has(token) ? token : fallback;
}

/**
 * Builds the ordered provider chain used by bridge web research from primary and fallback
 * configuration. Unsupported names and duplicates are removed before the search workflow
 * begins.
 */

export function normalizeWebProviderList(
  value,
  fallbackList = WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const output = [];

  raw.forEach((entry) => {
    const providerId = normalizeWebProviderId(entry, '');
    if (!providerId || seen.has(providerId)) return;
    seen.add(providerId);
    output.push(providerId);
  });

  if (output.length) return output;

  const fallbackSeen = new Set();
  return (Array.isArray(fallbackList) ? fallbackList : [])
    .map((entry) => normalizeWebProviderId(entry, ''))
    .filter((entry) => {
      if (!entry || fallbackSeen.has(entry)) return false;
      fallbackSeen.add(entry);
      return true;
    });
}

// Converts api secret into the canonical representation expected by later code.
export function normalizeApiSecret(value, maxLength = 300) {
  return String(value || '')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

// Converts web provider settings into the canonical representation expected by later code.
export function normalizeWebProviderSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    googleCseApiKey: normalizeApiSecret(
      source.googleCseApiKey || source.search_web_google_cse_api_key,
      320,
    ),
    googleCseCx: normalizeApiSecret(source.googleCseCx || source.search_web_google_cse_cx, 180),
    tavilyApiKey: normalizeApiSecret(source.tavilyApiKey || source.search_web_tavily_api_key, 320),
    exaApiKey: normalizeApiSecret(source.exaApiKey || source.search_web_exa_api_key, 320),
    serperApiKey: normalizeApiSecret(source.serperApiKey || source.search_web_serper_api_key, 320),
    serpApiApiKey: normalizeApiSecret(
      source.serpApiApiKey || source.search_web_serpapi_api_key,
      320,
    ),
    braveApiKey: normalizeApiSecret(source.braveApiKey || source.search_web_brave_api_key, 320),
  };
}

/**
 * Evaluates whether has web provider credentials for the supplied value and current runtime
 * state.
 */

export function hasWebProviderCredentials(providerId, providerSettings) {
  switch (providerId) {
    case 'duckduckgo':
      return true;
    case 'google_cse':
      return Boolean(providerSettings.googleCseApiKey && providerSettings.googleCseCx);
    case 'tavily':
      return Boolean(providerSettings.tavilyApiKey);
    case 'exa':
      return Boolean(providerSettings.exaApiKey);
    case 'serper':
      return Boolean(providerSettings.serperApiKey);
    case 'brave':
      return Boolean(providerSettings.braveApiKey);
    case 'serpapi':
      return Boolean(providerSettings.serpApiApiKey);
    default:
      return false;
  }
}

/**
 * Selects or derives web provider plan from the available settings, input, and runtime
 * context.
 */

export function resolveWebProviderPlan(options = {}) {
  const providerPolicy =
    options.providerPolicy && typeof options.providerPolicy === 'object'
      ? options.providerPolicy
      : {};

  const primaryProvider = normalizeWebProviderId(
    providerPolicy.primaryProvider || options.primaryProvider,
    WEB_SEARCH_DEFAULT_PRIMARY_PROVIDER,
  );

  const fallbackProviders = normalizeWebProviderList(
    providerPolicy.fallbackProviders || options.fallbackProviders,
    WEB_SEARCH_DEFAULT_FALLBACK_PROVIDERS,
  ).filter((providerId) => providerId !== primaryProvider);

  const allowPaidFallback =
    providerPolicy.allowPaidFallback === true || options.allowPaidFallback === true;
  const providerSettings = normalizeWebProviderSettings(options.providerSettings);

  const orderedCandidates = [primaryProvider, ...fallbackProviders];
  const orderedProviders = [];
  const blockedPaidProviders = [];
  const skippedProviders = [];

  orderedCandidates.forEach((providerId, index) => {
    if (!providerId) return;

    const configured = hasWebProviderCredentials(providerId, providerSettings);
    if (!configured) {
      skippedProviders.push({
        provider: providerId,
        reason: 'missing_credentials',
      });
      return;
    }

    const isPaidFallback = index > 0 && WEB_SEARCH_PAID_PROVIDER_IDS.has(providerId);
    if (isPaidFallback && !allowPaidFallback) {
      blockedPaidProviders.push(providerId);
      return;
    }

    if (!orderedProviders.includes(providerId)) {
      orderedProviders.push(providerId);
    }
  });

  return {
    primaryProvider,
    fallbackProviders,
    orderedProviders,
    blockedPaidProviders,
    skippedProviders,
    allowPaidFallback,
    providerSettings,
  };
}

// Returns web provider request state without requiring callers to know where or how it is stored.
export function getWebProviderRequestState(providerId) {
  const id = String(providerId || '')
    .trim()
    .toLowerCase();
  if (!id) return { lastRequestAt: 0, cooldownUntil: 0 };

  const existing = WEB_PROVIDER_REQUEST_STATE.get(id);
  if (existing) return existing;

  const created = {
    lastRequestAt: 0,
    cooldownUntil: 0,
  };

  WEB_PROVIDER_REQUEST_STATE.set(id, created);
  return created;
}

// Interprets retry after ms and turns the source representation into structured application data.
export function parseRetryAfterMs(error) {
  const text = String(error?.message || '').toLowerCase();
  const retrySeconds = text.match(/retry in(?: about)?\s+(\d+)s/);
  if (retrySeconds) {
    return Math.max(0, Number(retrySeconds[1]) * 1000);
  }

  return 0;
}

// Maps time range to google date restrict into the representation required by another layer.
export function mapTimeRangeToGoogleDateRestrict(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'day' || normalized === 'd') return 'd1';
  if (normalized === 'week' || normalized === 'w') return 'w1';
  if (normalized === 'month' || normalized === 'm') return 'm1';
  if (normalized === 'year' || normalized === 'y') return 'y1';
  return '';
}

// Interprets hostname from URL and turns the source representation into structured application
// data.
export function parseHostnameFromUrl(url) {
  try {
    return String(new URL(String(url || '')).hostname || '');
  } catch {
    return '';
  }
}

/**
 * Combines search-provider results into a bounded, duplicate-free list with normalized
 * titles, URLs, snippets, and source metadata. This gives later extraction and ranking
 * stages one consistent external-result shape.
 */

export function normalizeDiscoveryResults(results, maxResults) {
  const list = Array.isArray(results) ? results : [];
  const output = [];
  const seenUrls = new Set();

  for (const item of list) {
    const url = String(item?.url || item?.link || '').trim();
    if (!url || seenUrls.has(url)) continue;

    seenUrls.add(url);
    output.push({
      rank: output.length + 1,
      title:
        normalizeSingleLine(decodeHtmlEntities(stripHtmlTags(item?.title || '')), 260) ||
        'Untitled Source',
      url,
      hostname: normalizeSingleLine(item?.hostname || parseHostnameFromUrl(url), 120),
      snippet: normalizeSingleLine(
        decodeHtmlEntities(
          stripHtmlTags(item?.snippet || item?.description || item?.content || ''),
        ),
        420,
      ),
    });

    if (output.length >= maxResults) break;
  }

  return output;
}

// Retrieves remote JSON with timeout and converts it into the application's expected result shape.
export async function fetchRemoteJsonWithTimeout(
  targetUrl,
  { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_WEB_FETCH_TIMEOUT_MS, signal } = {},
) {
  const safeTimeout = parseNumber(
    timeoutMs,
    DEFAULT_WEB_FETCH_TIMEOUT_MS,
    2500,
    MAX_WEB_FETCH_TIMEOUT_MS,
  );
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const requestBody =
    body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

  try {
    const response = await safeRemoteRequestBuffer(targetUrl, {
      method: normalizedMethod,
      headers,
      body: requestBody,
      signal,
      policy: {
        addressMode: 'public',
        allowedProtocols: ['https:', 'http:'],
        allowedMethods: ['GET', 'POST'],
        allowCrossOriginRedirects: false,
        maxRedirects: 2,
        timeoutMs: safeTimeout,
        idleTimeoutMs: Math.min(15000, safeTimeout),
        maxResponseBytes: 1024 * 1024,
      },
    });

    const rawText = response.bytes.toString('utf8');
    let parsed = null;
    if (rawText && /^\s*[\[{]/.test(rawText)) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }
    }

    if (response.truncated) {
      throw withStatus('Remote JSON response exceeded the configured byte limit', 502);
    }
    if (response.status < 200 || response.status >= 300) {
      const providerMessage = String(
        parsed?.error?.message ||
          parsed?.message ||
          parsed?.error ||
          rawText ||
          `HTTP ${response.status}`,
      ).slice(0, 280);
      throw withStatus(providerMessage, response.status || 502);
    }

    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (Number(error?.statusCode || error?.status || 0) > 0) throw error;
    throw withStatus(`Remote request failed: ${error?.message || 'network error'}`, 502);
  }
}

/** Retained package-backed DuckDuckGo implementation used for explicit rollback or fallback. */
export async function searchWithLegacyDuckDuckGoProvider(query, context) {
  const response = await ddgSearch(query, {
    safeSearch: context.safeSearch,
    locale: context.locale,
    region: context.region,
    time: context.time,
  });

  const results = normalizeDiscoveryResults(
    Array.isArray(response?.results)
      ? response.results.map((entry) => ({
          title: entry?.title,
          url: entry?.url,
          hostname: entry?.hostname,
          snippet: entry?.description || entry?.rawDescription,
        }))
      : [],
    context.maxResults,
  );

  const relatedQueries = Array.isArray(response?.related)
    ? response.related
        .map((entry) => normalizeSingleLine(entry?.text || entry?.raw || '', 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    providerId: 'duckduckgo',
    transport: 'legacy-package',
    results,
    relatedQueries,
  };
}

/**
 * Uses Electron's hidden Chromium window for normal DuckDuckGo web results. The old package path
 * remains available behind IRIS_DDG_SEARCH_MODE=legacy; auto mode tries Chromium first and then
 * falls back to the package without changing any renderer or agent contracts.
 */
export async function searchWithDuckDuckGoProvider(query, context) {
  const browserState = getDuckDuckGoBrowserProviderState();
  if (browserState.mode !== 'legacy') {
    try {
      const response = await searchDuckDuckGoWithBrowser({
        query,
        maxResults: context.maxResults,
        safeSearch: context.safeSearchLabel,
        timeRange: context.timeRangeLabel,
        locale: context.locale,
        region: context.region,
        signal: context.signal,
        onProgress: context.onProgress,
      });

      return {
        providerId: 'duckduckgo',
        transport: 'electron-browser',
        results: normalizeDiscoveryResults(response?.results || [], context.maxResults),
        relatedQueries: Array.isArray(response?.relatedQueries)
          ? response.relatedQueries
              .map((entry) => normalizeSingleLine(entry, 120))
              .filter(Boolean)
              .slice(0, 8)
          : [],
      };
    } catch (error) {
      if (browserState.mode !== 'auto') throw error;
    }
  }

  return searchWithLegacyDuckDuckGoProvider(query, context);
}

// Provides search with google cse state and actions to descendant renderer components.
export async function searchWithGoogleCseProvider(query, context) {
  const params = new URLSearchParams({
    key: context.providerSettings.googleCseApiKey,
    cx: context.providerSettings.googleCseCx,
    q: query,
    num: String(Math.max(1, Math.min(10, context.maxResults))),
    safe: context.safeSearchLabel === 'strict' ? 'active' : 'off',
  });

  const dateRestrict = mapTimeRangeToGoogleDateRestrict(context.timeRangeLabel);
  if (dateRestrict) {
    params.set('dateRestrict', dateRestrict);
  }

  const localeToken = String(context.locale || '').split(/[-_]/)[0];
  if (localeToken) {
    params.set('hl', localeToken);
  }

  const data = await fetchRemoteJsonWithTimeout(
    `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
    {
      method: 'GET',
      timeoutMs: context.fetchTimeoutMs,
    },
  );

  const results = normalizeDiscoveryResults(
    Array.isArray(data?.items)
      ? data.items.map((entry) => ({
          title: entry?.title,
          url: entry?.link,
          snippet: entry?.snippet,
        }))
      : [],
    context.maxResults,
  );

  return {
    providerId: 'google_cse',
    results,
    relatedQueries: [],
  };
}

// Provides search with tavily state and actions to descendant renderer components.
export async function searchWithTavilyProvider(query, context) {
  const data = await fetchRemoteJsonWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      api_key: context.providerSettings.tavilyApiKey,
      query,
      max_results: Math.max(1, Math.min(20, context.maxResults)),
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    },
    timeoutMs: context.fetchTimeoutMs,
  });

  const results = normalizeDiscoveryResults(
    Array.isArray(data?.results)
      ? data.results.map((entry) => ({
          title: entry?.title,
          url: entry?.url,
          snippet: entry?.content,
        }))
      : [],
    context.maxResults,
  );

  const relatedQueries = Array.isArray(data?.follow_up_questions)
    ? data.follow_up_questions
        .map((entry) => normalizeSingleLine(entry, 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    providerId: 'tavily',
    results,
    relatedQueries,
  };
}

// Provides search with exa state and actions to descendant renderer components.
export async function searchWithExaProvider(query, context) {
  const data = await fetchRemoteJsonWithTimeout('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': context.providerSettings.exaApiKey,
    },
    body: {
      query,
      numResults: Math.max(1, Math.min(25, context.maxResults)),
      useAutoprompt: true,
    },
    timeoutMs: context.fetchTimeoutMs,
  });

  const results = normalizeDiscoveryResults(
    Array.isArray(data?.results)
      ? data.results.map((entry) => ({
          title: entry?.title,
          url: entry?.url,
          snippet: entry?.text || entry?.snippet,
        }))
      : [],
    context.maxResults,
  );

  return {
    providerId: 'exa',
    results,
    relatedQueries: [],
  };
}

// Provides search with serper state and actions to descendant renderer components.
export async function searchWithSerperProvider(query, context) {
  const data = await fetchRemoteJsonWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': context.providerSettings.serperApiKey,
    },
    body: {
      q: query,
      num: Math.max(1, Math.min(10, context.maxResults)),
    },
    timeoutMs: context.fetchTimeoutMs,
  });

  const results = normalizeDiscoveryResults(
    Array.isArray(data?.organic)
      ? data.organic.map((entry) => ({
          title: entry?.title,
          url: entry?.link,
          snippet: entry?.snippet,
        }))
      : [],
    context.maxResults,
  );

  const relatedQueries = Array.isArray(data?.relatedSearches)
    ? data.relatedSearches
        .map((entry) => normalizeSingleLine(entry?.query || entry, 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    providerId: 'serper',
    results,
    relatedQueries,
  };
}

// Provides search with brave state and actions to descendant renderer components.
export async function searchWithBraveProvider(query, context) {
  const params = new URLSearchParams({
    q: query,
    count: String(Math.max(1, Math.min(20, context.maxResults))),
  });

  const localeToken = String(context.locale || '').split(/[-_]/)[0];
  if (localeToken) {
    params.set('search_lang', localeToken);
  }

  const data = await fetchRemoteJsonWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': context.providerSettings.braveApiKey,
      },
      timeoutMs: context.fetchTimeoutMs,
    },
  );

  const results = normalizeDiscoveryResults(
    Array.isArray(data?.web?.results)
      ? data.web.results.map((entry) => ({
          title: entry?.title,
          url: entry?.url,
          snippet: entry?.description,
        }))
      : [],
    context.maxResults,
  );

  const relatedQueries = Array.isArray(data?.query?.altered)
    ? data.query.altered
        .map((entry) => normalizeSingleLine(entry, 120))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    providerId: 'brave',
    results,
    relatedQueries,
  };
}

// Provides search with serp API state and actions to descendant renderer components.
export async function searchWithSerpApiProvider(query, context) {
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    num: String(Math.max(1, Math.min(10, context.maxResults))),
    api_key: context.providerSettings.serpApiApiKey,
  });

  const data = await fetchRemoteJsonWithTimeout(
    `https://serpapi.com/search.json?${params.toString()}`,
    {
      method: 'GET',
      timeoutMs: context.fetchTimeoutMs,
    },
  );

  const results = normalizeDiscoveryResults(
    Array.isArray(data?.organic_results)
      ? data.organic_results.map((entry) => ({
          title: entry?.title,
          url: entry?.link,
          snippet: entry?.snippet,
        }))
      : [],
    context.maxResults,
  );

  return {
    providerId: 'serpapi',
    results,
    relatedQueries: [],
  };
}

/**
 * Runs provider search from initialization through completion, including its cleanup
 * behavior.
 */

export async function runProviderSearch(providerId, query, context) {
  if (providerId === 'duckduckgo') {
    return searchWithDuckDuckGoProvider(query, context);
  }

  if (providerId === 'google_cse') {
    return searchWithGoogleCseProvider(query, context);
  }

  if (providerId === 'tavily') {
    return searchWithTavilyProvider(query, context);
  }

  if (providerId === 'exa') {
    return searchWithExaProvider(query, context);
  }

  if (providerId === 'serper') {
    return searchWithSerperProvider(query, context);
  }

  if (providerId === 'brave') {
    return searchWithBraveProvider(query, context);
  }

  if (providerId === 'serpapi') {
    return searchWithSerpApiProvider(query, context);
  }

  throw withStatus(`Unsupported web search provider: ${providerId}`, 400);
}

// Discovers web search results from the available provider or runtime capabilities.
export async function discoverWebSearchResults(query, context) {
  const providerErrors = [];
  const plan = context.providerPlan || { orderedProviders: [] };

  for (const providerId of plan.orderedProviders) {
    throwIfWebResearchAborted(context.signal);
    const state = getWebProviderRequestState(providerId);
    const now = Date.now();
    const cooldownMs = Math.max(0, Number(state.cooldownUntil || 0) - now);

    if (cooldownMs > 0) {
      emitWebResearchProgress(
        context,
        'provider.cooldown',
        `${providerId} is cooling down · ${Math.ceil(cooldownMs / 1000)}s remaining…`,
        { provider: providerId, retryAfterMs: cooldownMs },
      );
      providerErrors.push({
        provider: providerId,
        status: 429,
        rateLimited: true,
        message: `cooldown active (${Math.ceil(cooldownMs / 1000)}s remaining)`,
      });
      continue;
    }

    let lastError = null;

    for (let attempt = 1; attempt <= WEB_SEARCH_MAX_ATTEMPTS; attempt += 1) {
      throwIfWebResearchAborted(context.signal);
      const sinceLast = Math.max(0, Date.now() - Number(state.lastRequestAt || 0));
      if (sinceLast < WEB_SEARCH_MIN_INTERVAL_MS) {
        emitWebResearchProgress(context, 'provider.waiting', `Waiting to contact ${providerId}…`, {
          provider: providerId,
        });
        await waitForWebResearch(WEB_SEARCH_MIN_INTERVAL_MS - sinceLast, context.signal);
      }

      state.lastRequestAt = Date.now();
      emitWebResearchProgress(
        context,
        'provider.attempt',
        `Searching with ${providerId}${WEB_SEARCH_MAX_ATTEMPTS > 1 ? ` · attempt ${attempt}` : ''}…`,
        {
          provider: providerId,
          current: attempt,
          total: WEB_SEARCH_MAX_ATTEMPTS,
        },
      );

      try {
        const result = await runProviderSearch(providerId, query, context);
        throwIfWebResearchAborted(context.signal);
        const normalizedResults = normalizeDiscoveryResults(
          result?.results || [],
          context.maxResults,
        );
        if (!normalizedResults.length) {
          throw withStatus(`No results from ${providerId}`, 404);
        }

        state.cooldownUntil = 0;
        emitWebResearchProgress(
          context,
          'provider.completed',
          `${providerId} returned ${normalizedResults.length} result${normalizedResults.length === 1 ? '' : 's'}…`,
          {
            provider: providerId,
            current: normalizedResults.length,
            total: normalizedResults.length,
          },
        );
        return {
          providerId,
          results: normalizedResults,
          relatedQueries: Array.isArray(result?.relatedQueries)
            ? result.relatedQueries
                .map((entry) => normalizeSingleLine(entry, 120))
                .filter(Boolean)
                .slice(0, 8)
            : [],
          providerErrors,
        };
      } catch (error) {
        if (context.signal?.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        const rateLimited = isWebRateLimitError(error);

        if (rateLimited && attempt < WEB_SEARCH_MAX_ATTEMPTS) {
          const retryAfterMs = parseRetryAfterMs(error);
          const attemptBackoffMs = WEB_SEARCH_RETRY_BASE_DELAY_MS * attempt;
          const waitMs = Math.max(attemptBackoffMs, retryAfterMs);
          emitWebResearchProgress(
            context,
            'provider.retry',
            `${providerId} was rate limited · retrying shortly…`,
            { provider: providerId, retryAfterMs: waitMs },
          );
          await waitForWebResearch(waitMs, context.signal);
          continue;
        }

        if (rateLimited) {
          const retryAfterMs = parseRetryAfterMs(error);
          state.cooldownUntil =
            Date.now() + Math.max(WEB_SEARCH_RATE_LIMIT_COOLDOWN_MS, retryAfterMs);
        }

        emitWebResearchProgress(
          context,
          'provider.failed',
          `${providerId} search failed${plan.orderedProviders.length > 1 ? ' · trying another provider' : ''}…`,
          { provider: providerId },
        );
        break;
      }
    }

    providerErrors.push({
      provider: providerId,
      status: Number(lastError?.statusCode || lastError?.status || 0),
      rateLimited: isWebRateLimitError(lastError),
      message: String(lastError?.message || 'provider request failed').slice(0, 280),
    });
  }

  const allRateLimited =
    providerErrors.length > 0 && providerErrors.every((entry) => entry.rateLimited);
  const error = withStatus(
    providerErrors.length
      ? `Web search failed across providers: ${providerErrors.map((entry) => `${entry.provider}: ${entry.message}`).join(' | ')}`
      : 'No eligible web search providers are configured.',
    allRateLimited ? 429 : 502,
  );
  error.providerErrors = providerErrors;
  throw error;
}

/**
 * Reorders discovered web results by fuzzy title and snippet relevance while retaining every
 * provider result as a fallback. Failure to load or apply Fuse preserves the provider order.
 */
export async function rerankWebResearchResults(results, query) {
  const discoveredResults = Array.isArray(results) ? results : [];
  try {
    const FuseRuntime = (await import('fuse.js')).default;
    const fuse = new FuseRuntime(discoveredResults, {
      keys: ['title', 'snippet'],
      threshold: 0.6,
      includeScore: true,
    });
    const fuseResults = fuse.search(query);
    if (fuseResults.length < Math.min(3, discoveredResults.length)) return discoveredResults;

    const reRankedResults = fuseResults.map((result) => result.item);
    for (const result of discoveredResults) {
      if (!reRankedResults.find((candidate) => candidate.url === result.url)) {
        reRankedResults.push(result);
      }
    }
    return reRankedResults;
  } catch {
    return discoveredResults;
  }
}

/**
 * Determines whether accumulated source text already contains enough query coverage to stop
 * progressive page fetching without contacting the remaining candidates.
 */
export function webResearchQueryAnswered(query, content) {
  if (!content || content.length < 200) return false;
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 3);
  if (terms.length === 0) return false;
  const lower = content.toLowerCase();
  const matchCount = terms.filter((term) => lower.includes(term)).length;
  return matchCount / terms.length >= 0.7 && content.length >= 600;
}

/**
 * Compresses extracted article text into summary, fact, and code fields used by the research
 * response. The bounded structure prevents one verbose page from dominating bridge output.
 */
export function extractStructuredWebContent(rawText, query) {
  if (!rawText || rawText.length < 100) {
    return { summary: rawText, keyFacts: [], relevantCode: '' };
  }
  const lines = rawText.split('\n').filter((line) => line.trim().length > 20);
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 3);

  const keyFacts = lines
    .filter((line) => queryTerms.some((term) => line.toLowerCase().includes(term)))
    .slice(0, 8)
    .map((line) => line.trim().slice(0, 200));

  const codeMatch = rawText.match(/```[\s\S]{20,500}```/g);
  const relevantCode = codeMatch ? codeMatch.slice(0, 2).join('\n') : '';

  const sentences = rawText
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length > 40);
  const summary = sentences.slice(0, 3).join(' ').slice(0, 600);

  return { summary, keyFacts, relevantCode };
}

/**
 * Creates the discovery-only response returned before any candidate page is fetched. This keeps
 * site approval separate from search-engine discovery.
 */
export function buildWebResearchDiscoveryPayload({
  cleanedQuery,
  discovered,
  providerPlan,
  locale,
  region,
  safeSearchLabel,
  dedupedResults,
  reRankedResults,
  maxSources,
  maxResults,
}) {
  const candidates = reRankedResults.slice(0, Math.max(maxSources, maxResults));
  return {
    query: cleanedQuery,
    provider: String(discovered?.providerId || providerPlan.primaryProvider || 'web'),
    providerPlan: providerPlan.orderedProviders.slice(0, 10),
    locale,
    region,
    safeSearch: safeSearchLabel,
    totalResults: dedupedResults.length,
    scannedSources: 0,
    linesReadTotal: 0,
    charsReadTotal: 0,
    results: candidates,
    sources: [],
    steps: [],
    discoverOnly: true,
    relatedQueries: Array.isArray(discovered?.relatedQueries)
      ? discovered.relatedQueries.slice(0, 8)
      : [],
    providerErrors: Array.isArray(discovered?.providerErrors)
      ? discovered.providerErrors.slice(0, 8)
      : [],
    cache: { hit: false, stale: false, ageMs: 0 },
  };
}

/**
 * Fetches approved research candidates sequentially and stops once accumulated text sufficiently
 * answers the query. Individual HTTP and extraction failures remain source-level results.
 */
export async function fetchWebResearchSources({
  sourcesToRead,
  cleanedQuery,
  includeContent,
  fetchTimeoutMs,
  queryTokens,
  signal,
  onProgress,
}) {
  const fetchedSources = [];
  let accumulatedContent = '';

  for (let index = 0; index < sourcesToRead.length; index += 1) {
    throwIfWebResearchAborted(signal);
    const result = sourcesToRead[index];
    const total = sourcesToRead.length;
    const hostname = parseHostnameFromUrl(result.url) || result.title || 'source';
    const startedAt = Date.now();
    emitWebResearchProgress(
      { onProgress },
      'page.opening',
      `Opening ${hostname} · source ${index + 1} of ${total}…`,
      { current: index + 1, total, source: { ...result, status: 'opening' } },
    );
    try {
      const fetched = await fetchHtmlWithTimeout(result.url, fetchTimeoutMs, signal);
      throwIfWebResearchAborted(signal);
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      if (!fetched.ok) {
        const failed = {
          ...result,
          order: index + 1,
          status: 'http_error',
          httpStatus: fetched.status,
          fetchMs: elapsedMs,
          readabilityUsed: false,
          linesRead: 0,
          charsRead: 0,
          content: '',
          excerpt: result.snippet,
          byline: '',
          siteName: '',
          error: `HTTP ${fetched.status}`,
          relevanceScore: scoreWebSourceRelevance(queryTokens, `${result.title} ${result.snippet}`),
        };
        fetchedSources.push(failed);
        emitWebResearchProgress(
          { onProgress },
          'page.failed',
          `${hostname} returned HTTP ${fetched.status} · continuing…`,
          { current: index + 1, total, source: failed },
        );
        continue;
      }

      emitWebResearchProgress(
        { onProgress },
        'page.extracting',
        `Extracting the main article from ${hostname}…`,
        {
          current: index + 1,
          total,
          source: { ...result, status: 'extracting' },
        },
      );
      const article = extractArticleFromHtml(fetched.text, fetched.url || result.url);
      throwIfWebResearchAborted(signal);
      const rawContent = includeContent ? String(article.text || '') : '';
      const structured = rawContent ? extractStructuredWebContent(rawContent, cleanedQuery) : null;
      const content = structured ? JSON.stringify(structured) : rawContent;
      const linesRead = estimateTextLines(article.text);
      const charsRead = String(article.text || '').length;
      const relevanceScore = scoreWebSourceRelevance(
        queryTokens,
        `${result.title}\n${result.snippet}\n${String(article.text || '').slice(0, 3600)}`,
      );
      const completed = {
        ...result,
        order: index + 1,
        status: charsRead > 0 ? 'ok' : 'empty',
        url: fetched.url || result.url,
        httpStatus: fetched.status,
        fetchMs: elapsedMs,
        readabilityUsed: Boolean(article.readabilityUsed),
        linesRead,
        charsRead,
        content,
        excerpt: normalizeSingleLine(
          firstNonEmpty(article.excerpt, result.snippet, rawContent.slice(0, 420)),
          520,
        ),
        byline: normalizeSingleLine(article.byline, 180),
        siteName: normalizeSingleLine(article.siteName, 120),
        truncatedHtml: Boolean(fetched.truncated),
        relevanceScore,
      };
      fetchedSources.push(completed);
      accumulatedContent += rawContent;
      emitWebResearchProgress(
        { onProgress },
        'page.completed',
        charsRead > 0
          ? `Read ${linesRead} line${linesRead === 1 ? '' : 's'} from ${hostname} · ${index + 1} of ${total}…`
          : `No readable article text found on ${hostname} · continuing…`,
        { current: index + 1, total, source: completed },
      );
      if (
        index < sourcesToRead.length - 1 &&
        webResearchQueryAnswered(cleanedQuery, accumulatedContent)
      ) {
        emitWebResearchProgress(
          { onProgress },
          'pages.enough_evidence',
          `Enough relevant evidence collected after ${index + 1} source${index === 0 ? '' : 's'}…`,
          { current: index + 1, total },
        );
        break;
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      const failed = {
        ...result,
        order: index + 1,
        status: 'fetch_error',
        httpStatus: 0,
        fetchMs: Math.max(0, Date.now() - startedAt),
        readabilityUsed: false,
        linesRead: 0,
        charsRead: 0,
        content: '',
        excerpt: result.snippet,
        byline: '',
        siteName: '',
        error: String(error?.message || 'Failed to fetch source').slice(0, 280),
        relevanceScore: scoreWebSourceRelevance(queryTokens, `${result.title} ${result.snippet}`),
      };
      fetchedSources.push(failed);
      emitWebResearchProgress(
        { onProgress },
        'page.failed',
        `Could not read ${hostname} · continuing with the remaining sources…`,
        { current: index + 1, total, source: failed },
      );
    }
  }

  return fetchedSources;
}

/**
 * Builds the final bounded web-research response and per-source progress steps from fetched page
 * records. Provider discovery metadata remains attached for diagnostics and fallback reporting.
 */
export function buildWebResearchResponsePayload({
  cleanedQuery,
  discovered,
  providerPlan,
  locale,
  region,
  safeSearchLabel,
  dedupedResults,
  sources,
}) {
  const linesReadTotal = sources.reduce(
    (total, source) => total + Number(source?.linesRead || 0),
    0,
  );
  const charsReadTotal = sources.reduce(
    (total, source) => total + Number(source?.charsRead || 0),
    0,
  );
  const maxLinesRead = Math.max(1, ...sources.map((source) => Number(source?.linesRead || 0)));
  const steps = sources.map((source, index) => ({
    index: index + 1,
    title: source.title,
    url: source.url,
    status: source.status,
    linesRead: Number(source.linesRead || 0),
    charsRead: Number(source.charsRead || 0),
    fetchMs: Number(source.fetchMs || 0),
    relevanceScore: Number(source.relevanceScore || 0),
    lineRatio: Number((Number(source.linesRead || 0) / maxLinesRead).toFixed(4)),
    error: source.error || '',
  }));

  return {
    query: cleanedQuery,
    provider: String(discovered?.providerId || providerPlan.primaryProvider || 'web'),
    providerPlan: providerPlan.orderedProviders.slice(0, 10),
    locale,
    region,
    safeSearch: safeSearchLabel,
    totalResults: dedupedResults.length,
    scannedSources: sources.length,
    linesReadTotal,
    charsReadTotal,
    results: dedupedResults,
    sources,
    steps,
    relatedQueries: Array.isArray(discovered?.relatedQueries)
      ? discovered.relatedQueries.slice(0, 8)
      : [],
    providerErrors: Array.isArray(discovered?.providerErrors)
      ? discovered.providerErrors.slice(0, 8)
      : [],
    cache: {
      hit: false,
      stale: false,
      ageMs: 0,
    },
  };
}

/**
 * Runs the bridge's research workflow across configured search providers and approved page
 * extraction. It preserves provider fallback, cache, and site-consent behavior while delegating
 * independently measurable discovery, ranking, fetching, and response construction steps.
 */
export async function runWebResearch(query, options = {}) {
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery) {
    throw withStatus('A web search query is required', 400);
  }

  const progressContext = { onProgress: options.onProgress };
  throwIfWebResearchAborted(options.signal);
  emitWebResearchProgress(progressContext, 'search.started', 'Preparing the web search…');

  const maxResults = parseNumber(
    options.maxResults,
    DEFAULT_WEB_SEARCH_RESULTS,
    3,
    MAX_WEB_SEARCH_RESULTS,
  );
  const maxSources = parseNumber(
    options.maxSources,
    DEFAULT_WEB_SOURCE_COUNT,
    1,
    MAX_WEB_SOURCE_COUNT,
  );
  const fetchTimeoutMs = parseNumber(
    options.fetchTimeoutMs,
    DEFAULT_WEB_FETCH_TIMEOUT_MS,
    3000,
    MAX_WEB_FETCH_TIMEOUT_MS,
  );
  const includeContent = options.includeContent !== false;
  const discoverOnly = options.discoverOnly === true;
  const allowedDomains = Array.isArray(options.allowedDomains)
    ? options.allowedDomains
        .map((domain) =>
          String(domain || '')
            .toLowerCase()
            .replace(/^www\./, ''),
        )
        .filter(Boolean)
    : null;
  const locale = trimText(options.locale, 24, 'en-us').toLowerCase();
  const region = trimText(options.region, 24, 'wt-wt').toLowerCase();
  const safeSearch = mapWebSafeSearch(options.safeSearch);
  const time = mapWebTimeRange(options.timeRange || options.time);
  const safeSearchLabel = String(options.safeSearch || 'moderate').toLowerCase();
  const timeRangeLabel = String(options.timeRange || options.time || 'all').toLowerCase();
  const providerPlan = resolveWebProviderPlan(options);

  emitWebResearchProgress(
    progressContext,
    'provider.selected',
    `Using ${providerPlan.primaryProvider || 'the configured search provider'}…`,
    { provider: providerPlan.primaryProvider || '' },
  );

  const cacheKey = buildWebResearchCacheKey(cleanedQuery, {
    maxResults,
    maxSources,
    locale,
    region,
    safeSearch: safeSearchLabel,
    timeRange: timeRangeLabel,
    includeContent,
    discoverOnly,
    allowedDomains: allowedDomains ? allowedDomains.join(',') : '',
    allowPaidFallback: providerPlan.allowPaidFallback,
    providerPlan: providerPlan.orderedProviders,
  });

  emitWebResearchProgress(progressContext, 'search.cache_check', 'Checking recent research…');
  const cachedResult = getCachedWebResearch(cacheKey);
  if (cachedResult) {
    emitWebResearchProgress(progressContext, 'search.cache_hit', 'Using recent research results…');
    return cachedResult;
  }
  emitWebResearchProgress(progressContext, 'search.cache_miss', 'Starting a fresh web search…');

  if (!providerPlan.orderedProviders.length) {
    if (providerPlan.blockedPaidProviders.length && !providerPlan.allowPaidFallback) {
      const blocked = withStatus(
        `Paid fallback available but blocked by approval. Allow fallback to use: ${providerPlan.blockedPaidProviders.join(', ')}.`,
        402,
      );
      blocked.code = 'PAID_FALLBACK_BLOCKED';
      throw blocked;
    }
    throw withStatus('No configured web search providers are available for this request.', 400);
  }

  let discovered;
  try {
    discovered = await discoverWebSearchResults(cleanedQuery, {
      maxResults,
      locale,
      region,
      safeSearch,
      safeSearchLabel,
      time,
      timeRangeLabel,
      fetchTimeoutMs,
      providerPlan,
      providerSettings: providerPlan.providerSettings,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (error) {
    if (options.signal?.aborted || error?.name === 'AbortError') throw error;
    if (!providerPlan.allowPaidFallback && providerPlan.blockedPaidProviders.length) {
      const blocked = withStatus(
        `Paid fallback available but blocked by approval. Allow fallback to use: ${providerPlan.blockedPaidProviders.join(', ')}.`,
        402,
      );
      blocked.code = 'PAID_FALLBACK_BLOCKED';
      blocked.providerErrors = Array.isArray(error?.providerErrors) ? error.providerErrors : [];
      throw blocked;
    }

    if (isWebRateLimitError(error)) {
      const stale = getCachedWebResearch(cacheKey, { allowStale: true });
      if (stale) {
        stale.cache = {
          ...(stale.cache || {}),
          reason: 'rate-limit-fallback',
        };
        emitWebResearchProgress(
          progressContext,
          'search.stale_cache',
          'Using older cached results after a provider rate limit…',
        );
        return stale;
      }
    }
    throw error;
  }

  throwIfWebResearchAborted(options.signal);
  const dedupedResults = Array.isArray(discovered?.results) ? discovered.results : [];
  emitWebResearchProgress(
    progressContext,
    'results.normalizing',
    `Cleaning up ${dedupedResults.length} search result${dedupedResults.length === 1 ? '' : 's'}…`,
    { current: dedupedResults.length, total: dedupedResults.length },
  );
  emitWebResearchProgress(progressContext, 'results.ranking', 'Ranking results for relevance…');
  const reRankedResults = await rerankWebResearchResults(dedupedResults, cleanedQuery);
  throwIfWebResearchAborted(options.signal);
  emitWebResearchProgress(
    progressContext,
    'results.ranked',
    `Selected the strongest ${Math.min(maxSources, reRankedResults.length)} source${Math.min(maxSources, reRankedResults.length) === 1 ? '' : 's'}…`,
    {
      current: Math.min(maxSources, reRankedResults.length),
      total: Math.min(maxSources, reRankedResults.length),
    },
  );

  if (discoverOnly) {
    const discoverPayload = buildWebResearchDiscoveryPayload({
      cleanedQuery,
      discovered,
      providerPlan,
      locale,
      region,
      safeSearchLabel,
      dedupedResults,
      reRankedResults,
      maxSources,
      maxResults,
    });
    setCachedWebResearch(cacheKey, discoverPayload);
    return discoverPayload;
  }

  let sourcesToRead = reRankedResults.slice(0, maxSources);
  if (allowedDomains && allowedDomains.length) {
    sourcesToRead = sourcesToRead.filter((result) =>
      webHostInAllowlist(result?.url, allowedDomains),
    );
  }

  let sources;
  if (!includeContent) {
    const queryTokens = tokenizeWebQuery(cleanedQuery);
    emitWebResearchProgress(
      progressContext,
      'results.snippets_preparing',
      `Preparing ${sourcesToRead.length} search-result snippet${sourcesToRead.length === 1 ? '' : 's'} for local AI…`,
      { current: sourcesToRead.length, total: sourcesToRead.length },
    );
    sources = sourcesToRead.map((result, index) => ({
      ...result,
      order: index + 1,
      status: 'snippet',
      httpStatus: 0,
      fetchMs: 0,
      readabilityUsed: false,
      linesRead: 0,
      charsRead: 0,
      content: '',
      excerpt: result.snippet,
      byline: '',
      siteName: '',
      error: '',
      relevanceScore: scoreWebSourceRelevance(queryTokens, `${result.title} ${result.snippet}`),
    }));
  } else {
    emitWebResearchProgress(
      progressContext,
      'pages.started',
      `Reading up to ${sourcesToRead.length} source page${sourcesToRead.length === 1 ? '' : 's'}…`,
      { current: 0, total: sourcesToRead.length },
    );
    sources = await fetchWebResearchSources({
      sourcesToRead,
      cleanedQuery,
      includeContent,
      fetchTimeoutMs,
      queryTokens: tokenizeWebQuery(cleanedQuery),
      signal: options.signal,
      onProgress: options.onProgress,
    });
    emitWebResearchProgress(
      progressContext,
      'pages.completed',
      `Finished reading ${sources.filter((source) => source.linesRead > 0).length} source page${sources.filter((source) => source.linesRead > 0).length === 1 ? '' : 's'}…`,
      { current: sources.length, total: sourcesToRead.length },
    );
  }

  const responsePayload = buildWebResearchResponsePayload({
    cleanedQuery,
    discovered,
    providerPlan,
    locale,
    region,
    safeSearchLabel,
    dedupedResults,
    sources,
  });

  setCachedWebResearch(cacheKey, responsePayload);
  emitWebResearchProgress(progressContext, 'evidence.ready', 'Search evidence is ready…');
  return responsePayload;
}

// Builds find matcher for the next stage of the local bridge service layer.
export function buildFindMatcher(query, { useRegex = false, ignoreCase = true } = {}) {
  const raw = String(query || '').trim();
  if (!raw) {
    throw withStatus('Query is required for file find', 400);
  }

  const source = useRegex ? raw : escapeRegExp(raw);
  const flags = ignoreCase ? 'i' : '';

  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw withStatus(`Invalid regex query: ${error?.message || 'failed to compile'}`, 400);
  }
}

// Normalizes search text into the canonical form expected by the local bridge service layer.
export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Tokenizes normalized text into bounded terms used by local search ranking.
export function tokenizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

// Normalizes fuzzy threshold into the canonical form expected by the local bridge service layer.
export function normalizeFuzzyThreshold(value, fallback = DEFAULT_FIND_FUZZY_THRESHOLD) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.12, Math.min(0.9, numeric));
}

// Builds fuzzy query variants for the next stage of the local bridge service layer.
export function buildFuzzyQueryVariants(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];

  const compact = normalizeSearchText(raw);
  const tokens = tokenizeSearchText(raw)
    .filter((token) => token.length >= 2)
    .filter((token) => !FIND_QUERY_STOP_WORDS.has(token));

  const longestToken = tokens.slice().sort((a, b) => b.length - a.length)[0] || '';

  const variants = [raw, compact, tokens.join(' '), longestToken, ...tokens.slice(0, 5)];

  return Array.from(
    new Set(
      variants
        .map((variant) => String(variant || '').trim())
        .filter((variant) => variant.length >= 2),
    ),
  );
}

// Determines whether the create fuzzy name candidate for the local bridge service layer.
export function createFuzzyNameCandidate({ path: candidatePath, relativePath, name, type }) {
  return {
    path: candidatePath,
    relativePath,
    name,
    type,
    compactName: normalizeSearchText(name),
    compactPath: normalizeSearchText(relativePath),
    tokenizedName: tokenizeSearchText(name).join(' '),
    tokenizedPath: tokenizeSearchText(relativePath).join(' '),
  };
}

/**
 * Runs fuzzy name search from initialization through completion, including its cleanup
 * behavior.
 */

export function runFuzzyNameSearch(candidates, query, { maxResults, threshold }) {
  if (!Array.isArray(candidates) || !candidates.length) return [];

  const normalizedMaxResults = Math.max(
    1,
    Math.min(MAX_FIND_RESULTS, Number(maxResults) || DEFAULT_FIND_RESULTS),
  );
  const normalizedThreshold = normalizeFuzzyThreshold(threshold, DEFAULT_FIND_FUZZY_THRESHOLD);
  const variants = buildFuzzyQueryVariants(query);
  if (!variants.length) return [];

  const fuse = new Fuse(candidates, {
    includeScore: true,
    shouldSort: true,
    ignoreLocation: true,
    threshold: Math.min(0.92, normalizedThreshold + 0.26),
    distance: 500,
    minMatchCharLength: 2,
    keys: [
      { name: 'compactName', weight: 0.36 },
      { name: 'name', weight: 0.24 },
      { name: 'compactPath', weight: 0.2 },
      { name: 'relativePath', weight: 0.11 },
      { name: 'tokenizedName', weight: 0.06 },
      { name: 'tokenizedPath', weight: 0.03 },
    ],
  });

  const bestByPath = new Map();

  variants.forEach((variant, variantIndex) => {
    const hits = fuse.search(variant, { limit: normalizedMaxResults * 8 });

    hits.forEach((hit, rank) => {
      const item = hit?.item;
      if (!item?.path) return;

      const baseScore = Number.isFinite(Number(hit?.score)) ? Number(hit.score) : 1;
      const adjustedScore = baseScore + variantIndex * 0.01 + rank / 10000;
      const existing = bestByPath.get(item.path);

      if (!existing || adjustedScore < existing.adjustedScore) {
        bestByPath.set(item.path, {
          item,
          baseScore,
          adjustedScore,
        });
      }
    });
  });

  if (!bestByPath.size) return [];

  const ranked = Array.from(bestByPath.values()).sort((a, b) => a.adjustedScore - b.adjustedScore);

  let accepted = ranked.filter((entry) => entry.baseScore <= normalizedThreshold);
  if (!accepted.length) {
    const relaxedThreshold = Math.min(0.82, normalizedThreshold + 0.2);
    accepted = ranked
      .filter((entry) => entry.baseScore <= relaxedThreshold)
      .slice(0, Math.min(5, normalizedMaxResults));
  }

  return accepted.slice(0, normalizedMaxResults).map(({ item, baseScore }) => ({
    path: item.path,
    relativePath: item.relativePath,
    type: item.type,
    match: 'fuzzy-name',
    score: Number((1 - Math.min(1, Math.max(0, baseScore))).toFixed(4)),
    excerpt: '',
  }));
}

// Builds content excerpt for the next stage of the local bridge service layer.
export function buildContentExcerpt(content, matcher, maxLength = 220) {
  const text = String(content || '');
  if (!text) return '';

  const matchIndex = text.search(matcher);
  if (matchIndex < 0) {
    return text.slice(0, maxLength);
  }

  const half = Math.floor(maxLength / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, start + maxLength);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

// Converts an absolute result path into the root-relative form shown to bridge callers.
export function toRelativePath(rootPath, absolutePath) {
  const relative = path.relative(rootPath, absolutePath);
  if (!relative || relative === '') return path.basename(absolutePath);
  return relative.split(path.sep).join('/');
}

// ── ripgrep acceleration for files.find content-mode ─────────────────────────
// Polyglot rule (DECISIONS.md ADR-0001): native speed comes from shelling out to
// a native tool, not from an in-process addon. files.find's content scan reads
// every candidate file into JS; when ripgrep is present we let it do that scan
// instead. Memoize the availability probe so we don't `command -v rg` per call.
export let _ripgrepAvailable = null;
// Determines whether the ripgrep available for the local bridge service layer.
export function ripgrepAvailable() {
  if (_ripgrepAvailable === null) _ripgrepAvailable = commandExists('rg');
  return _ripgrepAvailable;
}

// Content search via ripgrep, scoped to what files.find needs. Literal queries
// only (caller gates on useRegex !== true) so `-F` matches the JS matcher's
// escaped-substring semantics exactly. `--no-ignore --hidden` keeps parity with
// the JS walk (same files searched — a pure speed swap, no silent omissions);
// `--max-depth` honors the depth contract; `--max-count 1` because findFiles
// reports one hit per file. Returns { available, matches:[{file,line,content}],
// error? }; callers fall back to the JS walk when available is false or error set.
export async function ripgrepFindContent(
  rootPath,
  {
    query,
    ignoreCase = true,
    maxResults = DEFAULT_FIND_RESULTS,
    maxDepth = DEFAULT_FIND_DEPTH,
  } = {},
) {
  if (!(await ripgrepAvailable())) return { available: false, matches: [] };

  const boundedDepth = Math.max(
    1,
    Math.min(MAX_FIND_DEPTH, Number(maxDepth) || DEFAULT_FIND_DEPTH),
  );
  const boundedResults = Math.max(
    1,
    Math.min(MAX_FIND_RESULTS, Number(maxResults) || DEFAULT_FIND_RESULTS),
  );
  const args = [
    '--json',
    '-F',
    ...(ignoreCase ? ['-i'] : []),
    '--no-ignore',
    '--hidden',
    '--max-count',
    '1',
    '--max-depth',
    String(boundedDepth),
    '--',
    String(query),
    rootPath,
  ];

  try {
    const { stdout } = await runStructuredProcess('rg', args, {
      timeoutMs: 15_000,
      maxBufferBytes: 4 * 1024 * 1024,
      acceptedExitCodes: [0, 1],
    });
    const matches = [];
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
          matches.push({
            file: String(parsed.data?.path?.text || ''),
            line: Number(parsed.data?.line_number || 0),
            content: String(parsed.data?.lines?.text || '').replace(/\n$/, ''),
          });
          if (matches.length >= boundedResults) break;
        }
      } catch {
        /* skip a malformed (e.g. head-truncated) rg JSON line */
      }
    }
    return { available: true, matches };
  } catch (error) {
    return {
      available: true,
      matches: [],
      error: String(error?.message || 'ripgrep failed'),
    };
  }
}

/**
 * Converts literal ripgrep matches into the response contract shared by the JavaScript file
 * walker. One match per file is retained to match the existing `files.find` behavior.
 */
export function buildRipgrepFindResponse({
  rootPath,
  rawQuery,
  normalizedMode,
  ignoreCase,
  maxDepth,
  maxItems,
  matches,
}) {
  const seen = new Set();
  const results = [];
  for (const match of matches) {
    if (results.length >= maxItems) break;
    if (!match.file || seen.has(match.file)) continue;
    seen.add(match.file);
    const absolutePath = path.isAbsolute(match.file)
      ? match.file
      : path.resolve(rootPath, match.file);
    results.push({
      path: absolutePath,
      relativePath: toRelativePath(rootPath, absolutePath),
      type: 'file',
      match: 'content',
      excerpt: String(match.content || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220),
    });
  }

  return {
    rootPath,
    query: rawQuery,
    mode: normalizedMode,
    useRegex: false,
    ignoreCase: Boolean(ignoreCase),
    maxDepth,
    maxResults: maxItems,
    scanned: results.length,
    filesScanned: seen.size,
    truncated: matches.length > results.length,
    fuzzyEnabled: false,
    fuzzyApplied: false,
    fuzzyThreshold: null,
    fuzzyCandidateCount: 0,
    fuzzyResultCount: 0,
    results,
    engine: 'ripgrep',
  };
}

/**
 * Walks the bounded filesystem search tree and records exact name/content matches plus fuzzy-name
 * candidates. Read failures, binary files, and oversized files are skipped independently.
 */
export async function walkFindFiles({
  rootPath,
  matcher,
  normalizedMode,
  maxDepth,
  maxItems,
  fuzzyEnabled,
}) {
  const queue = [{ dir: rootPath, depth: 0 }];
  const results = [];
  const fuzzyCandidates = [];
  let scanned = 0;
  let filesScanned = 0;
  let truncated = false;

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    let entries = [];
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1;
      if (!left.isDirectory() && right.isDirectory()) return 1;
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      if (results.length >= maxItems || scanned >= MAX_FIND_FILES_SCANNED) {
        truncated = true;
        break;
      }

      scanned += 1;
      const absolutePath = path.join(current.dir, entry.name);
      const relativePath = toRelativePath(rootPath, absolutePath);

      if (entry.isDirectory()) {
        if (fuzzyEnabled && fuzzyCandidates.length < MAX_FIND_FUZZY_CANDIDATES) {
          fuzzyCandidates.push(
            createFuzzyNameCandidate({
              path: absolutePath,
              relativePath,
              name: entry.name,
              type: 'dir',
            }),
          );
        }

        const nameMatch = normalizedMode !== 'content' && matcher.test(entry.name);
        if (nameMatch) {
          results.push({
            path: absolutePath,
            relativePath,
            type: 'dir',
            match: 'name',
            excerpt: '',
          });
        }

        if (current.depth < maxDepth) {
          queue.push({ dir: absolutePath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) continue;
      filesScanned += 1;

      if (fuzzyEnabled && fuzzyCandidates.length < MAX_FIND_FUZZY_CANDIDATES) {
        fuzzyCandidates.push(
          createFuzzyNameCandidate({
            path: absolutePath,
            relativePath,
            name: entry.name,
            type: 'file',
          }),
        );
      }

      const nameMatch =
        normalizedMode !== 'content' && (matcher.test(entry.name) || matcher.test(relativePath));
      if (nameMatch) {
        results.push({
          path: absolutePath,
          relativePath,
          type: 'file',
          match: 'name',
          excerpt: '',
        });
        continue;
      }
      if (normalizedMode === 'name') continue;

      try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile() || stats.size > MAX_FIND_FILE_BYTES) continue;

        const buffer = await fs.readFile(absolutePath);
        if (isBinary(buffer)) continue;

        const content = buffer.toString('utf8');
        if (!matcher.test(content)) continue;

        results.push({
          path: absolutePath,
          relativePath,
          type: 'file',
          match: 'content',
          excerpt: buildContentExcerpt(content, matcher),
        });
      } catch {
        continue;
      }
    }

    if (results.length >= maxItems || scanned >= MAX_FIND_FILES_SCANNED) {
      truncated = true;
      break;
    }
  }

  return { results, fuzzyCandidates, scanned, filesScanned, truncated };
}

/**
 * Applies fuzzy filename matching only when the exact search produced no results. This preserves
 * exact-match precedence while still returning a bounded relaxed fallback.
 */
export function applyFuzzyFindFallback({
  results,
  fuzzyCandidates,
  fuzzyEnabled,
  rawQuery,
  maxItems,
  normalizedFuzzyThreshold,
}) {
  let fuzzyApplied = false;
  let fuzzyResultCount = 0;

  if (fuzzyEnabled && results.length === 0 && fuzzyCandidates.length > 0) {
    const fuzzyMatches = runFuzzyNameSearch(fuzzyCandidates, rawQuery, {
      maxResults: maxItems,
      threshold: normalizedFuzzyThreshold,
    });
    if (fuzzyMatches.length) {
      results.push(...fuzzyMatches.slice(0, maxItems));
      fuzzyApplied = true;
      fuzzyResultCount = Math.min(maxItems, fuzzyMatches.length);
    }
  }

  return { fuzzyApplied, fuzzyResultCount };
}

/**
 * Finds files through a native literal-content path when available, otherwise through the bounded
 * JavaScript tree walk. Its exported stages remain independently benchmarkable without changing
 * the public response contract.
 */
export async function findFiles(
  rootPath,
  {
    query,
    mode = 'auto',
    useRegex = false,
    ignoreCase = true,
    depth = DEFAULT_FIND_DEPTH,
    maxResults = DEFAULT_FIND_RESULTS,
    fuzzy = true,
    fuzzyThreshold = DEFAULT_FIND_FUZZY_THRESHOLD,
  } = {},
) {
  const rawQuery = String(query || '').trim();
  const normalizedMode = normalizeFindMode(mode);
  const matcher = buildFindMatcher(rawQuery, { useRegex, ignoreCase });
  const maxDepth = Math.max(1, Math.min(MAX_FIND_DEPTH, Number(depth) || DEFAULT_FIND_DEPTH));
  const maxItems = Math.max(
    1,
    Math.min(MAX_FIND_RESULTS, Number(maxResults) || DEFAULT_FIND_RESULTS),
  );
  const fuzzyEnabled = normalizedMode !== 'content' && useRegex !== true && fuzzy !== false;
  const normalizedFuzzyThreshold = normalizeFuzzyThreshold(
    fuzzyThreshold,
    DEFAULT_FIND_FUZZY_THRESHOLD,
  );

  if (normalizedMode === 'content' && rawQuery && useRegex !== true) {
    const ripgrepResult = await ripgrepFindContent(rootPath, {
      query: rawQuery,
      ignoreCase,
      maxResults: maxItems,
      maxDepth,
    });
    if (ripgrepResult.available && !ripgrepResult.error) {
      return buildRipgrepFindResponse({
        rootPath,
        rawQuery,
        normalizedMode,
        ignoreCase,
        maxDepth,
        maxItems,
        matches: ripgrepResult.matches,
      });
    }
  }

  const walkResult = await walkFindFiles({
    rootPath,
    matcher,
    normalizedMode,
    maxDepth,
    maxItems,
    fuzzyEnabled,
  });
  const fuzzyResult = applyFuzzyFindFallback({
    results: walkResult.results,
    fuzzyCandidates: walkResult.fuzzyCandidates,
    fuzzyEnabled,
    rawQuery,
    maxItems,
    normalizedFuzzyThreshold,
  });

  return {
    rootPath,
    query: rawQuery,
    mode: normalizedMode,
    useRegex: Boolean(useRegex),
    ignoreCase: Boolean(ignoreCase),
    maxDepth,
    maxResults: maxItems,
    scanned: walkResult.scanned,
    filesScanned: walkResult.filesScanned,
    truncated: walkResult.truncated,
    fuzzyEnabled,
    fuzzyApplied: fuzzyResult.fuzzyApplied,
    fuzzyThreshold: fuzzyEnabled ? normalizedFuzzyThreshold : null,
    fuzzyCandidateCount: fuzzyEnabled ? walkResult.fuzzyCandidates.length : 0,
    fuzzyResultCount: fuzzyResult.fuzzyResultCount,
    results: walkResult.results,
    engine: 'js-walk',
  };
}

// ── Encrypted renderer-state facade ─────────────────────────────────────────

export async function ensureStoreDir() {
  return ensureInternalStorageDirectory(STORE_ROOT_DIR);
}

// Reads the legacy store key to file representation retained for existing user data.
function legacyStoreKeyToFile(key) {
  const safe =
    String(key || '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 200) || 'key';
  return `${safe}.json`;
}

/**
 * Retains the former durable-store filename mapping for compatibility tests and cleanup.
 * Active renderer state is keyed directly in encrypted SQLite and does not use these names.
 */
export function storeKeyToFile(key) {
  const normalized = String(key || '');
  const encoded = Buffer.from(normalized, 'utf8').toString('base64url');
  if (encoded.length <= 180) return `k1-${encoded || 'empty'}.json`;
  return `k1h-${createHash('sha256').update(normalized).digest('hex')}.json`;
}

// Persists one renderer-state value through the encrypted SQLite repository.
export async function writeDurableStoreKey(key, value) {
  await writeEncryptedStoreKey(String(key || ''), value);
}

export async function deleteDurableStoreKey(key) {
  await deleteEncryptedStoreKey(String(key || ''));
}

/**
 * Reads and decrypts the complete renderer-state key/value set used during startup hydration.
 */

export async function readDurableStoreAll() {
  return readEncryptedStoreAll();
}

// ── Encrypted artifacts and chat persistence ─────────────────────────────────
// Public operations delegate to the SQLite repositories. Legacy path helpers in this section
// remain only for compatibility tests and cleanup; bridge routes do not use them for storage.
const ARTIFACTS_INDEX_FILE = 'index.json';

const MAX_ARTIFACTS_INDEXED = 500;

const MAX_ARTIFACT_CONTENT_CHARS = 24 * 1024 * 1024;

const ARTIFACT_PREVIEW_READBACK_CHARS = 200000;

async function ensureArtifactsDir() {
  return ensureInternalStorageDirectory(ARTIFACTS_ROOT_DIR);
}

// Sanitizes artifact filename before it is logged, displayed, or passed across a trust boundary.
function sanitizeArtifactFilename(name) {
  const base = String(name || '')
    .replace(/^.*[\\/]/, '')
    .trim();
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || `artifact-${Date.now()}.txt`;
}

// Loads artifacts index using the storage contract owned by the local bridge service layer.
async function readArtifactsIndex() {
  try {
    const root = await ensureArtifactsDir();
    const indexPath = await assertInternalStoragePath(root, path.join(root, ARTIFACTS_INDEX_FILE), {
      writable: true,
    });
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Writes artifacts index while preserving the storage and boundary rules owned by the local bridge
// service layer.
async function writeArtifactsIndex(list) {
  await ensureArtifactsDir();
  const capped = (Array.isArray(list) ? list : []).slice(0, MAX_ARTIFACTS_INDEXED);
  const indexPath = await assertInternalStoragePath(
    ARTIFACTS_ROOT_DIR,
    path.join(ARTIFACTS_ROOT_DIR, ARTIFACTS_INDEX_FILE),
    { writable: true },
  );
  await atomicWriteJson(indexPath, capped, { spaces: 2 });
}

// Loads artifact head using the storage contract owned by the local bridge service layer.
async function readArtifactHead(filePath, maxBytes) {
  let handle = null;
  try {
    handle = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Saves or appends an artifact through encrypted SQLite and returns its opaque identifier.
 */

export async function saveArtifact({ filename, content, summary, type, chatId, append } = {}) {
  return saveEncryptedArtifact({
    filename,
    content,
    summary,
    type,
    chatId,
    append,
  });
}

// Lists artifacts in the stable shape expected by callers.
export async function listArtifacts({ limit, chatId } = {}) {
  return listEncryptedArtifacts({ limit, chatId });
}

export async function readArtifact(id) {
  return readEncryptedArtifact(id);
}

export const CHATS_ROOT_DIR = path.join(os.homedir(), '.iris-ai', 'chats');
export const CHAT_INDEX_FILE = 'index.json';
export const MAX_CHAT_TITLE_CHARS = 200;
export const MAX_CHAT_MESSAGE_CHARS = 200000;

// Strip everything but [A-Za-z0-9_-] so a chat id can NEVER contain '.' or '/' —
// chatDirFor is therefore always a direct child of CHATS_ROOT_DIR (no traversal).
export function sanitizeChatId(id) {
  return String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
}

// Returns the storage directory owned by one persisted chat.
export function chatDirFor(id) {
  return path.join(CHATS_ROOT_DIR, sanitizeChatId(id));
}

// Builds the transcript, compacted-history, memory, metadata, and temporary paths for one chat.
export function chatPaths(id) {
  const dir = chatDirFor(id);
  return {
    dir,
    transcript: path.join(dir, 'transcript.jsonl'),
    compacted: path.join(dir, 'compacted.md'),
    memory: path.join(dir, 'memory.md'),
    tmp: path.join(dir, 'tmp'),
  };
}

// Validates one chat directory and returns only paths contained within IRIS-owned storage.
async function secureChatPaths(id) {
  const sid = sanitizeChatId(id);
  if (!sid) throw withStatus('chat id required', 400);
  const root = await ensureInternalStorageDirectory(CHATS_ROOT_DIR);
  const dir = await assertInternalStoragePath(root, chatDirFor(sid));
  return {
    dir,
    transcript: path.join(dir, 'transcript.jsonl'),
    compacted: path.join(dir, 'compacted.md'),
    memory: path.join(dir, 'memory.md'),
    tmp: path.join(dir, 'tmp'),
  };
}

// Loads chat index using the storage contract owned by the local bridge service layer.
export async function readChatIndex() {
  return listEncryptedChats();
}

// Writes chat index while preserving the storage and boundary rules owned by the local bridge
// service layer.
export async function writeChatIndex() {
  return { ok: true };
}

/**
 * Creates an encrypted chat record and its initial display metadata. Retrying creation cannot
 * replace an existing conversation with the same identifier.
 */

export async function createChatSession({ title, provider, model } = {}) {
  return createEncryptedChat({ title, provider, model });
}

// Appends chat message while preserving the storage and size rules owned by the local bridge
// service layer.
export async function appendChatMessage(id, message) {
  await appendEncryptedChatMessage(id, message);
  return { ok: true };
}

// Returns chat session used by the local bridge service layer.
export async function getChatSession(id) {
  return getEncryptedChat(id);
}

// Persists chat compacted using the storage contract owned by the local bridge service layer.
export async function saveChatCompacted(id, content) {
  await saveEncryptedChatCompacted(id, content);
  return { ok: true };
}

// Updates bridge service runtime with the supplied chat title value.
export async function setChatTitle(id, title) {
  return { ok: true, title: await setEncryptedChatTitle(id, title) };
}

// Deletes chat session through the persistence path owned by the local bridge service layer.
export async function deleteChatSession(id) {
  return { ok: true, removed: await deleteEncryptedChat(id) };
}

// Per-chat encrypted working memory is maintained through controlled endpoints and is
// never exposed as an internal plaintext file.
export const MAX_CHAT_MEMORY_CHARS = 20000;

// Loads chat memory using the storage contract owned by the local bridge service layer.
export async function readChatMemory(id) {
  return readEncryptedChatMemory(id);
}

// Writes chat memory while preserving the storage and boundary rules owned by the local bridge
// service layer.
export async function writeChatMemory(id, content, { append = false } = {}) {
  await writeEncryptedChatMemory(id, content, { append });
  return { ok: true };
}

// chat.recall (Phase G) — the agent pulls earlier context ON DEMAND, only when it
// judges this request relates to prior work in the chat (model-judged pull, not a
// blind auto-inject). scope 'compacted' = the rolling summary; 'full' = the recent
// raw transcript tail.
export async function readChatRecall(id, scope = 'compacted') {
  return readEncryptedChatRecall(id, scope);
}

// Sub-agent output handoff stores the full result as an encrypted SQLite record. The
// compatibility `path` value returned to callers is an opaque task-bound identifier.

// Sanitizes task ID before it is logged, displayed, or passed across a trust boundary.
export function sanitizeTaskId(id) {
  return String(id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
}

// Writes subagent output while preserving the storage and boundary rules owned by the local bridge
// service layer.
export async function writeSubagentOutput(taskId, content) {
  const outputId = await writeEncryptedSubagentOutput(taskId, content);
  return { ok: true, path: outputId, outputId };
}

// Loads subagent output using the storage contract owned by the local bridge service layer.
export async function readSubagentOutput(taskId) {
  return readEncryptedSubagentOutput(taskId);
}

// Ensures skills profile dir exists in the valid state required by the local bridge service layer.
export async function ensureSkillsProfileDir(profileName) {
  const profile = normalizeProfileName(profileName);
  return { profile, profileDir: '' };
}

// Built-ins are packaged application resources. SQLite stores only custom skills,
// overrides, and disabled markers; a default profile is always available.
export async function listSkillProfiles() {
  const profiles = await listEncryptedSkillProfiles();
  return Array.from(new Set(['default-model', ...profiles])).sort();
}

// Lists skills for profile in the stable shape expected by callers.
export async function listSkillsForProfile(profileName) {
  const profile = normalizeProfileName(profileName);
  const overrides = await listEncryptedUserSkills(profile);
  const overrideById = new Map(overrides.map((skill) => [String(skill.id || ''), skill]));
  const skills = [];
  for (const entry of BUILT_IN_SKILLS) {
    const builtIn = normalizeSkillFromDisk(entry, entry?.id || 'skill');
    const override = overrideById.get(builtIn.id);
    overrideById.delete(builtIn.id);
    if (override?.deleted === true) continue;
    skills.push(override ? normalizeSkillFromDisk(override, builtIn.id) : builtIn);
  }
  for (const skill of overrideById.values()) {
    if (skill?.deleted !== true) skills.push(normalizeSkillFromDisk(skill, skill?.id || 'skill'));
  }
  skills.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title);
  });
  return { profile, skills };
}

// Creates or updates skill for profile using the canonical persistence contract.
export async function upsertSkillForProfile(profileName, skillInput) {
  const profile = normalizeProfileName(profileName);
  const incomingId = normalizeSkillId(skillInput?.id || skillInput?.title || 'skill');
  const current = await listSkillsForProfile(profile);
  const existing = current.skills.find((skill) => skill.id === incomingId) || null;
  const skill = normalizeSkillForStorage(skillInput, existing);
  await upsertEncryptedUserSkill(profile, skill.id, skill);
  return { profile, skill };
}

// Deletes skill from profile through the persistence path owned by the local bridge service layer.
export async function deleteSkillFromProfile(profileName, skillIdInput) {
  const profile = normalizeProfileName(profileName);
  const skillId = normalizeSkillId(skillIdInput, 'skill');
  const isBuiltIn = BUILT_IN_SKILLS.some((skill) => normalizeSkillId(skill?.id) === skillId);
  if (isBuiltIn)
    await upsertEncryptedUserSkill(profile, skillId, {
      id: skillId,
      deleted: true,
    });
  else await deleteEncryptedUserSkill(profile, skillId);
  return { profile, skillId, deleted: true };
}

// Determines whether is binary for the local bridge service layer.
export function isBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

// Expands home into the canonical value used by the local bridge service layer.
export function expandHome(inputPath) {
  if (!inputPath) return null;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

// Resolves path from the available configuration and runtime context.
export function resolvePath(inputPath, baseDir) {
  const expanded = expandHome(inputPath);
  if (!expanded) return baseDir;
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded));
}

// Normalizes path token into the canonical form expected by the local bridge service layer.
export function normalizePathToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Determines whether the directory exists for the local bridge service layer.
export async function directoryExists(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Selects or derives path case insensitive from the available settings, input, and runtime
 * context.
 */

export async function resolvePathCaseInsensitive(inputPath, baseDir) {
  const expanded = expandHome(inputPath);
  if (!expanded) return baseDir;

  const isAbsolute = path.isAbsolute(expanded);
  const segments = String(expanded)
    .split(/[\\/]+/g)
    .filter(Boolean);

  let current = isAbsolute ? path.parse(expanded).root || '/' : baseDir;

  for (const segment of segments) {
    const direct = path.join(current, segment);
    if (await directoryExists(direct)) {
      current = direct;
      continue;
    }

    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return null;
    }

    const matched = entries.find((entry) => entry.name.toLowerCase() === segment.toLowerCase());
    if (!matched) return null;
    current = path.join(current, matched.name);
  }

  return current;
}

/**
 * Selects or derives find root path from the available settings, input, and runtime
 * context.
 */

export async function resolveFindRootPath(inputPath, baseDir) {
  const requestedPath = String(inputPath || '.').trim() || '.';
  const primary = resolvePath(requestedPath, baseDir);

  if (await directoryExists(primary)) {
    return {
      rootPath: primary,
      requestedPath,
      resolvedBy: 'direct',
      attemptedPaths: [primary],
    };
  }

  const attemptedPaths = [primary];

  const caseInsensitive = await resolvePathCaseInsensitive(requestedPath, baseDir);
  if (caseInsensitive && caseInsensitive !== primary && (await directoryExists(caseInsensitive))) {
    attemptedPaths.push(caseInsensitive);
    return {
      rootPath: caseInsensitive,
      requestedPath,
      resolvedBy: 'case-insensitive',
      attemptedPaths,
    };
  }

  const requestedSegments = requestedPath.split(/[\\/]+/g).filter(Boolean);
  const requestedLeaf = requestedSegments.length
    ? requestedSegments[requestedSegments.length - 1]
    : requestedPath;
  const leafToken = normalizePathToken(requestedLeaf);
  const docsRoot = path.join(os.homedir(), 'Documents');

  if (DOCUMENTS_ALIAS_TOKENS.has(leafToken) && (await directoryExists(docsRoot))) {
    attemptedPaths.push(docsRoot);
    return {
      rootPath: docsRoot,
      requestedPath,
      resolvedBy: 'documents-alias',
      attemptedPaths,
    };
  }

  return {
    rootPath: primary,
    requestedPath,
    resolvedBy: 'unresolved',
    attemptedPaths,
  };
}

/**
 * Reads json body and converts it into the representation used by the application.
 */

export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      throw withStatus('Request body too large', 413);
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');

  try {
    return JSON.parse(raw);
  } catch {
    throw withStatus('Invalid JSON body', 400);
  }
}

// Returns groups used by the local bridge service layer.
export async function getGroups() {
  try {
    const { stdout } = await runStructuredProcess('id', ['-Gn'], {
      timeoutMs: 3000,
      maxBufferBytes: 64 * 1024,
    });
    return stdout.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

// Returns session info used by the local bridge service layer.
export async function getSessionInfo(baseDir) {
  const userInfo = os.userInfo();
  const groups = await getGroups();

  return {
    user: userInfo.username,
    hostname: os.hostname(),
    groups,
    sudo: groups.includes('sudo') || groups.includes('wheel'),
    shell: process.env.SHELL || '/bin/bash',
    home: userInfo.homedir,
    uid: userInfo.uid,
    gid: userInfo.gid,
    cwd: baseDir,
    platform: process.platform,
  };
}

/**
 * Walks a directory into the bounded nested tree returned to the Files panel and agent
 * tools. Depth and entry ceilings keep large or cyclic-looking workspaces from turning one
 * listing request into unbounded traversal.
 */

export async function buildTree(targetPath, depth) {
  const stats = await fs.stat(targetPath);
  const node = {
    name: path.basename(targetPath) || targetPath,
    path: targetPath,
    type: stats.isDirectory() ? 'dir' : 'file',
    size: stats.size,
  };

  if (!stats.isDirectory() || depth <= 0) return node;

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const visibleEntries = entries.filter(
    (entry) => !(entry.isDirectory() && isExcludedDirectoryName(entry.name)),
  );
  const sorted = visibleEntries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const sliced = sorted.slice(0, MAX_TREE_ENTRIES);
  node.children = await Promise.all(
    sliced.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name);

      try {
        if (entry.isDirectory()) {
          return buildTree(entryPath, depth - 1);
        }

        return {
          name: entry.name,
          path: entryPath,
          type: 'file',
        };
      } catch {
        return {
          name: entry.name,
          path: entryPath,
          type: 'file',
          unreadable: true,
        };
      }
    }),
  );

  if (sorted.length > MAX_TREE_ENTRIES) {
    node.truncated = true;
  }

  return node;
}

// Parses cd command into the canonical representation used by the local bridge service layer.
export function parseCdCommand(command) {
  const trimmed = command.trim();
  if (!trimmed.startsWith('cd')) return null;

  const rest = trimmed.slice(2).trim();
  return rest || '~';
}

// Parses number into the canonical representation used by the local bridge service layer.
export function parseNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

// Normalizes mouse button into the canonical form expected by the local bridge service layer.
export function normalizeMouseButton(button) {
  const value = String(button || 'left').toLowerCase();
  if (value === 'left') return 1;
  if (value === 'middle') return 2;
  if (value === 'right') return 3;

  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) {
    return numeric;
  }

  return 1;
}

// Normalizes key sequence into the canonical form expected by the local bridge service layer.
export function normalizeKeySequence(input) {
  const value = String(input || '').trim();
  if (!value || !AUTOMATION_KEY_REGEX.test(value)) return null;
  return value;
}

/**
 * Validates one requested mouse, keyboard, scroll, or wait action and reduces it to the
 * bounded vocabulary supported by the desktop backend. Unsupported types or unsafe values
 * are discarded before execution begins.
 */

export function normalizeAutomationAction(action) {
  if (!action || typeof action !== 'object') return null;

  const type = String(action.type || '').toLowerCase();
  switch (type) {
    case 'move': {
      const x = parseNumber(action.x, NaN, 0, 8192);
      const y = parseNumber(action.y, NaN, 0, 8192);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { type, x, y };
    }

    case 'click': {
      const button = normalizeMouseButton(action.button);
      const repeat = parseNumber(action.repeat, action.double ? 2 : 1, 1, 5);
      return { type, button, repeat };
    }

    case 'scroll': {
      const amount = parseNumber(action.amount, 1, -20, 20);
      if (amount === 0) return null;
      return { type, amount };
    }

    case 'type': {
      const text = String(action.text || '');
      if (!text.trim()) return null;
      const delay = parseNumber(action.delay, 1, 0, 50);
      return { type, text: text.slice(0, MAX_AUTOMATION_TEXT_LENGTH), delay };
    }

    case 'key': {
      const key = normalizeKeySequence(action.key);
      if (!key) return null;
      return { type, key };
    }

    case 'hotkey': {
      const keys = Array.isArray(action.keys)
        ? action.keys.map((key) => normalizeKeySequence(key)).filter(Boolean)
        : [];

      if (!keys.length) return null;
      return { type, keys };
    }

    case 'wait': {
      const ms = parseNumber(action.ms, 300, 10, MAX_AUTOMATION_WAIT_MS);
      return { type, ms };
    }

    default:
      return null;
  }
}

/**
 * Produces a concise human-readable description of automation action for the interface or
 * logs.
 */

export function describeAutomationAction(action) {
  switch (action.type) {
    case 'move':
      return `Move cursor to (${action.x}, ${action.y})`;
    case 'click':
      return `Click button ${action.button} x${action.repeat}`;
    case 'scroll':
      return `Scroll ${action.amount > 0 ? 'down' : 'up'} x${Math.abs(action.amount)}`;
    case 'type':
      return `Type ${action.text.length} chars`;
    case 'key':
      return `Press key ${action.key}`;
    case 'hotkey':
      return `Press hotkey ${action.keys.join('+')}`;
    case 'wait':
      return `Wait ${action.ms}ms`;
    default:
      return 'Unknown action';
  }
}

// Determines whether has display server for the local bridge service layer.
export function hasDisplayServer() {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

// Returns display server used by the local bridge service layer.
export function getDisplayServer() {
  if (process.env.XDG_SESSION_TYPE) return process.env.XDG_SESSION_TYPE;
  if (process.env.WAYLAND_DISPLAY) return 'wayland';
  if (process.env.DISPLAY) return 'x11';
  return 'none';
}

// Determines whether the command exists for the local bridge service layer.
export async function commandExists(command) {
  return structuredCommandExists(String(command));
}

// Pauses the current workflow for the requested bounded delay.
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Streaming variant of proxyRemoteRequest: pipes the upstream response body
 * straight to the client `res` (SSE passthrough) instead of buffering. Reuses
 * the same SSRF guard. Used for token streaming, where cloud providers must go
 * through the loopback proxy (browser CORS) but the response must not be buffered.
 */
export async function proxyRemoteStream(opts, res) {
  const { url, method = 'POST', headers = {}, body, timeoutMs, provider } = opts || {};
  const targetUrl = String(url || '').trim();
  if (!targetUrl) throw withStatus('A target url is required for AI proxy requests', 400);

  const destination = createProviderProxyRequestPolicy(targetUrl, provider);
  const normalizedMethod = String(method || 'POST')
    .trim()
    .toUpperCase();
  const normalizedHeaders = normalizeProviderProxyHeaders(destination.providerId, headers);

  let requestBody;
  if (
    normalizedMethod !== 'GET' &&
    normalizedMethod !== 'HEAD' &&
    body !== undefined &&
    body !== null
  ) {
    requestBody = typeof body === 'string' ? body : JSON.stringify(body);
    if (!Object.keys(normalizedHeaders).some((h) => h.toLowerCase() === 'content-type')) {
      normalizedHeaders['Content-Type'] = 'application/json';
    }
  }

  const timeout = parseNumber(timeoutMs, DEFAULT_PROXY_TIMEOUT_MS, 1000, MAX_PROXY_TIMEOUT_MS);
  const upstream = await openSafeRemoteResponse(destination.url, {
    method: normalizedMethod,
    headers: normalizedHeaders,
    body: requestBody,
    policy: {
      ...destination.policy,
      timeoutMs: timeout,
      idleTimeoutMs: Math.min(DEFAULT_PROXY_IDLE_TIMEOUT_MS, timeout),
      maxRequestBytes: MAX_BODY_SIZE,
    },
  });

  const closeUpstream = () => upstream.cleanup();
  res.once('close', closeUpstream);
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers['content-type'] || 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });

  let streamedBytes = 0;
  try {
    for await (const value of upstream.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      streamedBytes += chunk.byteLength;
      if (streamedBytes > MAX_PROXY_STREAM_BYTES) {
        upstream.body.destroy();
        break;
      }
      if (!res.write(chunk)) {
        await new Promise((resolve) => {
          // Settles the current operation exactly once and publishes its terminal result.
          const finish = () => {
            res.off('drain', finish);
            res.off('close', finish);
            resolve();
          };
          res.once('drain', finish);
          res.once('close', finish);
        });
        if (res.destroyed || res.writableEnded) break;
      }
    }
  } catch {
    /* Client disconnects and upstream resets end the stream without corrupting bridge state. */
  } finally {
    res.off('close', closeUpstream);
    upstream.cleanup();
    try {
      res.end();
    } catch {
      /* already ended */
    }
  }
}

/**
 * Proxies a bounded remote AI or integration request when the browser cannot call the
 * destination directly. It applies timeout and response-size limits and returns a
 * response-like payload so provider adapters can share their parsing path.
 */

export async function proxyRemoteRequest({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs,
  provider,
} = {}) {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) {
    throw withStatus('A target url is required for AI proxy requests', 400);
  }

  const destination = createProviderProxyRequestPolicy(targetUrl, provider);
  const normalizedMethod = String(method || 'GET')
    .trim()
    .toUpperCase();
  const normalizedHeaders = normalizeProviderProxyHeaders(destination.providerId, headers);

  let requestBody;
  if (
    normalizedMethod !== 'GET' &&
    normalizedMethod !== 'HEAD' &&
    body !== undefined &&
    body !== null
  ) {
    requestBody = typeof body === 'string' ? body : JSON.stringify(body);
    const hasContentType = Object.keys(normalizedHeaders).some(
      (headerName) => headerName.toLowerCase() === 'content-type',
    );
    if (!hasContentType) normalizedHeaders['Content-Type'] = 'application/json';
  }

  const timeout = parseNumber(timeoutMs, DEFAULT_PROXY_TIMEOUT_MS, 1000, MAX_PROXY_TIMEOUT_MS);
  const response = await safeRemoteRequestBuffer(destination.url, {
    method: normalizedMethod,
    headers: normalizedHeaders,
    body: requestBody,
    policy: {
      ...destination.policy,
      timeoutMs: timeout,
      idleTimeoutMs: Math.min(DEFAULT_PROXY_IDLE_TIMEOUT_MS, timeout),
      maxRequestBytes: MAX_BODY_SIZE,
      maxResponseBytes: MAX_PROXY_RESPONSE_BYTES,
    },
  });

  const rawText = response.bytes.toString('utf8');
  const characterTruncated = rawText.length > MAX_PROXY_RESPONSE_CHARS;
  const text = characterTruncated ? rawText.slice(0, MAX_PROXY_RESPONSE_CHARS) : rawText;
  const truncated = response.truncated || characterTruncated;

  let data = null;
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const looksLikeJson = /^\s*[\[{]/.test(text);
  if (contentType.includes('json') || looksLikeJson) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    contentType,
    data,
    text,
    truncated,
  };
}

// Decodes entity code point into the representation consumed by the local bridge service layer.
export function decodeEntityCodePoint(value, radix = 10) {
  const numeric = parseInt(String(value || ''), radix);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) return ' ';

  try {
    return String.fromCodePoint(numeric);
  } catch {
    return ' ';
  }
}

// Decodes HTML entities into the representation consumed by the local bridge service layer.
export function decodeHtmlEntities(value) {
  const text = String(value || '');
  if (!text) return '';

  return text
    .replace(/&#(\d+);/g, (_, code) => decodeEntityCodePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeEntityCodePoint(code, 16))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

// Removes unsupported or unsafe HTML tags from the supplied value.
export function stripHtmlTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

// Normalizes readable text into the canonical form expected by the local bridge service layer.
export function normalizeReadableText(value, maxLength = MAX_WEB_TEXT_CHARS) {
  const lines = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const joined = lines.join('\n');
  return joined.slice(0, Math.max(1, maxLength));
}

// Normalizes single line into the canonical form expected by the local bridge service layer.
export function normalizeSingleLine(value, maxLength = 420) {
  return normalizeReadableText(value, maxLength).replace(/\n+/g, ' ').trim();
}

// Tokenizes a web query into normalized terms used for result scoring and caching.
export function tokenizeWebQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 20);
}

// Estimates text lines for policy or budgeting decisions in the local bridge service layer.
export function estimateTextLines(value) {
  const text = String(value || '').trim();
  if (!text) return 0;

  const explicitLines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (explicitLines.length >= 2) return explicitLines.length;
  return Math.max(1, Math.ceil(text.length / 120));
}

// Scores web source relevance using the criteria owned by the local bridge service layer.
export function scoreWebSourceRelevance(queryTokens, sourceText) {
  if (!Array.isArray(queryTokens) || queryTokens.length === 0) return 0;

  const haystack = String(sourceText || '').toLowerCase();
  let score = 0;

  queryTokens.forEach((token) => {
    if (!haystack.includes(token)) return;
    score += token.length >= 7 ? 1.4 : token.length >= 5 ? 1.1 : 0.8;
  });

  return Number(score.toFixed(3));
}

// Returns the first non-empty candidate after normalizing each value.
export function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

// Determines whether the map web safe search for the local bridge service layer.
export function mapWebSafeSearch(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'strict') return SafeSearchType.STRICT;
  if (normalized === 'off' || normalized === 'none') return SafeSearchType.OFF;
  return SafeSearchType.MODERATE;
}

// Maps web time range into the stable application-facing representation.
export function mapWebTimeRange(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return SearchTimeType.ALL;

  if (['d', 'day', '24h', 'today', 'past_day'].includes(normalized)) return SearchTimeType.DAY;
  if (['w', 'week', 'past_week'].includes(normalized)) return SearchTimeType.WEEK;
  if (['m', 'month', 'past_month'].includes(normalized)) return SearchTimeType.MONTH;
  if (['y', 'year', 'past_year'].includes(normalized)) return SearchTimeType.YEAR;
  return SearchTimeType.ALL;
}

// Normalizes web cache token into the canonical form expected by the local bridge service layer.
export function normalizeWebCacheToken(value, maxLength = 140) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, Math.max(12, Number(maxLength) || 140));
}

// Builds web research cache key for the next stage of the local bridge service layer.
export function buildWebResearchCacheKey(query, options = {}) {
  const providerPlan = Array.isArray(options.providerPlan)
    ? options.providerPlan.map((entry) => normalizeWebCacheToken(entry, 24)).filter(Boolean)
    : [];

  const keyPayload = {
    query: normalizeWebCacheToken(query, 220),
    maxResults: Number(options.maxResults || DEFAULT_WEB_SEARCH_RESULTS),
    maxSources: Number(options.maxSources || DEFAULT_WEB_SOURCE_COUNT),
    locale: normalizeWebCacheToken(options.locale || 'en-us', 24),
    region: normalizeWebCacheToken(options.region || 'wt-wt', 24),
    safeSearch: normalizeWebCacheToken(options.safeSearch || 'moderate', 16),
    timeRange: normalizeWebCacheToken(options.timeRange || options.time || 'all', 16),
    includeContent: options.includeContent !== false,
    allowPaidFallback: options.allowPaidFallback === true,
    providerPlan,
  };

  return JSON.stringify(keyPayload);
}

// Copies web research result into a caller-safe result without sharing mutable state.
export function cloneWebResearchResult(payload) {
  if (!payload || typeof payload !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
}

// Removes stale web research cache so retained state remains bounded.
export function pruneWebResearchCache() {
  const now = Date.now();

  for (const [cacheKey, entry] of WEB_RESEARCH_CACHE.entries()) {
    const ageMs = Math.max(0, now - Number(entry?.createdAt || 0));
    if (ageMs > WEB_RESEARCH_STALE_CACHE_TTL_MS) {
      WEB_RESEARCH_CACHE.delete(cacheKey);
    }
  }

  while (WEB_RESEARCH_CACHE.size > WEB_RESEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = WEB_RESEARCH_CACHE.keys().next().value;
    if (!oldestKey) break;
    WEB_RESEARCH_CACHE.delete(oldestKey);
  }
}

// Returns cached web research used by the local bridge service layer.
export function getCachedWebResearch(cacheKey, { allowStale = false } = {}) {
  if (!cacheKey) return null;

  const entry = WEB_RESEARCH_CACHE.get(cacheKey);
  if (!entry || typeof entry !== 'object') return null;

  const createdAt = Number(entry.createdAt || 0);
  const ageMs = Math.max(0, Date.now() - createdAt);
  const isFresh = ageMs <= WEB_RESEARCH_CACHE_TTL_MS;
  const isStaleAllowed = allowStale && ageMs <= WEB_RESEARCH_STALE_CACHE_TTL_MS;

  if (!isFresh && !isStaleAllowed) {
    WEB_RESEARCH_CACHE.delete(cacheKey);
    return null;
  }

  const cloned = cloneWebResearchResult(entry.result);
  if (!cloned) {
    WEB_RESEARCH_CACHE.delete(cacheKey);
    return null;
  }

  cloned.cache = {
    hit: true,
    stale: !isFresh,
    ageMs,
  };

  return cloned;
}

// Updates bridge service runtime with the supplied cached web research value.
export function setCachedWebResearch(cacheKey, resultPayload) {
  if (!cacheKey || !resultPayload || typeof resultPayload !== 'object') return;

  const stored = cloneWebResearchResult(resultPayload);
  if (!stored) return;

  WEB_RESEARCH_CACHE.set(cacheKey, {
    createdAt: Date.now(),
    result: stored,
  });

  pruneWebResearchCache();
}

// Determines whether is web rate limit error for the local bridge service layer.
export function isWebRateLimitError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 429) return true;

  const text = String(error?.message || error || '').toLowerCase();
  if (!text) return false;

  return ['rate limit', 'too many requests', '429', 'quota', 'throttl'].some((token) =>
    text.includes(token),
  );
}

// Retrieves HTML with timeout and converts it into the application's expected result shape.
export async function fetchHtmlWithTimeout(
  targetUrl,
  timeoutMs = DEFAULT_WEB_FETCH_TIMEOUT_MS,
  signal,
) {
  const safeTimeout = parseNumber(
    timeoutMs,
    DEFAULT_WEB_FETCH_TIMEOUT_MS,
    1000,
    MAX_WEB_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await safeRemoteRequestBuffer(targetUrl, {
      method: 'GET',
      signal,
      headers: {
        'User-Agent': WEB_FETCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.8',
      },
      policy: {
        addressMode: 'public',
        allowedProtocols: ['https:', 'http:'],
        allowedMethods: ['GET'],
        allowCrossOriginRedirects: true,
        maxRedirects: 5,
        timeoutMs: safeTimeout,
        idleTimeoutMs: Math.min(15000, safeTimeout),
        maxResponseBytes: MAX_WEB_HTML_CHARS,
      },
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      url: response.url || targetUrl,
      contentType: String(response.headers['content-type'] || ''),
      text: response.bytes.toString('utf8'),
      truncated: response.truncated,
    };
  } catch (error) {
    throw new Error(`Failed to fetch ${targetUrl}: ${error?.message || 'network error'}`);
  }
}

// Determines whether a web hostname matches the session allowlist.
function webHostInAllowlist(url, allowedDomains) {
  let host = '';
  try {
    host = new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (!host) return false;
  return (allowedDomains || []).some((p) => {
    const pat = String(p || '')
      .toLowerCase()
      .replace(/^www\./, '');
    if (!pat) return false;
    if (pat.startsWith('*.')) {
      const base = pat.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === pat || host.endsWith(`.${pat}`);
  });
}

/**
 * Finds embedded content within a larger input for later policy or presentation logic.
 */

function extractEmbeddedContent(rawHtml) {
  const html = String(rawHtml || '');
  // Extracts the content value from a matching HTML metadata tag.
  const metaContent = (name) => {
    const a = html.match(
      new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    );
    const b = html.match(
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'),
    );
    const m = a || b;
    return m ? decodeHtmlEntities(m[1]).trim() : '';
  };

  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const title = normalizeSingleLine(
    decodeHtmlEntities(
      firstNonEmpty(metaContent('og:title'), metaContent('twitter:title'), titleTag),
    ),
    260,
  );
  const description = firstNonEmpty(
    metaContent('description'),
    metaContent('og:description'),
    metaContent('twitter:description'),
  );

  // JSON-LD structured data — common on JS sites for SEO.
  const ldTexts = [];
  for (const block of [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ].slice(0, 6)) {
    try {
      const json = JSON.parse(block[1].trim());
      // Collects collect into the bounded result consumed by the local bridge service layer.
      const collect = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 5) return;
        for (const key of ['headline', 'description', 'articleBody', 'name', 'text', 'abstract']) {
          if (typeof obj[key] === 'string' && obj[key].trim().length > 20)
            ldTexts.push(obj[key].trim());
        }
        for (const v of Object.values(obj)) if (v && typeof v === 'object') collect(v, depth + 1);
      };
      if (Array.isArray(json)) json.forEach((j) => collect(j, 0));
      else collect(json, 0);
    } catch {
      /* skip malformed JSON-LD */
    }
  }

  // Embedded app state (Next.js __NEXT_DATA__ / generic) — pull human-readable strings.
  let stateText = '';
  const nextMatch =
    html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i) ||
    html.match(/window\.__(?:NUXT|INITIAL_STATE|APOLLO_STATE)__\s*=\s*([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1].replace(/;\s*$/, '').trim());
      const strings = [];
      // Traverses the current structure recursively and accumulates matching entries.
      const walk = (o, depth) => {
        if (depth > 7 || strings.join(' ').length > 12000) return;
        if (typeof o === 'string') {
          if (o.length > 40 && /\s/.test(o)) strings.push(o);
          return;
        }
        if (Array.isArray(o)) {
          for (const v of o) walk(v, depth + 1);
          return;
        }
        if (o && typeof o === 'object') {
          for (const v of Object.values(o)) walk(v, depth + 1);
        }
      };
      walk(data?.props ?? data, 0);
      stateText = strings.join('\n');
    } catch {
      /* skip */
    }
  }

  const noscript = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)]
    .map((m) => stripHtmlTags(m[1]))
    .join(' ');

  const structured = normalizeReadableText(
    decodeHtmlEntities(
      [description, ldTexts.join('\n'), stateText, noscript].filter(Boolean).join('\n\n'),
    ),
    MAX_WEB_TEXT_CHARS,
  );

  // Heuristic: an empty mount root + a framework global ⇒ client-rendered.
  const jsLikely =
    /<div[^>]+id=["'](?:root|app|__next|__nuxt|gatsby-focus-wrapper)["']/i.test(html) ||
    /window\.__(?:NEXT_DATA__|NUXT__|INITIAL_STATE__|APOLLO_STATE__)/i.test(html) ||
    /<script[^>]+src=["'][^"']*(?:react|vue|next|nuxt|svelte)/i.test(html);

  return { title, description, structured, jsLikely };
}

/**
 * Finds article from html within a larger input for later policy or presentation logic.
 */

export function extractArticleFromHtml(html, pageUrl) {
  const rawHtml = String(html || '');
  const embedded = extractEmbeddedContent(rawHtml);
  let dom = null;
  let mainText = '';
  let title = '';
  let byline = '';
  let siteName = '';
  let readabilityUsed = false;

  try {
    dom = new JSDOM(rawHtml, { url: pageUrl });
    const document = dom.window.document;
    const readability = new Readability(document);
    const parsed = readability.parse();
    const readableText = normalizeReadableText(parsed?.textContent || '', MAX_WEB_TEXT_CHARS);
    const fallbackBody = normalizeReadableText(
      decodeHtmlEntities(document.body?.textContent || ''),
      MAX_WEB_TEXT_CHARS,
    );
    mainText = firstNonEmpty(readableText, fallbackBody);
    title = normalizeSingleLine(firstNonEmpty(parsed?.title, document.title, embedded.title), 260);
    byline = normalizeSingleLine(parsed?.byline || '', 180);
    siteName = normalizeSingleLine(parsed?.siteName || '', 120);
    readabilityUsed = Boolean(readableText);
  } catch {
    mainText = normalizeReadableText(
      decodeHtmlEntities(stripHtmlTags(rawHtml)),
      MAX_WEB_TEXT_CHARS,
    );
    title = normalizeSingleLine(embedded.title, 260);
  } finally {
    try {
      dom?.window?.close?.();
    } catch {
      /* ignore JSDOM cleanup errors */
    }
  }

  // JS-rendered pages return little static body text — fall back to the embedded
  // metadata/structured data so we return something useful instead of empty/erroring.
  const thin = mainText.replace(/\s+/g, ' ').trim().length < 500;
  let text = mainText;
  let jsRendered = false;
  if (thin && embedded.structured) {
    text = normalizeReadableText(
      [mainText, embedded.structured].filter(Boolean).join('\n\n'),
      MAX_WEB_TEXT_CHARS,
    );
    jsRendered = true;
  } else if (thin && embedded.jsLikely) {
    jsRendered = true;
  }

  return {
    title: firstNonEmpty(title, normalizeSingleLine(embedded.title, 260)),
    excerpt: normalizeSingleLine(firstNonEmpty(embedded.description, text.slice(0, 420)), 520),
    text,
    byline,
    siteName,
    readabilityUsed,
    jsRendered,
  };
}

// Retrieves JSON with timeout and converts it into the application's expected result shape.
export async function fetchJsonWithTimeout(url, timeoutMs = LOCAL_AI_DISCOVERY_TIMEOUT_MS) {
  try {
    const response = await safeRemoteRequestBuffer(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      policy: {
        addressMode: 'loopback',
        allowedProtocols: ['http:', 'https:'],
        allowedMethods: ['GET'],
        allowCrossOriginRedirects: false,
        maxRedirects: 1,
        timeoutMs,
        idleTimeoutMs: timeoutMs,
        maxResponseBytes: 1024 * 1024,
      },
    });
    if (response.status < 200 || response.status >= 300 || response.truncated) return null;
    return JSON.parse(response.bytes.toString('utf8'));
  } catch {
    return null;
  }
}

// Extracts discovered models from the provider or document response used by the local bridge
// service layer.
export function extractDiscoveredModels(kind, payload) {
  if (!payload || typeof payload !== 'object') return [];

  if (kind === 'ollama' && Array.isArray(payload.models)) {
    return payload.models
      .map((model) => String(model?.name || '').trim())
      .filter(Boolean)
      .slice(0, 40);
  }

  if (Array.isArray(payload.data)) {
    return payload.data
      .map((model) => String(model?.id || model?.name || '').trim())
      .filter(Boolean)
      .slice(0, 40);
  }

  return [];
}

const localOllamaPullJobs = new Map();
const LOCAL_OLLAMA_PULL_JOB_TTL_MS = 60 * 60 * 1000;

function normalizeLocalOllamaPull(baseUrl, model) {
  const normalizedModel = String(model || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,199}$/.test(normalizedModel)) {
    throw new Error('A valid Ollama model ID is required');
  }

  const parsed = new URL(String(baseUrl || 'http://127.0.0.1:11434'));
  if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
    throw new Error('Ollama downloads are restricted to a loopback HTTP endpoint');
  }

  return {
    model: normalizedModel,
    root: parsed.href.replace(/\/$/, ''),
  };
}

function pruneLocalOllamaPullJobs() {
  const now = Date.now();
  for (const [jobId, job] of localOllamaPullJobs) {
    if (job.finishedAt && now - job.finishedAt > LOCAL_OLLAMA_PULL_JOB_TTL_MS) {
      localOllamaPullJobs.delete(jobId);
    }
  }
}

function publicLocalOllamaPullJob(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    model: job.model,
    state: job.state,
    status: job.status,
    completed: job.completed,
    total: job.total,
    percent:
      job.total > 0 ? Math.max(0, Math.min(100, Math.round((job.completed / job.total) * 100))) : 0,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || undefined,
  };
}

async function runLocalOllamaPullJob(job) {
  try {
    const response = await fetch(`${job.root}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: job.model, stream: true }),
      signal: job.controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(String(payload?.error || `Ollama download failed (${response.status})`));
    }
    if (!response.body) throw new Error('Ollama did not return a download stream');

    job.state = 'downloading';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const applyPayload = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.error) throw new Error(String(payload.error));
      if (payload.status) job.status = String(payload.status);
      if (Number.isFinite(Number(payload.total))) job.total = Math.max(0, Number(payload.total));
      if (Number.isFinite(Number(payload.completed))) {
        job.completed = Math.max(0, Number(payload.completed));
      }
      const normalizedStatus = String(payload.status || '').toLowerCase();
      if (/verif|manifest|writing|success/.test(normalizedStatus)) job.state = 'verifying';
      if (normalizedStatus === 'success') job.state = 'success';
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        applyPayload(JSON.parse(trimmed));
      }
      if (done) break;
    }
    if (buffer.trim()) applyPayload(JSON.parse(buffer.trim()));
    if (job.state !== 'success') {
      job.state = 'success';
      job.status = job.status || 'success';
    }
  } catch (error) {
    if (job.controller.signal.aborted) {
      job.state = 'cancelled';
      job.status = 'Download cancelled';
    } else {
      job.state = 'error';
      job.error =
        error instanceof Error ? error.message : String(error || 'Ollama download failed');
    }
  } finally {
    job.finishedAt = Date.now();
  }
}

export function startLocalOllamaModelPull(baseUrl, model) {
  pruneLocalOllamaPullJobs();
  const normalized = normalizeLocalOllamaPull(baseUrl, model);
  for (const job of localOllamaPullJobs.values()) {
    if (job.root === normalized.root && job.model === normalized.model && !job.finishedAt) {
      return publicLocalOllamaPullJob(job);
    }
  }

  const jobId = createHash('sha256')
    .update(`${normalized.root}|${normalized.model}|${Date.now()}|${Math.random()}`)
    .digest('hex')
    .slice(0, 24);
  const job = {
    jobId,
    ...normalized,
    controller: new AbortController(),
    state: 'queued',
    status: 'Preparing download',
    completed: 0,
    total: 0,
    error: '',
    startedAt: Date.now(),
    finishedAt: 0,
  };
  localOllamaPullJobs.set(jobId, job);
  void runLocalOllamaPullJob(job);
  return publicLocalOllamaPullJob(job);
}

export function getLocalOllamaModelPull(jobId) {
  pruneLocalOllamaPullJobs();
  const job = localOllamaPullJobs.get(String(jobId || ''));
  if (!job) throw new Error('Ollama download job was not found');
  return publicLocalOllamaPullJob(job);
}

export function cancelLocalOllamaModelPull(jobId) {
  const job = localOllamaPullJobs.get(String(jobId || ''));
  if (!job) throw new Error('Ollama download job was not found');
  if (!job.finishedAt) job.controller.abort();
  return publicLocalOllamaPullJob(job);
}

// Reads the installed Ollama model metadata rather than guessing media support from its name.
export async function getLocalModelInputCapabilities(baseUrl, model) {
  const normalized = normalizeLocalOllamaPull(baseUrl, model);
  const response = await fetch(`${normalized.root}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: normalized.model }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(payload?.error || `Ollama model inspection failed (${response.status})`),
    );
  }

  const capabilities = Array.isArray(payload?.capabilities)
    ? payload.capabilities.map((value) => String(value).toLowerCase())
    : [];
  const details = payload?.details && typeof payload.details === 'object' ? payload.details : {};
  const metadata =
    payload?.model_info && typeof payload.model_info === 'object' ? payload.model_info : {};
  const metadataKeys = Object.keys(metadata).map((key) => key.toLowerCase());
  const projector = metadataKeys.some((key) =>
    /(?:vision|visual|image|projector|clip|mmproj)/.test(key),
  );

  return {
    model: normalized.model,
    image: capabilities.some((value) => ['vision', 'image', 'images'].includes(value)) || projector,
    audio: capabilities.some((value) => ['audio', 'speech'].includes(value)),
    capabilities,
    family: String(details?.family || ''),
  };
}

// Reads OpenRouter's declared input modalities instead of inferring them from a model name.
export async function getRemoteModelInputCapabilities(provider, model, apiKey) {
  const normalizedProvider = String(provider || '')
    .trim()
    .toLowerCase();
  const normalizedModel = String(model || '').trim();
  if (normalizedProvider !== 'openrouter') {
    throw new Error('Remote capability discovery is not available for this provider');
  }
  if (!normalizedModel || normalizedModel.length > 240) {
    throw new Error('A valid model identifier is required');
  }

  const response = await fetch(
    `https://openrouter.ai/api/v1/models?q=${encodeURIComponent(normalizedModel)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${String(apiKey || '').trim()}`,
        'HTTP-Referer': 'https://iris-agentics.local',
        'X-Title': 'IRIS',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenRouter model inspection failed (${response.status})`);
  }

  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const entry = entries.find((candidate) => {
    const id = String(candidate?.id || '');
    const canonical = String(candidate?.canonical_slug || '');
    return id === normalizedModel || canonical === normalizedModel;
  });
  const modalities = Array.isArray(entry?.architecture?.input_modalities)
    ? entry.architecture.input_modalities.map((value) => String(value).toLowerCase())
    : [];

  return {
    provider: normalizedProvider,
    model: normalizedModel,
    image: modalities.includes('image'),
    audio: modalities.includes('audio'),
    capabilities: modalities,
  };
}

// Discovers local AI servers from the available provider or runtime capabilities.
export async function pullLocalOllamaModel(baseUrl, model) {
  const normalized = normalizeLocalOllamaPull(baseUrl, model);
  const response = await fetch(`${normalized.root}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: normalized.model, stream: false }),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || `Ollama download failed (${response.status})`));
  }

  return {
    ok: true,
    model: normalized.model,
    status: String(payload?.status || 'success'),
  };
}

export async function discoverLocalAIServers() {
  const probes = await Promise.all(
    LOCAL_AI_DISCOVERY_CANDIDATES.map(async (candidate) => {
      const endpoint = `${candidate.url}${candidate.checkPath}`;
      const payload = await fetchJsonWithTimeout(endpoint);
      if (!payload) return null;

      const models = extractDiscoveredModels(candidate.kind, payload);
      return {
        kind: candidate.kind,
        url: candidate.url,
        endpoint,
        modelCount: models.length,
        models,
      };
    }),
  );

  const servers = probes.filter(Boolean);
  const preferred = servers.find((server) => server.modelCount > 0) || servers[0] || null;

  return { servers, preferred };
}

/**
 * Runs xdotool from initialization through completion, including its cleanup behavior.
 */

export async function runXdotool(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('xdotool', args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `xdotool exited with code ${code}`));
    });
  });
}

// Returns automation capabilities used by the local bridge service layer.
export async function getAutomationCapabilities() {
  const xdotoolAvailable = await commandExists('xdotool');
  const displayServer = getDisplayServer();
  const hasDisplay = hasDisplayServer();

  return {
    xdotoolAvailable,
    displayServer,
    hasDisplay,
    canRun: xdotoolAvailable && hasDisplay,
    recommended: xdotoolAvailable ? (hasDisplay ? 'ready' : 'missing-display') : 'install-xdotool',
  };
}

/**
 * Executes the bounded mouse and keyboard action vocabulary produced by Vision after the
 * renderer has supplied the required acknowledgement. It reports per-action outcomes and
 * stops on unsupported or failed operations rather than continuing an uncertain desktop
 * plan.
 */

export async function executeAutomationActions(
  actions,
  { dryRun = false, cwd, allowMouseControl = false } = {},
) {
  const inputActions = Array.isArray(actions) ? actions : [];
  const normalizedActions = inputActions
    .slice(0, MAX_AUTOMATION_ACTIONS)
    .map((action) => normalizeAutomationAction(action))
    .filter(Boolean);

  if (!normalizedActions.length) {
    throw withStatus('No valid automation actions were provided', 400);
  }

  if (dryRun) {
    return {
      dryRun: true,
      attempted: normalizedActions.length,
      executed: 0,
      actions: normalizedActions.map((action) => ({
        ...action,
        detail: describeAutomationAction(action),
      })),
    };
  }

  if (!allowMouseControl) {
    throw withStatus('Mouse Control permission is required to execute automation actions', 403);
  }

  const capabilities = await getAutomationCapabilities();
  if (!capabilities.xdotoolAvailable) {
    throw withStatus(
      'xdotool is not installed. Install xdotool to enable local mouse/keyboard automation.',
      503,
    );
  }

  if (!capabilities.hasDisplay) {
    throw withStatus(
      'No desktop display session detected. Automation requires an active graphical session.',
      503,
    );
  }

  const results = [];
  let executed = 0;

  for (let index = 0; index < normalizedActions.length; index += 1) {
    const action = normalizedActions[index];

    try {
      if (action.type === 'move') {
        await runXdotool(['mousemove', '--sync', String(action.x), String(action.y)], cwd);
      } else if (action.type === 'click') {
        await runXdotool(['click', '--repeat', String(action.repeat), String(action.button)], cwd);
      } else if (action.type === 'scroll') {
        const scrollButton = action.amount > 0 ? '5' : '4';
        await runXdotool(['click', '--repeat', String(Math.abs(action.amount)), scrollButton], cwd);
      } else if (action.type === 'type') {
        await runXdotool(['type', '--delay', String(action.delay), '--', action.text], cwd);
      } else if (action.type === 'key') {
        await runXdotool(['key', '--clearmodifiers', action.key], cwd);
      } else if (action.type === 'hotkey') {
        await runXdotool(['key', '--clearmodifiers', action.keys.join('+')], cwd);
      } else if (action.type === 'wait') {
        await sleep(action.ms);
      }

      executed += 1;
      results.push({
        index: index + 1,
        type: action.type,
        status: 'ok',
        detail: describeAutomationAction(action),
      });
    } catch (error) {
      const failedAction = {
        index: index + 1,
        type: action.type,
        detail: describeAutomationAction(action),
        error: error?.message || 'Automation action failed',
      };

      return {
        dryRun: false,
        attempted: normalizedActions.length,
        executed,
        failedAction,
        results,
      };
    }
  }

  return {
    dryRun: false,
    attempted: normalizedActions.length,
    executed,
    results,
  };
}

// Captures aggregate CPU counters used to calculate interval utilization.
function _cpuTimesSnapshot() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

// Returns system stats used by the local bridge service layer.
export async function getSystemStats() {
  const a = _cpuTimesSnapshot();
  await new Promise((r) => setTimeout(r, 180));
  const b = _cpuTimesSnapshot();
  const idleDiff = b.idle - a.idle;
  const totalDiff = b.total - a.total;
  const cpuPercent =
    totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0;
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const cpus = os.cpus();
  let gpuDevices = [];
  try {
    const { stdout } = await runStructuredProcess(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeoutMs: 3000, maxBufferBytes: 256 * 1024 },
    );
    gpuDevices = String(stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(',');
        return {
          name: String(parts[0] || '').trim(),
          memoryTotalMb: Math.max(0, Number(String(parts[1] || '').trim()) || 0),
        };
      })
      .filter((gpu) => gpu.name);
  } catch {
    gpuDevices = [];
  }
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model?.trim() || '',
    cpuCount: cpus.length,
    cpuPercent,
    loadavg: os.loadavg(),
    memTotal,
    memFree,
    memUsed: memTotal - memFree,
    memPercent: memTotal > 0 ? Math.round(((memTotal - memFree) / memTotal) * 100) : 0,
    uptime: os.uptime(),
    generatedAt: Date.now(),
    gpuDevices,
    gpuMemoryTotalMb: gpuDevices.reduce((sum, gpu) => sum + gpu.memoryTotalMb, 0),
  };
}

// Returns top processes used by the local bridge service layer.
export async function getTopProcesses(limit = 15) {
  const n = Math.max(1, Math.min(50, Number(limit) || 15));
  try {
    const args =
      process.platform === 'darwin'
        ? ['-Aco', 'pid,pcpu,pmem,comm']
        : ['-eo', 'pid,pcpu,pmem,comm', '--sort=-pcpu'];
    const { stdout } = await runStructuredProcess('ps', args, {
      timeoutMs: 5000,
      maxBufferBytes: 2 * 1024 * 1024,
    });
    return stdout
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          cpu: Number(match[2]),
          mem: Number(match[3]),
          command: match[4].trim(),
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.cpu - left.cpu)
      .slice(0, n);
  } catch {
    return [];
  }
}

/**
 * Runs command from initialization through completion, including its cleanup behavior.
 */

export async function runCommand(command, cwd, rootDir = cwd) {
  const cdTarget = parseCdCommand(command);
  if (cdTarget !== null) {
    try {
      const requested = path.isAbsolute(cdTarget) ? cdTarget : path.join(cwd, cdTarget);
      const nextCwd = await resolveDirectoryWithinRoot(requested, rootDir);
      const stats = await fs.stat(nextCwd);
      if (!stats.isDirectory()) {
        return {
          stdout: '',
          stderr: `cd: not a directory: ${nextCwd}`,
          exitCode: 1,
          cwd,
        };
      }

      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        cwd: nextCwd,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `cd: ${error.message || 'failed to change directory'}`,
        exitCode: 1,
        cwd,
      };
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });

    return {
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
      exitCode: 0,
      cwd,
    };
  } catch (error) {
    return {
      stdout: trimOutput(error.stdout),
      stderr: trimOutput(error.stderr || error.message),
      exitCode: typeof error.code === 'number' ? error.code : 1,
      cwd,
    };
  }
}

// Launches child through the operating-system path owned by the local bridge service layer.
function launchChild(child, permit, mode) {
  if (child.pid) activeLaunchProcesses.add(child.pid);
  // Releases release so later operations are not incorrectly blocked.
  const release = () => {
    if (child.pid) activeLaunchProcesses.delete(child.pid);
    permit.release();
  };
  child.once('exit', release);
  child.once('error', release);
  child.unref();
  return { pid: child.pid, mode };
}

// Acquires launcher permit under the limits owned by the local bridge service layer.
function acquireLauncherPermit() {
  if (activeLaunchProcesses.size >= MAX_ACTIVE_LAUNCH_PROCESSES) {
    throw withStatus('Active launcher process limit reached', 429);
  }
  const permit = acquireOperation('launcher');
  if (!permit.allowed) {
    const error = withStatus(permit.message, 429);
    error.code = permit.code;
    error.retryAfterMs = permit.retryAfterMs;
    throw error;
  }
  return permit;
}

// Launches through the operating-system path owned by the local bridge service layer.
export function launch(executable, args, cwd) {
  const permit = acquireLauncherPermit();
  try {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    return launchChild(child, permit, 'command');
  } catch (error) {
    permit.release();
    throw error;
  }
}

// Launches legacy command through the operating-system path owned by the local bridge service
// layer.
export function launchLegacyCommand(command, cwd) {
  const permit = acquireLauncherPermit();
  try {
    const child = spawn(command, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: true,
    });
    return launchChild(child, permit, 'legacy-shell');
  } catch (error) {
    permit.release();
    throw error;
  }
}

export {
  exec,
  spawn,
  fs,
  path,
  os,
  promisify,
  createHash,
  Fuse,
  ddgSearch,
  SafeSearchType,
  SearchTimeType,
  Readability,
  JSDOM,
};
