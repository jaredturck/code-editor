# IRIS Migration Validation Report

## Scope

This report records the validation performed on the bulk IRIS → Code Editor migration before packaging. It distinguishes checks that were completed in the migration environment from checks that require an installed dependency tree / normal npm registry access.

## Source archive integrity

### IRIS

- Source archive: `Archive(20260821-123834).zip`
- Archive files: **695**
- Extracted files checked against archive: **695/695**
- Missing extracted files: **0**
- SHA-256 content mismatches: **0**

### Code Editor

- Source archive: `Archive.tar.gz`
- Archive files: **225**
- Extracted files checked against archive: **225/225**
- Missing extracted files: **0**
- SHA-256 content mismatches: **0**

## Migration inventory validation

`docs/migration/MIGRATED_FILES.md` contains **376 explicit IRIS source → Code Editor destination mappings**.

Validation result:

- Missing mapped IRIS sources: **0**
- Missing mapped destinations: **0**
- Files marked `copied verbatim` with content mismatch: **0**
- Files marked `reference copy` with content mismatch: **0**

The complete IRIS `server/` tree was migrated to `backend/` as one coherent unit:

- IRIS server files: **71**
- Migrated backend files: **71**
- Missing/extra files: **0 / 0**
- SHA-256 content mismatches: **0**

## Existing Code Editor preservation

No original Code Editor file was deleted by the migration.

Across the original 225-file project, only these **9 existing files** were intentionally changed:

- `README.md`
- `electron/main.cts`
- `electron/preload.cts`
- `electron/tsconfig.json`
- `package-lock.json`
- `package.json`
- `src/main.tsx`
- `tsconfig.app.json`
- `vite.config.ts`

The original UI/behavior directories below remain byte-for-byte identical to the supplied Code Editor source:

- `src/components/` — **42/42 files identical**
- `src/editor/` — **5/5 files identical**
- `src/hooks/` — **4/4 files identical**
- `src/workspace/` — **1/1 files identical**

## Migrated implementation totals

| Area | Files | Lines |
| --- | ---: | ---: |
| `src/platform/` | 81 | 33,966 |
| `src/platform-context/` | 4 | 406 |
| `src/platform-features/` | 26 | 5,921 |
| `backend/` | 71 | 27,295 |
| `electron/platform/` | 9 | 2,007 |
| `migrated-tests/iris/` | 143 | ~19,721 |
| `benchmarks/iris/` | 20 | 4,501 |

The packaged migration tree contains **609 files** before archive creation and is approximately **13 MiB** unpacked (without `node_modules`).

## TypeScript syntax validation

The globally available TypeScript parser was used to parse the TypeScript-family sources in:

- `src/`
- `backend/`
- `electron/`
- `tests/`
- `migrated-tests/iris/`
- `benchmarks/iris/`

Result:

- Parsed files: **420**
- Physical lines parsed: **108,406**
- TypeScript parser errors: **0**

This is a syntax check, not a substitute for the dependency-aware project typecheck.

## Local import validation

A static resolver inspected relative imports and the `@/` source alias across the active migrated source (`src/`, `backend/`, `electron/`, and benchmarks), including NodeNext `.js`/`.cjs` imports that resolve to TypeScript source files.

Result:

- Unresolved local imports: **0**

External package imports require the normal npm dependency installation and are therefore outside this static check.

## Package manifest / lockfile structural validation

- `package.json` parses successfully.
- `package-lock.json` parses successfully.
- Root `dependencies` in the lockfile match `package.json` names and requested versions.
- Root `devDependencies` in the lockfile match `package.json` names and requested versions.
- Every direct dependency/devDependency has a corresponding `node_modules/<package>` entry in the lockfile.

The lockfile still requires normal npm validation because it was assembled from the supplied Code Editor and IRIS lockfiles in an environment without registry access.

## Dependency-aware validation not completed

The supplied archives do not contain `node_modules`.

An offline `npm ci --ignore-scripts --offline` was attempted. npm reached dependency resolution but stopped because the required Vitest package response was not available in the local npm cache (`ENOTCACHED`). No partial `node_modules` directory was left behind.

Because dependencies could not be installed, the following commands could not be truthfully completed in this environment:

- `npm run build:backend`
- `npm run build:electron`
- `npm run typecheck`
- `npm test`
- `npm run test:electron-runtime`
- `npm run build`
- `npm run verify:full`

