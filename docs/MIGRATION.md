# IRIS to Code Editor Migration

**Status:** Complete for the defined Code Editor product scope  
**Consolidated:** 2026-08-25  
**Repository:** `jaredturck/code-editor`

## Purpose of this document

This is the authoritative migration document for the Code Editor repository.

The project did not begin as a conventional code editor with a small AI assistant added later. The opposite is closer to the truth: the reusable runtime and backend of **IRIS**, a large agentic application, were moved into a comparatively lightweight Code Editor shell and then connected to editor-native surfaces. The result is an editor built around a substantial agent platform rather than a small agent bolted onto an editor.

This document exists so that future developers and AI models can understand that history without having to reconstruct it from a dozen temporary migration plans, patch reviews, checklists and source-to-destination ledgers.

The migration itself is finished. This document therefore focuses on durable information:

- where the code came from;
- what the migration was trying to achieve;
- which IRIS systems were retained and where they live now;
- which IRIS systems were intentionally omitted;
- how the Code Editor integrates with the migrated platform;
- which security and authority boundaries are important to preserve;
- how the migration was staged and validated;
- which historical compatibility code remains in the tree;
- how to distinguish post-migration cleanup from missing migration work.

The old `docs/migration/` files and root `IRIS_MIGRATION.md` were consolidated into this document after migration completion. Their exact historical contents remain available through Git history. In particular, the pre-consolidation tree at commit `159a7bed19f261f3dc3659c045f390ce04f23bcb` contains the former detailed plans, reviews, validation report and the 130 KB one-by-one migration inventory.

The original IRIS reference documentation remains separately preserved under `docs/iris-reference/`. Those files describe the source application and are useful provenance, but they are **not** the Code Editor backlog.

---

## Executive summary

IRIS was a large agentic desktop application with roughly **695 source files** and about **204,764 lines of text** in the source archive used for this migration. It contained a substantial reusable platform: agent execution, provider integrations, encrypted persistence, semantic filesystem indexing, RAG, web research, multi-agent orchestration, automation, audio, vision, local-system services and a privileged Electron/backend boundary. It also contained a large product-specific presentation shell: the Orb/planet UI, panel system, launcher presentation, duplicate file manager/editor UI, multi-window management, authentication/profile presentation and related visual infrastructure.

The migration deliberately separated those two things.

The reusable implementation became part of Code Editor. The old IRIS presentation did not.

The migration followed a **copy-before-rewrite** philosophy. Working IRIS implementation code was moved into clearer Code Editor domains and adapted at integration boundaries rather than reimplemented from scratch. The Code Editor kept its own Explorer, CodeMirror editor, terminal, Search activity, Browser, Problems panel, Settings modal and Chat presentation. IRIS became the platform underneath those surfaces.

The major migrated implementation areas are:

