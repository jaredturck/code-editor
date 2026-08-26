# Tests

All executable repository tests live under this directory.

- Top-level `*.test.ts` / `*.test.tsx`: Code Editor application, editor, Electron, and integration coverage using `setup.ts`.
- `platform/`: agent runtime, providers, orchestration, policy, persistence-client, and other platform regression coverage using `runtimeSetup.ts`.
- `backend/`: privileged bridge, storage, indexing, media, launcher, network, and security regression coverage using `runtimeSetup.ts`.
- `fixtures/` and `helpers/`: shared test data and test-only utilities.
- `electronRuntime.cjs`: Electron/node-pty runtime smoke check invoked by `npm run test:electron-runtime`.

`runtimeSetup.ts` deliberately blocks uncontrolled network/browser transports and installs deterministic storage and credential mocks. Tests that need those capabilities must mock or explicitly control them.

Run `npm test` for the centralized Vitest suite or `npm run verify:full` for formatting, linting, type checking, tests, Electron runtime verification, and the production build.
