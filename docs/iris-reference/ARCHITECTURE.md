# IRIS — Architecture and Codebase Map

IRIS is a local-first, desktop-only Electron assistant. Electron owns native lifecycle, secure key material, encrypted application storage, windows, shortcuts, and the loopback bridge. React owns the interface and primary agent loop. The bridge owns final filesystem, process, network, launcher, automation, persistence, audio-transcription, and multi-agent effects.

## 1. Technology stack

| Layer       | Technology                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Desktop     | Electron 31, authored in `electron-src/*.cts` and compiled to `electron/*.cjs`                            |
| Renderer    | React 18, TypeScript, Vite 6, Tailwind, Radix UI, Framer Motion, CodeMirror 6, xterm.js                   |
| Bridge      | TypeScript HTTP server under `server/`, compiled to `server-dist/`                                        |
| Persistence | Embedded SQLite 3 through the `sqlite3` Node binding                                                      |
| Encryption  | Node `crypto`: AES-256-GCM, HKDF-SHA256 domain-key derivation, Electron `safeStorage` master-key wrapping |
| Providers   | Anthropic, OpenAI-compatible, Gemini, OpenRouter, OpenCode, and local endpoints                           |
| Testing     | Vitest, Testing Library, jsdom, bridge/security integration tests                                         |
| Packaging   | electron-builder                                                                                          |

Five TypeScript projects cover renderer, bridge, Electron, tests, and build configuration.

## 2. Repository layout

```text
electron-src/    Authored Electron lifecycle, windows, editor services, IPC, credentials, logging, storage key
electron/        Generated CommonJS Electron runtime
server/          Bridge host, routes, services, policy, encrypted SQLite storage
server-dist/     Generated bridge runtime
src/             React interface, agent runtime, providers, desktop clients, feature state
tests/           Unit, integration, security, persistence, migration, and local-first routing contracts
docs/            Full codebase knowledge base and media
dist/            Generated renderer production build
```

Generated directories are rebuilt and should not be edited directly.

## 3. Process model

```text
Electron main process
├── safeStorage credential vault
├── wrapped application master key
├── encrypted SQLite database
├── authenticated loopback bridge
├── orb BrowserWindow
├── workspace BrowserWindow
└── editor BrowserWindow + editor-scoped IPC services
        │
        │ preload contextBridge
        ▼
React renderer
├── orb launcher role
├── workspace role
├── editor workbench role
├── panels and settings
├── provider clients
└── agent runtime
        │
        │ token-authenticated /api/local/*
        ▼
Local bridge
├── encrypted repositories
├── filesystem and terminal tools
├── web and provider proxy
├── launcher, semantic filesystem index, and automation
├── skills and evaluation
└── multi-agent task bus
```

Development and packaged builds share the same Electron-owned bridge and encrypted persistence path. Vite serves renderer assets during development; it does not host privileged bridge routes.

## 4. Startup and shutdown

1. Electron becomes ready and initializes metadata-only session logging.
2. Obsolete Chromium application-storage directories are removed.
3. `storageKeyStore.cts` verifies `safeStorage`, rejects weak Linux backends, opens `~/.iris-ai/iris.sqlite3`, unwraps or creates the 256-bit master key, and leaves only wrapped ciphertext in SQLite.
4. Electron starts `server-dist/bridgeServer.js` with the database path, a copy of the in-memory key, exact allowed origin, and a random per-launch bridge token.
5. The bridge initializes the schema, encrypted repositories, permissions, rate limits, and legacy plaintext cleanup.
6. Electron creates the orb and workspace windows on demand; the Editor pill creates or focuses one independent editor window. Every renderer hydrates encrypted state before React mounts.
7. On shutdown, windows stop, bridge work closes, SQLite checkpoints and closes, and in-memory key buffers are zeroed on a best-effort basis.

Any secure-storage, key, database, or bridge startup failure prevents the workspace from opening. There is no plaintext or hidden persistence fallback.

## 5. Encrypted persistence

The application database is:

```text
~/.iris-ai/iris.sqlite3
```

`electron-src/storageKeyStore.cts` owns the master key. `server/desktopBridge/storage/encryption.ts` owns authenticated encryption. `server/desktopBridge/storage/encryptedDatabaseSchema.ts` owns the declarative SQLite schema, while `encryptedDatabase.ts` owns lifecycle, transactions, and encrypted repositories.

Sensitive values are encrypted before SQLite receives them:

