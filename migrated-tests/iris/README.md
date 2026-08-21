# Test suite

The suite is designed to run without credentials, internet access, paid API calls, local AI servers, Electron, or desktop automation tools.

## Commands

```bash
npm test
npm run test:watch
npm run test:coverage
npm run verify
npm run verify:full
```

## Side-effect policy

`tests/setup.ts` replaces `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` with implementations that throw immediately. A test must explicitly install a local mock before exercising code that normally uses one of those APIs.

Provider tests use fake keys and in-memory responses. Bridge, terminal, clipboard, launcher, automation, screen-capture, editor-window, and agent tests use mocks or the isolated `tests/fixtures/workspace` directory. The normal suite does not execute shell commands, launch applications, change the real clipboard, or contact any external endpoint.

## Covered production contracts

The current characterization suite covers:

- Local storage, settings, API-key compatibility, notes, run history, and reward storage.
- OpenAI, Anthropic, Gemini, OpenRouter, OpenCode, and local-model request/response adapters using mocked `fetch`.
- Desktop bridge client methods and selected bridge-server route contracts.
- Structured task construction, validation, sub-agent queues, orchestration, broadcasts, timeouts, and scripted fake-model execution.
- Skill profiles, compilation fallback behavior, reward calculations, and model-family behavior.
- Agent tool-definition metadata and duplicate-name checks.
- Authentication compatibility, Orb context behavior, screen capture, editor runtime, mobile detection, toast state, desktop-window helpers, and compatibility exports.
- Production bundling through the existing `npm run build` command in `npm run verify`.

## Deliberate exclusions

The suite does not make live provider/search requests or judge model-answer quality. It also avoids pixel-level animation tests, generated Radix/shadcn internals, real Electron window management, real desktop automation, and real shell/application execution.

Large private implementations inside `agentRuntime.js` and `desktopBridgePlugin.js` are currently characterized through their exported contracts. More direct tests should be added immediately before those files are split into smaller exported modules.

`npm run verify` runs type checking, all tests, and the production build. `npm run verify:full` also runs the existing lint command; at the time this suite was added, lint reports pre-existing unused imports in `PermissionsPanel.jsx` and `SettingsPanel.jsx`.
