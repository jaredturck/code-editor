from pathlib import Path
import re


def replace_section(text, heading, next_heading, replacement):
    pattern = re.compile(
        rf"{re.escape(heading)}\n.*?(?=\n{re.escape(next_heading)}\n)",
        re.DOTALL,
    )
    updated, count = pattern.subn(replacement.rstrip(), text, count=1)
    if count != 1:
        raise SystemExit(f"Could not replace section: {heading}")
    return updated


migration_path = Path("docs/MIGRATION.md")
migration = migration_path.read_text()

if "**Last reviewed against current source:** 2026-08-26" not in migration:
    migration = migration.replace(
        "**Consolidated:** 2026-08-25  \n",
        "**Consolidated:** 2026-08-25  \n**Last reviewed against current source:** 2026-08-26  \n",
        1,
    )

lines = []
for line in migration.splitlines():
    if line.startswith("| `electron/platform/`"):
        lines.append(
            "| `electron/platform/`                | Trusted credential/storage-key handling, local bridge bootstrap and hidden DuckDuckGo search support                                                                   |"
        )
        continue
    if line.startswith("| `benchmarks/iris/`"):
        continue
    lines.append(line)
migration = "\n".join(lines) + "\n"

migration = replace_section(
    migration,
    "### Trusted Electron infrastructure",
    "### Feature-controller code extracted from the old IRIS presentation",
    """### Trusted Electron infrastructure

**IRIS source:** selected `electron-src/*.cts`  
**Current destination:** `electron/platform/*.cts` plus Code Editor-owned Electron security/navigation modules

The retained migrated Electron platform is now intentionally small:

- `electron/platform/credentialStore.cts`;
- `electron/platform/storageKeyStore.cts`;
- `electron/platform/linuxPasswordStore.cts`;
- `electron/platform/localBridge.cts`;
- `electron/platform/duckDuckGoPageParser.cts`;
- `electron/platform/duckDuckGoSearchWindow.cts`.

Code Editor-owned Electron modules now carry the surrounding renderer trust and media boundaries. In particular, `electron/navigationSecurity.cts` and `electron/navigationBootstrap.cts` keep the privileged renderer pinned to the trusted application URL and restrict media permission to explicitly enabled audio-only capture. The main process applies those checks around privileged IPC and window navigation.

Older migrated Electron compatibility helpers for logging, screen-permission presentation and the old IRIS security/window shell were removed after the current boundaries were proven to replace them.

The old IRIS window manager, Orb window, window-shape code and duplicate editor IPC remain intentionally absent from the live product.""",
)

migration = replace_section(
    migration,
    "### Feature-controller code extracted from the old IRIS presentation",
    "### Tests",
    """### Feature-controller code extracted from the old IRIS presentation

**IRIS source:** selected non-visual logic embedded in feature/panel areas  
**Current destination:** `src/platform-features/**`

Post-migration cleanup removed the unmounted Files, Search, Skills, Launcher, Notes-panel and screen-capture presentation controllers. The feature helpers that still remain are the ones with current callers or current product value:

- `src/platform-features/audio/` — transcription configuration and renderer audio hooks;
- `src/platform-features/chat/` — Chat attachment preparation;
- `src/platform-features/chat-ui/` — approval/controller helpers still used by Agent Chat;
- `src/platform-features/systemMonitor/` — runtime system-monitor hook.

The underlying backend services for notes, launcher, semantic search, skills and screen capture still exist where the agent/runtime uses them. Their deleted old panel controllers should not be mistaken for missing functionality.""",
)

