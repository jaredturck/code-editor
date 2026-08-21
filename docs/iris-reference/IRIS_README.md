# IRIS

IRIS is a local-first Electron desktop assistant. A compact always-on-top orb opens a reusable workspace containing chat, files, notes, search, vision, launcher, system monitoring, skills, and settings, plus an independently movable code-editor window. It combines local and cloud models in an efficient agentic workflow, giving each configured model the tools and guidance needed to complete scoped work. A tiered role system assigns planning, execution, retrieval, and review to suitable agents.

IRIS is a **desktop application**. The renderer is served by Vite during development, but Electron owns native windows, credentials, encrypted application storage, and the authenticated loopback bridge in both development and packaged builds.

## What it does

- **Bring-your-own-provider flow** — Anthropic, OpenAI, Google Gemini, OpenRouter, OpenCode/Zen, and local Ollama or LM Studio-compatible endpoints.
- **Agent execution** — stateful native tool use where supported, with a structured controller fallback for models without reliable native tools.
- **Bounded local-first feature tasks** — search, note summaries, chat titles/compaction, recovery responses, and screen understanding reuse the configured role/model mesh without starting a full agent loop; cloud use is never implicit.
- **Web research** — DuckDuckGo-first discovery through a retained hidden Electron/Chromium window, immediate local answers from structured result snippets, and an optional deeper pass that reads the selected source pages through the existing site policy before rebuilding the answer. The Search panel streams truthful browser, parsing, page-reading, and model progress; supports cancellation; renders model-emitted thinking in a live expandable block before streaming the final answer as safe Markdown; records Ollama load, prompt-evaluation, first-token, thinking, and answer timing metadata; and stores encrypted quick answers, detailed answers, sources, and follow-ups in a navigable research history. Chat and Search share the same provider and local Scout/Orchestrator synthesis, while the previous package transport remains available for explicit rollback with `IRIS_DDG_SEARCH_MODE=legacy`.
- **Vision foundation** — native/system-picker screen capture and frame preview work independently of desktop control; the Wayland path uses one PipeWire portal transaction, accepts Electron's trusted preliminary `media/unknown` display check, and records metadata-only permission/portal stages for diagnosis, while analysis still requires a configured local vision-capable model and executable actions require explicit consent.
- **Shared voice transcription** — Chat and Notes reuse one in-memory microphone recorder and WAV conversion path. Local Granite Speech through Ollama remains the default; an optional Audio binding can use supported OpenAI, OpenRouter, or Gemini transcription models with a first-use cloud notice and local fallback. The binary upload headers are mirrored by the bridge CORS preflight contract, and permission failures expose an in-panel recovery action.
- **Multimodal Chat** — the compact one-row Chat composer accepts bounded image attachments when the selected Orchestrator declares image support, uses human-readable native file filters, normalizes images before use, sends image and text as one multimodal user turn, and retains encrypted image payloads with the conversation.
- **Permission-gated tools** — filesystem, terminal, web, notes, artifacts, clipboard, system inspection, screen capture, desktop automation, and multi-agent delegation.
- **Multi-agent roles** — an orchestrator can delegate scoped work to executor, scout, and review agents through the Structured Task Protocol. Local and remote models share one observable roster, but every remote inference consumes the per-turn cloud budget. Consultation count, recursive depth, and repeated-peer limits remain configurable safety circuits rather than being removed.
- **Skills and evaluation** — built-in guidance, encrypted user overrides, reviewed skill proposals, role filtering, progressive disclosure, reward metrics, and offline evaluation infrastructure remain available without the retired external Training panel.
- **Encrypted persistence** — chats, chat image attachments, titles, memory, summaries, notes, settings, agent runs, saved web-research sessions, launcher state, semantic filesystem tree data, embeddings, artifacts, sub-agent output, and user skills are encrypted before SQLite receives them.
- **Chat management** — create, switch, recall, and permanently delete conversations from the chat dropdown.
- **Semantic file manager** — navigate with an expandable directory tree, browse the selected folder in a synchronized icon grid, detect mounted internal drives, choose the locations included in the encrypted index, preview images and videos, return from previews to the same selected tile and scroll position, sort through IRIS-styled name, size, modified-date, or file-type controls, explore related files and concept groups, and run full-file Markdown AI analysis.
- **Integrated code editor** — the orb's Editor action opens a single independent IRIS BrowserWindow with CodeMirror tabs, workspace Explorer, Markdown/media/PDF viewing, document diagnostics, split PTY terminals, an embedded sandboxed browser, encrypted editor settings/history, and an AI sidebar backed by the same Orchestrator, Executor, Scout, and Overwatcher runtime used by Chat.
- **Native desktop features** — screen capture, launcher actions, window shaping, emergency-stop shortcuts, a reusable workspace window, and a separately movable editor window with dirty-document shutdown protection. The orb hides its radial controls on a single click, minimizes on a double click, and reopens its controls after a completed drag.

