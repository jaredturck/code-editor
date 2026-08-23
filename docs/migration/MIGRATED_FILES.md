# IRIS Migration — Exact File Inventory

This ledger records the source-to-destination movement for the bulk migration. It is intended to make the migration auditable even when a subsystem is not yet exposed in the Code Editor UI.

- Source IRIS files: **695**
- Explicit source→destination mappings (including deliberate duplicates such as agent bus shared types): **376**
- IRIS files not copied as implementation source: **320** (classified below as UI, generated output, or replaced configuration)

## New integration files with no one-to-one IRIS source

- `docs/migration/MIGRATION_PLAN.md` — migration design/SDLC plan.
- `IRIS_MIGRATION.md` — subsystem status ledger.
- `docs/migration/UNWIRED_BACKEND.md` — preserved-but-unwired backend inventory.
- `src/platform-context/AgentSettingsContext.tsx` — Code Editor compatibility facade over migrated IRIS settings/shell context.
- `tsconfig.backend.json` — compiles migrated `backend/` to `backend-dist/`.
- `tsconfig.benchmark.json` — adapted benchmark compilation config.
- Existing `electron/main.cts`, `electron/preload.cts`, `src/main.tsx`, `package.json`, lock/config files — narrowly adapted to boot/expose the migrated platform without replacing the Code Editor UI.

## Copied / adapted files

