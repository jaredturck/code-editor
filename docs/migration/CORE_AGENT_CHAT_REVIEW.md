# Core Agent Chat Integration Review (P006)

## Scope completed

P006 replaces the Code Editor's legacy direct Ollama Chat execution path with the migrated IRIS `runAgentSession` runtime while preserving the existing Chat panel layout, attachment workflow, voice/transcription controls, Settings-driven model configuration and Electron security boundary.

Connected behavior:

- configured Orchestrator provider/model/key-slot resolution;
- native tool calling plus structured-controller fallback;
- streaming assistant output;
- encrypted active-chat creation, restoration and message persistence;
- durable bounded agent-run history and warm TODO state;
- compact observable activity presentation;
- approval/question cards;
- normal Stop and global emergency-stop cancellation;
- current active-file/manual text and image attachments;
- existing microphone/transcription workflow.

## Deliberate capability boundary

P006 is a research/context agent milestone, not yet a coding-authority milestone. Its session allowlist contains only skill controls, resource/approval/question controls, TODO updates, current-chat memory/context controls, and policy-governed web/source research.

Direct filesystem reads/search, exact code search, RAG, host inspection, artifacts, file mutation, terminal execution, clipboard mutation, launcher/process actions, screen/mouse automation, cloud-peer consultation and multi-agent delegation/review remain blocked.

## Security review

The patch was reviewed as a security-sensitive diff because it changes the renderer-to-agent authority path. Three issues found during review were corrected before packaging:

1. **Internal-tool allowlist bypass** — the first implementation exempted tools marked `internal` from the session allowlist. The IRIS catalog also marks host inspection, artifacts and multi-agent/cloud tools as internal, so `internal` is not a security boundary. The allowlist now applies to every catalog tool.
2. **Workspace-root assumption** — the migrated loopback bridge is rooted at the user's home directory. `agent_working_dir` alone therefore cannot prove workspace-only authority or stop a workspace symlink from resolving elsewhere under the home root. Rather than ship a weaker read boundary, P006 defers direct filesystem/search/RAG tools until the editor-aware filesystem milestone adds the explicit workspace/realpath/symlink contract.
3. **Persistent permission escalation from Chat** — an allowed `approval.request` could otherwise ask the user to persist a machine permission even when the corresponding tool was outside the P006 scope. Core Agent Chat now refuses persistent machine-permission grants; Settings remains the explicit persistent-permission surface.

Additional security properties checked:

- provider credentials remain in Electron `safeStorage` and are injected only into ephemeral runtime settings;
- no provider key is written to chat content, activity metadata or migration documentation;
- raw `thinking` / `thinking_stream` events are discarded from the Code Editor transcript/activity path;
- tool-result raw output previews are not copied into the compact activity detail;
- the final assistant response is stored before the UI marks the run complete;
- stopped/failed runs resolve outstanding approvals safely.

## Bug review

Issues corrected during the implementation/review pass:

- legacy persisted image attachments with `type: "image"` now restore using their stored MIME type instead of being misclassified as text;
- Chat no longer depends on the legacy Ollama model picker or direct `start_chat` path;
- Settings changes are observed without changing the provider/model of an already-running turn;
- clear-chat removes the encrypted active chat and its warm state;
- cancellation aborts the active `AbortController` and resolves pending approval waits;
- activity history is bounded to 200 observable events.

## Tests added

- `tests/agentChat.test.ts` — Orchestrator/key selection, P006 capability scope, persistent-permission blocking, attachment restoration and reasoning/activity sanitization.
- `tests/agentCapabilityScope.test.ts` — broker/capability-policy enforcement, including excluded tools that are marked `internal`.
- `tests/AIChatPanel.test.tsx` — configured Orchestrator presentation, observable activity, approval UI and preserved attachment/voice controls.

## Static validation

The active `src/`, `backend/`, `electron/` and `tests/` TypeScript-family tree was parsed with the available TypeScript parser after implementation and security fixes. The final numbers are recorded in `VALIDATION_REPORT.md`. Relative and `@/` source imports were also resolved statically; the three tests that intentionally import generated `dist-electron` modules are treated as generated-output dependencies rather than source-resolution failures.

A diff whitespace/style check found no trailing-whitespace or tab/space errors in P006. The new Code Editor files follow the existing no-semicolon Project 4 style; the migrated IRIS capability-policy edit preserves that file's semicolon style.

## Dependency-aware validation gap

The recovery/checkpoint environment does not contain `node_modules`, and the npm cache does not contain the packages needed to reconstruct it offline. Consequently Vitest, Oxlint, Prettier and the full dependency-aware TypeScript/build pipeline cannot be executed truthfully here.

Run the following in the normal project checkout after applying P006:

```bash
npm run verify:full
```

Any dependency-aware failure from that command becomes the first item for the next corrective patch before moving on to the next feature milestone.
