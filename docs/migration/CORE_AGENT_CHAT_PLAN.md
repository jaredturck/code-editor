# Core Agent Chat Integration Plan (P006)

## Objective

Replace the Code Editor's direct Ollama-only chat execution path with the migrated IRIS `runAgentSession` runtime while preserving the existing Code Editor Chat UI, attachment workflow, microphone workflow, Electron security boundary, and Settings-driven model configuration.

This milestone establishes a real brokered agent loop. It intentionally does **not** enable code mutation, terminal execution, multi-agent delegation, or autonomous multi-hour project runs yet; those capabilities remain migrated but are reserved for their dedicated integration milestones so editor-buffer authority and process safety can be added first.

## Architecture

```text
AIChatPanel (existing visual shell)
        │
        ▼
useAIChat (Code Editor controller)
        │
        ├─ encrypted chat persistence
        ├─ approval/question controller
        ├─ transient stream/activity state
        └─ active workspace + attachments
        │
        ▼
src/chat/agentChat.ts
        │
        ├─ resolve configured Orchestrator
        ├─ bind correct provider key slot
        ├─ apply P006 research/context-only tool allowlist
        ├─ normalize attachments/conversation
        └─ sanitize observable activity
        │
        ▼
IRIS runAgentSession
        │
        ├─ native provider tools when supported
        ├─ structured-controller fallback
        ├─ planning/TODO runtime
        ├─ brokered skills/context/web tools
        ├─ context/memory/skills
        ├─ model health/failover
        └─ approvals + cancellation
```

## Scope

### Agent execution

- Resolve the primary Orchestrator configured in Settings → AI → Agents.
- Bind the exact provider/model/key slot through the migrated IRIS agent identity layer.
- Invoke `runAgentSession` instead of `window.editor_api.ai.start_chat`.
- Preserve native-tool calling for capable models and controller fallback for other models.
- Pass the active workspace as `agent_working_dir` as a contextual/future-authority hint; P006 does not expose direct workspace filesystem tools.
- Disable multi-agent orchestration and complexity routing for this milestone so Chat always uses the configured Orchestrator.

### P006 capability boundary

Allowed agent capabilities are explicitly enumerated:

- skill discovery/loading/offloading;
- resources/approval/user-question controls;
- TODO updates;
- current-chat remember/recall and context summarization;
- policy-governed web search/fetch and trusted-source lookup.

Explicitly unavailable until later milestones:

- direct file list/find/read/stat/diff and exact code search;
- semantic RAG retrieval;
- global notes/memory search;
- host statistics/process/environment inspection;
- artifacts and launcher/process actions;
- file write/edit/patch;
- terminal/script execution;
- clipboard mutation;
- screen/mouse automation;
- cloud peer consultation and multi-agent delegation/consultation/review.

The runtime gains an optional `agent_tool_allowlist` session constraint. When absent, existing IRIS behavior is unchanged. When present it applies to **all** tool-catalog entries, including entries marked `internal`, because `internal` describes runtime presentation rather than machine authority. P006 supplies the allowlist only to Code Editor Chat runs.

The security review intentionally defers direct workspace read/search/RAG access. The loopback bridge is rooted at the user's home directory, and `agent_working_dir` is a routing hint rather than a complete authorization boundary. Workspace-root containment, realpath/symlink enforcement and dirty-buffer authority are therefore completed in the dedicated editor-aware filesystem milestone before those tools are exposed to Chat.

### Chat persistence

- Restore the current encrypted active chat on application startup.
- Create a durable chat before the first model request.
- Persist the user turn before agent execution starts.
- Persist the final assistant turn before marking it durably completed in the UI.
- Persist bounded run timeline/TODO/summary metadata with the assistant turn.
- Persist compact agent-run history through the existing IRIS run store.
- Clear removes the active encrypted chat and creates a fresh logical session on the next send.

### Attachments

- Preserve active unsaved text-document attachments.
- Preserve manually selected text/image attachments.
- Convert existing Code Editor attachment objects into IRIS provider-neutral attachment objects.
- Text/image attachments are included in the current user turn without writing them to plaintext storage.

### Activity UI

Keep the current panel layout. Add a compact collapsible "Agent activity" region to assistant messages and to the active run.

Observable activity includes phases, notices, tool calls/results, TODO updates, web/cloud request status and other externally meaningful runtime events.

Raw `thinking_stream`/hidden reasoning is neither rendered nor persisted by the new Code Editor Chat integration.

### Approvals/questions

- Use the migrated IRIS approval normalization/controller behavior.
- Render compact approval/question cards directly above the prompt composer.
- Chat-originated persistent machine-permission grants are denied in P006; Settings remains the explicit persistent permission surface.
- Denial/timeouts unblock the runtime safely.
- Stop resolves outstanding approvals as denied/stopped.

### Cancellation

- Existing Stop button aborts the `AbortController` used by `runAgentSession`.
- Global IRIS emergency stop aborts the active Code Editor agent run.
- Unmount aborts any in-flight run and resolves pending approval waits.

## Security requirements

1. Provider keys remain in Electron `safeStorage`; no key is copied into chat messages, timeline metadata, settings JSON, or logs.
2. The exact Orchestrator key slot is injected only into ephemeral runtime settings.
3. The P006 tool allowlist is enforced inside capability policy/broker evaluation for every catalog tool, not just hidden from the prompt.
4. Direct file/search/RAG, host-inspection, artifact, write/terminal/automation and multi-agent capabilities cannot be requested through Code Editor Chat in P006.
5. Chat-originated persistent machine-permission grants are denied; Settings remains the explicit permission-management surface.
6. User turns are durable before model execution; final assistant turns are durable before completion presentation.
7. Raw model reasoning tokens are discarded from the Code Editor presentation/persistence path.

## Test plan

- Orchestrator provider/model/key selection.
- P006 research/context-only tool allowlist, including blocking excluded `internal` tools.
- Persistent machine-permission requests are rejected by the core Chat integration.
- Timeline sanitization removes raw reasoning/stream events.
- Attachment conversion preserves text and images safely.
- Persisted chat-message normalization restores attachments/activity metadata.
- Chat UI exposes configured Orchestrator rather than the legacy Ollama selector.
- Approval cards render and resolve.
- Existing active-file attachment and voice controls remain present.
- Static source parsing and local import resolution.
- Typecheck/lint/tests/build when the dependency tree is available.

## Documentation/ledger

- Mark **Core agent chat integration** complete in `IRIS_MIGRATION.md` once validation passes.
- Move Chat runtime/controller/persistence helpers from "unwired" to connected/partial status.
- Keep planning/autonomy, write tools, terminal tools and multi-agent features unchecked.
