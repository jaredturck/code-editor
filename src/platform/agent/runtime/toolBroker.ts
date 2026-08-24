/**
 * Small policy/extension facade in front of the inherited tool broker.
 *
 * New editor-native tools belong here when they can be expressed without reopening the
 * legacy 130k-line dispatcher. Existing behavior remains in toolBrokerLegacy and is
 * re-exported for compatibility while the runtime is modernized incrementally.
 */
export * from '@/platform/agent/runtime/toolBrokerLegacy'

import '@/platform/agent/browserToolExtension'
import '@/platform/agent/diagnosticsToolExtension'
import '@/platform/agent/verificationToolExtension'
import { withEditorNativeToolScope } from '@/platform/agent/editorNativeToolScope'
import {
  addVerificationCandidate,
  declareVerificationRequirements,
  evaluateVerificationGate,
  markVerificationMutation,
  recordVerificationEvidence,
  type VerificationState,
} from '@/platform/agent/verificationEvidence'
import { evaluateToolAccess } from '@/platform/agent/runtime/capabilityPolicy'
import { assertAllowedTool, assertSafePath } from '@/platform/agent/runtime/safetyPolicy'
import { inspectBrowserRuntime } from '@/platform/browserInspectionBridge'
import { analyzeWorkspaceFile } from '@/platform/workspaceDiagnosticsBridge'
import { createModuleBroker as createLegacyModuleBroker } from '@/platform/agent/runtime/toolBrokerLegacy'
import {
  isHardBlockedTerminalCommand,
  isWorkspaceAutonomousCommand,
  isWorkspacePath,
  terminalCommandEscapesWorkspace,
} from '@/platform/agent/runtime/readOnlyTerminalPolicy'

const editorNativeTools = new Set([
  'browser.inspect',
  'diagnostics.check',
  'verification.require',
  'verification.record',
])

const workspaceFileTools = new Set([
  'files.list',
  'files.find',
  'files.read',
  'files.write',
  'files.edit',
  'files.patch',
])

type LegacyBrokerOptions = Parameters<typeof createLegacyModuleBroker>[0]

function verificationState(options: LegacyBrokerOptions) {
  const state = options?.settings?.agent_verification_state
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  return state as VerificationState
}

function mutationSucceeded(toolName: string, args: Record<string, unknown>, result: Record<string, unknown>) {
  if (toolName === 'files.write') return result.saved !== false
  if (toolName === 'files.edit') return result.applied === true
  if (toolName === 'files.patch') return args.dryRun !== true && result.applied !== false
  return false
}

function attachVerificationCandidate(
  state: VerificationState | null,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
) {
  if (!state || !result || typeof result !== 'object' || Array.isArray(result)) return result
  const candidate = addVerificationCandidate(state, toolName, args, result as Record<string, unknown>)
  if (!candidate) return result
  return {
    ...(result as Record<string, unknown>),
    verificationCandidateId: candidate.id,
    verificationStatus: candidate.status,
  }
}

function updateMutationEpoch(
  state: VerificationState | null,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
) {
  if (!state || !result || typeof result !== 'object' || Array.isArray(result)) return
  if (mutationSucceeded(toolName, args, result as Record<string, unknown>)) {
    markVerificationMutation(state)
  }
}

function assertEditorNativeAccess(toolName: string, options: LegacyBrokerOptions) {
  assertAllowedTool(toolName)
  const approvalState = options?.approvalState || {}
  const access = evaluateToolAccess(toolName, {
    settings: withEditorNativeToolScope(options?.settings),
    safetyConfig: options?.safetyConfig,
    userApprovalGranted: Boolean(approvalState.granted),
    sessionPermissionOverrides: approvalState.sessionPermissionOverrides,
  })
  if (!access.available) {
    throw new Error(access.reason || `Tool is not available in this runtime: ${toolName}`)
  }
}

function approvalGranted(response: unknown) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false
  const result = response as Record<string, unknown>
  if (result.approved === true) return true
  return ['approve', 'approved', 'allow', 'allow_once', 'continue', 'yes'].includes(
    String(result.decision || result.choice || '').toLowerCase(),
  )
}

async function requestWorkspaceEscapeApproval(
  options: LegacyBrokerOptions,
  toolName: string,
  description: string,
) {
  if (typeof options?.onApprovalRequest !== 'function') return false
  const response = await options.onApprovalRequest({
    requestType: 'approval',
    reason: `${toolName} is attempting to access outside the open project workspace.`,
    requestedAction: description,
    tool: toolName,
    recommendedDecision: 'deny',
    options: [
      {
        id: 'approve',
        label: 'Approve',
        description: 'Allow this one workspace-boundary exception.',
        recommended: false,
      },
      {
        id: 'deny',
        label: 'Deny',
        description: 'Keep the agent inside the current project.',
        recommended: true,
      },
    ],
  })
  return approvalGranted(response)
}

