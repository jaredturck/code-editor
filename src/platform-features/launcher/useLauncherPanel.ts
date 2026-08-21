/**
 * Owns launcher discovery, encrypted capability caching, user shortcuts, managed development
 * actions, and exact one-time approval for risky or destructive launcher operations.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useOrbSettings } from '@/platform-context/AgentSettingsContext';
import {
  clearIRISData,
  getLauncherSemanticStatus,
  getLocalSessionInfo,
  installLauncherSemanticModel,
  launchLocalCommand,
  rebuildLauncherSemanticIndex,
  searchLauncherSemanticApplications,
  startDevEnvironment,
  stopDevEnvironment,
  type BridgeLaunchRequest,
  type BridgeLaunchResult,
  type BridgeLauncherSemanticApplication,
  type BridgeLauncherSemanticStatus,
  type LocalBridgeError,
} from '@/platform/desktopBridge';
import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore';
import { getSafeExternalUrl, stripTerminalControlCharacters } from '@/platform/security';
import {
  buildLauncherCatalog,
  getLauncherDiscovery,
  refreshLauncherCatalog,
  semanticApplicationLauncherEntry,
  LAUNCHER_SHORTCUTS_STORAGE_KEY as SHORTCUTS_STORAGE_KEY,
  type LauncherAction,
  type LauncherCatalogState,
  type LauncherCategory,
  type LauncherEntry,
} from '@/platform/launcherCatalog';

export type { LauncherAction, LauncherCategory } from '@/platform/launcherCatalog';

export type LauncherId = number | string;
export interface LauncherApp extends LauncherEntry {}
export interface LauncherShortcut extends LauncherApp {
  id: number;
}

export interface LauncherDraft {
  name: string;
  command: string;
  icon: string;
  category: LauncherCategory;
}

export interface LauncherRunRecord {
  name: string;
  command: string;
  time: string;
  status: 'success' | 'blocked' | 'error';
  message: string;
}

export interface PendingLaunchApproval extends BridgeLaunchResult {
  approvalId: string;
  reason: string;
  command: string;
  cwd: string;
  app: LauncherApp;
  request?: BridgeLaunchRequest;
  approvalAction: 'launch' | 'clear_data';
  time: string;
}

export interface LauncherPanelState {
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  shortcuts: LauncherShortcut[];
  filteredApps: LauncherApp[];
  showAddForm: boolean;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  newShortcut: LauncherDraft;
  setNewShortcut: Dispatch<SetStateAction<LauncherDraft>>;
  lastRun: LauncherRunRecord | null;
  pendingPermissionApp: LauncherApp | null;
  pendingApproval: PendingLaunchApproval | null;
  approvalBusy: boolean;
  discoveryBusy: boolean;
  discoveryError: string;
  semanticPromptOpen: boolean;
  semanticInstallBusy: boolean;
  semanticSearchBusy: boolean;
  semanticStatusMessage: string;
  semanticStatusKind: 'info' | 'success' | 'error';
  semanticModelName: string;
  runApp: (app: LauncherApp, permissionGranted?: boolean) => Promise<void>;
  retryPendingPermission: () => Promise<void>;
  dismissPendingPermission: () => void;
  refreshApps: () => Promise<void>;
  installSemanticModel: () => Promise<void>;
  cancelSemanticModelPrompt: () => void;
  approvePendingLaunch: () => Promise<void>;
  cancelPendingLaunch: () => void;
  addShortcut: () => void;
  removeShortcut: (id: LauncherId) => void;
  togglePin: (id: LauncherId) => void;
}

const EMPTY_SHORTCUT: LauncherDraft = {
  name: '',
  command: '',
  icon: 'start_env',
  category: 'command',
};

const EMPTY_CATALOG_STATE: LauncherCatalogState = {
  discovery: getLauncherDiscovery(),
  devStatus: {
    configured: false,
    available: false,
    running: false,
    reason: 'No working directory configured.',
  },
};

function isLegacyDefaultShortcut(shortcut: LauncherShortcut): boolean {
  const name = String(shortcut.name || '').toLowerCase();
  const command = String(shortcut.command || '').trim();
  return (
    (name === 'start dev server' && command === 'npm run dev') ||
    (name === 'kill port 3000' && command === 'kill -9 $(lsof -t -i:3000)')
  );
}

function readShortcuts(): LauncherShortcut[] {
  const parsed = readStorageJson<unknown>(SHORTCUTS_STORAGE_KEY, []);
  return Array.isArray(parsed)
    ? (parsed.slice(0, 100) as LauncherShortcut[]).filter(
        (shortcut) => !isLegacyDefaultShortcut(shortcut),
      )
    : [];
}

function writeShortcuts(shortcuts: LauncherShortcut[]): void {
  writeStorageJson(SHORTCUTS_STORAGE_KEY, shortcuts.slice(0, 100));
}

function getBridgeError(
  error: unknown,
): Pick<LocalBridgeError, 'message' | 'status' | 'retryAfterMs'> {
  if (error instanceof Error) {
    const detail = error as LocalBridgeError;
    return {
      message: detail.message,
      status: detail.status,
      retryAfterMs: detail.retryAfterMs,
    };
  }
  return { message: 'Failed to launch', status: 0 };
}

function appCommand(app: LauncherApp): string {
  return String(app.command || [app.executable, ...(app.args || [])].filter(Boolean).join(' '));
}

/**
 * Loads verified launcher capabilities, builds the visible card set, and routes each card to
 * its structured launch, managed development, or destructive-data action.
 */
