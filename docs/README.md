# Documentation

Current Code Editor documentation lives here. Current source and local `npm run verify:full` results are authoritative when documentation and implementation ever disagree. GitHub Actions workflows are intentionally absent; development and verification should not recreate them unless the maintainer explicitly requests CI.

## Current documentation

- [`AI_DEVELOPMENT_INSTRUCTIONS.md`](./AI_DEVELOPMENT_INSTRUCTIONS.md) — required operating rules for future AI-assisted development, including direct `main` edits, conservative bug fixing, local verification, and prohibited workflow abuse.
- [`MIGRATION.md`](./MIGRATION.md) — IRIS migration history, current architecture, authority boundaries and security invariants.
- [`CODE_REVIEW_FINDINGS.md`](./CODE_REVIEW_FINDINGS.md) — current open repository-review finding plus resolved review history.
- [`CODE_CLEANUP_REVIEW.md`](./CODE_CLEANUP_REVIEW.md) — cleanup boundaries and implementation that must not be deleted merely because it looks historical.
- [`REMOVED_CODE.md`](./REMOVED_CODE.md) — ledger of deliberate post-migration removals.

## Historical IRIS archive

[`iris-reference/`](./iris-reference/) is a preserved snapshot of documentation from the source IRIS project. Its paths, commands, versions, TODOs and product descriptions are intentionally historical and are **not** the current Code Editor backlog or operating instructions.

When architecture changes, update the current documents above rather than rewriting the preserved source archive.
