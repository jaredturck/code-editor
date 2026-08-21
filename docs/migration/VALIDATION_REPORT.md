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
