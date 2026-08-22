/**
 * Owns the approval controller state and side effects used by the Chat panel. Extracting
 * this controller keeps the large presentation component from duplicating lifecycle and
 * persistence logic.
 */

import { useEffect, useRef, useState } from 'react';
import {
  buildBridgePermissionState,
  buildPersistentPermissionPatch,
  normalizePersistentPermissionKeys,
  readOrbSettings,
  writeOrbSettings,
  type OrbSettings,
  type PersistentPermissionKey,
} from '@/platform/settingsStorage';
import type { ApprovalRequest, ApprovalResolver, ApprovalResolution } from '../types';
import { isApprovalDecisionApproved, normalizeApprovalDecision } from '../utils/approvals';

export interface ResolveApprovalOptions {
  timedOut?: boolean;
}

export interface ApprovalController {
  approvalRequests: ApprovalRequest[];
  setApprovalRequests: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
  approvalResolversRef: React.MutableRefObject<Map<string, ApprovalResolver>>;
  approvalTimeoutsRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  resolveApprovalRequest(
    requestId: string,
    decision?: string,
    options?: ResolveApprovalOptions,
  ): Promise<void>;
  resolveQuestionRequest(requestId: string, answer: string, options?: ResolveApprovalOptions): void;
  clearApprovalRequests(resolution?: Partial<ApprovalResolution>): void;
}

/**
 * Coordinates approval controller state and side effects for the React feature that
 * consumes this hook.
 */

