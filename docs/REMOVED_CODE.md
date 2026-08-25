# Removed Code Ledger

This file records deliberate post-migration cleanup in Code Editor. [`MIGRATION.md`](./MIGRATION.md) records what was brought in from IRIS; this ledger records what was later retired, simplified, or made safer after proving the old implementation was no longer justified.

Git history remains the recovery mechanism for every deletion.

## Removal standard

Cleanup is conservative: check normal imports and re-exports, string/IPC/tool/route registrations, worker/child-process filename launches, product fit, persistence/upgrade duties and security boundaries before deleting. Useful services are retained when only an old presentation layer is obsolete.

---

## 2026-08-25 — Old IRIS panels and presentation controllers

**Commit:** `d5ec71105e54e546f2a9be792be7a007c687d217` — `Remove obsolete IRIS panel controllers`

Removed roughly **6,163 lines across 24 source/test files** belonging to unmounted Files, Search, Notes, Launcher and Skills panel controllers plus unused historical Chat layout/export/timeline helpers and tests dedicated to those presentation paths.

The underlying semantic search, notes storage, launcher services, skills runtime and current Agent Chat services were retained.

---

## 2026-08-25 — Orb/window-shell compatibility

**Commit:** `1cf430afecdc4aa1ec3a008d2b4cd446fe91b292` — `Remove obsolete IRIS Orb shell compatibility`

Removed roughly **1,304 source/test lines** from the old Orb/multi-window presentation model: Orb/clipboard contexts, window-role wrappers, old renderer capture helpers, stale bridge declarations and their historical tests.

Current settings, emergency stop, credentials, authenticated screen capture and the editor-owned Electron window remained intact.

---

## 2026-08-25 — Dead runtime compatibility and generated Vite cache

**Commit:** `3e04a7564d41d0fab8edb6eeeaf64a472982900a` — `Remove dead runtime compatibility code`

Removed **1,362 source/test lines** plus tracked `.vite/` cache metadata:

- superseded `agent/chatExecutionPolicy.ts`;
- unused `eval/evalRunner.ts` and `evalTasks.ts`;
- unused migrated UI `utils.ts`;
- obsolete Electron IRIS logger/security/screen-permission helpers;
- tests dedicated to those dead modules.

Worker/child-process files were explicitly protected from import-count-only deletion.

---

## 2026-08-25 — Inactive migrated tests and stale benchmark snapshots

**Commit:** `4fcb6135c097ffd687a9fbc70f5d4e5f529e7366` — `Retire inactive migrated test archives`

Removed migrated IRIS tests that were outside the supported `vitest.iris.config.ts` execution surface and targeted deleted source-product UI/settings/editor/window behavior. Removed stale generated `benchmark-results/iris/` snapshots while preserving the live benchmark harness under `benchmarks/iris/`.

Still-useful coverage was ported into the normal Code Editor suite rather than discarded, including credential-store, Linux password-store, storage-key, DuckDuckGo parser and Chat attachment coverage.

---

## 2026-08-25 — Obsolete settings and Chat presentation compatibility

**Commit:** `51e82953f3165329e94cc63e188eb4b41bc0872e` — `Trim obsolete settings and Chat compatibility`

Removed the remaining unmounted IRIS settings presentation layer and old appearance implementation:

- `src/platform-context/orb/SettingsContext.tsx`;
- old Orb settings-hook location/context behavior;
- `src/platform/orbAppearance.ts`.

The active standalone settings behavior was retained as `src/platform-context/useAgentSettings.ts` and exposed through `AgentSettingsContext.ts`.

The same commit removed dead partial Chat presentation APIs (old timeline/thought-group/agent-segment/scroll/layout/display machinery) and the browser `File`/canvas attachment preparation branch superseded by the trusted Electron attachment reader.

---

## 2026-08-25 — Vite bridge compatibility harness

**Commit:** `a38084944f7b9443f03d6c7341f38448a573d0ea` — `Remove obsolete Vite bridge compatibility harness`

Removed:

- `backend/desktopBridgePlugin.ts`;
- `backend/desktopBridge/middleware.ts`;
- `backend/desktopBridge/errors.ts`;
- the plugin-specific migrated test.

Useful route/security assertions were ported to the current bridge router through a test-only route harness, so the production Electron-owned authenticated bridge is now the single real implementation under test.

---

## 2026-08-25 — Legacy direct Ollama Chat IPC

**Commits:**

- `f822cc8462d464733f51500a0e0f1668bfde1455` — `Remove legacy Ollama Chat renderer API`
- `1e5ee13a922de6616026a583ad57e7bc2228ae07` — `Remove legacy Ollama Chat main-process path`

Removed the superseded direct conversational path (`start_chat`, `cancel_chat`, `ai:chat-*` events/handlers and direct Ollama streaming helper/types). Agent Chat already runs through the IRIS session/runtime path.

Retained local model discovery, capability inspection, speech-model management/status and transcription.

---

## 2026-08-25 — Inert renderer logging facade

