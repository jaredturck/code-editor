# Planning and Autonomous Project Runs Review (P007)

## Scope completed

P007 adds a durable project-run layer to the existing IRIS Agent Chat without changing the P006 machine-authority boundary. The run lifecycle is owned by a module-level controller rather than by the React component, and the current Chat surface observes that controller.

Connected behavior:

- Automatic and Plan-first project-run modes;
- structured TODO plan presentation in the existing Chat panel;
- durable per-chat lifecycle/TODO/elapsed-time checkpoints in encrypted renderer storage;
- Pause, Resume, Cancel and existing Stop integration;
- restart recovery that converts persisted active work to an explicit `interrupted` state;
- explicit Resume/Cancel after interruption rather than automatic execution on startup;
- elapsed-time and configured run-budget visibility;
- TODO checkpoint notifications from the IRIS session runtime;
- completion reconciliation that keeps pending/in-progress work resumable instead of claiming success;
- provider/model attribution refresh when a paused/interrupted run resumes;
- long-run/recovery regression coverage.

P007 does not enable editor filesystem authority, terminal execution, host inspection, screen/mouse control or multi-agent delegation. Those capabilities remain scheduled for their dedicated safety milestones.

## Security review

The project-run lifecycle was reviewed as a security-sensitive persistence and authority change.

Corrections made during review:

1. **Bounded checkpoint payloads** — run IDs, goals, provider/model labels, TODO IDs/text/dependencies, summaries, activity labels and errors are normalized and bounded before durable persistence. Arbitrary TODO properties are discarded.
2. **No automatic crash restart** — a run persisted in any active state is restored as `interrupted`. The editor requires an explicit user Resume or Cancel action before another model request can occur.
3. **No capability widening** — P007 continues to call the same P006 `build_core_agent_settings` path, including the research/context-only `agent_tool_allowlist` and disabled file/terminal/screen permissions.
4. **Checkpoint write pressure** — high-frequency stream/thinking events are not persisted. TODO changes are checkpointed immediately; observable activity checkpoints are limited to meaningful phase, tool-result, notice and cloud-response events.
5. **Concurrent-run guard** — a new prompt cannot silently replace an active, paused or interrupted project run; the existing run must be resolved first.
6. **Resume identity accuracy** — provider/model attribution is refreshed when a run resumes so durable status reflects the model that actually continues execution.

Provider credentials are never copied into project-run state. Raw hidden reasoning remains excluded from both the Chat transcript and checkpoint state. The original goal and TODO text are stored only through the existing encrypted renderer-state write-through layer.

Plan-first approval is currently a workflow invariant enforced through the Orchestrator prompt and the existing `user.ask` surface, not a machine-authority boundary. This is acceptable in P007 because machine-changing tools remain broker-blocked. Before future autonomous write/terminal authority is exposed, any approval that gates those capabilities must be enforced at the broker/authority layer rather than relying on model compliance.

## Bug review

The implementation review corrected the following lifecycle issues before commit:

- unresolved pending/in-progress TODOs now pause the run as resumable work instead of incorrectly turning a normally completed model segment into a terminal failure;
- new prompts are rejected while an existing run is active or resumable;
- resumed runs update provider/model attribution if Settings changed since the prior segment;
- interrupted elapsed time stops at the last persisted update rather than counting offline time;
- Pause and Cancel remain distinct: Pause aborts only the active segment while preserving a resumable run, whereas Cancel produces a terminal state;
- application teardown checkpoints active work but does not falsely mark it cancelled, allowing restart recovery to identify interruption;
- warm-session TODO updates preserve the project-run checkpoint instead of erasing it.

No package/dependency changes are part of P007.

## Validation

Static validation after the review:

- TypeScript-family files parsed across active `src/`, `backend/`, `electron/` and `tests/`: **271**;
- physical lines parsed: **88,261**;
- parser errors: **0**;
- relative/`@/` imports inspected: **799**;
- unresolved source imports: **0**;
- changed-file trailing-whitespace errors: **0**;
- changed text files missing a final newline: **0**.

A dependency-independent executable smoke test transpiled `projectRunController.ts` with TypeScript and exercised begin → checkpoint → pause → resume → cancel plus interrupted restart recovery and checkpoint bounds. Result: **PASS**.

A dependency-aware `tsc -b` was attempted, but this recovery environment does not have the repository's installed dependency tree. Compilation stops before project source checking because `vite/client` and Node type definitions are unavailable. Vitest, Prettier, Oxlint, Electron/backend builds and the full verification sequence therefore cannot be truthfully executed in this environment.

Run on a normal installed checkout:

```bash
npm run verify:full
```

Focused Vitest coverage added/updated for P007 covers lifecycle persistence, pause versus cancel, resume identity, interrupted restart recovery, bounded TODO normalization, plan-first prompts/settings and Project Run UI controls.
