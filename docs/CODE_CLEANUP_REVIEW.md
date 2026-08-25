# Code Cleanup Review

**Status:** Active cleanup backlog  
**Last updated:** 2026-08-25

This document now contains only cleanup work that is still unresolved. Completed and approved cleanup is moved to [`REMOVED_CODE.md`](./REMOVED_CODE.md); migration provenance remains in [`MIGRATION.md`](./MIGRATION.md).

## Remaining implementation cleanup

### 1. Prune `package-lock.json` after dependency removal

The approved unused root packages have been removed from `package.json`:

- `codemirror`
- `clsx`
- `tailwind-merge`
- `lucide-react`
- `@vitest/coverage-v8`

The generated `package-lock.json` still needs its matching orphaned/root entries pruned and committed. An offline `npm install --package-lock-only --ignore-scripts --offline` against the cleaned manifest produced the expected lockfile locally, so this is repository synchronization work rather than an unresolved dependency decision.

Do not consider the dependency cleanup fully closed until the lockfile is committed and the normal installed checkout has run verification.

### 2. Two tiny declarations in `fileSemanticService.ts`

The deeper audit found two harmless dead declarations in the large active semantic-index implementation:

- unused `ExtractedFileText` and its now-unneeded `FileExtractionResult` type import;
- unused local `relativePath` inside `shouldSkipProtectedPath()`.

These are safe cleanup candidates, but they are deliberately left pending rather than forcing a full 100k+ source-file replacement through a constrained editing path. Remove them during the next normal full-file/typecheck edit of `backend/desktopBridge/services/fileSemanticService.ts`.

---

## Product/architecture decisions intentionally left for later

These were identified by the repository-wide review but were **not** part of the approved destructive batch.

### Automatic model setup and hardware-aware model selection

- `src/platform/autoSetup/autoSetupEngine.ts`
- `src/platform/autoSetup/autoSetupService.ts`
- `src/platform/providers/localRuntimePolicy.ts`

They have weak current UI reachability but plausible product value for an agentic editor. Keep until the product explicitly decides whether one-click/hardware-aware setup should remain.

### Duplicate agent-bus shared implementation

- `backend/desktopBridge/shared/agentBusShared.ts`
- `src/platform/agent/agentBusShared.ts`

This is duplication across separate TypeScript build roots, not dead code. Consolidation needs a shared-source/build-layout decision or a parity test.

### Large `*Legacy` implementation layers

Files such as `agentRuntimeLegacy.ts` and `toolBrokerLegacy.ts` are active implementation. “Legacy” describes provenance, not reachability. Cleanup here is a tested decomposition/refactor project, not deletion.

### Large-file decomposition

Large runtime/bridge files should be decomposed only where coherent tested boundaries already exist. Line count alone is not a reason to extract or delete code.

---

## Explicit keep rules

Future cleanup should continue to protect:

- worker/child-process entry modules loaded by filename;
- upgrade/legacy encrypted-storage cleanup while old user data remains supported;
- notes, launcher and skills runtime services used by agents even without dedicated panels;
- provider adapters and routing/failover infrastructure;
- benchmark source under `benchmarks/iris/`;
- thin backend route/service seams that are useful future decomposition boundaries;
- layered security, permission and workspace-containment checks where duplication is defense-in-depth.

## Safe deletion standard

Before deletion, verify static and indirect callers, IPC/tool/route registrations, worker filename launches, product fit, compatibility duties, security boundaries, active tests/benchmarks and the availability of meaningful verification. Ambiguous code stays until the ambiguity is resolved.
