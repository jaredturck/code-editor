/**
 * Central metadata catalog for every agent tool.
 *
 * Tool execution remains in agentRuntime/subAgentRuntime. This module owns the
 * stable descriptive metadata consumed by prompts, aliases, permissions,
 * timeouts, sub-agents, and UI presentation.
 */

export type PermissionTier = 0 | 1 | 2 | 3
export type ToolModule = 'Files' | 'Terminal' | 'Notes' | 'System' | 'Search' | 'Screen' | 'Launch' | 'Agent'
export type ToolArgumentDescriptions = Record<string, string>

export interface ToolDefinition {
  name: string
  module: ToolModule
  description: string
  args: ToolArgumentDescriptions
  internal?: boolean
}

export type ToolPresentationKind = 'command' | 'edit' | 'read' | 'search' | 'other'

export interface ToolPresentation {
  kind: ToolPresentationKind
  icon: string
  moduleIcon: string
  language: string
  actionVerb?: string
}

export interface ToolCatalogEntry extends ToolDefinition {
  aliases: string[]
  timeoutMs: number
  risky: boolean
  permissionKey: string | null
  lean: boolean
  subAgentMinTier: number | null
  subAgentNative: boolean
  presentation: ToolPresentation
}

export interface CatalogToolResolution {
  requested: string
  resolved: string
  matchedBy: 'none' | 'exact' | 'case_insensitive' | 'alias'
}

export interface SubAgentToolDefinition {
  name: string
  description: string
  args: ToolArgumentDescriptions
}

export const DEFAULT_AGENT_READ_LINE_COUNT = 950
export const DEFAULT_TOOL_TIMEOUT_MS = 25000