These remain the first validation commands to run in a normal development environment with registry access.

## Generated output note

The supplied Code Editor archive included historical `dist/` and `dist-electron/` output. These directories are retained in the migration package for source-archive completeness but are **stale after the migration** and are ignored by `.gitignore`. They must be regenerated from the migrated source before release or direct execution of packaged build output.

IRIS generated `server-dist/` and generated Electron output were intentionally not migrated as source. The migrated backend builds into `backend-dist/`.

## Final migration status

The bulk migration is structurally complete for the scope documented in `MIGRATION_PLAN.md` and `MIGRATED_FILES.md`:

- IRIS reusable backend/platform code has been copied/adapted into the Code Editor tree.
- Existing Code Editor presentation remains intact.
- Secure platform/bootstrap integration has been added at the native/startup boundary.
- Backend functionality without a current editor surface remains preserved and explicitly tracked in `UNWIRED_BACKEND.md`.
- Full dependency-aware build/runtime verification remains pending solely because the dependency tree could not be installed in this environment.


## AI Settings & Provider Configuration patch validation

The first post-migration product-integration patch connects the existing Code Editor Settings modal to migrated IRIS provider/model/agent configuration while preserving the existing Settings shell.

### Files introduced/changed by this patch

- `src/components/SettingsModal.tsx`
- `src/components/settings/AISettingsPanel.tsx`
- `src/settings/aiSettings.ts`
- `tests/AISettingsPanel.test.tsx`
- `tests/aiSettings.test.ts`
- `docs/migration/AI_SETTINGS_PROVIDER_PLAN.md`
- migration/status documentation

### Static validation

- TypeScript-family files parsed across active `src/`, `backend/`, `electron/` and `tests/`: **265**
- Physical lines parsed: **86,140**
- Parser errors: **0**
- Unresolved relative/`@/` local imports: **0**

### Focused tests added

- role-primary replacement preserves secondary mesh bindings and other roles;
- clearing a role does not mutate unrelated roles;
- curated model lists are normalized/deduplicated;
- credential vs transient provider failures are classified separately;
- numeric AI settings are bounded;
- AI Settings navigation remains inside the existing Settings shell;
- legacy local Chat/speech fields remain editable;
- provider secrets are written through the secure credential store rather than settings state;
- trusted bridge permission update succeeds before capability state is persisted.

### Security review result

No provider secret is added to Code Editor settings, persisted provider-validation metadata, search terms or migration documentation. Provider calls remain explicit user actions. Privileged permission grants/revocations fail closed if the trusted desktop permission bridge is unavailable or rejects the update. Indexed-location selection continues to grant discovery/index authority only, not agent write authority.

### Dependency-aware validation

The migration environment still does not contain the complete project dependency tree, so the new Vitest tests, project TypeScript typecheck, Prettier/Oxlint pass and production build cannot be executed truthfully here. The patch has passed syntax/import/static review; the next local verification command remains:

```bash
npm run verify:full
```


## Core Agent Chat Integration patch validation (P006)

P006 replaces the Code Editor's legacy direct Ollama Chat request path with the migrated IRIS agent runtime while retaining the existing Chat shell and deliberately limiting this first agent-facing milestone to research/context capabilities.

### Files introduced/changed by this patch

- `src/App.tsx`
- `src/chat/agentChat.ts`
- `src/components/AIChatPanel.tsx`
- `src/hooks/useAIChat.ts`
- `src/platform/agent/runtime/capabilityPolicy.ts`
- `src/types/editor.ts`
- `tests/AIChatPanel.test.tsx`
- `tests/agentCapabilityScope.test.ts`
- `tests/agentChat.test.ts`
- `docs/migration/CORE_AGENT_CHAT_PLAN.md`
- `docs/migration/CORE_AGENT_CHAT_REVIEW.md`
- migration/status documentation

### Static validation

- TypeScript-family files parsed across active `src/`, `backend/`, `electron/` and `tests/`: **269**
- Physical lines parsed: **87,226**
- Parser errors: **0**
- Relative/`@/` imports inspected: **795**
- Intentional generated-output test imports: **3**
- Unresolved source imports: **0**
- Diff whitespace errors: **0**
- Legacy direct Chat request/model-picker references in the migrated Chat controller/panel: **0**
- P006 session-allowlisted tools: **14**
- Allowlisted names missing from the canonical IRIS tool catalog: **0**

