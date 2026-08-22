# Remaining Unwired / Reference IRIS Code

This file is the current dead/unwired-code ledger for the migrated IRIS platform inside Code Editor.

The product-integration migration is now complete apart from the dedicated multi-agent collision validation tracked in [`IRIS_MIGRATION.md`](../../IRIS_MIGRATION.md). Systems that were previously listed here as unwired — semantic search/RAG, workspace file authority, terminal execution, multi-agent orchestration, artifacts, audio, Vision, desktop Automation, runtime monitoring, launcher/local-system discovery, model routing/failover, tests and benchmarks — have since been connected to the Code Editor product shell.

This document therefore tracks only code that is intentionally retained without a current first-class UI path, compatibility/reference code, and optional future product surfaces. Its presence is not evidence that the main IRIS runtime is disconnected.

Nothing listed below should be removed solely because it is not mounted in the current UI. A real dead-code cleanup should be based on dependency-aware build/typecheck/test results plus an explicit reachability/export audit.

## Current connected runtime

The following migrated capabilities are connected and should **not** be treated as unwired:

- configured provider/model execution through Agent Chat;
- durable autonomous project runs, TODOs, checkpoints, pause/resume and restart recovery;
- editor-aware filesystem read/write/edit/patch authority and collision checks;
- brokered terminal/build/test/diagnostics execution;
- exact and semantic search, document/PDF/archive/media indexing, semantic concepts and RAG;
- encrypted conversations, project-run state, memory and artifact persistence;
- skills loading and project-specific skills;
- web research/search under the migrated network/security policy;
- model routing, health, failover and hybrid local/cloud execution;
- multi-agent Orchestrator/Executor/Scout/Reviewer execution, delegation, review and write leases;
- configurable audio transcription and Agent Chat voice input;
- local-only Vision screen understanding and permissioned exact-plan desktop Automation;
- CPU/RAM/GPU/process and model/agent/token runtime visibility;
- launcher/tool discovery and managed development-environment lifecycle;
- permission-scoped autonomous authority and bridge reauthorization;
- compatible migrated IRIS tests and the preserved benchmark harness.

## Intentionally unmounted optional UI/controller code

### Standalone Notes experience

**Locations:** `src/platform/notesStorage.ts`, `src/platform-features/notes/`

The migrated note storage and Notes-panel controller helpers remain available, but the old standalone IRIS Notes panel was deliberately not transplanted into Code Editor. Project/chat memory is already connected through the agent runtime. A dedicated human-facing Notes surface is optional future product work, not a migration requirement.

### Historical IRIS chat presentation helpers

**Location:** `src/platform-features/chat-ui/`

Some controller/normalization logic is reused by Code Editor-native approval/question and activity presentation. IRIS-specific timeline grouping/layout, export/history presentation and other old-shell helpers remain reference/compatibility code where they are not imported by the current Chat shell. The Code Editor AI Chat remains the canonical UI.

### Old panel-controller surfaces whose backend capability is already connected elsewhere

**Locations include:**

- `src/platform-features/files/`
- `src/platform-features/search/`
- `src/platform-features/skills/`
- `src/platform-features/launcher/`
- `src/platform-features/screen-capture/`
- selected helpers under `src/platform-features/audio/`

These directories were migrated because they contain reusable controller/helper logic. Their old IRIS panel presentation was intentionally omitted. The underlying capabilities are connected through Code Editor-native Explorer/Search/Settings/Chat/Runtime surfaces or through the trusted bridge; an unused historical controller does not imply the subsystem itself is unwired.

### Richer optional history/management UX

The encrypted persistence layer supports more data than the current compact UI exposes. Optional future surfaces could include richer conversation history browsing, deeper run/checkpoint inspection, saved web-research browsing, expanded skill-management UX, or Command Palette launcher integration. None of these is required for the completed backend migration.

## Compatibility code retained deliberately

A small amount of compatibility code remains for older callers or migration safety. Examples include legacy speech/Ollama helper paths and historical controller types/utilities. These should only be removed after a dependency-aware reachability audit proves they have no supported caller and the normal verification suite passes after removal.

## Historical reference material

`docs/iris-reference/` is an archive of source-IRIS documentation captured for migration/reference purposes. It describes the original IRIS product and may mention UI, architecture or TODOs that are intentionally not part of the Code Editor product. It is not a current Code Editor backlog.

Likewise, the P006/P007 and initial migration-plan documents under `docs/migration/` are historical implementation records. Current status is authoritative in:

1. [`IRIS_MIGRATION.md`](../../IRIS_MIGRATION.md) — subsystem/checklist ledger;
2. [`CURRENT_STATUS.md`](./CURRENT_STATUS.md) — detailed current integration status;
3. this file — intentionally unmounted/reference code only;
4. [`VALIDATION_REPORT.md`](./VALIDATION_REPORT.md) — completed and still-pending verification work.

## Remaining migration validation

The only unchecked development checklist item in `IRIS_MIGRATION.md` is dedicated multi-agent collision testing. After that, the remaining repository work described by the migration docs is dependency-aware verification/package validation in an installed environment.

No claim of “zero dead code” should be made until that verification and a dedicated reachability/dead-export audit have been run.