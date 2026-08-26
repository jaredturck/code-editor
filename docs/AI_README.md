# Code Editor — AI Development README

**This is the primary document an AI model should read before changing this repository.**

This file is the single current operating guide for AI-assisted development on Code Editor. It combines the former AI development instructions, cleanup guidance, repository review findings, and the useful implementation practices from the maintainer-supplied reference protocol into one place.

The goal is simple: understand the real code path, make the smallest complete change, preserve important architecture and security boundaries, commit the real change directly to `main`, and avoid wasting time on infrastructure, speculative cleanup, repetitive verification, or invented problems.

Current source code is authoritative when documentation and implementation disagree. `MIGRATION.md` and `REMOVED_CODE.md` provide deeper historical context, but they are not required reading for every change. `docs/iris-reference/` is an archive of the source IRIS project and must not be treated as the current Code Editor backlog.

---

## 1. Repository operating rules

These rules are non-negotiable unless the maintainer explicitly changes them.

### Work on the real repository

- Edit the actual source, test, configuration, or documentation files that own the behavior.
- Commit changes directly to `main`.
- Fetch the latest `main` immediately before writing so newer work is not overwritten.
- Do not create side branches unless the maintainer explicitly asks for one.
- Prefer one coherent commit for one coherent change. Avoid chains of tiny bookkeeping commits when the work can be made atomically.
- Do not create placeholder, proof-of-access, trigger, staging, repair, or infrastructure files unless they are the actual requested product change.

### GitHub Actions are intentionally absent

The repository intentionally has no GitHub Actions workflows.

Do **not**:

- recreate `.github/workflows/`;
- create temporary test, patch, repair, migration, or cleanup workflows;
- use Actions runners as a substitute for direct repository write access;
- create workflows that edit source files, generate patches, create commits, push commits, self-delete, or self-modify;
- add trigger files whose only purpose is to make a workflow run;
- restore automatic CI because local or tool-side verification is inconvenient.

GitHub workflows are not a patching system. If CI is ever restored, it should only happen because the maintainer explicitly requested CI work.

### Verification is local

The standard full verification command for the maintainer is:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

`verify:full` performs formatting checks, linting, TypeScript checks, tests, the Electron runtime check, and the production build.

When the implementation environment cannot run the full command, perform the lightweight checks that are genuinely available, review the code carefully, commit the change, and give the maintainer the command above. Do not invent remote CI infrastructure to compensate.

### Finish the task

Do not stop halfway through a fix merely to say that work is in progress. Continue while there is a reasonable evidence-based path to completion. Stop only when:

- the requested work is complete;
- genuine user intervention is required;
- a material product/design decision cannot be resolved from the repository or request;
- an external/environmental limitation prevents safe completion and there is no productive next action.

Do not repeatedly ask for permission to perform obvious next steps that are already within the task.

---

## 2. Mental model of the repository

Code Editor is an Electron + React + TypeScript desktop code editor built around a substantial agent platform inherited from IRIS.

The useful mental model is:

```text
Code Editor = editor-native product shell
            + migrated IRIS agent/runtime platform
            + trusted Electron/backend authority boundaries
```

This is not a small editor with a thin AI helper. Large parts of the repository implement autonomous agent execution, provider routing, encrypted persistence, semantic indexing, RAG, web research, multi-agent coordination, desktop capabilities, and privileged local services.

### Main areas

- `src/` — React renderer, editor UI, Chat integration, agent clients/runtime, provider/model policy, settings and renderer-side services.
- `src/platform/` — core migrated agent platform, providers, routing/failover, persistence clients, skills, model policy and compatibility/runtime layers.
- `src/platform-features/` — current reusable renderer feature helpers that still have product value.
- `backend/` — privileged local bridge/backend, encrypted storage, filesystem and semantic services, web, launcher, automation, audio, screen, agents and security policy.
- `electron/` — trusted desktop host, preload/IPC, workspace/terminal/Git integration, secure credential/key storage, navigation trust and local bridge startup.
- `tests/` — centralized app, platform and backend regression coverage.
- `docs/MIGRATION.md` — deeper IRIS migration history and architecture provenance.
- `docs/REMOVED_CODE.md` — historical ledger of deliberate deletions.
- `docs/iris-reference/` — preserved historical IRIS documentation; not current requirements.