- chat titles, providers, and models
- chat messages and bounded image attachments
- chat memory and compacted summaries
- renderer settings and state
- notes and agent-run history
- launcher shortcuts
- filesystem tree nodes, calibrated batch profiles, and compact text embeddings
- artifacts and artifact chunks
- sub-agent outputs
- user-created skills and built-in overrides
- skill-session labels and other encrypted durable values

Permitted plaintext metadata includes opaque IDs, timestamps, ordering, counts, sizes, schema versions, and the `safeStorage`-wrapped master-key BLOB. Provider credentials remain in their separate Electron `safeStorage` credential vault.

Every encrypted payload uses a fresh 12-byte nonce and 16-byte GCM authentication tag. AAD binds ciphertext to its domain, record ID, field, cipher version, and key version so valid ciphertext cannot be silently moved to another record.

The renderer keeps decrypted active state in memory only. Chromium `localStorage` and IndexedDB are not application persistence. User-requested exports may be plaintext because the user explicitly chose the destination.

## 6. Bridge boundary

`server/bridgeServer.ts` binds to loopback and requires:

- a per-launch token of at least 32 characters
- a loopback Host
- an exact allowed Origin
- bridge-owned permissions synchronized through sender-checked Electron IPC
- initialized encrypted storage

Routes are dispatched through `server/desktopBridge/routes/router.ts`. Route modules parse requests; service facades call the shared runtime and encrypted repositories. Request bodies cannot grant themselves permissions.

Structured utilities pass arguments directly to processes. The arbitrary terminal endpoint intentionally retains shell behavior. Patch application uses standard input rather than plaintext temporary patch files.

## 7. Agent runtime

`src/lib/agent/runtime/sessionRunner.ts` is the primary entry point. It chooses between:

- a stateful provider-native tool loop
- a controller-style structured fallback loop

`toolCatalog.ts` is the canonical tool inventory. `toolBroker.ts` integrates permissions, approvals, storage, artifacts, notes, web policy, todos, traces, memory, interactive questions, and delegation; its approval guards are separated from the dispatch body so policy prompts can be tested without duplicating tool execution. `sessionRunner.ts` similarly exposes request-settings, attachment, usage, timeout, and safety helpers while retaining one orchestration loop. Context construction removes stale injected summaries before combining recent messages, compacted history, and memory. Persisted image attachments are restored onto their original user turns, while a newly selected image is attached only to the latest/current user turn.

Multi-agent mode supports orchestrator, executor, scout, and review roles. Sub-agent output is stored as encrypted SQLite content addressed by opaque IDs rather than plaintext temporary files. Local and remote assignments participate in one roster, while remote requests remain explicitly classified and consume a shared per-turn cloud budget. Hybrid sessions use a local coordinator when one is available, preserve the selected cloud responder for final synthesis, and return the verified local draft if that final request fails. Cloud-only sessions remain valid on machines without a usable local model. Consultation count, recursive depth, and repeated-peer limits are enforced as high-capacity circuit breakers; an omitted tool policy receives tier defaults, an explicit empty list grants no tools, and a populated list grants only its named tools.

`modelHealth.ts` records consecutive weighted failures rather than lifetime totals and ignores user cancellation. Real request outcomes are the primary health signal. `modelHealthMonitor.ts` probes only degraded or suspended assignments through lightweight discovery endpoints, using adaptive backoff instead of constant short-interval polling. Health state is visible and resettable in Settings. When a role exhausts its healthy assignments, `modelRecovery.ts` first recommends a suitable installed or configured model, then offers a hardware-sized Ollama download only after explicit user approval.

Short feature work that does not need a conversational loop enters `src/lib/agent/boundedRoleTask.ts`. It ranks healthy configured local role models first, applies capability tags and bounded failover, and makes cloud use impossible unless a caller both opts in and records explicit approval. Search, Notes summaries, chat title/compaction, recovery responses, and Vision use this path. `webResearchTask.ts` shares DuckDuckGo-first provider policy, source guarding, extraction, local synthesis, and deterministic source fallback across the Search panel, Chat web synthesis, and delegated agents. DuckDuckGo discovery is supplied by an Electron-owned hidden Chromium window through a typed bridge callback; the bridge itself remains Electron-agnostic, and the previous package transport is retained behind `IRIS_DDG_SEARCH_MODE=legacy` for rollback. `visionTask.ts` requires a local model tagged for vision; screen capture and preview remain independent from desktop-control availability.

