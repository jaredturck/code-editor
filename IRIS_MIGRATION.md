# IRIS Backend Migration Ledger

## Purpose

This repository is the Code Editor application with the reusable IRIS platform migrated into it. The Code Editor remains the product shell. IRIS is treated as the implementation source for agentic/backend functionality rather than as a design reference to be reimplemented.

The migration follows one rule above all others: **preserve working IRIS logic first, adapt only the integration boundaries required by the new application**. Files were reorganized where that made the permanent structure clearer, and imports were updated to match their new homes.

The full migration plan is in [`docs/migration/MIGRATION_PLAN.md`](docs/migration/MIGRATION_PLAN.md). A one-by-one source/destination inventory is in [`docs/migration/MIGRATED_FILES.md`](docs/migration/MIGRATED_FILES.md). Backend code that is present but not yet connected to a Code Editor surface is listed in [`docs/migration/UNWIRED_BACKEND.md`](docs/migration/UNWIRED_BACKEND.md). Final pre-package validation is recorded in [`docs/migration/VALIDATION_REPORT.md`](docs/migration/VALIDATION_REPORT.md).

## Status vocabulary

- **CONNECTED** — migrated and actively used by the Code Editor runtime now.
- **AVAILABLE** — migrated and callable/compilable in the new tree, but no Code Editor UI currently invokes it.
- **PARTIAL** — part of the subsystem is connected; remaining integration is documented.
- **ARCHIVED-TEST** — original IRIS test/benchmark code is preserved outside the default Code Editor test suite for staged re-enablement.
- **OMITTED-UI** — deliberately not migrated because the file belongs to the old IRIS product presentation rather than reusable backend/platform behavior.

## Migration totals

The source IRIS archive contained 695 files and about 204,764 lines of text. The migration intentionally does not copy generated IRIS build output or the old IRIS UI shell. The new repository contains the principal reusable implementation areas below:

| Destination | Files | Approx. lines | Status |
| --- | ---: | ---: | --- |
| `src/platform/` | 81 | 33,966 | AVAILABLE / PARTIAL |
| `src/platform-context/` | 4 | 406 | AVAILABLE |
| `src/platform-features/` | 26 | 5,921 | AVAILABLE |
| `backend/` | 71 | 27,295 | CONNECTED foundation / AVAILABLE capabilities |
| `electron/platform/` | 9 | 2,007 | CONNECTED |
| `migrated-tests/iris/` | 143 | 19,724 | ARCHIVED-TEST |
| `benchmarks/iris/` | 20 | 4,501 | ARCHIVED-TEST |
| `docs/iris-reference/` | IRIS docs/reference | — | Reference |
| `scripts/iris/` | 8 | 157 | Reference / maintenance |

These figures deliberately distinguish the migrated reusable implementation from the old IRIS React shell, generated `server-dist/` / `electron/` output, and visual assets.

## CONNECTED now

### Secure storage bootstrap

The existing Code Editor Electron main process now initializes IRIS's secure persistence foundation before creating the editor window:

1. verify operating-system-backed Electron `safeStorage` is available;
2. reject Linux `basic_text` secret storage;
3. load or create the application master key;
4. start the authenticated loopback bridge;
5. zero the Electron-owned plaintext key buffer after bridge initialization;
6. only then load the renderer.

If secure persistence cannot initialize, startup fails closed rather than silently falling back to plaintext state.

The persistence cipher contract is now explicitly enforced for conversation/run data: a 32-byte random application master key is wrapped with Electron `safeStorage` (Keychain/DPAPI/Secret Service as provided by the OS; Linux `basic_text` is rejected), while HKDF-SHA256 derives domain-separated 256-bit record keys. Sensitive records are authenticated-encrypted with AES-256-GCM using a fresh 96-bit random nonce, a 128-bit authentication tag, and AAD bound to the application/version/domain/record/field. Chat display data, complete message payloads (including attachments and bounded run metadata), chat memory/compacted context, autonomous-run/TODO checkpoints and extended run history are encrypted before SQLite receives them. SQLite keeps only ciphertext plus the structural metadata needed to address records (for example UUIDs, indices, counts and timestamps).

Renderer exposure is also bounded: startup hydration no longer decrypts per-chat checkpoints or agent-run history into Chromium. Per-chat run state is fetched only when that chat is loaded, and run history uses exact-key encrypted-store reads. The legacy bulk store route is restricted to the same bootstrap-safe subset. Plaintext necessarily exists transiently in trusted process memory while a message is displayed, sent to a configured model, or actively processed; the persistence boundary guarantees authenticated encryption at rest and fails closed rather than creating plaintext fallbacks.