### Two authority paths must stay separate

Human editor actions and autonomous agent actions intentionally use different authority paths.

```text
Human interaction
→ window.editor_api
→ narrow Electron preload / IPC
→ workspace, terminal, Git, browser, diagnostics, native UI

Agent interaction
→ Agent Chat / project run
→ agent runtime + policy + broker
→ editor-aware file authority / approved tools
→ authenticated local bridge
→ privileged backend services
```

Do not shortcut agent tools into unrestricted human editor IPC. That would bypass policy, containment, approval, collision and capability boundaries designed specifically for autonomous execution.

---

## 3. Before editing: focused architecture review

Before changing code, inspect the existing implementation thoroughly enough to understand the real execution path.

Review the feature's:

- components and hooks;
- clients and services;
- routes, IPC handlers or bridge endpoints;
- runtime implementation;
- shared types and settings;
- persistence contracts;
- direct callers and important reverse dependencies;
- tests and documented invariants;
- compatibility code that may support older persisted state or indirect execution paths.

A useful execution map is:

```text
User interaction
→ React component or hook
→ client/service
→ Electron IPC or local bridge
→ runtime/backend implementation
→ persistence / filesystem / OS / provider operation
→ response back to the UI
```

For agent behavior, also trace selection and policy layers:

```text
Configured model/role
→ credential and availability checks
→ routing/failover/mesh selection
→ runtime call
→ tool/delegation loop
→ verification/finalization
```

### Review reverse dependencies

Changing a shared helper can silently alter unrelated features. Check important callers before modifying shared routing, settings, persistence, security, file authority, provider, bridge or runtime helpers.

### Stop researching when you have enough context

Do not turn every task into a repository-wide archaeology project. The review is complete when you can confidently answer:

- What code currently owns the behavior?
- What invariant should hold?
- Which files actually need to change?
- What important callers/contracts might regress?
- What verification would meaningfully detect a mistake?

If implementation later disproves an assumption, revisit that specific part of the architecture. Do not restart the entire investigation without a material reason.

### Inspect project scripts briefly

A focused `package.json` scan is normally enough. Learn the real install, format, lint, typecheck, test, runtime and build commands. Do not perform an exhaustive dependency audit unless dependencies are actually part of the requested change.

---

## 4. Define the implementation before coding

Once the architecture is understood, form a short implementation map.

Identify:

- files to add;
- files to modify;
- files to delete, if deletion is genuinely justified;
- public contracts that should remain stable;
- types/state/routes/services/storage that must change;
- startup or shutdown implications;
- error and recovery behavior;
- compatibility requirements;
- tests that should capture the regression;
- documentation that will become stale;
- likely regression risks.

Resolve material architectural questions before writing. Minor details can be handled during implementation if they do not change the design.

If the requested feature conflicts with the current architecture, adjust the plan to the architecture instead of forcing functionality into the wrong layer.

---

## 5. Implement in connected layers

Make connected changes together rather than repeatedly bouncing between unrelated files.

A typical order for a cross-layer feature is:

1. shared types/contracts or foundational utilities;
2. backend/Electron/bridge/persistence implementation;
3. renderer clients/hooks/state;
4. UI integration;
5. lifecycle/error/recovery behavior;
6. narrowly justified compatibility or cleanup changes;
7. focused tests;
8. current documentation.

Not every change needs every layer. A small bug should remain small.

Preserve existing interfaces where practical. Changing a shared public contract multiplies regression risk and should only be done when the old contract is actually inadequate.

### Prefer shared invariants over scattered workarounds

When a bug reveals a rule that should always hold, enforce it at the earliest shared point that owns that decision.

Examples:

- a cloud model without a live saved credential must not enter an executable candidate pool;
- a failed model should not immediately be selected again in the same failover chain;
- agent reads of dirty editor files must use the live buffer rather than stale disk state;
- an agent must not overwrite a human edit made after its last observed revision;
- concurrent delegated tasks must respect write leases;
- privileged operations must remain behind trusted boundaries.

