# Migrated IRIS Runtime Tests

This directory contains the IRIS runtime/backend tests that remain useful against the migrated Code Editor implementation. Historical presentation tests for the removed Orb, Settings, Search, duplicate editor, and other IRIS-only UI surfaces have been retired rather than kept as an inactive archive.

## Commands

Run the compatible migrated IRIS suite:

```bash
npm run test:iris
```

Run the normal Code Editor suite followed by the migrated IRIS suite:

```bash
npm test
```

Run the full deterministic verification chain:

```bash
npm run verify:full
```

## Selected test surface

`vitest.iris.config.ts` runs:

- `migrated-tests/iris/lib/**/*.test.ts`
- `migrated-tests/iris/server/**/*.test.ts`

A small compatibility resolver maps selected historical IRIS imports onto their migrated `backend/` and `src/platform/` locations.

Tests for current Electron credential/key storage and DuckDuckGo page parsing were moved into the normal `tests/` suite so they exercise the current `electron/platform/` modules directly. Current Chat attachment coverage likewise lives in the normal Code Editor suite.

## Side-effect policy

`migrated-tests/iris/setup.ts` blocks uncontrolled network/browser transports by default. Provider, bridge, terminal, launcher, automation, screen-capture, and agent tests use mocks or controlled fixtures rather than contacting real external providers or taking over the desktop.

The benchmark harness is separate from correctness tests and runs through `npm run benchmark`.

For migration provenance and historical validation context, see [`../../docs/MIGRATION.md`](../../docs/MIGRATION.md).
