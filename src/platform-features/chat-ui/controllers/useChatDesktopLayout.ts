/**
 * Owns the chat desktop layout state and side effects used by the Chat panel. Extracting
 * this controller keeps the large presentation component from duplicating lifecycle and
 * persistence logic.
 */

import { useEffect, useState } from 'react';
import { isDesktopShellMode } from '@/platform/runtimeMode';
import { setDesktopWindowMode } from '@/platform/desktopShellWindow';
import {
  APPROVAL_FLOAT_EXTRA_WIDTH,
  CONSOLE_FLOAT_BREAKPOINT,
  CONSOLE_FLOAT_WIDTH,
  SIDE_SPLIT_PANEL_WIDTH,
} from '../constants';
import type { ChatMessage, TimelineEventData } from '../types';
import { extractWebVisualizerPoints } from '../utils/timeline';

export interface ChatDesktopLayoutOptions {
  approvalCount: number;
  consoleOpen: boolean;
  artifactOpen?: boolean;
  isLoading: boolean;
  messages: ChatMessage[];
  pendingTimeline: TimelineEventData[];
}

/**
 * Coordinates chat desktop layout state and side effects for the React feature that
 * consumes this hook.
 */

export function useChatDesktopLayout({
  approvalCount,
  consoleOpen,
  artifactOpen = false,
  isLoading,
  messages,
  pendingTimeline,
}: ChatDesktopLayoutOptions): boolean {
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= CONSOLE_FLOAT_BREAKPOINT,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = (): void => setIsWideViewport(window.innerWidth >= CONSOLE_FLOAT_BREAKPOINT);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isDesktopShellMode()) return;

    const latestAssistantMeta = [...messages]
      .reverse()
      .find(
        (message) => message.role === 'assistant' && Array.isArray(message.meta?.timeline),
      )?.meta;
    const persistedTimeline = Array.isArray(latestAssistantMeta?.timeline)
      ? (latestAssistantMeta.timeline as TimelineEventData[])
      : [];
    const sizingTimeline = isLoading ? pendingTimeline : persistedTimeline;
    const wantsArtifactFloat = artifactOpen && isWideViewport;
    const wantsConsoleFloat = consoleOpen && isWideViewport && !wantsArtifactFloat;
    const wantsVisualizerFloat =
      isWideViewport && extractWebVisualizerPoints(sizingTimeline).length > 0;
    const panelCount =
      Number(wantsConsoleFloat || wantsArtifactFloat) + Number(wantsVisualizerFloat);
    const panelWidth = panelCount >= 2 ? SIDE_SPLIT_PANEL_WIDTH : CONSOLE_FLOAT_WIDTH;
    const sideFloatWidth =
      panelCount > 0 ? panelCount * panelWidth + 26 + (panelCount - 1) * 12 : 0;
    const extraWidth = (approvalCount > 0 ? APPROVAL_FLOAT_EXTRA_WIDTH : 0) + sideFloatWidth;
    setDesktopWindowMode('expanded', { extraWidth });
  }, [
    approvalCount,
    consoleOpen,
    artifactOpen,
    isWideViewport,
    isLoading,
    pendingTimeline,
    messages,
  ]);

  return isWideViewport;
}