Do not patch ten symptoms when one shared gate is the real fix.

---

## 6. Bug-fixing discipline

### Trace the observed failure first

Start with the behavior the maintainer actually observed. Follow the path that produced it before theorizing about broad architecture changes.

One visible failure may contain multiple defects. For example, a delegated model timeout and an unrelated credential fallback can appear in the same timeline. Separate independent causes and fix each at its real ownership point.

### Do not manufacture problems

A warning or scary-looking message is evidence to inspect, not an instruction to begin a cleanup campaign.

Do not invent work because:

- a file is large;
- a filename contains `Legacy`;
- npm reports transitive advisories;
- Vite reports a large output chunk;
- lint has non-failing warnings;
- code originated in IRIS;
- a helper has no obvious React caller;
- an old historical document mentions a TODO.

The task is to fix real product problems, not to optimize arbitrary counters.

### Make the narrowest complete fix

Avoid unrelated:

- refactors;
- naming sweeps;
- formatting sweeps;
- dependency upgrades;
- architecture rewrites;
- dead-code deletion;
- bundle optimization;
- UI redesign.

If a bug exposes two genuine defects, fix both. Do not use "narrow" as an excuse to leave the same failure reachable through an obvious sibling path. The correct target is the smallest **complete** fix.

---

## 7. Model/provider/agent availability rules

Provider/model configuration and model executability are not the same thing.

A configured cloud model is executable only when the required live credential exists. Historical validation metadata, a remembered model name, a role assignment, or an old healthy-state record must not substitute for the current credential state.

Automatic model selection paths should fail closed before making a network request. This applies to:

- initial role selection;
- model routing;
- failover;
- delegation;
- standby pools;
- peer consultation;
- peer review;
- Overwatcher/reviewer selection;
- teamwork planning;
- hybrid cloud candidate selection;
- recovery recommendations;
- background model health activity.

Local models do not require a cloud API key and should not accidentally inherit cloud credential requirements.

### Avoid retry/failover loops

A failure chain must remember the models already attempted. A model that just failed should not be immediately reconsidered merely because another fallback candidate also failed.

Repeatedly bouncing between the same candidates is a runtime bug, not useful resilience.

### Timeouts should follow the active model

Reasoning/deliberative models may legitimately require longer call budgets than ordinary models. Timeout classification should follow the model actually being called, including after failover, rather than being permanently inherited from the first attempted model.

Do not solve a timeout by blindly increasing every timeout in the application. Fix classification or the specific bounded call policy when that is the real issue.

---

## 8. Editor and filesystem authority invariants

Disk is not always the source of truth in a live editor.

### Live buffers are authoritative

If a CodeMirror document has unsaved edits, agent reads must observe the live buffer rather than stale disk content.

### Dirty-buffer writes remain honest

Agent changes to an already-dirty open document should update the editor buffer without pretending the document was saved to disk.

### Workspace containment matters

Agent file operations must remain constrained to the current workspace and preserve the existing realpath/symlink containment checks. A working directory is not an authorization boundary.

### Human/agent races require revision checks

An agent that read revision N must not overwrite revision N+1 created by a human without re-reading.

### Agent/agent races require write leases

Parallel delegated tasks must respect task-scoped write leases so two agents cannot silently mutate the same file concurrently.

Do not bypass these protections to make an edit path easier to implement.

---

## 9. Security invariants

Security behavior is intentionally fail closed. Do not weaken it as a convenience workaround.

Protect:

- Electron `safeStorage` credential handling;
- Linux rejection of insecure `basic_text` secret storage;
- application storage-key handling;
- encrypted SQLite/persistent records;
- authenticated loopback bridge requests;
- trusted renderer navigation and sensitive IPC sender checks;
- preload/context-isolation boundaries;
- workspace containment;
- provider credential isolation;
- capability permission tiers and approval policy;
- persistent permission ownership by trusted Settings/Electron boundaries;
- editor file revisions and write leases;
- network/package-install safety policy.

Do not delete or reset encrypted databases, keys, `.iris-ai` state, user settings, or other user data merely to get development unstuck.

Do not move credentials into renderer settings, logs, chat history, validation history, documentation, or source code.

