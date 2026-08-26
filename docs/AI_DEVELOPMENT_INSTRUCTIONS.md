# AI Development Instructions

**Read this before changing the repository.**

This document records the maintainer's required development approach for AI-assisted work on Code Editor. It exists to prevent development from being slowed down by unnecessary infrastructure, speculative cleanup, overbroad changes, or repeated attempts to solve problems that are not actually present.

## Non-negotiable repository workflow

1. **Work on the real source code.** When fixing a bug or implementing a feature, edit the actual source/test/documentation files that own the behavior.
2. **Commit directly to `main`.** Fetch the latest `main` immediately before writing so a change does not overwrite newer work. Do not create side branches unless the maintainer explicitly asks for one.
3. **Do not use GitHub Actions as a patching mechanism.** Never create a workflow that edits source files, generates patches, creates commits, pushes commits, self-modifies, or performs repository maintenance.
4. **Do not recreate GitHub Actions workflows.** The repository intentionally has no GitHub Actions workflows. Do not add `.github/workflows/*` unless the maintainer explicitly asks for CI to be restored.
5. **Testing is local, not workflow-driven.** Perform lightweight checks that are available in the current environment. For full verification, give the maintainer a short copy/paste command to run locally.
6. **Finish the task when possible.** Do not stop halfway through a fix merely to report that work is in progress. Continue until the requested change is complete unless genuine user intervention is required.

The standard full local verification command is:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

`verify:full` runs formatting checks, lint, TypeScript checks, tests, the Electron runtime check, and the production build. Do not invent a remote CI substitute for this command.

## How to approach a bug

### 1. Trace the real failing path first

Start from the observed behavior and follow the actual code path that produces it. Read the relevant callers, selection logic, state source, tests, and integration boundary before changing anything.

Do not infer a broad architectural problem from one error message. A symptom such as a timeout, missing credential, warning, or failed fallback may have several independent causes. Separate them before editing.

### 2. Identify the invariant that should hold

Prefer a small shared rule over scattered workarounds. Examples:

- a model without a live credential must not enter an executable candidate pool;
- a recently failed model should not immediately be selected again in the same failover chain;
- agent file writes must respect live editor authority;
- privileged operations must remain behind the existing trusted boundaries.

Once the invariant is clear, enforce it at the earliest shared selection or authority point that owns the decision.

### 3. Make the narrowest complete fix

Change as little as necessary to fix the real problem completely. Follow existing architecture and style. Avoid opportunistic refactors, renames, dependency upgrades, formatting sweeps, or unrelated cleanup in the same change.

If the bug exposes two genuinely separate defects, fix both, but keep each change evidence-based. Do not turn a targeted bug fix into a repository redesign.

### 4. Add focused regression coverage

When practical, add or update a test that captures the exact failed behavior and the intended invariant. Tests should represent real runtime state. For example, if credential availability is determined by the secure key store, a test should use that state rather than pretending that stale validation metadata is equivalent to a live key.

Do not rewrite large test areas merely to obtain a green result. If an old test encoded behavior that is no longer intended, update it narrowly and explain why.

### 5. Review the final diff for collateral damage

Before committing, check that the change does not broaden permissions, weaken security, alter unrelated defaults, remove compatibility code, or silently change user-visible behavior outside the task.

Commit the actual source change directly to `main` with a focused commit message.

## Things an AI must not do

### Do not abuse GitHub workflows

This is the strongest operational rule in this repository.

Do **not**:

- create temporary patch/fix/repair workflows;
- use Actions runners because local/container networking is inconvenient;
- create a workflow whose purpose is to edit or commit repository files;
- use a workflow as a substitute for direct GitHub write access;
- add trigger files to make a workflow run;
- repeatedly push workflow changes to diagnose source-code problems;
- restore automatic CI without an explicit request from the maintainer.

If direct repository write access is available, use it.

### Do not chase warning counts for their own sake

A warning is evidence to inspect, not an instruction to modify code.

