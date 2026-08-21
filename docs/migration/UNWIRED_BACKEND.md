# Migrated IRIS Backend Not Yet Exposed by the Code Editor UI

This file is the deliberate "dead/unwired code" ledger requested for the migration. Code listed here is **not accidental dead code**: it is preserved IRIS functionality whose original UI was not copied or whose Code Editor integration requires a later product decision.

Nothing in this list should be deleted merely because the current UI does not call it yet.

## 1. Full agent-session runtime

**Location:** `src/platform/agent/runtime/`, `src/platform/agentRuntime.ts`

**Present:** stateful agent loop, structured-controller fallback, capability policy, broker, safety, duration/operation limits, TODO tracing, continuity/compaction, web/package policy, finalization.

**Why not connected yet:** the current AI Chat panel is an Ollama-only streaming chat and has no UI contract for approvals, durable run state, plans/TODOs, timeline events, provider selection or autonomous-run authority.

**Planned Code Editor surface:** existing AI Chat panel.

## 2. Cloud/local provider registry and agent model assignments

**Location:** `src/platform/providers/`, `src/platform/modelProfiles.ts`, `src/platform/autoSetup/`

**Present:** OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, local provider, provider discovery/configuration, model profiles, auto-setup.

**Why not connected yet:** existing Settings UI only exposes the old Ollama configuration.

**Planned Code Editor surface:** existing Settings modal + AI Chat model selector.

## 3. Agent permissions and approval flow

**Location:** `src/platform/agent/runtime/capabilityPolicy.ts`, `toolBroker.ts`, `safetyPolicy.ts`, migrated chat approval controllers, bridge permission IPC.

**Present:** policy/approval logic and trusted bridge permissions.

**Connected portion:** Electron bridge permission get/update and fail-closed defaults.

**Why not fully connected:** no current approval cards/dialogs in the Code Editor. Old IRIS visual approval cards were intentionally not copied into the live UI.

**Planned surface:** AI Chat activity/timeline using Code Editor styling.

## 4. Semantic filesystem / semantic file search

**Location:** `backend/desktopBridge/services/fileSemanticService.ts` plus semantic workers/services; renderer bridge client in `src/platform/desktopBridge.ts`.

**Present:** source discovery, preflight, incremental indexing, embeddings, text/document/PDF/image/video semantics, concept clustering and semantic retrieval.

**Why not connected yet:** existing Search activity is still the Code Editor's original UI and has not yet been wired to IRIS bridge methods.

**Planned surface:** existing Search activity, alongside exact text/code search. The semantic index may cover user-selected locations outside the active workspace without granting agent write access to those locations.

## 5. RAG retrieval

**Location:** `src/platform/agent/ragRetrieval.ts`

**Present:** semantic candidate retrieval followed by live source reading.

**Dependency:** semantic index and agent runtime integration.

**Planned surface:** invisible agent capability; Search UI may expose results separately.

## 6. Multi-agent orchestration

**Location:** `src/platform/subAgentRuntime.ts`, `src/platform/orchestrationClient.ts`, `src/platform/agent/meshClient.ts`, `meshConductor.ts`, backend agent bus.

**Present:** delegation, task registry, result retrieval, peer consultation, mesh discovery, role bounds and orchestration.

**Why not connected yet:** first Code Editor agent-run UI is not active yet, and concurrent coding also needs editor-aware write collision/lease handling.

**Planned surface:** AI Chat run details / Agents subview, without IRIS's old workspace shell.

## 7. Skills

**Location:** `backend/builtinSkills.ts`, `src/platform/agent/agentSkillEngine.ts`, `src/platform/skill*.ts`, `src/platform-features/skills/`.

**Present:** built-in skills, progressive skill selection/loading, profiles, rewards/metrics and management controller.

**Why not connected yet:** old Skills panel was UI-specific and omitted.

**Planned surface:** Settings and agent-run details.

## 8. Web research/search

**Location:** backend web services/routes, `src/platform/agent/webResearchTask.ts`, `src/platform-features/search/`, hidden DuckDuckGo Electron provider.

**Present:** search, source reading, progress events, history persistence, provider fallback/security policy.