| Current area             | Role                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/platform/`          | Renderer-side agent runtime, providers, model policy, orchestration, skills, persistence clients, RAG and compatibility services                                        |
| `src/platform-features/` | Reusable non-shell feature controllers/hooks extracted from IRIS presentation areas                                                                                     |
| `backend/`               | Privileged local bridge/backend: encrypted persistence, filesystem/semantic services, web, agents, launcher, automation, audio, screen services and security boundaries |
| `electron/platform/`     | Trusted Electron infrastructure: local bridge bootstrap, credential/storage-key handling, security, screen permissions, logging and hidden browser search support       |
| `migrated-tests/iris/`   | Preserved and adapted IRIS runtime/backend tests                                                                                                                        |
| `benchmarks/iris/`       | Preserved IRIS benchmark harness                                                                                                                                        |
| `docs/iris-reference/`   | Historical documentation copied from the source IRIS project                                                                                                            |

The initial exact migration ledger recorded **376 explicit source-to-destination mappings**. **320 source IRIS files were not copied as implementation source**, primarily because they were presentation-only UI, generated output, or configuration replaced by Code Editor equivalents.

The completed product now includes configured provider/model execution, autonomous project runs, editor-aware file editing, terminal/build/test loops, exact and semantic search, RAG, encrypted memory and artifacts, multi-agent coding and review, voice input, screen understanding, permissioned desktop automation, runtime visibility, launcher/tool discovery and managed local-development controls.

There is no known missing migration milestone in the defined scope.

---

## What “migration complete” means

“Complete” does **not** mean every file that existed in IRIS has a visible equivalent in Code Editor. That was never the goal.

Migration completion means:

1. The reusable IRIS runtime/backend implementation required by the Code Editor has been moved into the repository.
2. The planned Code Editor-native product integrations are connected.
3. Security properties that mattered to IRIS were preserved or strengthened at the new boundaries.
4. The important migrated runtime/backend tests and benchmark harness were retained.
5. Presentation-only IRIS code that duplicated the Code Editor or belonged specifically to the old IRIS shell was deliberately omitted.
6. Remaining old controller/compatibility helpers are treated as cleanup candidates only after reachability and dependency-backed verification, not as evidence of unfinished migration.

This distinction matters. A future model should **not** search the repository for an old IRIS panel, fail to find it, and conclude that migration work is unfinished. In many cases the underlying capability is already integrated into a different Code Editor-native UI.

Likewise, a future model should not interpret a historical TODO in `docs/iris-reference/` as a current product requirement.

---

## Migration philosophy and non-negotiable principles

Several principles shaped the migration and remain useful maintenance rules.

### 1. Preserve working IRIS logic before rewriting it

IRIS was already a large working system. The safest migration strategy was to retain proven implementation code wherever practical, then adapt imports, process boundaries and host integration.

Large inherited modules may not look like newly designed Code Editor code. That is not, by itself, a reason to rewrite them. Refactoring should be justified by maintainability, correctness or architecture—not by the fact that code originated in IRIS.

### 2. Keep the Code Editor as the product shell

The existing editor UI remained authoritative. Migration work connected IRIS capabilities to Code Editor-native surfaces rather than transplanting the old IRIS shell.

Examples:

- CodeMirror remains the editor.
- The Code Editor Explorer remains the file tree.
- The existing terminal remains the human terminal UI.
- The Code Editor Settings modal owns AI/provider configuration.
- The Code Editor Chat panel owns the agent conversation presentation.
- Search/RAG is integrated into the Code Editor Search experience.

### 3. Separate human editor authority from agent authority

Human-facing Electron IPC and model-facing agent capabilities are intentionally not the same interface.

A human interacting with the editor uses narrow `window.editor_api` operations exposed by Electron preload. An agent runs through the IRIS session runtime, capability policy and broker, then through editor-aware adapters or the authenticated local bridge.

This separation is one of the most important architectural properties in the migrated application.

### 4. Keep privileged operations behind trusted boundaries

Renderer code does not receive unrestricted Node/Electron authority. Sensitive operations remain in Electron or the privileged backend.

Provider credentials, encryption keys, filesystem operations, command execution, system information, launcher actions, automation and similar capabilities remain behind explicit APIs and policy checks.

### 5. Preserve fail-closed security behavior

Migration was not allowed to silently replace secure IRIS behavior with convenient plaintext or broad renderer access.

Examples include:

- rejecting insecure Linux `basic_text` Electron secret storage;
- requiring authenticated loopback bridge requests;
- keeping provider credentials in Electron `safeStorage`;
- retaining encrypted SQLite persistence;
- enforcing workspace containment for agent file operations;
- separating persistent capability settings from transient model requests;
- retaining operation, network and package-install policy checks.

### 6. Generated output is never migration source

Generated IRIS `server-dist/` / Electron output was not treated as authoritative implementation source. Code Editor regenerates its own `backend-dist/`, `dist-electron/` and renderer build output.

### 7. Unmounted code is not automatically dead code

Some migrated helpers were retained before their original UI equivalents were replaced or because they remain compatibility/reference code. They should be removed only after an import/export reachability audit and a passing dependency-aware verification run.

This rule was especially important during migration and remains useful during cleanup.

---

## High-level architecture after migration

The product has two distinct paths from the renderer into privileged functionality.

```text
Code Editor renderer
│
├── Human editor actions
│   │
│   └── window.editor_api
│       └── Electron preload / narrow IPC
│           ├── workspace + filesystem
│           ├── terminal PTYs
│           ├── Git
│           ├── browser inspection
│           ├── diagnostics
│           └── editor settings/native UI
│
└── Agent Chat / autonomous projects
    │
    └── useAIChat + projectRunController
        └── IRIS runAgentSession
            ├── capability policy / tool catalog / broker
            ├── editor-aware file authority
            ├── exact search / diagnostics / browser adapters
            ├── task write leases + live-file revisions
            └── authenticated 127.0.0.1 bridge
                ├── encrypted persistence
                ├── semantic filesystem / RAG
                ├── web research
                ├── process execution
                ├── agent bus / multi-agent services
                ├── audio / screen / automation
                └── launcher / local-system services
