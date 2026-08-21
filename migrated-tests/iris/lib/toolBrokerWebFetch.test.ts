/**
 * Regression coverage for the direct URL fetch dispatch path. The web-fetch bridge client
 * existed before this test, but an early generic fallback in the broker made the handler
 * unreachable and caused every agent call to fail as "not implemented".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as desktopBridge from '@/platform/desktopBridge';
import * as notesStorage from '@/platform/notesStorage';
import { createModuleBroker } from '@/platform/agent/runtime/toolBroker';
import { DEFAULT_ORB_SETTINGS } from '@/platform/settingsStorage';

function createBroker() {
  return createModuleBroker({
    settings: {
      ...DEFAULT_ORB_SETTINGS,
      agent_web_site_guard: false,
    },
    todoTool: {
      list: () => [],
      applyUpdates: () => [],
    },
    traceTool: {
      thinking: vi.fn(),
    },
    safetyConfig: {
      profile: 'strict',
      requireExplicitApproval: false,
      maxSteps: 12,
    },
    approvalState: {
      granted: false,
      sessionPermissionOverrides: {},
      webSiteSessionDomains: new Set<string>(),
      allowAllSitesForSession: false,
    },
    webSearchState: {},
    userInput: 'Read https://example.com/article',
    requestAI: vi.fn(),
    onApprovalRequest: undefined,
    stepHistory: [],
  });
}

describe('tool broker web.fetch dispatch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reaches the existing bridge-backed web.fetch handler', async () => {
    const fetched = {
      url: 'https://example.com/article',
      title: 'Example article',
      content: 'Readable article text',
      charsRead: 21,
    };
    const fetchSpy = vi.spyOn(desktopBridge, 'powerWebFetch').mockResolvedValue(fetched);
    vi.spyOn(notesStorage, 'addNote').mockReturnValue({ id: 'cached-web-note' } as never);

    const result = await createBroker().execute('web.fetch', {
      url: fetched.url,
      extract: 'text',
      maxChars: 4096,
    });

    expect(fetchSpy).toHaveBeenCalledWith(fetched.url, {
      extract: 'text',
      maxChars: 4096,
    });
    expect(result).toEqual(fetched);
  });
});