- Do not delete working code merely to make lint report zero warnings.
- Do not refactor large compatibility modules because a few private helpers appear unused without first proving reachability and product intent.
- Do not optimize bundle size simply because Vite reports a large chunk. This is a large desktop application; size alone is not a defect.
- Do not treat every build warning as a release blocker.

Fix warnings only when they reveal a concrete correctness, maintainability, or user-facing problem and the change is low risk.

### Do not panic over `npm audit`

Node projects commonly report transitive advisories. The goal is not to make the vulnerability counter read zero.

Do **not**:

- run `npm audit fix --force` as routine cleanup;
- manually chase dependency-of-dependency versions only to reduce the count;
- add overrides without understanding why they are needed;
- upgrade major dependencies as part of an unrelated bug fix.

If dependency security is relevant to the task, inspect the advisory, determine whether the vulnerable path is reachable in Code Editor, identify the direct dependency that owns it, and make a compatible upgrade only when there is a concrete reason.

### Do not delete code because its name looks old

Files with names such as `agentRuntimeLegacy.ts` and `toolBrokerLegacy.ts` are active implementation. `Legacy` describes provenance, not dead code.

Likewise, do not assume code is dead because:

- it has no obvious React caller;
- it is loaded by filename, worker, child process, IPC, route registration, or tool registration;
- it originated in IRIS;
- it is large;
- it looks like a compatibility layer.

Follow the safe deletion rules in [`CODE_CLEANUP_REVIEW.md`](./CODE_CLEANUP_REVIEW.md). Ambiguous code stays until reachability and product intent are established.

### Do not weaken security to make development easier

Preserve the repository's fail-closed security properties. In particular, do not casually weaken or bypass:

- Electron `safeStorage` credential handling;
- encrypted persistence and storage-key handling;
- authenticated loopback bridge checks;
- renderer trust and navigation checks;
- preload/IPC boundaries;
- workspace containment;
- permission tiers and approval checks;
- editor file authority, revisions, and write leases.

Do not delete encrypted databases, keys, `.iris-ai` state, or user data as a troubleshooting shortcut.

### Do not rewrite historical IRIS documentation as current product documentation

`docs/iris-reference/` is a historical source archive. It is intentionally not synchronized to current Code Editor behavior. Update current documentation instead of rewriting the archive unless the maintainer explicitly requests a change to its archival purpose.

### Do not manufacture work

Do not invent a broad cleanup project because a small issue was discovered. Do not create placeholder commits, proof-of-access commits, temporary files, migration scaffolding, or infrastructure unless explicitly requested or genuinely required by the implementation.

When the requested bug is fixed, stop expanding scope.

## Repository-specific change boundaries

Before deleting, replacing, or restructuring inherited platform code, read [`CODE_CLEANUP_REVIEW.md`](./CODE_CLEANUP_REVIEW.md) and [`MIGRATION.md`](./MIGRATION.md).

Important retained areas include:

- provider adapters and model routing/failover;
- worker and child-process entry files loaded indirectly;
- encrypted-storage upgrade/compatibility paths;
- notes, launcher, skills, semantic search, and other agent runtime services even when they have no dedicated panel;
- renderer/backend shared agent bus helpers;
- layered security and containment checks where apparent duplication is defense in depth.

Large-file decomposition is a separate tested refactor project. Line count alone is not a reason to edit or delete code.

## Communication with the maintainer

Keep development communication concise and useful.

- Say what you found, what you changed, and what remains.
- Do not dump long command lists when one copy/paste command will do.
- If full verification needs to run on the maintainer's machine, provide one compact command block and ask for the resulting output only if something fails.
- Do not repeatedly report an in-progress state and wait for permission to continue when the next step can be performed autonomously.
- Be explicit when verification is incomplete. Do not claim a change is fully verified when it has only been inspected statically.

## Default decision rule

When choosing between a clever, broad, infrastructure-heavy solution and a small direct source change that preserves the existing architecture, choose the small direct source change.

The desired development style for this repository is **conservative, evidence-based, direct, and boring in the best possible way**.