# Retained / Reference IRIS Code

The required IRIS → Code Editor migration is complete. This file tracks migrated code that is intentionally retained without a first-class Code Editor UI path, plus compatibility/reference material that should not be mistaken for unfinished migration work.

Nothing listed here should be removed solely because it is not mounted in the current UI. Cleanup should be based on an explicit import/export reachability audit and a passing dependency-aware verification suite.

## Connected runtime

The following migrated capabilities are connected and are **not** unwired:

- configured provider/model execution through Agent Chat;
- durable autonomous project runs, TODOs, checkpoints, pause/resume and restart recovery;
- editor-aware filesystem read/write/edit/patch authority and collision checks;
- brokered terminal/build/test/diagnostics execution;
- exact/semantic search, document/PDF/archive/media indexing, semantic concepts and RAG;
- encrypted conversations, run state, memory and artifact persistence;
- skills and project-specific skills;
- web research under the migrated network/security policy;
- model routing, health, failover and hybrid local/cloud execution;
- multi-agent delegation, review, write leases and autonomous acceptance;
- configurable audio transcription and Agent Chat voice input;
- local-only screen understanding and permissioned exact-plan desktop automation;
- CPU/RAM/GPU/process and model/agent/token runtime visibility;
- launcher/tool discovery and managed development-environment lifecycle;
- permission-scoped autonomous authority and bridge reauthorization;
- compatible migrated IRIS runtime tests and the preserved benchmark harness.

## Intentionally unmounted optional UI/controller code

### Standalone Notes experience

**Locations:** `src/platform/notesStorage.ts`, `src/platform-features/notes/`

The migrated note storage and Notes-controller helpers remain available, but the old standalone IRIS Notes panel was deliberately not transplanted. Project/chat memory is already connected through Agent Chat. A dedicated human-facing Notes surface would be optional new product work.

### Historical IRIS chat presentation helpers

**Location:** `src/platform-features/chat-ui/`

Some controller/normalization logic is reused by Code Editor-native approval/question/activity presentation. Old-shell grouping/layout/export/history helpers may remain as compatibility/reference code where they are not imported by the current Chat shell.

### Old panel-controller surfaces

Locations include helpers under:

- `src/platform-features/files/`
- `src/platform-features/search/`
- `src/platform-features/skills/`
- `src/platform-features/launcher/`
- `src/platform-features/screen-capture/`
- selected audio helpers

The underlying capabilities are already connected through Code Editor-native Explorer/Search/Settings/Chat/Runtime surfaces or the trusted bridge. An unused historical controller does not make the subsystem incomplete.

## Compatibility code retained deliberately

A small amount of compatibility code remains for older callers or migration safety, including legacy speech/Ollama helper paths and historical controller types/utilities. Remove these only after proving they have no supported caller and after the normal verification suite passes.

## Historical reference material

`docs/iris-reference/` is an archive of source-IRIS documentation captured for migration/reference purposes. It describes the original IRIS product and may contain old UI requirements or TODOs that are intentionally not Code Editor requirements.

The milestone plans/reviews under `docs/migration/` are also historical implementation records. Their temporary restrictions describe the state of a particular patch, not the current application.

For current state use:

1. [`CURRENT_STATUS.md`](./CURRENT_STATUS.md)
2. [`../../IRIS_MIGRATION.md`](../../IRIS_MIGRATION.md)
3. [`VALIDATION_REPORT.md`](./VALIDATION_REPORT.md)
4. this retained/reference ledger

## What remains

There is **no known missing migration milestone** in the defined scope.

Current work is post-migration maintenance:

- repair the two failing Code Editor tests recorded in the latest local verification snapshot;
- remove the React missing-key warning;
- reduce lint/dead-code noise;
- run the complete deterministic verification chain until green;
- perform a dedicated dependency-backed reachability/dead-export audit before deleting compatibility code.

Optional richer history/management UX, a dedicated Notes surface, Command Palette launcher integration, or scheduled/background project execution would be new product development rather than migration completion.