## Encrypted storage

IRIS stores application-owned state in:

```text
~/.iris-ai/iris.sqlite3
```

Sensitive fields use AES-256-GCM with a fresh nonce and authentication tag for every write. Domain keys are derived in memory from one random 256-bit master key. Electron `safeStorage` wraps that master key, and only the wrapped ciphertext is stored in SQLite.

The plaintext key and decrypted records exist only in application memory while required. IRIS does not intentionally persist plaintext conversation content through its own files, Chromium storage, logs, temporary patch files, artifacts, or sub-agent handoff files. Provider credentials remain in their separate Electron `safeStorage` credential vault.

The semantic filesystem index uses two local embedding spaces. IRIS first builds the encrypted filesystem tree and classifies each new or changed file once as text, document, PDF, image, video, binary, or directory. Text-like content is represented compactly through Ollama `all-minilm:22m`. Images are decoded, oriented, and resized to 224 × 224 by a persistent Sharp worker pool. Prepared images accumulate in a bounded four-batch queue that still respects the available-memory reserve, preventing the former multi-gigabyte backlog from retaining thousands of decoded images. CLIP starts with batches of 256, converts the already-resized RGB buffers directly into normalized NCHW tensors, and overlaps inference with a bounded encrypted-persistence lane. Transformers.js/ONNX uses up to two detected CUDA devices with independent FP16 vision sessions and falls back to one Q8 CPU lane; genuine OOM failures retain the split-and-retry behavior. Videos add a separate stage that uses system FFmpeg to sample duration-aware uniform and scene-distinctive frames, embeds every selected frame independently in the same CLIP space, and retains the best matching timestamp when search results are collapsed back to one row per video. After those embeddings are complete, a dedicated concept stage reuses the encrypted vectors without reopening files or invoking another model: MiniLM and CLIP are clustered independently through a bounded, worker-threaded hierarchical spherical-k-means pass, then files receive several strong many-to-many concept memberships. Concept centroids and memberships are encrypted in SQLite, and query results from both spaces are normalized independently before being merged. Names, tree payloads, vectors, video-frame metadata, concept centroids, and memberships remain encrypted; rescans process only new or changed files before rebuilding the lightweight concept layer. Before a scan starts, IRIS verifies that tokenizer/processor metadata and either a complete FP16 or Q8 CLIP projection pair are present; a partial interrupted model cache is removed and downloaded once more, while preparation failures remain visible in the File Manager.

The File Manager does not start the expensive first index automatically. Its path display is read-only, and a separate Indexed Locations dialog discovers mounted filesystems through Linux `findmnt` and `lsblk`. Home is mandatory, eligible internal data drives are selected by default, and removable or network locations remain optional. The selected source set is stored with the encrypted index and becomes read-only while an index is building or available; changing it requires deleting only the file index, while downloaded embedding models remain installed. A missing indexed drive remains listed as unavailable and is skipped during refresh rather than silently deleting its records. This File Manager allowlist is separate from the agent working root, so selecting another drive does not widen agent or terminal access.

Before building, IRIS counts eligible files across every selected source without writing index rows, gives an additional warning at one million files, asks for confirmation, installs the required Ollama embedding model when necessary, displays background progress, a sliding-window estimate based on the five most recent completed embedding batches, and cancellation controls, and later exposes a lightweight manual refresh. Nested mounts are excluded from their parent source to avoid duplicate indexing. Hidden directories and hard-excluded dependency, environment, cache, test-output, and generated-build directories are omitted from both browsing and indexing wherever they appear. The left pane keeps an expandable home-directory tree for quick navigation, while the right pane lists the selected folder's immediate contents as icons and thumbnails. Image thumbnails are generated on demand through Electron, while video tiles use a bounded FFmpeg frame selected from a useful point within the first five seconds. Both thumbnail types are cached in bridge and renderer memory rather than stored in SQLite. Supported video files stream through an authenticated loopback route with byte-range seeking, and preview navigation restores the prior grid position. AI Analyze reads the complete live text file or image through local Ollama and renders the answer as Markdown; large text files are processed in sections rather than truncated. Similar-file search reuses the decrypted in-memory vector cache, while the Concepts view searches the persistent encrypted MiniLM and CLIP concept centroids and loads their strongest file memberships. No captioning model or per-file description pass is added. Clearing IRIS application data also clears the filesystem and concept indexes, truncates the SQLite WAL, and compacts the database so released index space is returned to disk.