Files:
- `electron/platform/storageKeyStore.cts`
- `electron/platform/linuxPasswordStore.cts`
- `electron/platform/localBridge.cts`
- `electron/main.cts`

### Encrypted local bridge

The complete IRIS bridge/server implementation is migrated to `backend/`. Electron starts it on `127.0.0.1` using an ephemeral port and per-launch random bearer token. The port/token are supplied to the renderer at load time, matching IRIS's existing `desktopBridge` client contract.

The bridge contains the migrated encrypted database, filesystem/network/process containment, semantic indexing, web services, tools, agent bus, launcher, automation and persistence routes.

### Encrypted renderer-state hydration

`src/main.tsx` now hydrates IRIS's encrypted durable-store facade before React mounts. Existing Code Editor React UI remains unchanged after hydration succeeds.

Files:
- `src/platform/localStorageStore.ts`
- `src/main.tsx`

### Provider credential vault

IRIS provider credentials are registered in Electron using OS-backed `safeStorage`. A narrow `orbitDesktop.credentials` preload API exposes credential status/list/get/set/delete to migrated provider/settings code without exposing Node APIs to React.

Files:
- `electron/platform/credentialStore.cts`
- `electron/preload.cts`

### Bridge permission control

Electron exposes narrow IPC for reading/updating bridge capability permissions. The renderer cannot grant itself authority by inserting permission flags into a normal bridge request.

Files:
- `electron/platform/localBridge.cts`
- `electron/main.cts`
- `electron/preload.cts`

### Emergency stop foundation

A global `CommandOrControl+Shift+Backspace` emergency stop now:
- terminates editor terminal PTYs;
- aborts active legacy Ollama requests;
- aborts the active Code Editor IRIS agent run;
- revokes bridge terminal/launcher/automation/microphone permissions;
- broadcasts `platform:emergency-stop` to renderers.

Multi-agent/sub-agent cancellation is still reserved for the later orchestration milestone.

### Screen-source access foundation

The trusted Electron main process exposes screen-source enumeration to migrated vision code through a narrow IPC boundary. No old IRIS Vision panel was migrated.

## PARTIAL integrations

### AI Chat → full IRIS agent runtime

**Status: CONNECTED (core agent milestone).**

The existing Code Editor `AI Chat` panel now executes through the migrated `runAgentSession` runtime instead of the legacy direct Ollama chat request path. The configured Orchestrator provider/model/key slot is resolved from Settings, cloud and local providers share the same agent path, native tool calling and structured-controller fallback remain available, and agent output streams into the existing Chat shell.

This integration includes encrypted chat restoration/persistence, durable run history, structured TODOs, long-running project execution, pause/resume checkpoints, approval/question cards, cancellation, global emergency-stop handling and a bounded observable activity timeline. Raw model reasoning streams are deliberately excluded from the Code Editor transcript and persisted activity metadata. Long autonomous workspace runs also carry an encrypted, bounded project working-context checkpoint across segments; the existing `chat.remember` / `chat.recall` tools preserve agent-authored durable facts, while `rag.retrieve` can repeatedly refresh project evidence through live editor-aware file reads.

Workspace Agent Chat now has the editor-aware file/search/RAG/terminal capabilities already completed by their dedicated milestones. This batch also connects IRIS skills and artifacts to the same autonomous runtime. Built-in and encrypted user skills continue through the existing profile engine; `.iris/skills/*.md` project skills and optional `.iris/skills.json` settings are loaded only through the active workspace authority and merged as the most-specific layer. Capable agents receive the existing progressive skill cards and call `skills.load` only when detailed instructions are relevant.

For substantial durable outputs, persisted chat runs now expose the existing `artifact.create` tool. Research, test, architecture/design and migration reports can be written in bounded chunks to IRIS's encrypted artifact store and appended without flooding the chat context. Returned artifact references are attached to the final assistant reply and open through the Code Editor Markdown surface as decrypted in-memory snapshots; the encrypted backing records remain authoritative and are not materialized as plaintext temporary files.

The per-session allowlist still applies to **every** catalog tool, including tools marked `internal`; later host, multi-agent, screen/mouse and automation capabilities remain unavailable until their dedicated policy/orchestration milestones. Chat also refuses requests to persist machine permissions from an agent run.

### Search → semantic filesystem

**Status: CONNECTED (semantic file, document, media and concept indexing milestones).**

