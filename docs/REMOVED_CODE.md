# Removed Code Ledger

This file records deliberate source-code removals from the Code Editor after the IRIS migration was completed.

The migration history in [`MIGRATION.md`](./MIGRATION.md) explains what was brought into the repository. This ledger records the inverse: code that was later removed because it was unreachable, presentation-only, superseded by Code Editor-native functionality, or otherwise no longer justified.

## Removal criteria

Code is removed conservatively. Before deleting a candidate, the cleanup pass should establish as many of the following as apply:

1. **No live caller.** Static imports/re-exports and obvious indirect registrations do not reach the candidate from the active Code Editor runtime.
2. **No unique product capability is lost.** The code either duplicates an existing Code Editor surface or is presentation/controller scaffolding around services that remain available elsewhere.
3. **It does not belong in the current product.** Old IRIS shell/panel presentation is a strong removal candidate because Code Editor owns the GUI.
4. **Useful underlying services are preserved.** A dead panel hook should not cause deletion of storage, search, launcher, skills, semantic-index or agent services that are still called by the runtime.
5. **Tests are considered part of the call graph.** Historical tests whose only purpose is exercising deliberately removed UI/controller code may be removed with that code. Active regression coverage is retained.
6. **Deletion does not introduce broken local imports.** The source tree is re-scanned after removal, with newly unresolved imports treated as a blocker.
7. **Ambiguous code is retained.** If a file appears obsolete but still has a caller, a plausible product role, dynamic registration risk or unclear compatibility purpose, it stays until a focused review proves otherwise.

Git history remains the recovery mechanism for anything removed here.

---

## 2026-08-25 — Obsolete IRIS panel/controller layer

**Commit:** `Remove obsolete IRIS panel controllers`  
**Source removed:** 4,691 lines across 16 files  
**Historical tests removed:** 1,472 lines across 8 files  
**Total removed:** 6,163 lines across 24 files

### Why this was removed

These files were migrated from the old IRIS presentation layer but were never mounted by the live Code Editor application. Call-graph checks found no active application imports for the panel/controller entry points. The only remaining references were self-contained dependencies inside the same dead controller clusters and historical migrated tests.

The functionality underneath the old panels was **not** removed. Code Editor-native surfaces and the agent runtime still use the relevant storage/services directly. For example:

- semantic filesystem/search services remain active through Code Editor Search/RAG and agent tools;
- `src/platform/notesStorage.ts` remains active for agent memory/continuity;
- launcher catalog/backend services remain active for agent/local-system functionality;
- skill parsing/profiles/runtime remain active for agent skills;
- current Agent Chat approval/types/constants remain active;
- screen-capture and audio feature helpers remain active.

### Files removed

#### Old Files panel controllers

- `src/platform-features/files/useFilePanel.ts`
- `src/platform-features/files/useFileThumbnail.ts`

The Code Editor already has its own Explorer, file viewers and Search/RAG surfaces. The old IRIS graphical file-panel state/controller was not called by the current application.

#### Old Search panel controllers

- `src/platform-features/search/useSearchPanel.ts`
- `src/platform-features/search/useProgressEventDisplay.ts`

The current Code Editor Search integration does not use the old IRIS Search panel controller. Semantic/index services remain intact underneath the editor-native search path.

#### Old Notes panel controllers

- `src/platform-features/notes/useNotesPanel.ts`
- `src/platform-features/notes/useNoteTranscription.ts`
- `src/platform-features/notes/transcriptInsertion.ts`

The standalone IRIS Notes presentation is not part of Code Editor. Note storage used by the agent runtime remains in `src/platform/notesStorage.ts`.

#### Old Launcher panel controller

- `src/platform-features/launcher/useLauncherPanel.ts`

The old launcher panel/UI state was unused. `src/platform/launcherCatalog.ts` and backend launcher services were retained because the agent runtime and local-system tooling still call them.

#### Old Skills panel controller

- `src/platform-features/skills/useSkillsPanel.ts`

The old IRIS Skills panel was unused. Skill Markdown parsing, profiles, project-skill loading and runtime skill execution remain active.

#### Unused old Chat presentation helpers

- `src/platform-features/chat-ui/controllers/useChatDesktopLayout.ts`
- `src/platform-features/chat-ui/controllers/useChatPanelController.ts`
- `src/platform-features/chat-ui/controllers/useChatScrollController.ts`
- `src/platform-features/chat-ui/utils/chatExport.ts`
- `src/platform-features/chat-ui/utils/chatPersistence.ts`
- `src/platform-features/chat-ui/utils/timeline.ts`
- `src/platform-features/chat-ui/utils/usage.ts`

These helpers had no live callers. The current Agent Chat still uses the separate approval controller, approval utilities, shared types and timeout constants, which were retained.

### Historical migrated tests removed with the dead code

