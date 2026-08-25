# Code Cleanup Review

**Audit status:** Review only — no application code was removed as part of this document  
**Audit date:** 2026-08-25  
**Repository:** `jaredturck/code-editor`  
**Audited baseline:** `3e04a7564d41d0fab8edb6eeeaf64a472982900a`

## Purpose

This document is the deeper cleanup review requested after the first two post-migration deletion passes.

The goal of the review is not to make the repository as small as possible. The goal is to remove code that no longer contributes to the product while protecting the substantial IRIS runtime that makes the Code Editor useful as an agentic development environment.

The Code Editor is unusual because a comparatively lightweight editor shell sits around a much larger migrated agent platform. That means ordinary dead-code heuristics are not sufficient. A file with no normal renderer import may still be launched as a worker, loaded by filename, exposed through a bridge route, used only by a benchmark, preserved for upgrade compatibility, or form a useful seam around a large legacy implementation.

This review therefore uses a stricter standard than “no imports means delete it.”

It should be read together with:

- [`MIGRATION.md`](./MIGRATION.md), which explains what came from IRIS and why;
- [`REMOVED_CODE.md`](./REMOVED_CODE.md), which records code already removed during cleanup passes one and two.

This document is the forward-looking cleanup backlog. `REMOVED_CODE.md` is the historical removal ledger.

---

## Executive summary

The repository is in much better shape after the first two cleanup passes. The obvious old IRIS panels, Orb/window-shell compatibility, obsolete Electron shell helpers, an unused evaluation harness and several dead runtime helpers have already been removed.

The remaining cleanup work is more nuanced.

The strongest remaining opportunities are:

1. remove or port migrated tests that are no longer part of the supported test configuration;
2. remove stale generated benchmark output from version control;
3. remove dependencies that no longer have code consumers;
4. simplify the old Orb-named settings layer, especially the provider/theme code that is no longer mounted;
5. remove partial-file dead APIs left behind in migrated Chat compatibility utilities;
6. remove or deliberately reconnect the renderer logging facade;
7. remove the obsolete direct-Ollama Chat IPC path while retaining model/runtime and transcription functionality;
8. trim several individual unused declarations and stale settings fields;
9. gradually eliminate `@ts-nocheck` from active core runtime code;
10. consider architectural consolidation of duplicate/shared implementations only after the safer cleanup work is complete.

Several things that superficially look removable should explicitly **not** be deleted:

- the large `*Legacy` agent/runtime files;
- worker and child-process modules with no ordinary imports;
- upgrade/legacy encrypted-storage cleanup;
- notes, launcher and skills services used by agents even when no dedicated human-facing panel exists;
- provider adapters;
- benchmark source code;
- thin backend route/service boundaries;
- security and authority layers that appear repetitive because they intentionally enforce checks at multiple boundaries.

The recommended next destructive cleanup should therefore focus first on tests, package dependencies, stale settings/UI compatibility and partial-file dead exports rather than major runtime modules.

---

## Review methodology

The audit was performed against the tracked `main` tree after cleanup pass two rather than against the original migration ZIP.

The review considered the repository as several separate execution graphs:

- renderer application rooted at `src/main.tsx` / `src/App.tsx`;
- Electron main/preload runtime;
- privileged backend bridge rooted at `backend/bridgeServer.ts`;
- worker and child-process modules loaded by filename rather than normal imports;
- normal Code Editor Vitest tests;
- migrated IRIS tests selected by `vitest.iris.config.ts`;
- benchmark entry points and package scripts;
- build/configuration files;
- migration/reference documentation.

For deletion decisions, the following checklist was used.

### Reachability

- Is the module imported by live application code?
- Is it re-exported from an active module?
- Is it registered by string, route name, IPC channel, tool catalogue, provider table or plugin table?
- Is it launched as a Worker, child process, preload script or subprocess by filename?
- Is it used only by tests or benchmarks?

### Product fit

- Does the capability belong in an agentic code editor?
- Does the Code Editor already provide a better native surface for the same capability?
- Is this implementation an old IRIS presentation layer rather than reusable runtime behavior?
- Is the feature genuinely obsolete, or merely not currently exposed in the UI?

### Future value