export const PERMISSION_TIER = {
  LOCKED: 0,
  READ_ONLY: 1,
  STANDARD: 2,
  POWER: 3,
} as const satisfies Record<string, PermissionTier>

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'files.list',
    module: 'Files',
    description: 'List files and directories under a path.',
    args: { path: 'string', depth: 'number (1-6)' },
  },
  {
    name: 'files.find',
    module: 'Files',
    description: 'Find files or matching text using case-insensitive and/or regex search.',
    args: {
      path: 'string',
      query: 'string',
      mode: 'name|content|auto (optional)',
      useRegex: 'boolean (optional)',
      ignoreCase: 'boolean (optional)',
      depth: 'number (optional)',
      maxResults: 'number (optional)',
      fuzzy: 'boolean (optional, default true for non-regex name/auto)',
      fuzzyThreshold: 'number (optional, 0.12-0.9, lower is stricter)',
    },
  },
  {
    name: 'rag.retrieve',
    module: 'Search',
    description:
      'Retrieve relevant passages from the indexed filesystem. Uses semantic file search, reads only top candidates from their original paths, creates temporary in-memory chunks, ranks them, and returns paths with line ranges. No file contents are copied into the semantic database.',
    args: {
      query: 'string — what information or project context to find',
      maxFiles: 'number (optional, default 10, max 20)',
      maxPassages: 'number (optional, default 12, max 30)',
    },
  },
  {
    name: 'files.read',
    module: 'Files',
    description:
      'Read a text file. Output is line-numbered by default so you can cite lines and target files.edit precisely. Use pattern to return only matching lines (+context) like an in-file grep, or tail to read the last N lines.',
    args: {
      path: 'string',
      startLine: 'number (optional, default 1)',
      lineCount: `number (optional, default ${DEFAULT_AGENT_READ_LINE_COUNT})`,
      maxChars: 'number (optional)',
      pattern: 'string (optional — return only lines matching this text/regex, with context)',
      patternRegex: 'boolean (optional — treat pattern as a regex)',
      patternContext: 'number (optional — context lines around each pattern match, default 2)',
      tail: 'number (optional — read the last N lines instead of from the top)',
      lineNumbers: 'boolean (optional, default true — set false for raw content)',
    },
  },
  {
    name: 'files.write',
    module: 'Files',
    description: 'Write text to a file path. Use mode:"append" to extend a large file across calls.',
    args: {
      path: 'string',
      content: 'string',
      mode: 'create | append (optional, default create)',
    },
  },
  {
    name: 'terminal.exec',
    module: 'Terminal',
    description:
      'Run one shell command — your PRIMARY tool. Use it for listing (ls), searching (rg/grep/find), inspecting (stat/ps/which), and running builds/tests/git. Prefer this over dedicated file-search tools; use files.read/write/patch only for reading or editing file content.',
    args: { command: 'string', cwd: 'string (optional)' },
  },
  {
    name: 'notes.list',
    module: 'Notes',
    description: 'List notes.',
    args: {},
  },
  {
    name: 'notes.add',
    module: 'Notes',
    description: 'Create a note.',
    args: { title: 'string', content: 'string', color: 'string (optional)' },
  },
  {
    name: 'notes.update',
    module: 'Notes',
    description: 'Update an existing note.',
    args: {
      id: 'number',
      title: 'string (optional)',
      content: 'string (optional)',
      color: 'string (optional)',
    },
  },
  {
    name: 'notes.delete',
    module: 'Notes',
    description: 'Delete a note by id.',
    args: { id: 'number' },
  },
  {
    name: 'skills.list',
    module: 'System',
    internal: true,
    description: 'List skills for a profile.',
    args: { profile: 'string (optional)' },
  },
  {
    name: 'skills.offload',
    module: 'System',
    internal: true,
    description:
      'Drop one or more active skills you have decided are no longer relevant to this task, freeing prompt budget for the rest of the session. Use when an injected skill clearly does not apply.',
    args: {
      ids: 'string[] (skill ids to offload)',
      reason: 'string (optional)',
    },
  },
  {
    name: 'skills.load',
    module: 'System',
    internal: true,
    description:
      "Pull a skill's FULL instructions when its card description matches the task. Returns the instructions body in the result — read it before proceeding. Load only what the task needs (progressive disclosure); skip if already in active_skills.",
    args: {
      ids: 'string[] (skill ids from the cards to load)',
      reason: 'string (optional)',
    },
  },
  {
    name: 'search.web',
    module: 'Search',
    description: 'Perform a research-style web summary query.',
    args: {
      query: 'string',
      maxResults: 'number (optional, 3-16)',
      maxSources: 'number (optional, 1-10)',
      safeSearch: 'moderate|strict|off (optional)',
      timeRange: 'day|week|month|year|all (optional)',
    },
  },
  {
    name: 'screen.capabilities',
    module: 'Screen',
    description: 'Check desktop automation/screen capabilities.',
    args: {},
  },
  {
    name: 'launch.run',
    module: 'Launch',
    description:
      'Launch a local app/command. Prefer name: pass a launcher menu entry name (from launcher.list) and IRIS resolves the command for you — no need to know it. Or pass a raw command.',
    args: {
      name: 'string (a launcher menu entry name — preferred; see launcher.list)',
      command: 'string (raw command, when not launching a known menu entry)',
      category: 'command|app|script|url',
      cwd: 'string (optional)',
    },
  },
  {
    name: 'launcher.list',
    module: 'Launch',
    description:
      "List the user's launcher menu — the apps, scripts, and shortcuts IRIS can launch by name. Call this before launching when you don't already know the command, then launch.run({ name }).",
    args: {},
  },
  {
    name: 'resources.list',
    module: 'System',
    internal: true,
    description: 'List available tools, permissions, and runtime constraints for this session.',
    args: {},
  },
  {
    name: 'approval.request',
    module: 'System',
    internal: true,
    description: 'Request user approval for risky actions in the current session.',
    args: {
      reason: 'string',
      action: 'string (optional)',
      tool: 'string (optional)',
      command: 'string (optional)',
    },
  },
  {
    name: 'system.stats',
    module: 'System',
    internal: true,
    description: 'Read-only system health snapshot: CPU usage, load average, memory, uptime, and platform details.',
    args: {},
  },
  {
    name: 'system.processes',
    module: 'System',
    internal: true,
    description: 'Read-only list of the top running processes by CPU usage.',
    args: { limit: 'number (optional, default 15, max 50)' },
  },
  {
    name: 'artifact.create',
    module: 'System',
    internal: true,
    description:
      'Save a substantial deliverable to the artifacts store and surface it as a file card in chat. Use mode:"append" with the same filename for large deliverables.',
    args: {
      filename: 'string — name with extension',
      content: 'string — file content for this chunk',
      summary: 'string (optional) — one-line description',
      mode: 'create | append (optional, default create)',
    },
  },
  {
    name: 'user.ask',
    module: 'System',
    internal: true,
    description: 'Ask the user a multiple-choice question and wait for the answer without ending the agent run.',
    args: {
      question: 'string',
      options: 'string[] — 2–5 concrete choices',
    },
  },
  {
    name: 'todo.update',
    module: 'System',
    internal: true,
    description: 'Update runtime todo list.',
    args: { updates: 'array of todo update operations' },
  },
  {
    name: 'trace.log',
    module: 'System',
    internal: true,
    description: 'Append an explicit trace/thinking note to timeline.',
    args: { summary: 'string' },
  },
  // ── Multi-Agent Orchestration (Claude only) ────────────────────────────────
  {
    name: 'agent.delegate',
    module: 'Agent',
    internal: true,
    description:
      'Delegate a mechanical task to a sub-agent role. "executor" handles implementation/heavy work, "scout" handles fast lookups/discovery. Non-blocking — returns taskId for recall.',
    args: {
      toAgent: 'executor | scout',
      type: 'execute | discover | summarize | verify',
      instructions: 'string — what to accomplish (one clear goal)',
      tools: 'string[] (optional — restrict which tools the sub-agent may use)',
      outputSchema: 'object (optional — shape of expected result)',
      context: 'object (optional — relevant state to pass)',
      timeoutMs: 'number (optional)',
      priority: 'high | normal | low (optional)',
      maxSteps: 'number (optional)',
    },
  },
  {
    name: 'agent.recall',
    module: 'Agent',
    internal: true,
    description:
      'Retrieve result for a previously delegated task. Blocks until the sub-agent signals completion (no timer guessing), up to waitMs. Returns a trimmed preview + opaque outputPath id; use agent.readOutput to pull the FULL encrypted result if you need more.',
    args: {
      taskId: 'string',
      waitMs: 'number (optional — max time to await the completion signal)',
    },
  },
  {
    name: 'agent.readOutput',
    module: 'Agent',
    internal: true,
    description:
      "Read the FULL encrypted output saved for a finished sub-agent (the opaque outputPath id from agent.recall). Pull only when the trimmed preview wasn't enough — keeps your context lean.",
    args: { taskId: 'string (the delegated task id)' },
  },
  {
    name: 'agent.status',
    module: 'Agent',
    internal: true,
    description: 'Lightweight check — pending, running, done, or failed. No result data.',
    args: { taskId: 'string' },
  },
  {
    name: 'agent.roster',
    module: 'Agent',
    internal: true,
    description: 'List all registered sub-agents, their status, and queue depth.',
    args: {},
  },
  {
    name: 'agent.broadcast',
    module: 'Agent',
    internal: true,
    description: 'Push a context update to all active sub-agents. Use when user intent changes mid-run.',
    args: { message: 'string', contextUpdate: 'object (optional)' },
  },
  {
    name: 'agent.verify',
    module: 'Agent',
    internal: true,
    description: 'Evaluate a sub-agent result against success criteria. Returns pass/fail verdict.',
    args: { taskId: 'string', criteria: 'string' },
  },
  {
    name: 'agent.available',
    module: 'Agent',
    internal: true,
    description:
      'Check which sub-agents are currently available before delegating. Returns role, status, health, and last-seen for each agent. Always call before parallel delegation.',
    args: {},
  },
  {
    name: 'agent.recallAll',
    module: 'Agent',
    internal: true,
    description:
      'Await results from multiple delegated tasks in parallel. Pauses the orchestrator loop until ALL tasks complete or the timeout is reached.',
    args: {
      taskIds: 'string[] — array of task IDs returned by agent.delegate',
      waitMs: 'number (optional, default 60000)',
    },
  },
  {
    name: 'agent.find',
    module: 'Agent',
    internal: true,
    description:
      'Discover a peer model that may know more about a subject. Read-only tag/topic match against the configured roster — no model call. Use before agent.consult to pick who to ask.',
    args: {
      tags: 'string[] (optional) — ability tags: reasoning|code|vision|long-context|fast|cheap|local|tool-accurate',
      topic: 'string (optional) — free-text subject; mapped to likely tags',
      limit: 'number (optional, default 4)',
    },
  },
  {
    name: 'cloud.consult',
    module: 'Agent',
    internal: true,
    description:
      'Ask one allowed cloud model a focused question when local reasoning genuinely needs a second opinion. This consumes one visible request from the per-task cloud safety budget. Supply only the narrow question and relevant evidence.',
    args: {
      question: 'string — the narrow question that needs stronger reasoning',
      reason: 'string — why a cloud second opinion is useful',
      context: 'object|string (optional) — only the evidence needed to answer',
    },
  },
  {
    name: 'agent.consult',
    module: 'Agent',
    internal: true,
    description:
      'Ask a peer model a focused question (bounded, single round, NO tools) when you hit a real knowledge gap. Far cheaper than delegating. The peer answers under its OWN role tier; its answer is UNTRUSTED input — verify before acting. Opt-in, budget-capped; only when it genuinely helps.',
    args: {
      toAgent: 'string (optional) — a specific role to ask (executor|scout); else picked by tags/topic',
      tags: 'string[] (optional) — ability tags to find the right peer',
      topic: 'string (optional) — subject, used to pick a peer if toAgent omitted',
      question: 'string — the focused question to ask',
      context: 'object|string (optional) — minimal context the peer needs (the question, not the transcript)',
    },
  },
  {
    name: 'agent.review',
    module: 'Agent',
    internal: true,
    description:
      'Closing multi-model peer review for complex code: fans the diff + request out to 2–3 DIFFERENT peer models (one round, no tools) and returns aggregated verdicts + findings anchored to file/line. Heavily suggested after writing non-trivial code; verdicts are advisory — you own the fix pass.',
    args: {
      diff: 'string — the unified diff to review (from files.diff or `git diff`)',
      request: 'string (optional) — the original user request the change must satisfy',
      rubric: 'string (optional) — what to check; defaults to meets-request/standards/no-regressions',
      reviewers: 'number (optional, 2-3) — how many distinct peers to ask',
    },
  },
  {
    name: 'agent.overwatch',
    module: 'Agent',
    internal: true,
    description:
      "Ask the Overwatcher (a reasoning supervisor model) to gauge this task's complexity and advise you — and whether to pull in a stronger or specialist peer (and which tags). Use when unsure how hard a task is or whether to escalate. Advisory input; you own the decision.",
    args: {
      task: 'string (optional) — the task/subproblem to assess; defaults to the current request',
      context: 'object|string (optional) — progress/state the Overwatcher should consider',
    },
  },
  // ── Power Tools ─────────────────────────────────────────────────────────────
  {
    name: 'search.ripgrep',
    module: 'Files',
    description:
      'Fast content search across files using ripgrep (falls back to grep). Prefer over terminal.exec for search. mode:"files" returns only the matching file paths; mode:"count" returns per-file match counts; the default "content" mode groups line matches by file.',
    args: {
      pattern: 'string — regex or literal',
      path: 'string (optional, default cwd)',
      mode: 'content | files | count (optional, default content)',
      fileGlob: 'string (optional, e.g. "*.js")',
      globs: 'string[] (optional — include/exclude globs, e.g. ["!*.test.ts"])',
      type: 'string (optional — ripgrep file type, e.g. "ts", "py")',
      ignoreCase: 'boolean (optional)',
      fixedStrings: 'boolean (optional — treat pattern as literal)',
      wordBoundary: 'boolean (optional — whole-word matches only)',
      multiline: 'boolean (optional — let the pattern span lines)',
      hidden: 'boolean (optional — include dotfiles and dot-directories)',
      searchIgnored: 'boolean (optional — also scan .gitignored/ignored files)',
      contextLines: 'number (optional, lines before/after match, max 10)',
      maxResults: 'number (optional, default 40)',
    },
  },
  {
    name: 'files.stat',
    module: 'Files',
    description:
      'Get metadata for one or more files without reading content. Use to survey a batch before deciding which to read.',
    args: { path: 'string | string[] — single path or batch of up to 20' },
  },
  // ── Memory & Context Tools ──────────────────────────────────────────────────
  {
    name: 'memory.query',
    module: 'Notes',
    description: 'Semantic + keyword search over notes. Returns ranked matches instead of a full list dump.',
    args: {
      query: 'string',
      category: 'continuity | knowledge | error-log | user-preference | project-context | delegation-log (optional)',
      limit: 'number (optional, default 5)',
    },
  },
  {
    name: 'chat.remember',
    module: 'System',
    internal: true,
    description:
      "Update THIS chat's encrypted durable memory — the original goal, evolving goals, and how they connect. Keep it current on multi-step or ongoing work so you never lose the thread. Replaces the stored value by default; mode:'append' adds a line.",
    args: {
      content: 'string (the full chat memory, or the line to append)',
      mode: 'replace | append (optional, default replace)',
    },
  },
  {
    name: 'chat.recall',
    module: 'System',
    internal: true,
    description:
      "Pull earlier context for THIS chat ON DEMAND — call ONLY when the current request relates to prior work here. scope:'compacted' = the rolling summary (default); 'full' = the recent raw transcript. Skip it for a fresh, unrelated request.",
    args: { scope: 'compacted | full (optional, default compacted)' },
  },
  {
    name: 'context.summarize',
    module: 'System',
    internal: true,
    description:
      'Compress accumulated step history and tool results into a dense summary to reclaim context window budget.',
    args: {
      focus: 'string (optional — what to preserve in the summary)',
      maxChars: 'number (optional)',
    },
  },
  // ── Extended Power Tools ────────────────────────────────────────────────────
  {
    name: 'search.find',
    module: 'Files',
    description: 'Structured find wrapper — locate files by name/type/size/date without raw shell syntax.',
    args: {
      path: 'string',
      name: 'string (optional, glob e.g. "*.config.js")',
      type: 'f | d | l (optional — file, dir, symlink)',
      maxDepth: 'number (optional, default 6)',
      newerThan: 'string (optional, ISO date — files modified after)',
      olderThan: 'string (optional, ISO date)',
      minSizeKb: 'number (optional)',
      maxSizeKb: 'number (optional)',
      exclude: 'string[] (optional, glob patterns)',
      maxResults: 'number (optional, default 40)',
    },
  },
  {
    name: 'search.fd',
    module: 'Files',
    description: 'Fast modern find alternative (fd-find). Falls back to search.find if fd not installed.',
    args: {
      pattern: 'string (regex)',
      path: 'string (optional)',
      extension: 'string (optional, e.g. "ts")',
      type: 'f | d | l | x (optional)',
      hidden: 'boolean (optional)',
      maxDepth: 'number (optional)',
      exclude: 'string[] (optional)',
      maxResults: 'number (optional)',
    },
  },
  {
    name: 'search.locate',
    module: 'Files',
    description: 'Fastest filename lookup via system locate database. Reports database age.',
    args: {
      pattern: 'string',
      limit: 'number (optional, default 20)',
      caseSensitive: 'boolean (optional)',
    },
  },
  {
    name: 'files.diff',
    module: 'Files',
    description:
      'Return an accurate unified diff (LCS-based) between current file content and proposed new content. Use to preview a full rewrite before files.write.',
    args: {
      path: 'string',
      newContent: 'string',
      contextLines: 'number (optional, default 3)',
    },
  },
  {
    name: 'files.patch',
    module: 'Files',
    description:
      'Apply a unified diff/patch to a file atomically. Works for true diffs, but for most edits prefer files.edit (exact string replace) — it is far more reliable.',
    args: {
      path: 'string',
      patch: 'string',
      dryRun: 'boolean (optional)',
    },
  },
  {
    name: 'files.edit',
    module: 'Files',
    description:
      'Edit a file by exact string replacement — the precise, reliable way to change code. Supply oldText copied verbatim from files.read (including indentation) and newText; oldText must match exactly once unless replaceAll is set. Auto-saves the file and returns a diff. Prefer this over files.patch for surgical edits.',
    args: {
      path: 'string',
      oldText: 'string — exact existing text to replace (unique unless replaceAll)',
      newText: 'string — replacement text',
      replaceAll: 'boolean (optional — replace every occurrence)',
    },
  },
  {
    name: 'web.fetch',
    module: 'Search',
    description:
      'Fetch a specific URL directly using Readability for clean extraction. Use when you know the URL — faster than search.web.',
    args: {
      url: 'string',
      extract: 'text | code | links | all (optional, default text)',
      maxChars: 'number (optional)',
    },
  },
  {
    name: 'sources.lookup',
    module: 'Search',
    description:
      'Resolve a topic to curated trusted reference sources and ready-to-use search/API URLs before web research.',
    args: {
      topic: 'string',
      kind: 'string (optional: encyclopedia | scholarly | code | docs | package | reference | gov | data | books | news)',
      limit: 'number (optional, default 8)',
    },
  },
  {
    name: 'env.inspect',
    module: 'System',
    description:
      'System environment snapshot. Running processes, ports, env vars (filtered), installed tools. Replaces multiple terminal.exec orientation calls.',
    args: {
      include: 'string[] (optional) — e.g. ["processes","ports","tools","env"]',
    },
  },
  {
    name: 'skills.search',
    module: 'System',
    internal: true,
    description: 'Fuzzy search over all skills in the library. Use to discover and load relevant skills mid-run.',
    args: {
      query: 'string',
      agentTarget: 'claude | deepseek | local | all (optional)',
      type: 'procedure | domain | guard | reflex | delegate (optional)',
    },
  },
  {
    name: 'clipboard.read',
    module: 'System',
    description: 'Read current clipboard content.',
    args: {},
  },
  {
    name: 'clipboard.write',
    module: 'System',
    description: 'Write text to clipboard.',
    args: { content: 'string' },
  },
  {
    name: 'terminal.pipe',
    module: 'Terminal',
    description:
      'Execute a validated pipeline of commands assembled safely from an array. Prevents pipe-to-shell attacks.',
    args: {
      commands: 'string[] — array of commands to pipe together',
      cwd: 'string (optional)',
      timeout: 'number (optional, ms)',
    },
  },
  {
    name: 'terminal.script',
    module: 'Terminal',
    description:
      'Run a named built-in IRIS script from the script library. Safer and more efficient than constructing raw shell commands.',
    args: {
      script:
        'orbit-explore-project | orbit-explore-git | orbit-audit-secrets | orbit-audit-size | orbit-find-config | orbit-find-todos | orbit-snapshot-workspace | orbit-explore-deps',
      args: 'object (optional — named parameters passed to the script)',
      cwd: 'string (optional)',
    },
  },
]

