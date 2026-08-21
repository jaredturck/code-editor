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
- Conversation and run persistence

Agent Chat now exposes the migrated IRIS `rag.retrieve` capability during workspace runs. Semantic retrieval is scoped to the active Code Editor workspace before candidates are selected; candidate files are then re-read through the editor-aware file authority so dirty CodeMirror buffers are authoritative, and IRIS's existing temporary chunking/ranking returns bounded passages with file and line provenance. The same tool remains callable throughout long autonomous runs, so the agent can refresh project evidence after edits instead of relying on a one-time context snapshot.

Long autonomous runs now also carry a bounded encrypted project working-context checkpoint between segments. The stable agent-runtime facade rolls forward the latest verified tool actions, TODO state, runtime checkpoint metadata and outcome, re-injects that checkpoint before the next workspace segment, and preserves the existing per-chat `chat.remember` / `chat.recall` memory channel for agent-authored durable facts. IRIS's existing stateful loop remains responsible for live prompt-pressure transcript compaction inside a single long session.

Conversation and run persistence is now connected end-to-end under the existing IRIS cryptographic boundary. User-authored chat content, attachments, bounded message metadata, chat memory/compacted context and autonomous run checkpoints are encrypted before SQLite with AES-256-GCM, per-record 96-bit nonces, 128-bit tags, HKDF-SHA256 domain separation and record-bound AAD. The 256-bit master key is generated randomly and persisted only as Electron `safeStorage` ciphertext; Linux refuses the insecure `basic_text` backend. Per-chat run/TODO state is now decrypted lazily when that chat is opened, agent-run history uses targeted retrieval instead of bulk renderer hydration, and active runs restored after restart are converted to resumable `interrupted` state.

## Next milestone

**Skills System**

- built-in and user skills
- progressive skill loading
- project-specific skills and settings

Artifacts infrastructure, multi-agent work, additional IRIS capabilities and final validation remain later milestones.