- Is this a reasonable foundation for functionality the product is likely to need?
- Would deleting it save meaningful maintenance cost?
- Would restoring it later be difficult or risky?
- Is the code generic runtime infrastructure or product-specific historical scaffolding?

### Safety

- Can it be removed without changing supported behavior?
- Does it carry migration/upgrade compatibility responsibilities?
- Does it enforce security, workspace containment, approvals, permissions or data durability?
- Is apparent duplication intentional defense-in-depth?

### Verification quality

- Is there current test coverage for the behavior?
- Is the existing test itself active in the supported test configuration?
- Would deleting the code leave stale declarations, package dependencies, configuration or documentation?

The classifications in this report are:

- **A — Strong removal candidate:** evidence strongly supports deletion with normal verification.
- **B — Conditional removal/refactor:** likely cleanup, but requires a focused product or architectural decision.
- **C — Keep:** suspicious-looking code that has valid current or compatibility value.
- **D — Quality cleanup:** not a deletion candidate, but worth simplifying, typing or reorganizing.

---

# A — Strong removal candidates

## A1. Migrated tests outside the supported migrated-test configuration

**Priority:** High  
**Risk:** Low to medium  
**Approximate size:** about 2,600 lines across roughly 33 migrated test files identified during the audit

A meaningful subset of `migrated-tests/iris/` is no longer selected by `vitest.iris.config.ts` and therefore is not executed by the normal `npm test` path.

Many of these tests target IRIS product surfaces that have already been deliberately removed from Code Editor, including historical:

- Search UI/controller behavior;
- old Settings presentation;
- Orb behavior;
- old screen-capture presentation/integration;
- duplicate editor UI;
- other panel-oriented IRIS behavior.

Keeping tests for deleted source has several costs:

- it makes the repository appear to have broader active coverage than it does;
- future AI models may infer that deleted IRIS UI is supposed to return;
- test searches lead maintainers toward historical APIs;
- renames/refactors can create noise in tests that are never run.

### Recommendation

Delete tests whose corresponding production surface no longer exists and which are outside the supported migrated-test include set.

However, do **not** bulk-delete all currently excluded migrated tests. A few contain valuable behavioral coverage that should be ported first.

### Tests worth porting rather than discarding

The audit identified Electron/security-oriented tests around areas such as:

- credential storage;
- Linux password/secret-storage behavior;
- storage-key behavior.

Those properties remain important to the current application even if the tests point at historical paths. The correct cleanup is to rewrite them against the current Electron/security modules and then delete the obsolete versions.

### Acceptance criteria

Before deletion:

1. enumerate tests outside the active `vitest.iris.config.ts` include surface;
2. classify each as obsolete product UI vs still-relevant security/runtime behavior;
3. port still-relevant assertions;
4. delete the historical-only remainder;
5. update `migrated-tests/iris/README.md` to describe only the actually supported test surface.

---

## A2. Stale tracked benchmark output

**Priority:** High  
**Risk:** Low

`benchmark-results/iris/` appears to be historical generated benchmark output rather than active source.

The current benchmark runner writes current results to the newer benchmark-results paths, while the tracked IRIS subfolder represents an older snapshot from the source product era.

Generated benchmark reports are useful locally, but committing one historical result tree indefinitely creates ambiguity about which results are authoritative.

### Recommendation

Remove stale generated benchmark output from Git unless there is an explicit decision that historical benchmark snapshots are permanent fixtures.

If benchmark history is valuable, prefer one of these models:

- retain only a deliberately curated baseline file with a date/model/runtime description;
- keep generated history outside Git in `~/.iris-ai/` as the current benchmark tooling already supports;
- store benchmark artifacts in CI/release artifacts rather than source control.

The benchmark **source harness** under `benchmarks/iris/` should remain.

---

## A3. Unused package dependencies

**Priority:** High  
**Risk:** Low if removed one at a time with build/test verification

Repository-wide usage review found several packages that appear to have no remaining source consumers after the IRIS presentation cleanup.

### Strong candidates

- `codemirror` — the convenience/meta package appears unnecessary because the application imports the individual `@codemirror/*` packages directly;
- `clsx` — previously useful to migrated UI utility code, but no longer appears to have a live consumer;
- `tailwind-merge` — same situation as `clsx`; the old migrated `cn()` utility was already removed;
- `lucide-react` — no active component usage was found in the current editor UI.

