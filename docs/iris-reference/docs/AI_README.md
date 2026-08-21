# IRIS Feature Implementation Protocol

## 1. Read-Only Architecture Review

Before editing code, inspect the existing implementation thoroughly.

Review:

- The feature’s current components, hooks, services, routes, and utilities
- Direct callers and dependencies
- Shared types, settings, contexts, and persistence contracts
- Development and packaged desktop behavior
- Existing tests and documented invariants
- Compatibility code that may support older state or execution paths

Build a clear execution map:

```text
User interaction
→ React component or hook
→ client or service
→ bridge route
→ runtime implementation
→ persistence or operating-system operation
→ response back to the UI
```

Also inspect reverse dependencies so that changing a shared function does not silently break unrelated features.

Continue reviewing until there is enough context to confidently implement the requested change, identify the important affected paths, preserve relevant public contracts, and explain the likely regression risks.

The review does not require proving that every file in the repository is unrelated. Once the implementation path, important dependencies, shared contracts, and compatibility behavior are understood with reasonable confidence, stop searching and proceed to the implementation map.

Revisit the architecture only when implementation reveals a material assumption that must be checked.

Perform a brief review of `package.json` and the available project scripts. Identify relevant dependencies, runtime commands, verification commands, and packaging commands. This should be a focused scan rather than an exhaustive dependency audit unless the feature directly changes dependencies or build configuration.

No source files should be modified during this stage.

## 2. Final Implementation Map

Once the current architecture is understood with reasonable confidence, define the exact implementation before coding.

Identify:

- Files to add
- Files to modify
- Files to retire or delete
- Existing public contracts that should remain stable
- New types, state, routes, services, or storage requirements
- Startup and shutdown implications
- Error and recovery behavior
- Compatibility requirements
- Documentation and test updates
- Likely regression risks

Resolve material architectural questions before implementation begins. Minor uncertainties may be handled during implementation when they do not affect the overall design.

If the proposed feature conflicts with the existing design, update the plan rather than forcing the feature into the wrong layer.

## 3. Batched Implementation

Implement the feature in connected layers rather than making isolated edits and repeatedly changing direction.

A typical order is:

1. Shared types, contracts, and foundational utilities
2. Backend, bridge, service, or persistence implementation
3. Renderer clients, hooks, and state
4. User-interface integration
5. Error handling and lifecycle behavior
6. Compatibility and cleanup work
7. Tests and documentation

Preserve existing interfaces where practical. This reduces the number of callers that need to change and lowers regression risk.

Complete logically connected changes together before moving to the next subsystem.

When new behavior is introduced, add or update focused tests where the project’s existing test structure supports them. Prioritize tests for:

- The main success path
- Important failure behavior
- Compatibility requirements
- Regressions that would be difficult to detect through static review alone

## 4. Verification and Focused Fixes

Run primary verification after the implementation has been assembled rather than after every minor edit.

### Baseline Verification

When the commands are available in the implementation environment, normally perform one baseline verification pass consisting of:

- Type checking
- Linting
- The project’s test suite

Focused feature tests and related subsystem tests may also be run when they provide useful feedback.

### Conditional Verification

Additional checks should be selected according to the scope and risk of the change:

- Run packaged-runtime checks when Electron, bridge, native, dependency-loading, or packaged runtime behavior is affected.
- Run a production build when build configuration, bundled resources, module resolution, production-only behavior, or an important integration boundary is affected.
- Run the development desktop application when interactive startup or the main desktop flow needs direct verification and the environment supports it.
- Run packaging commands when packaged application behavior is directly affected or release output needs verification.

A production build, desktop launch, runtime check, or packaging command is not automatically required for every change. Run it when it provides meaningful additional confidence.

### Test Execution Limits

Run each broad test command once initially.

If it fails because of the implementation:

1. Diagnose and fix the underlying issue.
2. Rerun the affected command.
3. If it still fails, diagnose and fix the remaining issue, then perform one final rerun.

Do not execute the same broad test command more than three times in total during one implementation task.

After the third execution, stop rerunning that command. Record the latest result and continue with static review, execution-path tracing, focused inspection, and any other relevant verification methods that remain available.