The standalone Search panel separates a fast snippet-only pass from the explicit full-page pass. `/api/local/web/search/stream` keeps one authenticated NDJSON response open while the bridge and Electron browser emit real provider, navigation, parsing, ranking, source-reading, retry, and cancellation events. The renderer retains every event but coalesces fast visual bursts to the newest pending status roughly every 800 milliseconds. Local Ollama or LM Studio answer deltas and provider-emitted thinking deltas use separate lossless buffers flushed roughly every 80 milliseconds into safe Markdown renderers; the thinking panel is live while reasoning is emitted, collapses when final-answer text begins, and remains expandable for the active application session. Ollama completion metadata preserves model-load, prompt-evaluation, generation, first-response, first-thinking, first-answer, thinking-stream, and visible-answer timings in the saved research result without persisting raw thinking text. Cancellation propagates through the renderer fetch, bridge request, hidden Chromium search, source downloads, and bounded model task rather than merely hiding the loading state.

Saved research uses encrypted `web_search_sessions` records. Each record retains the original/effective query, quick and detailed Markdown answers, normalized sources, synthesis metadata, partial cancellation output, and follow-ups while keeping the sidebar display payload separately encrypted for bounded history listing. The Search history sidebar can reopen, duplicate, copy, or permanently delete one record; clearing history deletes only saved research sessions. Active operation IDs and deleted-session guards prevent late progress or token events from recreating a deleted record.

## 8. UI and windows

Electron uses three renderer roles:

- **Orb:** fixed transparent launcher with radial navigation. Hover opens the controls, a single click dismisses them, a double click minimizes the native launcher, and controls reopen after a completed drag. The former Train action is replaced by Editor and opens the dedicated editor window instead of a workspace panel.
- **Workspace:** reusable window containing persistent panels. Chat and Notes share one microphone/transcription lifecycle; Chat keeps attachment, prompt, reasoning, microphone, and Send/Stop controls in one compact row and inserts editable transcripts at the current composer selection. Chat also renders normalized image thumbnails in the composer and persisted user turns when the selected Orchestrator supports image input; native attachment dialogs use capability-matched, human-readable filters.
- **Editor:** a single independently movable, resizable workbench window. `src/features/editor/` owns CodeMirror document state, tabs, Explorer state, Markdown/media/PDF viewers, diagnostics presentation, terminal layout, editor settings, and the agent sidebar. `electron-src/editorIpc.cts` and `electron-src/editor/` own sender-checked file dialogs, workspace-root mutations and watching, diagnostics engines, PTY lifecycle, tokenized local-resource URLs, and the sandboxed `WebContentsView` browser. Dirty documents participate in a renderer/main close handshake before the window or application exits.

Once opened, workspace panels remain mounted and are hidden when inactive so streams, drafts, scroll positions, and subscriptions survive navigation. The editor keeps its own mounted workbench state for the lifetime of its window; clicking Editor again focuses the existing instance. Editor settings and the editor-specific AI transcript use Iris's encrypted renderer store, the shell derives its colors from Iris appearance tokens, and the AI sidebar calls `runAgentSession()` rather than maintaining a separate Ollama client. When a workspace is selected, the session receives it as `agent_working_dir` so relative agent file and terminal operations start in the open project. Human terminal input is available only while the Iris terminal permission is enabled, and emergency stop terminates editor PTYs.

## 9. Providers and credentials

Provider adapters live under `src/lib/providers/`. `src/lib/aiService.ts` resolves the adapter, model behavior, streaming, usage, and bridge fallback.

Credentials are available only through the narrow Electron credential IPC implemented by `electron-src/credentialStore.cts`. Renderer settings do not retain credential compatibility fields, and provider/search calls do not fall back to plaintext settings.

Audio transcription is a specialized capability binding rather than a delegating agent role. With no explicit binding, Chat and Notes use the existing Granite Speech model through local Ollama; explicit OpenAI, OpenRouter, or Gemini bindings use the provider's audio API after a one-time cloud notice and can fall back to Granite. The renderer's bounded binary audio headers are mirrored exactly by the bridge CORS preflight allowlist, fetch failures are normalized into transcription-specific errors, and microphone denials expose a shared recovery action. Image-input availability is resolved from installed Ollama metadata, OpenRouter-declared input modalities, or conservative first-party provider metadata before the composer permits a visual turn.

Screen capture uses one `getDisplayMedia()` route on Wayland. Electron installs matching display-media request and permission-check handlers for trusted IRIS renderers, including Chromium's preliminary `media` check when its media type is `unknown` or unspecified. The display handler asks PipeWire for screen and window sources, emits metadata-only stages around permission and portal handoff, and the renderer validates that a live video track with usable dimensions was returned. The legacy source-ID fallback remains limited to environments where it is applicable rather than starting a second Wayland portal transaction.