### Likely candidate

- `@vitest/coverage-v8` — no current coverage script/configuration was found during the audit. Remove if coverage is not intentionally about to be restored.

### Recommendation

Handle this as a dependency-only cleanup commit. Remove the packages from `package.json`/lockfile, reinstall, then run the full verification chain.

This has a particularly good maintenance payoff because unused packages contribute install time, lockfile complexity, vulnerability noise and future upgrade burden without providing product functionality.

---

## A4. Unmounted Orb settings provider and old appearance side effects

**Priority:** High  
**Risk:** Medium  
**Files of interest:**

- `src/platform-context/orb/SettingsContext.tsx`
- `src/platform-context/orb/useOrbSettings.ts`
- `src/platform-context/AgentSettingsContext.ts`
- Orb appearance/theme helper code such as `orbAppearance.ts`

The settings audit found an important structural fact: the migrated Orb settings provider is not mounted by the current Code Editor application.

Current consumers obtain settings through the standalone behavior in `useOrbSettings()` / its Code Editor alias. The provider-specific presentation side effects therefore do not run.

This makes the old provider infrastructure fundamentally different from the still-active settings persistence hook.

### Why this matters

The old provider contains IRIS presentation behavior for things like Orb appearance/accent application. Code Editor already has its own application theme system through its native editor settings and theme classes.

Therefore the provider is not merely unused by accident; much of its responsibility has been superseded by the Code Editor UI architecture.

### Recommendation

Perform a focused settings cleanup that:

1. preserves the settings persistence/state behavior actually used by Agent Chat and AI Settings;
2. removes the unmounted provider component;
3. removes old Orb-only appearance side effects;
4. renames Orb-flavored public names where practical so future maintainers are not forced to understand the source product's presentation terminology.

This should be done as a small refactor rather than deleting the whole settings system. `useOrbSettings()` is still central to active AI/provider/runtime configuration.

---

## A5. Orb appearance helper and historical appearance settings

**Priority:** High  
**Risk:** Medium

Related to A4, the old Orb appearance helper is effectively reachable only through the unmounted provider.

The Code Editor already owns application appearance separately.

Several stored settings therefore look like historical IRIS presentation baggage rather than current Code Editor configuration, including candidates such as:

- `orb_size`;
- `orb_texture`;
- old `appearance_theme` / `appearance_accent` fields where they duplicate Code Editor-native theme settings.

### Recommendation

Remove them only after checking persistence migration behavior.

Old stored settings keys can safely be ignored in many systems, but removing parser/default/type fields should be done carefully so existing encrypted settings payloads continue to load even if extra historical properties are present.

This is a good example of code that is likely removable but should not be deleted by pure call-graph automation.

---

## A6. Dead partial APIs inside the remaining migrated Chat compatibility layer

**Priority:** High  
**Risk:** Medium

The first cleanup pass removed several completely unused `chat-ui` controller/utility files. The deeper audit found that the remaining compatibility files still contain partial APIs whose callers disappeared with the old IRIS chat presentation.

Examples identified during the audit include old concepts around:

- timeline-specific types;
- thought-group rendering structures;
- agent-segment display structures;
- old scroll-controller state/types;
- legacy layout constants;
- persisted-message/UI constants that no longer participate in Code Editor persistence;
- tool-timeout display machinery belonging to the old timeline presentation.

Current Code Editor Agent Chat has its own activity presentation, including `AgentActivityTimeline.tsx`, and does not need all of the historical IRIS rendering model.

### Recommendation

Do a symbol-level cleanup rather than deleting whole remaining Chat compatibility modules.

For every export:

1. find all importers;
2. remove unreferenced types/constants/helpers;
3. retain normalization/model-shaping helpers still used by Code Editor Chat;
4. run Agent Chat, persistence and activity tests after each focused batch.

This should reduce conceptual complexity without touching the actual agent runtime.

---

## A7. Old browser-based attachment preparation path

**Priority:** Medium-high  
**Risk:** Low to medium  
**File:** `src/platform/chatAttachments.ts`

Current Code Editor attachment loading uses the trusted editor bridge (`window.editor_api.file.read_attachment`) to read local attachments.