This limit applies to repeated test-command execution. It does not reduce the responsibility to debug identifiable code defects, inspect the implementation carefully, or fix problems discovered through other methods.

Do not repeatedly run an unchanged focused test without making a meaningful code or test change.

### Failure Handling

Group failures by root cause and fix them systematically.

Avoid repeatedly patching individual symptoms without checking whether they come from one shared integration problem.

Treat failures in affected code, types, tests, integration paths, and runtime behavior as part of the implementation responsibility. Investigate them and fix them where reasonably possible.

Continue debugging while there is a reasonable, evidence-based path toward a fix. Do not repeat the same unsuccessful action when it produces no new information.

If an issue cannot be resolved because of an environmental limitation, unavailable dependency, platform restriction, external tooling problem, clearly unrelated pre-existing failure, or another understood blocker:

- Stop the unproductive retry loop.
- Revert the affected section when it cannot be delivered safely.
- Otherwise preserve the best working implementation when the remaining issue is isolated, understood, and does not make the delivered code knowingly unusable.
- Clearly explain the unresolved issue, likely impact, checks performed, and exact local verification steps.

Do not knowingly present broken code merely because a verification command failed.

### Environment and Dependency Limits

When verification is blocked by a missing dependency or environment requirement, make one normal installation or setup attempt.

A second attempt may be made when there is a clear corrective action based on the first failure.

If the second attempt fails:

- Stop retrying the installation or environment setup.
- Do not repeatedly modify the environment in search of a working configuration.
- Continue with source inspection, dependency-contract review, static analysis, execution-path tracing, and any checks that remain available.
- Clearly state which runtime behavior could not be directly verified.
- Provide the exact command the user should run locally.

### Manual Reasoning Review

Regardless of which commands can be executed, manually review the implementation as a connected system.

Trace and inspect:

- The main success path
- Important failure paths
- Data and state changes
- Startup and shutdown behavior
- Resource initialization and cleanup
- Persistence behavior
- Compatibility behavior
- Existing callers and reverse dependencies
- Error propagation and user-visible feedback

Use this review to find defects that automated checks may not cover.

A lightweight check may be run at a major implementation boundary when it can catch a significant mistake early. Broader verification should normally happen near the end.

## 5. Final Integrity Review

Before producing the final patch, review the complete change as one unit.

Confirm that:

- The feature works through its full user flow
- Existing functionality remains intact
- New resources are initialized and cleaned up correctly
- Errors are visible and handled consistently
- Compatibility paths have not been removed accidentally
- Tests cover the important success and failure cases where the project supports them
- Documentation reflects the implementation that was actually delivered
- No debugging code, temporary files, or incomplete branches remain
- Only changed and newly added files are included in the patch archive
- All archive paths are relative to the project root

If the final review finds a concrete defect or regression risk, fix it and rerun the directly affected checks within the verification limits.

Do not restart the complete architecture and verification process unless the discovery materially changes the implementation design.

If one isolated part cannot be completed reliably, revert that section rather than shipping knowingly broken behavior. Clearly document anything that was not implemented or could not be verified.

## 6. Time-Management Guidance

Use rough time blocks to keep the implementation focused:

```text
Architecture review          20–30%
Implementation mapping       10%
Batched implementation       40–50%
Verification and fixes       20–30%
Final integrity review       5–10%
```

These are guidelines rather than hard limits. More time should be given to any stage that reveals unexpected complexity.

Correctness takes priority over completing every planned item within an arbitrary time window. However, do not spend unlimited time repeating searches, test commands, dependency installation attempts, or environment setup actions that are no longer producing useful information.

## 7. Execution and Exit Rules

The goal is to deliver working, carefully reviewed code without entering repetitive search, installation, or verification loops.