const TOOL_BY_NAME_LOWER = TOOL_DEFINITIONS.reduce<Record<string, string>>((map, tool) => {
  map[String(tool.name).toLowerCase()] = tool.name
  return map
}, {})

export const TOOL_BY_NAME = TOOL_DEFINITIONS.reduce<Record<string, ToolDefinition>>((map, tool) => {
  map[tool.name] = tool
  return map
}, {})

const TOOL_ALIAS_MAP: Record<string, string> = {
  read_file: 'files.read',
  file_read: 'files.read',
  files_read: 'files.read',
  open_file: 'files.read',
  cat_file: 'files.read',
  read_more: 'files.read',
  continue_read: 'files.read',
  read_next: 'files.read',
  read_next_chunk: 'files.read',
  read_chunk: 'files.read',
  read_range: 'files.read',
  read_lines: 'files.read',
  list_files: 'files.list',
  list_file: 'files.list',
  list_dir: 'files.list',
  list_directory: 'files.list',
  read_dir: 'files.list',
  read_directory: 'files.list',
  files_list: 'files.list',
  find_file: 'files.find',
  find_files: 'files.find',
  search_files: 'files.find',
  find_in_files: 'files.find',
  grep_files: 'files.find',
  regex_find: 'files.find',
  locate_file: 'files.find',
  locate_files: 'files.find',
  file_search: 'files.find',
  rag_search: 'rag.retrieve',
  semantic_search: 'rag.retrieve',
  semantic_file_search: 'rag.retrieve',
  retrieve_context: 'rag.retrieve',
  ask_cloud: 'cloud.consult',
  cloud_help: 'cloud.consult',
  cloud_consult: 'cloud.consult',
  write_file: 'files.write',
  file_write: 'files.write',
  files_write: 'files.write',
  create_file: 'files.write',
  save_file: 'files.write',
  edit_file: 'files.edit',
  file_edit: 'files.edit',
  str_replace: 'files.edit',
  string_replace: 'files.edit',
  replace_in_file: 'files.edit',
  run_command: 'terminal.exec',
  run_terminal: 'terminal.exec',
  terminal_run: 'terminal.exec',
  execute_command: 'terminal.exec',
  execute_terminal: 'terminal.exec',
  shell_exec: 'terminal.exec',
  search_web: 'search.web',
  web_search: 'search.web',
  run_search: 'search.web',
  launch_app: 'launch.run',
  run_app: 'launch.run',
  run_launch: 'launch.run',
  get_capabilities: 'screen.capabilities',
  list_resources: 'resources.list',
  available_tools: 'resources.list',
  capabilities_list: 'resources.list',
  resources: 'resources.list',
  list_skills: 'skills.list',
  skills_list: 'skills.list',
  request_approval: 'approval.request',
  approval_request: 'approval.request',
  ask_permission: 'approval.request',
}

