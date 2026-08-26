# Documentation

Start with [`AI_README.md`](./AI_README.md). It is the single authoritative current guide for AI-assisted development in this repository: workflow rules, architecture context, change discipline, cleanup boundaries, review status, verification practice, security invariants, and delivery expectations.

Current source and local verification results are authoritative when documentation and implementation disagree. GitHub Actions are intentionally absent and must not be recreated unless the maintainer explicitly requests CI work.

## Primary current document

- [`AI_README.md`](./AI_README.md) — **read this first**. Future AI models should normally be able to work from this document plus the relevant source code without reading several overlapping instruction files.

## Historical and deeper-reference documents

- [`MIGRATION.md`](./MIGRATION.md) — detailed IRIS migration provenance, subsystem history, architecture background, and security/authority rationale. Useful when changing inherited platform code or investigating why a subsystem exists.
- [`REMOVED_CODE.md`](./REMOVED_CODE.md) — ledger of deliberate post-migration removals and the evidence used to justify them. Useful when evaluating similar cleanup.
- [`iris-reference/`](./iris-reference/) — preserved documentation from the source IRIS project. It is historical reference only; its paths, commands, TODOs, versions, and product requirements are not current Code Editor instructions.

Do not create additional overlapping AI instruction documents. Update `AI_README.md` when current development rules or architecture guidance changes.