The migrated attachment helper still contains an older browser-oriented path involving browser `File` objects and canvas/image preparation.

That browser path appears to be residue from the standalone IRIS web/renderer environment rather than the current desktop editor workflow.

### Recommendation

Remove only the obsolete browser `File`/canvas preparation branch while preserving:

- attachment persistence helpers;
- content normalization used by Agent Chat;
- provider/model capability checks;
- current bridge-loaded attachment handling.

This is a good partial-file cleanup candidate.

---

## A8. Small confirmed unused declarations

**Priority:** Medium  
**Risk:** Very low

Static unused-declaration review surfaced small, local candidates including:

- unused `ExtractedFileText` declaration in semantic-file code;
- an unused local `relativePath` declaration in `fileSemanticService.ts`;
- unused `realpathOrSelf()` in `filesystemBoundary.ts`.

These do not represent architectural cleanup, but removing this kind of residue improves signal-to-noise and helps make future lint/static-analysis output more useful.

### Recommendation

Bundle genuinely trivial unused declarations into one small hygiene commit rather than creating separate commits for each symbol.

---

# B — Conditional removal or product decisions

## B1. Renderer logging facade

**Priority:** High decision value  
**Risk:** Medium

`src/platform/logger.ts` remains called by active code such as AI service paths, but the old Electron logging IPC surface it expects is no longer exposed by the current preload.

`initRendererLogger()` also does not appear to be part of current renderer startup.

In practice, this makes much of the logging facade inert or less useful than its API suggests.

### Two valid directions

**Option 1 — reconnect it intentionally.**

A durable agentic editor benefits from structured logs, particularly for long autonomous runs, provider failures and bridge debugging. If that is desired, add a narrow current logging bridge with explicit paths/rotation/privacy behavior and make the logger genuinely operational.

**Option 2 — remove it.**

If renderer-to-disk logging is not a product feature, delete the facade and simplify its call sites to normal console/runtime activity reporting where appropriate.

### Recommendation

Make the product decision first. Do not keep a misleading half-connected abstraction indefinitely.

---

## B2. Direct Ollama Chat IPC compatibility path

**Priority:** High  
**Risk:** Medium

The Electron/preload Ollama integration serves multiple responsibilities. Some remain active and useful, particularly local-model/runtime capability and speech/transcription functionality.

However, the audit found an older direct Chat path using concepts such as:

- `start_chat`;
- `cancel_chat`;
- `ai:chat-*` event listeners/handlers.

Current Agent Chat runs through the migrated IRIS agent/session runtime rather than this direct Ollama conversational path.

### Recommendation

Remove the obsolete direct-chat IPC surface surgically while retaining:

- local model discovery/status;
- model management needed by current settings/runtime;
- transcription/speech pieces still used by the editor;
- any active provider compatibility functionality.

Before deletion, search both preload method names and raw IPC channel strings so indirect event listeners are accounted for.

---

## B3. Automatic model setup and hardware-aware local model selection

**Priority:** Product decision  
**Risk:** Medium  
**Files include:**

- `src/platform/autoSetup/autoSetupEngine.ts`
- `src/platform/autoSetup/autoSetupService.ts`
- `src/platform/providers/localRuntimePolicy.ts`

This cluster has no clear live Code Editor UI caller today.

Pure reachability therefore makes it look removable. Product context argues otherwise: automatic provider/model configuration and hardware-aware local model selection are highly plausible features for an agentic editor, especially one designed to support local models.

Related model-selection logic is also connected to active routing/recovery behavior, so the boundary between “unused setup UI workflow” and “useful shared policy” must be handled carefully.

### Recommendation

Do not delete this cluster merely because it is currently unmounted.

Choose explicitly between:

- exposing one-click/hardware-aware setup in AI Settings, in which case keep and integrate it;
- abandoning automatic setup as a product direction, in which case remove only the truly setup-specific pieces and preserve shared model-selection policy used elsewhere.

Until that decision is made, **keep**.

---

## B4. Backend Vite bridge plugin/test harness

**Priority:** Medium  
**Risk:** Medium

`backend/desktopBridgePlugin.ts` and related middleware/error helpers are not part of the current packaged Electron bridge execution path.

However, migrated security/route tests use this layer as an integration harness around the same backend router.