Encrypted storage is fail-closed: if the operating-system credential store, wrapped key, encryption layer, database, or authenticated bridge cannot initialize, IRIS stops rather than silently using plaintext or a substitute persistence mode.

## Quick start

Requires **Node 22.22.3** or higher.

```bash
npm install
npm run dev
```

`npm run dev` launches the desktop development application. Vite serves renderer assets with hot reload while Electron starts the same encrypted SQLite-backed bridge used by packaged builds.

Open **Settings → Keys**, save a provider credential, test the connection, select a model, and start chatting. Local models can use an Ollama endpoint such as `http://localhost:11434`.

## Commands

| Command               | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`         | Desktop development mode                                                         |
| `npm run dev:desktop` | Explicit alias for desktop development                                           |
| `npm run build`       | Compile Electron and bridge sources, then build the renderer                     |
| `npm run typecheck`   | Check renderer, bridge, Electron, tests, and configuration TypeScript projects   |
| `npm run lint`        | Run ESLint in quiet mode                                                         |
| `npm run benchmark`   | Run the complete local-only performance suite and overwrite Markdown/CSV exports |
| `npm test`            | Run the Vitest regression suite                                                  |
| `npm run verify`      | Type checks, tests, and production build                                         |
| `npm run app:pack`    | Produce an unpacked Electron application                                         |
| `npm run app:dist`    | Produce platform distributables                                                  |

The `sqlite3` dependency embeds the SQLite 3 engine. Users do not install or configure a system database, service, account, port, or schema. The package uses SQLite's Node-API binary installed for the current platform and packages it unchanged for Electron, avoiding an unnecessary Electron ABI rebuild.

## Performance benchmarks

The isolated root-level `benchmarks/` suite imports production helpers from outside the normal
Electron and renderer startup paths. Normal `npm run dev`, production builds, and packaged use do
not execute benchmark timers or collect results. Results are retained in `~/.iris-ai/iris-benchmark.sqlite3`. The latest run overwrites
`benchmark-results/report.md` and `benchmark-results/results.csv`; see
[`benchmarks/README.md`](benchmarks/README.md) for isolation, model, and interpretation details.

## Runtime architecture

```text
Electron main process
├── operating-system safeStorage
├── wrapped application master key
├── encrypted SQLite database
├── authenticated loopback bridge
├── orb window
└── workspace window

React renderer
└── desktop bridge client
    └── bridge routes and repositories
        ├── encrypt before writes
        ├── decrypt after reads
        └── perform approved operating-system actions
```

Authored source lives in:

- `electron-src/` — Electron lifecycle, windows, IPC, credentials, logging, storage-key ownership, and bridge startup
- `server/` — bridge host, routes, policy, encrypted SQLite repositories, filesystem/process/network services, and multi-agent bus
- `src/` — React interface, providers, agent runtime, desktop clients, contexts, and feature state
- `tests/` — security, persistence, bridge, renderer, agent, local-first routing, and migration contracts

Generated runtime output lives in `electron/`, `server-dist/`, and `dist/` and should not be edited directly.

## Security boundary

The local bridge is the final operating-system boundary. Packaged and development desktop requests require a random per-launch token, loopback Host, exact allowed Origin, and bridge-owned permissions synchronized through sender-checked Electron IPC. Filesystem paths are canonicalized, provider proxy destinations are constrained, outbound requests are DNS- and redirect-aware, launcher and automation approvals are exact and single-use, and operation limiters bound concurrent starts.

The local profile/login flow is not an authorization boundary. Filesystem, terminal, launcher, automation, capture, and other native capabilities use separate permissions and bridge enforcement.

## Documentation

- [Architecture map](ARCHITECTURE.md)
- [Developer guide](DEV.md)
- [Full codebase knowledge base](docs/README.md)
- [TypeScript migration schedule](TYPESCRIPT_MIGRATION_SCHEDULE.md) // Will be removed once codebase architecture is finalized