## 10. Semantic filesystem index

`server/desktopBridge/services/fileIndexSourceService.ts` discovers the File Manager's eligible mounted sources. On Linux it combines `findmnt` with `lsblk`, excludes virtual filesystems, the operating-system root, loop/Snap/boot mounts, and unreadable paths, and classifies remaining sources as Home, internal, removable, or network. Home is mandatory, internal data drives default on, and removable/network sources default off. A completed index stores its selected source records in encrypted metadata; temporarily disconnected sources stay visible as unavailable and are skipped without invalidating mounted roots.

`server/desktopBridge/services/fileSemanticService.ts` owns the semantic filesystem pipeline and exposes record-building and batch-persistence boundaries for text, image, and video stages. `fileImagePreparation.ts` owns the Sharp decode/resize operation used by the worker, while `fileClipService.ts` separates RawImage creation, processor input construction, vision inference, and embedding normalization without changing the public embedding entry points. It records one encrypted virtual root with a child root for each selected source, associates every node with a source ID and source-relative path, excludes nested mounts from the parent scan, and classifies each new or changed file once. Queryable node metadata selects text, image, and video records directly. IRIS embeds compact text representations through Ollama `all-minilm:22m`. Images pass through a persistent Sharp worker pool that decodes, orients, and resizes them to 224 × 224. `fileImageQueueBudget.ts` caps the prepared-image backlog to four normal batches (six at most) while retaining the available-memory reserve, and `fileImageQueue.ts` releases consumed entries without front-removal or large compaction pauses. `fileClipService.ts` starts CLIP at 256 images, builds normalized NCHW tensors directly from the worker-produced 224 × 224 RGB buffers, and can distribute sufficiently large batches across two detected CUDA FP16 vision sessions; CPU fallback remains one Q8 lane. Image persistence runs through a bounded serial writer so the next CLIP batch can start while the previous encrypted batch commits, and genuine OOM failures preserve split-and-retry behavior. The following video stage uses system FFmpeg for sparse uniform and scene-sensitive sampling, stores each selected frame as an independent encrypted `video_frame_semantics` row, and collapses matches to one result per video using its strongest frame and timestamp. Stage 7 then calls `fileConceptService.ts`, which streams only the active virtual root's existing encrypted vectors, trains MiniLM and CLIP independently on bounded deterministic samples, and uses up to eight persistent `fileConceptWorker.ts` workers for hierarchical spherical-k-means training and full membership assignment. Video training contributes at most three representative frames per file so long videos cannot dominate the CLIP centroids, while the assignment pass still examines every stored frame and retains the strongest frame for each video/concept pair. Stage 8 commits final index metadata and removes superseded concept generations. MiniLM and CLIP vectors remain in separate named spaces; text queries are embedded in both spaces and merged by within-space rank, while Similar compares only records from the selected file's own space. Active stages expose rolling ETA and per-file progress without awaiting renderer updates. CLIP model files are cached under `~/.iris-ai/models/clip-vit-base-patch32`; model readiness requires tokenizer/processor metadata plus either the complete FP16 or Q8 text-and-vision projection pair. A partial interrupted cache is removed and retried once, and model-preparation errors remain visible until the user retries. Full-file AI Analyze stays separate on `qwen3-vl:4b-instruct`.

Before the first build, a read-only discovery pass counts eligible files and directories without writing database rows; scans at or above one million eligible files require explicit large-scan confirmation. Hidden directories and the shared hard-exclusion list for dependency trees, environments, caches, test output, and generated builds are skipped wherever they appear. The first approved build scans the remaining bridge root. Later rescans reconstruct indexed paths from parent IDs, compare names, sizes, and modification timestamps, and process only new or changed files; missing nodes and their semantic records are removed. Search decrypts the text vectors into memory after unlock, embeds one natural-language query through Ollama, ranks the indexed text records with cosine similarity, and reconstructs absolute paths only for returned results.

Index preflight, status, model installation, rebuild, rescan, cancellation, and search are permission-gated bridge operations. A cancelled or failed initial build deletes its newly created tree and preserves any previously completed index. Active work and decrypted vector caches are cancelled and cleared during application-data deletion and bridge shutdown; application-data clearing also checkpoints the WAL and vacuums SQLite so removed index pages no longer consume disk space.

