# IRIS Backend Migration Ledger

## Status

**Migration status: COMPLETE for the defined Code Editor product scope.**

The reusable IRIS agent/backend platform has been migrated into the Code Editor and the planned product integrations are connected. The remaining repository work is normal post-migration engineering: fix current regressions, reduce lint/dead-code noise, perform cleanup with dependency-aware verification, and optionally add new product surfaces.

The old IRIS presentation shell was never part of the target and remains intentionally omitted.

## Purpose and scope

The Code Editor is the product shell. IRIS is the implementation source for reusable agentic/backend behavior rather than a UI to transplant wholesale.

The migration followed one rule above all others: **preserve working IRIS logic first and adapt only the integration boundaries required by the Code Editor**. That produced four principal implementation areas:

| Area | Current role |
| --- | --- |
| `src/platform/` | Connected renderer-side IRIS runtime, providers, agent policy, persistence clients, skills, orchestration, model routing, RAG and related platform code |
| `src/platform-features/` | Reusable migrated feature controllers/helpers; some are mounted directly and some are retained for compatibility/reference |
| `backend/` | Connected privileged loopback backend: encrypted persistence, filesystem/semantic services, web, agents, launcher, automation, audio and local-system services |
| `electron/platform/` | Connected trusted Electron infrastructure: bridge bootstrap, credentials, storage keys, logging, screen permissions and hidden browser search support |

The exact historical source-to-destination file inventory remains in [`docs/migration/MIGRATED_FILES.md`](docs/migration/MIGRATED_FILES.md).

## Connected platform

### Secure storage and bridge

- OS-protected application master key through Electron `safeStorage`;
- Linux `basic_text` secret storage rejected fail-closed;
- authenticated loopback bridge on `127.0.0.1` with an ephemeral port and per-launch bearer token;
- encrypted SQLite persistence using AES-256-GCM with HKDF-SHA256 domain separation and record-bound AAD;
- secure provider credential slots through the Electron credential vault;
- capability permissions controlled by the trusted Electron boundary;
- global emergency stop aborting active agent/terminal work and revoking privileged bridge capabilities.

### Agent Chat and autonomous project runs

- Code Editor Chat executes through the migrated `runAgentSession` runtime;
- configured cloud/local provider and model selection;
- native tool calling plus structured-controller fallback;
- encrypted chat history and targeted run-history hydration;
- durable TODOs, checkpoints, pause/resume, interruption recovery and long-run working context;
- approvals/questions, cancellation and bounded observable activity;
- editor-aware workspace file read/write/edit/patch authority;
- brokered terminal/build/test/diagnostics execution;
- exact search, semantic RAG, skills, artifacts, web research and memory tools;
- permission-scoped model-facing tool schemas with execution-time broker/bridge checks underneath.

### Editor-aware filesystem authority

Open CodeMirror buffers are authoritative for agent reads. Agent writes use actor-scoped revisions and task-scoped write leases. Human edits invalidate stale agent revisions, and a second agent cannot write a leased file until the owning task releases it.

The dedicated collision regression suite covers both cases in `tests/editorAgentCollision.test.ts`.

### Search, semantic filesystem and RAG

- exact workspace search;
- MiniLM text semantic indexing and incremental rescans;
- document, PDF and archive extraction;
- CLIP image/video indexing and runtime selection;
- persistent semantic concepts;
- workspace-scoped `rag.retrieve` with editor-aware re-reads so unsaved buffers beat stale disk/index content.

### Providers and model execution

- OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter and local/Ollama-compatible providers;
- secure credential slots and provider/model discovery;
- Orchestrator/Executor/Scout/Reviewer role assignments;
- model routing, health, recovery and failover;
- hybrid local/cloud execution and bounded cloud consultation;
- local model setup/runtime policy including conservative VRAM-aware selection.

### Multi-agent development

- configured multi-agent team activation;
- delegation/task bus, asynchronous independent tasks and result recall;
- peer consultation and independent review;
- per-role tool/permission policy;
- task-scoped write leases and actor-scoped live-file revisions;
- human-agent and agent-agent collision prevention;
- autonomous acceptance gate that blocks completion on open TODOs, active delegated tasks, outstanding leases, stale review or failed verification;
- bounded remediation continuations and re-review.

### Persistence, memory, skills and artifacts

- encrypted conversations/messages/attachments;
- encrypted autonomous-run checkpoints and run history;
- bounded project working context and chat remember/recall;
- built-in, encrypted user and workspace `.iris/skills/*.md` skills;
- encrypted chunked artifacts surfaced through the Code Editor Markdown viewer.

### Audio, vision and automation

- local/cloud transcription configuration and Agent Chat voice input;
- trusted microphone permission boundary;
- fresh local-only screen understanding;
- separate screen-capture and desktop-automation permissions;
- exact-plan, short-lived, single-use automation approval tokens.

Scheduled/background project execution is not part of the completed migration scope; it would be a new feature if added later.

