# AI Settings & Provider Configuration — Patch Plan

## Objective

Integrate the migrated IRIS provider/model/agent configuration into the existing Code Editor Settings modal without importing the old IRIS Settings UI. The Code Editor remains the visual shell; migrated IRIS services remain the source of truth for credentials, provider discovery, model curation, role assignment, routing and agent policy.

## Scope

This patch completes the first migration checklist item: **AI settings and provider configuration**.

### Providers

- Display every provider registered by the migrated IRIS provider registry.
- Store cloud API keys exclusively through Electron `safeStorage` via the migrated credential bridge.
- Support multiple key slots per provider.
- Test credentials explicitly and persist the last validation result without retesting on Settings open.
- Discover accessible models when a credential/runtime test succeeds.
- Configure and test the local Ollama-compatible endpoint without requiring a key.

### Models

- Display provider-discovered models.
- Let the user curate the smaller model shortlist made available to agent assignment/routing.
- Preserve inaccessible historical model selections as data rather than silently substituting models.
- Keep the editor's legacy Ollama Chat model synchronized when a local model is selected, until Chat is migrated to `runAgentSession`.

### Agent roles

- Configure primary Orchestrator, Executor, Scout and Reviewer/Overwatcher bindings.
- Bind each role to provider + key slot + curated model.
- Configure the migrated per-role permission tier.
- Preserve any existing secondary IRIS mesh entries while editing a role's primary model.

### Routing

- Configure execution policy, model routing, stateful loop mode, native tools, advertised tool surface, streaming, failover, health monitoring and multi-agent enablement.

### Autonomy / safety

- Configure strict/balanced safety policy and explicit-approval behavior.
- Configure sudo/network-command restrictions.
- Configure file-read, file-write, terminal, screen, mouse/automation and microphone permissions.
- Synchronize those permissions with the privileged bridge before persisting a grant/revocation.
- Configure web-site and package-install guards, including project-local Python virtual-environment preference.

### Limits

- Configure session-duration budget, shared cloud-call budget, heavy-work output cap, repeated-tool guard and context-compaction warning threshold.

## Architecture

- Keep `SettingsModal.tsx` as the existing VS Code-inspired shell.
- Add a dedicated `AISettingsPanel` renderer component rather than growing the already-large Settings modal further.
- Use `readOrbSettings` / `writeOrbSettings` as the canonical migrated IRIS settings store.
- Use `AI_PROVIDER_DEFINITIONS`, `testConnection`, provider-configuration helpers and agent-identity helpers directly from migrated IRIS code.
- Use `keyStore` for credentials; never write provider secrets into Code Editor JSON settings or encrypted IRIS settings.
- Retain the legacy Code Editor `settings.ai` fields only as compatibility state for the still-unmigrated Ollama Chat panel.

## Security requirements

1. API keys must never be persisted in `settings.json`, React search state, migration docs or provider-validation records.
2. Existing stored credentials are represented as "stored" state; the Settings UI does not automatically reveal the secret.
3. Permission changes must update the trusted bridge before being persisted, so the UI cannot claim a capability is disabled while the bridge remains enabled.
4. Provider tests are user initiated; opening Settings must not create billable provider traffic.
5. Model discovery results are treated as capability metadata, not authority.
6. Local endpoint fields remain bounded to the migrated provider/network enforcement at execution time.

## Validation plan

- Add unit tests for model curation and primary role-assignment helpers.
- Add component tests for the AI Settings navigation and secure credential status where feasible.
- Parse/type-check changed TypeScript in the available environment.
- Run local-import resolution checks for changed files.
- Run full repository tests/lint/build when dependencies are available; otherwise record the exact environment limitation.
- Perform a focused security review and bug review before packaging.

## Documentation updates

- Mark **AI settings and provider configuration** complete in `IRIS_MIGRATION.md` only after implementation and validation.
- Update `docs/migration/MIGRATION_PLAN.md` with the connected Settings surface.
- Remove provider/model/agent settings from `docs/migration/UNWIRED_BACKEND.md` while leaving Agent Chat itself unwired.

## Implementation result

Status: **implemented and ready for dependency-aware validation in the normal development environment.**

Changed product surface:

- Existing `SettingsModal.tsx` remains the Settings shell and routes the AI tab into `AISettingsPanel`.
- `AISettingsPanel` implements Providers, Models, Agents, Routing, Autonomy, Limits, Skills and Semantic Index sub-sections.
- `src/settings/aiSettings.ts` contains the small Code Editor-specific role/model/settings helpers rather than duplicating IRIS provider/runtime logic.
- Existing Ollama Chat and speech fields remain editable for compatibility while Chat itself is still unmigrated.

### Security review

- Provider secrets are never written to Code Editor settings or IRIS settings; save/remove operations use the existing Electron `safeStorage` credential bridge.
- Credential tests are explicit button actions; mounting/opening Settings does not call providers.
- Stored keys are shown only as presence/status and password inputs never pre-fill plaintext secrets.
- Privileged capability toggles update the trusted bridge first and persist the new setting only after bridge acceptance.
- Semantic-index location authority remains distinct from agent file-write authority.
- Semantic index model installation and large-index construction require explicit user actions/confirmation.

### Bug review

Focused review covered role replacement, secondary mesh preservation, credential slot IDs, unsaved replacement-key testing, credential deletion failures, capability-toggle races, local Chat compatibility fields, semantic build confirmation and stale provider-validation state. Unit/component tests were added for the highest-risk state transitions.

### Validation completed in migration environment

- Active `src/`, `backend/`, `electron/` and `tests/` TypeScript-family sources parsed successfully: **265 files / 86,140 physical lines / 0 parser errors**.
- Static relative/`@/` local-import resolution: **0 unresolved local imports**.
- Full dependency-aware Vitest/typecheck/lint/build cannot be executed in this environment because the complete installed dependency tree is not available here; run `npm run verify:full` after applying the patch in the normal project checkout.