migration = replace_section(
    migration,
    "## Retained compatibility and reference code",
    "## Historical migration sequence",
    """## Retained compatibility and reference code

Some inherited implementation still carries historical naming, but current reachability matters more than the name.

### Notes runtime

`src/platform/notesStorage.ts` remains active runtime infrastructure even though the old standalone Notes panel was removed. A new human-facing Notes product would be optional new functionality rather than migration completion work.

### Current feature helpers

The remaining `src/platform-features/` tree is limited to current audio, Chat/approval and system-monitor helpers. Earlier unmounted Files/Search/Skills/Launcher/Notes/screen-capture controllers were removed during post-migration cleanup; their absence is intentional.

### Legacy-named runtime layers

`src/platform/agentRuntimeLegacy.ts` and `src/platform/agent/runtime/toolBrokerLegacy.ts` are still active implementation layers. “Legacy” describes their provenance, not dead-code status.

These and other inherited runtime pieces should only be decomposed or deleted with evidence:

1. prove no supported caller reaches the code;
2. check dynamic/indirect registrations rather than only static imports;
3. preserve security, storage-upgrade and worker/child-process boundaries;
4. run the complete dependency-aware verification chain;
5. make small, reviewable changes rather than speculative sweeps.

Post-migration cleanup decisions and deleted paths are recorded in `REMOVED_CODE.md`.""",
)

migration = replace_section(
    migration,
    "### Test/benchmark/recovery restoration",
    "## Migration evidence and audit trail",
    """### Test/recovery restoration and later consolidation

Compatible IRIS runtime/backend tests were initially re-enabled, a standalone benchmark harness was temporarily wired into package scripts, and dedicated long-running recovery/collision regressions were added before the migration was declared complete.

Post-migration review then simplified that scaffolding: useful IRIS-derived tests were folded into the single `tests/` tree, stale presentation/migration-only tests were retired, and the standalone benchmark harness was deleted because it was not part of the product or normal CI. Long-running recovery and collision coverage remain in the centralized suite.

At that point the migration checklist was complete and further work became normal product maintenance.""",
)

migration = replace_section(
    migration,
    "### Verification state at documentation consolidation",
    "## Completed migration capability checklist",
    """### Current verification state

As of the 2026-08-26 documentation review, the persistent `.github/workflows/verify.yml` gate passes on `main` using a clean `npm ci` followed by `npm run verify:full`.

The centralized Vitest suite contains **142 test files / 844 tests**. The normal verification gate covers formatting, lint (including `backend/`), TypeScript type checking, backend/Electron builds, the centralized test suite, the Electron/node-pty runtime smoke check and the production Vite build.

Older migration-time snapshots that recorded failing tests or large lint-warning counts are historical only. Git history retains them when forensic context is useful; current source and current CI are authoritative.

---""",
)

migration = migration.replace(
    "- [x] Preserved benchmark harness in `npm run benchmark`",
    "- [x] Standalone benchmark harness reviewed and retired post-migration because it was not part of the product or normal CI",
)

migration = replace_section(
    migration,
    "## What remains after migration",
    "## Guidance for future AI models and maintainers",
    """## What remains after migration

The migration is complete, but normal maintenance continues. Current priorities should be described as product/repository work rather than migration debt.

Examples include:

- upgrading the pinned Electron runtime through a deliberate native-runtime/security verification pass;
- decomposing active legacy-named runtime layers only where tested boundaries justify it;
- reducing type/lint debt incrementally without weakening runtime behavior;
- improving bundle splitting, performance, test coverage and UX;
- adding new provider/model/runtime capabilities or new product surfaces when desired;
- keeping documentation synchronized with current source and CI.

There are no known missing IRIS migration milestones in the defined scope. Features that were never part of that scope—such as a dedicated Notes UI or autonomous background scheduling—remain new product design, not unfinished migration work.""",
)

