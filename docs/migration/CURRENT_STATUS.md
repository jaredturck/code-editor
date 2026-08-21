# Current IRIS Integration Status

Completed integration milestones:

- AI Settings and provider configuration
- Core Agent Chat runtime
- Durable planning and autonomous project runs
- Editor-aware workspace filesystem tools
- Brokered terminal/build/test/diagnostics tools
- Exact code search
- Semantic file search and indexing
- Document, PDF and archive intelligence
- Image and video semantic indexing
- Semantic concepts
- RAG and project context engine
- Memory and context compaction

Agent Chat now exposes the migrated IRIS `rag.retrieve` capability during workspace runs. Semantic retrieval is scoped to the active Code Editor workspace before candidates are selected; candidate files are then re-read through the editor-aware file authority so dirty CodeMirror buffers are authoritative, and IRIS's existing temporary chunking/ranking returns bounded passages with file and line provenance. The same tool remains callable throughout long autonomous runs, so the agent can refresh project evidence after edits instead of relying on a one-time context snapshot.

Long autonomous runs now also carry a bounded encrypted project working-context checkpoint between segments. The stable agent-runtime facade rolls forward the latest verified tool actions, TODO state, runtime checkpoint metadata and outcome, re-injects that checkpoint before the next workspace segment, and preserves the existing per-chat `chat.remember` / `chat.recall` memory channel for agent-authored durable facts. IRIS's existing stateful loop remains responsible for live prompt-pressure transcript compaction inside a single long session.

## Next milestone

**Conversation and Run Persistence**

- encrypted chats/messages
- agent runs, TODOs and checkpoints
- resume previous runs

Skills/artifacts infrastructure, multi-agent work, additional IRIS capabilities and final validation remain later milestones.
