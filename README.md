# Code Editor

A desktop Electron code editor with CodeMirror editing, persistent settings, local media viewers, a real integrated terminal, diagnostics, Markdown preview, and the migrated IRIS agent/backend platform.

The IRIS migration is complete for the defined product scope. The Code Editor remains the visible product shell; reusable IRIS agent, provider, persistence, semantic-search, automation, multi-agent, and local-system capabilities run underneath the editor rather than restoring the old IRIS Orb/panel UI.

![Code Editor](./src/assets/screenshots/Screenshot_20260630_153119.png)

## Features

- Open folders as workspaces with a lazy, live-updating Explorer tree
- Create, rename, move, copy, reveal, and trash project files and folders
- Open, edit, save, and reopen source files with language-aware CodeMirror support
- Persistent editor settings, recent files, shortcuts, syntax color schemes, and unsaved-document shutdown handling
- Persistent shell sessions rendered with xterm.js and backed by `node-pty`
- Ruff, ESLint, TypeScript, Stylelint, HTML, JSON, YAML, Markdown, and parser-based diagnostics
- Problems panel, editor squiggles, gutter markers, and diagnostic hover messages
- Image, video, audio, PDF, and unsupported-binary viewer tabs
- Editable Markdown files with GitHub-flavored preview and highlighted code blocks
- IRIS Agent Chat with configured provider/model execution, encrypted history, durable project runs, editor-aware workspace editing, multi-agent coordination/review, text/image attachments, voice transcription, local screen understanding, permissioned desktop automation, and live runtime visibility
- Exact and semantic workspace search, document/PDF/archive extraction, image/video semantic indexing, semantic concepts, and RAG
- Encrypted memory, project checkpoints, skills, artifacts, web research, model routing/health/failover, and hybrid local/cloud execution
- CPU/RAM/GPU/process, model, agent, token, context, cache, and authority visibility during autonomous runs
- Read-only autonomous discovery of system pressure, running processes, and verified local launcher/tool availability
- Managed development-environment status plus explicit Start/Stop controls
- Permission-scoped autonomous tool exposure with broker, workspace-containment, approval, bridge, and per-role checks
- Fail-closed defaults for machine permissions, sudo, shell networking, web ingestion, package installation, screen capture, and desktop automation
- Compatible migrated IRIS runtime tests included in `npm test`
- Dedicated long-running recovery and multi-agent collision coverage
- OS-protected credential storage and encrypted local SQLite persistence
- Authenticated loopback capability bridge with emergency-stop support

System utilities such as Python, Git, compilers, and interpreters are not bundled. Commands entered in the terminal use programs available through the user's normal `PATH`.

## IRIS migration status

**Migration status: complete.**

The reusable IRIS platform/backend has been migrated into the Code Editor. The old IRIS product presentation is intentionally not part of the target: the Orb/planet launcher, old panel shell, duplicate editor/file-manager UI, old multi-window shell, authentication/profile presentation, and other presentation-only pieces remain omitted by design.

The active platform is organized under `src/platform/`, `src/platform-features/`, `backend/`, and `electron/platform/`. Some compatibility/controller code remains intentionally unmounted where the underlying capability is already exposed through a Code Editor-native surface. That retained code is not unfinished migration work.

Migration documentation has been consolidated now that the migration is complete:

- [`docs/MIGRATION.md`](./docs/MIGRATION.md) — authoritative migration history, architecture, source mapping, security boundaries, validation context, and guidance for future maintainers
- [`docs/iris-reference/`](./docs/iris-reference/) — preserved documentation from the original IRIS source project

The old milestone/checklist documents remain available through Git history when forensic migration detail is needed.

## Installation

`node-pty` is a native Electron dependency, and the migrated backend also uses SQLite and Sharp. A normal install runs `@electron/rebuild`; the machine therefore needs the usual native Node build toolchain. On Arch Linux, that generally means `base-devel` and Python for `node-gyp`.

```bash
npm install
npm run dev
```

Ollama is optional and remains available through the migrated local-provider backend. Cloud/local provider credentials, model discovery, role assignments, routing, autonomy limits, skills, semantic-index settings, and local runtime settings are exposed through the Code Editor's AI Settings UI.

The secure IRIS platform initializes before the renderer. On Linux, Electron must have a real OS secret-storage backend; the application intentionally refuses the insecure `basic_text` fallback.

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:electron-runtime
npm run build
```

`npm test` runs the Code Editor integration suite and then the compatible migrated IRIS runtime suite. `npm run verify:full` runs the complete correctness/build verification sequence.

Migration-era validation context is recorded in [`docs/MIGRATION.md`](./docs/MIGRATION.md). Current source and current verification results are authoritative when they differ from historical snapshots.

## Third-party notices

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
