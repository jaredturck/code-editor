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
- Multi-agent orchestration
- Multi-agent coding coordination
- Review and autonomous quality control

Agent Chat exposes the migrated IRIS `rag.retrieve` capability during workspace runs. Semantic retrieval is scoped to the active Code Editor workspace before candidates are selected; candidate files are then re-read through the editor-aware file authority so dirty CodeMirror buffers are authoritative, and IRIS's existing temporary chunking/ranking returns bounded passages with file and line provenance. The same tool remains callable throughout long autonomous runs, so the agent can refresh project evidence after edits instead of relying on a one-time context snapshot.

Long autonomous runs carry a bounded encrypted project working-context checkpoint between segments. The stable agent-runtime facade rolls forward the latest verified tool actions, TODO state, runtime checkpoint metadata and outcome, re-injects that checkpoint before the next workspace segment, and preserves the existing per-chat `chat.remember` / `chat.recall` memory channel for agent-authored durable facts. IRIS's existing stateful loop remains responsible for live prompt-pressure transcript compaction inside a single long session.

Conversation and run persistence is connected end-to-end under the existing IRIS cryptographic boundary. User-authored chat content, attachments, bounded message metadata, chat memory/compacted context and autonomous run checkpoints are encrypted before SQLite with AES-256-GCM, per-record 96-bit nonces, 128-bit tags, HKDF-SHA256 domain separation and record-bound AAD. The 256-bit master key is generated randomly and persisted only as Electron `safeStorage` ciphertext; Linux refuses the insecure `basic_text` backend. Per-chat run/TODO state is decrypted lazily when that chat is opened, agent-run history uses targeted retrieval instead of bulk renderer hydration, and active runs restored after restart are converted to resumable `interrupted` state.

The skills system is now part of autonomous Agent Chat rather than only a settings/backend capability. Existing built-in and encrypted user skills continue through IRIS profiles and progressive disclosure. Workspace runs additionally discover bounded `.iris/skills/*.md` definitions through the editor-aware workspace authority, apply optional `.iris/skills.json` enable/priority overrides, and let project definitions override same-ID global skills. Capable agents receive compact skill cards first and use the existing `skills.load` tool to pull full instructions only when needed.

Artifacts are also connected to autonomous runs. Persisted chats receive IRIS's existing `artifact.create` tool for substantial research, test, architecture/design and migration reports; append mode keeps large deliverables chunked in encrypted artifact persistence instead of expanding the chat transcript. Final replies include stable artifact references, and the Code Editor Markdown surface can open those records in an in-app artifact viewer without writing plaintext temporary files.

Autonomous research now uses the migrated `search.web`, `web.fetch` and trusted-source lookup path directly. The project-run contract tells the agent to discover candidate sources, fetch only evidence it needs, preserve source URLs, reconcile conflicting sources and treat fetched content as untrusted evidence rather than executable instructions. IRIS's existing per-site ingestion guard, network/redirect policy and untrusted-content marking remain the enforcement layer; ordinary HTTP links in chat and artifact Markdown continue through the Code Editor's external-link boundary.

Code Editor no longer disables IRIS's configured model execution policy. Complexity-aware routing, adaptive health state, cooldown/recovery and bounded failover operate during autonomous runs. Hybrid runs may use a configured local worker for the working loop and reserve the selected cloud responder for synthesis; focused `cloud.consult` calls are exposed only when a persisted session actually has both a cloud responder and a local worker, and all remote inference shares the existing cloud request budget.

Local execution continues through IRIS's provider-neutral Ollama and OpenAI-compatible/LM Studio adapters. Auto Setup ranks installed chat models using both agent-role suitability and conservative parameter/quantization-aware VRAM fit before downloading a fallback and preserves unknown custom model names instead of rejecting them. Multi-agent Code Editor sessions keep the persisted roster unchanged but admit at most one local model into the active runtime team, preferring the local Orchestrator or configured required local worker; cloud peers can still work concurrently without allowing several local LLMs to contend for VRAM.

Configured workspace runs can now activate IRIS's multi-agent team instead of forcing single-agent mode. The Orchestrator can discover available members, delegate bounded work to Executor/Scout members, run independent tasks asynchronously, recall one or many results, pull full encrypted sub-agent output on demand, consult peers and use the Reviewer/Overwatcher paths. Omitted delegated tool lists correctly inherit each role's permission-tier defaults while explicit empty lists remain tool-free, so ordinary implementation delegation is capable without widening an explicitly restricted task.

Parallel coding is guarded at the editor boundary before it is allowed to mutate project files. Delegated writers carry distinct actor/task identities, acquire task-scoped file leases and retain those leases until their task settles. Live CodeMirror revisions are remembered per agent rather than globally: another agent cannot inherit a peer's fresh revision, a second writer cannot claim an already leased file, and a human edit invalidates the agent's expected revision so the next write must re-read live content instead of overwriting the user. Lease cleanup runs through the central sub-agent settlement path on success, failure and timeout.

Multi-agent completion now has an explicit autonomous acceptance gate. Coding mutations require an independent `agent.review` after the latest main or delegated write; changes-requested, mixed, unknown or stale reviews block completion. Open TODOs, active/queued delegated tasks and outstanding write leases also block the gate. The stable runtime automatically runs bounded remediation continuations to recall outstanding work, resolve collisions, fix reviewer findings, rerun verification and re-review; if the gate still cannot pass, it leaves an in-progress resumable acceptance TODO so Code Editor pauses the project instead of falsely marking it complete.

## Next milestone

**Perception and Automation**

- audio transcription/provider configuration and voice input for Agent Chat
- screen capture, vision runtime and permissioned visual verification/actions
- automation service, approvals and future scheduled/background project tasks

System/runtime visibility, launcher/local-system capability integration, autonomous-run security policy hardening and final validation remain later grouped batches.
