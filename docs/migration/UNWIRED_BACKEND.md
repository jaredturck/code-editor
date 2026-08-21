# Migrated IRIS Backend Remaining Integration Ledger

This file is the deliberate "dead/unwired code" ledger requested for the migration. Code listed here is **not accidental dead code**: it is preserved IRIS functionality whose original UI was not copied or whose Code Editor integration requires a later product decision.

Nothing in this list should be deleted merely because the current UI does not call it yet.

## 1. Agent-session extensions beyond the core Chat milestone

**Location:** `src/platform/agent/runtime/`, `src/platform/agentRuntime.ts`

**Connected now:** the existing AI Chat panel invokes `runAgentSession`, supports native tools/controller fallback, visible answer streaming, bounded observable activity, approvals/questions, cancellation and the configured Orchestrator.

**Still intentionally unwired:** direct workspace filesystem/search/RAG authority, multi-hour autonomous project-run checkpoints/resume, rich plan/TODO presentation, steering/force-session-alive UX, write/terminal authority and multi-agent execution. P006 session-scopes Chat to research/context tools until the dedicated workspace and process safety integrations are completed.

**Planned Code Editor surface:** existing AI Chat panel and future run details within that surface.

## 2. Cloud/local provider registry and agent model assignments

**Location:** `src/platform/providers/`, `src/platform/modelProfiles.ts`, `src/platform/autoSetup/`, `src/components/settings/AISettingsPanel.tsx`

**Present:** OpenAI, Anthropic, Gemini, DeepSeek, OpenCode, OpenRouter, local provider, secure credential configuration, explicit discovery/testing, curated models, agent-role assignments, model profiles and auto-setup.

**Connected portion:** the existing Code Editor Settings modal now exposes provider credentials, model curation and Orchestrator/Executor/Scout/Reviewer assignments.

**Connected now:** AI Chat resolves the configured Orchestrator provider/model/key slot and uses it for real IRIS agent execution. The legacy Ollama model picker has been removed from Chat; Ollama remains available through the local provider and for the existing speech workflow.

**Still unwired:** dedicated runtime UI for complexity routing, hybrid local/cloud synthesis and richer health/failover visibility.

## 3. Agent permissions and approval flow

**Location:** `src/platform/agent/runtime/capabilityPolicy.ts`, `toolBroker.ts`, `safetyPolicy.ts`, migrated chat approval controllers, bridge permission IPC.

**Present:** policy/approval logic and trusted bridge permissions.

**Connected portion:** Electron bridge permission get/update, fail-closed defaults and Code Editor-native approval/question cards in AI Chat. Settings can still manage trusted bridge permissions explicitly.

**Still intentionally unwired:** Chat-originated persistent machine-permission grants are denied in P006, and file/terminal/screen/mouse/host-inspection/multi-agent tools are session-blocked rather than merely hidden. They will be surfaced only with their dedicated editor/process authority milestones.

## 4. Semantic filesystem / semantic file search

**Location:** `backend/desktopBridge/services/fileSemanticService.ts` plus semantic workers/services; renderer bridge client in `src/platform/desktopBridge.ts`.

**Present:** source discovery, preflight, incremental indexing, embeddings, text/document/PDF/image/video semantics, concept clustering and semantic retrieval.

**Why not connected yet:** existing Search activity is still the Code Editor's original UI and has not yet been wired to IRIS bridge methods.

**Planned surface:** existing Search activity, alongside exact text/code search. The semantic index may cover user-selected locations outside the active workspace without granting agent write access to those locations.

## 5. RAG retrieval

**Location:** `src/platform/agent/ragRetrieval.ts` and the agent tool broker.

**Present:** semantic candidate retrieval followed by live source reading.

**Still unwired:** P006 deliberately does not expose `rag.retrieve` to Agent Chat until the editor-aware workspace authority layer is connected. Direct semantic/RAG result presentation in the existing Search activity and tighter watcher-driven index refresh UX also remain pending.

## 6. Multi-agent orchestration

**Location:** `src/platform/subAgentRuntime.ts`, `src/platform/orchestrationClient.ts`, `src/platform/agent/meshClient.ts`, `meshConductor.ts`, backend agent bus.

**Present:** delegation, task registry, result retrieval, peer consultation, mesh discovery, role bounds and orchestration.

**Why not connected yet:** P006 deliberately forces single-Orchestrator execution. Concurrent coding also needs editor-aware write collision/lease handling before delegation is safe.

**Planned surface:** AI Chat run details / Agents subview, without IRIS's old workspace shell.

## 7. Skills

**Location:** `backend/builtinSkills.ts`, `src/platform/agent/agentSkillEngine.ts`, `src/platform/skill*.ts`, `src/platform-features/skills/`.

**Present:** built-in skills, progressive skill selection/loading, profiles, rewards/metrics and management controller.

**Connected portion:** Settings now exposes skill enablement, automatic/manual profile selection and prompt/relevance limits.

**Still unwired:** the full skill-management/editor experience and per-run skill visibility are not yet surfaced.

**Planned surface:** Settings plus future agent-run details.

## 8. Web research/search

**Location:** backend web services/routes, `src/platform/agent/webResearchTask.ts`, `src/platform-features/search/`, hidden DuckDuckGo Electron provider.

**Present:** search, source reading, progress events, history persistence, provider fallback/security policy.

**Connected portion:** Agent Chat can use brokered `search.web`, `web.fetch` and trusted-source lookup under IRIS network/site policy; the hidden DuckDuckGo provider remains available through the bridge.

**Still unwired:** human-facing web-research Search UI, saved-research browsing and Browser-assisted research presentation.

**Planned surfaces:** existing Search activity + existing Browser where useful.

## 9. Encrypted chat/session/agent persistence

**Location:** backend encrypted database/storage and `src/platform/*Store.ts`.

**Present:** encrypted database, chats/messages, agent state, artifacts, sub-agent results, skills, semantic data, search history.

**Connected portion:** secure key bootstrap, encrypted bridge, durable renderer store hydration, encrypted active-chat creation/restoration, user/assistant message persistence, warm TODO state and durable bounded agent-run history. Assistant completion is persisted before the UI marks it complete.

**Still unwired:** chat switcher/history management UI, resumable in-flight autonomous project runs and full checkpoint recovery.

**Planned surface:** existing AI Chat with richer conversation/project-run controls.

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

**Connected portion:** the migrated approval controller/normalization logic now backs Code Editor-native approval/question cards, and P006 adapts IRIS timeline events into a compact collapsible activity list without exposing raw reasoning.

**Still unwired:** old IRIS-specific timeline grouping/layout, export/history controls and usage dashboards remain available as reference/controller code where useful but are not copied visually.

## 18. Original IRIS tests/benchmarks

**Location:** `migrated-tests/iris/`, `benchmarks/iris/`

**Status:** historical tests and benchmarking implementation preserved. They are not part of the default Code Editor Vitest run yet.

**Why:** some suites target old IRIS UI/window source paths, while backend/runtime tests need import/config adaptation. They must be re-enabled deliberately rather than silently dropped or falsely reported as passing.