The renderer-facing File Manager uses `useFilePanel()` to coordinate `/fs/list`, `/fs/browse`, `/fs/thumbnail`, `/fs/media`, `/fs/open`, `/fs/analyze`, and the semantic-index routes. The current folder is rendered as a read-only path rather than an editable index root. An Indexed Locations dialog calls `/fs/index/sources`, lets the user include or exclude discovered optional sources before the first build, shows per-source preflight counts, and locks those controls once the index is building or ready. `/fs/index/clear` removes only filesystem nodes, semantics, video frames, concepts, and source metadata so the source list can be changed without deleting downloaded models. `/fs/list` supplies the expandable home-directory tree in the left pane, while `/fs/browse` lists only the selected directory's immediate children for the synchronized icon grid in the right pane. Selected locked sources can be opened directly from the dialog. Navigating through either view clears the previous file preview and keeps the current path aligned. Folder entries are sorted from decrypted metadata in renderer memory through an IRIS-styled name, size, modified-date, or file-type menu; type sorting groups extensions and uses filename order inside each extension group. Image previews are resized through Electron `nativeImage`. Video tiles request one bounded JPEG frame from system FFmpeg, chosen from a duration-aware point within the first five seconds to avoid commonly black opening frames. Both thumbnail types are cached only in bridge and renderer memory and never written into the semantic database. Full video previews use an authenticated loopback URL and HTTP byte ranges so Chromium can seek without loading the complete file; leaving a preview restores the prior tile selection and scroll position. The first scan requires explicit confirmation; later refreshes invoke the timestamp-based rescan instead of rebuilding unchanged files.

AI Analyze reads the live selected file rather than reusing its short index summary. Text files that fit the Ollama context are analyzed in one request; larger files are read completely, analyzed in bounded sections, and reduced into one Markdown response. Images are sent to the separate `qwen3-vl:4b-instruct` analysis model rather than the lightweight indexing model. The renderer displays the returned Markdown with the shared safe Markdown component.

The shared vector cache supports selected-file similarity, while persistent concept storage supports query-driven concept views. `file_concepts` contains encrypted MiniLM or CLIP centroids plus generation, member-count, and cohesion metadata. `file_concept_memberships` is the many-to-many relation between concepts and files; its `(concept_id, file_id)` key collapses repeated video-frame matches to the strongest timestamp. The concept builder trains on at most 20,000 vectors per space, uses a modest broad/local centroid hierarchy, then streams every active vector once for up to three strong memberships. The `/fs/semantic/concepts` route embeds the query once in each available space, normalizes centroid rankings independently, merges them for display, and fetches representative members without comparing every file with every other file or running a captioning model.

The Electron bridge and agent working root remain the current user's home directory by default. Selected index locations form a separate File Manager-only allowlist for browse, preview, open, reveal, read, write, analysis, and similar-file actions; they do not expand agent file tools, terminal working directories, or launcher permissions. Canonical multi-root checks still reject traversal and symlink exits. The indexer additionally refuses protected Linux system trees such as `/boot`, `/dev`, `/etc`, `/proc`, `/sys`, `/usr`, and `/var` if a broader source is ever supplied.

## 11. Skills and artifacts

Built-in skills remain packaged application resources. SQLite stores only user-created skills, overrides, and disabled markers as encrypted payloads. Skill proposals remain pending until explicitly approved. The former external Training panel and its `/api/local/training/*` transport are retired; skill storage, rewards, proposals, and offline evaluation modules remain.

Internal artifacts are encrypted database records. The UI retrieves them by opaque artifact ID. Plaintext files are created only by explicit user export or file-writing actions.

## 12. Logging

Persistent session logs contain operational structure, message length, and fingerprints—not prompts, replies, file contents, clipboard contents, commands, paths, or tool output. Logging remains passive and failure-isolated.

## 13. Build and verification

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run app:pack
```

`npm install` installs the SQLite 3 Node-API binding and rebuilds the editor's `node-pty` native module for the pinned Electron runtime. Electron Builder leaves global native rebuilding disabled, packages the SQLite binding unchanged, and includes the rebuilt PTY binary plus diagnostics/WASM assets; users do not install a database engine or configure a service.

## 14. Core invariants

- Desktop development and packaged builds use the same encrypted persistence and bridge implementation.
- Secure persistence fails closed; no plaintext or substitute fallback is allowed.
- Sensitive values, including filesystem names, index metadata, summaries, and embeddings, are encrypted before SQLite receives them.
- Provider credentials never enter the general settings database.
- The renderer never receives the application master key.
- External content cannot approve tools, change permissions, or activate persistent skills.
- Bridge permissions cannot be self-granted through HTTP request bodies.
- Opened persistent panels remain mounted.
- Tool metadata remains canonical across prompts, schemas, permissions, timeouts, sub-agents, and UI.
- Generated output is rebuilt from authored source.
