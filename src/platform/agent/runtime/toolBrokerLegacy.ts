// @ts-nocheck
// Transitional extraction: behavior is preserved verbatim while runtime contracts are typed incrementally.
import { UNTRUSTED_CONTENT_SYSTEM_RULES } from '@/platform/security'
import { recordDelegationMetrics } from '@/platform/skillRewards'
import {
  listDirectory,
  findFiles,
  searchFileSemanticIndex,
  readTextFile,
  writeTextFile,
  editTextFile,
  saveArtifact,
  systemStats,
  systemProcesses,
  executeTerminalCommand,
  launchLocalCommand,
  getAutomationCapabilities,
  searchWebResearch,
  listSkillDefinitions,
  powerRipgrep,
  powerStat,
  powerFind,
  powerFd,
  powerLocate,
  powerDiff,
  powerPatch,
  powerWebFetch,
  powerEnvInspect,
  powerClipboardRead,
  powerClipboardWrite,
  powerScript,
  chatsWriteMemory,
  chatsRecall,
  subagentReadOutput,
} from '@/platform/desktopBridge'
import {
  getLauncherCatalog,
  refreshLauncherCatalog,
  resolveLauncherEntry,
  type LauncherEntry,
} from '@/platform/launcherCatalog'
import { addNote, deleteNote, readNotes, updateNote, queryNotes } from '@/platform/notesStorage'
import { resolveActiveSkillProfile } from '@/platform/skillProfiles'
import { rankRagPassages } from '@/platform/agent/ragRetrieval'
import { lookupTrustedSources } from '@/platform/trustedSources'
import { synthesizeWebResearch } from '@/platform/agent/webResearchTask'
import { readOrbSettings, writeOrbSettings } from '@/platform/settingsStorage'
import { estimateTokens } from '@/platform/agent/usageMetrics'
import {
  handleAgentDelegate,
  handleAgentRecall,
  handleAgentStatus,
  handleAgentRoster,
  handleAgentBroadcast,
  handleAgentVerify,
  reassignFailedPart,
  resolveCurrentRole,
} from '@/platform/orchestrationClient'
import {
  handleAgentFind,
  resolveConsultTarget,
  runPeerConsult,
  runPeerReview,
  runOverwatch,
} from '@/platform/agent/meshClient'
import { createMeshConductor } from '@/platform/agent/meshConductor'
import { DEFAULT_AGENT_READ_LINE_COUNT, getToolPermissionKey } from '@/platform/agent/toolCatalog'

import * as runtimeSupport from '@/platform/agent/runtime/runtimeSupport'
const {
  MAX_FILE_WRITE_LENGTH,
  ARTIFACT_PREVIEW_CHARS,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_SKILL_CARD_COUNT,
  MAX_AGENT_READ_LINE_COUNT,
  SEARCH_WEB_DEFAULT_RESULTS,
  SEARCH_WEB_MAX_RESULTS,
  SEARCH_WEB_DEFAULT_SOURCES,
  SEARCH_WEB_MAX_SOURCES,
  SEARCH_WEB_DEFAULT_CALL_BUDGET,
  AGENT_STATES,
  WEB_SEARCH_BUDGET_BY_ROLE,
  PIPE_TO_SHELL_PATTERNS,
  normalizeApprovalResponse,
  evaluateToolAccess,
  buildCapabilitySnapshot,
  isMissingPathError,
  inferFindQuery,
  shouldUseGlobalPathFallback,
  dedupeStrings,
  normalizeWebSearchQueryKey,
  hasConfiguredPaidFallbackProviders,
  buildWebSearchProviderPolicy,
  rememberWebSearchQuery,
  getWebSearchCache,
  setWebSearchCache,
  buildFindFallbackPaths,
  resolveAgentRootBase,
  assertSafePath,
  assertSafeCommand,
  assertAllowedTool,
} = runtimeSupport

// ── Web access guard helpers ──────────────────────────────────────────────────
// The guard gates INGESTION of a site's content (web.fetch, the pages search.web
// reads, and curl/wget in terminal.exec) behind per-site approval. The search-engine
// query itself is infrastructure and passes.

// Normalize any URL or host string → bare lowercase hostname (www. stripped).
function extractWebHost(input) {
  let s = String(input || '').trim()
  if (!s) return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // strip scheme
  s = s.split(/[/?#]/)[0] // host portion only
  s = s.split('@').pop() // strip userinfo
  s = s.split(':')[0] // strip port
  s = s.toLowerCase().replace(/^www\./, '')
  if (s === 'localhost') return s
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return ''
  return s
}

// True when host matches a permanent allowlist pattern: exact, "*.parent", or a
// subdomain of an approved parent (approving example.com covers docs.example.com).
function webHostMatchesPattern(host, pattern) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '')
  const p = String(pattern || '')
    .toLowerCase()
    .trim()
    .replace(/^www\./, '')
  if (!h || !p) return false
  if (p.startsWith('*.')) {
    const base = p.slice(2)
    return h === base || h.endsWith(`.${base}`)
  }
  return h === p || h.endsWith(`.${p}`)
}

// Is this host already cleared to ingest (guard off / blanket session / session set
// / permanent allowlist)? Unknown/non-host input is NOT auto-blocked here — callers
// only gate when a real host was extracted.
function isWebSiteAllowed(host, settings, approvalState) {
  if (settings?.agent_web_site_guard === false) return true
  if (!host) return true
  if (approvalState?.allowAllSitesForSession) return true
  if (approvalState?.webSiteSessionDomains instanceof Set && approvalState.webSiteSessionDomains.has(host)) return true
  const allow = Array.isArray(settings?.agent_web_allowed_domains) ? settings.agent_web_allowed_domains : []
  return allow.some((p) => webHostMatchesPattern(host, p))
}

// Map an approval response → one of the four web-site decisions.
function normalizeSiteDecision(raw) {
  const token = String(
    raw && typeof raw === 'object'
      ? raw.decision || raw.choice || raw.selection || raw.action || (raw.approved ? 'allow_session' : 'deny')
      : raw,
  )
    .trim()
    .toLowerCase()
  if (['allow_permanent', 'permanent', 'always', 'allow_always'].includes(token)) return 'allow_permanent'
  if (['allow_all_session', 'allow_all', 'all', 'all_sites', 'unlimited'].includes(token)) return 'allow_all_session'
  if (
    [
      'allow_session',
      'session',
      'allow',
      'allow_once',
      'once',
      'approve',
      'approved',
      'yes',
      'ok',
      'continue',
    ].includes(token)
  )
    return 'allow_session'
  if (['deny', 'denied', 'no', 'reject', 'stop', 'block'].includes(token)) return 'deny'
  return raw && typeof raw === 'object' && raw.approved === true ? 'allow_session' : 'deny'
}