```

The distinction between these paths should be preserved during future development. It would be a regression to make agent tools simply call unrestricted human editor IPC because that would bypass the policy, containment, approval and collision layers built specifically for autonomous execution.

---

## Source-to-destination migration map

The former `MIGRATED_FILES.md` contained hundreds of individual rows. The useful long-term information is the subsystem mapping below.

### Agent/runtime layer

**IRIS source:** primarily `src/lib/agent/**`  
**Current destination:** `src/platform/agent/**`

Important migrated areas include:

- agent identity and role handling;
- task bounds and role bounds;
- canonical tool catalog and schemas;
- capability policy and tool guards;
- native tool loop and structured-controller fallback;
- local planning and TODO handling;
- continuity, context compaction and recovery;
- web/package safety policy;
- model health and routing;
- RAG retrieval;
- sub-agent types and agent bus contracts;
- usage metrics;
- vision and web-research wrappers;
- verification evidence and autonomous acceptance;
- task-scoped write leases.

Representative current files include:

- `src/platform/agent/toolCatalog.ts`
- `src/platform/agent/toolSchema.ts`
- `src/platform/agent/modelRouting.ts`
- `src/platform/agent/ragRetrieval.ts`
- `src/platform/agent/autonomousAcceptance.ts`
- `src/platform/agent/verificationEvidence.ts`
- `src/platform/agent/writeLease.ts`
- `src/platform/agent/runtime/` for the session/broker/finalization runtime modules

The runtime is one of the largest inherited portions of the application. It should be treated as core platform code rather than a Chat UI implementation detail.

### Providers and model execution

**IRIS source:** `src/lib/providers/**` plus model/profile/setup helpers  
**Current destination:** `src/platform/providers/**`, `src/platform/autoSetup/**`, and related `src/platform/*.ts`

Current provider implementations include:

- OpenAI;
- Anthropic;
- Gemini;
- DeepSeek;
- OpenRouter;
- local/Ollama-compatible execution.

The migrated platform also retained provider discovery/configuration, model profiles, model health, routing/failover, local model catalog logic and runtime selection policy.

Key current files include:

- `src/platform/providers/providerRegistry.ts`
- `src/platform/providers/providerConfiguration.ts`
- `src/platform/providers/openaiProvider.ts`
- `src/platform/providers/anthropicProvider.ts`
- `src/platform/providers/geminiProvider.ts`
- `src/platform/providers/deepseekProvider.ts`
- `src/platform/providers/openrouterProvider.ts`
- `src/platform/providers/localProvider.ts`
- `src/platform/providers/localRuntimePolicy.ts`
- `src/platform/autoSetup/modelSelectionRules.ts`

### Agent state, orchestration, skills and durable client services

**IRIS source:** selected `src/lib/*.ts` and related agent modules  
**Current destination:** `src/platform/*.ts`

Examples include:

- `agentRuntime.ts`;
- `agentRunStore.ts`;
- `subAgentRuntime.ts`;
- `orchestrationClient.ts`;
- `chatContextBuilder.ts`;
- `chatSessionStore.ts`;
- `localStorageStore.ts`;
- `secureDurableStore.ts`;
- `projectSkillLoader.ts`;
- skill Markdown/profile/reward helpers;
- settings storage;
- trusted sources;
- key-store and security helpers.

### Privileged server/backend

**IRIS source:** `server/**`  
**Current destination:** `backend/**`

This was intentionally moved as a largely coherent tree because the original backend was already modular and heavily based on relative imports. Preserving its topology reduced migration risk.

Major backend areas include:

- `backend/bridgeServer.ts`;
- `backend/desktopBridge/routes/` for capability HTTP routes;
- `backend/desktopBridge/services/` for filesystem, semantic, launcher, web, audio, screen, automation and persistence services;
- `backend/desktopBridge/shared/` for authorization, containment, process/network policy, workload limits and shared primitives;
- `backend/desktopBridge/storage/` for encrypted SQLite and cryptography;
- `backend/builtinSkills.ts`;
- development skill registration and policy.

The backend is not a generic remote server. It is a local privileged capability service started by the trusted Electron host and bound to loopback.

### Trusted Electron infrastructure

**IRIS source:** selected `electron-src/*.cts`  
**Current destination:** `electron/platform/*.cts`

The migration retained:

- `credentialStore.cts`;
- `storageKeyStore.cts`;
- `linuxPasswordStore.cts`;
- `localBridge.cts`;
- `security.cts`;
- `logger.cts`;
- `screenCapturePermissions.cts`;
- hidden DuckDuckGo browser search support.

The old IRIS window manager, Orb window, window-shape code and duplicate editor IPC were intentionally not carried into the live product.

### Feature-controller code extracted from the old IRIS presentation

**IRIS source:** non-visual logic embedded in feature/panel areas  
**Current destination:** `src/platform-features/**`

Examples include:

- audio transcription hooks/configuration;
- file panel/thumbnail helpers;
- launcher controller helpers;
- Notes/transcription helpers;
- screen-capture strategies;
- search progress/controller helpers;
- skills controller helpers;
- system monitor hooks.

These files are deliberately separate from the Code Editor's visual component hierarchy. Some are actively reused; some remain compatibility/reference candidates.

### Tests and benchmarks

**IRIS source:** original IRIS tests and benchmarks  
**Current destination:** `migrated-tests/iris/` and `benchmarks/iris/`

The original tests were initially preserved outside the normal Code Editor Vitest include path so migration did not pretend old presentation tests remained valid against a different UI. Compatible runtime/backend suites were later adapted and re-enabled through `vitest.iris.config.ts` and `npm run test:iris`.

The benchmark suite remains separate from deterministic verification because some benchmark workloads depend on available local models or retained local benchmark state.

### Historical IRIS documentation

**IRIS source:** architecture/readme/dev/TODO/reference documentation  
**Current destination:** `docs/iris-reference/`

These files are retained to explain the source system. They are historical evidence, not current implementation plans.

---

## Code Editor-specific integration layer

The migration was not only a file move. A comparatively small but important integration layer was created to make the inherited platform behave correctly inside a live editor.

### Agent Chat integration

The Code Editor Chat path moved from a legacy direct Ollama request into the full IRIS session runtime.

Important Code Editor-side files include:

- `src/hooks/useAIChat.ts` — main Chat/project-run integration controller;
- `src/chat/agentChat.ts` — provider/session preparation and Code Editor-specific agent adaptation;
- `src/chat/projectRunController.ts` — durable autonomous project lifecycle;
- `src/chat/editorFileAuthority.ts` — editor-aware file operations;
- `src/platform/desktopBridge.ts` — agent-facing renderer bridge integration.

The existing Chat presentation remained the UI while execution moved underneath it.

### AI Settings integration

The old IRIS Settings panel was not imported. Instead, the Code Editor Settings modal gained an AI surface that configures the migrated provider/runtime stack.

The integrated settings include:

- provider credentials and explicit connection tests;
- model discovery and curation;
- Orchestrator, Executor, Scout and Reviewer assignments;
- per-role capability tiers;
- model routing/failover/health settings;
- autonomous capability permissions;
- web/package guards;
- long-run and context/tool limits;
- skills;
- semantic-index configuration;
- local runtime/model setup.

Credentials are stored through the Electron credential vault rather than in normal editor settings.

### Project-run lifecycle

Autonomous execution is not owned solely by a React component. `projectRunController` maintains a durable run abstraction around the IRIS session runtime.

Persisted project-run state includes bounded representations of:

- run identity and goal;
- lifecycle state;
- provider/model attribution;
- elapsed active time;
- TODO state;
- current activity/summary;
- interruption/error information.

A process does not magically survive an application restart. Persisted active runs are restored as **interrupted** and require explicit user action to resume or cancel.

This was a deliberate safety property introduced during migration.

---

## Editor-aware filesystem authority

This was one of the most important adaptations made when turning a general agent runtime into a coding agent inside a live editor.

A naive implementation would let the agent read and write files directly on disk. That is incorrect when the human has an unsaved CodeMirror buffer.

The migrated Code Editor therefore introduces an editor-aware authority layer.

### Live buffers are authoritative

When an open text file has unsaved edits, the current CodeMirror content is the agent's source of truth. Agent reads should not silently return stale disk content.

### Dirty-buffer writes remain in the editor

If the agent changes an already-dirty open document, the change updates the live editor buffer and intentionally does not pretend the file was saved to disk.

Clean/closed-file mutations can be written to disk and then synchronized back into editor state.

### Workspace containment

Agent file access is constrained to the open workspace rather than inheriting the broader root that the low-level local bridge may be capable of serving.

The trusted workspace path is resolved through Electron with realpath/symlink containment checks. Traversal and symlinks that escape the workspace are rejected.

### Actor revisions protect against human/agent races

The file authority records the revision observed by an agent. If a human edit changes the file after that read, a stale agent cannot blindly overwrite the new content. It must re-read and work from the new revision.

### Task write leases protect against agent/agent races

Parallel delegated tasks use task-scoped write leases. A second agent cannot write a file while another active task owns the lease.

When the owning task settles, its leases are released.

`tests/editorAgentCollision.test.ts` directly covers both important cases:

1. a human edit invalidates the first agent's stale revision;
2. a second agent is blocked until the first task releases its write lease.

This collision work was briefly left marked as a remaining migration item in older documentation even though the implementation and tests already existed. The documentation was corrected before this consolidation.

---

## Terminal, build, test and diagnostics authority

Agent command execution is intentionally separate from the human xterm/node-pty terminal sessions.

When terminal execution is permitted, the agent uses brokered `terminal.exec` through the authenticated IRIS bridge. It does not take control of the user's interactive terminal PTY.

Important properties include:

- command execution remains subject to IRIS safety and approval policy;
- network/package-install restrictions remain enforceable;
- the default working directory is the current workspace;
- command output and exit codes return to the agent for edit → run → inspect → fix loops;
- execution is bounded by timeout/output limits;
- stopping an agent run aborts the active execution path;
- emergency stop revokes privileged execution capabilities for later calls.

Live editor diagnostics are also supplied as bounded evidence so the model can reason about parser/linter/compiler findings without requiring every diagnostic to be rediscovered through shell commands.

Terminal access does not replace file authority, exact search or semantic RAG. Those remain separate paths with their own boundaries.

---

## Git ownership and autonomous changes

Git is treated as an editor/host concern rather than unrestricted model authority.

The Code Editor owns Git mechanics through structured Electron operations. Autonomous agents are not given a generic repository-mutating Git shell capability as part of the normal coding loop.

The project architecture supports preserving pre-existing human work, establishing a baseline around autonomous runs and allowing the host/editor to finalize accepted agent changes. The important design point is that Git lifecycle decisions sit outside the model's direct file/terminal authority.

This complements the editor-aware file boundary: the agent can perform coding work, but repository state management remains a host-controlled responsibility.

---

## Secure storage and persistence

IRIS had strong local persistence/security assumptions. The migration preserved them instead of falling back to browser-local plaintext state.

### Application master key

Electron establishes a random application master key and protects it with operating-system-backed `safeStorage`.

On Linux, Electron's insecure `basic_text` password storage mode is rejected. Startup fails closed rather than quietly storing secrets with a weaker backend.

### Encrypted records

Sensitive persistent records use AES-256-GCM with keys derived through HKDF-SHA256 domain separation. Fresh nonces and authenticated metadata bind ciphertext to its expected domain/record/field context.

Encrypted persisted data includes relevant combinations of:

- conversation/message payloads;
- attachments;
- chat memory and compacted context;
- autonomous run/TODO checkpoints;
- run history;
- skills;
- artifacts/chunks;
- semantic and launcher persistence where appropriate.

Plaintext necessarily exists transiently in trusted process memory when content is being displayed, sent to a configured model or actively processed. The security promise is authenticated encryption at rest and fail-closed persistence—not that live application memory never contains plaintext.

### Targeted hydration

Migration work also reduced unnecessary renderer exposure. Sensitive run/checkpoint history is fetched when needed instead of bulk-decrypting all stored state into Chromium at startup.

---

## Authenticated local bridge

The privileged backend is started by Electron before the renderer is considered ready.

The bridge:

- binds to `127.0.0.1`;
- uses an ephemeral port;
- uses a random per-launch bearer token;
- validates authorization before privileged routes execute;
- receives trusted capability permission state from the Electron boundary.

The port/token are supplied to the renderer for the migrated desktop bridge client, but possession of the bridge route alone is not intended to replace higher-level agent capability/broker checks.

The bridge provides the privileged implementation for persistence, filesystem/semantic services, web research, process execution, launcher/local-system services, audio, screen capture, automation and multi-agent backend operations.

---

## Provider credentials and model configuration

Provider keys are stored through Electron `safeStorage` using explicit provider/key-slot identities.

Migration rules intentionally prevent provider secrets from being copied into:

- Code Editor `settings.json`;
- normal IRIS settings records;
- chat messages;
- activity metadata;
- migration documentation;
- provider validation history.

Provider connection tests are user-initiated so merely opening Settings does not trigger billable network traffic.

Model discovery produces capability metadata. It does not grant machine authority.

The model layer supports multiple cloud providers and local execution, with role assignments and routing separated from security capabilities.

---

## Search, semantic filesystem and RAG

The semantic filesystem is a substantial inherited IRIS subsystem rather than a thin Chat feature.

The migrated stack includes:

### Exact workspace search

The Code Editor retains normal project search for literal/exact matching.

### Text semantic indexing

MiniLM-based embeddings support semantic file/content retrieval with persistent indexing and incremental rescans.

### Documents and archives

The backend includes extraction for documents, PDFs and archives so semantic search can operate on more than raw source files.

### Image and video semantics

CLIP-based media indexing supports images and video-frame semantics, including configurable runtime selection.

### Semantic concepts

IRIS concept math/clustering/pool/worker services were retained for higher-level semantic grouping.

### Workspace-scoped RAG

`rag.retrieve` scopes candidates to the active workspace and then re-reads selected evidence through the editor-aware file authority. This is critical: the semantic index may represent disk state, while the live editor may contain newer unsaved changes.

The final evidence supplied to the model should therefore reflect the live project rather than stale indexed content.

---

## Web research and network policy

IRIS web research was migrated along with its network/security assumptions.

The backend includes:

- web-search/research services;
- DuckDuckGo browser-backed search support;
- web search history;
- source/trusted-source handling;
- redirect/network security controls;
- provider/fallback policy surfaces;
- bounded progress/event behavior.

Web capability is not equivalent to unrestricted shell networking. Shell command networking, package installation and web ingestion have separate policy/approval paths.

---

## Skills, memory and artifacts

The migration retained several ways for agents to carry durable knowledge and reusable behavior.

### Skills

The runtime supports:

- built-in skills;
- encrypted user skills;
- workspace-specific `.iris/skills/*.md` skills;
- optional project skill configuration;
- profiles/rewards/skill loading behavior.

Workspace skills are loaded through active workspace authority rather than arbitrary filesystem paths.

### Memory/context

Chat remember/recall and bounded project working context support long-running continuity without requiring every prior token to remain in the active context window.

### Artifacts

Large durable outputs can be written to encrypted chunked artifact storage rather than flooding the normal Chat transcript. Code Editor can surface those artifacts through its Markdown viewer without requiring plaintext temporary files as the authoritative store.

---

## Multi-agent development and verification

IRIS's multi-agent system was migrated and then adapted to coding work inside the editor.

Current capabilities include:

- configured team activation;
- Orchestrator/Executor/Scout/Reviewer roles;
- task delegation and task bus state;
- asynchronous independent work;
- result/status recall;
- peer consultation;
- independent review;
- bounded per-role capability inheritance;
- task write leases;
- verification evidence;
- autonomous completion acceptance.

### Why write leases matter

Delegation without file ownership control would make parallel coding unsafe. Task-scoped leases prevent two delegated tasks from silently editing the same file at the same time.

### Independent review

Reviewer output can become verification evidence, but inconclusive/stale review is not treated as success. Mutation can stale previous evidence, requiring fresh verification.

### Autonomous acceptance

The runtime's acceptance layer prevents a project run from declaring completion while important work remains unresolved.

Depending on the active contract/evidence requirements, completion can be blocked by conditions such as:

- open TODOs;
- active delegated tasks;
- outstanding write leases;
- failed or stale verification evidence;
- stale/inconclusive review.

The model is allowed to make semantic decisions about what evidence a task requires, while the runtime owns deterministic integrity around evidence freshness, binding and acceptance.

This distinction became an important part of later migration hardening.

---

## Autonomous project runs and long-duration recovery

The migration evolved Chat from a single-turn agent request into a durable project-execution surface.

Key behaviors include:

- automatic and plan-first project modes;
- structured TODOs;
- pause/resume/cancel;
- interruption recovery;
- bounded checkpoints;
- elapsed active-time tracking;
- run/model attribution;
- context compaction and working-context continuity;
- completion reconciliation.

A renderer/application restart never pretends that an in-memory process survived. Persisted active states become interrupted and require explicit user action before execution continues.

Checkpoint payloads are bounded so arbitrary raw model/tool output is not dumped into durable run metadata.

Long-running recovery has dedicated tests designed to exercise multi-hour accounting and pause/resume behavior without waiting for real wall-clock hours.

Scheduled/background execution is **not** part of the completed migration scope. Adding a scheduler or a service that continues projects independently of the foreground application would be new product work.

---

## Audio, vision and desktop automation

IRIS also supplied foundations outside conventional coding tools.

### Audio

The migrated stack includes:

- transcription service support;
- WAV encoding;
- renderer transcription hooks/configuration;
- microphone permission handling;
- Agent Chat voice input.

### Screen understanding

Trusted Electron/backend paths can provide fresh local screen information for vision tasks. This is distinct from old IRIS Vision panel presentation, which was intentionally omitted.

### Desktop automation

Automation authority is treated separately from screen capture. The current design uses permissioned, exact-plan automation with short-lived/single-use approval concepts rather than granting an agent indefinite generic desktop control.

Screen capture and automation therefore remain separate capabilities and permissions.

---

## Runtime visibility and local-system services

The migrated platform exposes operational state useful during long autonomous work, including combinations of:

- CPU and RAM pressure;
- GPU/VRAM state;
- top processes;
- active/queued agents;
- model request and token usage;
- context/cache state;
- model cost/route information;
- effective autonomous authority.

IRIS launcher/local-system services were also retained for application/tool discovery and managed development-environment controls.

The old Launcher panel presentation was not migrated. The underlying service is what mattered.

---

## Security lessons discovered during staged integration

The staged migration was valuable because several subtle authority problems were identified before broader coding permissions were enabled.

### Internal tools are not inherently safe

An early Chat integration allowed a session-specific tool allowlist but initially treated tools marked `internal` differently. That was incorrect: IRIS also used `internal` for capabilities such as host inspection, artifacts and multi-agent/cloud tools.

The session allowlist was changed to apply to **all** catalog tools. “Internal” is a presentation/runtime classification, not an authorization boundary.

### A working directory is not an authorization boundary

Early Chat stages passed `agent_working_dir`, but the low-level bridge had a broader home-directory root. A working directory hint cannot, by itself, prove that file access is confined to a workspace or prevent a symlink from escaping it.

Direct file/search/RAG capability was therefore delayed until the explicit editor-aware workspace authority, realpath and symlink containment layer existed.

This is a critical architectural lesson: never replace workspace authorization with “the command/file operation happens to start in this directory.”

### Persistent permission changes should not be model-owned

A model able to request an approval should not automatically be allowed to convert that into a persistent capability grant.

Persistent machine permissions remain an explicit Settings/trusted-boundary concern. Agent run approvals are narrower execution decisions.

### Crash recovery must not auto-execute

Durable project state should make work resumable, not make the application unexpectedly begin autonomous execution after restart. Active persisted runs are downgraded to interrupted and require explicit resume.

### Hidden reasoning should not become durable application data

Raw model reasoning/thinking streams are deliberately excluded from the visible/persisted Code Editor activity path. Observable phases, tool actions, TODO changes and externally meaningful status are sufficient for the UI and run history.

---

## What was deliberately omitted from IRIS

The old IRIS presentation shell was outside migration scope.

Examples include:

- Floating Orb / particle-planet UI and textures;
- Orb/workspace window composition;
- old panel manager;
- duplicate IRIS File Manager presentation;
- old IRIS Search cards/sidebar;
- Launcher panel/icon presentation;
- standalone Notes panel presentation;
- old Vision panel;
- old Settings panel;
- old Skills and System Monitor panels;
- login/register/password-reset/local-profile presentation;
- old multi-window workspace shell;
- duplicate IRIS editor implementation;
- Orb window/window-shape/window-visibility management.

These omissions are deliberate because Code Editor already had or developed its own product surfaces.

Where an old UI file contained reusable non-visual logic, that logic was migrated separately when useful, often under `src/platform-features/`.

A future cleanup should not reintroduce old IRIS UI merely to make the migration “more complete.” Doing so would conflict with the migration's actual objective.

---

## Retained compatibility and reference code

Some migrated code remains even where there is no dedicated first-class Code Editor UI.

Examples include:

### Notes helpers

- `src/platform/notesStorage.ts`
- `src/platform-features/notes/`

The old standalone Notes panel was omitted. Chat/project memory is already connected. A new human-facing Notes product would be optional new functionality.

### Historical Chat/controller helpers

- `src/platform-features/chat-ui/`
- compatibility paths such as legacy agent/chat helpers

Some normalization/controller behavior is reused; other pieces may now be historical.

### Feature-controller helpers

Potentially unmounted or partially reused helpers exist under areas such as:

- `src/platform-features/files/`
- `src/platform-features/search/`
- `src/platform-features/skills/`
- `src/platform-features/launcher/`
- `src/platform-features/screen-capture/`
- selected audio helpers.

### Legacy compatibility files

The tree also contains explicit legacy/compatibility code such as `src/platform/agentRuntimeLegacy.ts`, along with historical names or controller utilities inherited from IRIS.

These are reasonable cleanup candidates, but deletion should be evidence-based:

1. prove no supported caller reaches the code;
2. check dynamic/indirect registrations rather than only static imports;
3. run the complete dependency-aware verification chain;
4. remove in small changes rather than broad speculative sweeps.

---

## Historical migration sequence

The migration happened in stages. The exact patch IDs are less important now than understanding why authority was introduced gradually.

### Foundation / bulk platform move

The reusable IRIS platform, backend, Electron security infrastructure, tests, benchmarks and reference documentation were copied/adapted into their new domains.

The Code Editor boot sequence was adapted to initialize secure storage and the local bridge before renderer use.

### AI Settings and provider configuration

The Code Editor Settings modal became the configuration surface for IRIS providers, models, role assignments, routing, autonomy policy, limits, skills and semantic indexing.

This established secure credential handling without importing the old IRIS Settings UI.

### P006 — Core Agent Chat

The existing Chat panel switched from the legacy direct Ollama path to `runAgentSession`.

This milestone intentionally began with a narrow research/context capability set. It established:

- configured provider/model/key resolution;
- native tools/controller fallback;
- encrypted chat persistence;
- approvals/questions;
- activity display;
- cancellation/emergency stop;
- attachment and microphone compatibility.

Filesystem, terminal and multi-agent authority were deliberately withheld until stronger editor-specific boundaries existed.

### P007 — Durable autonomous project runs

The Chat runtime gained persistent project-run state, TODOs, pause/resume, interruption handling, elapsed-time accounting and bounded recovery checkpoints.

The migration explicitly preserved the narrower P006 machine-authority boundary during this stage.

### P008 — Editor-aware filesystem

Workspace file tools were connected only after live-buffer authority, path containment, revision checks and safe dirty-buffer behavior were available.

This was the point at which Agent Chat became capable of meaningful direct coding without ignoring the human editor state.

### Terminal/build/test/diagnostics integration

Brokered command execution and live diagnostics completed the edit → execute → inspect → fix loop while keeping human terminal sessions separate.

### Search/RAG and semantic integration

Exact search, semantic indexing, document/media extraction, concepts and workspace RAG were connected to editor-native flows.

### Skills, artifacts, memory and web research

The existing IRIS systems for durable skills, context/memory, large outputs and research were connected to autonomous project work.

### Model/local runtime integration

Provider/model routing, health/failover, local runtime policy, local model setup and hybrid execution were integrated into Code Editor settings/runtime behavior.

### Multi-agent coding and independent review

Delegation, write leases, peer consultation, independent review and autonomous acceptance were connected and hardened.

Collision tests confirmed both human/agent revision protection and agent/agent lease protection.

### Vision, automation and system/runtime visibility

Fresh screen understanding, permissioned automation, system telemetry, launcher/tool discovery and development-environment controls completed the planned non-editor runtime integrations.

### Test/benchmark/recovery restoration

Compatible migrated IRIS runtime tests were re-enabled, the benchmark harness was wired into package scripts, and dedicated long-running recovery/collision regressions were added.

At this point the migration checklist was complete and further work became normal product maintenance.

---

## Migration evidence and audit trail

The migration deliberately preserved multiple forms of evidence.

### Source counts

The source IRIS archive used for migration contained:

- **695 source files**;
- approximately **204,764 lines of text**.

The original exact ledger recorded:

- **376 explicit source-to-destination mappings**;
- **320 IRIS files not copied as implementation source**, classified primarily as old UI, generated output or replaced configuration.

### Exact historical file ledger

The former `docs/migration/MIGRATED_FILES.md` listed individual source/destination paths and migration treatment, including verbatim copies, import rewrites, duplicates and reference copies.

That file was removed from the active documentation after migration completion because a 130 KB row-by-row ledger is poor day-to-day documentation. It remains fully recoverable from Git history at the pre-consolidation commit noted at the top of this document.

### Preserved source reference docs

`docs/iris-reference/` preserves the source project's architecture/readme/dev/TODO material so maintainers can compare current architecture with the original product when useful.

### Preserved tests

`migrated-tests/iris/` retains the original test heritage while current Code Editor tests cover integration-specific behavior.

### Preserved benchmarks

`benchmarks/iris/` retains the local benchmark framework and history-aware workloads.

### Git history

The staged migration plans/reviews and subsequent implementation commits provide detailed chronological evidence for decisions that are intentionally summarized here.

---

## Verification strategy

The current deterministic project verification sequence is:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:electron-runtime
npm run build
```

or simply:

```bash
npm run verify:full
```

`npm test` performs backend/Electron builds, runs the normal Code Editor Vitest suite, and then runs the compatible migrated IRIS suite through `npm run test:iris`.

Benchmarks are deliberately separate:

```bash
npm run benchmark
```

because they may depend on configured local model/runtime state and retained benchmark history.

### Verification state at documentation consolidation

At the time this migration documentation was consolidated, the latest recorded installed-project verification snapshot showed:

| Check                        | Result                                                                    |
| ---------------------------- | ------------------------------------------------------------------------- |
| Formatting                   | Passed                                                                    |
| Lint                         | Passed with **161 warnings / 0 errors**                                   |
| TypeScript typecheck         | Passed                                                                    |
| Backend build                | Passed                                                                    |
| Electron build               | Passed                                                                    |
| Code Editor Vitest phase     | **156 passed / 2 failed**                                                 |
| Editor/agent collision tests | **2 passed**                                                              |
| Electron runtime smoke       | Passed                                                                    |
| Production Vite build        | Passed                                                                    |
| Migrated IRIS Vitest phase   | Not reached in that chained run because the preceding Vitest phase failed |

The two recorded failing Code Editor tests were:

1. `tests/agentRuntimeContext.test.ts` — failed-tool recovery continuation expectation;
2. `tests/chatEncryptionPersistence.test.ts` — restored attachment-content expectation.

A React missing-`key` warning was also recorded during `AISettingsPanel.test.tsx`.

These failures were explicitly classified as **post-migration correctness/cleanup work**, not evidence of a missing migration milestone.

This verification snapshot will naturally become historical as fixes land. Future work should trust current test results over this dated snapshot.

---

## Completed migration capability checklist

This checklist is retained only as a compact statement of scope, not as an active project plan.

- [x] Secure storage/bootstrap and authenticated local bridge
- [x] Provider credential vault and AI Settings integration
- [x] Cloud/local model configuration and discovery
- [x] Core IRIS Agent Chat execution
- [x] Durable planning/TODO/autonomous project runs
- [x] Pause/resume/interruption recovery
- [x] Editor-aware filesystem reads/writes/edits/patches
- [x] Workspace realpath/symlink containment
- [x] Human/agent stale-revision protection
- [x] Agent/agent task write leases
- [x] Brokered terminal/build/test execution
- [x] Live diagnostics integration
- [x] Exact project search
- [x] Semantic text indexing and incremental rescans
- [x] Document/PDF/archive extraction
- [x] Image/video CLIP semantic indexing
- [x] Semantic concepts
- [x] Workspace-scoped editor-aware RAG
- [x] Encrypted conversation/run persistence
- [x] Memory/context compaction and durable project context
- [x] Skills and project skills
- [x] Encrypted chunked artifacts
- [x] Policy-governed web research
- [x] Model health/routing/recovery/failover
- [x] Hybrid local/cloud model execution
- [x] Local model/runtime setup policy
- [x] Multi-agent delegation and result recall
- [x] Peer consultation and independent review
- [x] Autonomous verification evidence/acceptance
- [x] Voice transcription
- [x] Local screen understanding
- [x] Permissioned exact-plan desktop automation
- [x] CPU/RAM/GPU/process runtime visibility
- [x] Model/token/context/cache/agent telemetry
- [x] Launcher/tool discovery
- [x] Managed development-environment controls
- [x] Compatible migrated IRIS tests in `npm test`
- [x] Preserved benchmark harness in `npm run benchmark`
- [x] Long-running recovery regression coverage
- [x] Multi-agent/human-agent collision regression coverage

---

## What remains after migration

The migration is not the same thing as repository perfection.

Normal post-migration engineering includes:

- fixing current or future regressions;
- reducing lint warnings;
- removing stale imports/helpers left by modularization;
- validating and deleting genuinely unreachable compatibility code;
- improving bundle splitting/performance;
- improving test coverage;
- refining UX;
- adding new provider/model/runtime capabilities;
- adding new product surfaces.

At consolidation time, the immediate quality priorities were:

1. fix the two recorded failing Code Editor tests;
2. fix the React missing-key warning;
3. reduce the large lint-warning set, especially stale runtime imports/helpers;
4. run `npm run verify:full` until both current and migrated suites pass end-to-end;
5. perform dependency-backed dead-export/reachability cleanup in small changes.

These should not be relabeled as “finish the IRIS migration.”

Likewise, features that were never part of the target—such as a new dedicated Notes UI, a new launcher/command-palette experience, or scheduled/background autonomous execution—should be treated as new product design rather than migration debt.

---

## Guidance for future AI models and maintainers

If you are reading this document to work on the repository, the following assumptions will save a lot of confusion.

### Assume IRIS runtime code is intentional until proven otherwise

Large files, historical naming and compatibility helpers may reflect inherited IRIS implementation. Do not perform broad rewrites solely to make the tree look more like a small greenfield editor.

### Do not rebuild old IRIS UI as a migration task

The Orb, old panels, multi-window shell and duplicate editor/file manager were deliberately omitted.

### Treat `docs/iris-reference/` as provenance

It explains the source project. It may contain requirements or TODOs that are irrelevant to the current Code Editor.

### Preserve the two authority paths

Human editor IPC and agent authority are deliberately separate. Avoid shortcuts that make agent tools call unrestricted human editor operations.

### Respect live editor state

Disk is not always the truth. Unsaved CodeMirror buffers, revision tracking and task leases are core coding-agent invariants.

### Keep Git host-owned

Do not casually give autonomous agents unrestricted repository mutation just because they already have file/terminal tools.

### Keep security state in trusted processes

Credentials, application master keys and privileged capability decisions belong in Electron/backend boundaries rather than ordinary renderer state.

### Treat persistent permissions differently from one-off approvals

A model asking for one action should not silently gain durable authority.

### Verify cleanup instead of guessing

Before deleting old-looking platform code, check static imports, dynamic registrations, tool catalogs, provider registries, bridge routes, tests and build output. Then run the complete verification chain.

### Distinguish migration history from current architecture

The historical staging sequence deliberately mentions capabilities being unavailable in early patches. Those restrictions were temporary. Current source and tests are authoritative for current capability.

---

## Documentation structure after consolidation

The repository intentionally keeps migration documentation simple now that the work is complete:

- `docs/MIGRATION.md` — **this document**, the authoritative migration history, architecture and provenance guide;
- `docs/iris-reference/` — preserved documentation from the original IRIS source project;
- `README.md` — concise current product overview and entry point.

The former `docs/migration/` directory and root `IRIS_MIGRATION.md` were removed because their checklist/patch-review structure had become redundant and misleading after completion.

Detailed historical migration records remain available through Git history when forensic detail is needed.

---

## Final perspective

The important mental model is simple:

**Code Editor is the product shell. IRIS is the inherited agent/platform foundation underneath it.**

The project should not be understood as a small editor that happens to contain a few AI utilities. Much of its complexity lives in the migrated IRIS platform: agent execution, provider routing, security policy, persistence, semantic indexing, multi-agent coordination and privileged local services. The newer editor-specific code provides the human interface and the authority adapters necessary to make that platform safe and useful for software development.

The migration succeeded by avoiding a wholesale UI transplant and by preserving the parts of IRIS that were genuinely valuable. Future work should continue that pattern: use the existing platform where it is strong, preserve the editor-native user experience, keep privilege boundaries explicit, and refactor inherited code only when there is concrete evidence that doing so improves the current product.
