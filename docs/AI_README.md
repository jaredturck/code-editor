# Code Editor — AI Development README

**This is the authoritative operating guide for changing this repository. Source code wins when an intermediate Phase-A implementation temporarily disagrees with documentation.**

Code Editor is being deliberately conditioned away from the inherited IRIS “general AI desktop” architecture and toward one product: **a fully functioning coding IDE containing a long-running, local, agentic software-engineering runtime**.

The product target and the architecture below are intentional. Do not reintroduce removed IRIS subsystems for compatibility unless the maintainer explicitly asks for them.

---

## 1. Repository rules

- Work on the real repository and commit directly to `main` unless the maintainer explicitly asks for another workflow.
- Fetch current `main` immediately before every write.
- Every AI-authored commit must contain exactly:

  `Co-authored-by: ChatGPT <noreply@openai.com>`

- Do not create `.github/workflows/`. Full verification is local.
- Standard eventual full verification command:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

- During an explicitly requested bulk architecture/Phase-A pass, implementation throughput may take priority over compiling, linting, testing, migration polish, and test repair. Do not falsely claim verification was run.
- Preserve user data and security boundaries while restructuring implementation code.

---

## 2. Product definition

The product is:

```text
Code Editor
├── normal coding IDE
│   ├── workspace/file tree
│   ├── file opening and editing
│   ├── syntax highlighting and editor commands
│   ├── search
│   ├── Problems / diagnostics
│   ├── terminal
│   ├── source control
│   └── browser/runtime inspection where useful for development
└── long-running local coding-agent runtime
    ├── project initializer / planner
    ├── orchestrator
    ├── scouts
    ├── executors
    ├── evaluator
    ├── durable project ledger
    ├── isolated worker workspaces
    ├── managed project processes
    ├── objective verification
    └── progress / stall watchdog
```

It is **not** a general desktop AI assistant, cloud-model client, semantic media browser, document assistant, voice assistant, application launcher, or machine-monitoring product.

The preserved research context for industry agentic coding practice is `docs/AGENTIC_CODING_AGENTS_README.md`.

---

## 3. Local model architecture

The coding runtime is **local-model-only**.

The intended primary model class is Qwen3.6-27B / Qwen3-Coder-class agentic coding models served by a local OpenAI-compatible inference endpoint such as llama.cpp. The exact local model may change, but the runtime architecture must not depend on hosted-provider semantics.

### Native tool calling is the control protocol

Modern Qwen coding models are trained to choose tools. The application should expose real, narrow coding tools and feed their results back into the model conversation.

Preferred loop:

```text
project/user context
→ local Qwen model
→ native tool call(s)
→ runtime executes tools
→ tool results
→ same Qwen thread
→ repeat until final response
```

Do **not** rebuild an extra model-driven controller whose normal job is to translate model prose into `{tool, args}` actions. Do not add a secondary tool-planner model merely because a native tool call can fail occasionally. Repair the tool schema, server parser, or harness boundary first.

The harness still owns:

- tool implementation;
- workspace containment;
- permissions and security;
- persistent project state;
- sub-agent scheduling;
- worktree isolation;
- managed processes;
- verification and diagnostics;
- progress/stall policy;
- crash recovery.

The model owns reasoning and semantic tool selection.

### No cloud-provider architecture

Do not add back:

- OpenAI, Anthropic, Gemini, DeepSeek or OpenRouter hosted adapters;
- API-key routing for coding models;
- cloud request budgets;
- hybrid cloud/local model selection;
- cloud failover pools;
- provider proxy infrastructure whose only purpose is hosted model APIs.

Role specialization may use different **local** models if configured. Role routing and provider routing are different concepts.

---

## 4. Agent architecture

The system should preserve meaningful software-engineering specialization while keeping coordination mechanics in TypeScript rather than forcing the language model to administer a miniature distributed system.

### Core roles

**Initializer / planner**
- Used for genuinely complex project prompts.
- Expands the user request into durable requirements and acceptance criteria.
- Does not need to run for trivial edits.

**Orchestrator**
- Owns the global objective and project ledger.
- Selects the next useful work and delegates when specialization or parallelism helps.
- Should not spend most of its context polling worker status or maintaining bookkeeping.

**Scout**
- Read/research-heavy.
- Locates relevant repository structures, external documentation, defects, dependencies, and implementation constraints.
- Returns compact evidence.

**Executor**
- Mutation-heavy.
- Implements a bounded work item in an isolated workspace when parallelism is used.
- Runs targeted verification associated with its changes.