// Pull the hosts a shell command would FETCH content from. Gates explicit http(s)
// URLs (the dominant curl/wget web-research pattern) — robust and false-positive
// free. Bare-domain fetches (curl example.com) auto-upgrade to http inside curl but
// aren't matched here, to avoid mistaking filenames (package.json) for hosts.
function extractCommandFetchHosts(command) {
  const cmd = String(command || '')
  const hosts = new Set()
  const urlRe = /\bhttps?:\/\/([^\s/'"`)<>]+)/gi
  let m
  while ((m = urlRe.exec(cmd)) !== null) {
    const host = extractWebHost(m[1])
    if (host && host !== 'localhost') hosts.add(host)
  }
  return [...hosts]
}

// ── Package-install guard helpers ─────────────────────────────────────────────
// The guard asks the user before each dependency is installed and (for raw pip)
// keeps installs inside a project-local .venv instead of the global/system
// interpreter. `managed: true` managers (uv/poetry/pipenv/conda) handle their own
// environment, so they're never treated as a "global" pip install.
const PACKAGE_INSTALL_MATCHERS = [
  {
    manager: 'pip',
    ecosystem: 'python',
    managed: false,
    re: /(?:^|[\n;&|]\s*)(?:(?:python|python3|py)\s+-m\s+)?pip3?\s+install\b/i,
  },
  {
    manager: 'uv',
    ecosystem: 'python',
    managed: true,
    re: /(?:^|[\n;&|]\s*)uv\s+(?:pip\s+install|add)\b/i,
  },
  {
    manager: 'poetry',
    ecosystem: 'python',
    managed: true,
    re: /(?:^|[\n;&|]\s*)poetry\s+add\b/i,
  },
  {
    manager: 'pipenv',
    ecosystem: 'python',
    managed: true,
    re: /(?:^|[\n;&|]\s*)pipenv\s+install\b/i,
  },
  {
    manager: 'conda',
    ecosystem: 'python',
    managed: true,
    re: /(?:^|[\n;&|]\s*)conda\s+install\b/i,
  },
  {
    manager: 'mamba',
    ecosystem: 'python',
    managed: true,
    re: /(?:^|[\n;&|]\s*)mamba\s+install\b/i,
  },
  {
    manager: 'npm',
    ecosystem: 'node',
    managed: false,
    re: /(?:^|[\n;&|]\s*)npm\s+(?:install|i|add)\b/i,
  },
  {
    manager: 'pnpm',
    ecosystem: 'node',
    managed: false,
    re: /(?:^|[\n;&|]\s*)pnpm\s+(?:install|i|add)\b/i,
  },
  {
    manager: 'yarn',
    ecosystem: 'node',
    managed: false,
    re: /(?:^|[\n;&|]\s*)yarn\s+add\b/i,
  },
  {
    manager: 'bun',
    ecosystem: 'node',
    managed: false,
    re: /(?:^|[\n;&|]\s*)bun\s+add\b/i,
  },
  {
    manager: 'cargo',
    ecosystem: 'rust',
    managed: false,
    re: /(?:^|[\n;&|]\s*)cargo\s+(?:add|install)\b/i,
  },
  {
    manager: 'gem',
    ecosystem: 'ruby',
    managed: false,
    re: /(?:^|[\n;&|]\s*)gem\s+install\b/i,
  },
  {
    manager: 'go',
    ecosystem: 'go',
    managed: false,
    re: /(?:^|[\n;&|]\s*)go\s+(?:get|install)\b/i,
  },
]

// A pip install is treated as "in a venv" when the command points at, activates,
// or targets a local virtual-env path (so it isn't flagged as a global install).
const VENV_SIGNAL_PATTERN = /(?:^|[\s/=])\.?(?:venv|env|virtualenv)[\\/]+(?:bin|scripts)[\\/]/i
const VENV_ACTIVATE_PATTERN = /\b(?:source|\.)\s+\S*(?:venv|env)\S*[\\/]+(?:bin|scripts)[\\/]+activate\b/i
const PIP_LOCAL_TARGET_PATTERN = /(?:--target|--prefix|-t)[=\s]/i

// files.write green/red diff (Workstream D, QoL): cap the attached diff text and skip the
// pre-write diff entirely for very large writes so the timeline stays light.
const FILE_WRITE_DIFF_CHARS = 6000
const FILE_WRITE_DIFF_MAX_CONTENT = 200000

// Strip version specifiers / extras to a canonical package key (keeps npm scopes).
function normalizePackageName(token) {
  let t = String(token || '').trim()
  if (!t) return ''
  if (t.startsWith('@')) {
    const at = t.indexOf('@', 1)
    return (at > 0 ? t.slice(0, at) : t).toLowerCase()
  }
  t = t.split(/[<>=!~@[]/)[0]
  return t.trim().toLowerCase()
}

// Evaluates whether is package permanently allowed for the supplied value and current runtime
// state.
function isPackagePermanentlyAllowed(name, settings) {
  const list = Array.isArray(settings?.agent_package_allowed) ? settings.agent_package_allowed : []
  const norm = normalizePackageName(name)
  return Boolean(norm) && list.some((p) => normalizePackageName(p) === norm)
}

// Inspect a shell command for a dependency install. Returns null when it isn't one,
// else { manager, ecosystem, packages, installsFromManifest, isGlobalPython }.
function detectPackageInstall(command) {
  const text = String(command || '')
  if (!text.trim()) return null
  const matcher = PACKAGE_INSTALL_MATCHERS.find((entry) => entry.re.test(text))
  if (!matcher) return null

  const verbMatch = matcher.re.exec(text)
  // Everything after the matched "<manager> <verb>", up to the next shell operator.
  let segment = text.slice(verbMatch.index + verbMatch[0].length)
  segment = segment.split(/[\n;&|]/)[0]
  const tokens = segment.split(/\s+/).filter(Boolean)

  const packages = []
  let installsFromManifest = false
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.startsWith('-')) {
      if (/^(-r|--requirement|-e|--editable|-c|--constraint|-f|--find-links)$/i.test(tok)) {
        installsFromManifest = true
        i += 1 // skip its path argument
      }
      continue
    }
    const looksLikePath =
      /^(\.\.?(\/|$)|\/|~\/)/.test(tok) ||
      tok.startsWith('git+') ||
      /^https?:\/\//i.test(tok) ||
      /\.(whl|tar\.gz|tgz)$/i.test(tok)
    if (looksLikePath) {
      installsFromManifest = true
      continue
    }
    packages.push(tok)
  }
  // `npm install` / `pnpm i` with no names installs from package.json (the manifest).
  if (packages.length === 0) installsFromManifest = true

  const usesVenv =
    VENV_SIGNAL_PATTERN.test(text) ||
    VENV_ACTIVATE_PATTERN.test(text) ||
    PIP_LOCAL_TARGET_PATTERN.test(text) ||
    /\bVIRTUAL_ENV\s*=/.test(text)
  const isGlobalPython = matcher.ecosystem === 'python' && !matcher.managed && !usesVenv

  return {
    manager: matcher.manager,
    ecosystem: matcher.ecosystem,
    packages,
    installsFromManifest,
    isGlobalPython,
  }
}

// Map an approval response → one of the package-guard decisions.
function normalizePackageDecision(raw) {
  const token = String(
    raw && typeof raw === 'object'
      ? raw.decision || raw.choice || raw.selection || raw.action || (raw.approved ? 'approve' : 'deny')
      : raw,
  )
    .trim()
    .toLowerCase()
  if (['approve_permanent', 'permanent', 'always', 'allow_always'].includes(token)) return 'approve_permanent'
  if (['approve_all', 'allow_all', 'all', 'all_packages', 'unlimited'].includes(token)) return 'approve_all'
  if (['use_venv', 'venv'].includes(token)) return 'use_venv'
  if (['install_global', 'global', 'globally'].includes(token)) return 'install_global'
  if (['approve', 'allow', 'allow_once', 'once', 'yes', 'ok', 'continue', 'install'].includes(token)) return 'approve'
  if (['deny', 'denied', 'no', 'reject', 'stop', 'block'].includes(token)) return 'deny'
  return raw && typeof raw === 'object' && raw.approved === true ? 'approve' : 'deny'
}

/**
 * Creates the approval guards used by one tool execution. The guards retain the session's
 * permission state and persistence behavior while keeping policy prompts separate from dispatch.
 */
export function createToolApprovalGuards({
  settings,
  approvalState,
  traceTool,
  onApprovalRequest,
  toolName,
  safeArgs,
}) {
  // Requests and records the user approval required for the current risky tool action.
  const requestSessionApproval = async ({
    requestedTool,
    requestedAction,
    reason,
    grantGeneralApproval = false,
    grantElevated = false,
    grantNetwork = false,
    grantShellPassthrough = false,
    grantPermissionKey = null,
  }) => {
    if (!onApprovalRequest) return false

    const permissionKeys = Array.from(
      new Set(
        [grantPermissionKey, grantElevated ? 'sudo' : null, grantNetwork ? 'network_commands' : null].filter(Boolean),
      ),
    )
    const persistentPermission = permissionKeys.length > 0
    const approvalResponse = await onApprovalRequest({
      modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
      requestType: 'permission',
      requestedTool: String(requestedTool || toolName),
      requestedAction: String(requestedAction || `use ${requestedTool || toolName}`),
      reason: String(reason || `Approval required for ${requestedTool || toolName}.`),
      stepAction: safeArgs,
      permissionKeys,
      persistentPermission,
      options: [
        {
          id: 'approve',
          label: persistentPermission ? 'Allow' : 'Approve',
          description: persistentPermission
            ? 'Allow this capability and save it in Settings.'
            : 'Grant approval for this session run.',
          recommended: true,
        },
        {
          id: 'deny',
          label: 'Deny',
          description: 'Reject this request.',
          recommended: false,
        },
      ],
      recommendedDecision: 'approve',
    })

    const approvalDecision = normalizeApprovalResponse(approvalResponse)
    const approved = approvalDecision.approved

    if (!approved) {
      traceTool.thinking(`User denied approval for ${requestedTool || toolName}.`)
      return false
    }

    if (grantGeneralApproval) approvalState.granted = true
    if (grantElevated) approvalState.allowElevatedCommands = true
    if (grantNetwork) approvalState.allowNetworkCommands = true
    if (grantShellPassthrough) approvalState.allowShellPassthrough = true
    if (grantPermissionKey) {
      approvalState.sessionPermissionOverrides = {
        ...(approvalState.sessionPermissionOverrides || {}),
        [grantPermissionKey]: true,
      }
    }

    traceTool.thinking(
      persistentPermission
        ? `User allowed ${requestedTool || toolName}; the permission was saved in Settings.`
        : `User approved ${requestedTool || toolName} for this session.`,
    )
    return true
  }

  // ── Web access guard: ask before ingesting a site's content ──────────────
  // Returns true if the host is (now) approved, false if denied. Scopes:
  // this site for the session / this site permanently / all sites this session.
  const requestSiteApproval = async (host, { action, reason } = {}) => {
    if (isWebSiteAllowed(host, settings, approvalState)) return true
    if (!onApprovalRequest) return false // guard on, unknown site, no UI → fail closed

    const response = await onApprovalRequest({
      modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
      requestType: 'web_site_access',
      requestedTool: 'web',
      requestedAction: action || `read content from ${host}`,
      reason: reason || `The agent wants to read content from ${host}.`,
      domain: host,
      options: [
        {
          id: 'allow_session',
          label: `Allow ${host} (this session)`,
          description: `Read from ${host} for the rest of this run.`,
          recommended: true,
        },
        {
          id: 'allow_permanent',
          label: `Always allow ${host}`,
          description: `Add ${host} to the permanent allowlist (survives restarts).`,
          recommended: false,
        },
        {
          id: 'allow_all_session',
          label: 'Allow all sites (this session)',
          description: 'Stop asking for any site for the rest of this run.',
          recommended: false,
        },
        {
          id: 'deny',
          label: 'Deny',
          description: `Block ${host} for now.`,
          recommended: false,
        },
      ],
      recommendedDecision: 'allow_session',
    })

    const decision = normalizeSiteDecision(response)
    if (decision === 'allow_all_session') {
      approvalState.allowAllSitesForSession = true
      traceTool.thinking('User approved web access to all sites for this session.')
      return true
    }
    if (decision === 'allow_permanent') {
      approvalState.webSiteSessionDomains.add(host)
      try {
        const current = readOrbSettings()
        const list = Array.isArray(current.agent_web_allowed_domains) ? current.agent_web_allowed_domains.slice() : []
        if (!list.includes(host)) list.push(host)
        writeOrbSettings({ ...current, agent_web_allowed_domains: list })
        settings.agent_web_allowed_domains = list // reflect into the live snapshot
      } catch {
        /* non-fatal — session approval below still applies */
      }
      traceTool.thinking(`User permanently approved web access to ${host}.`)
      return true
    }
    if (decision === 'allow_session') {
      approvalState.webSiteSessionDomains.add(host)
      traceTool.thinking(`User approved web access to ${host} for this session.`)
      return true
    }
    traceTool.thinking(`User denied web access to ${host}.`)
    return false
  }

  // ── Package-install guard: confirm each dependency before it's installed ──
  // Returns true if cleared (now or earlier this run / permanent allowlist),
  // false if denied. Scopes: this package (run) / always allow it / approve
  // all for the run / deny.
  const requestPackageApproval = async (pkgToken, { manager }) => {
    if (settings?.agent_package_install_guard === false) return true
    if (approvalState.allowAllPackagesForSession) return true
    const norm = normalizePackageName(pkgToken)
    if (isPackagePermanentlyAllowed(norm, settings)) return true
    if (approvalState.packageApprovedSession instanceof Set && approvalState.packageApprovedSession.has(norm))
      return true
    if (approvalState.packageDeniedSession instanceof Set && approvalState.packageDeniedSession.has(norm)) return false
    if (!onApprovalRequest) return false // guard on, unknown package, no UI → fail closed

    const response = await onApprovalRequest({
      modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
      requestType: 'package_install',
      requestedTool: manager,
      requestedAction: `install ${pkgToken} (${manager})`,
      reason: `The agent wants to install the package "${pkgToken}" via ${manager}.`,
      packageName: pkgToken,
      options: [
        {
          id: 'approve',
          label: `Install ${pkgToken}`,
          description: `Install ${pkgToken} via ${manager} for this run.`,
          recommended: true,
        },
        {
          id: 'approve_permanent',
          label: `Always allow ${norm}`,
          description: `Add ${norm} to the permanent package allowlist (survives restarts).`,
          recommended: false,
        },
        {
          id: 'approve_all',
          label: 'Approve all packages (this run)',
          description: 'Stop asking about packages for the rest of this run.',
          recommended: false,
        },
        {
          id: 'deny',
          label: `Deny ${pkgToken}`,
          description: `Do not install ${pkgToken}.`,
          recommended: false,
        },
      ],
      recommendedDecision: 'approve',
    })

    const decision = normalizePackageDecision(response)
    if (decision === 'approve_all') {
      approvalState.allowAllPackagesForSession = true
      traceTool.thinking('User approved all package installs for this run.')
      return true
    }
    if (decision === 'approve_permanent') {
      approvalState.packageApprovedSession.add(norm)
      try {
        const current = readOrbSettings()
        const list = Array.isArray(current.agent_package_allowed) ? current.agent_package_allowed.slice() : []
        if (!list.includes(norm)) list.push(norm)
        writeOrbSettings({ ...current, agent_package_allowed: list })
        settings.agent_package_allowed = list // reflect into the live snapshot
      } catch {
        /* non-fatal — session approval below still applies */
      }
      traceTool.thinking(`User permanently approved package ${norm}.`)
      return true
    }
    if (decision === 'approve') {
      approvalState.packageApprovedSession.add(norm)
      traceTool.thinking(`User approved package ${pkgToken} for this run.`)
      return true
    }
    approvalState.packageDeniedSession.add(norm)
    traceTool.thinking(`User denied package ${pkgToken}.`)
    return false
  }

  // Ask before a raw pip install hits the global/system interpreter; the
  // recommended path is a project-local .venv. Returns true to proceed (the
  // user chose "install globally anyway"), false to block (use .venv / deny).
  const requestGlobalPipApproval = async ({ manager, packages }) => {
    if (approvalState.allowGlobalPythonInstall) return true
    if (!onApprovalRequest) return false // fail closed → caller tells the agent to use .venv
    const pkgList = packages.length ? packages.join(', ') : 'dependencies'
    const response = await onApprovalRequest({
      modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
      requestType: 'package_install_global',
      requestedTool: manager,
      requestedAction: `install ${pkgList} into the GLOBAL Python environment`,
      reason: `This ${manager} install isn't scoped to a project-local .venv, so it would modify the global/system Python. Installing into a .venv is recommended.`,
      options: [
        {
          id: 'use_venv',
          label: 'Use a .venv (recommended)',
          description: 'Block this global install; the agent should create/use a project .venv instead.',
          recommended: true,
        },
        {
          id: 'install_global',
          label: 'Install globally anyway',
          description: 'Allow installing into the global Python for the rest of this run.',
          recommended: false,
        },
        {
          id: 'deny',
          label: 'Deny',
          description: 'Do not install anything.',
          recommended: false,
        },
      ],
      recommendedDecision: 'use_venv',
    })
    const decision = normalizePackageDecision(response)
    if (decision === 'install_global') {
      approvalState.allowGlobalPythonInstall = true
      traceTool.thinking('User allowed global Python installs for this run.')
      return true
    }
    traceTool.thinking(
      `User chose not to install ${pkgList} globally (${decision === 'deny' ? 'denied' : 'use .venv'}).`,
    )
    return false
  }

  return {
    requestSessionApproval,
    requestSiteApproval,
    requestPackageApproval,
    requestGlobalPipApproval,
  }
}

/**
 * Builds the tool execution surface for a single agent session. The returned broker
 * connects canonical tool calls to bridge services, local stores, approvals, delegation,
 * and UI callbacks while applying the policies and trace behavior shared by every tool.
 */

export function createModuleBroker({
  settings,
  todoTool,
  traceTool,
  safetyConfig,
  approvalState,
  webSearchState,
  userInput,
  requestAI,
  requestCloudConsult = null,
  onApprovalRequest,
  stepHistory,
  skillState = null,
  onArtifact = null,
  meshConductor = null,
  // The session's run-state ({ current }). Defaults to a self-contained object so the delegate /
  // consult / overwatch / review handlers — which set agentState.current to pause the loop — never
  // throw "agentState is not defined" when the broker is constructed without it (the bug that broke
  // peer help AND teamwork delegation). The session passes the real one so the loop actually pauses.
  agentState = { current: AGENT_STATES.RUNNING },
}) {
  // Mesh conductor (Workstream D) — owns the peer-consult budget/depth/cycle ledger for
  // this run. Falls back to a fresh disabled conductor so the broker is safe to construct
  // without one (every consult gate then fails closed).
  const mesh = meshConductor || createMeshConductor(settings, 'orchestrator')
  // Returns capabilities used by the agent session runtime.
  const getCapabilities = () =>
    buildCapabilitySnapshot({
      settings,
      safetyConfig,
      userApprovalGranted: Boolean(approvalState?.granted),
      sessionPermissionOverrides: approvalState?.sessionPermissionOverrides,
    })

  return {
    // Executes execute after the required policy checks have passed.
    async execute(toolName, args = {}) {
      assertAllowedTool(toolName)
      const safeArgs = args && typeof args === 'object' ? args : {}
      // Current step for trace metadata. The broker isn't passed a step directly; the runtime
      // tracks it on approvalState.currentStep. Defined once here so every `{ step }` trace tag
      // in this method resolves (previously these threw "step is not defined" when reached —
      // e.g. consulting a peer or delegating).
      const step = Number.isFinite(Number(approvalState?.currentStep)) ? Number(approvalState.currentStep) : undefined

      const { requestSessionApproval, requestSiteApproval, requestPackageApproval, requestGlobalPipApproval } =
        createToolApprovalGuards({
          settings,
          approvalState,
          traceTool,
          onApprovalRequest,
          toolName,
          safeArgs,
        })

      const access = evaluateToolAccess(toolName, {
        settings,
        safetyConfig,
        userApprovalGranted: Boolean(approvalState?.granted),
        sessionPermissionOverrides: approvalState?.sessionPermissionOverrides,
      })
      if (!access.available) {
        const accessReasonLower = String(access.reason || '').toLowerCase()
        const explicitApprovalBlocked =
          access.code === 'explicit_approval_required' || accessReasonLower.includes('explicit approval is required')
        const permissionBlocked =
          access.code === 'permission_required' || accessReasonLower.includes('permission is disabled')
        if (explicitApprovalBlocked && onApprovalRequest && !approvalState.granted) {
          const requestedAction =
            String(
              safeArgs.action ||
                safeArgs.command ||
                (toolName === 'terminal.exec'
                  ? `run command ${String(safeArgs.command || '').trim()}`
                  : `use ${toolName}`),
            ).trim() || `use ${toolName}`

          const approved = await requestSessionApproval({
            requestedTool: toolName,
            requestedAction,
            reason: access.reason || `Explicit approval required for ${toolName}.`,
            grantGeneralApproval: true,
          })

          if (approved) {
            const recheck = evaluateToolAccess(toolName, {
              settings,
              safetyConfig,
              userApprovalGranted: Boolean(approvalState?.granted),
              sessionPermissionOverrides: approvalState?.sessionPermissionOverrides,
            })

            if (recheck.available) {
              // Continue execution with refreshed approval state.
            } else {
              throw new Error(recheck.reason || `Tool is not available in this runtime: ${toolName}`)
            }
          } else {
            throw new Error(`Approval denied for ${toolName}.`)
          }
        } else if (permissionBlocked && onApprovalRequest) {
          const permissionKey = getToolPermissionKey(toolName)
          const requestedAction =
            String(safeArgs.action || safeArgs.command || `use ${toolName}`).trim() || `use ${toolName}`

          const approved = await requestSessionApproval({
            requestedTool: toolName,
            requestedAction,
            reason: access.reason || `Permission is required for ${toolName}.`,
            grantPermissionKey: permissionKey,
          })

          if (approved) {
            let recheck = evaluateToolAccess(toolName, {
              settings,
              safetyConfig,
              userApprovalGranted: Boolean(approvalState?.granted),
              sessionPermissionOverrides: approvalState?.sessionPermissionOverrides,
            })

            // Capability consent and exact risky-action approval are deliberately separate.
            // When both are required, save the broad permission first, then ask for the
            // current risky action instead of treating one approval as blanket consent.
            if (recheck.code === 'explicit_approval_required' && onApprovalRequest && !approvalState.granted) {
              const riskyApproved = await requestSessionApproval({
                requestedTool: toolName,
                requestedAction,
                reason: recheck.reason || `Explicit approval required for ${toolName}.`,
                grantGeneralApproval: true,
              })
              if (!riskyApproved) throw new Error(`Approval denied for ${toolName}.`)

              recheck = evaluateToolAccess(toolName, {
                settings,
                safetyConfig,
                userApprovalGranted: Boolean(approvalState?.granted),
                sessionPermissionOverrides: approvalState?.sessionPermissionOverrides,
              })
            }

            if (!recheck.available) {
              throw new Error(recheck.reason || `Tool is not available in this runtime: ${toolName}`)
            }
          } else {
            throw new Error(`Approval denied for ${toolName}.`)
          }
        } else {
          throw new Error(access.reason || `Tool is not available in this runtime: ${toolName}`)
        }
      }

      if (toolName === 'todo.update') {
        const updates = Array.isArray(safeArgs.updates) ? safeArgs.updates : []
        const todos = todoTool.applyUpdates(updates)
        return { updated: true, count: todos.length, todos }
      }

      if (toolName === 'trace.log') {
        const summary = String(safeArgs.summary || '').trim()
        if (summary) traceTool.thinking(summary)
        return { logged: Boolean(summary) }
      }

      if (toolName === 'resources.list') {
        return {
          ...getCapabilities(),
          generatedAt: Date.now(),
        }
      }

      if (toolName === 'system.stats') {
        const stats = await systemStats()
        if (!stats) return { error: 'System stats unavailable (no desktop bridge).' }
        return stats
      }

      if (toolName === 'system.processes') {
        const processes = await systemProcesses(safeArgs.limit)
        return { count: processes.length, processes }
      }

      if (toolName === 'skills.list') {
        const profile = String(safeArgs.profile || resolveActiveSkillProfile(settings) || '').trim()
        const result = await listSkillDefinitions(profile || resolveActiveSkillProfile(settings))
        return {
          profile: result?.profile || profile,
          total: Array.isArray(result?.skills) ? result.skills.length : 0,
          skills: Array.isArray(result?.skills) ? result.skills : [],
        }
      }

      // skills.upsert removed (W3): the agent can no longer create/edit its own
      // skills. Skills are authored by the user via the /skills editor panel.

      if (toolName === 'skills.offload') {
        const rawIds = Array.isArray(safeArgs.ids)
          ? safeArgs.ids
          : safeArgs.id
            ? [safeArgs.id]
            : typeof safeArgs.ids === 'string'
              ? [safeArgs.ids]
              : []
        const requested = rawIds.map((id) => String(id || '').trim()).filter(Boolean)
        if (!skillState || !(skillState.offloadedIds instanceof Set)) {
          return {
            offloaded: [],
            note: 'No active skill context to offload from.',
          }
        }
        const offloaded = []
        for (const id of requested) {
          skillState.offloadedIds.add(id)
          offloaded.push(id)
        }
        // Prune immediately so the freed budget is visible this step.
        if (Array.isArray(skillState.context?.active)) {
          skillState.context.active = skillState.context.active.filter(
            (s) => !skillState.offloadedIds.has(String(s.id)),
          )
        }
        if (offloaded.length) {
          traceTool.thinking(
            `Offloaded ${offloaded.length} skill(s): ${offloaded.join(', ')}${safeArgs.reason ? ` — ${String(safeArgs.reason).slice(0, 160)}` : ''}.`,
          )
        }
        return {
          offloaded,
          remainingActive: Array.isArray(skillState.context?.active)
            ? skillState.context.active.map((s) => String(s.id))
            : [],
        }
      }

      if (toolName === 'skills.load') {
        const rawIds = Array.isArray(safeArgs.ids)
          ? safeArgs.ids
          : safeArgs.id
            ? [safeArgs.id]
            : typeof safeArgs.ids === 'string'
              ? [safeArgs.ids]
              : []
        const requested = rawIds.map((id) => String(id || '').trim()).filter(Boolean)
        if (!skillState || !skillState.context) {
          return { loaded: [], note: 'No active skill context to load into.' }
        }
        const pool = skillState.context.loadablePool || {}
        if (!Array.isArray(skillState.context.active)) skillState.context.active = []
        const loaded = []
        for (const id of requested) {
          if (skillState.context.active.find((s) => String(s.id) === id)) continue
          const entry = pool[id]
          if (!entry) continue
          const tokenCost = estimateTokens(
            [entry.title, entry.summary, entry.instructions, ...(entry.examples || [])].join('\n'),
          )
          skillState.context.active.push({ ...entry, tokenCost })
          loaded.push(id)
          if (skillState.offloadedIds instanceof Set) skillState.offloadedIds.delete(id)
        }
        if (skillState.context.active.length > MAX_SKILL_CARD_COUNT) {
          skillState.context.active = skillState.context.active.slice(-MAX_SKILL_CARD_COUNT)
        }
        if (loaded.length) {
          traceTool.thinking(
            `Loaded ${loaded.length} skill(s) into context: ${loaded.join(', ')}${safeArgs.reason ? ` — ${String(safeArgs.reason).slice(0, 160)}` : ''}.`,
          )
        }
        const loadedBodies = loaded.map((id) => {
          const entry = pool[id] || {}
          const examples = Array.isArray(entry.examples) ? entry.examples.slice(0, 6) : []
          return `## Skill: ${entry.title || id} (${id})\n${String(entry.instructions || '').trim()}${examples.length ? `\n\nExamples:\n${examples.map((ex) => `- ${ex}`).join('\n')}` : ''}`
        })
        return {
          loaded,
          unavailable: requested.filter((id) => !loaded.includes(id) && !pool[id]),
          activeSkills: skillState.context.active.map((s) => String(s.id)),
          instructions: loadedBodies.join('\n\n') || '(nothing new loaded — already active or id not found)',
        }
      }

      if (toolName === 'approval.request') {
        const requestedTool = String(safeArgs.tool || safeArgs.targetTool || '').trim()
        const requestedAction = String(
          safeArgs.action || safeArgs.command || requestedTool || 'perform a risky action',
        ).trim()
        const reason = String(safeArgs.reason || safeArgs.description || 'Risky action requires confirmation.').trim()

        const approvalDecision = onApprovalRequest
          ? normalizeApprovalResponse(
              await onApprovalRequest({
                modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
                requestType: 'permission',
                requestedTool,
                requestedAction,
                reason,
                stepAction: safeArgs,
                options: [
                  {
                    id: 'approve',
                    label: 'Approve',
                    description: 'Grant approval for this session run.',
                    recommended: true,
                  },
                  {
                    id: 'deny',
                    label: 'Deny',
                    description: 'Reject this request.',
                    recommended: false,
                  },
                ],
                recommendedDecision: 'approve',
              }),
            )
          : { approved: false, decision: 'deny' }

        const approved = approvalDecision.approved

        if (approved) {
          approvalState.granted = true
          approvalState.allowElevatedCommands = true
          traceTool.thinking('User approved risky action for this session.')
        } else {
          traceTool.thinking('User denied risky action approval request.')
        }

        return {
          approved: Boolean(approved),
          decision: approvalDecision.decision,
          grantedForSession: Boolean(approvalState.granted),
          allowElevatedCommands: Boolean(approvalState.allowElevatedCommands),
          requestedTool,
          requestedAction,
          reason,
        }
      }

      if (toolName === 'user.ask') {
        const question = String(safeArgs.question || safeArgs.prompt || safeArgs.text || '').trim()
        let rawOptions = safeArgs.options ?? safeArgs.choices
        if (typeof rawOptions === 'string') {
          try {
            rawOptions = JSON.parse(rawOptions)
          } catch {
            rawOptions = rawOptions.split('\n')
          }
        }
        const options = (Array.isArray(rawOptions) ? rawOptions : [])
          .map((option) => (typeof option === 'string' ? option : String(option?.label ?? option?.value ?? '')))
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 6)

        if (!question)
          return {
            error: 'user.ask needs a question (and ideally 2–5 options).',
          }
        if (!onApprovalRequest) {
          return {
            answer: '',
            note: 'No UI is available to ask the user; proceed with your best judgment and state the assumption.',
          }
        }

        const response = await onApprovalRequest({
          modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
          requestType: 'question',
          question,
          requestedAction: 'ask you a question',
          options: options.map((label, index) => ({
            id: `opt${index}`,
            label,
            value: label,
          })),
          allowOther: true,
        })
        const answer = String(response?.answer ?? '').trim()
        if (response?.stopped)
          return {
            question,
            answer: '',
            note: 'The user stopped the run before answering.',
          }
        traceTool.thinking(
          `Asked the user: "${question.slice(0, 90)}" → ${answer ? `"${answer.slice(0, 90)}"` : '(no answer / timed out)'}`,
        )
        return {
          question,
          answer: answer || '(the user did not answer — proceed with your best judgment and note the assumption)',
        }
      }

      if (toolName === 'files.list') {
        const pathInput = String(safeArgs.path || '~').trim() || '~'
        const path = assertSafePath(pathInput, { operation: 'read', settings })
        const depth = Number.isFinite(Number(safeArgs.depth)) ? Number(safeArgs.depth) : 3

        const normalizedDepth = Math.max(1, Math.min(6, Math.round(depth)))
        let result
        let attemptedPaths = [path]
        let pathResolution = 'direct'

        try {
          result = await listDirectory(path, normalizedDepth)
        } catch (error) {
          if (!isMissingPathError(error)) {
            throw error
          }

          const fallbackPaths = buildFindFallbackPaths(pathInput, {
            includeGlobalFallback: shouldUseGlobalPathFallback({
              pathInput,
              query: '',
              userInput,
              todos: todoTool.list(),
            }),
          })
            .map((candidate) => assertSafePath(candidate, { operation: 'read', settings }))
            .filter((candidate) => candidate !== path)

          let recovered = false
          for (const fallbackPath of fallbackPaths) {
            attemptedPaths = dedupeStrings([...attemptedPaths, fallbackPath])
            try {
              result = await listDirectory(fallbackPath, normalizedDepth)
              pathResolution = 'fallback-path'
              recovered = true
              break
            } catch {
              // keep trying fallbacks
            }
          }

          if (!recovered || !result) {
            throw error
          }
        }

        return {
          path: result.rootPath,
          requestedPath: pathInput,
          pathResolution,
          attemptedPaths,
          summary: runtimeSupport.summarizeTree(result.tree),
        }
      }

      if (toolName === 'files.find') {
        const pathInput = String(safeArgs.path || '.').trim()
        const path = assertSafePath(pathInput, { operation: 'read', settings })
        let query = String(safeArgs.query || safeArgs.pattern || '').trim()
        if (!query) {
          query = inferFindQuery({
            args: safeArgs,
            userInput,
            todos: todoTool.list(),
          })
          if (query) {
            traceTool.thinking(`Inferred files.find query "${query}" from request context.`)
          }
        }
        if (!query) {
          throw new Error('Query is required for files.find.')
        }

        const mode = ['name', 'content', 'auto'].includes(
          String(safeArgs.mode || safeArgs.searchIn || 'auto').toLowerCase(),
        )
          ? String(safeArgs.mode || safeArgs.searchIn || 'auto').toLowerCase()
          : 'auto'

        const depth = Number.isFinite(Number(safeArgs.depth)) ? Number(safeArgs.depth) : 5
        const maxResults = Number.isFinite(Number(safeArgs.maxResults)) ? Number(safeArgs.maxResults) : 24
        const useRegex = safeArgs.useRegex === true || safeArgs.regex === true
        const ignoreCase = safeArgs.ignoreCase !== false
        const fuzzy = safeArgs.fuzzy !== false
        const fuzzyThreshold = Number.isFinite(Number(safeArgs.fuzzyThreshold)) ? Number(safeArgs.fuzzyThreshold) : 0.42

        const normalizedDepth = Math.max(1, Math.min(8, Math.round(depth)))
        const normalizedMaxResults = Math.max(1, Math.min(80, Math.round(maxResults)))
        const normalizedFuzzyThreshold = Math.max(0.12, Math.min(0.9, fuzzyThreshold))

        const result = await findFiles(path, query, {
          mode,
          useRegex,
          ignoreCase,
          depth: normalizedDepth,
          maxResults: normalizedMaxResults,
          fuzzy,
          fuzzyThreshold: normalizedFuzzyThreshold,
        })

        let finalResult = result
        let fallbackApplied = false
        let pathFallbackUsed = false
        let attemptedPaths = dedupeStrings([
          ...(Array.isArray(result?.attemptedPaths) ? result.attemptedPaths : []),
          String(result?.rootPath || path),
        ])

        if (Array.isArray(finalResult?.results) && finalResult.results.length === 0) {
          const fallbackPaths = buildFindFallbackPaths(pathInput)
            .map((candidate) => assertSafePath(candidate, { operation: 'read', settings }))
            .filter((candidate) => candidate !== path)

          const includeGlobalFallback = shouldUseGlobalPathFallback({
            pathInput,
            query,
            userInput,
            todos: todoTool.list(),
          })

          const widenedFallbackPaths = dedupeStrings([
            ...fallbackPaths,
            ...buildFindFallbackPaths(pathInput, { includeGlobalFallback }),
          ])
            .map((candidate) => assertSafePath(candidate, { operation: 'read', settings }))
            .filter((candidate) => candidate !== path)

          for (const fallbackPath of widenedFallbackPaths) {
            const retry = await findFiles(fallbackPath, query, {
              mode,
              useRegex,
              ignoreCase,
              depth: normalizedDepth,
              maxResults: normalizedMaxResults,
              fuzzy,
              fuzzyThreshold: normalizedFuzzyThreshold,
            })

            attemptedPaths = dedupeStrings([
              ...attemptedPaths,
              ...(Array.isArray(retry?.attemptedPaths) ? retry.attemptedPaths : []),
              String(retry?.rootPath || fallbackPath),
            ])

            const retryCount = Array.isArray(retry?.results) ? retry.results.length : 0
            const currentCount = Array.isArray(finalResult?.results) ? finalResult.results.length : 0
            const retryScanned = Number(retry?.scanned || 0)
            const currentScanned = Number(finalResult?.scanned || 0)

            if (retryCount > currentCount || (currentCount === 0 && retryScanned > currentScanned)) {
              finalResult = {
                ...retry,
                query,
              }
              pathFallbackUsed = true
              fallbackApplied = true
            }

            if (retryCount > 0) {
              break
            }
          }
        }

        if (!useRegex && Array.isArray(finalResult?.results) && finalResult.results.length === 0) {
          const tokens = query
            .split(/[^a-zA-Z0-9_]+/g)
            .map((token) => token.trim())
            .filter(Boolean)
            .slice(0, 6)

          if (tokens.length >= 2) {
            const fallbackQuery = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
            const effectivePath = String(finalResult?.rootPath || path)

            const retry = await findFiles(effectivePath, fallbackQuery, {
              mode,
              useRegex: true,
              ignoreCase: true,
              depth: normalizedDepth,
              maxResults: normalizedMaxResults,
              fuzzy,
              fuzzyThreshold: normalizedFuzzyThreshold,
            })

            attemptedPaths = dedupeStrings([
              ...attemptedPaths,
              ...(Array.isArray(retry?.attemptedPaths) ? retry.attemptedPaths : []),
              String(retry?.rootPath || effectivePath),
            ])

            if (Array.isArray(retry?.results) && retry.results.length > 0) {
              finalResult = {
                ...retry,
                query,
                fallbackQuery,
                fallbackFromLiteral: true,
              }
              fallbackApplied = true
            }
          }
        }

        return {
          rootPath: finalResult.rootPath,
          requestedPath: String(finalResult.requestedPath || pathInput || path),
          pathResolution: String(finalResult.pathResolution || ''),
          query: finalResult.query,
          mode: finalResult.mode,
          useRegex: Boolean(finalResult.useRegex),
          ignoreCase: Boolean(finalResult.ignoreCase),
          scanned: Number(finalResult.scanned || 0),
          filesScanned: Number(finalResult.filesScanned || 0),
          truncated: Boolean(finalResult.truncated),
          totalResults: Array.isArray(finalResult.results) ? finalResult.results.length : 0,
          fuzzyEnabled: Boolean(finalResult.fuzzyEnabled),
          fuzzyApplied: Boolean(finalResult.fuzzyApplied),
          fuzzyThreshold: Number.isFinite(Number(finalResult.fuzzyThreshold))
            ? Number(finalResult.fuzzyThreshold)
            : null,
          fuzzyCandidateCount: Number(finalResult.fuzzyCandidateCount || 0),
          fuzzyResultCount: Number(finalResult.fuzzyResultCount || 0),
          fallbackApplied,
          pathFallbackUsed,
          fallbackQuery: String(finalResult.fallbackQuery || ''),
          attemptedPaths,
          results: Array.isArray(finalResult.results) ? finalResult.results.slice(0, 80) : [],
        }
      }

      if (toolName === 'rag.retrieve') {
        const query = String(safeArgs.query || userInput || '').trim()
        if (!query) throw new Error('Query is required for rag.retrieve.')
        const maxFiles = Math.max(1, Math.min(20, Math.round(Number(safeArgs.maxFiles) || 10)))
        const maxPassages = Math.max(1, Math.min(30, Math.round(Number(safeArgs.maxPassages) || 12)))
        const semanticResults = await searchFileSemanticIndex(query, maxFiles * 2, 'text')
        const candidates = semanticResults
          .filter((result) => result?.path && result.semanticType === 'text')
          .slice(0, maxFiles)
        const prepared = []
        const concurrency = 4
        for (let start = 0; start < candidates.length; start += concurrency) {
          const page = candidates.slice(start, start + concurrency)
          const pageResults = await Promise.all(
            page.map(async (candidate) => {
              const path = assertSafePath(String(candidate.path || '').trim(), {
                operation: 'read',
                settings,
              })
              const result = await readTextFile(path, {
                startLine: 1,
                lineCount: 1800,
              })
              if (result.isBinary || !String(result.content || '').trim()) return null
              return {
                path,
                name: String(candidate.name || ''),
                summary: String(candidate.summary || ''),
                semanticScore: Number(candidate.score) || 0,
                content: String(result.content || ''),
              }
            }),
          )
          prepared.push(...pageResults.filter(Boolean))
        }
        const passages = rankRagPassages(query, prepared, maxPassages)
        return {
          query,
          filesConsidered: candidates.length,
          filesRead: prepared.length,
          passages,
          note: 'Passages were read from original filesystem paths and chunked only in memory for this tool call.',
        }
      }

      if (toolName === 'files.read') {
        const path = assertSafePath(String(safeArgs.path || '').trim(), {
          operation: 'read',
          settings,
        })
        const maxChars = Number.isFinite(Number(safeArgs.maxChars)) ? Number(safeArgs.maxChars) : 12000
        const startLine = Number.isFinite(Number(safeArgs.startLine))
          ? Math.max(1, Math.round(Number(safeArgs.startLine)))
          : 1
        const lineCount = Number.isFinite(Number(safeArgs.lineCount))
          ? Math.max(1, Math.min(MAX_AGENT_READ_LINE_COUNT, Math.round(Number(safeArgs.lineCount))))
          : DEFAULT_AGENT_READ_LINE_COUNT
        const showLineNumbers = safeArgs.lineNumbers !== false
        const numberContent = (text, firstLine) => {
          if (!showLineNumbers || !text) return text
          const lines = String(text).split('\n')
          const width = String(firstLine + lines.length - 1).length
          return lines.map((line, i) => `${String(firstLine + i).padStart(width)}\t${line}`).join('\n')
        }

        const readPattern = safeArgs.pattern !== undefined ? String(safeArgs.pattern) : ''
        const tailCount = Number.isFinite(Number(safeArgs.tail)) ? Math.max(1, Math.round(Number(safeArgs.tail))) : 0

        const readOptions = {}
        if (readPattern) {
          readOptions.pattern = readPattern
          if (safeArgs.useRegex === true || safeArgs.patternRegex === true) readOptions.patternRegex = true
          if (safeArgs.ignoreCase === false) readOptions.ignoreCase = false
          if (Number.isFinite(Number(safeArgs.patternContext)))
            readOptions.patternContext = Number(safeArgs.patternContext)
          if (Number.isFinite(Number(safeArgs.maxResults))) readOptions.maxResults = Number(safeArgs.maxResults)
        } else if (tailCount > 0) {
          readOptions.tail = tailCount
        } else {
          readOptions.startLine = startLine
          readOptions.lineCount = lineCount
        }

        const result = await readTextFile(path, readOptions)

        if (result?.mode === 'pattern') {
          const blocks = Array.isArray(result.blocks) ? result.blocks : []
          const lastLine = blocks.length ? blocks[blocks.length - 1].endLine : 0
          const width = String(lastLine || 1).length
          const rendered = blocks
            .map((block) =>
              (Array.isArray(block.lines) ? block.lines : [])
                .map((l) => `${showLineNumbers ? `${String(l.line).padStart(width)}\t` : ''}${l.content}`)
                .join('\n'),
            )
            .join('\n     ⋮\n')
          return {
            path: result.path,
            isBinary: false,
            mode: 'pattern',
            pattern: result.pattern,
            matchCount: Number(result.matchCount || 0),
            truncated: Boolean(result.truncated),
            totalLines: Number(result.totalLines || 0),
            content: rendered || `(no lines match "${result.pattern}")`,
            ...(result.error ? { error: String(result.error) } : {}),
          }
        }

        if (result?.mode === 'tail') {
          const tailText = String(result.content || '')
          return {
            path: result.path,
            isBinary: false,
            mode: 'tail',
            content: numberContent(tailText, Number(result.startLine || 1)),
            startLine: Number(result.startLine || 1),
            endLine: Number(result.endLine || 0),
            lineCount: Number(result.lineCount || 0),
            totalLines: Number(result.totalLines || 0),
            truncated: Boolean(result.truncated),
            hasMore: false,
            nextStartLine: null,
          }
        }

        const content = String(result.content || '')
        const safeMaxChars = Math.max(200, Math.min(maxChars, 24000))
        const previewContent = result.isBinary ? '' : content.slice(0, safeMaxChars)
        const chunkLineCount = Number.isFinite(Number(result.lineCount)) ? Number(result.lineCount) : lineCount
        const chunkStartLine = Number.isFinite(Number(result.startLine)) ? Number(result.startLine) : startLine
        const chunkEndLine = Number.isFinite(Number(result.endLine))
          ? Number(result.endLine)
          : chunkStartLine + Math.max(0, chunkLineCount - 1)
        const serverHasMore = Boolean(result.hasMore || result.truncated)
        const localCharTruncated = !result.isBinary && content.length > safeMaxChars
        const truncated = serverHasMore || localCharTruncated
        const nextStartLine = Number.isFinite(Number(result.nextStartLine))
          ? Number(result.nextStartLine)
          : serverHasMore
            ? chunkEndLine + 1
            : null

        return {
          path: result.path,
          isBinary: Boolean(result.isBinary),
          content: result.isBinary ? '' : numberContent(previewContent, chunkStartLine),
          truncated,
          hasMore: Boolean(truncated && nextStartLine),
          startLine: chunkStartLine,
          endLine: chunkEndLine,
          lineCount: chunkLineCount,
          totalLines: Number.isFinite(Number(result.totalLines)) ? Number(result.totalLines) : null,
          nextStartLine: truncated ? nextStartLine : null,
          continuation:
            truncated && nextStartLine
              ? {
                  path: result.path,
                  startLine: nextStartLine,
                  lineCount,
                }
              : null,
        }
      }

      if (toolName === 'files.write') {
        const path = assertSafePath(String(safeArgs.path || '').trim(), {
          operation: 'write',
          settings,
        })
        const content = String(safeArgs.content || '')
        const append =
          String(safeArgs.mode || '')
            .trim()
            .toLowerCase() === 'append'
        if (content.length > MAX_FILE_WRITE_LENGTH) {
          throw new Error(
            `File content exceeds the ${MAX_FILE_WRITE_LENGTH}-char per-call limit. Split it across multiple files.write calls with mode:"append".`,
          )
        }

        let writeDiff: { diff: string; added: number; removed: number } | null = null
        try {
          if (append) {
            const addedLines = content ? content.split('\n') : []
            writeDiff = {
              diff: addedLines
                .map((l) => `+${l}`)
                .join('\n')
                .slice(0, FILE_WRITE_DIFF_CHARS),
              added: addedLines.length,
              removed: 0,
            }
          } else if (content.length <= FILE_WRITE_DIFF_MAX_CONTENT) {
            const diffRes = (await powerDiff(path, content)) as Record<string, unknown>
            const diffText = String(diffRes?.diff || '')
            if (diffText) {
              let added = 0
              let removed = 0
              for (const line of diffText.split('\n')) {
                if (/^\+(?!\+\+)/.test(line)) added += 1
                else if (/^-(?!--)/.test(line)) removed += 1
              }
              writeDiff = {
                diff: diffText.slice(0, FILE_WRITE_DIFF_CHARS),
                added,
                removed,
              }
            }
          }
        } catch {
          /* diff is best-effort — a write must never fail because the diff couldn't be built */
        }

        const result = await writeTextFile(path, content, { append })
        return {
          path: result.path,
          saved: Boolean(result.saved),
          mode: append ? 'append' : 'create',
          bytesWritten: content.length,
          ...(writeDiff
            ? {
                diff: writeDiff.diff,
                added: writeDiff.added,
                removed: writeDiff.removed,
              }
            : {}),
        }
      }

      if (toolName === 'artifact.create') {
        const rawName = String(safeArgs.filename || safeArgs.name || '')
          .trim()
          .replace(/^.*[\\/]/, '')
        const filename = rawName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || `artifact-${Date.now()}.md`
        const content = String(safeArgs.content || '')
        const summary = String(safeArgs.summary || '')
          .trim()
          .slice(0, 200)
        const append =
          String(safeArgs.mode || '')
            .trim()
            .toLowerCase() === 'append'
        if (!content) return { error: 'artifact.create received empty content.' }
        if (content.length > MAX_FILE_WRITE_LENGTH) {
          throw new Error(
            `Artifact content exceeds the ${MAX_FILE_WRITE_LENGTH}-char per-call limit. Use repeated artifact.create calls with mode:"append".`,
          )
        }

        const saved = await saveArtifact({
          filename,
          content,
          summary,
          type: (filename.split('.').pop() || 'txt').toLowerCase(),
          chatId: settings?.chat_session?.id,
          append,
        })
        const storedPath = saved?.path || filename
        const ext = saved?.type || (filename.split('.').pop() || 'txt').toLowerCase()
        const totalBytes = Number.isFinite(Number(saved?.bytes)) ? Number(saved.bytes) : content.length
        const previewSource = saved?.preview != null ? String(saved.preview) : content
        const artifact = {
          id: saved?.id,
          filename,
          path: storedPath,
          type: ext,
          bytes: totalBytes,
          summary,
          content: previewSource.slice(0, ARTIFACT_PREVIEW_CHARS),
          truncated: totalBytes > ARTIFACT_PREVIEW_CHARS,
          createdAt: saved?.createdAt || Date.now(),
        }
        if (onArtifact) onArtifact(artifact)
        traceTool.thinking(`${append ? 'Appended to' : 'Saved'} artifact ${filename} (${totalBytes} bytes).`)
        return {
          ok: true,
          filename,
          path: storedPath,
          type: ext,
          bytes: totalBytes,
          mode: append ? 'append' : 'create',
          store: 'artifacts',
        }
      }

      if (toolName === 'terminal.exec') {
        const commandInput = String(safeArgs.command || '').trim()
        let command
        try {
          command = assertSafeCommand(commandInput, settings, 'terminal', approvalState)
        } catch (error) {
          const reason = String(error?.message || 'Command blocked by safety settings.')
          const lowerReason = reason.toLowerCase()
          const canRequest =
            Boolean(onApprovalRequest) &&
            (lowerReason.includes('sudo') || lowerReason.includes('network-related commands are blocked'))

          if (canRequest) {
            const approved = await requestSessionApproval({
              requestedTool: 'terminal.exec',
              requestedAction: `run command ${commandInput || '(empty command)'}`,
              reason,
              grantElevated: lowerReason.includes('sudo'),
              grantNetwork: lowerReason.includes('network-related commands are blocked'),
            })

            if (!approved) {
              throw new Error('Approval denied for terminal.exec.')
            }

            command = assertSafeCommand(commandInput, settings, 'terminal', approvalState)
          } else {
            throw error
          }
        }

        const commandHosts = extractCommandFetchHosts(command)
        for (const host of commandHosts) {
          const siteOk = await requestSiteApproval(host, {
            action: `fetch ${host} via terminal`,
            reason: `This terminal command fetches content from ${host} (curl/wget/etc.).`,
          })
          if (!siteOk) {
            return {
              error: `Web access to ${host} was denied by the user — the command was not run. Use an already-approved source, or ask the user to approve this site.`,
              blockedDomain: host,
            }
          }
        }

        if (settings?.agent_package_install_guard !== false) {
          const pkgInfo = detectPackageInstall(command)
          if (pkgInfo) {
            if (pkgInfo.isGlobalPython && settings?.agent_package_require_venv !== false) {
              const globalOk = await requestGlobalPipApproval(pkgInfo)
              if (!globalOk) {
                return {
                  error: `Global ${pkgInfo.manager} install was blocked — install into a project-local .venv instead. Create one and use its interpreter, e.g.: python3 -m venv .venv && .venv/bin/pip install ${pkgInfo.packages.join(' ') || '<package>'}`,
                  blockedPackageInstall: true,
                  manager: pkgInfo.manager,
                }
              }
            }
            const toConfirm = pkgInfo.packages.length
              ? pkgInfo.packages
              : pkgInfo.installsFromManifest
                ? ['(dependencies from manifest)']
                : []
            for (const pkg of toConfirm) {
              const ok = await requestPackageApproval(pkg, {
                manager: pkgInfo.manager,
              })
              if (!ok) {
                return {
                  error: `Install of "${pkg}" was denied by the user — the command was not run. Skip that dependency, or ask the user to approve it.`,
                  deniedPackage: pkg,
                  manager: pkgInfo.manager,
                }
              }
            }
          }
        }

        const cwd = safeArgs.cwd
          ? assertSafePath(String(safeArgs.cwd), { operation: 'cwd', settings })
          : resolveAgentRootBase(settings)
        const result = await executeTerminalCommand(command, cwd)
        return {
          cwd: result.cwd,
          exitCode: result.exitCode,
          stdout: String(result.stdout || '').slice(0, 16000),
          stderr: String(result.stderr || '').slice(0, 8000),
        }
      }

      if (toolName === 'notes.list') {
        const notes = readNotes().slice(0, 100)
        return { notes }
      }

      if (toolName === 'notes.add') {
        const title = String(safeArgs.title || 'New Note').slice(0, 140)
        const content = String(safeArgs.content || '').slice(0, MAX_NOTE_CONTENT_LENGTH)
        const color = safeArgs.color ? String(safeArgs.color) : 'default'
        const note = addNote({ title, content, color })
        return { note }
      }

      if (toolName === 'notes.update') {
        const id = Number(safeArgs.id)
        if (!Number.isFinite(id)) throw new Error('A numeric note id is required.')

        const updates = {}
        if (safeArgs.title !== undefined) updates.title = String(safeArgs.title).slice(0, 140)
        if (safeArgs.content !== undefined) updates.content = String(safeArgs.content).slice(0, MAX_NOTE_CONTENT_LENGTH)
        if (safeArgs.color !== undefined) updates.color = String(safeArgs.color)

        const note = updateNote(id, updates)
        if (!note) throw new Error(`Note ${id} not found.`)
        return { note }
      }

      if (toolName === 'notes.delete') {
        const id = Number(safeArgs.id)
        if (!Number.isFinite(id)) throw new Error('A numeric note id is required.')
        const deleted = deleteNote(id)
        return { id, deleted }
      }

      if (toolName === 'search.web') {
        const query = String(safeArgs.query || '').trim()
        if (!query) throw new Error('Query is required for search.web.')

        const currentRole = (() => {
          try {
            return resolveCurrentRole(settings)
          } catch {
            return 'executor'
          }
        })()
        const roleBudget = WEB_SEARCH_BUDGET_BY_ROLE[currentRole] ?? 3
        const callsUsedSoFar = Number(webSearchState?.callsUsed || 0)
        if (callsUsedSoFar >= roleBudget) {
          return {
            error: `search.web budget reached for role "${currentRole}" (${callsUsedSoFar}/${roleBudget} calls used). Delegate to orchestrator for additional searches or use web.fetch for a direct URL.`,
            callsUsed: callsUsedSoFar,
            budgetExceeded: true,
          }
        }

        const queryKey = normalizeWebSearchQueryKey(query)
        if (!queryKey) throw new Error('search.web query is too short after normalization.')

        const cachedResult = getWebSearchCache(webSearchState, queryKey)
        if (cachedResult) {
          rememberWebSearchQuery(webSearchState, queryKey)
          traceTool.thinking(`Reusing cached web research for "${query}" to avoid duplicate network requests.`, {
            step: Number.isFinite(Number(approvalState?.currentStep)) ? Number(approvalState.currentStep) : undefined,
            chart: {
              kind: 'web-search-cache-hit',
              label: query,
              value: Number(cachedResult?.linesReadTotal || 0),
              max: Math.max(1, Number(cachedResult?.linesReadTotal || 1)),
              status: 'cached',
            },
          })

          return {
            ...cachedResult,
            cached: true,
            callsUsed: Number(webSearchState?.callsUsed || 0),
            callsRemaining: Math.max(0, Number(webSearchState?.maxCalls || 0) - Number(webSearchState?.callsUsed || 0)),
          }
        }

        const callBudget = Number.isFinite(Number(webSearchState?.maxCalls))
          ? Number(webSearchState.maxCalls)
          : SEARCH_WEB_DEFAULT_CALL_BUDGET
        const callsUsed = Number.isFinite(Number(webSearchState?.callsUsed)) ? Number(webSearchState.callsUsed) : 0

        if (callsUsed >= callBudget) {
          throw new Error(
            `search.web budget reached (${callsUsed}/${callBudget}) in this run. Reuse existing web findings instead of new requests.`,
          )
        }

        if (webSearchState) {
          webSearchState.callsUsed = callsUsed + 1
          rememberWebSearchQuery(webSearchState, queryKey)
        }

        const maxResults = Number.isFinite(Number(safeArgs.maxResults))
          ? Math.max(3, Math.min(SEARCH_WEB_MAX_RESULTS, Math.round(Number(safeArgs.maxResults))))
          : SEARCH_WEB_DEFAULT_RESULTS
        const maxSources = Number.isFinite(Number(safeArgs.maxSources))
          ? Math.max(1, Math.min(SEARCH_WEB_MAX_SOURCES, Math.round(Number(safeArgs.maxSources))))
          : SEARCH_WEB_DEFAULT_SOURCES

        const normalizedSafeSearch = ['strict', 'off', 'moderate'].includes(
          String(safeArgs.safeSearch || '').toLowerCase(),
        )
          ? String(safeArgs.safeSearch).toLowerCase()
          : 'moderate'
        const normalizedTimeRange = ['day', 'week', 'month', 'year', 'all'].includes(
          String(safeArgs.timeRange || '').toLowerCase(),
        )
          ? String(safeArgs.timeRange).toLowerCase()
          : 'all'

        const webProviderConfig = buildWebSearchProviderPolicy(settings, approvalState)

        const executeWebSearch = (allowPaidFallbackOverride = null, allowedDomains = null) =>
          searchWebResearch(query, {
            maxResults,
            maxSources,
            safeSearch: normalizedSafeSearch,
            timeRange: normalizedTimeRange,
            includeContent: true,
            allowedDomains: Array.isArray(allowedDomains) ? allowedDomains : undefined,
            allowPaidFallback:
              allowPaidFallbackOverride === null
                ? webProviderConfig.providerPolicy.allowPaidFallback
                : Boolean(allowPaidFallbackOverride),
            providerPolicy: {
              ...webProviderConfig.providerPolicy,
              allowPaidFallback:
                allowPaidFallbackOverride === null
                  ? webProviderConfig.providerPolicy.allowPaidFallback
                  : Boolean(allowPaidFallbackOverride),
            },
            providerSettings: webProviderConfig.providerSettings,
          })

        let allowedDomainsForFetch = null
        if (settings?.agent_web_site_guard !== false && !approvalState.allowAllSitesForSession) {
          let discovered = null
          try {
            discovered = await searchWebResearch(query, {
              maxResults,
              maxSources,
              safeSearch: normalizedSafeSearch,
              timeRange: normalizedTimeRange,
              includeContent: false,
              discoverOnly: true,
              providerPolicy: webProviderConfig.providerPolicy,
              providerSettings: webProviderConfig.providerSettings,
            })
          } catch {
            discovered = null
          }

          const candidates = Array.isArray(discovered?.results) ? discovered.results : []
          const candidateHosts = []
          for (const r of candidates) {
            const host = extractWebHost(r?.url)
            if (host && !candidateHosts.includes(host)) candidateHosts.push(host)
            if (candidateHosts.length >= maxSources) break
          }

          const approvedHosts = []
          for (const host of candidateHosts) {
            if (approvalState.allowAllSitesForSession) break
            const ok = await requestSiteApproval(host, {
              action: `read ${host} (search result for "${query}")`,
              reason: `A top search result for "${query}" is on ${host}. Approve reading its content?`,
            })
            if (ok) approvedHosts.push(host)
          }

          if (approvalState.allowAllSitesForSession) {
            allowedDomainsForFetch = null
          } else if (approvedHosts.length === 0) {
            return {
              query,
              discoverOnly: true,
              note: 'Web access guard: no candidate site was approved, so no page content was read. Below are search-engine titles + links only. Ask the user to approve a site, or fetch an already-approved source.',
              results: candidates.slice(0, maxResults).map((r) => ({
                title: r?.title,
                url: r?.url,
                snippet: r?.snippet,
              })),
              callsUsed: Number(webSearchState?.callsUsed || 0),
            }
          } else {
            allowedDomainsForFetch = approvedHosts
          }
        }

        let webData

        try {
          webData = await executeWebSearch(null, allowedDomainsForFetch)
        } catch (searchError) {
          const searchErrorMessage = String(searchError?.message || '').toLowerCase()
          const paidFallbackBlocked = searchErrorMessage.includes('paid fallback available but blocked by approval')
          const hasPaidFallbackOptions = hasConfiguredPaidFallbackProviders(
            webProviderConfig.providerPolicy.fallbackProviders,
            webProviderConfig.providerSettings,
          )

          if (
            paidFallbackBlocked &&
            hasPaidFallbackOptions &&
            webProviderConfig.requirePaidFallbackConfirmation &&
            onApprovalRequest
          ) {
            const approvalResponse = await onApprovalRequest({
              modelId: String(settings?.ai_model || settings?.ai_provider || 'model'),
              requestType: 'paid_fallback',
              requestedTool: 'search.web',
              requestedAction: 'use paid web-search providers as fallback',
              reason: searchError?.message || 'Free or non-paid providers were exhausted for this query.',
              stepAction: {
                tool: 'search.web',
                query,
                providers: webProviderConfig.providerPolicy.fallbackProviders,
              },
              options: [
                {
                  id: 'continue',
                  label: 'Allow once',
                  description: 'Use paid fallback for this web search retry only.',
                  recommended: true,
                },
                {
                  id: 'unlimited',
                  label: 'Allow for session',
                  description: 'Allow paid web fallback for the rest of this run.',
                  recommended: false,
                },
                {
                  id: 'deny',
                  label: 'Deny',
                  description: 'Keep paid fallback disabled.',
                  recommended: false,
                },
              ],
              recommendedDecision: 'continue',
            })

            const approvalDecision = normalizeApprovalResponse(approvalResponse)
            if (!approvalDecision.approved) {
              throw new Error('Paid provider fallback was denied by user approval.')
            }

            if (approvalDecision.decision === 'unlimited') {
              approvalState.allowPaidSearchFallback = true
            }

            webData = await executeWebSearch(true, allowedDomainsForFetch)
          } else {
            throw searchError
          }
        }

        const sources = Array.isArray(webData?.sources) ? webData.sources.slice(0, maxSources) : []

        const stepHint = Number.isFinite(Number(approvalState?.currentStep))
          ? Number(approvalState.currentStep)
          : undefined
        const maxLinesRead = Math.max(1, ...sources.map((source) => Number(source?.linesRead || 0)))

        sources.forEach((source, index) => {
          const title = String(source?.title || source?.url || `Source ${index + 1}`).slice(0, 180)
          const linesRead = Number(source?.linesRead || 0)
          const charsRead = Number(source?.charsRead || 0)
          const status = String(source?.status || '').trim() || 'ok'
          const relevanceScore = Number(source?.relevanceScore || 0)

          traceTool.thinking(
            `Web source ${index + 1}/${sources.length}: ${title} (${linesRead} lines read, relevance ${relevanceScore.toFixed(2)}).`,
            {
              step: stepHint,
              chart: {
                kind: 'web-source-lines',
                label: title,
                value: linesRead,
                max: maxLinesRead,
                linesRead,
                charsRead,
                status,
                url: String(source?.url || ''),
                index: index + 1,
                total: sources.length,
              },
            },
          )
        })

        const synthesized = await synthesizeWebResearch(query, webData, settings, maxSources, {
          onSynthesisError: (summaryError) => {
            const summaryErrorText = String(summaryError?.message || '').toLowerCase()
            const synthesisRateLimited = [
              'rate limit',
              'too many requests',
              'quota',
              '429',
              'throttl',
              'insufficient balance',
            ].some((token) => summaryErrorText.includes(token))
            traceTool.thinking(
              synthesisRateLimited
                ? 'Local model limit hit during web synthesis. Returning direct source digest instead.'
                : `Web synthesis fallback engaged: ${String(summaryError?.message || 'unknown error').slice(0, 180)}`,
              { step: stepHint },
            )
          },
        })
        const summary = synthesized.summary

        const payload = {
          query,
          provider: String(webData?.provider || 'web'),
          totalResults: Number(webData?.totalResults || 0),
          scannedSources: sources.length,
          linesReadTotal: Number(webData?.linesReadTotal || 0),
          charsReadTotal: Number(webData?.charsReadTotal || 0),
          relatedQueries: Array.isArray(webData?.relatedQueries) ? webData.relatedQueries.slice(0, 8) : [],
          summary: String(summary || '').slice(0, 4000),
          sources: synthesized.sources.map((source) => ({
            title: source.title,
            url: source.url,
            status: source.status,
            linesRead: source.linesRead,
            charsRead: source.charsRead,
            fetchMs: source.fetchMs,
            relevanceScore: source.relevanceScore,
            excerpt: source.excerpt || source.snippet,
            error: source.error,
          })),
          synthesis: synthesized.synthesis,
          steps: Array.isArray(webData?.steps) ? webData.steps.slice(0, maxSources) : [],
          visualizer: {
            query,
            totalResults: Number(webData?.totalResults || 0),
            scannedSources: sources.length,
            linesReadTotal: Number(webData?.linesReadTotal || 0),
            charsReadTotal: Number(webData?.charsReadTotal || 0),
            series: (Array.isArray(webData?.steps) ? webData.steps : []).slice(0, maxSources).map((step) => ({
              index: Number(step?.index || 0),
              label: String(step?.title || '').slice(0, 180),
              url: String(step?.url || '').slice(0, 320),
              status: String(step?.status || '').slice(0, 40),
              linesRead: Number(step?.linesRead || 0),
              charsRead: Number(step?.charsRead || 0),
              lineRatio: Number(step?.lineRatio || 0),
              relevanceScore: Number(step?.relevanceScore || 0),
            })),
          },
          cached: false,
          callsUsed: Number(webSearchState?.callsUsed || 0),
          callsRemaining: Math.max(0, Number(webSearchState?.maxCalls || 0) - Number(webSearchState?.callsUsed || 0)),
        }

        setWebSearchCache(webSearchState, queryKey, payload)
        return payload
      }

      if (toolName === 'screen.capabilities') {
        const capabilities = await getAutomationCapabilities()
        return capabilities
      }

      if (toolName === 'launch.run') {
        const launcherName = String(safeArgs.name || safeArgs.app || '').trim()
        const workingDirectory = String(settings.agent_working_dir || '').trim()
        let resolvedEntry: LauncherEntry | null = null
        let resolvedCategory = String(safeArgs.category || '')
          .trim()
          .toLowerCase()
        let commandInput = String(safeArgs.command || '').trim()
        if (launcherName) {
          await refreshLauncherCatalog(workingDirectory, false)
          resolvedEntry = resolveLauncherEntry(launcherName, {
            workingDirectory,
            agentOnly: true,
          })
          if (!resolvedEntry) {
            throw new Error(
              `No launcher named "${launcherName}". Call launcher.list to see the available apps/shortcuts.`,
            )
          }
          commandInput = String(resolvedEntry.command || '').trim()
          if (!resolvedCategory) resolvedCategory = String(resolvedEntry.category || '').toLowerCase()
        }

        const category = resolvedCategory || String(safeArgs.category || 'command').toLowerCase()
        if (!['command', 'app', 'script', 'url'].includes(category)) {
          throw new Error('Invalid launch category.')
        }
        const cwd = safeArgs.cwd
          ? assertSafePath(String(safeArgs.cwd), { operation: 'cwd', settings })
          : resolvedEntry?.cwd || workingDirectory || undefined

        if (resolvedEntry?.executable) {
          const result = await launchLocalCommand({
            executable: resolvedEntry.executable,
            args: resolvedEntry.args || [],
            category,
            cwd,
          })
          return {
            pid: result.pid,
            mode: result.mode,
            message: result.message,
          }
        }

        let command
        try {
          command = assertSafeCommand(commandInput, settings, 'launch', approvalState)
        } catch (error) {
          const reason = String(error?.message || 'Launch blocked by safety settings.')
          const lowerReason = reason.toLowerCase()
          const canRequest =
            Boolean(onApprovalRequest) &&
            (lowerReason.includes('sudo') ||
              lowerReason.includes('network-related commands are blocked') ||
              lowerReason.includes('shell passthrough launch commands are blocked'))

          if (canRequest) {
            const approved = await requestSessionApproval({
              requestedTool: 'launch.run',
              requestedAction: `launch ${commandInput || '(empty command)'}`,
              reason,
              grantElevated: lowerReason.includes('sudo'),
              grantNetwork: lowerReason.includes('network-related commands are blocked'),
              grantShellPassthrough: lowerReason.includes('shell passthrough launch commands are blocked'),
            })

            if (!approved) {
              throw new Error('Approval denied for launch.run.')
            }

            command = assertSafeCommand(commandInput, settings, 'launch', approvalState)
          } else {
            throw error
          }
        }

        const result = await launchLocalCommand(command, category, cwd)
        return {
          pid: result.pid,
          mode: result.mode,
          message: result.message,
        }
      }

      if (toolName === 'launcher.list') {
        const workingDirectory = String(settings.agent_working_dir || '').trim()
        await refreshLauncherCatalog(workingDirectory, false)
        const catalog = getLauncherCatalog({
          workingDirectory,
          agentOnly: true,
        })
        return {
          launchers: catalog.map((entry) => ({
            name: entry.name,
            category: entry.category,
            subtitle: entry.subtitle || '',
          })),
          count: catalog.length,
          hint: 'Launch any of these with launch.run({ name }). Categories: app | command | script | url.',
        }
      }

      if (toolName === 'agent.delegate') {
        const currentRole = (() => {
          try {
            return resolveCurrentRole(settings)
          } catch {
            return 'executor'
          }
        })()
        if (currentRole !== 'orchestrator') {
          traceTool.thinking(
            `Not the orchestrator, so delegation isn't available — use agent.consult / agent.review to get peer help instead.`,
            { step },
          )
          return {
            delegated: false,
            reason: 'not_orchestrator',
            message:
              'Only the orchestrator can agent.delegate. To get help, use agent.consult (ask a peer a focused question) or agent.review (multi-model review) — those are available to you. Do not retry agent.delegate.',
          }
        }
        const delegateResult = await handleAgentDelegate(safeArgs, settings)

        const delegationWaitMs = safeArgs.waitMs !== undefined ? Number(safeArgs.waitMs) : 45000
        if (delegateResult?.taskId && delegationWaitMs !== 0) {
          agentState.current = AGENT_STATES.DELEGATED_PAUSE
          const _memberLabel = String(delegateResult.toAgent || safeArgs.toAgent || 'sub-agent')
          const _modelLabel = delegateResult.model ? ` (${delegateResult.model})` : ''
          traceTool.thinking(
            `Delegated task ${delegateResult.taskId} to ${_memberLabel}${_modelLabel}. Pausing loop to await result.`,
            { step },
          )
          const waitLimit = Math.max(1000, Math.min(120000, delegationWaitMs))
          const _roleLabel = `${_memberLabel.charAt(0).toUpperCase()}${_memberLabel.slice(1)}${_modelLabel}`
          try {
            const pollResult = await handleAgentRecall({
              taskId: delegateResult.taskId,
              waitMs: waitLimit,
            })
            agentState.current = AGENT_STATES.RUNNING
            const _status = String(pollResult?.status || 'unknown')
            const _steps = Number(pollResult?.stepsUsed || 0)
            const _tools = Array.isArray(pollResult?.toolsUsed) ? pollResult.toolsUsed.length : 0
            const _secs = Number.isFinite(Number(pollResult?.durationMs))
              ? Math.round(Number(pollResult.durationMs) / 100) / 10
              : null
            const _ok = _status === 'done'
            const _takeover =
              _status === 'timeout' || _status === 'failed' || _status === 'partial' ? ' — taking over directly.' : '.'
            traceTool.thinking(
              `${_roleLabel} ${_ok ? 'finished' : _status} task ${delegateResult.taskId} in ${_steps} step${_steps === 1 ? '' : 's'}, ${_tools} tool${_tools === 1 ? '' : 's'}${_secs != null ? `, ${_secs}s` : ''}${_takeover}${pollResult?.satisfactionHint ? ` (${String(pollResult.satisfactionHint).slice(0, 160)})` : ''}`,
              { step },
            )
            try {
              recordDelegationMetrics({
                delegations_posted: 1,
                delegations_satisfied: _ok ? 1 : 0,
                escalations: _ok ? 0 : 1,
              })
            } catch {
              /* non-fatal */
            }

            if (!_ok && settings?.agent_planning_mode === true) {
              const reassign = reassignFailedPart(String(delegateResult.toAgent || safeArgs.toAgent || ''), settings)
              if (reassign && reassign.memberId !== delegateResult.toAgent) {
                traceTool.thinking(
                  `Reassigning the failed part to ${reassign.memberId} (${reassign.model}) — keeping the plan.`,
                  { step },
                )
                agentState.current = AGENT_STATES.DELEGATED_PAUSE
                try {
                  const reDelegate = await handleAgentDelegate({ ...safeArgs, toAgent: reassign.memberId }, settings)
                  if (reDelegate?.taskId) {
                    const rePoll = await handleAgentRecall({
                      taskId: reDelegate.taskId,
                      waitMs: waitLimit,
                    })
                    agentState.current = AGENT_STATES.RUNNING
                    return {
                      ...reDelegate,
                      immediateResult: rePoll,
                      reassignedFrom: delegateResult.toAgent,
                    }
                  }
                } catch {
                  /* reassignment is best-effort — fall through to the lead taking over */
                }
                agentState.current = AGENT_STATES.RUNNING
              }
            }
            return { ...delegateResult, immediateResult: pollResult }
          } catch (pauseErr) {
            agentState.current = AGENT_STATES.RUNNING
            traceTool.thinking(
              `${_roleLabel} did not return in time for task ${delegateResult.taskId} (${pauseErr?.message || 'timeout'}) — taking over directly.`,
              { step },
            )
            try {
              recordDelegationMetrics({
                delegations_posted: 1,
                delegations_satisfied: 0,
                escalations: 1,
              })
            } catch {
              /* non-fatal */
            }
            return {
              ...delegateResult,
              pauseError: pauseErr?.message || 'timeout',
            }
          }
        }

        return delegateResult
      }

      if (toolName === 'agent.recall') {
        return handleAgentRecall(safeArgs)
      }

      if (toolName === 'agent.readOutput') {
        const taskId = String(safeArgs.taskId || '').trim()
        if (!taskId) throw new Error('taskId is required for agent.readOutput')
        let output = ''
        try {
          output = await subagentReadOutput(taskId)
        } catch {
          output = ''
        }
        return {
          taskId,
          output: output || '(no output file for this task — it may have produced no result or expired)',
          chars: output.length,
        }
      }

      if (toolName === 'agent.status') {
        return handleAgentStatus(safeArgs)
      }

      if (toolName === 'agent.roster') {
        return handleAgentRoster()
      }

      if (toolName === 'agent.broadcast') {
        return handleAgentBroadcast(safeArgs)
      }

      if (toolName === 'agent.verify') {
        return handleAgentVerify(safeArgs)
      }

      if (toolName === 'agent.available') {
        const roster = handleAgentRoster()
        const agents = Array.isArray(roster?.agents) ? roster.agents : []
        return {
          agents: agents.map((a) => ({
            role: a.role || a.id,
            provider: a.provider || 'unknown',
            model: a.model || 'unknown',
            status: a.status || 'unknown',
            health: a.health || 1.0,
            lastSeen: a.lastSeen || null,
            currentTask: a.currentTask || null,
            available: a.status === 'idle' && Date.now() - (a.lastSeen || 0) < 30000,
          })),
          timestamp: Date.now(),
        }
      }

      if (toolName === 'agent.recallAll') {
        const taskIds = Array.isArray(safeArgs.taskIds) ? safeArgs.taskIds.map(String) : []
        if (!taskIds.length) throw new Error('taskIds array required for agent.recallAll')
        const waitMs = Number.isFinite(Number(safeArgs.waitMs))
          ? Math.max(5000, Math.min(120000, Number(safeArgs.waitMs)))
          : 60000

        agentState.current = AGENT_STATES.DELEGATED_PAUSE
        traceTool.thinking(`Awaiting ${taskIds.length} parallel tasks: ${taskIds.join(', ')}`, {
          step,
        })
        try {
          const results = await Promise.all(
            taskIds.map((taskId) =>
              handleAgentRecall({ taskId, waitMs }).catch((err) => ({
                taskId,
                status: 'failed',
                error: err?.message || 'timeout',
              })),
            ),
          )
          agentState.current = AGENT_STATES.RUNNING
          const satisfied = results.filter((r) => r?.status === 'done').length
          try {
            recordDelegationMetrics({
              delegations_posted: taskIds.length,
              delegations_satisfied: satisfied,
              escalations: taskIds.length - satisfied,
            })
          } catch {
            /* non-fatal */
          }
          return {
            results,
            total: taskIds.length,
            satisfied,
            failed: taskIds.length - satisfied,
          }
        } catch (err) {
          agentState.current = AGENT_STATES.RUNNING
          throw err
        }
      }

      if (toolName === 'cloud.consult') {
        if (typeof requestCloudConsult !== 'function') {
          return {
            consulted: false,
            untrusted: true,
            reason: 'cloud_unavailable',
            message:
              'Cloud consultation is unavailable for this session. Continue locally or select a cloud-capable hybrid responder.',
          }
        }
        const question = String(safeArgs.question || safeArgs.topic || '').trim()
        if (!question) throw new Error('question is required for cloud.consult')
        return requestCloudConsult({
          question,
          reason: String(safeArgs.reason || 'A focused second opinion is useful.'),
          context: safeArgs.context,
          step,
        })
      }

      if (toolName === 'agent.find') {
        return handleAgentFind(safeArgs, settings)
      }

      if (toolName === 'agent.consult') {
        const target = resolveConsultTarget(safeArgs, settings, [])
        if (!target) {
          return {
            consulted: false,
            untrusted: true,
            reason: 'no_peer',
            message:
              'No distinct peer is configured for that subject. Assign different models to the executor/scout roles in Settings → Agents, or answer it yourself.',
          }
        }

        let gate = mesh.canConsult(target.role, Number(safeArgs.depth) || 1)
        if (gate.reason === 'budget_exhausted' && onApprovalRequest) {
          try {
            const response = await onApprovalRequest({
              modelId: String(settings?.ai_model || settings?.ai_provider || 'IRIS'),
              requestType: 'question',
              question: `${gate.message} Allow up to 10 more peer consultations for this task?`,
              options: [{ value: 'Allow 10 more' }, { value: 'No, continue without consulting' }],
              allowOther: false,
              recommendedDecision: 'deny',
            })
            const answer = String(
              response && typeof response === 'object' ? (response.answer ?? response.decision ?? '') : response || '',
            ).toLowerCase()
            if (/allow|continue|yes/.test(answer)) {
              mesh.raiseConsultCap(10)
              gate = mesh.canConsult(target.role, Number(safeArgs.depth) || 1)
            }
          } catch {
            /* decline on approval-channel errors */
          }
        }
        if (!gate.ok) {
          traceTool.thinking(`Skipped peer consult: ${gate.message || gate.reason}`, { step })
          return {
            consulted: false,
            untrusted: true,
            reason: gate.reason,
            message: gate.message,
          }
        }

        const peerTags = Array.isArray(target.tags) ? target.tags.join(', ') : ''
        traceTool.thinking(
          `Consulting ${target.role} peer (${target.provider}/${target.model}${peerTags ? `; tags: ${peerTags}` : ''}).`,
          { step },
        )

        const consultState = agentState.current
        agentState.current = AGENT_STATES.DELEGATED_PAUSE
        try {
          const result = await runPeerConsult(target, safeArgs, settings)
          mesh.recordConsult(target.role)
          agentState.current = consultState
          const exec = result.peerWantsToExecute
            ? ` (peer offers to act: ${String(result.proposedAction || '').slice(0, 120)} — delegate to it if you agree)`
            : ''
          traceTool.thinking(`${target.role} answered (untrusted — verify before acting)${exec}.`, {
            step,
          })
          return result
        } catch (err) {
          agentState.current = consultState
          return {
            consulted: false,
            untrusted: true,
            reason: 'consult_failed',
            message: err instanceof Error ? err.message : 'Peer consult failed.',
          }
        }
      }

      if (toolName === 'agent.overwatch') {
        const owState = agentState.current
        agentState.current = AGENT_STATES.DELEGATED_PAUSE
        try {
          const ov = await runOverwatch(safeArgs, settings)
          agentState.current = owState
          if (ov.available) {
            traceTool.thinking(
              `Overwatcher: complexity ${ov.complexity}${ov.escalate ? `, escalate (tags: ${(ov.suggestedTags || []).join(', ') || 'any'})` : ''}.`,
              { step },
            )
          }
          return ov
        } catch (err) {
          agentState.current = owState
          return {
            available: false,
            untrusted: true,
            reason: 'overwatch_failed',
            message: err instanceof Error ? err.message : 'Overwatcher call failed.',
          }
        }
      }

      if (toolName === 'agent.review') {
        traceTool.thinking('Requesting a multi-model peer review of the diff.', { step })
        const reviewState = agentState.current
        agentState.current = AGENT_STATES.DELEGATED_PAUSE
        try {
          const review = await runPeerReview(safeArgs, settings)
          agentState.current = reviewState
          if (review.reviewed) {
            const verdict = String(review.overallVerdict || 'reviewed')
            const n = Array.isArray(review.reviews) ? review.reviews.length : 0
            const findings = Array.isArray(review.findings) ? review.findings.length : 0
            traceTool.thinking(
              `Peer review complete: ${verdict} from ${n} reviewer(s), ${findings} finding(s) (advisory — you own the fix pass).`,
              { step },
            )
          }
          return review
        } catch (err) {
          agentState.current = reviewState
          return {
            reviewed: false,
            untrusted: true,
            reason: 'review_failed',
            message: err instanceof Error ? err.message : 'Peer review failed.',
          }
        }
      }

      if (toolName === 'search.ripgrep') {
        const pattern = String(safeArgs.pattern || safeArgs.query || '').trim()
        if (!pattern) throw new Error('pattern is required for search.ripgrep')

        const pathInput = String(safeArgs.path || '.').trim()
        const safePath = assertSafePath(pathInput, {
          operation: 'read',
          settings,
        })

        const mode = ['content', 'files', 'count'].includes(String(safeArgs.mode || '').toLowerCase())
          ? String(safeArgs.mode).toLowerCase()
          : 'content'

        const result = await powerRipgrep(pattern, {
          path: safePath,
          mode,
          fileGlob: safeArgs.fileGlob ? String(safeArgs.fileGlob) : undefined,
          globs: Array.isArray(safeArgs.globs) ? safeArgs.globs.map(String) : undefined,
          type: safeArgs.type ? String(safeArgs.type) : undefined,
          ignoreCase: safeArgs.ignoreCase !== false,
          fixedStrings: safeArgs.fixedStrings === true,
          wordBoundary: safeArgs.wordBoundary === true,
          multiline: safeArgs.multiline === true,
          hidden: safeArgs.hidden === true,
          searchIgnored: safeArgs.searchIgnored === true || safeArgs.noIgnore === true,
          contextLines: Number.isFinite(Number(safeArgs.contextLines)) ? Number(safeArgs.contextLines) : 2,
          maxResults: Number.isFinite(Number(safeArgs.maxResults)) ? Number(safeArgs.maxResults) : 40,
        })

        if (mode === 'files') {
          return {
            pattern,
            path: safePath,
            mode,
            files: Array.isArray(result?.files) ? result.files : [],
            totalFiles: Number(result?.totalFiles || 0),
            usedFallback: Boolean(result?.usedFallback),
            command: String(result?.command || 'rg'),
            ...(result?.error ? { error: String(result.error) } : {}),
          }
        }
        if (mode === 'count') {
          return {
            pattern,
            path: safePath,
            mode,
            counts: Array.isArray(result?.counts) ? result.counts : [],
            totalMatches: Number(result?.totalMatches || 0),
            totalFiles: Number(result?.totalFiles || 0),
            usedFallback: Boolean(result?.usedFallback),
            command: String(result?.command || 'rg'),
            ...(result?.error ? { error: String(result.error) } : {}),
          }
        }
        return {
          pattern,
          path: safePath,
          mode,
          matches: Array.isArray(result?.matches) ? result.matches : [],
          byFile: Array.isArray(result?.byFile) ? result.byFile : [],
          totalMatches: Number(result?.totalMatches || 0),
          truncated: Boolean(result?.truncated),
          usedFallback: Boolean(result?.usedFallback),
          command: String(result?.command || 'rg'),
          ...(result?.error ? { error: String(result.error) } : {}),
        }
      }

      if (toolName === 'files.stat') {
        const rawPath = safeArgs.path
        const pathList = Array.isArray(rawPath) ? rawPath : [rawPath]

        const safePaths = pathList
          .filter(Boolean)
          .slice(0, 20)
          .map((p) => assertSafePath(String(p), { operation: 'read', settings }))

        const result = await powerStat(safePaths)
        return { files: Array.isArray(result?.files) ? result.files : [] }
      }

      if (toolName === 'memory.query') {
        const query = String(safeArgs.query || '').trim()
        if (!query) throw new Error('query is required for memory.query')

        const category = String(safeArgs.category || '').trim() || undefined
        const limit = Number.isFinite(Number(safeArgs.limit)) ? Math.max(1, Math.min(20, Number(safeArgs.limit))) : 5

        const matches = queryNotes(query, { category, limit })
        return {
          query,
          category: category || 'all',
          matches,
          total: matches.length,
        }
      }

      if (toolName === 'chat.remember') {
        const chatId = settings?.chat_session?.id
        if (!chatId)
          return {
            ok: false,
            note: 'No active chat session to write memory for.',
          }
        const content = String(safeArgs.content ?? '')
        if (!content.trim()) throw new Error('content is required for chat.remember')
        const append = String(safeArgs.mode || 'replace').toLowerCase() === 'append'
        try {
          await chatsWriteMemory(chatId, content, { append })
        } catch (error) {
          return {
            ok: false,
            error: String(error?.message || 'memory write failed'),
          }
        }
        return {
          ok: true,
          mode: append ? 'append' : 'replace',
          chars: content.length,
        }
      }

      if (toolName === 'chat.recall') {
        const chatId = settings?.chat_session?.id
        if (!chatId) return { context: '', note: 'No active chat session.' }
        const scope = String(safeArgs.scope || 'compacted').toLowerCase() === 'full' ? 'full' : 'compacted'
        let context = ''
        try {
          context = await chatsRecall(chatId, scope)
        } catch {
          context = ''
        }
        return {
          scope,
          context: context || '(no earlier context recorded yet for this chat)',
        }
      }

      if (toolName === 'context.summarize') {
        const focus = String(safeArgs.focus || '').trim()
        const maxChars = Number.isFinite(Number(safeArgs.maxChars)) ? Math.max(200, Number(safeArgs.maxChars)) : 2000

        const historyDigest = stepHistory
          .map((step, index) => {
            const toolLabel = step.tool || 'unknown'
            const status = step.ok ? 'ok' : `error: ${String(step.error || '').slice(0, 80)}`
            const summary = String(step.summary || '').slice(0, 200)
            return `Step ${index + 1} [${toolLabel}] ${status}${summary ? ` — ${summary}` : ''}`
          })
          .join('\n')

        if (!historyDigest) {
          return {
            summary: 'No step history to compress.',
            itemsCompressed: 0,
            tokensSaved: 0,
          }
        }

        const systemMsg = `You are IRIS Context Compressor. Produce a dense summary of the step history. Preserve key findings, file paths, error patterns, and conclusions. Omit procedural detail. ${UNTRUSTED_CONTENT_SYSTEM_RULES}`
        const userMsg = focus
          ? `Focus on: ${focus}\n\nStep history:\n${historyDigest}`
          : `Step history:\n${historyDigest}`

        try {
          const response = await requestAI([
            { role: 'system', content: systemMsg },
            { role: 'user', content: userMsg },
          ])
          const summary = String(response || '').slice(0, maxChars)
          const tokensSaved = Math.max(0, Math.ceil(historyDigest.length / 4) - Math.ceil(summary.length / 4))

          return { summary, itemsCompressed: stepHistory.length, tokensSaved }
        } catch {
          const fallbackSummary = historyDigest.slice(0, maxChars)
          return {
            summary: fallbackSummary,
            itemsCompressed: stepHistory.length,
            tokensSaved: 0,
          }
        }
      }

      if (toolName === 'search.find') {
        const safePath = assertSafePath(String(safeArgs.path || '.'), {
          operation: 'read',
          settings,
        })
        const result = await powerFind({
          path: safePath,
          name: safeArgs.name ? String(safeArgs.name) : undefined,
          type: safeArgs.type ? String(safeArgs.type) : undefined,
          maxDepth: Number.isFinite(Number(safeArgs.maxDepth)) ? Number(safeArgs.maxDepth) : 6,
          newerThan: safeArgs.newerThan ? String(safeArgs.newerThan) : undefined,
          olderThan: safeArgs.olderThan ? String(safeArgs.olderThan) : undefined,
          minSizeKb: Number.isFinite(Number(safeArgs.minSizeKb)) ? Number(safeArgs.minSizeKb) : undefined,
          maxSizeKb: Number.isFinite(Number(safeArgs.maxSizeKb)) ? Number(safeArgs.maxSizeKb) : undefined,
          exclude: Array.isArray(safeArgs.exclude) ? safeArgs.exclude.map(String) : [],
          maxResults: Number.isFinite(Number(safeArgs.maxResults)) ? Number(safeArgs.maxResults) : 40,
        })
        return result
      }

      if (toolName === 'search.fd') {
        const safePath = assertSafePath(String(safeArgs.path || '.'), {
          operation: 'read',
          settings,
        })
        const result = await powerFd({
          pattern: safeArgs.pattern ? String(safeArgs.pattern) : undefined,
          path: safePath,
          extension: safeArgs.extension ? String(safeArgs.extension) : undefined,
          type: safeArgs.type ? String(safeArgs.type) : undefined,
          hidden: safeArgs.hidden === true,
          maxDepth: Number.isFinite(Number(safeArgs.maxDepth)) ? Number(safeArgs.maxDepth) : undefined,
          exclude: Array.isArray(safeArgs.exclude) ? safeArgs.exclude.map(String) : [],
          maxResults: Number.isFinite(Number(safeArgs.maxResults)) ? Number(safeArgs.maxResults) : 40,
        })
        return result
      }

      if (toolName === 'search.locate') {
        const pattern = String(safeArgs.pattern || '').trim()
        if (!pattern) throw new Error('pattern is required for search.locate')
        const result = await powerLocate({
          pattern,
          limit: Number.isFinite(Number(safeArgs.limit)) ? Number(safeArgs.limit) : 20,
          caseSensitive: safeArgs.caseSensitive === true,
        })
        return result
      }

      if (toolName === 'files.diff') {
        const safePath = assertSafePath(String(safeArgs.path || ''), {
          operation: 'read',
          settings,
        })
        const newContent = String(safeArgs.newContent || '')
        const contextLines = Number.isFinite(Number(safeArgs.contextLines)) ? Number(safeArgs.contextLines) : 3
        const result = await powerDiff(safePath, newContent, contextLines)
        return result
      }

      if (toolName === 'files.patch') {
        const safePath = assertSafePath(String(safeArgs.path || ''), {
          operation: 'write',
          settings,
        })
        const patch = String(safeArgs.patch || '')
        if (!patch) throw new Error('patch is required for files.patch')
        const dryRun = safeArgs.dryRun === true
        const result = await powerPatch(safePath, patch, dryRun)
        return result
      }

      if (toolName === 'files.edit') {
        const safePath = assertSafePath(String(safeArgs.path || ''), {
          operation: 'write',
          settings,
        })
        const oldText = String(safeArgs.oldText ?? safeArgs.oldString ?? '')
        const newText = String(safeArgs.newText ?? safeArgs.newString ?? '')
        if (!oldText) throw new Error('oldText is required for files.edit.')
        const replaceAll = safeArgs.replaceAll === true
        const result = await editTextFile(safePath, oldText, newText, { replaceAll })
        if (result?.applied) {
          const replacements = Number(result.replacements || 1)
          traceTool.thinking(
            `Edited ${result.path} (+${Number(result.added || 0)}/-${Number(result.removed || 0)}${replacements > 1 ? `, ${replacements} occurrences` : ''}).`,
          )
        }
        return result
      }

      if (toolName === 'web.fetch') {
        const url = String(safeArgs.url || '').trim()
        if (!url || !/^https?:\/\//.test(url)) throw new Error('valid https url required for web.fetch')

        const fetchHost = extractWebHost(url)
        const siteOk = await requestSiteApproval(fetchHost, {
          action: `fetch ${url}`,
          reason: `web.fetch wants to read content from ${fetchHost || url}.`,
        })
        if (!siteOk) {
          return {
            error: `Web access to ${fetchHost || url} was denied by the user. Use an already-approved source, or ask the user to approve this site.`,
            blockedDomain: fetchHost,
          }
        }

        const extract = String(safeArgs.extract || 'text')
        const maxChars = Number.isFinite(Number(safeArgs.maxChars)) ? Number(safeArgs.maxChars) : 20000
        const result = await powerWebFetch(url, { extract, maxChars })

        try {
          const domain = new URL(url).hostname
          addNote({
            title: `Web: ${domain} @ ${new Date().toISOString().slice(0, 16)}`,
            category: 'knowledge',
            content: `CATEGORY: knowledge\nTAGS: web-cache,${domain}\nSUMMARY: ${String(result.title || url).slice(0, 80)}\n\n${String(result.content || '').slice(0, 500)}`,
            color: 'blue',
            sessionScoped: true,
          })
        } catch {
          /* non-fatal */
        }

        return result
      }

      if (toolName === 'sources.lookup') {
        const topic = String(safeArgs.topic || safeArgs.query || '').trim()
        if (!topic) throw new Error('sources.lookup needs a topic.')
        const result = lookupTrustedSources(topic, {
          kind: safeArgs.kind,
          limit: safeArgs.limit,
        })
        traceTool.thinking(
          `Resolved ${result.count} trusted source(s) for "${topic}"${result.kind ? ` (${result.kind})` : ''}.`,
        )
        return result
      }

      if (toolName === 'env.inspect') {
        const include = Array.isArray(safeArgs.include)
          ? safeArgs.include.map(String)
          : ['processes', 'ports', 'tools', 'env']
        const result = await powerEnvInspect(include)
        return result
      }

      if (toolName === 'skills.search') {
        const query = String(safeArgs.query || '').trim()
        if (!query) throw new Error('query is required for skills.search')
        const allSkills = await listSkillDefinitions(safeArgs.agentTarget || 'all')
        const { Fuse } = await import('fuse.js').catch(() => ({ Fuse: null }))
        if (!Fuse) return { matches: [], error: 'fuse.js not available' }
        const fuse = new Fuse(allSkills, {
          keys: ['title', 'summary', 'instructions', 'triggers'],
          threshold: 0.4,
          includeScore: true,
        })
        const rawResults = fuse.search(query).slice(0, 10)
        const matches = rawResults.map((r) => ({
          id: r.item.id,
          title: r.item.title,
          summary: r.item.summary || r.item.instructions?.slice(0, 100),
          score: Math.round((1 - (r.score || 0)) * 100) / 100,
          type: r.item.type || 'standard',
          agentTarget: r.item.agentTarget || 'all',
        }))
        return { query, matches, total: matches.length }
      }

      if (toolName === 'clipboard.read') {
        const result = await powerClipboardRead()
        return result
      }

      if (toolName === 'clipboard.write') {
        const content = String(safeArgs.content || '')
        const result = await powerClipboardWrite(content)
        return result
      }

      if (toolName === 'terminal.script') {
        const scriptName = String(safeArgs.script || '').trim()
        const allowedScripts = new Set([
          'orbit-explore-project',
          'orbit-explore-git',
          'orbit-audit-secrets',
          'orbit-audit-size',
          'orbit-find-config',
          'orbit-find-todos',
          'orbit-snapshot-workspace',
          'orbit-explore-deps',
        ])
        if (!allowedScripts.has(scriptName)) {
          throw new Error(`Unknown script "${scriptName}". Available: ${[...allowedScripts].join(', ')}`)
        }
        const safety = runtimeSupport.resolveSafetyConfig(settings, null)
        if (safety.tier1ReadOnly) {
          throw new Error('Scripts are blocked in read-only permission tier.')
        }
        const result = await powerScript(scriptName, safeArgs.args || {}, safeArgs.cwd)
        return result
      }

      if (toolName === 'terminal.pipe') {
        const commands = Array.isArray(safeArgs.commands) ? safeArgs.commands.map(String).filter(Boolean) : []
        if (!commands.length) throw new Error('commands array required for terminal.pipe')
        if (commands.length > 8) throw new Error('terminal.pipe: max 8 commands per pipeline')

        for (const cmd of commands) {
          assertSafeCommand(cmd, settings, 'terminal', approvalState)
        }

        const pipeStr = commands.join(' | ')
        if (PIPE_TO_SHELL_PATTERNS.some((p) => p.test(pipeStr))) {
          throw new Error('terminal.pipe: pipe-to-shell pattern detected and blocked.')
        }

        const cwd = safeArgs.cwd ? assertSafePath(String(safeArgs.cwd), { operation: 'cwd', settings }) : undefined
        const result = await executeTerminalCommand(pipeStr, cwd)
        return result
      }

      throw new Error(`Tool handler not implemented: ${toolName}`)
    },
  }
}

// ── Controller decision normalization ─────────────────────────────────────────
// normalizeDecision / mapNativeMetaToDecision / looksLikeControllerSchemaText /
// recoverDecisionFromSchemaText moved to agent/controllerDecision.js (W5) — a
// pure cluster, imported at the top of this file. The lean per-step user turn is
// built by buildControllerStateHeader in agent/controllerPrompt.js (W1).
