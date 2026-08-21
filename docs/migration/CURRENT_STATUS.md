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
- Skills system
- Artifacts and large outputs
- Web search and research
- Model routing, health and failover
- Hybrid local + cloud execution
- Advanced local model runtime integration

Agent Chat exposes the migrated IRIS `rag.retrieve` capability during workspace runs. Semantic retrieval is scoped to the active Code Editor workspace before candidates are selected; candidate files are then re-read through the editor-aware file authority so dirty CodeMirror buffers are authoritative, and IRIS's existing temporary chunking/ranking returns bounded passages with file and line provenance. The same tool remains callable throughout long autonomous runs, so the agent can refresh project evidence after edits instead of relying on a one-time context snapshot.

Long autonomous runs carry a bounded encrypted project working-context checkpoint between segments. The stable agent-runtime facade rolls forward the latest verified tool actions, TODO state, runtime checkpoint metadata and outcome, re-injects that checkpoint before the next workspace segment, and preserves the existing per-chat `chat.remember` / `chat.recall` memory channel for agent-authored durable facts. IRIS's existing stateful loop remains responsible for live prompt-pressure transcript compaction inside a single long session.

Conversation and run persistence is connected end-to-end under the existing IRIS cryptographic boundary. User-authored chat content, attachments, bounded message metadata, chat memory/compacted context and autonomous run checkpoints are encrypted before SQLite with AES-256-GCM, per-record 96-bit nonces, 128-bit tags, HKDF-SHA256 domain separation and record-bound AAD. The 256-bit master key is generated randomly and persisted only as Electron `safeStorage` ciphertext; Linux refuses the insecure `basic_text` backend. Per-chat run/TODO state is decrypted lazily when that chat is opened, agent-run history uses targeted retrieval instead of bulk renderer hydration, and active runs restored after restart are converted to resumable `interrupted` state.

The skills system is now part of autonomous Agent Chat rather than only a settings/backend capability. Existing built-in and encrypted user skills continue through IRIS profiles and progressive disclosure. Workspace runs additionally discover bounded `.iris/skills/*.md` definitions through the editor-aware workspace authority, apply optional `.iris/skills.json` enable/priority overrides, and let project definitions override same-ID global skills. Capable agents receive compact skill cards first and use the existing `skills.load` tool to pull full instructions only when needed.

Artifacts are also connected to autonomous runs. Persisted chats receive IRIS's existing `artifact.create` tool for substantial research, test, architecture/design and migration reports; append mode keeps large deliverables chunked in encrypted artifact persistence instead of expanding the chat transcript. Final replies include stable artifact references, and the Code Editor Markdown surface can open those records in an in-app artifact viewer without writing plaintext temporary files.

Autonomous research now uses the migrated `search.web`, `web.fetch` and trusted-source lookup path directly. The project-run contract tells the agent to discover candidate sources, fetch only evidence it needs, preserve source URLs, reconcile conflicting sources and treat fetched content as untrusted evidence rather than executable instructions. IRIS's existing per-site ingestion guard, network/redirect policy and untrusted-content marking remain the enforcement layer; ordinary HTTP links in chat and artifact Markdown continue through the Code Editor's external-link boundary.

Code Editor no longer disables IRIS's configured model execution policy. Complexity-aware routing, adaptive health state, cooldown/recovery and bounded failover can now operate during autonomous runs while multi-agent execution remains explicitly disabled until its dedicated milestone. Hybrid runs may use a configured local worker for the working loop and reserve the selected cloud responder for synthesis; focused `cloud.consult` calls are exposed only when a persisted session actually has both a cloud responder and a local worker, and all remote inference shares the existing cloud request budget.

Local execution continues through IRIS's provider-neutral Ollama and OpenAI-compatible/LM Studio adapters. Auto Setup now ranks installed chat models using both agent-role suitability and conservative parameter/quantization-aware VRAM fit before downloading a fallback, preserves unknown custom model names instead of rejecting them, and retains hardware-aware Ollama fallback selection. With multi-agent execution still off, autonomous Code Editor runs schedule one local working model at a time, avoiding concurrent local-agent VRAM contention until the multi-agent coordination milestone introduces explicit worker concurrency policy.

## Next milestone

**Multi-Agent Development**

- Orchestrator, Executor, Scout and Reviewer/Overwatcher delegation and result recall
- file ownership / write leases and agent-agent collision prevention
- independent review, remediation and final acceptance gating

Audio/vision/automation, system/local-tool capabilities, autonomous-run security hardening and final validation remain later grouped batches.