**Evaluator**
- Checks the actual resulting project against requirements.
- Prefer fresh context and read/test/browser/diagnostic access.
- Should normally be unable to silently rewrite the implementation it is judging.

### Coordination principle

Preserve semantic role specialization. Remove model-facing bureaucracy.

Good:

```text
orchestrator → dispatch executor task
runtime → tracks state/workspace/completion
executor → returns result
runtime → updates durable ledger
```

Bad:

```text
model checks roster
→ searches peer registry
→ checks status
→ checks status again
→ manually recalls output
→ asks a meta-agent whether review is needed
```

Internal queues, leases, health state and scheduling are useful runtime mechanisms. They do not all need corresponding model tools.

---

## 5. Long-running project lifecycle

The project runtime is designed to run for hours when useful.

Do not use normal wall-clock duration or ordinary step count as the reason a productive project must stop.

Model contexts, individual tool calls, subprocesses and delegated tasks may have bounded operational timeouts. The **project lifecycle** should continue across fresh contexts and restarts while progress is being made.

Target lifecycle:

```text
initialize requirements
→ choose work
→ investigate / implement
→ integrate
→ verify
→ evaluate requirements
→ persist project state
→ continue unfinished work
→ finish only when accepted or genuinely blocked
```

### Stop stalls, not elapsed time

Useful progress signals include:

- requirements completed;
- evaluator findings resolved;
- meaningful code generations/mutations;
- changed failure signatures;
- successful new verification evidence;
- narrowed investigation hypotheses;
- completed worker tasks.

Stall signals include:

- identical tool calls against unchanged state;
- repeated verification without a relevant mutation;
- repeatedly failing with the same approach;
- observation loops that do not narrow or advance the active work item;
- repeated worker churn with no integrated result.

A watchdog should first force a strategy change/replan. A deep persistent stall may surface a blocker. It should not impose an arbitrary fifteen-minute project lifetime.

---

## 6. Durable project state

Conversation history is not the project database.

The durable project ledger should retain enough state for a fresh model context or restarted Electron process to continue work without reconstructing the entire project from chat logs.

Important categories include:

- original goal;
- requirements and acceptance criteria;
- requirement status;
- work items and dependencies;
- architectural decisions;
- blockers;
- failed approaches worth not repeating;
- evaluator findings;
- worker/task status;
- isolated workspace/checkpoint information;
- managed process information;
- verification evidence tied to the current code generation;
- project checkpoints.

Prefer explicit structured state over asking the model to maintain chat memory, notes, TODO tools, or status prose manually.

---

## 7. Coding tool surface

The default model-facing surface should look like a software-development environment, not an operating system or general AI assistant.

Core categories:

- list/find project files;
- search text;
- read bounded file ranges;
- write/edit/patch files;
- inspect stat/diff where useful;
- run terminal commands;
- inspect editor diagnostics;
- inspect browser/runtime state for web applications;
- web search/fetch for development research;
- delegate/consult/review through narrow semantic agent operations;
- ask the user only when genuine unresolved product ambiguity requires it.

Code-aware symbol/definition/reference navigation is welcome when implemented cleanly.

### Search

The IDE search concept stays. Keep simple, high-signal coding search:

- file-name search;
- text-content search;
- optionally code-aware symbol/definition/reference navigation.

Generic semantic filesystem embeddings, document semantic search, media embeddings, concept clustering, image similarity and launcher semantic search are outside the target architecture and should remain removed.

### Python and web tools

If a coding model needs Python for calculation, data transformation or a small development task, it can use the terminal/runtime capability or a future narrow Python tool. Native model tool selection does not mean the model weights execute Python or browse the web themselves; the harness executes the selected capability.

---

## 8. IDE invariants that must survive redesign

Do not damage the core editor while simplifying the inherited platform.

Preserve:

- workspace opening and tree navigation;
- file create/read/edit/save/rename/delete behavior expected from a code editor;
- editor tabs and dirty-state handling;
- syntax highlighting/language support;
- editor search/replace;
- diagnostics and Problems display;
- terminal UX;
- source-control UX;
- browser panel/runtime inspection useful for application development;
- settings required to configure the editor and local coding agent.

Special-purpose PDF/audio/video/media/document AI experiences are not core IDE invariants unless the maintainer explicitly says otherwise.

---

## 9. Editor/file authority and concurrency

These correctness boundaries are important even during aggressive redesign.

### Live editor buffers are authoritative

An autonomous agent reading an open file with unsaved edits must observe the live editor content rather than stale disk state.

### Human/agent revision safety