Deleting it immediately would either discard useful security coverage or leave tests needing redesign.

### Recommendation

Port the important bridge/security tests to exercise the standalone/current bridge directly. Once equivalent coverage exists, remove the Vite-plugin compatibility harness.

This is cleanup worth doing, but the tests should move before the implementation disappears.

---

## B5. Historical settings fields unrelated to the Code Editor product

**Priority:** Medium  
**Risk:** Medium

Beyond Orb appearance, several settings fields appear to have weak or no current product use. Candidates identified during the audit include fields such as:

- `agent_dev_mode`;
- `agent_permission_tier_overwatcher`;
- `chat_max_retained`;
- `max_note_chars`;
- `vision_auto_execute`;
- historical global `hotkey` data;
- possibly `chat_auto_title`, depending on current run/chat behavior.

Some may be entirely obsolete. Others may still be read indirectly through generalized settings objects or may represent useful latent functionality.

### Recommendation

Do a settings-field audit with a table containing:

- field;
- default;
- UI control;
- reader(s);
- writer(s);
- persistence compatibility requirement;
- product decision.

Then remove fields in one migration-aware cleanup rather than piecemeal.

---

## B6. Duplicate `agentBusShared.ts` implementations

**Priority:** Medium  
**Risk:** Medium-high

The audit found exact/near-exact shared code on both sides of the renderer/backend build boundary:

- `backend/desktopBridge/shared/agentBusShared.ts`
- `src/platform/agent/agentBusShared.ts`

This duplication is not dead code. It exists because the renderer and backend TypeScript compilation roots are separated.

### Recommendation

Do not delete one copy without changing build architecture.

Longer-term options include:

- create a top-level `shared/` package/directory included by both TS projects;
- generate one side from a canonical schema/source;
- accept the duplication but add a parity test/hash check if the code is intentionally mirrored.

This is architectural cleanup, not pass-three dead-code cleanup.

---

## B7. Oversized compatibility modules and wrapper/legacy layering

**Priority:** Medium  
**Risk:** High

Several large active files still carry `Legacy` naming or have newer wrapper/extension files around a substantial original implementation.

Examples include areas such as:

- `agentRuntimeLegacy.ts`;
- `toolBrokerLegacy.ts`;
- related runtime extension/wrapper layers.

The name “Legacy” makes these tempting cleanup targets, but the deeper call graph confirms that they still contain active implementation.

### Recommendation

Do **not** delete them.

If cleanup is desired, treat it as a refactor project:

1. identify stable responsibility boundaries;
2. move active implementation into appropriately named modules;
3. shrink the legacy file incrementally;
4. preserve behavior with runtime/tool-broker tests;
5. rename only after the implementation has actually moved.

A giant file is not automatically dead code.

---

# C — Code that should explicitly be kept

## C1. Worker and child-process modules with no ordinary importers

Some backend files initially appear unreachable in static import reports but are started through Worker/child-process APIs or referenced by filename.

These must be treated as runtime entry points.

### Rule for future cleanup

Before deleting any apparently-unreferenced backend/Electron file, search for:

- basename strings;
- `new Worker(...)`;
- `fork(...)`;
- `spawn(...)` / `execFile(...)`;
- preload path construction;
- compiled-output filename references;
- URL/path-based dynamic loading.

Import-count-only cleanup would break these paths.

---

## C2. `*Legacy` runtime implementation files

As noted above, legacy naming is historical, not proof of deadness.

The agent runtime and tool broker still depend on substantial legacy implementation. These files are part of the working product and should remain until deliberately refactored.

---

## C3. Upgrade/legacy encrypted-storage cleanup

Compatibility code that recognizes or cleans historical persistence formats can look unused in a fresh install because it is exercised only during upgrades.

Do not delete migration/cleanup logic solely because current writes no longer use the old format.

Removal should happen only when the application explicitly drops upgrade support from the relevant historical version and the retained-data impact is understood.

---

## C4. Notes, launcher and skills runtime services

The old dedicated Notes, Launcher and Skills panels were removed because they duplicated or did not fit the Code Editor UI.

The underlying runtime services are different:

- notes/memory storage can support agents and project context;
- launcher/tool discovery is useful for machine-aware coding agents;
- skills are an active part of agent behavior.

