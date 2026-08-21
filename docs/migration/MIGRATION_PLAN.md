# IRIS Backend Migration Plan

## Objective

Migrate the reusable IRIS platform/backend into the existing Code Editor while preserving the Code Editor as the product shell and keeping the current editor UI substantially unchanged. IRIS is the implementation source: working IRIS logic is copied and adapted rather than rewritten. UI-only IRIS shell code (Orb/planet launcher, IRIS workspace window shell, duplicate editor/file-manager presentation, login/profile pages) is not part of the migration target.

The migration is intentionally staged so the repository remains understandable and each imported subsystem has an explicit source, destination, integration state, and validation path.

## Non-negotiable migration rules

1. **Copy before rewrite.** Existing IRIS implementation code is retained wherever practical.
2. **Reorganizing is allowed.** Files may move into clearer product domains; import paths are updated without changing behavior.
3. **The Code Editor remains the UI.** Existing Explorer, editor, terminal, browser, problems panel, Search activity, Settings modal, and AI Chat panel remain the product surfaces.
4. **Backend code may be present before it is surfaced.** Migrated but currently unexposed capabilities stay compiled in the repository and are tracked in `IRIS_MIGRATION.md`.
5. **Privileged operations remain behind a trusted boundary.** Renderer code does not receive raw Node/Electron authority.
6. **IRIS security invariants are preserved.** Encrypted persistence, OS-protected credentials, bridge authentication, capability permissions, filesystem containment, network policy, operation limits, and cancellation are migrated with the systems that depend on them.
7. **No generated IRIS build output is treated as source.** `server-dist/` and generated `electron/` files are regenerated from migrated TypeScript/CTS source.
8. **No old IRIS application shell is copied into the live renderer.** Orb/planet assets and duplicated panel/window UI are omitted.
9. **Dead/unwired code is documented, not deleted merely because a UI is not ready yet.**
10. **Existing editor behavior is kept intact unless an integration requires a narrow change.**

## Target architecture

```text
code-editor/
├─ src/                         Existing Code Editor renderer/UI
│  ├─ components/               Existing editor UI surfaces
│  ├─ editor/                   CodeMirror/editor behavior
│  ├─ hooks/                    Existing editor/workspace state
│  ├─ workspace/                Existing explorer tree helpers
│  ├─ platform/                 Migrated IRIS renderer-side platform
│  │  ├─ agent/                 Agent runtime, policies, tools, planning
│  │  ├─ providers/             Cloud/local provider adapters + registry
│  │  ├─ audio/                 Shared WAV/transcription helpers
│  │  ├─ autoSetup/             Model/provider setup logic
│  │  ├─ eval/                  Agent evaluation logic
│  │  └─ *.ts                   Stores, model routing, skills, bridge clients
│  ├─ platform-features/        Migrated non-shell feature controllers/hooks
│  ├─ platform-context/         Settings/agent status compatibility contexts
│  └─ types/                    Existing editor types + migrated platform globals
│
├─ backend/                     Migrated IRIS privileged local bridge/server
│  ├─ desktopBridge/
│  │  ├─ routes/                HTTP capability routes
│  │  ├─ services/              FS, semantic index, launcher, web, audio, agents
│  │  ├─ shared/                Security/boundary/process/network primitives
│  │  └─ storage/               Encrypted SQLite + crypto
│  ├─ bridgeServer.ts
│  ├─ builtinSkills.ts
│  └─ desktopBridgePlugin.ts
│
├─ electron/
│  ├─ main.cts                  Existing Code Editor window and native UI IPC
│  ├─ preload.cts               Existing `editor_api` + migrated platform bridge surface
│  ├─ platform/                 Migrated trusted IRIS Electron infrastructure
│  │  ├─ credentialStore.cts
│  │  ├─ storageKeyStore.cts
│  │  ├─ localBridge.cts
│  │  ├─ linuxPasswordStore.cts
│  │  ├─ security.cts
│  │  ├─ logger.cts
│  │  ├─ screenCapturePermissions.cts
│  │  ├─ duckDuckGoPageParser.cts
│  │  └─ duckDuckGoSearchWindow.cts
│  └─ ...existing editor native modules
│
├─ migrated-tests/              IRIS tests preserved for staged re-enablement
├─ docs/migration/
│  └─ MIGRATION_PLAN.md         This plan
└─ IRIS_MIGRATION.md            File/subsystem migration ledger + dead-code inventory
```

## Source-to-destination mapping

### A. Agent/runtime layer

IRIS source: `src/lib/agent/**`

Destination: `src/platform/agent/**`