A dependency-aware TypeScript check was also attempted with the globally available compiler. It reached project configuration loading but stopped at the missing installed dependency type `vite/client`; this is an environment/dependency-tree gap rather than a reported P006 source diagnostic.

### Focused tests added

- configured Orchestrator provider/model/key-slot resolution;
- research/context-only session tool allowlist construction;
- denial of excluded normal and `internal` catalog tools at capability-policy evaluation;
- denial of Chat-originated persistent machine-permission grants;
- legacy persisted image-attachment restoration;
- reasoning/activity sanitization and bounded observable activity;
- configured Orchestrator presentation in the existing Chat shell;
- approval/question card behavior;
- preservation of active-file attachment, manual attachment and voice controls.

### Security review result

The changed renderer-to-agent authority path was reviewed as security-sensitive. The review corrected three issues before packaging: the session allowlist now applies to catalog entries marked `internal`; direct filesystem/search/RAG exposure is deferred because the current trusted bridge root is the user's home directory rather than a workspace authorization boundary; and Core Agent Chat refuses persistent machine-permission grants so an approval request cannot widen P006 authority. Provider keys remain Electron-secured and ephemeral at runtime, raw reasoning events are discarded, raw tool output previews are excluded from activity metadata, and excluded file/terminal/multi-agent/host-control tools remain broker-blocked. Full details are in `CORE_AGENT_CHAT_REVIEW.md`.

### Bug/style review result

The review corrected legacy image-attachment normalization, verified cancellation and approval cleanup, bounded activity history to 200 items, and confirmed clear-chat removes the encrypted active chat/warm state. A changed-file whitespace/style pass reported no whitespace errors. New Code Editor files follow the existing no-semicolon style while the migrated IRIS policy file retains its surrounding style.

### Dependency-aware validation

The recovery environment does not contain the project's installed `node_modules`, and its npm cache is insufficient to reconstruct the dependency tree offline. Vitest, Oxlint, Prettier, Electron/backend builds and the full project typecheck therefore cannot be truthfully executed here. After applying P006, run:

```bash
npm run verify:full
```

Any dependency-aware failure from that command should be treated as the first corrective item before the next feature milestone.

## Planning and Autonomous Project Runs patch validation (P007)

P007 adds durable Automatic/Plan-first project runs to Agent Chat while retaining the P006 research/context-only authority boundary. The implementation adds a module-owned lifecycle controller, encrypted per-chat checkpoints, structured TODO display, Pause/Resume/Cancel, restart recovery to an explicit interrupted state, elapsed/budget visibility and completion reconciliation.

### Changed integration areas

- `src/chat/projectRunController.ts`
- `src/chat/agentChat.ts`
- `src/hooks/useAIChat.ts`
- `src/components/AIChatPanel.tsx`
- `src/platform/chatSessionStore.ts`
- focused Chat/agent/project-run tests
- autonomous-run planning/review and migration documentation

### Static validation

- TypeScript-family files parsed across active `src/`, `backend/`, `electron/` and `tests/`: **271**
- Physical lines parsed: **88,261**
- Parser errors: **0**
- Relative/`@/` imports inspected: **799**
- Unresolved source imports: **0**
- Changed-file trailing-whitespace errors: **0**
- Changed text files missing a final newline: **0**

A dependency-independent executable controller smoke test passed begin/checkpoint/pause/resume/cancel behavior, bounded checkpoint normalization and interrupted restart recovery.

### Security and bug review result

P007 does not widen agent authority: the P006 per-session tool allowlist and disabled file/terminal/screen permissions remain in force. Durable checkpoint payloads are bounded and normalized before encrypted persistence, provider credentials and raw hidden reasoning are excluded, persisted active runs never auto-resume after restart, and high-frequency stream events are not checkpointed. Review also added a concurrent-run guard, refreshed provider/model attribution on resume and changed unresolved completion state from terminal failure to resumable pause. Full details are in `AUTONOMOUS_PROJECT_RUNS_REVIEW.md`.

### Dependency-aware validation

`tsc -b --pretty false` was attempted in the recovery environment but stopped before source checking because the installed dependency tree is unavailable (`vite/client` and Node type definitions are missing). Vitest, Prettier, Oxlint, Electron/backend builds and the complete verification sequence must therefore be run on an installed checkout:

```bash
npm run verify:full
```