const TOOL_TIMEOUT_MS_BY_NAME: Record<string, number> = {
  'terminal.exec': 90000,
  'launch.run': 60000,
  'search.web': 75000,
  'files.list': 30000,
  'files.find': 30000,
  'rag.retrieve': 90000,
  'cloud.consult': 120000,
  'files.read': 30000,
  'files.write': 30000,
  'notes.list': 15000,
  'notes.add': 15000,
  'notes.update': 15000,
  'notes.delete': 15000,
  'skills.list': 20000,
  'resources.list': 10000,
  'approval.request': 30000,
  'user.ask': 660000,
  'artifact.create': 30000,
  'system.stats': 15000,
  'system.processes': 15000,
}

const RISKY_TOOL_NAMES = new Set<string>([
  'files.write',
  'files.patch',
  'files.edit',
  'terminal.exec',
  'launch.run',
  'notes.delete',
])

const TOOL_PERMISSION_KEYS: Record<string, string> = {
  'files.list': 'file_read',
  'files.find': 'file_read',
  'rag.retrieve': 'file_read',
  'files.read': 'file_read',
  'files.diff': 'file_read',
  'files.write': 'file_write',
  'files.patch': 'file_write',
  'files.edit': 'file_write',
  'terminal.exec': 'terminal_exec',
  'launch.run': 'terminal_exec',
}