An agent that observed revision N must not silently overwrite a human-created revision N+1. Re-read/reconcile first.

### Workspace containment

Agent filesystem operations remain constrained to the authorized project workspace, including realpath/symlink containment. A `cwd` string is not an authorization boundary.

### Parallel agent isolation

Parallel mutation workers should use isolated worktrees/workspaces where practical. File/write leases remain useful for shared resources and collision protection.

### Harness-owned version control

Do not hand the model unrestricted destructive Git just because Git is useful. The harness may use Git/worktrees/checkpoints to make autonomous changes reversible, isolated and auditable.

---

## 10. Verification and completion

The model does not certify its own correctness merely by saying “done.”

Completion should combine:

- requirement-level evaluator acceptance;
- successful relevant build/test/lint/typecheck/runtime evidence where applicable;
- browser validation where applicable;
- current editor/workspace diagnostics;
- no unresolved `severity=error` editor diagnostics.

A successful render is not enough if editor diagnostics still contain an error.

Verification evidence must belong to the current relevant code generation. Old successful evidence must not validate later mutations.

Avoid verification bureaucracy. The runtime should infer useful evidence from real tool results rather than forcing the model to call administrative `verification.require` / `verification.record` tools.

---

## 11. Runtime processes

Long-running coding needs process ownership.

The harness should know about development servers and other project processes it starts: PID/process group, command, cwd, port when known, health, logs and lifecycle state.

The model should not repeatedly rediscover its own dev server through generic machine-process scans.

General CPU/RAM/GPU/system-monitor product features are not required by the coding-agent objective unless the maintainer explicitly restores them.

---

## 12. Security boundaries to preserve

Aggressive deletion is encouraged when a subsystem is outside the product goal, but do not casually remove security properties used by retained functionality.

Preserve as applicable:

- authenticated loopback bridge access;
- Electron context isolation/preload boundaries;
- trusted renderer navigation checks;
- encrypted durable project/chat state;
- storage-key protection;
- workspace containment;
- file revision collision checks;
- agent write leases/worktree isolation;
- package/network safety policy;
- bounded command execution and cancellation;
- permission checks at privileged execution boundaries.

Cloud API credential storage may be deleted when it has no remaining local-product caller. Storage-key security for encrypted application data is a different concern and should remain.

---

## 13. IRIS inheritance and deletion policy

`docs/iris-reference/` is historical reference material, not product requirements.

The repository is intentionally removing inherited functionality that does not serve a coding IDE or the long-running coding runtime. Do not preserve code merely because it existed in IRIS or has compatibility-looking names.

Strong removal candidates include code whose purpose is exclusively:

- hosted/cloud AI providers;
- API-key model routing;
- semantic filesystem/media/concept indexing;
- generic document AI;
- voice/transcription assistant UX;
- desktop automation/mouse-control assistant behavior;
- general application launcher discovery;
- system-monitor product UI;
- model-managed notes/chat-memory bureaucracy;
- controller/planner layers that duplicate native Qwen tool calling;
- generic desktop-assistant tools unrelated to software development.

When a retained feature imports a large obsolete subsystem for one small useful helper, extract/rewrite the useful helper rather than keeping the whole subsystem alive.

During the current architectural conditioning effort, **deletion and full-system redesign are explicitly allowed**. Preserve core IDE behavior, security boundaries and the target agent architecture—not historical module boundaries.

---

## 14. Architecture bias

Prefer:

```text
native agentic coding model
+ small clear tool schemas
+ deterministic secure runtime
+ durable project state
+ specialized roles
+ independent evaluation
+ isolated workspaces
+ objective verification
```

Avoid:

```text
general model
+ giant system prompt
+ planner model
+ controller model
+ repair model
+ status-polling tools
+ semantic everything
+ cloud-provider matrix
+ model-managed bookkeeping
```

Complexity is justified when it provides a distinct engineering function. Specialization, persistence, isolation and evaluation are useful complexity. Duplicate decision layers and general-assistant feature inheritance are not.

---

## 15. Current development phase

The repository may be in an intentionally rough Phase-A state while the inherited architecture is being replaced. During that phase:

- large coherent rewrites are acceptable;
- transitional dead code may temporarily exist;
- imports/types/tests may temporarily be broken;
- do not waste the architecture phase polishing code scheduled to be replaced;
- commit coherent structural progress frequently.

Phase B is the stabilization pass: compile/type repair, lint, tests, integration behavior, dead-code cleanup, migration cleanup, security review, long-run evaluation and optimization.

Do not confuse temporary Phase-A roughness with permission to reintroduce the old architecture.