The existing Search activity exposes the migrated IRIS MiniLM text-embedding index as a dedicated Semantic mode without importing the old IRIS Search presentation. Results are filtered to the open workspace, show indexed semantic summaries/scores, open directly in the Code Editor, and can pivot into the migrated similar-file lookup.

The workspace watcher schedules debounced IRIS incremental rescans when an encrypted semantic index is already ready. Index creation, model installation and broader source selection remain managed by the existing AI Settings semantic-index controls. Search also exposes bounded document/PDF/archive extraction, the migrated CLIP media index with video-frame timestamps, and persistent MiniLM/CLIP semantic concepts. Agent Chat exposes IRIS's `rag.retrieve` tool for workspace runs: semantic candidates are scoped to the active Code Editor workspace before selection, evidence is re-read through the editor-aware file authority so unsaved buffers win over disk, and the existing temporary chunker/ranker assembles bounded passages with file and line provenance for repeated use throughout autonomous runs. Indexed-directory authority remains separate from agent file-write authority, preserving the IRIS security model.

### Settings → IRIS provider/agent configuration

**Status: CONNECTED.**

The existing VS Code-inspired Settings modal now exposes the migrated IRIS AI configuration without importing the old IRIS Settings UI. The AI tab is split into Providers, Models, Agents, Routing, Autonomy, Limits, Skills and Semantic Index sections.

Connected settings include secure provider credentials, explicit provider testing/model discovery, model curation, Orchestrator/Executor/Scout/Reviewer assignments, per-role permission tiers, routing/failover policy, brokered capability permissions, web/package guards, long-run budgets, skill-runtime configuration and semantic-index maintenance. The original Code Editor Ollama speech settings remain available; model/provider selection for Chat now comes from the configured IRIS Orchestrator.

### Existing Code Editor native capabilities → agent tools

The editor's human-facing filesystem, workspace, terminal, browser and diagnostics IPC remain intact. IRIS's broker/bridge tool infrastructure remains the privileged agent boundary rather than exposing unbrokered editor IPC. Workspace file tools route through the editor-aware authority layer so unsaved CodeMirror buffers are visible to agent reads and human/agent revision changes are checked before writes; terminal/build/test execution stays behind the brokered terminal policy.

## AVAILABLE migrated subsystems

The following code is present even where the editor does not yet expose a UI:

### Agent runtime and tool system
- canonical tool catalog and schemas;
- capability tiers and role policies;
- exact-operation approval machinery;
- stateful native-tool loop;
- structured controller fallback;
- planning/TODO tracing;
- tool repeat/limit handling;
- finalization and open-TODO reconciliation;
- self-correction/recovery support;
- context continuity and summarization;
- web/package guard policies;
- usage metrics and execution metadata.

### Providers and model routing
- OpenAI;
- Anthropic;
- Gemini;
- DeepSeek;
- OpenRouter;
- local/Ollama-compatible provider;
- provider discovery/configuration;
- model profiles/tags;
- model routing;
- model health monitoring/recovery/failover;
- local model catalog and automatic setup logic;
- shared cloud-usage policy.

### Multi-agent system
- sub-agent registry/runtime;
- task bus;
- delegation/status/result recall;
- peer consultation;
- mesh discovery/conductor;
- role/task bounds;
- orchestration client;
- review/verification-related tool contracts;
- encrypted sub-agent result persistence.

### Skills
- built-in skills from `backend/builtinSkills.ts`;
- renderer skill engine;
- skill Markdown parsing;
- profiles;
- rewards/metrics;
- skills panel controller logic (without old IRIS panel UI).

### Semantic filesystem and RAG
- index-source discovery;
- semantic filesystem index;
- incremental indexing;
- text embeddings;
- document extraction;
- PDF extraction;
- image preparation/CLIP indexing;
- image processing queues and worker pools;
- video semantics;
- concept math/clustering/pools/workers;
- file browser and thumbnail services;
- archive services;
- RAG retrieval client;
- filesystem exclusions and workload limits.

### Web research
- web research/search service;
- DuckDuckGo browser-backed provider;
- historical/direct provider support in IRIS backend;
- source/network policy;
- network-security and redirect controls;
- web-search history persistence;
- paid-provider/fallback policy surfaces;
- progress-event controller logic.

### Persistence, memory and artifacts
- encrypted SQLite schema and migrations;
- domain-separated AES-GCM/HKDF crypto;
- chat/session store client;
- notes store client;
- agent run store;
- artifacts and chunk persistence;
- web-search history persistence;
- skill persistence;
- semantic index persistence;
- launcher semantic persistence;
- legacy cleanup helpers.

