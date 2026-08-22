/** Registers the live-buffer diagnostics tool on the shared mutable agent catalog. */
import {
  PERMISSION_TIER,
  TOOL_BY_NAME,
  TOOL_CATALOG,
  TOOL_DEFINITIONS,
  type ToolCatalogEntry,
  type ToolDefinition,
} from '@/platform/agent/toolCatalog'

const diagnosticsCheckDefinition: ToolDefinition = {
  name: 'diagnostics.check',
  module: 'Files',
  description:
    'Run the editor built-in diagnostics provider against the authoritative live buffer for one workspace file. Returns structured errors/warnings with locations. Unsupported file types are reported explicitly rather than treated as clean.',
  args: {
    path: 'string — workspace file path to analyze',
    language: 'string (optional) — explicit diagnostics language override when file extension is ambiguous',
    maxDiagnostics: 'number (optional, 1-200; default 80)',
  },
}

export function registerDiagnosticsTool() {
  if (TOOL_BY_NAME[diagnosticsCheckDefinition.name]) return

  TOOL_DEFINITIONS.push(diagnosticsCheckDefinition)
  TOOL_BY_NAME[diagnosticsCheckDefinition.name] = diagnosticsCheckDefinition
  TOOL_CATALOG[diagnosticsCheckDefinition.name] = {
    ...diagnosticsCheckDefinition,
    aliases: [],
    timeoutMs: 30000,
    risky: false,
    permissionKey: 'file_read',
    lean: true,
    subAgentMinTier: PERMISSION_TIER.READ_ONLY,
    subAgentNative: false,
    presentation: {
      kind: 'read',
      icon: 'file',
      moduleIcon: 'files',
      language: 'json',
      actionVerb: 'Diagnosed',
    },
  } satisfies ToolCatalogEntry
}

registerDiagnosticsTool()