export function useApprovalController(
  setStatus: React.Dispatch<React.SetStateAction<string>>,
): ApprovalController {
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const approvalResolversRef = useRef(new Map<string, ApprovalResolver>());
  const approvalTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const transientPermissionKeysRef = useRef(new Set<PersistentPermissionKey>());

  const syncBridgePermissions = async (settings: OrbSettings): Promise<void> => {
    const updateBridgePermissions = window.orbitDesktop?.security?.updateBridgePermissions;
    if (!updateBridgePermissions) throw new Error('The trusted desktop permission bridge is unavailable.');
    const permissions = {
      ...buildBridgePermissionState(settings),
      screenCapture: settings.permissions_screen_capture === true,
    };
    const result = await (updateBridgePermissions as unknown as (permissions: typeof permissions) => Promise<{ ok: boolean; error?: string }>)(permissions);
    if (result?.ok === false) throw new Error(result.error || 'The trusted bridge rejected the permission change.');
  };

  const restorePersistedBridgePermissions = (): void => {
    if (!transientPermissionKeysRef.current.size) return;
    transientPermissionKeysRef.current.clear();
    void syncBridgePermissions(readOrbSettings()).catch(() => {
      setStatus('Temporary permission cleanup failed; review permissions in Settings.');
    });
  };

  // Clears approval requests without disturbing unrelated application state.
  const clearApprovalRequests = (resolution: Partial<ApprovalResolution> = {}): void => {
    approvalResolversRef.current.forEach((resolve) => {
      try {
        resolve({ approved: false, decision: 'deny', ...resolution });
      } catch {
        // Ignore stale resolver errors during cleanup.
      }
    });
    approvalResolversRef.current.clear();
    approvalTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    approvalTimeoutsRef.current.clear();
    setApprovalRequests([]);
    restorePersistedBridgePermissions();
  };

  useEffect(() => {
    void syncBridgePermissions(readOrbSettings()).catch(() => {
      setStatus('Desktop permissions could not be synchronized.');
    });
  }, []);

  useEffect(
    () => () => {
      approvalResolversRef.current.forEach((resolve) => {
        try {
          resolve({ approved: false, decision: 'deny' });
        } catch {
          // Ignore stale resolver errors on teardown.
        }
      });
      approvalResolversRef.current.clear();
      approvalTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      approvalTimeoutsRef.current.clear();
      restorePersistedBridgePermissions();
    },
    [],
  );

  // Resolves approval request from the available configuration and runtime context.
  const resolveApprovalRequest = async (
    requestId: string,
    decision = 'deny',
    options: ResolveApprovalOptions = {},
  ): Promise<void> => {
    const timedOut = options.timedOut === true;
    const normalizedDecision = normalizeApprovalDecision(decision);
    const request = approvalRequests.find((item) => item.id === requestId) || null;
    const requestType = String(request?.requestType || 'permission').toLowerCase();
    const permissionKeys = normalizePersistentPermissionKeys(request?.permissionKeys);
    const explicitPermissionDecision =
      requestType === 'permission' &&
      permissionKeys.length > 0 &&
      (normalizedDecision === 'allow_once' || normalizedDecision === 'allow_always');
    let approved = isApprovalDecisionApproved(normalizedDecision) || explicitPermissionDecision;

    if (approved && explicitPermissionDecision) {
      const current = readOrbSettings();
      const requestedPatch = buildPersistentPermissionPatch(permissionKeys);
      const transientKeys = Array.from(transientPermissionKeysRef.current);
      const activePatch = buildPersistentPermissionPatch([...transientKeys, ...permissionKeys]);
      const activeSettings = { ...current, ...activePatch } as OrbSettings;
      try {
        await syncBridgePermissions(activeSettings);
        if (normalizedDecision === 'allow_always') {
          writeOrbSettings({ ...current, ...requestedPatch });
        } else {
          for (const key of permissionKeys) transientPermissionKeysRef.current.add(key);
        }
      } catch (error) {
        approved = false;
        setStatus(error instanceof Error ? error.message : 'The requested permission could not be enabled.');
      }
    }

    const resolver = approvalResolversRef.current.get(requestId);
    approvalResolversRef.current.delete(requestId);

    const timeoutId = approvalTimeoutsRef.current.get(requestId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      approvalTimeoutsRef.current.delete(requestId);
    }

    setApprovalRequests((previous) => previous.filter((item) => item.id !== requestId));
    if (resolver) resolver({ approved: Boolean(approved), decision: approved ? normalizedDecision : 'deny' });

    if (timedOut) {
      setStatus('Approval request timed out.');
      return;
    }

    if (requestType === 'limit') {
      if (!approved) setStatus('Limit extension denied for this session run.');
      else if (normalizedDecision === 'continue')
        setStatus('Continuing task with one-time limit override.');
      else if (normalizedDecision === 'extend') setStatus('Limit budget extended for this run.');
      else if (normalizedDecision === 'unlimited')
        setStatus('Unlimited session mode enabled for this run.');
      else setStatus('Limit override approved for this run.');
      return;
    }

    if (permissionKeys.length > 0) {
      if (!approved) setStatus('Permission denied.');
      else if (normalizedDecision === 'allow_always') setStatus('Permission enabled in Settings.');
      else setStatus('Permission allowed for this project run.');
      return;
    }

    setStatus(
      approved ? 'Approval granted for this session run.' : 'Approval denied for this session run.',
    );
  };

  // Resolves question request from the available configuration and runtime context.
  const resolveQuestionRequest = (
    requestId: string,
    answer: string,
    options: ResolveApprovalOptions = {},
  ): void => {
    const resolver = approvalResolversRef.current.get(requestId);
    approvalResolversRef.current.delete(requestId);
    const timeoutId = approvalTimeoutsRef.current.get(requestId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      approvalTimeoutsRef.current.delete(requestId);
    }
    setApprovalRequests((previous) => previous.filter((request) => request.id !== requestId));
    if (resolver) resolver({ approved: false, decision: 'answered', answer: String(answer || '') });
    if (options.timedOut)
      setStatus('Question timed out — the agent will continue with its best judgment.');
  };

  return {
    approvalRequests,
    setApprovalRequests,
    approvalResolversRef,
    approvalTimeoutsRef,
    resolveApprovalRequest,
    resolveQuestionRequest,
    clearApprovalRequests,
  };
}