Includes:
- agent identities and JSON helpers
- skill engine
- role/task bounds
- chat execution policy
- cloud/local-only usage policy
- controller prompt and structured decision parser
- local planner
- model health, monitoring, recovery, routing and tags
- RAG retrieval
- session runtime (`capabilityPolicy`, `continuity`, `finalization`, `limitPolicy`, `runtimeSupport`, `safetyPolicy`, `sessionRunner`, `todoTrace`, `toolBroker`, `webSearchPolicy`)
- canonical tool catalog, schemas and guards
- sub-agent types
- usage metrics
- vision/web research task wrappers

### B. Provider/model layer

IRIS source: `src/lib/providers/**` plus model/profile/setup helpers in `src/lib/`

Destination: `src/platform/providers/**` and `src/platform/*.ts`

Includes OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, local/Ollama-style provider support, provider discovery/configuration, model profiles, model health/routing, local model catalogs, auto-setup and cloud request policy.

### C. Agent state, memory, skills and orchestration

IRIS source: selected `src/lib/*.ts`

Destination: `src/platform/*.ts`

Includes:
- `agentRuntime.ts`
- `agentRunStore.ts`
- `subAgentRuntime.ts`
- `orchestrationClient.ts`
- `chatContextBuilder.ts`
- `chatSessionStore.ts`
- `localStorageStore.ts` (encrypted durable-store facade)
- `notesStorage.ts`
- skill markdown/profiles/rewards
- settings storage
- trusted sources
- STP builder
- key store
- logging/security/runtime helpers

### D. Semantic filesystem, web research, launcher, automation, audio, persistence

IRIS source: `server/**`

Destination: `backend/**`

The server tree is copied as a coherent unit because it is already internally modular and almost entirely uses relative imports. Its local import topology is intentionally preserved to reduce migration risk.

This brings across:
- encrypted SQLite persistence and schema
- AES-GCM/HKDF encryption
- semantic filesystem indexing/search
- text/document/PDF/image/video extraction/indexing
- semantic concepts/clustering
- launcher semantic index and launcher discovery
- file browser/thumbnail/archive services
- web search/history/research helpers
- network security and provider proxy policy
- agent bus and validation
- automation AI service and approval logic
- audio transcription service
- filesystem containment and operation limits
- process execution and unified diff support
- built-in skills

### E. Electron trusted infrastructure

IRIS source: selected `electron-src/*.cts`

Destination: `electron/platform/*.cts`

Copied:
- credential store
- storage-key store
- secure Linux password-store selection
- local bridge bootstrap/lifecycle
- logging/redaction helpers
- security helpers
- screen-capture permission helpers
- hidden DuckDuckGo Chromium search provider/parser

Omitted from the live migration because they are presentation-shell-specific:
- Orb window
- Orb window IPC
- launcher window shape
- IRIS multi-window manager
- IRIS window visibility manager
- duplicate IRIS editor IPC implementation

The Code Editor keeps its own existing native window/editor IPC.

## Integration work

### 1. Build graph

Add a dedicated `tsconfig.backend.json` and `build:backend` command. Backend source compiles to `backend-dist/`. Electron build continues to compile to `dist-electron/` and now includes `electron/platform/**`.

### 2. Local bridge bootstrap

The existing Code Editor Electron main process starts the migrated encrypted local bridge before loading the renderer:

```text
Electron ready
  → establish OS-backed storage master key
  → start authenticated 127.0.0.1 bridge on random port
  → load renderer with bridgePort + bridgeToken
```

Bridge startup is fail-closed: persistence is not silently downgraded to plaintext.

### 3. Provider credential vault

IRIS `credentialStore` is registered in the existing Electron main process. Renderer access remains a narrow provider-ID API exposed through preload.

### 4. Renderer bridge surface

The existing `editor_api` remains unchanged for editor features. Preload additionally exposes the subset of `orbitDesktop` required by migrated IRIS backend code:
- security permission get/update
- credential status/list/get/set/delete
- screen source lookup where available
- platform logging
- emergency-stop notification

The old Orb/window-management APIs are not exposed.

### 5. Encrypted renderer storage

Renderer startup hydrates IRIS's synchronous in-memory storage facade from the encrypted bridge before React mounts. Chat/agent settings and future migrated UI integrations can therefore use IRIS persistence without browser `localStorage`.


### 6. AI Settings and provider configuration

The existing Code Editor Settings modal now owns the migrated IRIS configuration surface. No old IRIS Settings presentation is imported. The AI tab provides Code Editor-native sub-sections for:

- secure provider credentials and explicit connection/model discovery;
- curated provider model lists;
- Orchestrator, Executor, Scout and Reviewer assignments plus per-role permission tiers;
- routing, native-tool, stateful-loop, failover and health policies;
- autonomy permissions and web/package guards;
- long-session/cloud/context/tool-repeat limits;
- skill runtime limits;
- semantic-index source/model/build/rescan/clear controls.

Provider secrets remain exclusively in Electron `safeStorage`. Persistent privileged capability toggles are sent to the trusted bridge before the corresponding setting is persisted. Opening Settings never performs provider traffic automatically. Existing Ollama Chat and speech-model fields remain available until AI Chat is migrated to `runAgentSession`.

Implementation/validation details are recorded in `AI_SETTINGS_PROVIDER_PLAN.md`.

### 7. Existing AI Chat integration

The current AI Chat visual surface is retained. Its backend is migrated from direct Ollama-only chat toward `runAgentSession` using the IRIS runtime. The current active-file attachment behavior is preserved, and the workspace root is supplied to the agent runtime so file/terminal activity can be scoped.

Approvals and richer timeline presentation can be progressively surfaced without replacing the editor shell. If an approval UI is not fully exposed in this migration, the relevant runtime remains present and is documented in the ledger.

### 8. Search integration

The current Search activity remains the UI surface. Semantic filesystem backend functionality is migrated now. UI integration is staged: exact workspace search remains existing/current behavior while semantic-index/search APIs are available to be wired into the Search panel. This is tracked explicitly, not discarded.

### 9. Existing editor native capabilities

The current editor filesystem, workspace watcher, terminal, diagnostics, browser and media IPC remain intact. Agent privileged operations use the migrated IRIS broker/bridge rather than being given direct access to human-facing terminal APIs.

## Dependency policy

- Keep the Code Editor's newer React/Electron/Vite/TypeScript versions unless a migrated IRIS subsystem demonstrably requires an older version.
- Add IRIS-only runtime dependencies required by copied backend/platform code.
- Do not downgrade the editor merely to match IRIS's historical lockfile.
- Regenerate `package-lock.json` from the merged manifest when dependency installation is available.
- Native dependencies (`sqlite3`, `sharp`, `node-pty`) must be rebuilt for Electron through the existing `postinstall`/electron-rebuild path.

## Validation plan

### Static migration checks
1. Verify every mapped source exists in the destination.
2. Verify copied backend/Electron platform files match IRIS source except intentional import/path edits.
3. Resolve `@/lib/...` imports to `@/platform/...` and feature/context aliases to migrated locations.
4. Search for unresolved IRIS UI-shell imports.
5. Search for references to omitted Orb/window shell modules from active integration paths.

### Type/build checks
- `npm run build:backend`
- `npm run build:electron`
- `npm run typecheck`
- `npm run build`

### Test checks
- Existing Code Editor tests must remain passing.
- Migrated IRIS tests are preserved separately first; compatible backend/runtime suites are re-enabled incrementally after the initial merge.
- Electron runtime smoke test remains part of the editor's verification pipeline.

### Runtime smoke checks
- Editor launches with unchanged shell/layout.
- Existing file open/save/workspace/terminal/browser behavior remains functional.
- Local encrypted bridge starts before the renderer.
- Renderer can hydrate encrypted durable storage.
- Credential status IPC is reachable.
- Agent bridge permissions default fail-closed.
- Existing Ollama fallback remains available until agent provider configuration is completed.

## Dead/unwired code policy

Every copied subsystem receives one of these statuses in `IRIS_MIGRATION.md`:

- **CONNECTED** — actively used by current editor UI/runtime.
- **AVAILABLE** — compiled and callable, but no dedicated editor UI yet.
- **PARTIAL** — some integration exists, remaining hooks are documented.
- **BLOCKED** — copied but awaiting dependency/API migration.
- **OMITTED-UI** — intentionally not copied because it belongs only to old IRIS presentation.

No migrated implementation is deleted merely because its original panel was not migrated.

## Post-migration follow-up sequence

1. Promote AI Chat from compatibility integration to durable autonomous project-run UX.
2. Wire semantic search results into the existing Search activity and workspace watcher.
3. Add resumable long-duration runs/checkpointing.
4. Surface plans/TODOs, timeline and approvals inside AI Chat; skill configuration is already available in Settings.
5. Enable multi-agent delegation/review and collision control.
6. Integrate model/cache management and local runtime work from Projects 1 and 3.
7. Re-enable/import compatible IRIS tests subsystem-by-subsystem.
8. Refactor only after behavior is stable in the new application.
