# Code Editor — AI Development Guide

**This is the single authoritative architecture and repository guide. Current source code wins if this document temporarily lags a just-landed change.**

Code Editor is a coding IDE with a long-running, local, agentic software-engineering runtime. Do not reintroduce historical IRIS general-assistant architecture merely for compatibility.

## Repository rules

- Work on the real repository and commit directly to `main` unless the maintainer explicitly asks for another workflow.
- Fetch current `main` immediately before every GitHub write.
- Every AI-authored commit must contain exactly:

  `Co-authored-by: ChatGPT <noreply@openai.com>`

- Do not create `.github/workflows/`. Full verification is local.
- Final full verification command:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

- Do not claim verification passed unless it was actually run.
- Preserve user data, IDE correctness, and security boundaries while simplifying implementation code.

## Product boundary

The retained product is:

```text
Code Editor
├── IDE
│   ├── workspace / file tree
│   ├── editor tabs and live buffers
│   ├── file operations
│   ├── code search and navigation
│   ├── diagnostics / Problems
│   ├── terminal
│   ├── source control
│   └── browser/runtime inspection
└── local coding-agent runtime
    ├── native Qwen tool loop
    ├── initializer / planner
    ├── orchestrator
    ├── scouts
    ├── executors
    ├── independent evaluator
    ├── durable project ledger
    ├── dependency scheduler
    ├── isolated worker worktrees
    ├── managed project processes
    ├── objective verification
    ├── checkpoints / crash recovery
    └── progress watchdog / fresh replanning
```

It is not a general desktop assistant, semantic media browser, document assistant, voice assistant, application launcher, or machine-monitoring product.

## Native local-model loop

The coding runtime is local-model-first. Qwen3/Coder-class models served by a local OpenAI-compatible endpoint are the intended primary model family.

Normal control flow:

```text
user/project state
→ local coding model
→ native tool call(s)
→ deterministic runtime executes tools
→ tool results return to the same model context
→ repeat
```

Do not add a second model-driven tool controller whose routine job is to translate prose into `{tool,args}`. Repair tool schemas, parser boundaries, or deterministic runtime behavior instead.

The harness—not the model—owns containment, permissions, durable state, scheduling, Git/worktrees, managed processes, verification, crash recovery, and stall policy.

## Contexts are bounded; projects are not

A productive project may run for hours. An individual language-model context must not.

The native coding loop currently defaults to a context handoff boundary of approximately **18 minutes or 120 executed tool actions**, with narrower budgets allowed for remediation/specialist work. Reaching the boundary is a resumable handoff, not project failure.

Durable project state, worker checkpoints, and the outer project lifecycle carry unfinished work into fresh contexts. Do not implement project-wide “15 minute” or ordinary step-count termination while durable progress is still being made.

## Agent roles

**Initializer / planner** expands genuinely complex user goals into independently checkable requirements, acceptance criteria, and a dependency-aware work graph. Trivial edits should bypass heavyweight planning.

**Orchestrator** owns the global objective and project ledger. It coordinates work; it should not waste context polling infrastructure state that TypeScript can track deterministically.

**Scout** is read/research-heavy. It locates relevant files, symbols, dependencies, external documentation, and implementation constraints and returns compact evidence.

**Executor** is mutation-heavy. Parallel executor work should use isolated worktrees where Git is available. Partial useful work is checkpointed so a fresh context can resume it.

**Evaluator** is independent and primarily read/verify-oriented. It judges current code against requirements using fresh deterministic evidence. It may identify a material requirement that the initializer missed when that requirement is clearly present in the original user goal.

Role specialization is useful. Model-facing coordination bureaucracy is not.

## Durable project ledger

Conversation history is not the project database. The durable ledger retains:

- original goal;
- requirements and acceptance criteria;
- requirement status and evidence;
- work items and dependency edges;
- architecture decisions;
- blockers and failed approaches;
- evaluator findings;
- worker/task status and workspace IDs;
- managed process state;
- generation-scoped verification records;
- project checkpoints;
- current strategy and progress summary.

The work graph is normalized deterministically. Completed dependencies promote pending work. Missing/failed/blocked/cancelled prerequisites block downstream work explicitly instead of leaving immortal pending tasks. Failed approaches are persisted for replanning.

## Long-running project lifecycle

Automatic workspace projects follow roughly:

```text
initialize / restore ledger
→ normalize work graph
→ dispatch ready specialist work
→ checkpoint worker mutations
→ serialize integration into shared workspace
→ mark requirement implementation progress
→ collect fresh verification evidence
→ independent evaluation
→ create targeted repair work or recover missed requirements
→ evaluate progress
→ fresh-context replan on stalls
→ continue
```

Interrupted `running` tasks are recovered on restart and returned to resumable state unless repeated interruptions require strategy escalation.

