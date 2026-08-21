/**
 * Owns the approval controller state and side effects used by the Chat panel. Extracting
 * this controller keeps the large presentation component from duplicating lifecycle and
 * persistence logic.
 */

import { useEffect, useRef, useState } from 'react';
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
  ): void;
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
  };

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
    },
    [],
  );

  // Resolves approval request from the available configuration and runtime context.
  const resolveApprovalRequest = (
    requestId: string,
    decision = 'deny',
    options: ResolveApprovalOptions = {},
  ): void => {
    const timedOut = options.timedOut === true;
    const normalizedDecision = normalizeApprovalDecision(decision);
    const approved = isApprovalDecisionApproved(normalizedDecision);
    const resolver = approvalResolversRef.current.get(requestId);
    approvalResolversRef.current.delete(requestId);

    const timeoutId = approvalTimeoutsRef.current.get(requestId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      approvalTimeoutsRef.current.delete(requestId);
    }

    const resolvedRequest: { current: ApprovalRequest | null } = { current: null };
    setApprovalRequests((previous) => {
      resolvedRequest.current = previous.find((request) => request.id === requestId) || null;
      return previous.filter((request) => request.id !== requestId);
    });

    if (resolver) resolver({ approved: Boolean(approved), decision: normalizedDecision });

    if (timedOut) {
      setStatus('Approval request timed out.');
      return;
    }

    const requestType = String(resolvedRequest.current?.requestType || 'permission').toLowerCase();
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

    const persistentPermission =
      resolvedRequest.current?.persistentPermission === true ||
      (Array.isArray(resolvedRequest.current?.permissionKeys) &&
        resolvedRequest.current.permissionKeys.length > 0);
    if (persistentPermission) {
      setStatus(approved ? 'Permission saved in Settings.' : 'Permission denied.');
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