### Audio
- transcription service;
- renderer transcription controller/configuration;
- WAV encoding helpers;
- microphone permission foundation.

### Launcher / local-system services
- launcher application/tool discovery;
- launcher safety policy;
- semantic launcher index;
- development-environment management;
- system/power service routes;
- system-monitor renderer controller;
- native file-dialog helper.

### Automation and vision foundations
- automation AI service/routes;
- automation approval helpers;
- screen-capture strategy/types;
- screen-source permission infrastructure;
- vision task runtime wrapper.

## Deliberately omitted IRIS presentation code

The migration does **not** copy the old IRIS product shell into the live Code Editor renderer. Examples include:

- Floating Orb / particle planet UI and texture assets;
- old Orb context composition whose purpose was switching between Orb/workspace windows;
- old panel manager and duplicated IRIS panels;
- IRIS File Manager presentation components;
- IRIS Search presentation cards/sidebar;
- old Launcher panel/icon presentation;
- old Notes panel presentation;
- old Vision panel presentation;
- old Settings panel presentation;
- old Skills/System Monitor panels;
- login/register/password-reset/local-profile presentation;
- old multi-window workspace shell;
- duplicate IRIS editor window implementation;
- old Orb Electron window/window-shape/window-visibility management.

Where those UI files contained reusable controller/helper logic, the non-visual portions were migrated separately under `src/platform-features/`.

The exact omitted source list is recorded in `docs/migration/MIGRATED_FILES.md`.

## Existing Code Editor UI preservation

The following original Code Editor directories remain byte-for-byte unchanged from the supplied Project 4 source at the end of the migration pass:

- `src/components/`
- `src/editor/`
- `src/hooks/`
- `src/workspace/`

The visible editor shell therefore remains the Code Editor rather than becoming IRIS. Integration changes are concentrated in boot/config/native-boundary files plus newly added platform/backend directories.

## Test and benchmark preservation

The full original IRIS `tests/` tree is copied to `migrated-tests/iris/` and the IRIS benchmark suite is copied to `benchmarks/iris/`. They are intentionally outside the default Code Editor Vitest include path so the initial migration does not pretend UI-shell tests are valid against a different frontend.

Backend/runtime suites should be re-enabled incrementally as their paths/configuration are adapted. Tests that explicitly inspect old Orb/panel/window source belong to the `OMITTED-UI` category and remain historical reference tests.

## Dependency / lockfile note

The Code Editor archive did not include `node_modules`, and package-registry access was unavailable in the migration environment. `package.json` was merged with the runtime dependencies actually imported by migrated IRIS code. `package-lock.json` was assembled from the existing Code Editor and IRIS lockfiles so the source archive remains self-contained, but a normal `npm install`/`npm ci` must be run in an environment with registry access and the resulting lockfile should be committed after npm validates the merged dependency graph.

This is the main validation item that could not be completed in the migration environment.

## Generated output

Old `dist/` and `dist-electron/` output from the supplied Code Editor is not authoritative after migration and should be regenerated. IRIS `server-dist/` and generated Electron output were never treated as source. The migrated backend builds into `backend-dist/`.

## Development integration checklist

This checklist tracks the remaining product integration work. An unchecked item does **not** necessarily mean the backend code is missing; in many cases the IRIS implementation is already migrated and only needs to be connected, adapted, tested, or surfaced in the Code Editor UI.

### Foundation already connected

- [x] Secure storage bootstrap
- [x] Encrypted local bridge lifecycle
- [x] Encrypted renderer-state hydration
- [x] Provider credential vault foundation
- [x] Bridge capability-permission foundation
- [x] Emergency-stop foundation
- [x] Screen-source IPC foundation

### Agent and editor integration

- [x] **AI settings and provider configuration**
  - API keys and provider accounts
  - Model discovery and selection
  - Orchestrator / Executor / Scout / Reviewer assignments
  - Agent safety, budget, web and package policies
- [x] **Core agent chat integration**
  - Connect `AI Chat` to `runAgentSession`
  - Native tool calling and structured-controller fallback
  - Streaming, cancellation and observable activity timeline
  - Encrypted active-chat restoration/persistence and approval/question cards
  - Research/context-only per-session capability boundary
- [x] **Planning and autonomous project runs**
  - Planning and structured TODOs
  - Long-running project execution
  - Checkpoints, pause/resume and completion verification