const LEAN_TOOL_NAMES = new Set<string>([
  'terminal.exec',
  'files.read',
  'rag.retrieve',
  'files.write',
  'files.patch',
  'files.edit',
  'search.web',
  'web.fetch',
  'launch.run',
  'launcher.list',
  'clipboard.read',
  'clipboard.write',
  'screen.capabilities',
  'notes.list',
  'notes.add',
  'notes.update',
  'notes.delete',
  'memory.query',
  'chat.remember',
  'chat.recall',
  'skills.load',
  'skills.offload',
  'skills.search',
  'agent.delegate',
  'agent.recall',
  'agent.recallAll',
  'agent.status',
  'agent.roster',
  'agent.broadcast',
  'agent.verify',
  'agent.available',
  'agent.find',
  'cloud.consult',
  'agent.consult',
  'agent.review',
  'agent.overwatch',
  'agent.readOutput',
  'approval.request',
  'user.ask',
  'artifact.create',
  'system.stats',
  'system.processes',
  'sources.lookup',
  'todo.update',
  'trace.log',
  'resources.list',
  'context.summarize',
])

const SUB_AGENT_MIN_TIER: Record<string, number> = {
  'notes.list': PERMISSION_TIER.LOCKED,
  'skills.list': PERMISSION_TIER.LOCKED,
  'memory.query': PERMISSION_TIER.LOCKED,
  'files.list': PERMISSION_TIER.READ_ONLY,
  'files.find': PERMISSION_TIER.READ_ONLY,
  'rag.retrieve': PERMISSION_TIER.READ_ONLY,
  'files.read': PERMISSION_TIER.READ_ONLY,
  'files.diff': PERMISSION_TIER.READ_ONLY,
  'search.web': PERMISSION_TIER.READ_ONLY,
  'web.fetch': PERMISSION_TIER.READ_ONLY,
  'sources.lookup': PERMISSION_TIER.LOCKED,
  'files.write': PERMISSION_TIER.STANDARD,
  'files.patch': PERMISSION_TIER.STANDARD,
  'files.edit': PERMISSION_TIER.STANDARD,
  'terminal.exec': PERMISSION_TIER.STANDARD,
  'launch.run': PERMISSION_TIER.STANDARD,
  // Skill tools are advisory (no file/terminal) — available to EVERY tier so even a read-only
  // scout can discover and load a skill.
  'skills.search': PERMISSION_TIER.LOCKED,
  'skills.load': PERMISSION_TIER.LOCKED,
  'skills.offload': PERMISSION_TIER.LOCKED,
  // Peer tools are advisory (no file/terminal/exec) — available to EVERY tier so any agent,
  // including a read-only scout, can ask for help / a second opinion.
  'agent.find': PERMISSION_TIER.LOCKED,
  'agent.consult': PERMISSION_TIER.LOCKED,
  'agent.review': PERMISSION_TIER.LOCKED,
}