The absence of a standalone panel is **not** evidence that the service should disappear.

---

## C5. Provider adapters and routing infrastructure

Cloud/local provider modules should be retained even when a particular provider is not currently configured by the developer.

Provider diversity, routing, health and failover are core agent-platform functionality rather than dead feature flags.

A provider should be removed only if the product intentionally stops supporting it, not because a static runtime snapshot does not instantiate it.

---

## C6. Benchmark source harness

`benchmarks/iris/` remains wired into package scripts and is useful for measuring model/runtime behavior separately from deterministic tests.

Generated outputs may be cleanup candidates; benchmark source is not.

---

## C7. Thin backend route/service wrappers

Some backend service files are extremely small and delegate into a very large runtime module.

They may look pointless by line count, but they provide useful dependency and route boundaries.

Deleting those seams and importing one giant implementation everywhere would make future decomposition harder.

The better long-term direction is the opposite: gradually move implementation out of `bridgeServiceRuntime.ts` into those service modules while keeping the public service boundaries stable.

---

## C8. Security checks that appear duplicated

The product intentionally enforces authority at several levels:

- renderer/editor authority;
- agent/tool broker policy;
- bridge permissions;
- backend path/system boundaries;
- Electron trusted boundary.

Do not deduplicate security checks merely because two layers validate related conditions.

In this architecture, duplication can be defense-in-depth rather than accidental repetition.

---

# D — Quality and maintainability cleanup

## D1. Reduce `@ts-nocheck` in active core code

**Priority:** High quality payoff  
**Risk:** Medium/high if attempted wholesale

The audit found roughly fourteen important files using `@ts-nocheck`, including core runtime, broker, policy and backend/route implementation.

This is not dead code, but it materially lowers confidence in future cleanup because TypeScript cannot help prove that an edit preserved contracts inside those files.

### Recommendation

Restore typing incrementally, one subsystem at a time.

A sensible order is:

1. smaller extracted runtime-policy modules;
2. route/service modules;
3. broker extensions;
4. large session/runtime implementation last.

Do not turn this into a giant “fix every type error” rewrite.

---

## D2. Large-file decomposition where boundaries already exist

Very large files such as session/runtime and bridge service implementations are maintainability risks, but splitting by arbitrary line count would make the code worse.

Only extract responsibilities that already have coherent boundaries and tests.

Good extraction signals include:

- a cluster of imports used by one feature only;
- a self-contained policy/state machine;
- an existing thin wrapper waiting to own the logic;
- repeated independent tests around a subset of behavior.

Bad extraction signal: “this file is long.”

---

## D3. Rename historical Orb terminology in active non-UI APIs

Some active settings/context names still say `Orb` even though the Orb presentation has been permanently removed.

Examples include the settings hook/provider naming and `orbitDesktop` compatibility terminology.

This is not functionally harmful, but it creates cognitive overhead and repeatedly causes cleanup audits to mistake active code for dead UI.

### Recommendation

After obsolete Orb-only code is removed, gradually rename the surviving generic concepts to Agent/Platform/Code Editor terminology.

Keep compatibility aliases temporarily where needed so the rename is low risk.

---

## D4. Make the migrated-test README truthful

The migrated-test documentation still describes historical commands and coverage that no longer match package scripts/current include configuration.

Examples observed during the review include references to commands such as coverage/verification scripts that are no longer present and descriptions of old UI coverage that is not part of the active migrated-test suite.

Update this alongside A1 so documentation describes the real supported test contract.

---

## D5. Dependency/static-analysis hygiene as a recurring check

After the migration, stale imports/dependencies accumulated because large files were modularized and old presentation layers were removed.

Rather than relying entirely on occasional manual sweeps, it would be useful to add lightweight periodic checks for:

- unused dependencies;
- TypeScript unused declarations where practical;
- duplicate exported APIs;
- test files outside configured test globs;
- tracked generated/cache output.

The checks should report rather than automatically delete.

---

# Suggested pass-three sequence

If the goal is to continue destructive cleanup after reviewing this document, the following order gives the best risk/reward balance.

## Commit 1 — test/documentation cleanup

