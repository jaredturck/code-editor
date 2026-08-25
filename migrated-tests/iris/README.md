# Migrated IRIS Runtime Tests

The original IRIS test tree is preserved here so reusable runtime/backend behavior can be validated against the migrated Code Editor implementation without restoring obsolete IRIS presentation code.

## Current commands

Run only the compatible migrated IRIS suite:

```bash
npm run test:iris
```

Run the normal Code Editor suite followed by the compatible migrated IRIS suite:

```bash
npm test
```

Run the complete deterministic repository verification chain:

```bash
npm run verify:full
```

The old source-IRIS `test:coverage` and `verify` commands are not Code Editor package scripts and should not be used as current repository instructions.

## Selection and compatibility

`vitest.iris.config.ts` selects the supported migrated runtime/backend surface under:

- `migrated-tests/iris/lib/**/*.test.ts`
- `migrated-tests/iris/server/**/*.test.ts`

A small compatibility resolver maps historical IRIS imports such as `../../server/` and `../../src/lib/providers/` onto the migrated `backend/` and `src/platform/providers/` locations.

Presentation-specific tests that depend on the old Orb/window shell remain excluded. The preserved files are still useful migration history, but exclusion does not mean the corresponding backend capability is unfinished.

## Side-effect policy

`migrated-tests/iris/setup.ts` blocks uncontrolled network/browser transports by default. Provider, bridge, terminal, launcher, automation, screen-capture and agent tests use mocks or controlled fixtures rather than contacting real external providers or taking over the desktop.

The benchmark suite is separate from correctness tests and runs through `npm run benchmark`.

## Current verification note

The latest recorded Code Editor Vitest phase has two failures before the chained `test:iris` phase, so the migrated IRIS suite was not reached in that particular `npm test` run. See [`../../docs/migration/VALIDATION_REPORT.md`](../../docs/migration/VALIDATION_REPORT.md) for the current verification state.