**Connected portion:** Electron hidden DuckDuckGo provider can be started by the bridge.

**Why not fully connected:** existing Search panel has not been adapted, and the current AI Chat does not use the broker yet.

**Planned surfaces:** agent tool + existing Search activity + existing Browser where useful.

## 9. Encrypted chat/session/agent persistence

**Location:** backend encrypted database/storage and `src/platform/*Store.ts`.

**Present:** encrypted database, chats/messages, agent state, artifacts, sub-agent results, skills, semantic data, search history.

**Connected portion:** secure key bootstrap, encrypted bridge, durable renderer store hydration.

**Why not fully visible:** existing `useAIChat` still owns ephemeral legacy chat state.

**Planned surface:** existing AI Chat with durable conversations/project runs.

## 10. Notes/memory backend

**Location:** `src/platform/notesStorage.ts`, `src/platform-features/notes/`, backend persistence routes.

**Present:** note CRUD/storage and transcription insertion logic.

**Why not connected:** no requirement to reproduce the old standalone Notes panel immediately.

**Planned use:** agent/project memory first; a Code Editor notes UI can be added later if useful.

## 11. Artifacts and large result storage

**Location:** backend encrypted database/persistence and renderer bridge artifact methods.

**Present:** artifact metadata/content/chunk persistence.

**Why not connected:** current AI Chat has no artifact/timeline presentation yet.

**Planned surface:** AI Chat run results and editor tabs where appropriate.

## 12. Launcher/system discovery

**Location:** `backend/desktopBridge/services/launcherService.ts`, `launcherSemanticService.ts`, safety helpers, `src/platform/launcherCatalog.ts`, launcher controller.

**Present:** application/tool discovery, semantic launcher index, development-environment lifecycle, launch safety.

**Why not connected:** old IRIS Launcher panel/icons were intentionally omitted.

**Potential Code Editor use:** agent tool for opening/using development tools; optional Command Palette integration later.

## 13. Automation backend

**Location:** `backend/desktopBridge/services/automationAiService.ts`, routes and approval helpers.

**Present:** automation service and approval boundary.

**Why not connected:** no Code Editor automation UI yet.

**Potential use:** agent automation workflows later.

## 14. Vision/screen infrastructure

**Location:** `src/platform/agent/visionTask.ts`, `src/platform-features/screen-capture/`, Electron screen-source/permission infrastructure.

**Present:** screen-source lookup, capture strategy/types and vision task wrapper.

**Why not connected:** old IRIS Vision panel and screen-share toggle were UI-specific and omitted.

**Potential Code Editor use:** browser/application visual verification during autonomous project runs.

## 15. Audio/transcription

**Location:** backend audio service/routes, `src/platform/audio/`, `src/platform-features/audio/`.

**Present:** local/cloud transcription infrastructure and WAV helpers.

**Current editor overlap:** Code Editor already has its own Ollama speech path.

**Future decision:** consolidate the editor's current microphone implementation onto IRIS's configurable audio provider rather than maintaining two paths.

## 16. System monitoring

**Location:** `src/platform-features/systemMonitor/`, backend power/core service methods.

**Present:** CPU/RAM/process/status polling contracts.

**Why not connected:** old IRIS System Monitor panel was omitted.

**Potential use:** autonomous-run status bar/details, especially after Project 3 GPU runtime integration.

## 17. Chat timeline/controller helpers

**Location:** `src/platform-features/chat-ui/`

**Present:** approval controller, layout/scroll controller, timeline conversion, persistence/export and usage helpers.

**Why not connected:** original visual components intentionally omitted so the existing Code Editor AI Chat remains the UI shell.

**Planned use:** adapt these helpers behind the existing AI Chat design.

## 18. Original IRIS tests/benchmarks

**Location:** `migrated-tests/iris/`, `benchmarks/iris/`

**Status:** historical tests and benchmarking implementation preserved. They are not part of the default Code Editor Vitest run yet.

**Why:** some suites target old IRIS UI/window source paths, while backend/runtime tests need import/config adaptation. They must be re-enabled deliberately rather than silently dropped or falsely reported as passing.
