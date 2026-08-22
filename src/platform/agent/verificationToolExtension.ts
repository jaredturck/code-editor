import {
  PERMISSION_TIER,
  TOOL_BY_NAME,
  TOOL_CATALOG,
  TOOL_DEFINITIONS,
  type ToolCatalogEntry,
  type ToolDefinition,
} from '@/platform/agent/toolCatalog'

const verificationRequireDefinition: ToolDefinition = {
  name: 'verification.require',
  module: 'Agent',
  description:
    'Declare the verification checks you judge necessary for this development task. Choose project-appropriate requirement names yourself; the runtime does not infer framework-specific checks. Calling again replaces the current requirements unless mode:"add" is used.',
  args: {
    kinds: 'string[] — model-chosen verification requirement names such as tests, typecheck, browser-runtime, or another project-appropriate check',
    mode: 'replace|add (optional, default replace)',
  },
}

const verificationRecordDefinition: ToolDefinition = {
  name: 'verification.record',
  module: 'Agent',
  description:
    'Bind one declared verification requirement to an exact verificationCandidateId returned by terminal.exec, launch.run, browser.inspect, diagnostics.check, or agent.review. The runtime derives pass/fail from the real result; never provide a passed boolean.',
  args: {
    kind: 'string — one currently declared verification requirement',
    candidateId: 'string — exact verificationCandidateId returned by a real verification tool result',
  },
}

function registerDefinition(definition: ToolDefinition) {
  if (TOOL_BY_NAME[definition.name]) return

  TOOL_DEFINITIONS.push(definition)
  TOOL_BY_NAME[definition.name] = definition
  TOOL_CATALOG[definition.name] = {
    ...definition,
    aliases: [],
    timeoutMs: 5000,
    risky: false,
    permissionKey: null,
    lean: true,
    subAgentMinTier: PERMISSION_TIER.STANDARD,
    subAgentNative: false,
    presentation: {
      kind: 'other',
      icon: 'check',
      moduleIcon: 'agent',
      language: 'json',
      actionVerb: 'Verified',
    },
  } satisfies ToolCatalogEntry
}

export function registerVerificationTools() {
  registerDefinition(verificationRequireDefinition)
  registerDefinition(verificationRecordDefinition)
}

registerVerificationTools()
