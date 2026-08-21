/**
 * Coordinates chat loading, message submission, agent execution, persistence, slash
 * commands, approvals, questions, artifacts, and active-run state for ChatPanel.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, TimelineEventData } from '../types';
import { useApprovalController } from './useApprovalController';
import { useChatDesktopLayout } from './useChatDesktopLayout';
import { useChatScrollController } from './useChatScrollController';

export interface ChatPanelControllerOptions {
  messages: ChatMessage[];
  isLoading: boolean;
  pendingTimeline: TimelineEventData[];
  consoleOpen: boolean;
  artifactOpen?: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
}

// Coordinates chat panel controller state and side effects for the React feature that consumes this
// hook.
export function useChatPanelController(options: ChatPanelControllerOptions) {
  const approvals = useApprovalController(options.setStatus);
  const scroll = useChatScrollController({
    messageCount: options.messages.length,
    timelineCount: options.pendingTimeline.length,
    isLoading: options.isLoading,
  });
  const isWideViewport = useChatDesktopLayout({
    approvalCount: approvals.approvalRequests.length,
    consoleOpen: options.consoleOpen,
    artifactOpen: options.artifactOpen,
    isLoading: options.isLoading,
    messages: options.messages,
    pendingTimeline: options.pendingTimeline,
  });

  return { approvals, scroll, isWideViewport };
}
