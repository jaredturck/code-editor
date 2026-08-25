# Current IRIS Integration Status

**Status: migration complete.**

This document describes the current Code Editor product after the IRIS migration. Historical P006/P007/P008 plans and reviews describe temporary milestone boundaries and are not the current capability map.

## Product architecture

The Code Editor remains the visible application shell. IRIS supplies the agent/runtime/platform underneath it.

```text
Code Editor renderer
├─ human editor actions → preload/editor IPC → filesystem/terminal/git/browser
└─ Agent Chat
   └─ IRIS session runtime / tool broker
      ├─ editor-aware workspace file authority
      ├─ authenticated localhost bridge
      ├─ semantic/RAG/web/provider services
      ├─ encrypted persistence
      └─ multi-agent / vision / automation / local-system services
```

The important boundary is that human editor IPC and agent authority are separate. Agent filesystem mutations stay behind the broker plus the editor-aware authority layer rather than directly using the human-facing renderer APIs.

## Connected capabilities

### Agent execution and autonomous projects

- configured provider/model execution through `runAgentSession`;
- encrypted conversations and run history;
- durable TODOs/checkpoints, pause/resume and restart recovery;
- bounded long-run project working context;
- approvals/questions, cancellation and emergency stop;
- skills, artifacts, memory and web research;
- permission-scoped tool exposure plus execution-time policy checks.

### Workspace coding loop

- live CodeMirror buffers are authoritative for agent file reads;
- workspace-root realpath/symlink containment;
- read/write/edit/patch operations with revision checks;
- brokered terminal/build/test/lint execution;
- live editor diagnostics supplied as bounded evidence;
- exact search, semantic search and RAG;
- Git remains owned by the Code Editor host rather than direct agent Git mutation.

### Collision protection

Parallel agent coding is guarded by task-scoped file write leases and actor-scoped live-file revisions. A human edit makes an agent's remembered revision stale, and a second agent cannot write a file while another task holds its lease.

`tests/editorAgentCollision.test.ts` directly covers both stale human edits and competing agent writes. The current recorded test run passed both cases.

### Search and project understanding

- exact workspace search;
- MiniLM semantic text indexing;
- document/PDF/archive extraction;
- CLIP image/video indexing and runtime selection;
- semantic concepts;
- incremental workspace rescans;
- workspace-scoped RAG with editor-aware evidence re-reads.

### Model/providers

- OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter and local/Ollama-compatible providers;
- secure provider credentials and model discovery;
- Orchestrator/Executor/Scout/Reviewer assignments;
- model health, routing, cooldown/recovery and failover;
- hybrid local/cloud execution;
- local runtime/model setup policy.

### Multi-agent development and review

- configured runtime team activation;
- bounded delegation, asynchronous independent tasks and result recall;
- peer consultation and independent review;
- delegated role/tool policy inheritance;
- task settlement releases write leases;
- autonomous acceptance gate blocks completion on unresolved work, stale/failed review, active delegates or outstanding leases;
- bounded remediation/re-review continuations.

### Persistence and reusable outputs

- OS-protected master key;
- AES-256-GCM encrypted SQLite records with HKDF-SHA256 domain separation;
- encrypted messages, attachments, chat context and autonomous checkpoints;
- encrypted user/project skills;
- encrypted chunked artifacts opened through the in-app Markdown viewer.

### Audio, vision, automation and runtime visibility

- local/cloud voice transcription;
- fresh local-only screen understanding;
- separate screen-capture and desktop-automation permissions;
- exact-plan, single-use automation approval tokens;
- CPU/RAM/GPU/process telemetry;
- model/token/context/cache and agent activity telemetry;
- effective autonomous authority visibility;
- launcher/tool discovery and managed dev-environment controls.

## Intentionally retained but not first-class UI

Some migrated Notes/chat/panel controller helpers and compatibility paths remain in the tree even when the old IRIS presentation was deliberately omitted. They are not evidence of incomplete migration. See [`UNWIRED_BACKEND.md`](./UNWIRED_BACKEND.md).

The archived original IRIS documentation under `docs/iris-reference/` is historical source material, not a Code Editor backlog.

## Verification state

The dependency-installation limitation from the original migration environment is no longer current. The latest supplied local verification snapshot ran the installed project and recorded:

- lint: **161 warnings, 0 errors**;
- TypeScript typecheck: **pass**;
- Code Editor Vitest: **156 passed, 2 failed** across 158 tests;
- editor/agent collision tests: **2 passed**;
- Electron runtime smoke: **pass**;
- production build: **pass**.

Because the first Vitest phase failed, the chained compatible migrated IRIS suite did not execute in that particular `npm test` invocation. The two failing tests are:

1. `tests/agentRuntimeContext.test.ts` — failed-tool recovery continuation expectation;
2. `tests/chatEncryptionPersistence.test.ts` — restored attachment-content expectation.

A React missing-`key` warning also appears during `AISettingsPanel.test.tsx`.

This means the **migration is complete but the repository verification state is not fully green**. The failures and warnings are post-migration correctness/cleanup work.

See [`VALIDATION_REPORT.md`](./VALIDATION_REPORT.md) for the verification ledger.

## Post-migration priorities

1. Fix the two failing tests and the React key warning.
2. Remove stale/unused runtime imports and helpers driving the lint warning count.
3. Run `npm run verify:full` until both Code Editor and migrated IRIS suites pass end-to-end.
4. Perform reachability/dead-export cleanup only with dependency-aware verification.
5. Treat additional UI surfaces or scheduled/background project execution as new feature work rather than migration completion work.