- `migrated-tests/iris/components/panels/FilePanel.test.tsx`
- `migrated-tests/iris/components/panels/NotesPanel.test.tsx`
- `migrated-tests/iris/features/files/useFilePanel.test.tsx`
- `migrated-tests/iris/features/notes/transcriptInsertion.test.ts`
- `migrated-tests/iris/features/notes/useNoteTranscription.test.tsx`
- `migrated-tests/iris/features/notes/useNotesPanel.test.tsx`
- `migrated-tests/iris/features/search/useProgressEventDisplay.test.tsx`
- `migrated-tests/iris/features/search/useSearchPanel.test.tsx`

These tests exercised omitted IRIS UI/controller behavior rather than the supported Code Editor runtime. Two of the panel tests already referenced source components that do not exist in the Code Editor tree.

### Verification evidence

- TypeScript parser pass after deletion: **464 files, 0 parse errors** across active source/test TypeScript-family files.
- Deleted-path reference scan: **no remaining source/test imports** of the removed modules.
- Local-import comparison against the pre-cleanup snapshot: **0 newly unresolved imports**; two pre-existing unresolved old-panel test imports disappeared because those obsolete tests were removed.
- No runtime service used by current Code Editor surfaces was removed in this batch.

A full dependency-backed verification run should still be performed in the normal installed development checkout before treating broader cleanup as release-ready.

---

## 2026-08-25 — Obsolete IRIS Orb/window-shell compatibility

**Commit:** `Remove obsolete IRIS Orb shell compatibility`  
**Source removed:** 716 lines across 8 files  
**Historical tests removed:** 588 lines across 6 files  
**Total removed:** 1,304 lines across 14 deleted files, plus 40 stale compatibility lines removed from `AgentSettingsContext.ts` and `src/types/platform.d.ts`

### Why this was removed

This cluster existed to support the original IRIS Orb and multi-window shell. The Code Editor has a single editor-native Electron window and does not mount the old Orb providers or window-mode UI.

The call graph showed that, after the old Chat/panel controllers were removed, these modules were reachable only from each other and from archived IRIS UI tests:

- the Orb shell and clipboard providers had no live renderer consumers;
- `useOrbShell` and `useClipboardHistory` were only stale compatibility re-exports;
- `runtimeMode.ts` only classified obsolete Orb/workspace/editor IRIS window roles;
- `desktopShellWindow.ts` wrapped window-control preload methods that the current Code Editor preload does not expose, aside from capabilities now consumed directly elsewhere;
- the old browser/Electron `getDisplayMedia` capture strategy was not used by current vision. Current agent screen capture uses `src/platform/screenCaptureBridge.ts` and the authenticated backend screen route.

### Files removed

#### Orb/clipboard context compatibility

- `src/platform-context/orb/ClipboardContext.tsx`
- `src/platform-context/orb/OrbShellContext.tsx`
- `src/platform-context/orb/useClipboardHistory.ts`
- `src/platform-context/orb/useOrbShell.ts`

The active settings context remains. `src/platform-context/AgentSettingsContext.ts` was narrowed to export only the settings provider/hooks that still have live callers. `src/types/platform.d.ts` was also narrowed to remove old Orb/window-control bridge methods that the current preload no longer exposes, while retaining the current security, credential, screen-source and emergency-stop contracts.

#### Old desktop shell/window wrappers

- `src/platform/desktopShellWindow.ts`
- `src/platform/runtimeMode.ts`

These modules represented the old IRIS Orb/workspace/editor window model. The Code Editor owns its Electron window behavior directly.

#### Old renderer screen-capture presentation helpers

- `src/platform-features/screen-capture/captureStrategies.ts`
- `src/platform-features/screen-capture/types.ts`

Current screen understanding remains supported through `src/platform/screenCaptureBridge.ts`, Electron screen-source access, and the authenticated backend capture route.

### Historical migrated tests removed with the dead code

- `migrated-tests/iris/components/orb/FloatingOrb.test.tsx`
- `migrated-tests/iris/components/orb/OrbPills.test.tsx`
- `migrated-tests/iris/context/OrbContext.test.tsx`
- `migrated-tests/iris/lib/desktopShellWindow.test.ts`
- `migrated-tests/iris/lib/runtimeMode.test.ts`
- `migrated-tests/iris/lib/screenCaptureErrors.test.ts`

These tests target the intentionally omitted IRIS Orb/multi-window presentation or the obsolete renderer capture strategy. Several already referenced old source components/paths that do not exist in Code Editor.

### Verification evidence

- TypeScript parser pass after this deletion: **450 files, 0 parse errors** across active source/test TypeScript-family files.
- Local-import comparison against the preceding cleanup state: **0 newly unresolved imports**.
- Three pre-existing unresolved historical UI-test imports disappeared with the obsolete tests.
- `src/platform/screenCaptureBridge.ts` remains live through `src/platform/desktopBridge.ts`, preserving current agent screen capture.
- `window.orbitDesktop.onAgentStopRequest`, security permissions, and credential APIs remain used directly by current runtime code; they were not removed.