| IRIS source                                                        | Code Editor destination                                                     | Migration treatment                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------- |
| `ARCHITECTURE.md`                                                  | `docs/iris-reference/ARCHITECTURE.md`                                       | reference copy                                 |
| `DEV.md`                                                           | `docs/iris-reference/DEV.md`                                                | reference copy                                 |
| `LICENSE`                                                          | `docs/iris-reference/LICENSE`                                               | reference copy                                 |
| `README.md`                                                        | `docs/iris-reference/IRIS_README.md`                                        | reference copy                                 |
| `TODO.md`                                                          | `docs/iris-reference/IRIS_TODO_AT_MIGRATION.md`                             | reference copy                                 |
| `benchmark-results/report.md`                                      | `benchmark-results/iris/report.md`                                          | historical result copy                         |
| `benchmark-results/results.csv`                                    | `benchmark-results/iris/results.csv`                                        | historical result copy                         |
| `benchmarks/README.md`                                             | `benchmarks/iris/README.md`                                                 | copied + destination import rewrite            |
| `benchmarks/core/database.ts`                                      | `benchmarks/iris/core/database.ts`                                          | copied + destination import rewrite            |
| `benchmarks/core/fixtures.ts`                                      | `benchmarks/iris/core/fixtures.ts`                                          | copied + destination import rewrite            |
| `benchmarks/core/localModels.ts`                                   | `benchmarks/iris/core/localModels.ts`                                       | copied + destination import rewrite            |
| `benchmarks/core/networkGuard.ts`                                  | `benchmarks/iris/core/networkGuard.ts`                                      | copied + destination import rewrite            |
| `benchmarks/core/report.ts`                                        | `benchmarks/iris/core/report.ts`                                            | copied + destination import rewrite            |
| `benchmarks/core/runner.ts`                                        | `benchmarks/iris/core/runner.ts`                                            | copied + destination import rewrite            |
| `benchmarks/core/statistics.ts`                                    | `benchmarks/iris/core/statistics.ts`                                        | copied + destination import rewrite            |
| `benchmarks/core/system.ts`                                        | `benchmarks/iris/core/system.ts`                                            | copied + destination import rewrite            |
| `benchmarks/core/types.ts`                                         | `benchmarks/iris/core/types.ts`                                             | copied + destination import rewrite            |
| `benchmarks/run.ts`                                                | `benchmarks/iris/run.ts`                                                    | copied + destination import rewrite            |
| `benchmarks/suites/agents.benchmark.ts`                            | `benchmarks/iris/suites/agents.benchmark.ts`                                | copied + destination import rewrite            |
| `benchmarks/suites/crypto.benchmark.ts`                            | `benchmarks/iris/suites/crypto.benchmark.ts`                                | copied + destination import rewrite            |
| `benchmarks/suites/database.benchmark.ts`                          | `benchmarks/iris/suites/database.benchmark.ts`                              | copied + destination import rewrite            |
| `benchmarks/suites/indexing.benchmark.ts`                          | `benchmarks/iris/suites/indexing.benchmark.ts`                              | copied + destination import rewrite            |
| `benchmarks/suites/liveModels.benchmark.ts`                        | `benchmarks/iris/suites/liveModels.benchmark.ts`                            | copied + destination import rewrite            |
| `benchmarks/suites/network.benchmark.ts`                           | `benchmarks/iris/suites/network.benchmark.ts`                               | copied + destination import rewrite            |
| `benchmarks/suites/persistence.benchmark.ts`                       | `benchmarks/iris/suites/persistence.benchmark.ts`                           | copied + destination import rewrite            |
| `benchmarks/suites/pipelines.benchmark.ts`                         | `benchmarks/iris/suites/pipelines.benchmark.ts`                             | copied + destination import rewrite            |
| `benchmarks/suites/providers.benchmark.ts`                         | `benchmarks/iris/suites/providers.benchmark.ts`                             | copied + destination import rewrite            |
| `docs/AI_README.md`                                                | `docs/iris-reference/docs/AI_README.md`                                     | reference copy                                 |
| `docs/README.md`                                                   | `docs/iris-reference/docs/README.md`                                        | reference copy                                 |
| `docs/media/image1.png`                                            | `docs/iris-reference/docs/media/image1.png`                                 | reference copy                                 |
| `docs/media/image2.png`                                            | `docs/iris-reference/docs/media/image2.png`                                 | reference copy                                 |
| `docs/media/image3.png`                                            | `docs/iris-reference/docs/media/image3.png`                                 | reference copy                                 |
| `docs/media/image4.png`                                            | `docs/iris-reference/docs/media/image4.png`                                 | reference copy                                 |
| `docs/media/image5.png`                                            | `docs/iris-reference/docs/media/image5.png`                                 | reference copy                                 |
| `electron-src/credentialStore.cts`                                 | `electron/platform/credentialStore.cts`                                     | copied verbatim                                |
| `electron-src/duckDuckGoPageParser.cts`                            | `electron/platform/duckDuckGoPageParser.cts`                                | copied verbatim                                |
| `electron-src/duckDuckGoSearchWindow.cts`                          | `electron/platform/duckDuckGoSearchWindow.cts`                              | copied verbatim                                |
| `electron-src/linuxPasswordStore.cts`                              | `electron/platform/linuxPasswordStore.cts`                                  | copied verbatim                                |
| `electron-src/localBridge.cts`                                     | `electron/platform/localBridge.cts`                                         | copied + Code Editor build/origin path adapter |
| `electron-src/logger.cts`                                          | `electron/platform/logger.cts`                                              | copied verbatim                                |
| `electron-src/screenCapturePermissions.cts`                        | `electron/platform/screenCapturePermissions.cts`                            | copied verbatim                                |
| `electron-src/security.cts`                                        | `electron/platform/security.cts`                                            | copied verbatim                                |
| `electron-src/storageKeyStore.cts`                                 | `electron/platform/storageKeyStore.cts`                                     | copied verbatim                                |
| `scripts/orbit-audit-secrets.sh`                                   | `scripts/iris/orbit-audit-secrets.sh`                                       | copied maintenance script                      |
| `scripts/orbit-audit-size.sh`                                      | `scripts/iris/orbit-audit-size.sh`                                          | copied maintenance script                      |
| `scripts/orbit-explore-deps.sh`                                    | `scripts/iris/orbit-explore-deps.sh`                                        | copied maintenance script                      |
| `scripts/orbit-explore-git.sh`                                     | `scripts/iris/orbit-explore-git.sh`                                         | copied maintenance script                      |
| `scripts/orbit-explore-project.sh`                                 | `scripts/iris/orbit-explore-project.sh`                                     | copied maintenance script                      |
| `scripts/orbit-find-config.sh`                                     | `scripts/iris/orbit-find-config.sh`                                         | copied maintenance script                      |
| `scripts/orbit-find-todos.sh`                                      | `scripts/iris/orbit-find-todos.sh`                                          | copied maintenance script                      |
| `scripts/orbit-snapshot-workspace.sh`                              | `scripts/iris/orbit-snapshot-workspace.sh`                                  | copied maintenance script                      |
| `server/bridgeServer.ts`                                           | `backend/bridgeServer.ts`                                                   | copied verbatim                                |
| `server/builtinSkills.ts`                                          | `backend/builtinSkills.ts`                                                  | copied verbatim                                |
| `server/desktopBridge/errors.ts`                                   | `backend/desktopBridge/errors.ts`                                           | copied verbatim                                |
| `server/desktopBridge/middleware.ts`                               | `backend/desktopBridge/middleware.ts`                                       | copied verbatim                                |
| `server/desktopBridge/response.ts`                                 | `backend/desktopBridge/response.ts`                                         | copied verbatim                                |
| `server/desktopBridge/routes/agentRoutes.ts`                       | `backend/desktopBridge/routes/agentRoutes.ts`                               | copied verbatim                                |
| `server/desktopBridge/routes/audioRoutes.ts`                       | `backend/desktopBridge/routes/audioRoutes.ts`                               | copied verbatim                                |
| `server/desktopBridge/routes/automationAiRoutes.ts`                | `backend/desktopBridge/routes/automationAiRoutes.ts`                        | copied verbatim                                |
| `server/desktopBridge/routes/coreRoutes.ts`                        | `backend/desktopBridge/routes/coreRoutes.ts`                                | copied verbatim                                |
| `server/desktopBridge/routes/fileRoutes.ts`                        | `backend/desktopBridge/routes/fileRoutes.ts`                                | copied verbatim                                |
| `server/desktopBridge/routes/persistenceRoutes.ts`                 | `backend/desktopBridge/routes/persistenceRoutes.ts`                         | copied verbatim                                |
| `server/desktopBridge/routes/powerRoutes.ts`                       | `backend/desktopBridge/routes/powerRoutes.ts`                               | copied verbatim                                |
| `server/desktopBridge/routes/router.ts`                            | `backend/desktopBridge/routes/router.ts`                                    | copied verbatim                                |
| `server/desktopBridge/routes/webSkillRoutes.ts`                    | `backend/desktopBridge/routes/webSkillRoutes.ts`                            | copied verbatim                                |
| `server/desktopBridge/services/agentService.ts`                    | `backend/desktopBridge/services/agentService.ts`                            | copied verbatim                                |
| `server/desktopBridge/services/audioTranscriptionService.ts`       | `backend/desktopBridge/services/audioTranscriptionService.ts`               | copied verbatim                                |
| `server/desktopBridge/services/automationAiService.ts`             | `backend/desktopBridge/services/automationAiService.ts`                     | copied verbatim                                |
| `server/desktopBridge/services/bridgeServiceRuntime.ts`            | `backend/desktopBridge/services/bridgeServiceRuntime.ts`                    | copied verbatim                                |
| `server/desktopBridge/services/coreService.ts`                     | `backend/desktopBridge/services/coreService.ts`                             | copied verbatim                                |
| `server/desktopBridge/services/duckDuckGoBrowserProvider.ts`       | `backend/desktopBridge/services/duckDuckGoBrowserProvider.ts`               | copied verbatim                                |
| `server/desktopBridge/services/fileArchiveService.ts`              | `backend/desktopBridge/services/fileArchiveService.ts`                      | copied verbatim                                |
| `server/desktopBridge/services/fileBrowserService.ts`              | `backend/desktopBridge/services/fileBrowserService.ts`                      | copied verbatim                                |
| `server/desktopBridge/services/fileClipService.ts`                 | `backend/desktopBridge/services/fileClipService.ts`                         | copied verbatim                                |
| `server/desktopBridge/services/fileConceptMath.ts`                 | `backend/desktopBridge/services/fileConceptMath.ts`                         | copied verbatim                                |
| `server/desktopBridge/services/fileConceptPool.ts`                 | `backend/desktopBridge/services/fileConceptPool.ts`                         | copied verbatim                                |
| `server/desktopBridge/services/fileConceptService.ts`              | `backend/desktopBridge/services/fileConceptService.ts`                      | copied verbatim                                |
| `server/desktopBridge/services/fileConceptWorker.ts`               | `backend/desktopBridge/services/fileConceptWorker.ts`                       | copied verbatim                                |
| `server/desktopBridge/services/fileConceptWorkerTypes.ts`          | `backend/desktopBridge/services/fileConceptWorkerTypes.ts`                  | copied verbatim                                |
| `server/desktopBridge/services/fileDocumentService.ts`             | `backend/desktopBridge/services/fileDocumentService.ts`                     | copied verbatim                                |
| `server/desktopBridge/services/fileExtractionPool.ts`              | `backend/desktopBridge/services/fileExtractionPool.ts`                      | copied verbatim                                |
| `server/desktopBridge/services/fileExtractionWorker.ts`            | `backend/desktopBridge/services/fileExtractionWorker.ts`                    | copied verbatim                                |
| `server/desktopBridge/services/fileExtractionWorkerTypes.ts`       | `backend/desktopBridge/services/fileExtractionWorkerTypes.ts`               | copied verbatim                                |
| `server/desktopBridge/services/fileImagePreparation.ts`            | `backend/desktopBridge/services/fileImagePreparation.ts`                    | copied verbatim                                |
| `server/desktopBridge/services/fileImageProcessingPool.ts`         | `backend/desktopBridge/services/fileImageProcessingPool.ts`                 | copied verbatim                                |
| `server/desktopBridge/services/fileImageProcessingWorker.ts`       | `backend/desktopBridge/services/fileImageProcessingWorker.ts`               | copied verbatim                                |
| `server/desktopBridge/services/fileImageProcessingWorkerTypes.ts`  | `backend/desktopBridge/services/fileImageProcessingWorkerTypes.ts`          | copied verbatim                                |
| `server/desktopBridge/services/fileImageQueue.ts`                  | `backend/desktopBridge/services/fileImageQueue.ts`                          | copied verbatim                                |
| `server/desktopBridge/services/fileImageQueueBudget.ts`            | `backend/desktopBridge/services/fileImageQueueBudget.ts`                    | copied verbatim                                |
| `server/desktopBridge/services/fileIndexSourceService.ts`          | `backend/desktopBridge/services/fileIndexSourceService.ts`                  | copied verbatim                                |
| `server/desktopBridge/services/filePdfService.ts`                  | `backend/desktopBridge/services/filePdfService.ts`                          | copied verbatim                                |
| `server/desktopBridge/services/fileSemanticService.ts`             | `backend/desktopBridge/services/fileSemanticService.ts`                     | copied verbatim                                |
| `server/desktopBridge/services/fileService.ts`                     | `backend/desktopBridge/services/fileService.ts`                             | copied verbatim                                |
| `server/desktopBridge/services/fileVideoService.ts`                | `backend/desktopBridge/services/fileVideoService.ts`                        | copied verbatim                                |
| `server/desktopBridge/services/launcherSemanticService.ts`         | `backend/desktopBridge/services/launcherSemanticService.ts`                 | copied verbatim                                |
| `server/desktopBridge/services/launcherService.ts`                 | `backend/desktopBridge/services/launcherService.ts`                         | copied verbatim                                |
| `server/desktopBridge/services/nativeFileDialogService.ts`         | `backend/desktopBridge/services/nativeFileDialogService.ts`                 | copied verbatim                                |
| `server/desktopBridge/services/persistenceService.ts`              | `backend/desktopBridge/services/persistenceService.ts`                      | copied verbatim                                |
| `server/desktopBridge/services/powerService.ts`                    | `backend/desktopBridge/services/powerService.ts`                            | copied verbatim                                |
| `server/desktopBridge/services/webSearchHistoryService.ts`         | `backend/desktopBridge/services/webSearchHistoryService.ts`                 | copied verbatim                                |
| `server/desktopBridge/services/webSkillService.ts`                 | `backend/desktopBridge/services/webSkillService.ts`                         | copied verbatim                                |
| `server/desktopBridge/shared/agentBusShared.ts`                    | `backend/desktopBridge/shared/agentBusShared.ts`                            | copied verbatim                                |
| `server/desktopBridge/shared/agentBusShared.ts`                    | `src/platform/agent/agentBusShared.ts`                                      | copied duplicate + renderer import adapter     |
| `server/desktopBridge/shared/agentInputValidation.ts`              | `backend/desktopBridge/shared/agentInputValidation.ts`                      | copied verbatim                                |
| `server/desktopBridge/shared/atomicFile.ts`                        | `backend/desktopBridge/shared/atomicFile.ts`                                | copied verbatim                                |
| `server/desktopBridge/shared/automationApproval.ts`                | `backend/desktopBridge/shared/automationApproval.ts`                        | copied verbatim                                |
| `server/desktopBridge/shared/bridgeAuthorization.ts`               | `backend/desktopBridge/shared/bridgeAuthorization.ts`                       | copied verbatim                                |
| `server/desktopBridge/shared/fileExclusions.ts`                    | `backend/desktopBridge/shared/fileExclusions.ts`                            | copied verbatim                                |
| `server/desktopBridge/shared/filesystemBoundary.ts`                | `backend/desktopBridge/shared/filesystemBoundary.ts`                        | copied verbatim                                |
| `server/desktopBridge/shared/launcherSafety.ts`                    | `backend/desktopBridge/shared/launcherSafety.ts`                            | copied verbatim                                |
| `server/desktopBridge/shared/networkSecurity.ts`                   | `backend/desktopBridge/shared/networkSecurity.ts`                           | copied verbatim                                |
| `server/desktopBridge/shared/operationLimiter.ts`                  | `backend/desktopBridge/shared/operationLimiter.ts`                          | copied verbatim                                |
| `server/desktopBridge/shared/processExecution.ts`                  | `backend/desktopBridge/shared/processExecution.ts`                          | copied verbatim                                |
| `server/desktopBridge/shared/providerProxyPolicy.ts`               | `backend/desktopBridge/shared/providerProxyPolicy.ts`                       | copied verbatim                                |
| `server/desktopBridge/shared/unifiedDiff.ts`                       | `backend/desktopBridge/shared/unifiedDiff.ts`                               | copied verbatim                                |
| `server/desktopBridge/shared/workloadLimits.ts`                    | `backend/desktopBridge/shared/workloadLimits.ts`                            | copied verbatim                                |
| `server/desktopBridge/storage/encryptedDatabase.ts`                | `backend/desktopBridge/storage/encryptedDatabase.ts`                        | copied verbatim                                |
| `server/desktopBridge/storage/encryptedDatabaseSchema.ts`          | `backend/desktopBridge/storage/encryptedDatabaseSchema.ts`                  | copied verbatim                                |
| `server/desktopBridge/storage/encryption.ts`                       | `backend/desktopBridge/storage/encryption.ts`                               | copied verbatim                                |
| `server/desktopBridge/storage/legacyCleanup.ts`                    | `backend/desktopBridge/storage/legacyCleanup.ts`                            | copied verbatim                                |
| `server/desktopBridge/types.ts`                                    | `backend/desktopBridge/types.ts`                                            | copied verbatim                                |
| `server/desktopBridgePlugin.ts`                                    | `backend/desktopBridgePlugin.ts`                                            | copied verbatim                                |
| `server/types/huggingface-transformers.d.ts`                       | `backend/types/huggingface-transformers.d.ts`                               | copied verbatim                                |
| `src/components/chat-panel/constants.ts`                           | `src/platform-features/chat-ui/constants.ts`                                | copied/import-adapted                          |
| `src/components/chat-panel/controllers/useApprovalController.ts`   | `src/platform-features/chat-ui/controllers/useApprovalController.ts`        | copied/import-adapted                          |
| `src/components/chat-panel/controllers/useChatDesktopLayout.ts`    | `src/platform-features/chat-ui/controllers/useChatDesktopLayout.ts`         | copied/import-adapted                          |
| `src/components/chat-panel/controllers/useChatPanelController.ts`  | `src/platform-features/chat-ui/controllers/useChatPanelController.ts`       | copied/import-adapted                          |
| `src/components/chat-panel/controllers/useChatScrollController.ts` | `src/platform-features/chat-ui/controllers/useChatScrollController.ts`      | copied/import-adapted                          |
| `src/components/chat-panel/types.ts`                               | `src/platform-features/chat-ui/types.ts`                                    | copied/import-adapted                          |
| `src/components/chat-panel/utils/approvals.ts`                     | `src/platform-features/chat-ui/utils/approvals.ts`                          | copied/import-adapted                          |
| `src/components/chat-panel/utils/chatExport.ts`                    | `src/platform-features/chat-ui/utils/chatExport.ts`                         | copied/import-adapted                          |
| `src/components/chat-panel/utils/chatPersistence.ts`               | `src/platform-features/chat-ui/utils/chatPersistence.ts`                    | copied/import-adapted                          |
| `src/components/chat-panel/utils/timeline.ts`                      | `src/platform-features/chat-ui/utils/timeline.ts`                           | copied/import-adapted                          |
| `src/components/chat-panel/utils/usage.ts`                         | `src/platform-features/chat-ui/utils/usage.ts`                              | copied/import-adapted                          |
| `src/context/orb/ClipboardContext.tsx`                             | `src/platform-context/orb/ClipboardContext.tsx`                             | copied/import-adapted                          |
| `src/context/orb/OrbShellContext.tsx`                              | `src/platform-context/orb/OrbShellContext.tsx`                              | copied/import-adapted                          |
| `src/context/orb/SettingsContext.tsx`                              | `src/platform-context/orb/SettingsContext.tsx`                              | copied/import-adapted                          |
| `src/features/audio/transcriptionConfig.ts`                        | `src/platform-features/audio/transcriptionConfig.ts`                        | copied/import-adapted                          |
| `src/features/audio/useAudioTranscription.ts`                      | `src/platform-features/audio/useAudioTranscription.ts`                      | copied/import-adapted                          |
| `src/features/chat/chatAttachments.ts`                             | `src/platform-features/chat/chatAttachments.ts`                             | copied/import-adapted                          |
| `src/features/files/useFilePanel.ts`                               | `src/platform-features/files/useFilePanel.ts`                               | copied/import-adapted                          |
| `src/features/files/useFileThumbnail.ts`                           | `src/platform-features/files/useFileThumbnail.ts`                           | copied/import-adapted                          |
| `src/features/launcher/useLauncherPanel.ts`                        | `src/platform-features/launcher/useLauncherPanel.ts`                        | copied/import-adapted                          |
| `src/features/notes/transcriptInsertion.ts`                        | `src/platform-features/notes/transcriptInsertion.ts`                        | copied/import-adapted                          |
| `src/features/notes/useNoteTranscription.ts`                       | `src/platform-features/notes/useNoteTranscription.ts`                       | copied/import-adapted                          |
| `src/features/notes/useNotesPanel.ts`                              | `src/platform-features/notes/useNotesPanel.ts`                              | copied/import-adapted                          |
| `src/features/screen-capture/captureStrategies.ts`                 | `src/platform-features/screen-capture/captureStrategies.ts`                 | copied/import-adapted                          |
| `src/features/screen-capture/types.ts`                             | `src/platform-features/screen-capture/types.ts`                             | copied/import-adapted                          |
| `src/features/search/useProgressEventDisplay.ts`                   | `src/platform-features/search/useProgressEventDisplay.ts`                   | copied/import-adapted                          |
| `src/features/search/useSearchPanel.ts`                            | `src/platform-features/search/useSearchPanel.ts`                            | copied/import-adapted                          |
| `src/features/skills/useSkillsPanel.ts`                            | `src/platform-features/skills/useSkillsPanel.ts`                            | copied/import-adapted                          |
| `src/features/systemMonitor/useSystemMonitor.ts`                   | `src/platform-features/systemMonitor/useSystemMonitor.ts`                   | copied/import-adapted                          |
| `src/lib/agent/agentIdentity.ts`                                   | `src/platform/agent/agentIdentity.ts`                                       | copied/import-adapted                          |
| `src/lib/agent/agentJsonUtils.ts`                                  | `src/platform/agent/agentJsonUtils.ts`                                      | copied/import-adapted                          |
| `src/lib/agent/agentSkillEngine.ts`                                | `src/platform/agent/agentSkillEngine.ts`                                    | copied/import-adapted                          |
| `src/lib/agent/boundedRoleTask.ts`                                 | `src/platform/agent/boundedRoleTask.ts`                                     | copied/import-adapted                          |
| `src/lib/agent/chatExecutionPolicy.ts`                             | `src/platform/agent/chatExecutionPolicy.ts`                                 | copied/import-adapted                          |
| `src/lib/agent/cloudUsagePolicy.ts`                                | `src/platform/agent/cloudUsagePolicy.ts`                                    | copied/import-adapted                          |
| `src/lib/agent/controllerDecision.ts`                              | `src/platform/agent/controllerDecision.ts`                                  | copied/import-adapted                          |
| `src/lib/agent/controllerPrompt.ts`                                | `src/platform/agent/controllerPrompt.ts`                                    | copied/import-adapted                          |
| `src/lib/agent/localOnlyPolicy.ts`                                 | `src/platform/agent/localOnlyPolicy.ts`                                     | copied/import-adapted                          |
| `src/lib/agent/localPlanner.ts`                                    | `src/platform/agent/localPlanner.ts`                                        | copied/import-adapted                          |
| `src/lib/agent/meshClient.ts`                                      | `src/platform/agent/meshClient.ts`                                          | copied/import-adapted                          |
| `src/lib/agent/meshConductor.ts`                                   | `src/platform/agent/meshConductor.ts`                                       | copied/import-adapted                          |
| `src/lib/agent/modelHealth.ts`                                     | `src/platform/agent/modelHealth.ts`                                         | copied/import-adapted                          |
| `src/lib/agent/modelHealthMonitor.ts`                              | `src/platform/agent/modelHealthMonitor.ts`                                  | copied/import-adapted                          |
| `src/lib/agent/modelRecovery.ts`                                   | `src/platform/agent/modelRecovery.ts`                                       | copied/import-adapted                          |
| `src/lib/agent/modelRouting.ts`                                    | `src/platform/agent/modelRouting.ts`                                        | copied/import-adapted                          |
| `src/lib/agent/modelTags.ts`                                       | `src/platform/agent/modelTags.ts`                                           | copied/import-adapted                          |
| `src/lib/agent/ragRetrieval.ts`                                    | `src/platform/agent/ragRetrieval.ts`                                        | copied/import-adapted                          |
| `src/lib/agent/runtime/capabilityPolicy.ts`                        | `src/platform/agent/runtime/capabilityPolicy.ts`                            | copied/import-adapted                          |
| `src/lib/agent/runtime/config.ts`                                  | `src/platform/agent/runtime/config.ts`                                      | copied/import-adapted                          |
| `src/lib/agent/runtime/continuity.ts`                              | `src/platform/agent/runtime/continuity.ts`                                  | copied/import-adapted                          |
| `src/lib/agent/runtime/finalization.ts`                            | `src/platform/agent/runtime/finalization.ts`                                | copied/import-adapted                          |
| `src/lib/agent/runtime/limitPolicy.ts`                             | `src/platform/agent/runtime/limitPolicy.ts`                                 | copied/import-adapted                          |
| `src/lib/agent/runtime/runtimeSupport.ts`                          | `src/platform/agent/runtime/runtimeSupport.ts`                              | copied/import-adapted                          |
| `src/lib/agent/runtime/safetyPolicy.ts`                            | `src/platform/agent/runtime/safetyPolicy.ts`                                | copied/import-adapted                          |
| `src/lib/agent/runtime/sessionRunner.ts`                           | `src/platform/agent/runtime/sessionRunner.ts`                               | copied/import-adapted                          |
| `src/lib/agent/runtime/todoTrace.ts`                               | `src/platform/agent/runtime/todoTrace.ts`                                   | copied/import-adapted                          |
| `src/lib/agent/runtime/toolBroker.ts`                              | `src/platform/agent/runtime/toolBroker.ts`                                  | copied/import-adapted                          |
| `src/lib/agent/runtime/webSearchPolicy.ts`                         | `src/platform/agent/runtime/webSearchPolicy.ts`                             | copied/import-adapted                          |
| `src/lib/agent/subAgentTypes.ts`                                   | `src/platform/agent/subAgentTypes.ts`                                       | copied/import-adapted                          |
| `src/lib/agent/toolCatalog.ts`                                     | `src/platform/agent/toolCatalog.ts`                                         | copied/import-adapted                          |
| `src/lib/agent/toolGuard.ts`                                       | `src/platform/agent/toolGuard.ts`                                           | copied/import-adapted                          |
| `src/lib/agent/toolSchema.ts`                                      | `src/platform/agent/toolSchema.ts`                                          | copied/import-adapted                          |
| `src/lib/agent/types.ts`                                           | `src/platform/agent/types.ts`                                               | copied/import-adapted                          |
| `src/lib/agent/usageMetrics.ts`                                    | `src/platform/agent/usageMetrics.ts`                                        | copied/import-adapted                          |
| `src/lib/agent/visionTask.ts`                                      | `src/platform/agent/visionTask.ts`                                          | copied/import-adapted                          |
| `src/lib/agent/webResearchTask.ts`                                 | `src/platform/agent/webResearchTask.ts`                                     | copied/import-adapted                          |
| `src/lib/agentColors.ts`                                           | `src/platform/agentColors.ts`                                               | copied/import-adapted                          |
| `src/lib/agentRunStore.ts`                                         | `src/platform/agentRunStore.ts`                                             | copied/import-adapted                          |
| `src/lib/agentRuntime.ts`                                          | `src/platform/agentRuntime.ts`                                              | copied/import-adapted                          |
| `src/lib/aiService.ts`                                             | `src/platform/aiService.ts`                                                 | copied/import-adapted                          |
| `src/lib/audio/wavEncoder.ts`                                      | `src/platform/audio/wavEncoder.ts`                                          | copied/import-adapted                          |
| `src/lib/autoSetup/autoSetupEngine.ts`                             | `src/platform/autoSetup/autoSetupEngine.ts`                                 | copied/import-adapted                          |
| `src/lib/autoSetup/autoSetupService.ts`                            | `src/platform/autoSetup/autoSetupService.ts`                                | copied/import-adapted                          |
| `src/lib/autoSetup/modelSelectionRules.ts`                         | `src/platform/autoSetup/modelSelectionRules.ts`                             | copied/import-adapted                          |
| `src/lib/chatContextBuilder.ts`                                    | `src/platform/chatContextBuilder.ts`                                        | copied/import-adapted                          |
| `src/lib/chatSessionStore.ts`                                      | `src/platform/chatSessionStore.ts`                                          | copied/import-adapted                          |
| `src/lib/desktopBridge.ts`                                         | `src/platform/desktopBridge.ts`                                             | copied/import-adapted                          |
| `src/lib/desktopShellWindow.ts`                                    | `src/platform/desktopShellWindow.ts`                                        | copied/import-adapted                          |
| `src/lib/eval/evalRunner.ts`                                       | `src/platform/eval/evalRunner.ts`                                           | copied/import-adapted                          |
| `src/lib/eval/evalTasks.ts`                                        | `src/platform/eval/evalTasks.ts`                                            | copied/import-adapted                          |
| `src/lib/keyStore.ts`                                              | `src/platform/keyStore.ts`                                                  | copied/import-adapted                          |
| `src/lib/launcherCatalog.ts`                                       | `src/platform/launcherCatalog.ts`                                           | copied/import-adapted                          |
| `src/lib/localStorageStore.ts`                                     | `src/platform/localStorageStore.ts`                                         | copied/import-adapted                          |
| `src/lib/logger.ts`                                                | `src/platform/logger.ts`                                                    | copied/import-adapted                          |
| `src/lib/modelProfiles.ts`                                         | `src/platform/modelProfiles.ts`                                             | copied/import-adapted                          |
| `src/lib/notesStorage.ts`                                          | `src/platform/notesStorage.ts`                                              | copied/import-adapted                          |
| `src/lib/orbAppearance.ts`                                         | `src/platform/orbAppearance.ts`                                             | copied/import-adapted                          |
| `src/lib/orchestrationClient.ts`                                   | `src/platform/orchestrationClient.ts`                                       | copied/import-adapted                          |
| `src/lib/providers/anthropicProvider.ts`                           | `src/platform/providers/anthropicProvider.ts`                               | copied/import-adapted                          |
| `src/lib/providers/deepseekProvider.ts`                            | `src/platform/providers/deepseekProvider.ts`                                | copied/import-adapted                          |
| `src/lib/providers/geminiProvider.ts`                              | `src/platform/providers/geminiProvider.ts`                                  | copied/import-adapted                          |
| `src/lib/providers/localModelCatalog.ts`                           | `src/platform/providers/localModelCatalog.ts`                               | copied/import-adapted                          |
| `src/lib/providers/localProvider.ts`                               | `src/platform/providers/localProvider.ts`                                   | copied/import-adapted                          |
| `src/lib/providers/openaiProvider.ts`                              | `src/platform/providers/openaiProvider.ts`                                  | copied/import-adapted                          |
| `src/lib/providers/openrouterProvider.ts`                          | `src/platform/providers/openrouterProvider.ts`                              | copied/import-adapted                          |
| `src/lib/providers/providerConfiguration.ts`                       | `src/platform/providers/providerConfiguration.ts`                           | copied/import-adapted                          |
| `src/lib/providers/providerRegistry.ts`                            | `src/platform/providers/providerRegistry.ts`                                | copied/import-adapted                          |
| `src/lib/providers/providerUtils.ts`                               | `src/platform/providers/providerUtils.ts`                                   | copied/import-adapted                          |
| `src/lib/providers/types.ts`                                       | `src/platform/providers/types.ts`                                           | copied/import-adapted                          |
| `src/lib/runtimeMode.ts`                                           | `src/platform/runtimeMode.ts`                                               | copied/import-adapted                          |
| `src/lib/security.ts`                                              | `src/platform/security.ts`                                                  | copied/import-adapted                          |
| `src/lib/settingsStorage.ts`                                       | `src/platform/settingsStorage.ts`                                           | copied/import-adapted                          |
| `src/lib/skillMarkdown.ts`                                         | `src/platform/skillMarkdown.ts`                                             | copied/import-adapted                          |
| `src/lib/skillProfiles.ts`                                         | `src/platform/skillProfiles.ts`                                             | copied/import-adapted                          |
| `src/lib/skillRewards.ts`                                          | `src/platform/skillRewards.ts`                                              | copied/import-adapted                          |
| `src/lib/stpBuilder.ts`                                            | `src/platform/stpBuilder.ts`                                                | copied/import-adapted                          |
| `src/lib/subAgentRuntime.ts`                                       | `src/platform/subAgentRuntime.ts`                                           | copied/import-adapted                          |
| `src/lib/trustedSources.ts`                                        | `src/platform/trustedSources.ts`                                            | copied/import-adapted                          |
| `src/lib/utils.ts`                                                 | `src/platform/utils.ts`                                                     | copied/import-adapted                          |
| `src/types/global.d.ts`                                            | `src/types/platform.d.ts`                                                   | copied + reduced/adapted preload contract      |
| `tests/README.md`                                                  | `migrated-tests/iris/README.md`                                             | archived test copy                             |
| `tests/benchmarks/benchmarkCore.test.ts`                           | `migrated-tests/iris/benchmarks/benchmarkCore.test.ts`                      | archived test copy                             |
| `tests/benchmarks/benchmarkDatabase.test.ts`                       | `migrated-tests/iris/benchmarks/benchmarkDatabase.test.ts`                  | archived test copy                             |
| `tests/components/SearchThinkingCard.test.tsx`                     | `migrated-tests/iris/components/SearchThinkingCard.test.tsx`                | archived test copy                             |
| `tests/components/chat-panel/timeline.test.ts`                     | `migrated-tests/iris/components/chat-panel/timeline.test.ts`                | archived test copy                             |
| `tests/components/chatComposerLayout.test.ts`                      | `migrated-tests/iris/components/chatComposerLayout.test.ts`                 | archived test copy                             |
| `tests/components/orb/FloatingOrb.test.tsx`                        | `migrated-tests/iris/components/orb/FloatingOrb.test.tsx`                   | archived test copy                             |
| `tests/components/orb/OrbPills.test.tsx`                           | `migrated-tests/iris/components/orb/OrbPills.test.tsx`                      | archived test copy                             |
| `tests/components/panels/FilePanel.test.tsx`                       | `migrated-tests/iris/components/panels/FilePanel.test.tsx`                  | archived test copy                             |
| `tests/components/panels/NotesPanel.test.tsx`                      | `migrated-tests/iris/components/panels/NotesPanel.test.tsx`                 | archived test copy                             |
| `tests/components/permissions/PermissionRequestCard.test.tsx`      | `migrated-tests/iris/components/permissions/PermissionRequestCard.test.tsx` | archived test copy                             |
| `tests/components/search/SearchAnswerCard.test.tsx`                | `migrated-tests/iris/components/search/SearchAnswerCard.test.tsx`           | archived test copy                             |
| `tests/components/search/SearchHistorySidebar.test.tsx`            | `migrated-tests/iris/components/search/SearchHistorySidebar.test.tsx`       | archived test copy                             |
| `tests/components/settings/AgentsSettings.test.tsx`                | `migrated-tests/iris/components/settings/AgentsSettings.test.tsx`           | archived test copy                             |
| `tests/components/settings/AppearanceSettings.test.tsx`            | `migrated-tests/iris/components/settings/AppearanceSettings.test.tsx`       | archived test copy                             |
| `tests/components/settings/BehaviorSettings.test.tsx`              | `migrated-tests/iris/components/settings/BehaviorSettings.test.tsx`         | archived test copy                             |
| `tests/components/settings/ProvidersSection.test.tsx`              | `migrated-tests/iris/components/settings/ProvidersSection.test.tsx`         | archived test copy                             |
| `tests/components/useToastReducer.test.tsx`                        | `migrated-tests/iris/components/useToastReducer.test.tsx`                   | archived test copy                             |
| `tests/context/OrbContext.test.tsx`                                | `migrated-tests/iris/context/OrbContext.test.tsx`                           | archived test copy                             |
| `tests/electron/credentialStore.test.ts`                           | `migrated-tests/iris/electron/credentialStore.test.ts`                      | archived test copy                             |
| `tests/electron/duckDuckGoPageParser.test.ts`                      | `migrated-tests/iris/electron/duckDuckGoPageParser.test.ts`                 | archived test copy                             |
| `tests/electron/launcherShape.test.ts`                             | `migrated-tests/iris/electron/launcherShape.test.ts`                        | archived test copy                             |
| `tests/electron/linuxPasswordStore.test.ts`                        | `migrated-tests/iris/electron/linuxPasswordStore.test.ts`                   | archived test copy                             |
| `tests/electron/screenCapturePermissions.test.ts`                  | `migrated-tests/iris/electron/screenCapturePermissions.test.ts`             | archived test copy                             |
| `tests/electron/storageKeyStore.test.ts`                           | `migrated-tests/iris/electron/storageKeyStore.test.ts`                      | archived test copy                             |
| `tests/electron/windowVisibility.test.ts`                          | `migrated-tests/iris/electron/windowVisibility.test.ts`                     | archived test copy                             |
| `tests/features/chat/chatAttachments.test.ts`                      | `migrated-tests/iris/features/chat/chatAttachments.test.ts`                 | archived test copy                             |
| `tests/features/editor/CodeEditorPerformance.test.tsx`             | `migrated-tests/iris/features/editor/CodeEditorPerformance.test.tsx`        | archived test copy                             |
| `tests/features/editor/ExplorerPanel.test.tsx`                     | `migrated-tests/iris/features/editor/ExplorerPanel.test.tsx`                | archived test copy                             |
| `tests/features/editor/MarkdownView.test.tsx`                      | `migrated-tests/iris/features/editor/MarkdownView.test.tsx`                 | archived test copy                             |
| `tests/features/editor/SettingsToggle.test.tsx`                    | `migrated-tests/iris/features/editor/SettingsToggle.test.tsx`               | archived test copy                             |
| `tests/features/editor/editorPerformance.test.ts`                  | `migrated-tests/iris/features/editor/editorPerformance.test.ts`             | archived test copy                             |
| `tests/features/editor/editorSettings.test.ts`                     | `migrated-tests/iris/features/editor/editorSettings.test.ts`                | archived test copy                             |
| `tests/features/editor/syntaxThemes.test.ts`                       | `migrated-tests/iris/features/editor/syntaxThemes.test.ts`                  | archived test copy                             |
| `tests/features/editor/workspaceTree.test.ts`                      | `migrated-tests/iris/features/editor/workspaceTree.test.ts`                 | archived test copy                             |
| `tests/features/files/useFilePanel.test.tsx`                       | `migrated-tests/iris/features/files/useFilePanel.test.tsx`                  | archived test copy                             |
| `tests/features/notes/transcriptInsertion.test.ts`                 | `migrated-tests/iris/features/notes/transcriptInsertion.test.ts`            | archived test copy                             |
| `tests/features/notes/useNoteTranscription.test.tsx`               | `migrated-tests/iris/features/notes/useNoteTranscription.test.tsx`          | archived test copy                             |
| `tests/features/notes/useNotesPanel.test.tsx`                      | `migrated-tests/iris/features/notes/useNotesPanel.test.tsx`                 | archived test copy                             |
| `tests/features/search/useProgressEventDisplay.test.tsx`           | `migrated-tests/iris/features/search/useProgressEventDisplay.test.tsx`      | archived test copy                             |
| `tests/features/search/useSearchPanel.test.tsx`                    | `migrated-tests/iris/features/search/useSearchPanel.test.tsx`               | archived test copy                             |
| `tests/fixtures/documentFixtures.ts`                               | `migrated-tests/iris/fixtures/documentFixtures.ts`                          | archived test copy                             |
| `tests/fixtures/workspace/README.md`                               | `migrated-tests/iris/fixtures/workspace/README.md`                          | archived test copy                             |
| `tests/fixtures/workspace/nested/example.txt`                      | `migrated-tests/iris/fixtures/workspace/nested/example.txt`                 | archived test copy                             |
| `tests/helpers/http.ts`                                            | `migrated-tests/iris/helpers/http.ts`                                       | archived test copy                             |
| `tests/hooks/useScreenCapture.test.tsx`                            | `migrated-tests/iris/hooks/useScreenCapture.test.tsx`                       | archived test copy                             |
| `tests/lib/AuthContext.test.tsx`                                   | `migrated-tests/iris/lib/AuthContext.test.tsx`                              | archived test copy                             |
| `tests/lib/agentBusShared.test.ts`                                 | `migrated-tests/iris/lib/agentBusShared.test.ts`                            | archived test copy                             |
| `tests/lib/agentColors.test.ts`                                    | `migrated-tests/iris/lib/agentColors.test.ts`                               | archived test copy                             |
| `tests/lib/agentIdentity.test.ts`                                  | `migrated-tests/iris/lib/agentIdentity.test.ts`                             | archived test copy                             |
| `tests/lib/agentRunStore.test.ts`                                  | `migrated-tests/iris/lib/agentRunStore.test.ts`                             | archived test copy                             |
| `tests/lib/agentRuntimeDefinitions.test.ts`                        | `migrated-tests/iris/lib/agentRuntimeDefinitions.test.ts`                   | archived test copy                             |
| `tests/lib/aiService.test.ts`                                      | `migrated-tests/iris/lib/aiService.test.ts`                                 | archived test copy                             |
| `tests/lib/autoSetupEngine.test.ts`                                | `migrated-tests/iris/lib/autoSetupEngine.test.ts`                           | archived test copy                             |
| `tests/lib/autoSetupService.test.ts`                               | `migrated-tests/iris/lib/autoSetupService.test.ts`                          | archived test copy                             |
| `tests/lib/boundedRoleTask.test.ts`                                | `migrated-tests/iris/lib/boundedRoleTask.test.ts`                           | archived test copy                             |
| `tests/lib/chatExecutionPolicy.test.ts`                            | `migrated-tests/iris/lib/chatExecutionPolicy.test.ts`                       | archived test copy                             |
| `tests/lib/cloudUsagePolicy.test.ts`                               | `migrated-tests/iris/lib/cloudUsagePolicy.test.ts`                          | archived test copy                             |
| `tests/lib/controllerPrompt.test.ts`                               | `migrated-tests/iris/lib/controllerPrompt.test.ts`                          | archived test copy                             |
| `tests/lib/desktopBridge.test.ts`                                  | `migrated-tests/iris/lib/desktopBridge.test.ts`                             | archived test copy                             |
| `tests/lib/desktopShellWindow.test.ts`                             | `migrated-tests/iris/lib/desktopShellWindow.test.ts`                        | archived test copy                             |
| `tests/lib/keyStore.test.ts`                                       | `migrated-tests/iris/lib/keyStore.test.ts`                                  | archived test copy                             |
| `tests/lib/launcherCatalog.test.ts`                                | `migrated-tests/iris/lib/launcherCatalog.test.ts`                           | archived test copy                             |
| `tests/lib/legacyApiRetirement.test.ts`                            | `migrated-tests/iris/lib/legacyApiRetirement.test.ts`                       | archived test copy                             |
| `tests/lib/localModelCatalog.test.ts`                              | `migrated-tests/iris/lib/localModelCatalog.test.ts`                         | archived test copy                             |
| `tests/lib/localPlanner.test.ts`                                   | `migrated-tests/iris/lib/localPlanner.test.ts`                              | archived test copy                             |
| `tests/lib/localProfileClient.test.ts`                             | `migrated-tests/iris/lib/localProfileClient.test.ts`                        | archived test copy                             |
| `tests/lib/localProviderMultimodal.test.ts`                        | `migrated-tests/iris/lib/localProviderMultimodal.test.ts`                   | archived test copy                             |
| `tests/lib/localStorageStore.test.ts`                              | `migrated-tests/iris/lib/localStorageStore.test.ts`                         | archived test copy                             |
| `tests/lib/modelHealth.test.ts`                                    | `migrated-tests/iris/lib/modelHealth.test.ts`                               | archived test copy                             |
| `tests/lib/modelMesh.test.ts`                                      | `migrated-tests/iris/lib/modelMesh.test.ts`                                 | archived test copy                             |
| `tests/lib/modelRecovery.test.ts`                                  | `migrated-tests/iris/lib/modelRecovery.test.ts`                             | archived test copy                             |
| `tests/lib/modelRouting.test.ts`                                   | `migrated-tests/iris/lib/modelRouting.test.ts`                              | archived test copy                             |
| `tests/lib/notesStorage.test.ts`                                   | `migrated-tests/iris/lib/notesStorage.test.ts`                              | archived test copy                             |
| `tests/lib/orbTextures.test.ts`                                    | `migrated-tests/iris/lib/orbTextures.test.ts`                               | archived test copy                             |
| `tests/lib/orchestrationClient.test.ts`                            | `migrated-tests/iris/lib/orchestrationClient.test.ts`                       | archived test copy                             |
| `tests/lib/persistentPermissions.test.ts`                          | `migrated-tests/iris/lib/persistentPermissions.test.ts`                     | archived test copy                             |
| `tests/lib/providerConfiguration.test.ts`                          | `migrated-tests/iris/lib/providerConfiguration.test.ts`                     | archived test copy                             |
| `tests/lib/providerModularization.test.ts`                         | `migrated-tests/iris/lib/providerModularization.test.ts`                    | archived test copy                             |
| `tests/lib/providerRegistry.test.ts`                               | `migrated-tests/iris/lib/providerRegistry.test.ts`                          | archived test copy                             |
| `tests/lib/ragRetrieval.test.ts`                                   | `migrated-tests/iris/lib/ragRetrieval.test.ts`                              | archived test copy                             |
| `tests/lib/runtimeMode.test.ts`                                    | `migrated-tests/iris/lib/runtimeMode.test.ts`                               | archived test copy                             |
| `tests/lib/runtimeModularization.test.ts`                          | `migrated-tests/iris/lib/runtimeModularization.test.ts`                     | archived test copy                             |
| `tests/lib/screenCaptureErrors.test.ts`                            | `migrated-tests/iris/lib/screenCaptureErrors.test.ts`                       | archived test copy                             |
| `tests/lib/security.test.ts`                                       | `migrated-tests/iris/lib/security.test.ts`                                  | archived test copy                             |
| `tests/lib/settingsStorage.test.ts`                                | `migrated-tests/iris/lib/settingsStorage.test.ts`                           | archived test copy                             |
| `tests/lib/skillMarkdown.test.ts`                                  | `migrated-tests/iris/lib/skillMarkdown.test.ts`                             | archived test copy                             |
| `tests/lib/skillProfiles.test.ts`                                  | `migrated-tests/iris/lib/skillProfiles.test.ts`                             | archived test copy                             |
| `tests/lib/skillRewards.test.ts`                                   | `migrated-tests/iris/lib/skillRewards.test.ts`                              | archived test copy                             |
| `tests/lib/statefulLoop.test.ts`                                   | `migrated-tests/iris/lib/statefulLoop.test.ts`                              | archived test copy                             |
| `tests/lib/stpBuilder.test.ts`                                     | `migrated-tests/iris/lib/stpBuilder.test.ts`                                | archived test copy                             |
| `tests/lib/subAgentRuntime.test.ts`                                | `migrated-tests/iris/lib/subAgentRuntime.test.ts`                           | archived test copy                             |
| `tests/lib/todoTool.test.ts`                                       | `migrated-tests/iris/lib/todoTool.test.ts`                                  | archived test copy                             |
| `tests/lib/toolBrokerPermissions.test.ts`                          | `migrated-tests/iris/lib/toolBrokerPermissions.test.ts`                     | archived test copy                             |
| `tests/lib/toolBrokerWebFetch.test.ts`                             | `migrated-tests/iris/lib/toolBrokerWebFetch.test.ts`                        | archived test copy                             |
| `tests/lib/toolCatalog.test.ts`                                    | `migrated-tests/iris/lib/toolCatalog.test.ts`                               | archived test copy                             |
| `tests/lib/toolCatalogBrokerContract.test.ts`                      | `migrated-tests/iris/lib/toolCatalogBrokerContract.test.ts`                 | archived test copy                             |
| `tests/lib/utils.test.ts`                                          | `migrated-tests/iris/lib/utils.test.ts`                                     | archived test copy                             |
| `tests/lib/visionTask.test.ts`                                     | `migrated-tests/iris/lib/visionTask.test.ts`                                | archived test copy                             |
| `tests/lib/wavEncoder.test.ts`                                     | `migrated-tests/iris/lib/wavEncoder.test.ts`                                | archived test copy                             |
| `tests/lib/webResearchTask.test.ts`                                | `migrated-tests/iris/lib/webResearchTask.test.ts`                           | archived test copy                             |
| `tests/lib/workspaceResize.test.ts`                                | `migrated-tests/iris/lib/workspaceResize.test.ts`                           | archived test copy                             |
| `tests/server/agentInputValidation.test.ts`                        | `migrated-tests/iris/server/agentInputValidation.test.ts`                   | archived test copy                             |
| `tests/server/audioTranscriptionService.test.ts`                   | `migrated-tests/iris/server/audioTranscriptionService.test.ts`              | archived test copy                             |
| `tests/server/automationApproval.test.ts`                          | `migrated-tests/iris/server/automationApproval.test.ts`                     | archived test copy                             |
| `tests/server/bridgePermissionBoundary.test.ts`                    | `migrated-tests/iris/server/bridgePermissionBoundary.test.ts`               | archived test copy                             |
| `tests/server/bridgeServerSecurity.test.ts`                        | `migrated-tests/iris/server/bridgeServerSecurity.test.ts`                   | archived test copy                             |
| `tests/server/bridgeServiceRuntimeHelpers.test.ts`                 | `migrated-tests/iris/server/bridgeServiceRuntimeHelpers.test.ts`            | archived test copy                             |
| `tests/server/commandSafetyRoutes.test.ts`                         | `migrated-tests/iris/server/commandSafetyRoutes.test.ts`                    | archived test copy                             |
| `tests/server/cspPolicy.test.ts`                                   | `migrated-tests/iris/server/cspPolicy.test.ts`                              | archived test copy                             |
| `tests/server/desktopBridgePlugin.test.ts`                         | `migrated-tests/iris/server/desktopBridgePlugin.test.ts`                    | archived test copy                             |
| `tests/server/duckDuckGoBrowserProvider.test.ts`                   | `migrated-tests/iris/server/duckDuckGoBrowserProvider.test.ts`              | archived test copy                             |
| `tests/server/durableStorage.test.ts`                              | `migrated-tests/iris/server/durableStorage.test.ts`                         | archived test copy                             |
| `tests/server/encryptedDatabase.test.ts`                           | `migrated-tests/iris/server/encryptedDatabase.test.ts`                      | archived test copy                             |
| `tests/server/encryption.test.ts`                                  | `migrated-tests/iris/server/encryption.test.ts`                             | archived test copy                             |
| `tests/server/fileArchiveService.test.ts`                          | `migrated-tests/iris/server/fileArchiveService.test.ts`                     | archived test copy                             |
| `tests/server/fileBrowserService.test.ts`                          | `migrated-tests/iris/server/fileBrowserService.test.ts`                     | archived test copy                             |
| `tests/server/fileClipService.test.ts`                             | `migrated-tests/iris/server/fileClipService.test.ts`                        | archived test copy                             |
| `tests/server/fileConceptMath.test.ts`                             | `migrated-tests/iris/server/fileConceptMath.test.ts`                        | archived test copy                             |
| `tests/server/fileDocumentService.test.ts`                         | `migrated-tests/iris/server/fileDocumentService.test.ts`                    | archived test copy                             |
| `tests/server/fileExclusions.test.ts`                              | `migrated-tests/iris/server/fileExclusions.test.ts`                         | archived test copy                             |
| `tests/server/fileImagePreparation.test.ts`                        | `migrated-tests/iris/server/fileImagePreparation.test.ts`                   | archived test copy                             |
| `tests/server/fileImageQueue.test.ts`                              | `migrated-tests/iris/server/fileImageQueue.test.ts`                         | archived test copy                             |
| `tests/server/fileImageQueueBudget.test.ts`                        | `migrated-tests/iris/server/fileImageQueueBudget.test.ts`                   | archived test copy                             |
| `tests/server/fileIndexSourceService.test.ts`                      | `migrated-tests/iris/server/fileIndexSourceService.test.ts`                 | archived test copy                             |
| `tests/server/fileMediaRoute.test.ts`                              | `migrated-tests/iris/server/fileMediaRoute.test.ts`                         | archived test copy                             |
| `tests/server/filePdfService.test.ts`                              | `migrated-tests/iris/server/filePdfService.test.ts`                         | archived test copy                             |
| `tests/server/fileSemanticService.test.ts`                         | `migrated-tests/iris/server/fileSemanticService.test.ts`                    | archived test copy                             |
| `tests/server/fileVideoService.test.ts`                            | `migrated-tests/iris/server/fileVideoService.test.ts`                       | archived test copy                             |
| `tests/server/filesystemBoundary.test.ts`                          | `migrated-tests/iris/server/filesystemBoundary.test.ts`                     | archived test copy                             |
| `tests/server/launcherSafety.test.ts`                              | `migrated-tests/iris/server/launcherSafety.test.ts`                         | archived test copy                             |
| `tests/server/launcherSemanticService.test.ts`                     | `migrated-tests/iris/server/launcherSemanticService.test.ts`                | archived test copy                             |
| `tests/server/launcherService.test.ts`                             | `migrated-tests/iris/server/launcherService.test.ts`                        | archived test copy                             |
| `tests/server/nativeFileDialogService.test.ts`                     | `migrated-tests/iris/server/nativeFileDialogService.test.ts`                | archived test copy                             |
| `tests/server/networkSecurity.test.ts`                             | `migrated-tests/iris/server/networkSecurity.test.ts`                        | archived test copy                             |
| `tests/server/operationLimiter.test.ts`                            | `migrated-tests/iris/server/operationLimiter.test.ts`                       | archived test copy                             |
| `tests/server/processExecution.test.ts`                            | `migrated-tests/iris/server/processExecution.test.ts`                       | archived test copy                             |
| `tests/server/providerProxyBoundary.test.ts`                       | `migrated-tests/iris/server/providerProxyBoundary.test.ts`                  | archived test copy                             |
| `tests/server/unifiedDiff.test.ts`                                 | `migrated-tests/iris/server/unifiedDiff.test.ts`                            | archived test copy                             |
| `tests/server/webResearchProgress.test.ts`                         | `migrated-tests/iris/server/webResearchProgress.test.ts`                    | archived test copy                             |
| `tests/server/webSearchHistoryDatabase.test.ts`                    | `migrated-tests/iris/server/webSearchHistoryDatabase.test.ts`               | archived test copy                             |
| `tests/server/workloadLimits.test.ts`                              | `migrated-tests/iris/server/workloadLimits.test.ts`                         | archived test copy                             |
| `tests/setup.ts`                                                   | `migrated-tests/iris/setup.ts`                                              | archived test copy                             |

