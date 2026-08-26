# Code Review Findings

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