### One-off approvals are not persistent permissions

A model being approved for one operation must not silently gain durable machine authority. Persistent permission changes belong to the trusted settings path.

### Internal tool classification is not authorization

A tool being marked internal does not make it safe. All executable capabilities remain subject to the relevant session/policy/permission gates.

---

## 10. Cleanup and deletion rules

Cleanup in this repository is conservative.

Before deleting code, check:

- static imports and re-exports;
- dynamic imports;
- IPC names and registrations;
- tool registrations/catalogs;
- bridge routes;
- provider registries;
- worker and child-process files loaded by filename;
- persistence migration/upgrade duties;
- compatibility behavior;
- security boundaries;
- current tests;
- product intent.

A lack of obvious imports is not sufficient proof that code is dead.

### Explicitly retained categories

Treat the following as intentional until proven otherwise:

- `agentRuntimeLegacy.ts`, `toolBrokerLegacy.ts`, and other active legacy-named runtime layers;
- worker/child-process entry modules loaded by filename;
- encrypted-storage upgrade and compatibility logic;
- notes, launcher and skills runtime services even when they do not have dedicated panels;
- provider adapters and model routing/failover infrastructure;
- renderer/backend agent-bus helpers where separate TypeScript build roots require mirrored implementations;
- thin route/service seams useful for backend decomposition;
- layered permission, security and workspace-containment checks where apparent duplication is defense in depth.

### Large files are not automatically a problem

A large compatibility-heavy runtime should only be decomposed as a deliberate tested refactor. Do not delete helpers or split modules merely because line count is high.

### Historical cleanup evidence

`REMOVED_CODE.md` records previous deletions and why they were considered safe. Use it when considering similar cleanup, but do not treat historical cleanup as permission for a new broad sweep.

---

## 11. Warnings, dependencies and maintenance noise

### Lint warnings

Inspect warnings, but do not modify working code just to make the warning count zero.

Fix a warning when it exposes a concrete correctness issue, a clearly dead isolated declaration, or a low-risk maintainability problem. Leave compatibility-heavy or ambiguous code alone until its role is understood.

### Bundle-size warnings

This is a large Electron application. A multi-megabyte renderer bundle is not automatically a defect. Do not start deleting features or restructuring imports merely because Vite reports a chunk-size warning.

Optimize bundles only when there is a measured startup/runtime problem or an explicit optimization task.

### `npm audit`

Node projects commonly contain transitive advisories. The objective is not to force the audit counter to zero.

Do **not** routinely:

- run `npm audit fix --force`;
- chase dependency-of-dependency versions;
- add overrides only to silence advisories;
- perform major upgrades inside unrelated fixes.

If dependency security is relevant, inspect the actual advisory, determine whether the vulnerable path is reachable in this desktop application, identify the direct dependency that owns the path, and make a compatible change only when there is a concrete reason.

### Current deliberate dependency constraints

The repository currently pins Electron `31.7.7` and overrides `onnxruntime-node` to `1.21.0`. `.npmrc` also contains behavior related to ONNX installation. Treat these as deliberate until a focused dependency/runtime change proves otherwise.

---

## 12. Current repository review status

There is one known maintenance item from the repository review that remains intentionally open:

### Electron runtime upgrade

`package.json` pins Electron `31.7.7`.

Do not perform a version-only upgrade as incidental cleanup. A future Electron upgrade should be treated as a focused native-runtime/security maintenance task and preserve:

- OS-backed `safeStorage` and the Linux fail-closed password-store requirement;
- `node-pty` rebuild/runtime behavior;
- renderer navigation and trusted IPC checks;
- audio-only media permission behavior;
- application startup and shutdown behavior;
- the full local verification gate.

Previously reviewed renderer trust/media permission, Auto Setup/runtime-fit, local preview URL, backend lint coverage, and stale local Chat model state issues were resolved. Do not repeatedly rediscover them as open work without evidence of a regression.

GitHub Actions were later intentionally removed. Their absence is current policy, not a missing CI finding.

---

## 13. Testing strategy

Tests should describe current behavior, not preserve historical assumptions.

When new behavior is introduced or a bug is fixed, add or update focused regression coverage when practical. Prioritize:

