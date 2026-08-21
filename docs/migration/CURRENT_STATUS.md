# Current IRIS Integration Status

Completed integration milestones:

- AI Settings and provider configuration
- Core Agent Chat runtime
- Durable planning and autonomous project runs
- Editor-aware workspace filesystem tools
- Brokered terminal/build/test/diagnostics tools

The agent can now plan durable work, read and edit workspace files through live CodeMirror-aware authority, execute opt-in terminal commands through the IRIS broker, and receive bounded workspace diagnostics. File authority remains workspace-contained with symlink and revision collision checks; terminal authority remains explicitly controlled by AI Settings.

## Next milestone

**Exact Code Search**

- ripgrep/find/fd/filename search
- Search-panel integration
- brokered agent exact-search tools

Semantic indexing, RAG, multi-agent delegation, vision, automation, and broader system authority remain later milestones.