const SUB_AGENT_NATIVE_DEFINITIONS: Record<string, SubAgentToolDefinition> = {
  'files.list': {
    name: 'files.list',
    description: 'List files and directories under a path.',
    args: { path: 'string', depth: 'number (1-6, optional)' },
  },
  'files.find': {
    name: 'files.find',
    description: 'Find files or matching text (case-insensitive, optional regex).',
    args: {
      path: 'string',
      query: 'string',
      mode: 'name|content|auto (optional)',
      useRegex: 'boolean (optional)',
      ignoreCase: 'boolean (optional)',
      maxResults: 'number (optional)',
    },
  },
  'rag.retrieve': {
    name: 'rag.retrieve',
    description: 'Retrieve top filesystem passages with semantic search and temporary query-time chunking.',
    args: {
      query: 'string',
      maxFiles: 'number (optional)',
      maxPassages: 'number (optional)',
    },
  },
  'files.read': {
    name: 'files.read',
    description: 'Read a text file.',
    args: {
      path: 'string',
      startLine: 'number (optional)',
      lineCount: 'number (optional)',
      maxChars: 'number (optional)',
    },
  },
  'files.write': {
    name: 'files.write',
    description: 'Write text to a file path.',
    args: {
      path: 'string',
      content: 'string',
      mode: 'create | append (optional)',
    },
  },
  'files.diff': {
    name: 'files.diff',
    description:
      'Return a unified diff between current file content and proposed new content. Use before files.write/patch for surgical edits.',
    args: {
      path: 'string',
      newContent: 'string',
      contextLines: 'number (optional, default 3)',
    },
  },
  'files.patch': {
    name: 'files.patch',
    description:
      'Apply a unified diff/patch to a file atomically. For most edits prefer files.edit (exact string replace).',
    args: {
      path: 'string',
      patch: 'string',
      dryRun: 'boolean (optional)',
    },
  },
  'files.edit': {
    name: 'files.edit',
    description:
      'Edit a file by exact string replacement. Supply oldText (verbatim, unique unless replaceAll) and newText; auto-saves and returns a diff. Preferred over files.patch for surgical edits.',
    args: {
      path: 'string',
      oldText: 'string — exact existing text to replace',
      newText: 'string — replacement text',
      replaceAll: 'boolean (optional)',
    },
  },
  'terminal.exec': {
    name: 'terminal.exec',
    description: 'Run one terminal command.',
    args: { command: 'string', cwd: 'string (optional)' },
  },
  'launch.run': {
    name: 'launch.run',
    description:
      'Launch a local app/command. Prefer name: pass a launcher menu entry name and IRIS resolves the command; or pass a raw command.',
    args: {
      name: 'string (a launcher menu entry name — preferred)',
      command: 'string (raw command, when not launching a known menu entry)',
      category: 'command|app|script|url',
      cwd: 'string (optional)',
    },
  },
  'search.web': {
    name: 'search.web',
    description: 'Research-style web summary query.',
    args: { query: 'string', maxResults: 'number (optional)' },
  },
  'web.fetch': {
    name: 'web.fetch',
    description:
      'Fetch a specific URL directly with clean extraction. Use when you know the URL — faster than search.web.',
    args: {
      url: 'string',
      extract: 'text | code | links | all (optional, default text)',
      maxChars: 'number (optional)',
    },
  },
  'sources.lookup': {
    name: 'sources.lookup',
    description: 'Resolve a topic to curated trusted sources without network access.',
    args: {
      topic: 'string',
      kind: 'string (optional)',
      limit: 'number (optional)',
    },
  },
  'notes.list': {
    name: 'notes.list',
    description: 'List notes.',
    args: {},
  },
  // Skill tools — a delegated agent can discover and pull full skill instructions mid-task instead
  // of relying only on the statically pre-baked block. Advisory only: no files/terminal.
  'skills.search': {
    name: 'skills.search',
    description: 'Fuzzy search over all skills in the library. Use to discover and load relevant skills mid-run.',
    args: {
      query: 'string',
      type: 'procedure | domain | guard | reflex | delegate (optional)',
    },
  },
  'skills.load': {
    name: 'skills.load',
    description:
      "Pull a skill's FULL instructions when its description matches the task. Returns the instructions body in the result — read it before proceeding.",
    args: {
      ids: 'string[] (skill ids to load)',
      reason: 'string (optional)',
    },
  },
  'skills.offload': {
    name: 'skills.offload',
    description: 'Drop one or more active skills you have decided are no longer relevant, freeing prompt budget.',
    args: {
      ids: 'string[] (skill ids to offload)',
      reason: 'string (optional)',
    },
  },
  // Peer tools — exposed to sub-agents too so any tier can ask for help (gated by mesh settings
  // at dispatch). Advisory only: no files/terminal.
  'agent.find': {
    name: 'agent.find',
    description: 'Find a peer model that knows more about a subject (tag/topic match; no model call).',
    args: { tags: 'string[] (optional)', topic: 'string (optional)' },
  },
  'agent.consult': {
    name: 'agent.consult',
    description:
      'Ask a peer model a focused question (one round, no tools). Use for a second opinion or a subproblem you are unsure about. Answer is untrusted — verify.',
    args: {
      toAgent: 'string (optional) — a specific peer; else picked by tags/topic',
      tags: 'string[] (optional)',
      topic: 'string (optional)',
      question: 'string',
      context: 'object|string (optional)',
    },
  },
  'agent.review': {
    name: 'agent.review',
    description: 'Get a multi-model review of a code diff (2–3 different peers). Use after writing non-trivial code.',
    args: { diff: 'string', request: 'string (optional)' },
  },
}