### Runtime visibility and local-system integration

- CPU, RAM, GPU/VRAM and process visibility;
- model request/token/context/cache telemetry;
- active/queued agent visibility;
- effective autonomous authority display;
- launcher/tool discovery;
- managed development-environment status and explicit Start/Stop controls.

## Deliberately omitted IRIS presentation code

The migration intentionally does **not** restore the old IRIS product shell. Omitted presentation-only areas include:

- Floating Orb / particle-planet UI and texture assets;
- old Orb/workspace window composition;
- old panel manager and duplicated IRIS panels;
- IRIS File Manager/Search/Launcher/Notes/Vision/Settings/Skills/System Monitor presentation;
- login/register/password-reset/local-profile presentation;
- old multi-window workspace shell;
- duplicate IRIS editor/window IPC and window-shape/visibility management.

Reusable non-visual logic from those areas was migrated where needed. See [`docs/migration/UNWIRED_BACKEND.md`](docs/migration/UNWIRED_BACKEND.md) for intentionally retained compatibility/controller code.

## Tests and benchmarks

The original IRIS test tree remains preserved under `migrated-tests/iris/`, but compatible backend/runtime suites are no longer merely archived: `vitest.iris.config.ts` selects the supported migrated runtime surface and `npm test` runs it after the Code Editor integration suite.

The preserved benchmark harness is active through `npm run benchmark` (`benchmark:iris` remains a compatibility alias). Benchmarks intentionally stay outside `verify:full` because they may depend on local model/runtime state and retained benchmark history.

Dedicated Code Editor regression coverage now includes long-running recovery, multi-agent integration, write leases and editor/agent collision behavior.

## Dependency and verification status

The original migration environment could not install the merged dependency tree. That limitation has since been resolved in the normal development checkout: backend/Electron builds, TypeScript checking, Electron runtime loading, Vitest and the production Vite build have all been executed with installed dependencies.

The latest recorded local verification snapshot is **not fully green**. It reports:

- lint: 161 warnings, 0 errors;
- typecheck: pass;
- Code Editor Vitest suite: 156 passed / 2 failed;
- `tests/editorAgentCollision.test.ts`: 2/2 passed;
- Electron runtime smoke: pass;
- production build: pass;
- migrated IRIS suite was not reached in that chained `npm test` run because the first Vitest phase failed.

The two current test failures are in autonomous working-context recovery and encrypted attachment restoration. These are post-migration correctness/cleanup items, not missing migration milestones. See [`docs/migration/VALIDATION_REPORT.md`](docs/migration/VALIDATION_REPORT.md).

## Completed integration checklist

- [x] Secure storage/bootstrap and authenticated bridge
- [x] AI Settings and provider configuration
- [x] Core Agent Chat runtime
- [x] Durable planning and autonomous project runs
- [x] Editor-aware filesystem authority
- [x] Brokered terminal/build/test/diagnostics tools
- [x] Exact code search
- [x] Semantic file/document/media indexing and concepts
- [x] RAG and project context
- [x] Memory and context compaction
- [x] Conversation/run persistence
- [x] Skills and project skills
- [x] Artifacts and large outputs
- [x] Web research
- [x] Model routing/health/failover
- [x] Hybrid local/cloud execution
- [x] Advanced local model runtime integration
- [x] Multi-agent orchestration
- [x] Multi-agent coding coordination
- [x] Independent review and autonomous acceptance
- [x] Audio and voice
- [x] Vision and screen understanding
- [x] Permissioned desktop automation
- [x] Runtime/system visibility
- [x] Launcher/local-system integration
- [x] Security/autonomous-run policy hardening
- [x] Compatible migrated IRIS runtime tests wired into `npm test`
- [x] Preserved benchmark harness wired into `npm run benchmark`
- [x] Long-running recovery coverage
- [x] Multi-agent/human-agent collision coverage

## Post-migration work

These are normal engineering tasks rather than migration gaps:

1. fix the two currently failing Code Editor tests;
2. remove the React missing-key warning seen during the current test run;
3. reduce the 161 lint warnings, especially stale runtime imports/helpers left after modularization;
4. rerun `npm run verify:full` until the entire deterministic verification chain is green, including the migrated IRIS suite;
5. perform dependency-backed dead-export/reachability cleanup before removing retained compatibility code;
6. treat any new UI surfaces or scheduled/background execution as new product development, not unfinished migration.

## Documentation authority

For current state, use documents in this order:

1. [`docs/migration/CURRENT_STATUS.md`](docs/migration/CURRENT_STATUS.md)
2. this ledger
3. [`docs/migration/VALIDATION_REPORT.md`](docs/migration/VALIDATION_REPORT.md)
4. [`docs/migration/UNWIRED_BACKEND.md`](docs/migration/UNWIRED_BACKEND.md)

`MIGRATION_PLAN.md`, the P006/P007/P008 milestone documents, and `docs/iris-reference/` are historical records and should not be read as the current backlog.
