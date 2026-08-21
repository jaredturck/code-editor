# Current IRIS Integration Status

Completed integration milestones:

- AI Settings and provider configuration
- Core Agent Chat runtime
- Durable planning and autonomous project runs
- Editor-aware workspace filesystem tools
- Brokered terminal/build/test/diagnostics tools
- Exact code search

The agent can now plan durable work, read and edit workspace files through live CodeMirror-aware authority, execute opt-in terminal commands through the IRIS broker, receive bounded workspace diagnostics, and run workspace-scoped ripgrep/find/fd exact searches from Agent Chat and the existing Search activity. File authority remains workspace-contained with symlink and revision collision checks; terminal authority remains explicitly controlled by AI Settings.

## Next milestone

**Semantic File Search and Indexing**

- semantic filesystem index
- incremental workspace indexing
- text embeddings and similar-file search
- Search-panel semantic mode

Document/media intelligence, RAG, multi-agent delegation, vision, automation, and broader system authority remain later milestones.