## IRIS files intentionally not copied as implementation source

| IRIS file                                                              | Classification                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `components.json`                                                      | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `electron-src/editor/diagnostics.cts`                                  | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/editor/files.cts`                                        | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/editor/terminal.cts`                                     | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/editor/workspace.cts`                                    | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/editorIpc.cts`                                           | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/launcherShape.cts`                                       | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/main.cts`                                                | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/orbWindow.cts`                                           | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/orbWindowIpc.cts`                                        | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/preload.cts`                                             | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/windowManager.cts`                                       | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron-src/windowVisibility.cts`                                    | OMITTED-UI — old IRIS window/editor shell; trusted pieces adapted in Code Editor Electron |
| `electron/credentialStore.cjs`                                         | GENERATED — regenerated from migrated source                                              |
| `electron/duckDuckGoPageParser.cjs`                                    | GENERATED — regenerated from migrated source                                              |
| `electron/duckDuckGoSearchWindow.cjs`                                  | GENERATED — regenerated from migrated source                                              |
| `electron/editor/diagnostics.cjs`                                      | GENERATED — regenerated from migrated source                                              |
| `electron/editor/files.cjs`                                            | GENERATED — regenerated from migrated source                                              |
| `electron/editor/terminal.cjs`                                         | GENERATED — regenerated from migrated source                                              |
| `electron/editor/workspace.cjs`                                        | GENERATED — regenerated from migrated source                                              |
| `electron/editorIpc.cjs`                                               | GENERATED — regenerated from migrated source                                              |
| `electron/launcherShape.cjs`                                           | GENERATED — regenerated from migrated source                                              |
| `electron/linuxPasswordStore.cjs`                                      | GENERATED — regenerated from migrated source                                              |
| `electron/localBridge.cjs`                                             | GENERATED — regenerated from migrated source                                              |
| `electron/logger.cjs`                                                  | GENERATED — regenerated from migrated source                                              |
| `electron/main.cjs`                                                    | GENERATED — regenerated from migrated source                                              |
| `electron/orbWindow.cjs`                                               | GENERATED — regenerated from migrated source                                              |
| `electron/orbWindowIpc.cjs`                                            | GENERATED — regenerated from migrated source                                              |
| `electron/preload.cjs`                                                 | GENERATED — regenerated from migrated source                                              |
| `electron/screenCapturePermissions.cjs`                                | GENERATED — regenerated from migrated source                                              |
| `electron/security.cjs`                                                | GENERATED — regenerated from migrated source                                              |
| `electron/storageKeyStore.cjs`                                         | GENERATED — regenerated from migrated source                                              |
| `electron/windowManager.cjs`                                           | GENERATED — regenerated from migrated source                                              |
| `electron/windowVisibility.cjs`                                        | GENERATED — regenerated from migrated source                                              |
| `eslint.config.ts`                                                     | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `index.html`                                                           | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `jsconfig.json`                                                        | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `package-lock.json`                                                    | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `package-lock.json.bak`                                                | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `package.json`                                                         | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `postcss.config.ts`                                                    | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `public/manifest.json`                                                 | OMITTED-UI — old IRIS shell/bootstrap                                                     |
| `scripts/verify-electron-runtime.cjs`                                  | REPLACED-CONFIG — Code Editor runtime check retained                                      |
| `server-dist/bridgeServer.js`                                          | GENERATED — regenerated from migrated source                                              |
| `server-dist/builtinSkills.js`                                         | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/errors.js`                                  | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/middleware.js`                              | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/response.js`                                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/agentRoutes.js`                      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/audioRoutes.js`                      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/automationAiRoutes.js`               | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/coreRoutes.js`                       | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/fileRoutes.js`                       | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/persistenceRoutes.js`                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/powerRoutes.js`                      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/router.js`                           | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/routes/webSkillRoutes.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/agentService.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/audioTranscriptionService.js`      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/automationAiService.js`            | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/bridgeServiceRuntime.js`           | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/coreService.js`                    | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/duckDuckGoBrowserProvider.js`      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileArchiveService.js`             | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileBrowserService.js`             | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileClipService.js`                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileConceptMath.js`                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileConceptPool.js`                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileConceptService.js`             | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileConceptWorker.js`              | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileConceptWorkerTypes.js`         | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileDocumentService.js`            | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileExtractionPool.js`             | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileExtractionWorker.js`           | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileExtractionWorkerTypes.js`      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileImagePreparation.js`           | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileImageProcessingPool.js`        | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileImageProcessingWorker.js`      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileImageProcessingWorkerTypes.js` | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileImageQueue.js`                 | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileImageQueueBudget.js`           | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileIndexSourceService.js`         | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/filePdfService.js`                 | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileSemanticService.js`            | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileService.js`                    | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/fileVideoService.js`               | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/launcherSemanticService.js`        | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/launcherService.js`                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/nativeFileDialogService.js`        | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/persistenceService.js`             | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/powerService.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/webSearchHistoryService.js`        | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/services/webSkillService.js`                | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/agentBusShared.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/agentInputValidation.js`             | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/atomicFile.js`                       | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/automationApproval.js`               | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/bridgeAuthorization.js`              | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/fileExclusions.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/filesystemBoundary.js`               | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/launcherSafety.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/networkSecurity.js`                  | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/operationLimiter.js`                 | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/processExecution.js`                 | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/providerProxyPolicy.js`              | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/unifiedDiff.js`                      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/shared/workloadLimits.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/storage/encryptedDatabase.js`               | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/storage/encryptedDatabaseSchema.js`         | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/storage/encryption.js`                      | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/storage/legacyCleanup.js`                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridge/types.js`                                   | GENERATED — regenerated from migrated source                                              |
| `server-dist/desktopBridgePlugin.js`                                   | GENERATED — regenerated from migrated source                                              |
| `src/App.tsx`                                                          | OMITTED-UI — old IRIS shell/bootstrap                                                     |
| `src/components/AuthLayout.tsx`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ErrorBoundary.tsx`                                     | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/GoogleIcon.tsx`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/PanelManager.tsx`                                      | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/SkillMeter.tsx`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/SystemTray.tsx`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/UserNotRegisteredError.tsx`                            | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/audio/AudioRecordButton.tsx`                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/audio/AudioTranscriptionDialogs.tsx`                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/automation/DesktopControlApproval.tsx`                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat-panel/components/ActivityComponents.tsx`          | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat-panel/components/ArtifactComponents.tsx`          | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat-panel/components/EventTimeline.tsx`               | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat-panel/components/QuestionCard.tsx`                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat-panel/components/UsageMeter.tsx`                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat-panel/components/WorkflowExplorer.tsx`            | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/chat/SlashCommandMenu.tsx`                             | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/files/FileContextMenu.tsx`                             | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/files/FileDirectoryTree.tsx`                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/files/FilePanelControls.tsx`                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/files/FileThumbnail.tsx`                               | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/icons/AtomGlyph.tsx`                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/icons/IRISIcon.tsx`                                    | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/icons/IrisMark.tsx`                                    | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/icons/OrbitalIcon.tsx`                                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/launcher/LaunchApprovalCard.tsx`                       | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/launcher/launcherIcons.tsx`                            | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/notes/NoteListItem.tsx`                                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/orb/FloatingOrb.tsx`                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/orb/OrbContextMenu.tsx`                                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/orb/OrbPills.tsx`                                      | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/orb/ParticleOrb.tsx`                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/ChatPanel.tsx`                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/FilePanel.tsx`                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/LauncherPanel.tsx`                              | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/NotesPanel.tsx`                                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/PanelBase.tsx`                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/SearchPanel.tsx`                                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/SettingsPanel.tsx`                              | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/SkillsPanel.tsx`                                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/SystemMonitorPanel.tsx`                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/panels/VisionPanel.tsx`                                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/permissions/PermissionRequestCard.tsx`                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/search/SearchAnswerCard.tsx`                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/search/SearchGenerationDetails.tsx`                    | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/search/SearchHistorySidebar.tsx`                       | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/search/SearchProgressCard.tsx`                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/search/SearchThinkingCard.tsx`                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/ProvidersSection.tsx`                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/AgentsSettings.tsx`                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/AppearanceSettings.tsx`            | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/BehaviorSettings.tsx`              | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/HotkeysSettings.tsx`               | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/KeysSettings.tsx`                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/PermissionsSettings.tsx`           | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/categories/SearchSettings.tsx`                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/components/IndexSetupCard.tsx`                | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/components/ModelCatalogPicker.tsx`            | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/components/SettingRow.tsx`                    | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/components/SettingToggle.tsx`                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/components/SettingsSubTabs.tsx`               | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/components/SettingsTabs.tsx`                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/constants.ts`                                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/hooks/useSettingsPanelController.ts`          | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/types.ts`                                     | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/settings/utils/searchSettings.ts`                      | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/MarkdownView.tsx`                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/SafeExternalLink.tsx`                               | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/ThemedSelect.tsx`                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/button.tsx`                                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/input-otp.tsx`                                      | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/input.tsx`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/label.tsx`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/toast.tsx`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/toaster.tsx`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/ui/use-toast.ts`                                       | OMITTED-UI — old IRIS presentation                                                        |
| `src/components/workspace/WorkspaceResizeHandles.tsx`                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/context/OrbContext.tsx`                                           | OMITTED-UI — old Orb/panel context composition                                            |
| `src/context/PanelSlotContext.ts`                                      | OMITTED-UI — old Orb/panel context composition                                            |
| `src/context/orb/AgentStatusContext.tsx`                               | OMITTED-UI — old Orb/panel context composition                                            |
| `src/context/orb/OrbProvider.tsx`                                      | OMITTED-UI — old Orb/panel context composition                                            |
| `src/context/orb/PanelContext.tsx`                                     | OMITTED-UI — old Orb/panel context composition                                            |
| `src/features/editor/EditorWindowApp.tsx`                              | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/AIChatPanel.tsx`                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/ActivityBar.tsx`                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/BrowserPanel.tsx`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/CodeEditor.tsx`                        | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/EditorContextMenu.tsx`                 | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/EditorPanel.tsx`                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/ExplorerPanel.tsx`                     | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/Icon.tsx`                              | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/IndentationPicker.tsx`                 | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/LanguagePicker.tsx`                    | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/LanguageSelector.tsx`                  | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/MarkdownView.tsx`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/MenuDropdown.tsx`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/NewFileModal.tsx`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/NoticeToast.tsx`                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/SaveChangesModal.tsx`                  | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/SearchPanel.tsx`                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/SettingsModal.tsx`                     | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/StatusBar.tsx`                         | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/TerminalPanel.tsx`                     | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/TopBar.tsx`                            | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/WorkspaceConflictModal.tsx`            | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/explorer/ExplorerContextMenu.tsx`      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/explorer/ExplorerInlineInput.tsx`      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/explorer/ExplorerTreeRow.tsx`          | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/ai-chat.svg`                    | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/browser.svg`                    | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/close.svg`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/explorer.svg`                   | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/maximize.svg`                   | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/minimize.svg`                   | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/restore.svg`                    | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/search.svg`                     | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/settings.svg`                   | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/source-control.svg`             | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/images/trash.svg`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/viewers/AudioViewer.tsx`               | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/viewers/ImageViewer.tsx`               | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/viewers/MediaViewer.tsx`               | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/viewers/PdfViewer.tsx`                 | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/viewers/UnsupportedFileViewer.tsx`     | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/components/viewers/VideoViewer.tsx`               | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/data/languages.ts`                                | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/editor.css`                                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/editor/editorCommands.ts`                         | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/editor/editorPerformance.ts`                      | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/editor/editorSearch.ts`                           | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/editor/editorSettings.ts`                         | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/editor/syntaxThemes.ts`                           | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/hooks/useAIChat.ts`                               | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/hooks/useEditorState.ts`                          | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/hooks/usePanelSizes.ts`                           | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/hooks/useWorkspace.ts`                            | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/types/editor.ts`                                  | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/types/electron.d.ts`                              | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/types/workspace.ts`                               | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/editor/workspace/workspaceTree.ts`                       | OMITTED-UI — duplicate IRIS editor                                                        |
| `src/features/screen-capture/ScreenCaptureContext.tsx`                 | OMITTED-UI — old vision/screen presentation glue                                          |
| `src/features/screen-capture/ScreenShareToggle.tsx`                    | OMITTED-UI — old vision/screen presentation glue                                          |
| `src/hooks/useScreenCapture.tsx`                                       | OMITTED-UI — old vision/screen presentation glue                                          |
| `src/images/desert.png`                                                | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/fire.png`                                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/ice.png`                                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/calculator.png`                                      | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/clapperboard.png`                                    | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/cleanup.png`                                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/clipboard.png`                                       | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/code_editor.png`                                     | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/controller.png`                                      | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/docker.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/download.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/editor.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/email.png`                                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/files.png`                                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/git.png`                                             | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/graphics.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/memory.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/monitor.png`                                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/open_folder.png`                                     | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/paper.png`                                           | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/password.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/person.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/planet.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/podman.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/rocket.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/settings.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/software_center.png`                                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/start_env.png`                                       | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/stop_env.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/teamwork.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/terminal.png`                                        | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/update.png`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/warning.png`                                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/icons/web_network.png`                                     | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/moon.png`                                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/neon.png`                                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/swamp.png`                                                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/images/water.png`                                                 | OMITTED-UI — old IRIS presentation                                                        |
| `src/index.css`                                                        | OMITTED-UI — old IRIS shell/bootstrap                                                     |
| `src/lib/AuthContext.tsx`                                              | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/PageNotFound.tsx`                                             | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/highlight.ts`                                                 | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/iconAssets.ts`                                                | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/localProfileClient.ts`                                        | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/orbTextures.ts`                                               | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/query-client.ts`                                              | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/lib/workspaceResize.ts`                                           | OMITTED-UI — profile/presentation compatibility helper                                    |
| `src/main.tsx`                                                         | OMITTED-UI — old IRIS shell/bootstrap                                                     |
| `src/pages/ForgotPassword.tsx`                                         | OMITTED-UI — old IRIS presentation                                                        |
| `src/pages/Home.tsx`                                                   | OMITTED-UI — old IRIS presentation                                                        |
| `src/pages/Login.tsx`                                                  | OMITTED-UI — old IRIS presentation                                                        |
| `src/pages/Register.tsx`                                               | OMITTED-UI — old IRIS presentation                                                        |
| `src/pages/ResetPassword.tsx`                                          | OMITTED-UI — old IRIS presentation                                                        |
| `src/types/legacy-modules.d.ts`                                        | OMITTED-UI — profile/presentation compatibility helper                                    |
| `tailwind.config.ts`                                                   | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `tsconfig.benchmark.json`                                              | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `tsconfig.config.json`                                                 | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `tsconfig.electron.json`                                               | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `tsconfig.json`                                                        | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `tsconfig.server.json`                                                 | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `tsconfig.test.json`                                                   | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `vite.config.ts`                                                       | REPLACED-CONFIG — Code Editor config retained/merged                                      |
| `vitest.config.ts`                                                     | REPLACED-CONFIG — Code Editor config retained/merged                                      |