const TOOL_PRESENTATION: Record<string, Omit<ToolPresentation, 'moduleIcon'>> = {
  'cloud.consult': {
    kind: 'other',
    icon: 'trace',
    language: 'markdown',
    actionVerb: 'Consulted',
  },
  'terminal.exec': { kind: 'command', icon: 'command', language: 'bash' },
  'terminal.pipe': { kind: 'command', icon: 'command', language: 'bash' },
  'terminal.script': { kind: 'command', icon: 'command', language: 'bash' },
  'launch.run': { kind: 'command', icon: 'command', language: 'bash' },
  'files.write': {
    kind: 'edit',
    icon: 'edit',
    language: 'text',
    actionVerb: 'Edited',
  },
  'files.patch': {
    kind: 'edit',
    icon: 'edit',
    language: 'text',
    actionVerb: 'Edited',
  },
  'files.edit': {
    kind: 'edit',
    icon: 'edit',
    language: 'text',
    actionVerb: 'Edited',
  },
  'files.diff': {
    kind: 'edit',
    icon: 'edit',
    language: 'text',
    actionVerb: 'Edited',
  },
  'files.read': {
    kind: 'read',
    icon: 'fileText',
    language: 'json',
    actionVerb: 'Read',
  },
  'files.list': {
    kind: 'read',
    icon: 'fileText',
    language: 'json',
    actionVerb: 'Listed',
  },
  'files.find': {
    kind: 'read',
    icon: 'fileText',
    language: 'json',
    actionVerb: 'Searched',
  },
  'rag.retrieve': {
    kind: 'search',
    icon: 'search',
    language: 'json',
    actionVerb: 'Retrieved',
  },
  'files.stat': {
    kind: 'read',
    icon: 'fileText',
    language: 'json',
    actionVerb: 'Listed',
  },
}

const MODULE_PRESENTATION: Record<string, { icon: string }> = {
  files: { icon: 'files' },
  terminal: { icon: 'terminal' },
  notes: { icon: 'notes' },
  screen: { icon: 'screen' },
  search: { icon: 'search' },
  launch: { icon: 'launch' },
  todo: { icon: 'todo' },
  trace: { icon: 'trace' },
}

