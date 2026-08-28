/**
 * Registers editor-native verification tools without reopening the large inherited catalog.
 *
 * The canonical catalog already owns browser.inspect. This compatibility extension only fills
 * the entry if an older catalog is loaded.
 */
import {
  PERMISSION_TIER,
  TOOL_CATALOG,
  TOOL_DEFINITIONS,
  getToolCatalogEntry,
  type ToolCatalogEntry,
  type ToolDefinition,
} from '@/platform/agent/toolCatalog'

const browserInspectDefinition: ToolDefinition = {
  name: 'browser.inspect',
  module: 'System',
  description:
    'Execute a local browser application in a sandboxed Chromium runtime and return load failures, JavaScript console errors, failed/blocked resources, and a bounded rendered DOM snapshot. Restricted to localhost/loopback URLs.',
  args: {
    url: 'string — local http(s) loopback URL such as http://localhost:3000',
    settleMs: 'number (optional, 100-5000; default 700)',
    timeoutMs: 'number (optional, 1000-30000; default 15000)',
    maxTextChars: 'number (optional, 500-12000; default 6000)',
  },
}

export function registerBrowserInspectionTool() {
  if (getToolCatalogEntry(browserInspectDefinition.name)) return

  TOOL_DEFINITIONS.push(browserInspectDefinition)
  TOOL_CATALOG[browserInspectDefinition.name] = {
    ...browserInspectDefinition,
    aliases: [],
    timeoutMs: 35000,
    risky: false,
    permissionKey: null,
    lean: true,
    subAgentMinTier: PERMISSION_TIER.READ_ONLY,
    subAgentNative: false,
    presentation: {
      kind: 'read',
      icon: 'screen',
      moduleIcon: 'screen',
      language: 'json',
      actionVerb: 'Inspected',
    },
  } satisfies ToolCatalogEntry
}

registerBrowserInspectionTool()
