# Code Review Findings

**Status:** Active implementation backlog  
**Recorded:** 2026-08-25

This document records concrete issues found during the post-cleanup code review. These are implementation targets, not speculative deletion candidates. The priority is to improve the project as a secure, reliable autonomous coding agent.

## P0 — Electron trust boundary

The main editor `BrowserWindow` exposes privileged preload APIs for files, workspace mutation, Git, terminals, settings, credentials, screen sources, and other desktop capabilities, but the main window does not currently enforce a strict navigation/window-open policy. Several privileged IPC handlers also authorize requests by checking only that the sender belongs to a `BrowserWindow`.

**Required direction:**

- restrict main-window navigation to the trusted packaged editor origin or the local development renderer origin;
- deny unexpected top-level navigations and unexpected child windows;
- centralize trusted-sender validation for privileged IPC, including credential and bridge-permission operations;
- add focused Electron tests for allowed and rejected senders/navigation.

## P0 — Microphone/media permission must respect application permission state

The default application setting has microphone access disabled, while Electron's default-session media permission handler currently grants `media` requests from an application `BrowserWindow`. Electron's `media` permission is broader than microphone-only access.

**Required direction:** only permit trusted editor-origin audio capture when the application's microphone permission is enabled, and deny video/camera access unless a future feature explicitly introduces and authorizes it.

## P1 — Upgrade the Electron runtime

The project currently pins Electron 31.7.7, which is no longer a supported Electron line. Because this application exposes privileged desktop and autonomous-agent capabilities, the Electron/Chromium runtime should not remain on an end-of-life release.

**Required direction:** perform a staged upgrade to a currently supported Electron major, updating APIs and tests as necessary rather than making an unverified version jump.

## P1 — Auto Configure should enable the autonomous model mesh it creates

Automatic setup currently creates a multi-model agent configuration but writes model routing and peer review to `off`. This conflicts with the project's autonomous-coding goal and with the normal defaults, where peer review is suggested and model routing is intended to become useful once a model pool exists.

**Required direction:** enable appropriate model routing when Auto Configure creates a useful multi-model pool, keep independent review at least `suggested`, and test the resulting plan.

## P1 — Local model selection should use real fit calculations

Automatic local-model selection currently uses a coarse VRAM threshold that can place a 24 GB GPU on the smaller 9B model even though the existing runtime-fit logic can consider the larger coding model viable. Very small GPUs also receive the same fallback without enough differentiation.

**Required direction:** make Auto Configure choose/install local workers from the existing runtime fit estimates and available hardware rather than a separate hard-coded threshold.

## P1 — Local browser preview should default loopback hosts to HTTP

The embedded browser normalizer prepends `https://` to bare hostnames, including `localhost` and loopback addresses. Most generated development servers use plain HTTP, so a healthy local application can look broken when opened without an explicit scheme.

**Required direction:** default `localhost`, `127.0.0.1`, `[::1]`, and equivalent loopback development URLs to `http://`; retain HTTPS defaults for ordinary external hostnames.

## P1 — Persistent repository quality gates

The repository currently has no persistent GitHub Actions verification workflow on `main`, and `npm run lint` does not include the backend tree. Several high-value runtime/bridge files also remain under `@ts-nocheck`.

**Required direction:**

- add persistent CI for formatting, lint, typecheck, tests, Electron runtime checks, and build where practical;
- include backend source in lint coverage;
- reduce `@ts-nocheck` incrementally in high-value modules only when verification supports the change.

## P2 — Remove stale legacy local-chat settings/UI coupling

The current Settings UI still describes an "existing Ollama Chat" path and Auto Configure synchronizes its chosen worker into the old editor-level `selected_model` setting, even though Agent Chat now runs through the full agent runtime.

**Required direction:** remove stale wording and obsolete synchronization only after confirming no remaining non-agent consumer requires that editor-level model field. Keep speech/transcription configuration independently where it is still active.

## Implementation order

1. Electron trust boundary and media permission enforcement.
2. Autonomous model setup improvements.
3. Local development browser URL normalization.
4. Persistent CI and broader lint coverage.
5. Staged Electron runtime upgrade.
6. Legacy local-chat settings/UI decoupling.
7. Incremental `@ts-nocheck` reduction as touched modules become verifiable.