migration = replace_section(
    migration,
    "## Documentation structure after consolidation",
    "## Final perspective",
    """## Documentation structure after consolidation

Current documentation is indexed in `docs/README.md`:

- `docs/MIGRATION.md` — migration history plus current architecture/security invariants;
- `docs/CODE_REVIEW_FINDINGS.md` — current open review findings and resolved review history;
- `docs/CODE_CLEANUP_REVIEW.md` — cleanup boundaries and intentionally retained implementation;
- `docs/REMOVED_CODE.md` — deliberate post-migration deletion ledger;
- `docs/iris-reference/` — preserved historical documentation from the source IRIS project.

The `docs/iris-reference/` content is intentionally not rewritten to match current Code Editor behavior. Its local `README.md` marks it as an archive and points readers back to the current documentation.

The former `docs/migration/` directory and root `IRIS_MIGRATION.md` were removed because their checklist/patch-review structure had become redundant after completion. Detailed historical migration records remain available through Git history.""",
)

migration_path.write_text(migration)

Path("docs/CODE_REVIEW_FINDINGS.md").write_text("""# Code Review Findings

**Status:** One open maintenance item  
**Reviewed against current source:** 2026-08-26

This document tracks the still-relevant outcomes of the 2026-08-25 repository review. Resolved findings are kept here only so they are not repeatedly rediscovered as open problems.

## Open finding

### P1 — Upgrade the pinned Electron runtime

`package.json` still pins Electron `31.7.7`. A previous staged upgrade did not land, so the repository should not be treated as already upgraded.

This should be handled as a deliberate native-runtime/security maintenance change rather than a version-only dependency bump. A successful upgrade should preserve:

- OS-backed `safeStorage` behavior and the Linux fail-closed password-store requirement;
- `node-pty` native rebuilding and the Electron runtime smoke check;
- privileged renderer navigation and IPC trust checks;
- audio-only media permission behavior;
- the full `npm run verify:full` gate.

No other finding from the original review remains open.

## Resolved findings

### Privileged renderer trust and media permissions

Resolved by `859eccb75bb58492a5d8c962b68374eb178c1c3c` (`Harden privileged renderer permissions`). The current `electron/navigationSecurity.cts` / bootstrap path pins privileged navigation to the trusted renderer, applies trusted-sender checks around sensitive IPC, and only permits explicitly enabled audio capture; camera/video remain denied.

### Automatic agent configuration and local runtime fit

Resolved by `032ed11883135ffa971fd45cb5867845dedc8c34` (`Strengthen automatic agent configuration`). Auto Setup now enables multi-agent/peer behavior, turns model routing on when multiple distinct bindings exist, and ranks local models with hardware/runtime-fit information instead of model-name preference alone.

### Local development preview URLs

Resolved by `c4fb95ff40675c5984249a265060878249c853c1` (`Fix local development preview URLs`). Loopback development previews use the appropriate local HTTP behavior rather than forcing an invalid HTTPS assumption.

### Backend lint coverage and persistent CI

Resolved by `3b8e86c42209cc91a573235b313a2aa515d74ed4` (`Lint backend source`) and `b20a761852808940c15f077b064e07ec8e78d5a1` (`Add persistent repository verification`). The normal lint command includes `backend/`, and `.github/workflows/verify.yml` runs the full repository verification gate for `main` pushes and pull requests.

### Duplicate local-Chat model state

Resolved by `90c99b0a942b22eac4e7c141c186a57573f13a32` (`Remove stale editor Chat model state`). Agent Chat now uses the migrated provider/runtime configuration rather than maintaining a second stale local-model selection path.

## Review policy

Current source, tests and CI are authoritative when they differ from historical review text. Cleanup/deletion history belongs in `REMOVED_CODE.md`; migration provenance belongs in `MIGRATION.md`.
""")

cleanup_path = Path("docs/CODE_CLEANUP_REVIEW.md")
cleanup = cleanup_path.read_text()
cleanup = cleanup.replace(
    "All items from the approved cleanup batch have been completed and moved to [`REMOVED_CODE.md`](./REMOVED_CODE.md). Migration provenance remains in [`MIGRATION.md`](./MIGRATION.md).",
    "All approved cleanup reviewed through 2026-08-26 has been completed and recorded in [`REMOVED_CODE.md`](./REMOVED_CODE.md). Migration provenance remains in [`MIGRATION.md`](./MIGRATION.md).",
    1,
)
cleanup_path.write_text(cleanup)