export const TOOL_CATALOG = TOOL_DEFINITIONS.reduce<Record<string, ToolCatalogEntry>>((map, definition) => {
  const name = definition.name
  map[name] = {
    ...definition,
    aliases: Object.keys(TOOL_ALIAS_MAP).filter((alias) => TOOL_ALIAS_MAP[alias] === name),
    timeoutMs: getToolTimeoutMs(name),
    risky: RISKY_TOOL_NAMES.has(name),
    permissionKey: TOOL_PERMISSION_KEYS[name] || null,
    lean: LEAN_TOOL_NAMES.has(name),
    subAgentMinTier: SUB_AGENT_MIN_TIER[name] ?? null,
    subAgentNative: Boolean(SUB_AGENT_NATIVE_DEFINITIONS[name]),
    presentation: getToolPresentation(name),
  }
  return map
}, {})

// Returns tool definitions without requiring callers to know where or how it is stored.
export function getToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.slice()
}

// Returns tool catalog entry without requiring callers to know where or how it is stored.
export function getToolCatalogEntry(toolName: unknown): ToolCatalogEntry | null {
  return TOOL_CATALOG[String(toolName || '').trim()] || null
}

// Converts tool alias key into the canonical representation expected by later code.
export function normalizeToolAliasKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Selects or derives catalog tool request from the available settings, input, and runtime
 * context.
 */

export function resolveCatalogToolRequest(value: unknown): CatalogToolResolution {
  const requested = String(value || '').trim()
  if (!requested) return { requested, resolved: '', matchedBy: 'none' }

  if (TOOL_BY_NAME[requested]) {
    return { requested, resolved: requested, matchedBy: 'exact' }
  }

  const caseInsensitive = TOOL_BY_NAME_LOWER[requested.toLowerCase()]
  if (caseInsensitive) {
    return {
      requested,
      resolved: caseInsensitive,
      matchedBy: 'case_insensitive',
    }
  }

  const alias = TOOL_ALIAS_MAP[normalizeToolAliasKey(requested)]
  if (alias && TOOL_BY_NAME[alias]) {
    return { requested, resolved: alias, matchedBy: 'alias' }
  }

  return { requested, resolved: '', matchedBy: 'none' }
}

// Returns tool timeout ms without requiring callers to know where or how it is stored.
export function getToolTimeoutMs(toolName: unknown): number {
  const key = String(toolName || '').trim()
  if (!key) return DEFAULT_TOOL_TIMEOUT_MS

  const exact = TOOL_TIMEOUT_MS_BY_NAME[key]
  if (Number.isFinite(Number(exact)) && Number(exact) > 0) return Number(exact)
  if (key.startsWith('files.')) return 30000
  if (key.startsWith('notes.')) return 15000
  if (key.startsWith('skills.')) return 20000
  return DEFAULT_TOOL_TIMEOUT_MS
}

// Returns tool permission key without requiring callers to know where or how it is stored.
export function getToolPermissionKey(toolName: unknown): string | null {
  return TOOL_PERMISSION_KEYS[String(toolName || '').trim()] || null
}

// Evaluates whether is tool risky for the supplied value and current runtime state.
export function isToolRisky(toolName: unknown): boolean {
  return RISKY_TOOL_NAMES.has(String(toolName || '').trim())
}

// Evaluates whether is lean tool for the supplied value and current runtime state.
export function isLeanTool(toolName: unknown): boolean {
  return LEAN_TOOL_NAMES.has(String(toolName || '').trim())
}

// Returns sub agent min tier without requiring callers to know where or how it is stored.
export function getSubAgentMinTier(toolName: unknown, fallback: number = PERMISSION_TIER.STANDARD): number {
  const value = SUB_AGENT_MIN_TIER[String(toolName || '').trim()]
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

// Returns sub agent native tool definitions without requiring callers to know where or how it is
// stored.
export function getSubAgentNativeToolDefinitions(
  availableNames: readonly unknown[],
  forbiddenNames: readonly unknown[] = [],
): SubAgentToolDefinition[] {
  const available = Array.isArray(availableNames) ? availableNames : []
  const forbidden = new Set<string>(
    (Array.isArray(forbiddenNames) ? forbiddenNames : []).map((name) => String(name || '').trim()),
  )
  return available
    .map((name) => SUB_AGENT_NATIVE_DEFINITIONS[String(name || '').trim()])
    .filter(
      (definition): definition is SubAgentToolDefinition => Boolean(definition) && !forbidden.has(definition.name),
    )
}

// Every tool a delegated sub-agent can natively call. Used to default the advertised tool set when
// a delegation leaves stp.tools.available empty (empty whitelist = all permitted, subject to tier).
export function listSubAgentNativeToolNames(): string[] {
  return Object.keys(SUB_AGENT_NATIVE_DEFINITIONS)
}

// Returns tool presentation without requiring callers to know where or how it is stored.
export function getToolPresentation(toolName: unknown): ToolPresentation {
  const name = String(toolName || '').trim()
  const moduleName = name.split('.')[0].toLowerCase()
  const modulePresentation = MODULE_PRESENTATION[moduleName] || {
    icon: 'tool',
  }
  const exact = TOOL_PRESENTATION[name]
  if (exact) return { moduleIcon: modulePresentation.icon, ...exact }

  if (name === 'power.script' || name.startsWith('terminal.')) {
    return {
      kind: 'command',
      icon: 'command',
      moduleIcon: 'terminal',
      language: 'bash',
    }
  }
  if (name.startsWith('search.') || name === 'web.fetch') {
    return {
      kind: 'search',
      icon: 'search',
      moduleIcon: modulePresentation.icon,
      language: 'json',
    }
  }

  return {
    kind: 'other',
    icon: modulePresentation.icon,
    moduleIcon: modulePresentation.icon,
    language: 'json',
  }
}
