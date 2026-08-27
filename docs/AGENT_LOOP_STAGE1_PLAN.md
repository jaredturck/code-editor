# Agent Loop Stage 1 — Small-Model Efficiency Plan

Date: 2026-08-27
Status: active experiment

## Goal

Make the local coding agent complete ordinary software tasks with materially fewer model turns and less repeated observation while preserving correctness, workspace safety, verification, and recoverability.

The target is not to make prompts more elaborate. The target is to move control-plane responsibilities out of natural-language prompting and into deterministic runtime behavior, leaving the model a small problem-solving surface.

## Failure modes this stage targets

The recent single-file HTML run exposed several concrete failures:

- hundreds of session/inspection/read events for one deliverable;
- repeated reads and browser inspections without an intervening mutation;
- successful verification treated as something to repeat rather than evidence to consume;
- diagnostics reinterpreted by the model instead of being treated as objective completion state;
- multiple completion/reconsideration sessions after the model had already tried to finish;
- structured small-model execution constrained to one tiny action per model turn;
- large prompt surfaces that mix task reasoning, policy, tool guidance, formatting, recovery, verification, memory, delegation, and product rules;
- output-format compliance delegated to prompting even where the inference provider can enforce a schema.

## Design principles

1. **Runtime before prompt.** If code can enforce an invariant, do not make the model remember it.
2. **Short system prompts.** Give the model its role, goal, and only the behavioral guidance that has proven necessary.
3. **Zero-shot by default.** Do not add examples unless a measured failure demonstrates that an example improves the target behavior.
4. **Mechanical structure.** Prefer provider/native JSON schema or grammar-constrained output over prose demanding strict formatting.
5. **Small active tool surface.** Expose tools relevant to the current task/state instead of teaching the model the whole platform in one prompt.
6. **Evidence changes state.** A successful read/check should reduce uncertainty. Repeating equivalent evidence without mutation is a controller failure.
7. **Mutation when the defect is known.** Once the model has enough evidence to identify a concrete defect, the next useful action should usually be a repair, not another equivalent observation.
8. **Objective completion.** Diagnostics, required mutations, conflicts, and recorded verification are runtime gates, not matters of model opinion.
9. **Bounded remediation.** Recovery loops must have explicit caps and return concrete blockers rather than spawning open-ended new sessions.
10. **Weak-model path gets more runtime help, not more prose.** Small models should receive fewer simultaneous instructions and stronger deterministic scaffolding.

## Stage 1 changes

### A. Simplify the main controller prompt

Reduce `controllerPrompt.ts` to a compact problem-solving contract. Remove redundant policy explanations, illustrative examples, model-size commentary, and format-threat language. Keep only guidance that cannot be enforced elsewhere.

Expected effect: lower prompt burden, less instruction competition, fewer micro-actions caused by over-specific wording.

### B. Move structured response enforcement into providers

Add a provider-neutral structured-response schema option. For local inference:

- Ollama: send JSON Schema through `format` when requested;
- LM Studio/OpenAI-compatible local endpoint: send `response_format: { type: 'json_schema', ... }` when requested.

The prompt may briefly state the desired output shape, but correctness should come from constrained decoding when supported.

Expected effect: fewer malformed/schema-repair turns and less model attention spent policing its own output syntax.

### C. Reduce structured-loop action granularity

The current structured path effectively allows one tool action per model inference. Introduce a small bounded batch action for independent operations where safe, or otherwise allow the controller schema to return a short action list. Execution remains sequential where shared authority state requires it.

Expected effect: directory inspection, related reads, and independent checks can complete in one model round-trip instead of several.

### D. Make useful-progress state explicit

Track whether the last meaningful action mutated the workspace, reduced diagnostics, resolved a blocker, or introduced genuinely new evidence. Use this to reject/steer repeated low-value observation across nested sessions.

Expected effect: the controller stops treating activity as progress.

### E. Collapse redundant completion prompting

Audit the development checkpoint, autonomous acceptance, and outer verification/diagnostics acceptance layers. Prefer one deterministic acceptance result that returns concrete blockers to the current loop. Avoid asking multiple fresh agent sessions variants of "are you sure you are done?".

Expected effect: fewer complete `sessionRunner` restarts and less post-completion thrash.

### F. Gate planning and supervisor calls by uncertainty

Do not spend a planning/Overwatcher inference on obvious tasks solely because the task is code-related. Invoke auxiliary models only when the controller genuinely needs decomposition, specialist input, or recovery.

Expected effect: lower fixed model-call overhead on simple tasks.

## Initial implementation order

1. Commit this plan as the persistent recovery checkpoint.
2. Simplify `controllerPrompt.ts` and its focused tests.
3. Add provider-neutral structured output options and wire local Ollama/LM Studio constrained JSON.
4. Thread the structured controller schema into provider calls.
5. Introduce bounded multi-action structured output if the existing parser/executor permits a contained change.
6. Consolidate redundant acceptance prompting after measuring the earlier changes.
7. Add lightweight run-efficiency telemetry/tests around repeated evidence and model/session counts.

Each stable chunk should be committed directly to `main` rather than held until the end. Follow-up commits are preferred over losing stable work.

## Evaluation

Use a fixed small-model task set, including the failure case class that produced the long HTML run. Compare before/after:

- task success;
- remaining editor errors;
- total model calls;
- total agent/session starts;
- total tool calls;
- workspace mutations;
- repeated equivalent observations;
- time/model calls to first useful mutation;
- post-finalization model calls;
- total elapsed time.

A change is useful when it reduces reasoning/tool churn without weakening correctness or safety. Prompt-token reduction alone is not sufficient.

## Non-goals for Stage 1

- rewriting the application in Python;
- replacing Ollama solely for architectural fashion;
- removing security/workspace authority boundaries;
- deleting multi-agent capabilities wholesale;
- maximizing benchmark scores by weakening completion verification;
- adding large new prompt frameworks.

Inference-backend changes remain open for later benchmarking. The first experiment is to make the existing TypeScript architecture use the model more intelligently.