export function useLauncherPanel(): LauncherPanelState {
  const { settings } = useOrbSettings();
  const [search, setSearch] = useState('');
  const [shortcuts, setShortcuts] = useState<LauncherShortcut[]>(readShortcuts);
  const [catalogState, setCatalogState] = useState<LauncherCatalogState>(EMPTY_CATALOG_STATE);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newShortcut, setNewShortcut] = useState<LauncherDraft>(EMPTY_SHORTCUT);
  const [lastRun, setLastRun] = useState<LauncherRunRecord | null>(null);
  const [pendingPermissionApp, setPendingPermissionApp] = useState<LauncherApp | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingLaunchApproval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [semanticStatus, setSemanticStatus] = useState<BridgeLauncherSemanticStatus | null>(null);
  const [semanticPromptDismissed, setSemanticPromptDismissed] = useState(false);
  const [semanticInstallBusy, setSemanticInstallBusy] = useState(false);
  const [semanticSearchBusy, setSemanticSearchBusy] = useState(false);
  const [semanticResults, setSemanticResults] = useState<BridgeLauncherSemanticApplication[]>([]);
  const [semanticError, setSemanticError] = useState('');
  const [sessionCwd, setSessionCwd] = useState('~');
  const workingDirectory = String(settings.agent_working_dir || '').trim();

  useEffect(() => {
    writeShortcuts(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    const loadSession = async (): Promise<void> => {
      const info = await getLocalSessionInfo().catch(() => null);
      if (info && typeof info.cwd === 'string') setSessionCwd(info.cwd);
    };
    void loadSession();
  }, []);

  const loadCatalog = useCallback(
    async (force = false): Promise<void> => {
      setDiscoveryBusy(true);
      setDiscoveryError('');
      try {
        const state = await refreshLauncherCatalog(workingDirectory, force);
        setCatalogState(state);
      } catch (error) {
        setDiscoveryError(
          error instanceof Error ? error.message : 'Launcher application discovery failed.',
        );
      } finally {
        setDiscoveryBusy(false);
      }
    },
    [workingDirectory],
  );

  useEffect(() => {
    void loadCatalog(false);
  }, [loadCatalog]);

  const loadSemanticStatus = useCallback(async (buildIfMissing = true): Promise<void> => {
    try {
      const status = await getLauncherSemanticStatus(buildIfMissing);
      setSemanticStatus(status);
      if (status.error) setSemanticError(status.error);
      else if (status.indexStatus !== 'error') setSemanticError('');
    } catch (error) {
      setSemanticError(
        error instanceof Error ? error.message : 'Semantic application search is unavailable.',
      );
    }
  }, []);

  useEffect(() => {
    void loadSemanticStatus(true);
  }, [loadSemanticStatus]);

  useEffect(() => {
    if (semanticStatus?.indexStatus !== 'building') return;
    const timer = window.setInterval(() => {
      void loadSemanticStatus(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadSemanticStatus, semanticStatus?.indexStatus]);

  const semanticIndexUsable = Boolean(
    semanticStatus?.modelInstalled &&
    (semanticStatus.indexStatus === 'ready' ||
      (semanticStatus.indexStatus === 'building' && semanticStatus.applicationCount > 0)),
  );

  useEffect(() => {
    const query = search.trim();
    if (!query || !semanticIndexUsable) {
      setSemanticResults([]);
      setSemanticSearchBusy(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSemanticSearchBusy(true);
      void searchLauncherSemanticApplications(query, 20)
        .then((results) => {
          if (!cancelled) {
            setSemanticResults(results);
            setSemanticError('');
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSemanticResults([]);
            setSemanticError(
              error instanceof Error ? error.message : 'Semantic application search failed.',
            );
          }
        })
        .finally(() => {
          if (!cancelled) setSemanticSearchBusy(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, semanticIndexUsable, semanticStatus?.generatedAt]);

  const filteredApps = useMemo<LauncherApp[]>(() => {
    const allApps = buildLauncherCatalog({
      shortcuts,
      discovery: catalogState.discovery,
      devStatus: catalogState.devStatus,
      workingDirectory,
    });
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return allApps;

    const curatedMatches = allApps.filter(
      (app) =>
        app.name.toLowerCase().includes(normalizedSearch) ||
        app.command.toLowerCase().includes(normalizedSearch) ||
        String(app.subtitle || '')
          .toLowerCase()
          .includes(normalizedSearch),
    );
    if (!semanticIndexUsable || semanticResults.length === 0) return curatedMatches;

    const semanticEntries = semanticResults.map((application) =>
      semanticApplicationLauncherEntry(application, catalogState.discovery),
    );
    const result: LauncherApp[] = [];
    const seen = new Set<string>();
    for (const app of [...curatedMatches, ...semanticEntries]) {
      const key = app.executable
        ? JSON.stringify([app.executable, app.args || []])
        : `id:${String(app.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(app);
      if (result.length >= 30) break;
    }
    return result;
  }, [catalogState, search, semanticIndexUsable, semanticResults, shortcuts, workingDirectory]);

  const recordLaunchResult = (app: LauncherApp, result: BridgeLaunchResult, time: string): void => {
    setLastRun({
      name: app.name,
      command: typeof result.command === 'string' ? result.command : appCommand(app),
      time,
      status: 'success',
      message: stripTerminalControlCharacters(
        typeof result.message === 'string' ? result.message : 'Process launched',
      ),
    });
  };

  const recordFailure = (app: LauncherApp, error: unknown, time: string): void => {
    const detail = getBridgeError(error);
    const retry = Number(detail.retryAfterMs);
    setLastRun({
      name: app.name,
      command: appCommand(app),
      time,
      status: detail.status === 429 ? 'blocked' : 'error',
      message: stripTerminalControlCharacters(
        detail.status === 429 && retry > 0
          ? `Launcher is busy; retry in ${Math.ceil(retry / 1000)}s`
          : detail.message || 'Failed to launch',
      ),
    });
  };

  const installSemanticModel = async (): Promise<void> => {
    if (semanticInstallBusy) return;
    setSemanticInstallBusy(true);
    setSemanticError('');
    try {
      const status = await installLauncherSemanticModel();
      setSemanticStatus(status);
      setSemanticPromptDismissed(true);
    } catch (error) {
      setSemanticError(
        error instanceof Error ? error.message : 'The embedding model download failed.',
      );
    } finally {
      setSemanticInstallBusy(false);
    }
  };

  const refreshApps = async (): Promise<void> => {
    await loadCatalog(true);
    if (semanticStatus?.modelInstalled) {
      try {
        const status = await rebuildLauncherSemanticIndex();
        setSemanticStatus(status);
        setSemanticError('');
      } catch (error) {
        setSemanticError(
          error instanceof Error
            ? error.message
            : 'The semantic application index could not be rebuilt.',
        );
      }
    } else {
      await loadSemanticStatus(false);
    }
  };

  const refreshAfterDevAction = async (): Promise<void> => {
    const state = await refreshLauncherCatalog(workingDirectory, false);
    setCatalogState(state);
  };

  const runManagedAction = async (
    app: LauncherApp,
    action: LauncherAction,
    time: string,
  ): Promise<void> => {
    if (action === 'dev_start') {
      const result = await startDevEnvironment(workingDirectory);
      setLastRun({
        name: app.name,
        command: String(result.command || app.command),
        time,
        status: result.running ? 'success' : 'error',
        message: result.running
          ? `Started ${result.projectName || 'development environment'}`
          : String(result.reason || 'Development environment did not start.'),
      });
      await refreshAfterDevAction();
      return;
    }

    if (action === 'dev_stop') {
      const result = await stopDevEnvironment();
      setLastRun({
        name: app.name,
        command: String(result.command || app.command),
        time,
        status: result.running ? 'error' : 'success',
        message: String(result.reason || 'Development environment stopped.'),
      });
      await refreshAfterDevAction();
      return;
    }

    if (action === 'clear_data') {
      const result = await clearIRISData();
      if (result.approvalRequired) {
        setPendingApproval({
          ...result,
          approvalId: String(result.approvalId || ''),
          reason: String(result.reason || 'This action permanently deletes IRIS data.'),
          command: String(result.command || app.command),
          cwd: String(result.cwd || sessionCwd),
          app,
          approvalAction: 'clear_data',
          time,
        });
      }
    }
  };

  const runApp = async (app: LauncherApp, permissionGranted = false): Promise<void> => {
    const time = new Date().toLocaleTimeString();

    if (app.disabled) {
      setLastRun({
        name: app.name,
        command: appCommand(app),
        time,
        status: 'blocked',
        message: String(app.disabledReason || 'This launcher action is unavailable.'),
      });
      return;
    }

    if (app.category === 'url') {
      const safeUrl = getSafeExternalUrl(app.command);
      if (!safeUrl) {
        setLastRun({
          name: app.name,
          command: app.command,
          time,
          status: 'blocked',
          message: 'Only HTTP and HTTPS URLs can be opened.',
        });
        return;
      }
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
      setLastRun({
        name: app.name,
        command: safeUrl,
        time,
        status: 'success',
        message: 'Opened URL',
      });
      return;
    }

    if (!settings.permissions_terminal && !permissionGranted) {
      setPendingPermissionApp(app);
      setLastRun(null);
      return;
    }

    setPendingPermissionApp(null);

    try {
      if (app.action && app.action !== 'launch') {
        await runManagedAction(app, app.action, time);
        return;
      }

      const request: BridgeLaunchRequest = {
        command: app.command,
        category: app.category,
        cwd: app.cwd || workingDirectory || sessionCwd,
        ...(app.executable ? { executable: app.executable, args: app.args || [] } : {}),
      };
      const result = await launchLocalCommand(request);
      if (result.approvalRequired) {
        setPendingApproval({
          ...result,
          approvalId: String(result.approvalId || ''),
          reason: String(result.reason || 'This command requires confirmation.'),
          command: String(result.command || app.command),
          cwd: String(result.cwd || request.cwd || sessionCwd),
          app,
          request,
          approvalAction: 'launch',
          time,
        });
        return;
      }
      recordLaunchResult(app, result, time);
    } catch (error) {
      recordFailure(app, error, time);
    }
  };

  const approvePendingLaunch = async (): Promise<void> => {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    try {
      if (pendingApproval.approvalAction === 'clear_data') {
        const result = await clearIRISData(pendingApproval.approvalId);
        if (result.cleared) {
          window.location.reload();
          return;
        }
        throw new Error('IRIS data was not cleared.');
      }

      const result = await launchLocalCommand({
        ...(pendingApproval.request || {}),
        approvalId: pendingApproval.approvalId,
      });
      recordLaunchResult(pendingApproval.app, result, new Date().toLocaleTimeString());
      setPendingApproval(null);
    } catch (error) {
      recordFailure(pendingApproval.app, error, new Date().toLocaleTimeString());
      setPendingApproval(null);
    } finally {
      setApprovalBusy(false);
    }
  };

  const cancelPendingLaunch = (): void => setPendingApproval(null);

  const addShortcut = (): void => {
    if (!newShortcut.name || !newShortcut.command) return;
    setShortcuts((previous) => [...previous, { ...newShortcut, id: Date.now(), pinned: false }]);
    setNewShortcut(EMPTY_SHORTCUT);
    setShowAddForm(false);
  };

  const removeShortcut = (id: LauncherId): void => {
    setShortcuts((previous) => previous.filter((shortcut) => shortcut.id !== id));
  };

  const togglePin = (id: LauncherId): void => {
    setShortcuts((previous) =>
      previous.map((shortcut) =>
        shortcut.id === id ? { ...shortcut, pinned: !shortcut.pinned } : shortcut,
      ),
    );
  };

  const retryPendingPermission = async (): Promise<void> => {
    const app = pendingPermissionApp;
    if (!app) return;
    await runApp(app, true);
  };

  const dismissPendingPermission = (): void => {
    setPendingPermissionApp(null);
  };

  const semanticPromptOpen = Boolean(
    semanticStatus?.ollamaAvailable && !semanticStatus.modelInstalled && !semanticPromptDismissed,
  );
  const semanticStatusMessage = semanticInstallBusy
    ? `Downloading ${semanticStatus?.model || 'semantic search model'} through Ollama...`
    : semanticStatus?.indexStatus === 'building'
      ? `${semanticStatus.stage || 'Indexing installed applications'}${
          Number(semanticStatus.total) > 0
            ? ` · ${Number(semanticStatus.completed || 0)} / ${Number(semanticStatus.total)}`
            : ''
        }`
      : semanticStatus?.indexStatus === 'ready'
        ? `Semantic search ready · ${semanticStatus.applicationCount} applications indexed`
        : semanticError;
  const semanticStatusKind: 'info' | 'success' | 'error' = semanticError
    ? 'error'
    : semanticStatus?.indexStatus === 'ready'
      ? 'success'
      : 'info';

  return {
    search,
    setSearch,
    shortcuts,
    filteredApps,
    showAddForm,
    setShowAddForm,
    newShortcut,
    setNewShortcut,
    lastRun,
    pendingPermissionApp,
    pendingApproval,
    approvalBusy,
    discoveryBusy,
    discoveryError,
    semanticPromptOpen,
    semanticInstallBusy,
    semanticSearchBusy,
    semanticStatusMessage,
    semanticStatusKind,
    semanticModelName: semanticStatus?.model || 'qwen3-embedding:0.6b',
    runApp,
    retryPendingPermission,
    dismissPendingPermission,
    refreshApps,
    installSemanticModel,
    cancelSemanticModelPrompt: () => setSemanticPromptDismissed(true),
    approvePendingLaunch,
    cancelPendingLaunch,
    addShortcut,
    removeShortcut,
    togglePin,
  };
}