- [x] **Editor-aware filesystem tools**
  - Agent read/write/edit/patch operations
  - Workspace containment and symlink safety
  - Unsaved CodeMirror buffer awareness
  - Human/agent edit-collision handling
- [x] **Terminal, build, test and diagnostics tools**
  - Brokered terminal execution
  - Build/test/lint commands
  - Diagnostics exposed to agents
  - Error → fix → rerun feedback loop

### Search, retrieval and project understanding

- [x] **Exact code search**
  - Ripgrep / find / fd / filename search
  - Search-panel and agent-tool integration
- [x] **Semantic file search and indexing**
  - Semantic filesystem index
  - Incremental workspace indexing
  - Text embeddings and similar-file search
  - Search-panel semantic mode
- [x] **Document, PDF and archive intelligence**
  - Document/PDF extraction and indexing
  - Archive inspection and document retrieval
- [x] **Image and video semantic indexing**
  - CLIP image embeddings
  - Image/video semantic search
  - Media worker queues and persistence
- [x] **Semantic concepts**
  - Concept clustering, centroids and membership
  - Concept-driven file discovery
- [x] **RAG and project context engine**
  - Semantic candidate retrieval
  - Live-file evidence reads
  - Context assembly and ranking
- [x] **Memory and context compaction**
  - Project working memory
  - Chat remember/recall
  - Long-run summarization and rolling compaction

### Persistence and reusable agent infrastructure

- [x] **Conversation and run persistence**
  - Encrypted chats/messages
  - Agent runs, TODOs and checkpoints
  - Resume previous runs
- [x] **Skills system**
  - Built-in and user skills
  - Progressive skill loading
  - Project-specific skills and settings
- [x] **Artifacts and large outputs**
  - Artifact creation and chunked persistence
  - Research/test/architecture reports
  - Editor artifact viewing

### Research, providers and model execution

- [x] **Web search and research**
  - Search/fetch tools and source handling
  - Network safety and untrusted-content boundary
  - Browser/editor integration
- [x] **Model routing, health and failover**
  - Capability-aware routing
  - Health monitoring and recovery
  - Provider/model failover
- [x] **Hybrid local + cloud execution**
  - Local/cloud coordination
  - Cloud consultation/final synthesis
  - Shared usage budgets
- [x] **Advanced local model runtime integration**
  - Project 3 runtime adapters
  - GPU/VRAM-aware scheduling
  - Quantization and custom local backends

### Multi-agent development

- [ ] **Multi-agent orchestration**
  - Orchestrator, Executor, Scout and Reviewer roles
  - Delegation, task bus and parallel execution
  - Peer consultation and result recall
- [ ] **Multi-agent coding coordination**
  - File ownership / write leases
  - Agent-agent collision prevention
  - Human-agent collision prevention
- [ ] **Review and autonomous quality control**
  - Independent review/verification agents
  - Automated remediation and re-review
  - Final acceptance gate

### Additional IRIS capabilities

- [ ] **Audio and voice**
  - Transcription backend and provider configuration
  - Voice input for Agent Chat
- [ ] **Vision and screen capabilities**
  - Screen capture and vision runtime
  - Permissioned visual verification/actions
- [ ] **Automation**
  - Automation service and approvals
  - Future scheduled/background project tasks
- [ ] **System monitoring and runtime visibility**
  - CPU/RAM/GPU/process monitoring
  - Model, agent, token and cost visibility
- [ ] **Launcher and local-system capabilities**
  - Installed application/tool discovery
  - Development-environment management
  - Agent discovery of local developer tooling
- [ ] **Security and autonomous-run policy**
  - Workspace-scoped autonomous authority
  - Exact-operation approvals and capability tokens
  - Filesystem/network/package/vision/automation policy

### Validation and hardening

- [ ] **Re-enable migrated IRIS tests**
  - Backend, agent, broker/security and provider suites
  - Semantic-index and multi-agent suites
- [ ] **Re-enable benchmarks**
- [x] **Add Code Editor + agent integration tests**
- [ ] **Add long-running run/recovery tests**
- [ ] **Add multi-agent collision tests**

## Next integration priorities

1. Enable multi-agent orchestration with Orchestrator, Executor, Scout and Reviewer/Overwatcher roles, delegation and result recall.
2. Add file ownership/write leases and agent-agent collision prevention before allowing parallel coding agents to modify the workspace.
3. Connect independent review, remediation/re-review and final acceptance gating for autonomous quality control.
4. Re-enable compatible migrated IRIS tests and benchmark commands subsystem-by-subsystem after the remaining capability batches are connected.
