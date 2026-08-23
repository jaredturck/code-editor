# IRIS Developer Guide

Read this before changing the renderer, bridge, Electron lifecycle, agent runtime, or persistence. IRIS is a desktop-only Electron application with mandatory encrypted application storage.

## 1. Canonical development mode

```bash
npm install
npm run dev
```

`npm run dev` aliases `dev:desktop`:

```text
Vite serves renderer assets
+ Electron starts
+ Electron initializes safeStorage and SQLite
+ Electron starts the authenticated bridge
+ Electron loads the Vite URL
```

There is no supported browser-only application mode and no temporary persistence substitute. A storage initialization failure should be visible and should prevent normal operation.

## 2. Repository map

```text
electron-src/    Authored Electron CommonJS TypeScript (.cts), including editor native services
electron/        Generated Electron runtime (.cjs)
server/          Authored bridge TypeScript
server-dist/     Generated bridge runtime
src/             Renderer and agent TypeScript/TSX
tests/           Vitest contracts
```

Key boundaries:

- `electron-src/main.cts` — lifecycle, secure startup, shutdown
- `electron-src/storageKeyStore.cts` — wrapped application master key
- `electron-src/credentialStore.cts` — provider credential vault
- `electron-src/localBridge.cts` — shared dev/production bridge startup
- `electron-src/editorIpc.cts` and `electron-src/editor/` — editor-only sender-checked workspace, file, PTY, diagnostics, media-protocol, and browser-view capabilities
- `src/features/editor/` — integrated editor workbench renderer and Iris-agent sidebar
- `server/bridgeServer.ts` — authenticated bridge host
- `server/desktopBridge/storage/` — encryption, schema, transactions, repositories
- `src/lib/localStorageStore.ts` — synchronous in-memory renderer facade backed by encrypted bridge state
- `src/lib/chatSessionStore.ts` — secure chat client contract
- `src/lib/desktopBridge.ts` — renderer-to-bridge API
- `src/lib/agent/runtime/` — primary agent orchestration

## 3. Encrypted storage contract

The database lives at:

```text
~/.iris-ai/iris.sqlite3
```

The application uses the real SQLite 3 engine through the `sqlite3` dependency. It is embedded and requires no system service, user account, port, or manual schema setup.

The storage sequence is:

```text
Electron safeStorage unwraps master key
→ bridge receives key in process memory
→ repository serializes sensitive value
→ AES-256-GCM encrypts value
→ SQLite receives ciphertext, nonce, tag, and permitted metadata
```

Rules:

- Never pass the master key to the renderer.
- Never write the plaintext master key to disk.
- Only the safeStorage-wrapped key is stored in `storage_keys`.
- Use a fresh nonce for every encrypted write.
- Bind ciphertext to domain, record ID, and field through AAD.
- Do not add plaintext fallback, browser storage fallback, or best-effort persistence.
- Do not put provider credentials into general settings or encrypted-store payloads; keep them in the credential vault.
- Do not create plaintext temporary files for internal artifacts, patch text, sub-agent output, or chat state.
- Explicit user exports and user-requested project file writes may be plaintext.

## 4. Adding or changing durable data

1. Decide whether the value is application-owned persistence or an explicit user output.
2. Add or extend the appropriate repository in `server/desktopBridge/storage/encryptedDatabase.ts`.
3. Keep only necessary metadata in plaintext columns.
4. Encrypt the sensitive payload before SQL insertion.
5. Add route/service/client operations rather than exposing raw SQL or encryption methods.
6. Hydrate the renderer into memory only after the encrypted bridge is ready.
7. Add byte-scan tests proving sentinel plaintext is absent from SQLite, WAL, and SHM files.
8. Add restart, tamper, wrong-key, transaction, and deletion tests as relevant.

The generic renderer store is suitable for settings, notes, launcher state, agent runs, and small UI state. Large artifacts and sub-agent outputs use dedicated encrypted tables and opaque IDs.

## 5. Chat persistence

Chat persistence is mandatory when the chat UI is available.

```text
ChatPanel
→ chatSessionStore
→ desktopBridge client
→ persistence route
→ encrypted chat repository
→ SQLite
```

A user message is committed before the model request begins. An assistant message is committed before it is presented as durable history. If persistence fails, the run stops and the application reports a fatal storage problem rather than pretending the conversation is saved.

The dropdown loads encrypted titles in a small batch. Selecting a chat queries rows by opaque `chat_id`, decrypts only that conversation in bridge memory, and returns it to the renderer. Deleting a chat removes its messages and state transactionally through foreign-key cascades.

## 6. Agent runtime

The primary entry point is `src/lib/agent/runtime/sessionRunner.ts`.