export function createModuleBroker(options: LegacyBrokerOptions) {
  const legacy = createLegacyModuleBroker(options)
  const workspaceRoot = String(options?.settings?.agent_working_dir || '').trim()
  const approvalState = options?.approvalState || {}
  const workspaceAutonomousLegacy = createLegacyModuleBroker({
    ...options,
    settings: {
      ...(options?.settings || {}),
      agent_package_install_guard: false,
      agent_require_explicit_approval: false,
    },
    approvalState: {
      ...approvalState,
      granted: true,
      sessionPermissionOverrides: {
        ...(approvalState.sessionPermissionOverrides || {}),
        file_read: true,
        file_write: true,
        terminal_exec: true,
      },
    },
  })

  return {
    ...legacy,
    async execute(toolName: string, args: Record<string, unknown> = {}) {
      const state = verificationState(options)
      const automaticMode = String(options?.settings?.agent_project_run_mode || 'automatic') !== 'plan_first'

      if (toolName === 'user.ask' && automaticMode) {
        return {
          answered: false,
          decision: 'autonomous',
          answer: '',
          instruction:
            'Automatic mode does not interrupt the user for implementation preferences. Choose the best reasonable option yourself and continue.',
        }
      }

      if (!editorNativeTools.has(toolName)) {
        let broker = legacy

        if (workspaceRoot && workspaceFileTools.has(toolName)) {
          const targetPath = String(args.path || '.')
          if (isWorkspacePath(targetPath, workspaceRoot)) {
            broker = workspaceAutonomousLegacy
          } else {
            const approved = await requestWorkspaceEscapeApproval(options, toolName, `${toolName} ${targetPath}`)
            if (!approved) {
              return {
                error: 'Workspace boundary access was denied. Continue using files inside the open project.',
                denied: true,
              }
            }
            broker = workspaceAutonomousLegacy
          }
        }

        if (toolName === 'terminal.exec') {
          if (isHardBlockedTerminalCommand(args.command)) {
            throw new Error('Command blocked by safety policy and cannot be approved.')
          }

          if (workspaceRoot && terminalCommandEscapesWorkspace(args.command, workspaceRoot, args.cwd)) {
            const approved = await requestWorkspaceEscapeApproval(
              options,
              toolName,
              String(args.command || 'terminal command'),
            )
            if (!approved) {
              return {
                error: 'Workspace boundary command was denied. Continue with a project-scoped alternative.',
                denied: true,
              }
            }
            broker = workspaceAutonomousLegacy
          } else if (workspaceRoot && isWorkspaceAutonomousCommand(args.command, workspaceRoot, args.cwd)) {
            broker = workspaceAutonomousLegacy
          }
        }

        const result = await broker.execute(toolName, args)
        updateMutationEpoch(state, toolName, args, result)
        return attachVerificationCandidate(state, toolName, args, result)
      }

      assertEditorNativeAccess(toolName, options)

      if (toolName === 'verification.require') {
        if (!state) throw new Error('No verification state is active for this project run.')
        return declareVerificationRequirements(
          state,
          args.kinds || args.requirements,
          String(args.mode || 'replace').toLowerCase(),
        )
      }

      if (toolName === 'verification.record') {
        if (!state) throw new Error('No verification state is active for this project run.')
        return recordVerificationEvidence(state, args.kind || args.requirement, args.candidateId || args.candidate_id)
      }

      if (toolName === 'browser.inspect') {
        const url = String(args.url || '').trim()
        if (!url) throw new Error('browser.inspect requires a local loopback URL.')
        const result = await inspectBrowserRuntime(url, {
          settle_ms: Number(args.settleMs || args.settle_ms) || undefined,
          timeout_ms: Number(args.timeoutMs || args.timeout_ms) || undefined,
          max_text_chars: Number(args.maxTextChars || args.max_text_chars) || undefined,
        })
        return attachVerificationCandidate(state, toolName, args, result)
      }

      const path = assertSafePath(String(args.path || ''), {
        operation: 'read',
        settings: options?.settings,
      })
      const result = await analyzeWorkspaceFile(path, {
        language: String(args.language || '').trim() || undefined,
        max_diagnostics: Number(args.maxDiagnostics || args.max_diagnostics) || undefined,
      })
      return attachVerificationCandidate(state, toolName, args, result)
    },
    verificationState() {
      const state = verificationState(options)
      return state ? evaluateVerificationGate(state) : null
    },
  }
}