removed_path = Path("docs/REMOVED_CODE.md")
removed = removed_path.read_text()
if "## 2026-08-26 — Obsolete IRIS agent helper scripts" not in removed:
    marker = "## Intentionally retained after review"
    entry = """## 2026-08-26 — Obsolete IRIS agent helper scripts

**Commit:** `07a1825407690a20bbf095dc6558f354f2efef60` — `Remove obsolete IRIS scripts`

Removed the entire `scripts/` tree, which contained eight `scripts/iris/orbit-*.sh` agent-orientation helpers. Repository review confirmed they were not referenced by the application, tests, package scripts or CI, and their project/git/search/size discovery behavior is redundant with the current agent file and terminal tools.

---

"""
    if marker not in removed:
        raise SystemExit("Could not find REMOVED_CODE insertion point")
    removed = removed.replace(marker, entry + marker, 1)
removed_path.write_text(removed)

Path("docs/README.md").write_text("""# Documentation

Current Code Editor documentation lives here. Current source and the passing `npm run verify:full` / GitHub `Verify` workflow are authoritative when documentation and implementation ever disagree.

## Current documentation

- [`MIGRATION.md`](./MIGRATION.md) — IRIS migration history, current architecture, authority boundaries and security invariants.
- [`CODE_REVIEW_FINDINGS.md`](./CODE_REVIEW_FINDINGS.md) — current open repository-review finding plus resolved review history.
- [`CODE_CLEANUP_REVIEW.md`](./CODE_CLEANUP_REVIEW.md) — cleanup boundaries and implementation that must not be deleted merely because it looks historical.
- [`REMOVED_CODE.md`](./REMOVED_CODE.md) — ledger of deliberate post-migration removals.

## Historical IRIS archive

[`iris-reference/`](./iris-reference/) is a preserved snapshot of documentation from the source IRIS project. Its paths, commands, versions, TODOs and product descriptions are intentionally historical and are **not** the current Code Editor backlog or operating instructions.

When architecture changes, update the current documents above rather than rewriting the preserved source archive.
""")

Path("docs/iris-reference/README.md").write_text("""# Historical IRIS Reference Archive

This directory is a preserved documentation snapshot from the original IRIS source project used during the Code Editor migration. It is intentionally **not synchronized** with the current Code Editor implementation.

Paths, commands, dependency versions, TODOs, UI descriptions and architectural notes inside this archive may refer to components that were renamed, migrated, replaced or deliberately removed. Do not treat them as current product requirements or maintenance instructions, and do not rewrite the archived source documents merely to match today's repository.

For current information, start with [`../README.md`](../README.md) and [`../MIGRATION.md`](../MIGRATION.md). Current source and current CI remain authoritative.
""")

migration = migration_path.read_text()
stale = [
    "| `benchmarks/iris/`",
    "src/platform-features/notes/",
    "src/platform-features/files/",
    "src/platform-features/search/",
    "src/platform-features/skills/",
    "src/platform-features/launcher/",
    "src/platform-features/screen-capture/",
    "- `security.cts`;",
    "- `logger.cts`;",
    "- `screenCapturePermissions.cts`;",
    "[x] Preserved benchmark harness in `npm run benchmark`",
    "161 warnings / 0 errors",
    "156 passed / 2 failed",
]
found = [value for value in stale if value in migration]
if found:
    raise SystemExit("Stale current-document references remain: " + ", ".join(found))

required = [
    Path("docs/README.md"),
    Path("docs/iris-reference/README.md"),
    Path("docs/MIGRATION.md"),
    Path("docs/CODE_REVIEW_FINDINGS.md"),
    Path("docs/CODE_CLEANUP_REVIEW.md"),
    Path("docs/REMOVED_CODE.md"),
]
missing = [str(path) for path in required if not path.is_file()]
if missing:
    raise SystemExit("Missing documentation files: " + ", ".join(missing))
