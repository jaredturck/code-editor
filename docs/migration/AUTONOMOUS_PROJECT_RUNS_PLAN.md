# Planning and Autonomous Project Runs Plan (P007)

## Objective

Turn the connected Code Editor agent chat into a durable project-run surface that can plan work, expose a structured TODO list, survive renderer/application restarts, pause and resume without losing task state, enforce configured run budgets, and reconcile unfinished work before completion.

P007 deliberately keeps the P006 research/context-only tool authority. File mutation, terminal execution, editor-buffer reconciliation and multi-agent delegation remain blocked until their dedicated milestones.

## Architecture

```text
AIChatPanel
    │ observes / controls
    ▼
useAIChat
    │
    ▼
projectRunController (module-owned lifecycle + AbortController)
    │
    ├─ encrypted per-chat checkpoint state
    ├─ pause / resume / cancel intent
    ├─ elapsed time and current lifecycle status
    ├─ normalized TODO snapshot
    └─ crash/interruption recovery
    │
    ▼
runAgentSession
    │
    ├─ planning/TODO runtime
    ├─ configured duration / cloud / context limits
    ├─ open-TODO finalization guard
    └─ P006 brokered research/context tool allowlist
```

## Scope

### Durable run state

Persist one current project-run checkpoint per encrypted chat with:

- stable run id and goal;
- automatic vs plan-first mode;
- lifecycle status;
- provider/model attribution;
- started/updated/checkpoint timestamps;
- elapsed active-run time;
- normalized TODO list;
- current activity label;
- step count and compact summary;
- error/interruption metadata.

### Lifecycle

Canonical states:

- `starting`
- `planning`
- `running`
- `waiting_for_approval`
- `waiting_for_user`
- `paused`
- `interrupted`
- `finalizing`
- `completed`
- `failed`
- `cancelled`

A persisted active state discovered at application startup becomes `interrupted`; the editor never pretends that an in-memory model/tool process survived a restart.

### Planning and TODOs

- Automatic mode lets the migrated runtime plan naturally through skills/TODO tools.
- Plan-first mode seeds an explicit planning TODO and tells the Orchestrator to establish a concrete task-specific TODO plan before substantive execution.
- Runtime TODO changes are checkpointed while the run is active.
- The Chat panel shows pending/in-progress/done/blocked items in a compact collapsible plan.
- Completion keeps the existing runtime open-TODO reconciliation guard enabled.

### Pause, resume and cancel

- Pause aborts the current execution segment but records `paused`, not `cancelled`.
- Resume starts a new execution segment under the same durable project-run id and TODO snapshot.
- Interrupted runs offer the same Resume/Cancel controls after restart.
- Cancel marks the project run terminal and clears resumability.
- Global emergency stop remains a cancellation path, not a pause.

### Checkpoints

Checkpoint on meaningful transitions and TODO changes rather than on every streamed token. Checkpoints are kept in the existing encrypted renderer-state store, so no new plaintext persistence path is introduced.

### Long-run budgets and context continuity

- Respect `agent_session_minutes`, cloud request limits, model output limits, context compaction and tool repetition limits already configured in AI Settings.
- Duration check-ins continue to use the migrated approval/question channel.
- Warm TODO/context state is reused across resumed execution segments.
- Chat compaction/memory remains the source of long-context continuity rather than duplicating full transcripts into checkpoint metadata.

### UI

Keep the current Code Editor Chat visual language. Add:

- compact project-run header/status;
- elapsed time;
- automatic / plan-first selector before a run starts;
- Pause while running;
- Resume/Cancel for paused or interrupted runs;
- collapsible structured TODO plan and progress counts.

### Security requirements

1. P007 must not expand the P006 tool allowlist.
2. Checkpoints must not persist provider credentials, raw hidden reasoning or raw tool outputs.
3. Restart recovery must downgrade stale active runs to `interrupted` instead of auto-executing.
4. Resume requires an explicit user action after an application restart/interruption.
5. Emergency stop must remain terminal for the current execution segment.
6. Persistent machine permissions remain controlled by Settings, not project-run resume state.

## Test plan

- project-run lifecycle normalization and terminal/resumable status helpers;
- encrypted checkpoint round-trip through chat session state;
- stale running/waiting state becomes interrupted on restore;
- pause distinguishes itself from cancellation;
- TODO normalization/progress calculation;
- plan-first core settings retain the P006 capability allowlist;
- Chat UI exposes plan/status and Resume/Pause controls;
- static parsing, local import resolution, lint/type/test/build when dependencies are available.

## Documentation

- mark Planning and autonomous project runs complete only after validation;
- document P007 security/bug review and known deferred boundaries;
- keep editor-aware filesystem, terminal/build/test and multi-agent milestones unchecked.
