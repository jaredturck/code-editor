# Code Cleanup Review

**Status:** No approved cleanup pending  
**Last updated:** 2026-08-26

All items from the approved cleanup batch have been completed and moved to [`REMOVED_CODE.md`](./REMOVED_CODE.md). Migration provenance remains in [`MIGRATION.md`](./MIGRATION.md).

What remains below requires a future product or architecture decision and is **not approved for deletion**.

## Product/architecture decisions intentionally left for later

### Large `*Legacy` implementation layers

Files such as `agentRuntimeLegacy.ts` and `toolBrokerLegacy.ts` are active implementation. “Legacy” describes provenance, not reachability. Cleanup here is a tested decomposition/refactor project rather than deletion.

### Large-file decomposition

Large runtime and bridge files should be decomposed only where coherent tested boundaries already exist. Line count alone is not a reason to extract or delete code.

## Explicit keep rules

Future cleanup should continue to protect:

- worker and child-process entry modules loaded by filename;
- upgrade and legacy encrypted-storage cleanup while old user data remains supported;
- notes, launcher and skills runtime services used by agents even without dedicated panels;
- provider adapters and routing/failover infrastructure;
- the mirrored renderer/backend `agentBusShared.ts` helpers while their TypeScript build roots remain separate; `tests/agentBusSharedParity.test.ts` prevents silent behavioral drift;
- thin backend route/service seams that are useful future decomposition boundaries;
- layered security, permission and workspace-containment checks where duplication is defense-in-depth.

## Safe deletion standard

Before deletion, verify static and indirect callers, IPC/tool/route registrations, worker filename launches, product fit, compatibility duties, security boundaries, active tests and the availability of meaningful verification. Ambiguous code stays until the ambiguity is resolved.
