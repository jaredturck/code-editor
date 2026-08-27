# Agent Loop Stage 1 — Implementation Status

Stage 1 changes the default workspace project agent from a layered autonomous orchestration system into a bounded, task-focused coding loop designed for small local models.

## Production project path

Automatic workspace runs now follow this shape:

1. Deterministic task classification. Workspace requests do not invoke a separate planner model.
2. One primary core agent session using the smallest useful tool surface.
3. Objective runtime acceptance:
   - required workspace mutation completed;
   - real verification evidence exists when development verification is required;
   - live editor diagnostics contain zero errors.
4. At most one short acceptance-repair session when objective blockers remain.
5. Persist a compact project checkpoint and return.

The project path bypasses the legacy nested lifecycle that could create mutation-recovery, development-completion, autonomous-acceptance, and outer-remediation sessions recursively.

## Small-model prompt policy

The controller prompt is intentionally small. It tells the model to complete the task, use current evidence, read only what it needs, change understood problems instead of re-observing them, verify relevant changes, and finish.

Runtime policy owns mechanics. The prompt no longer teaches the model source-control policy, memory maintenance, system-stat inspection, launcher discovery, peer-review ceremony, verification bookkeeping, or a large controller JSON contract.

Structured local fallback output is constrained at the provider boundary. Ollama and LM Studio receive a minimal controller-action JSON schema when the structured controller is detected.

## Automatic project tool authority

Automatic project runs are single-agent by default. They do not expose model-managed:

- user approval / clarification tools;
- TODO bookkeeping;
- chat memory writes/recall;
- context summarization;
- system stats/processes;
- launcher discovery;
- dynamic skill management;
- peer delegation/review/Overwatch tooling.

Task-specific native surfaces further narrow coding, read-only code, file, browser, and research tools by request intent.

Dynamic skills, model-routing, continuous Overwatch, peer review, and multi-agent execution are disabled on this bounded Automatic path. Plan-first and compatibility paths remain separate.

## Runtime invariants moved out of prompts

- Editor diagnostics with severity `error` are a hard completion blocker.
- Real successful verification in the current mutation epoch can satisfy verification without `verification.require` / `verification.record` bookkeeping.
- The obsolete verification bookkeeping tool registration has been removed.
- Git mutation commands are hard-blocked for the agent; the editor owns staging/commit/history changes. Read-only Git evidence remains available.
- Cross-session repeated verification is rejected before the expensive browser/build/diagnostic action executes.
- Workspace diagnostics refresh after source mutation or an explicit diagnostics request, not after every tool result.
- Per-session observation budgets force evidence gathering to eventually produce a mutation or completion.

## Bounded execution economics

Automatic project defaults currently cap:

- initial core session: 8 minutes;
- acceptance-repair session: 4 minutes;
- identical tool repeat allowance: 2;
- project web-search budget: 2;
- context-compression trigger: 5% remaining context.

A bounded Automatic session halts at the duration boundary rather than silently doubling into an effectively unbounded run. A time-budget stop does not trigger another acceptance-repair session.

## Efficiency telemetry

Workspace run summaries now record runtime-only efficiency metrics:

- total/successful/failed actions;
- first mutation action index;
- observations before first mutation;
- total observation count;
- source mutation count;
- verification action count;
- browser inspection count;
- diagnostics check count;
- repetition-block count;
- observation-to-mutation ratio;
- per-tool action counts.

These metrics are intended to replace subjective trace inspection when comparing agent-loop revisions.

## Expected effect on the original failure profile

The original pathological run exhibited hundreds of reads/session starts, 119 browser inspections, 114 TODO updates, 93 system-stat checks, 71 chat-memory writes, and repeated verification declaration without recorded evidence.

The current Automatic project architecture removes or hard-bounds each of those branches. A simple coding task should normally look closer to:

`inspect -> edit -> verify -> fix if needed -> verify affected result -> finish`

rather than repeatedly re-entering planning, memory, review, verification-management, and completion-confirmation loops.

## Remaining Stage 1 work

- Continue reducing legacy-only prompt and auxiliary-call overhead without destabilizing compatibility paths.
- Consider disabling encrypted chat-memory loading itself for direct project sessions; it is no longer rendered into controller state.
- Measure a representative task suite using the new efficiency summary and compare against the exported pathological trace.
- Tune observation caps and task-specific tool surfaces from measured failures rather than adding prompt rules speculatively.
- Run the full local verification suite after the experimental implementation batch stabilizes.

## Verification intentionally deferred

This stage has prioritized rapid architectural implementation and frequent recoverable commits. Full validation should be run locally with:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```
