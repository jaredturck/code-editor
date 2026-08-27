# Code Editor

A desktop Electron code editor with CodeMirror editing, an integrated terminal, diagnostics, source-control support, browser/runtime inspection, persistent settings, and a long-running **local coding-agent runtime**.

The product is intentionally focused on software development. Historical IRIS migration/reference material is not part of the active architecture; Git history preserves that provenance, while required third-party attribution remains in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

![Code Editor](./src/assets/screenshots/Screenshot_20260630_153119.png)

## Features

- Open folders as workspaces with a lazy, live-updating Explorer tree.
- Create, rename, move, copy, reveal, trash, edit, save, and reopen project files.
- CodeMirror language support, search/replace, editor commands, tabs, and dirty-state handling.
- Persistent shell sessions rendered with xterm.js and backed by `node-pty`.
- Ruff, ESLint, TypeScript, Stylelint, HTML, JSON, YAML, Markdown, and parser-based diagnostics.
- Problems panel, editor squiggles, gutter markers, and diagnostic hover messages.
- Source-control UI with Git mutation owned by the application rather than unrestricted agent shell commands.
- Browser/runtime inspection and managed development-server lifecycle for application development.
- Local Qwen-class native-tool coding loop with narrow file, terminal, diagnostics, browser, web-research, code-navigation, and agent-delegation tools.
- Structural code navigation through symbol definition/reference lookup plus ordinary file/content search.
- Durable long-running project ledger with requirements, acceptance criteria, work dependencies, failed approaches, evaluator findings, verification records, checkpoints, managed processes, and worker state.
- Parallel executor workspaces using Git worktrees; worker execution can run concurrently while integration into the shared workspace is serialized.
- Fresh-context project replanning after stalls and crash/restart recovery of interrupted work.
- Independent evaluation from fresh repository, diagnostics, build/test/lint/typecheck, managed-runtime, and browser evidence.
- Generation-scoped verification evidence: successful old checks do not certify later mutations.
- Hard completion gate for current editor/workspace diagnostics with `severity=error`.
- Workspace containment, revision checks, write leases, destructive-command protection, network/package policy, and encrypted local persistence.

System utilities such as Python, Git, compilers, and interpreters are not bundled. Terminal commands use programs available through the user's normal `PATH`.

## Agent architecture

Automatic workspace projects use a durable project lifecycle:

```text
initialize requirements
→ normalize dependency graph
→ dispatch scouts/executors/evaluators
→ checkpoint and integrate isolated worker changes
→ collect fresh deterministic verification evidence
→ independently evaluate requirements
→ materialize repairs or missing requirements
→ replan when progress stalls
→ continue in fresh contexts until accepted or genuinely blocked
```

Individual model contexts are deliberately bounded so one confused context cannot monopolize a multi-hour project. The project itself persists across context handoffs and application restarts.

The runtime is local-model-first and uses native tool calling. It does not depend on a second model-driven controller to translate prose into tool actions.

## Installation

`node-pty`, SQLite, and Sharp include native components. A normal install runs `@electron/rebuild`, so the host needs the usual native Node build toolchain.

```bash
npm install
npm run dev
```

Ollama or another local OpenAI-compatible endpoint can provide the coding model. Agent/model settings are configured through the editor's AI Settings UI.

On Linux, Electron must have a real OS secret-storage backend; the application intentionally refuses insecure secret-storage fallback for protected persisted data.

## Development guide

Read [`docs/AI_README.md`](./docs/AI_README.md) before changing the agent/runtime architecture. It is the single current architecture and contribution guide; historical migration documents were removed once they stopped describing the product.

## Verification

```bash
npm ci
ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

`verify:full` runs formatting checks, lint, TypeScript checks, Vitest, Electron runtime checks, and the production build. CI workflows are intentionally absent; full verification is local.

## Third-party notices

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). The Apache 2.0 license for retained IRIS-derived implementation fragments is at [`LICENSES/IRIS-APACHE-2.0.txt`](./LICENSES/IRIS-APACHE-2.0.txt).