A watchdog reacts to durable lack of progress, not mere elapsed time. Strategy change/replanning comes before deep-stall termination.

## Coding tool surface

Keep the model-facing surface narrow and development-specific. Core capabilities include:

- `files.list`, `files.find`, bounded `files.read`;
- `files.write`, `files.edit`, `files.patch`, file stat/diff;
- `terminal.exec`;
- `code.definition`, `code.references` for known symbols;
- editor/workspace diagnostics;
- browser/runtime inspection for web applications;
- web search/fetch for development research;
- narrow `agent.delegate`, `agent.consult`, `agent.review` operations;
- `user.ask` only for genuine unresolved product ambiguity.

The runtime caps ordinary user-question escalation per model context. Do not turn autonomous engineering decisions into an interview loop.

Historical aliases such as generic RAG/semantic repository retrieval should not return as primary coding navigation. Use deterministic file/content search and structural symbol navigation.

## Search boundary

Retain high-signal IDE/code search:

- file-name search;
- text-content search;
- definition/reference navigation.

Generic semantic filesystem embeddings, media embeddings, concept clustering, image similarity, launcher semantic search, and semantic “everything” are outside the target architecture.

## Editor/file authority

Live editor buffers are authoritative. An agent reading an open unsaved file must observe the current editor content rather than stale disk state.

Human/agent revision safety matters: an agent that observed revision N must not silently overwrite revision N+1. Re-read and reconcile first.

Filesystem access remains constrained to the authorized project workspace, including realpath/symlink containment. A `cwd` string by itself is not an authorization boundary.

## Git and parallel execution

Git mutation is harness-owned. Agent shell Git is read-only for status/diff/log/show/rev-parse/ls-files/grep/blame-style inspection. The safety policy blocks model-issued Git mutations.

Parallel executor mutation uses isolated worktrees where available. Workers can execute concurrently, but integration into the shared project workspace is serialized so concurrent cherry-picks cannot race on the index or overlapping files.

Wave/project checkpoints make integrated state recoverable. Preserve the third-party license/attribution files even when historical IRIS documentation is deleted.

## Verification and completion

The model cannot certify correctness by saying “done.”

Completion uses objective evidence:

- requirement-level independent evaluator acceptance;
- fresh build/test/lint/typecheck evidence where applicable;
- runtime/browser evidence where applicable;
- current editor/workspace diagnostics;
- **zero unresolved `severity=error` diagnostics**.

Verification records are tagged with the current project generation. Evidence from an older generation must not validate later mutations.

The evaluator gathers its own evidence rather than trusting executor prose: repository diff/status, diagnostics, inferred project verification commands, managed dev-server state, and browser inspection for UI projects.

Avoid administrative verification ceremony. Real command/tool evidence is preferred over `verification.require` / `verification.record` bookkeeping tools.

## Process ownership

Development servers and other harness-started project processes should have durable lifecycle state: command, cwd, PID/process group, port when known, status, logs, and owner work item.

The model should not repeatedly rediscover its own dev server through generic machine-process scans.

## Safety boundaries

Preserve as applicable:

- authenticated loopback bridge access;
- Electron context isolation/preload boundaries;
- trusted renderer navigation checks;
- encrypted durable project/chat state and protected storage keys;
- workspace containment;
- live-buffer and revision collision checks;
- write leases/worktree isolation;
- Git mutation ownership;
- destructive-command blocking;
- network/package policy;
- bounded subprocess/tool execution and cancellation;
- permission checks at privileged execution boundaries.

Do not retain a large obsolete subsystem merely to preserve one useful helper. Extract or rewrite the helper while keeping the security property.

## Removed architecture should stay removed

Do not restore code solely because old IRIS documentation, migration notes, or tests once referenced it. Historical docs were intentionally removed; Git history is the forensic archive.

Strong non-goals include infrastructure whose only purpose is:

- hosted/cloud coding-provider matrices and API-key failover;
- generic semantic filesystem/media/concept indexing;
- generic document/voice/desktop-assistant experiences;
- launcher and system-monitor product features;
- model-managed chat-memory/notes bureaucracy;
- planner/controller layers that duplicate native model tool calling;
- status-polling tools for state the runtime can track directly.

## Testing and cleanup

Tests should protect current product behavior and architecture invariants, not freeze retired implementation layers. During cleanup:

- delete tests whose only subject no longer exists;
- update tests that assert obsolete tool names, provider matrices, nested controller loops, migration state, or old timing semantics;
- add focused tests for durable ledger normalization, context handoff, verification generation boundaries, worktree integration serialization, requirement recovery, and diagnostics acceptance where practical;
- prefer behavior/invariant tests over snapshots of huge prompts or internal bureaucracy.

The stabilization gate is:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

Fix failures against the current architecture rather than resurrecting obsolete code to satisfy stale tests.
