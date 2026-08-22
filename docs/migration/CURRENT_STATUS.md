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
- Audio and voice
- Vision and screen capabilities
- Permissioned desktop automation
- System monitoring and runtime visibility

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

Agent Chat voice input now uses the migrated IRIS audio controller instead of the legacy Ollama-specific speech IPC path. Local Granite Speech remains the private default, while OpenAI, OpenRouter and Gemini transcription providers can be selected with a model, validated credential slot and explicit local-fallback policy from the Code Editor voice control. Microphone authority still flows through the trusted Electron bridge and persisted capability setting, cloud transcription shows a first-use upload notice before recording, missing local Granite is installed only after an explicit action, cancellation propagates through the bridge, and recordings are converted to bounded mono 16 kHz PCM WAV and kept in memory rather than persisted. The legacy Electron speech helpers remain only as compatibility code for older callers.

Focused audio configuration/integration regression coverage is present. A targeted Vitest run for the new audio tests plus the existing Chat panel test exceeded the execution window before returning a result; implementation work was not blocked on a full-suite run and no explicit test failure was returned before that timeout.

Vision and screen understanding are now connected to autonomous Agent Chat without reviving the old IRIS Vision panel. Screen capture is owned by Electron, bounded before it crosses the authenticated per-launch bridge, checked against the separate fail-closed screen-capture permission at the privileged route, and validated again by the renderer client. Every `screen.capabilities` call captures a fresh frame and sends it only to the existing local-only IRIS Vision runtime; raw screenshot bytes are not returned to the main agent transcript, and screen text is explicitly treated as untrusted evidence.

The migrated desktop Automation path is now connected through the same existing Code Editor capability controls rather than a parallel implementation. Visual actions require both the `Capture screen` and `Desktop automation` GUI permissions. When a local Vision pass returns a bounded action plan, IRIS's existing automation client obtains a short-lived approval token bound to that exact action list and workspace-resolved working directory; the trusted bridge consumes it once, applies its automation rate limit, and hands the plan to the existing bounded executor. Disabling screen capture revokes observation immediately, while disabling desktop automation prevents action execution. Scheduled/background project execution remains a future extension rather than being implied by this desktop-control milestone.

Focused Vision and Automation regressions cover capture authorization, local-only Vision, fresh-screen Agent Chat exposure, GUI permission gating, exact-plan approval binding and single-use consumption. The supplied source snapshot does not include `node_modules`, so the focused Vitest command could not be executed in this continuation; no test failure was observed.

System/runtime visibility is now surfaced directly inside the existing Agent Chat shell rather than reviving the old IRIS System Monitor panel. The compact Runtime view reuses the migrated `useSystemMonitor` controller for CPU, load average, RAM, GPU/VRAM and bounded top-process snapshots, and independently polls the existing multi-agent roster for active/queued task state and health. Monitoring failures remain isolated to the view and do not interrupt an autonomous run.

IRIS's existing run-summary telemetry now survives into the encrypted project-run checkpoint instead of being flattened away by the Code Editor adapter. The Runtime view exposes provider/model routing cost tier plus model request count, prompt/completion tokens, context-window use and remaining capacity, and prompt-cache hit ratio. It deliberately does not expose raw chain-of-thought, raw token streams, credentials or environment-variable values, and it does not fabricate dollar costs where provider pricing is not available from the runtime.

Autonomous sessions can now call the existing read-only `system.stats`, `system.processes` and `launcher.list` tools without requesting a new privileged capability. The project-run guidance tells the Orchestrator to inspect current machine pressure and verified launcher/tool availability rather than guessing. `launch.run` is admitted only when the existing workspace terminal/local-execution permission is already enabled, preserving the current broker/launcher safety and approval boundary. Managed development-environment start/stop remains a separate local-system integration item and is not claimed complete here.

Focused runtime-visibility regressions cover the read-only discovery allowlist, permission-gated local launching, monitor/roster/usage wiring, durable usage extraction and continued filtering of raw reasoning events. The supplied source snapshot still does not contain `node_modules`, so these Vitest regressions could not be executed in this continuation.

## Next milestone

**Launcher/local-system completion and autonomous policy hardening**

- connect the existing managed development-environment start/stop lifecycle to the autonomous local-system surface without bypassing launcher approvals
- finish sanitized developer-tool discovery where the current launcher menu is insufficient
- harden the final workspace/network/package/vision/automation autonomous-run authority and exact-operation approval boundaries
- then move into staged migrated-test/benchmark re-enablement and long-run recovery validation