- classify migrated tests outside the active test config;
- port security/storage tests that still matter;
- delete obsolete UI-only migrated tests;
- correct `migrated-tests/iris/README.md`.

This removes historical noise without touching production runtime behavior.

## Commit 2 — package/repository hygiene

- remove stale `benchmark-results/iris/` output;
- remove confirmed-unused npm dependencies;
- update lockfile;
- remove trivial unused declarations.

Again, very little product risk.

## Commit 3 — settings presentation cleanup

- remove the unmounted Orb settings provider;
- remove old Orb appearance logic;
- remove confirmed historical appearance fields while retaining settings persistence compatibility;
- optionally introduce cleaner Agent Settings aliases/names.

This is the first commit that deserves focused UI/settings regression testing.

## Commit 4 — Chat compatibility trimming

- remove dead exports/types/constants from remaining migrated Chat helpers;
- remove the obsolete browser attachment preparation path;
- verify Chat history, attachments, activity timeline and autonomous-run restoration.

## Commit 5 — choose logging direction

Either reconnect a narrow real logging bridge or remove the inert renderer logger abstraction and simplify call sites.

Do not leave it indefinitely halfway between the two designs.

## Commit 6 — remove direct Ollama Chat IPC

After exact IPC-string verification, remove only the legacy conversational IPC path while retaining active local-model and transcription behavior.

## Later architectural work

Only after the above is stable should the project consider:

- auto-setup product decision;
- backend Vite-plugin test-harness removal after test porting;
- shared agent-bus source consolidation;
- decomposition/renaming of legacy runtime modules;
- systematic removal of `@ts-nocheck`.

---

# Areas that should require explicit discussion before deletion

For clarity, the following should not be removed in a future cleanup pass without first making an explicit product/architecture decision:

- automatic/hardware-aware model setup;
- local-runtime policy that may feed active recovery/routing;
- renderer logging as a product capability;
- backend Vite bridge harness until its security tests are ported;
- duplicated renderer/backend agent-bus shared code;
- any `*Legacy` core runtime file;
- upgrade compatibility/persistence cleanup;
- worker/child-process modules;
- notes/launcher/skills backend capability;
- provider adapters;
- benchmark harness;
- layered security/permission checks.

If a future model proposes deleting one of these purely because it has few static importers, this document should be treated as a warning to investigate the runtime architecture first.

---

# Definition of “safe enough to delete” for this repository

For future destructive cleanup, a candidate should normally satisfy all of the following:

1. **No supported runtime caller.** Static imports, re-exports, tool/route registrations, IPC strings and dynamic filename loads have been checked.
2. **No unique supported feature.** The capability is obsolete, duplicated by the Code Editor, or intentionally abandoned.
3. **No important compatibility duty.** It does not migrate old user data, preserve security behavior or support upgrades.
4. **No valuable active test/benchmark role.** If tests depend on it only as a historical harness, the tests have been ported or deliberately retired.
5. **No stronger future-value case.** If the code is a plausible foundation for a product capability, that product decision has been made explicitly.
6. **Deletion reduces complexity.** Removing the code does not force awkward duplication or collapse useful module boundaries.
7. **Verification is available.** Relevant targeted tests and the normal full verification sequence can be run after the change.

This is stricter than ordinary dead-code removal, but appropriate for a migrated agent platform with multiple privilege boundaries and indirect execution paths.

---

# Final assessment

There is still worthwhile cleanup available, but the repository has crossed an important threshold: the easiest migration residue has largely been removed.

Future deletions should now be smaller and more intentional.

The highest-value near-term work is not to tear apart the 200k-line IRIS heritage simply because it is large. It is to remove the remaining misleading historical surfaces around that runtime: inactive tests, stale settings presentation, dead Chat presentation APIs, unused dependencies, stale generated output and compatibility IPC that the current editor no longer uses.

The large agent runtime, backend semantic/search systems, provider routing, persistence, multi-agent behavior, authority layers and local-system capabilities generally belong in an agentic code editor even when they are complex. Their cleanup should emphasize better boundaries and typing rather than deletion.

A useful rule going forward is:

> **Delete historical product scaffolding aggressively when reachability and product context agree; refactor active platform complexity carefully; preserve capabilities that make sense for an agentic editor even when their current UI is minimal.**

No source deletion was performed as part of this review.
