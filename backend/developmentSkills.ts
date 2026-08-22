/**
 * Progressive software-development procedures layered on top of the inherited IRIS skill
 * catalog. These teach engineering judgement; they deliberately do not turn languages or
 * frameworks into deterministic runtime policy.
 */

export const DEVELOPMENT_SKILLS = [
  {
    id: 'orbit-development-environment',
    title: 'Development Environment — Inspect, Prepare & Reproduce',
    type: 'procedure',
    agentTarget: '',
    guard: false,
    priority: 7,
    enabled: true,
    triggers: [
      'develop', 'implement', 'project', 'setup', 'environment', 'python', 'node',
      'javascript', 'typescript', 'dependency', 'dependencies', 'requirements',
      'pyproject', 'package.json', 'venv', 'virtual environment',
    ],
    summary:
      'Prepare a real project environment before relying on it. Inspect first, reuse the project’s conventions, make setup reproducible, and verify the environment actually runs.',
    instructions: `DEVELOPMENT ENVIRONMENT — environment setup is part of implementation, not an afterthought. Discover what this project actually uses and make it runnable before depending on assumptions. These are engineering guidelines, not language/framework routing rules: inspect the project and decide what is relevant.

1. INSPECT BEFORE CREATING. Look for README/development instructions, manifests, lockfiles, configured scripts, existing virtual environments, runtime/version files, tool configs, and already-installed dependencies. Prefer established conventions over introducing a new tool.
2. PROVE THE TOOLCHAIN. Identify the runtime/interpreter and package manager the project expects. Check that the commands you intend to use actually exist. If setup is incomplete, fix the environment rather than coding around missing tools.
3. PYTHON: REUSE OR ISOLATE. If the project already uses uv, Poetry, Pipenv, Conda, or another managed environment, follow it. Otherwise, when third-party packages or execution require isolation and no suitable environment exists, strongly prefer a project-local .venv. Use its interpreter explicitly (for example .venv/bin/python) because separate terminal calls do not preserve activation. Never depend on global/system pip for project dependencies.
4. DEPENDENCIES ARE PROJECT STATE. When a dependency is genuinely required, use the project’s package/dependency mechanism and keep the manifest reproducible (requirements.txt/pyproject/package.json/lockfile/etc. as appropriate). A missing-module error is evidence to inspect dependency state and decide whether installation or configuration is the correct fix — not a reason to give up and not permission to install random packages.
5. NODE/JAVASCRIPT/TYPESCRIPT. Infer npm/pnpm/yarn/etc. from the existing project and lockfile. Inspect package.json scripts before inventing commands. Keep dependencies local to the project; do not globally install normal application dependencies.
6. VERIFY SETUP. After changing environment/dependencies, run the smallest useful proof: import/require the dependency, invoke the project script, or otherwise confirm the environment can execute the code you are about to work on.
7. STAY PROPORTIONAL. A dependency-free one-file script may need almost no setup. A mature repository with an existing environment should normally be reused untouched. You decide based on evidence.`,
    examples: [
      'Python project has pyproject.toml + uv.lock → use its existing uv workflow; do not create a competing .venv/pip setup just because Python was mentioned.',
      'Python project has requirements.txt but no environment and needs third-party packages → decide a local .venv is appropriate, install from the manifest, then run with .venv/bin/python.',
      'Node repo has pnpm-lock.yaml and package.json scripts → use pnpm and the existing scripts rather than defaulting to npm commands.',
    ],
    modelVariants: {
      simple: `DEVELOPMENT ENVIRONMENT:
1. Inspect README, manifests, lockfiles, scripts, runtimes and existing environments FIRST.
2. Reuse the project’s package/environment convention. Don’t invent a second one.
3. Python: reuse uv/Poetry/Pipenv/Conda when present; otherwise strongly prefer a project .venv when isolation/dependencies matter. Never global pip.
4. Node: infer npm/pnpm/yarn from the project and use local dependencies/scripts.
5. Missing module? Inspect dependency state, install only if genuinely required, update the manifest as appropriate, then retry.
6. Verify the environment actually runs before relying on it.`,
    },
    dependencies: ['orbit-terminal-mastery', 'orbit-package-install'],
  },
  {
    id: 'orbit-browser-application-verification',
    title: 'Browser Application Verification — Run What the User Will Run',
    type: 'procedure',
    agentTarget: '',
    guard: false,
    priority: 7,
    enabled: true,
    triggers: [
      'browser', 'website', 'web app', 'frontend', 'front-end', 'ui', 'react', 'vue',
      'angular', 'nuxt', 'next.js', 'svelte', 'javascript', 'typescript', 'dom', 'css',
    ],
    summary:
      'Runtime verification guidance for software that actually executes in a browser. Strongly consider running the real local application and inspecting browser evidence when relevant; JavaScript or TypeScript alone does not imply browser verification.',
    instructions: `BROWSER APPLICATION VERIFICATION — if the project you inspected ultimately delivers behavior inside a browser, strongly consider executing that behavior in a real browser before calling it finished. This is advice, not a language/framework rule: TypeScript can be a CLI or server, JavaScript can be Node-only, and a documentation-only edit may need no browser at all. Decide from the actual project and change.

WHEN IT IS USEFUL:
- You changed client-side rendering, routing, hydration, browser APIs, UI state, assets, CSS/layout behavior, network-driven page behavior, or other code whose correctness is only fully visible at browser runtime.
- Tests/builds pass but user-visible behavior could still fail at runtime.
- You are debugging a blank page, console exception, failed asset/module load, or behavior that differs from compile-time expectations.

HOW TO USE THE BUILT-IN INSPECTOR:
1. Start the application using the project’s own development/preview command when appropriate.
2. Use browser.inspect on the LOCAL LOOPBACK URL.
3. Treat console exceptions, page-load failures, failed/blocked runtime resources, an unexpectedly blank rendered root, and missing expected DOM content as real evidence.
4. Diagnose the evidence rather than guessing. Fix the underlying source/configuration.
5. After a source change, inspect again. A previous browser pass is stale once relevant code changes.

A build, successful dev-server start, or HTTP 200 proves useful things but does not prove a browser UI actually executed correctly. Conversely, do not manufacture browser work for a non-browser target merely because the source language is JavaScript/TypeScript.

Use the project’s existing E2E framework — or add one when you judge repeatable interaction coverage is genuinely valuable — for behavior that needs clicks/forms/navigation/state assertions. Do not install Playwright/Cypress merely to duplicate the built-in runtime smoke inspection.`,
    examples: [
      'React app builds but renders blank → start it, browser.inspect localhost, use the console/DOM evidence to diagnose, fix, then inspect again.',
      'TypeScript Node CLI change → browser verification is irrelevant; choose CLI tests/runtime evidence instead.',
      'CSS-only visual tweak → browser runtime may be useful, but decide whether the requested outcome can be verified meaningfully with available evidence.',
    ],
    modelVariants: {
      simple: `BROWSER APP VERIFICATION (use when YOU judge the changed code actually runs in a browser):
1. Build/server/HTTP 200 alone does not prove the UI executed.
2. Start the local app and use browser.inspect on its loopback URL when browser runtime evidence matters.
3. Read console/load/resource/DOM/blank-page evidence, fix the cause, then inspect again after changes.
4. JS/TS does NOT automatically mean browser work; a Node CLI/server may need none.
5. Use existing E2E tests for repeatable interactions when worthwhile; don’t install one just to duplicate browser.inspect.`,
    },
    dependencies: ['orbit-finish-the-work', 'orbit-terminal-mastery'],
  },
  {
    id: 'orbit-software-development-lifecycle',
    title: 'Software Development Lifecycle — Build, Test, Review & Verify',
    type: 'procedure',
    agentTarget: '',
    guard: false,
    priority: 7,
    enabled: true,
    triggers: [
      'develop', 'implement', 'code', 'feature', 'fix', 'bug', 'refactor', 'test',
      'lint', 'security', 'review', 'build', 'application', 'project',
    ],
    summary:
      'A proportional, model-driven software-development lifecycle for substantive coding work: understand, plan, prepare the environment, implement, test, inspect bugs/security/quality, run appropriate static/runtime checks, review the final diff, fix failures, and reverify.',
    instructions: `SOFTWARE DEVELOPMENT LIFECYCLE — behave like an engineer responsible for the finished result, not a code generator responsible only for producing a diff. The lifecycle below is a decision framework, NOT a hard-coded checklist. Apply the stages that materially increase confidence for this project/change; skip or adapt stages that are irrelevant, and choose tools from the project’s real ecosystem.

1. UNDERSTAND. Read the request, relevant code, project instructions, current state, and nearby tests/config before changing anything. Search broadly enough to understand integration points but avoid reading the whole repository without need.
2. PLAN. For substantial work, make a concrete TODO plan with an observable outcome. Revise it when evidence changes your understanding.
3. PREPARE THE ENVIRONMENT. Make sure the project can actually run/build/test using its existing runtime, environment and dependency conventions. Load the Development Environment skill when setup matters.
4. IMPLEMENT IN COHERENT SLICES. Prefer the smallest architecture-consistent change that satisfies the goal. Preserve unrelated behavior and existing conventions.
5. TEST WHAT MATTERS. Discover existing tests and conventions first. Add/update tests when new behavior or a regression materially benefits from durable coverage. During iteration, targeted tests are usually efficient; before completion choose whatever broader verification is justified. Do not invent a test framework merely because one is familiar.
6. BUG/QUALITY ANALYSIS. Actively consider failure modes that compilation may miss: edge cases, incorrect assumptions, stale state, integration mismatches, runtime exceptions, error paths, and unintended side effects. Use exact failures from tests/diagnostics/runtime as evidence, then fix and rerun rather than pattern-matching a canned repair.
7. STATIC/LINT/TYPE CHECKS. Use the project’s configured tools when relevant — e.g. Ruff/Pylint, ESLint, TypeScript, Stylelint, compiler checks, or diagnostics.check. Discover what exists rather than hard-coding a language-to-tool mapping.
8. SECURITY REVIEW WHEN RELEVANT. For changes touching trust boundaries, inputs, authentication/authorization, persistence, filesystem/process/network access, secrets, or dependencies, reason about relevant abuse/failure paths such as injection, access-control mistakes, unsafe path/command handling, secret exposure, or untrusted data. Do not perform fake ceremonial security audits on unrelated cosmetic changes.
9. RUNTIME/USER-PATH VERIFICATION. If correctness depends on actually running the software, run it. For browser-targeted behavior, strongly consider the Browser Application Verification skill. For CLIs/services/libraries choose evidence appropriate to those targets.
10. REVIEW THE FINAL STATE. For substantive workspace changes, inspect the final diff/status and look for accidental edits, debug leftovers, generated junk, missing files, or changes outside the intended scope.
11. REVERIFY AFTER FIXES. A check that passed before a relevant source edit may no longer prove the final state. Re-run whichever checks you still judge necessary.
12. DECLARE EVIDENCE. When verification.require / verification.record are available, use them to describe the checks YOU chose and bind them to exact real results. The runtime validates evidence; it does not choose your lifecycle for you.

Stay proportional. A tiny typo fix may need a read-back and one check. A substantial feature may justify tests, lint/type checks, security reasoning, runtime execution and independent review. The model owns that judgment.`,
    examples: [
      'Small config typo → inspect context, fix, run the relevant parser/build check, review diff; no invented security ceremony.',
      'New authenticated API endpoint → inspect conventions, implement, add targeted tests, run static checks, reason about auth/input/trust boundaries, run relevant service tests, review diff, reverify after fixes.',
      'Frontend feature → follow project tests/build and, if runtime behavior matters, load browser verification and inspect the actual local page.',
    ],
    modelVariants: {
      simple: `SOFTWARE DEVELOPMENT LIFECYCLE — choose what is relevant; this is NOT a mandatory checklist:
1. Understand code/project → plan substantial work → prepare the real environment.
2. Implement coherently and preserve unrelated behavior.
3. Discover and run appropriate tests; add/update tests when durable coverage matters.
4. Use project-configured lint/type/static diagnostics where useful.
5. Analyze likely bugs and security/trust-boundary issues when the change warrants it.
6. Run the real software when runtime behavior matters; browser-targeted work may benefit from browser.inspect.
7. Review the final diff/status. After fixes, rerun checks that became stale.
8. If verification.require/record exist, declare the checks YOU chose and bind them to real evidence.`,
    },
    dependencies: ['orbit-problem-solving', 'orbit-finish-the-work', 'orbit-development-environment'],
  },
]

export default DEVELOPMENT_SKILLS