- Stop architecture exploration once there is enough context to confidently implement the change and assess its main regression risks.
- Normally run baseline type checking, linting, and tests once when supported.
- Do not run the same broad test command more than three times in total.
- Continue fixing identifiable implementation defects, but do not repeat an action that produces no new information.
- Attempt blocked dependency installation or environment setup no more than twice.
- Compensate for unavailable runtime verification with deeper static review, execution-path tracing, contract checking, and focused inspection of success and failure behavior.
- Run builds, development launches, Electron runtime checks, and packaging checks when they are relevant and supported rather than automatically for every task.
- Treat a long-running development command as verified once the expected ready state or a meaningful startup error has been observed. Record the result and terminate the process rather than waiting for it to exit naturally.
- When a remaining issue cannot reasonably be resolved, revert the unsafe portion or deliver the best working implementation with a precise explanation of the limitation and required local verification.

These limits apply to repetitive tool execution. They do not reduce the requirement to reason carefully, fix discovered bugs, preserve existing behavior, and perform a thorough final integrity review.

## 8. Delivery Requirements

For each completed IRIS feature:

- Provide a ZIP containing only changed or newly added files
- Preserve the project-relative folder structure
- List any required commands in a separate code block
- Explain what was implemented and what was verified
- State any unverified platform or runtime behavior honestly
- Include a two-to-three-sentence Git commit message
- End the commit message with:

```text
Co-authored-by: ChatGPT <noreply@openai.com>
```

## 9. Required Commands

For every completed feature, provide the commands the user should run after extracting the patch ZIP into the existing project.

Assume every command will be run from the root of the project. Always use project-relative paths.

### Deleted Files

A patch ZIP can contain changed and newly added files, but it cannot represent the deletion of an existing file. When the implementation deletes a file from the project, provide the exact `rm` command required to remove it after the patch is extracted.

For example:

```bash
rm src/path/to/obsolete_file.ts
```

Only include an `rm` command when the completed implementation actually removed that file. Do not include speculative cleanup commands or commands for unrelated caches, generated output, or temporary files.

Place required deletion commands before dependency installation, verification, build, and launch commands. Briefly state why each deleted file is no longer required.

### Standard Project Flow

Inspect the project’s current `package.json` with a focused scan and provide the complete relevant commands required to install dependencies, format-check, lint, type-check, test, build, and launch the application.

For IRIS, the standard full local verification flow is:

```bash
npm install
npm run format
npm run lint
npm run typecheck
npm test
npm run test:electron-runtime
npm run build
npm run dev
```

These commands perform the following work:

- `npm install` installs or updates dependencies from `package.json` and `package-lock.json`.
- `npm run format` checks the complete project with Prettier without modifying files.
- `npm run lint` runs ESLint across the project.
- `npm run typecheck` checks the renderer, server, Electron, tests, and configuration TypeScript projects.
- `npm test` runs the complete Vitest test suite.
- `npm run test:electron-runtime` checks that bridge dependencies load under Electron’s embedded runtime.
- `npm run build` compiles Electron and server sources and creates the production renderer build.
- `npm run dev` starts the complete desktop development application for manual verification.

This is the recommended complete local flow. Use the applicable commands during implementation according to the scope of the change, environment support, and verification limits.

When Prettier reports formatting problems, correct the affected files and rerun:

```bash
npm run format
```

After formatting or making a focused fix, rerun the affected check and any checks whose previous result may have been invalidated.

Repeat the complete verification flow only when later changes are broad enough to affect multiple subsystems. The same broad test command remains subject to the three-execution limit.

The project also provides a combined full-verification command:

```bash
npm run verify:full
```

Focused feature tests may be run in addition to the main test suite while diagnosing or developing a feature. They do not need to replace the broader test suite when the broader suite is relevant and supported.

Electron runtime checks, production builds, and manual desktop verification should be run when they are relevant to the affected implementation and supported by the environment. When they cannot be run, include the commands and clearly mark them as requiring local verification.

When `npm run dev` is used, consider the check complete once the expected ready state or a meaningful startup failure has been observed. Record the result and terminate the process rather than waiting for it to exit naturally.

Packaging commands should also be included when packaged behavior is affected or when a release build needs verification:

```bash
npm run app:pack
npm run app:dist
```

Keep commands in their required execution order. Clearly mark commands that are optional, platform-specific, destructive, or expected to take significant time.

Do not claim that a command completed successfully unless it was actually run. When a command could not be executed in the implementation environment, include it and clearly state that it still requires local verification.