**Commit:** `09e0fe4c62f00a3b513731c0f0ec8510490f9236` — `Remove inert renderer logging facade`

Removed `src/platform/logger.ts` and passive AI-service logging calls that targeted a desktop logging bridge no longer exposed by the current preload. Provider routing, retries, cloud budgets, timings returned by providers and user-visible agent activity were not removed.

---

## 2026-08-25 — Stale migrated settings fields

**Commit:** `4387a2bc3db2e06ede99824ec791b16537927f6c` — `Retire stale migrated settings fields`

Stopped normalizing/persisting historical presentation and unused settings:

- `orb_size`;
- `orb_texture`;
- `appearance_theme`;
- `appearance_accent`;
- `agent_dev_mode`;
- `chat_max_retained`;
- `max_note_chars`;
- `vision_auto_execute`;
- old global `hotkey`;
- `chat_auto_title`.

Old persisted objects still load safely; retired keys are simply dropped during normalization.

`agent_permission_tier_overwatcher` was **not** removed: deeper review found live dynamic role-based reads/writes in the active multi-agent permission system.

---

## 2026-08-25 — Unused package dependencies and lockfile synchronization

**Commits:**

- `4f52037492493866a29aa180ca8c2fc9b47038a2` — `Remove unused package dependencies`
- `4a89ea93c12307a115dfbc1c5ed0819a2ed86747` — `Finish approved cleanup synchronization`

Removed unused top-level dependencies and their generated lockfile entries:

- `codemirror` (the editor uses individual `@codemirror/*` packages);
- `clsx`;
- `tailwind-merge`;
- `lucide-react`;
- `@vitest/coverage-v8`.

The second commit regenerated `package-lock.json` from the cleaned manifest so package metadata is synchronized rather than leaving stale root declarations behind.

---

## 2026-08-25 — Small dead helper and web-search typo found during typing

**Commit:** `403ca0323de9e9b89e3c448c4fa58b07c85e462a` — `Tighten small cleanup leftovers`

Removed unused `realpathOrSelf()` from `backend/desktopBridge/shared/filesystemBoundary.ts`.

The focused type-safety review also exposed a real migrated typo in the Tavily credential path (`getey(...)`); it was corrected to the existing `getKey(...)` credential lookup without changing provider policy.

---

## 2026-08-25 — Focused `@ts-nocheck` reduction

These commits remove migrated type-check escape hatches only after the actual local contracts were typed and strict-checked:

- `2a08ab0b75c9a0672ac20fe733901b6e5eaa48e7` — `Restore type checking for skill Markdown helpers`
- `8ddc74d24aa57c5e8e03e2515bd0cee98246c9f3` — `Restore type checking for continuity helpers`
- `1d4fa30a66ac892d1d3093c57adcdba4e95a2fc1` — `Restore type checking for web search policy`
- `7a121b08fbf281e0bec4d3bf39a9c767bd13ade6` — `Restore type checking for safety policy`
- `b3b8e8c24166e7c31902d8cf0f6b999392c58e87` — `Restore type checking for limit policy`

This was deliberately a **focused** reduction, not a mass removal of `@ts-nocheck`. Large runtime files remain untouched until their real type debt can be addressed without destabilizing agent behavior.

Local strict/no-resolve checks found no non-import TypeScript diagnostics in the newly typed policy/helper files; `skillMarkdown.ts` also passed a standalone strict TypeScript check.

---

## 2026-08-25 — Final semantic-index dead declarations

**Commit:** `4a89ea93c12307a115dfbc1c5ed0819a2ed86747` — `Finish approved cleanup synchronization`

Removed the final two confirmed dead declarations from the active semantic-index implementation without changing indexing behavior:

- unused `ExtractedFileText` and its now-unneeded `FileExtractionResult` type import;
- unused local `relativePath` inside `shouldSkipProtectedPath()`.

The same one-shot verification run regenerated the dependency lockfile and then completed successfully with:

- `npm ci --ignore-scripts`;
- Prettier verification for the changed source and lockfile;
- `npm run lint`;
- `npm run typecheck`;
- `git diff --check`.

The temporary cleanup workflow deleted itself in the resulting commit, so no maintenance-only automation remains in the repository. A repository-wide Prettier check was not claimed: an earlier attempt exposed unrelated pre-existing formatting drift in other files, so final verification was scoped to the files changed by this cleanup while lint and type checking still ran across their normal configured surfaces.

---

## Intentionally retained after review

The cleanup process explicitly continues to protect:

- active `agentRuntimeLegacy.ts`, `toolBrokerLegacy.ts` and other “Legacy”-named implementation that still has live callers;
- workers and child processes loaded by filename;
- upgrade/legacy encrypted-storage cleanup;
- notes, launcher and skills runtime services;
- provider adapters and routing/failover infrastructure;
- `benchmarks/iris/` source;
- layered security, permission and workspace-containment checks.

Automatic model setup/hardware-fit code, duplicate agent-bus shared code and large runtime decomposition remain product/architecture decisions rather than dead-code deletions.