- the main success path;
- the observed failure path;
- important recovery behavior;
- compatibility requirements;
- security/authority invariants;
- bugs difficult to detect through static review alone.

Tests should use the same state that runtime decisions use. For example, if model availability depends on the secure key store, a test should set or clear the relevant key instead of pretending that stale provider-validation metadata makes the model executable.

Do not rewrite broad test areas merely to obtain green output. If an old test encodes obsolete behavior, update that test narrowly and document why the expectation changed.

---

## 14. Verification protocol

### Broad verification

When the environment supports it, the complete local verification command is:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

The component commands are:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
ELECTRON_DISABLE_SANDBOX=1 npm run test:electron-runtime
npm run build
```

Use the single combined command for ordinary maintainer handoff. Use individual commands when isolating a failure.

### Select checks according to risk

Not every change needs every runtime check during development.

- Run focused tests for the subsystem being changed when useful.
- Typecheck when TypeScript contracts changed.
- Use the Electron runtime check when Electron/native dependency loading changed.
- Build when module resolution, bundling, Electron/backend build output, or production-only integration changed.
- Launch the development desktop application when interactive startup or UI behavior genuinely needs manual confirmation and the environment supports it.

Do not perform expensive checks automatically just because they exist.

### Broad-command retry limit

Avoid verification loops.

For a broad test/build command:

1. Run it once.
2. If it fails because of the implementation, diagnose and make a meaningful fix.
3. Rerun the affected command.
4. If another meaningful fix is required, make it and perform one final rerun.

Do not run the same unchanged broad command more than three times during one task.

Do not repeatedly rerun an unchanged focused test either. A rerun should follow a meaningful code/test/environment change or provide new information.

### Environment/setup retry limit

If verification is blocked by environment setup or dependency installation:

1. Make one normal setup/install attempt.
2. Make a second attempt only when the first failure provides a clear corrective action.
3. If the second attempt fails, stop modifying the environment.

Then continue with static review, execution-path tracing, contract inspection and any focused checks that remain available. State honestly what could not be run and give the maintainer the exact local verification command.

### Failure handling

Group failures by root cause. Do not patch every symptom independently if they share one integration defect.

Continue debugging while there is a reasonable evidence-based route to a fix. Stop repeating an action when it produces no new information.

If an isolated section cannot be delivered safely, revert that section rather than knowingly shipping broken behavior.

### Never overstate verification

Do not say "verified", "all tests pass", or equivalent unless the relevant command actually ran successfully against the delivered code.

Distinguish clearly between:

- statically reviewed;
- focused test passed;
- typecheck/lint passed;
- full `verify:full` passed;
- requires maintainer local verification.

---

## 15. Manual integrity review

Regardless of automated checks, review the change as a connected system before considering it complete.

Trace:

- main success behavior;
- important failure behavior;
- state/data changes;
- startup and shutdown effects;
- resource creation and cleanup;
- persistence behavior;
- compatibility paths;
- current callers and reverse dependencies;
- error propagation and user-visible feedback;
- permission/security consequences;
- behavior after cancellation, interruption or restart when relevant.

Confirm that:

- requested behavior is actually implemented;
- unrelated behavior remains intact;
- temporary/debugging files are absent;
- no workflow files were introduced;
- no incomplete branch of the implementation remains;
- tests/documentation reflect what was actually delivered;
- the final commit contains only purposeful changes.

If the integrity review reveals a concrete defect, fix it and rerun the directly affected check. Do not restart the entire investigation unless the discovery changes the architecture of the solution.

---

## 16. Time and search discipline

A useful rough allocation for non-trivial work is:

```text
Architecture review        20–30%
Implementation mapping     ~10%
Implementation             40–50%
Verification/fixes         20–30%
Final integrity review      5–10%
```

These are guidelines, not timers.

Correctness comes first, but unlimited searching is not correctness. Stop architecture exploration when you understand the implementation path and primary regression risks. Stop repetitive tests, dependency installs, network attempts, or environment setup when they cease producing new information.

Spend most development time changing and validating the real product code—not building scaffolding around the act of changing it.

---

## 17. Direct GitHub delivery workflow

The repository delivery model is direct commits, not patch ZIPs and not workflow-generated commits.

For a normal task:

1. Inspect current `main` and relevant files.
2. Re-fetch the latest `main` immediately before the first write.
3. Modify the real files directly.
4. Add/update focused tests and current documentation when needed.
5. Perform available lightweight verification/static review.
6. Review the complete diff conceptually for collateral damage.
7. Commit directly to `main`.
8. Give the maintainer a concise summary and, when full local verification is still required, one compact command block.

Do not create a branch, pull request, patch ZIP, temporary workflow, trigger file, or generated patch unless the maintainer explicitly asks for that delivery method.

### Commit messages

Use a short imperative subject and a concise body that says what changed and why. Include:

```text
Co-authored-by: ChatGPT <noreply@openai.com>
```

Keep commits narrowly scoped enough that Git history remains useful.

---

## 18. Documentation policy

This file is the authoritative current AI development guide.

When current development practice, architecture guardrails, review findings, or cleanup rules change, update **this file** instead of creating another overlapping AI instruction document.

Use the remaining documentation as follows:

- `README.md` — index pointing here.
- `MIGRATION.md` — detailed migration provenance and deeper architectural history.
- `REMOVED_CODE.md` — historical deletion ledger and rationale.
- `iris-reference/` — preserved historical IRIS source documentation.

Do not rewrite `iris-reference/` to match current Code Editor behavior. Historical TODOs, paths, scripts and product requirements in that directory are not current work items.

Avoid duplicating current instructions across several files. A future AI model should be able to read this document once, then open historical/specialized documents only when the task requires them.

---

## 19. Communication with the maintainer

Keep communication concise and operational.

Good updates answer:

- What did you find?
- What did you change?
- What remains, if anything?

Avoid:

- walls of command output;
- long lists of commands when one command will do;
- repeatedly announcing that a task is still in progress while waiting for permission to continue;
- security alarmism based only on generic npm warnings;
- presenting speculative cleanup as urgent work;
- claiming success before verification is complete.

If the maintainer needs to run verification locally, normally provide:

```bash
npm ci && ELECTRON_DISABLE_SANDBOX=1 npm run verify:full
```

If it fails, ask for the captured output or the relevant failure section and fix the actual source directly.

---

## 20. Quick decision rules

When uncertain, use these defaults:

- **Small direct source fix vs infrastructure:** choose the direct source fix.
- **One shared invariant vs scattered checks:** enforce the shared invariant.
- **Known working compatibility code vs speculative cleanup:** keep the compatibility code.
- **Live credential state vs stale validation metadata:** trust live credential state.
- **Live editor buffer vs disk:** trust the live editor buffer for unsaved files.
- **Security boundary vs convenience:** preserve the boundary.
- **Measured problem vs warning counter:** fix the measured problem.
- **Current source vs historical IRIS docs:** trust current source.
- **Local verification vs GitHub workflow:** use local verification.
- **Continue productive debugging vs repeat the same failed action:** continue only while new evidence is being produced.

The preferred development style for Code Editor is **conservative, evidence-based, direct, and boring in the best possible way**.

---

## 21. Final checklist for AI-assisted changes

Before finishing a task, confirm:

- [ ] I read the current implementation path before editing.
- [ ] I identified the invariant or behavior the change must provide.
- [ ] I changed the actual source rather than building patching infrastructure.
- [ ] I did not create or modify GitHub Actions workflows.
- [ ] I fetched current `main` before writing.
- [ ] The implementation is the smallest complete fix rather than a speculative redesign.
- [ ] I preserved security, editor authority, persistence and compatibility boundaries.
- [ ] I did not delete code merely because it looked old, large or unused.
- [ ] I did not perform unrelated dependency, bundle or lint cleanup.
- [ ] Focused regression tests were added/updated when useful.
- [ ] I reviewed important success and failure paths manually.
- [ ] I did not enter a repetitive test/setup/search loop.
- [ ] I accurately distinguished what was and was not verified.
- [ ] I committed the real change directly to `main`.
- [ ] I provided one compact local verification command when maintainer-side testing is needed.

If those statements are true, the change is being approached in the intended way.