- Stateful loop: native provider tool calls and tool results remain in the provider thread.
- Controller fallback: structured action/final decisions for models without reliable native tooling.
- `toolCatalog.ts`: canonical tool name, schema, permission, timeout, risk, UI, and sub-agent metadata.
- `toolBroker.ts`: execution and policy integration.
- `chatContextBuilder.ts`: recent messages, compacted summary, and memory.
- `subAgentRuntime.ts`: executor/scout task loops and encrypted output handoff.

When adding tools, preserve the canonical metadata flow and enforce final authorization at the bridge for operating-system effects.

## 7. Skills

Built-ins come from `server/builtinSkills.ts` and are not copied into the user home directory. User-created skills and overrides are encrypted SQLite records.

When changing skill shape, update normalization, provider prompt generation, encrypted persistence, panel editing, proposal validation, and tests together. External model/trainer proposals remain inactive until approved.

## 8. Bridge API

All privileged routes are under `/api/local/*`. The bridge requires loopback Host, exact Origin, per-launch token, secure storage, and bridge-owned permissions.

Development does not mount the bridge in Vite. `server/desktopBridgePlugin.ts` remains only as a compatibility/test surface for shared middleware behavior and must not become the desktop persistence host again.

When adding a route:

1. Add a focused route handler.
2. Add or reuse a service facade.
3. Keep final policy in the bridge.
4. Add a renderer wrapper if needed.
5. Add boundary tests for authentication, permissions, malformed input, and cleanup.

## 9. Provider credentials

`src/lib/keyStore.ts` talks only to Electron credential IPC. `src/lib/settingsStorage.ts` normalizes credential compatibility fields to empty strings. Search-provider and AI-provider code must not fall back to settings, local storage, environment variables, or memory-only secret stores.

If the operating-system credential store is unavailable, saving or using a required credential fails clearly.

## 10. Integrated editor window

The Editor pill opens one independent BrowserWindow with renderer role `editor`; it is not a workspace panel and clicking the pill again focuses the existing instance. Keep renderer work under `src/features/editor/`, native editor operations under `electron-src/editorIpc.cts` and `electron-src/editor/`, and use the existing Iris preload/credential/bridge/settings contracts rather than recreating a second Electron application.

Editor workspace mutations are accepted only for the folder explicitly selected by that editor renderer. PTYs are owned by the editor WebContents, require the Iris terminal permission, stop on emergency shutdown, and must remain inside the selected editor workspace when a workspace is open. The embedded browser uses a separate sandboxed partition with denied permissions; native views must be destroyed with their editor owner.

Editor application settings and AI history use the encrypted renderer store. The editor shell follows Iris appearance tokens; only source-code syntax palettes remain editor-specific. AI prompts call `runAgentSession()` with the active file and selected attachments, and the selected editor workspace becomes the session's `agent_working_dir`; provider credentials, model routing, Orchestrator/Executor/Scout/Overwatcher behavior, approvals, cancellation, and shared transcription stay under Iris ownership. Do not add a direct Ollama client or plaintext editor settings file.

The retired Training panel and `/api/local/training/*` bridge are not part of the editor. Preserve Skills, skill proposals used elsewhere, reward/evaluation modules, and the multi-agent task bus.

## 11. Logs and diagnostics

Persistent logs are metadata-only. Do not log free-form prompts, responses, file contents, paths, commands, clipboard data, decrypted records, or tool output. Add sentinel regression tests when a new subsystem sends diagnostic data.

## 12. Tests and build gates

Run focused tests while developing, then the full gates near completion:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Security/persistence changes should also run:

```bash
npx vitest run tests/server/encryption.test.ts
npx vitest run tests/server/encryptedDatabase.test.ts
npx vitest run tests/electron/storageKeyStore.test.ts
npx vitest run tests/server/bridgeServerSecurity.test.ts
```

SQLite 3 uses its platform-specific Node-API binary, which is compatible with Electron without an Electron ABI rebuild. The editor's `node-pty` dependency does require `electron-rebuild` during `postinstall`; `npm run test:electron-runtime` checks that PTY and diagnostics dependencies load under Electron. `electron-builder` keeps global `npmRebuild` disabled, so cross-platform packages must still be produced and tested on their target operating systems.

## 13. Common feature workflow

1. Read the existing implementation and all callers.
2. Map the user action through renderer, client, bridge, service, persistence, and response paths.
3. Define exact files and contracts before editing.
4. Implement connected layers in one batch.
5. Run focused tests, then typecheck, lint, full tests, and build.
6. Review cleanup, lifecycle, error handling, documentation, and generated output.
7. Ship only changed/new files in project-relative paths.

## 14. Invariants

- No fake or degraded persistence mode.
- No plaintext application-owned sensitive storage.
- No browser-only runtime path.
- No renderer access to master keys or raw database operations.
- No request-body permission escalation.
- No user credential fallback outside safeStorage.
- No internal plaintext artifact or sub-agent handoff files.
- Persistent panels remain mounted.
- External content cannot authorize tools or persistence.
- Generated runtime output comes from authored source.
