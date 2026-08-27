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
import { recordAgentEvidence, terminalCommandLikelyMutatesSource } from '@/platform/agent/repetitionAdvisory'
import {
  formatWorkspaceDiagnostics,
  getWorkspaceDiagnosticsSnapshot,
  markWorkspaceDiagnosticsDirty,
} from '@/platform/agent/workspaceDiagnosticsState'
import { evaluateToolAccess } from '@/platform/agent/runtime/capabilityPolicy'
import { assertAllowedTool, assertSafePath } from '@/platform/agent/runtime/safetyPolicy'
import { inspectBrowserRuntime } from '@/platform/browserInspectionBridge'
import { analyzeWorkspaceFile } from '@/platform/workspaceDiagnosticsBridge'
import { createModuleBroker as createLegacyModuleBroker } from '@/platform/agent/runtime/toolBrokerLegacy'
import {
  isHardBlockedTerminalCommand,
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

interface ApprovalExecutionContext {
  toolName: string
  command: string
  cwd: string
}

interface AgentRuntimeContextState {
  lastDiagnosticsRefresh: number
}

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

export function workspaceMutationForResult(toolName: string, args: Record<string, unknown>, result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false
  const record = result as Record<string, unknown>
  if (toolName === 'terminal.exec') {
    return Number(record.exitCode) === 0 && terminalCommandLikelyMutatesSource(args.command)
  }
  return mutationSucceeded(toolName, args, record)
}

function updateMutationEpoch(
  state: VerificationState | null,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
) {
  if (!state) return
  if (workspaceMutationForResult(toolName, args, result)) {
    markVerificationMutation(state)
  }
}

function repetitionScope(options: LegacyBrokerOptions, workspaceRoot: string) {
  const session = options?.settings?.chat_session
  const chatId =
    session && typeof session === 'object' && !Array.isArray(session)
      ? String((session as Record<string, unknown>).id || '').trim()
      : ''
  return `${workspaceRoot}::${chatId || 'workspace'}`
}

async function attachAgentRuntimeContext(
  options: LegacyBrokerOptions,
  runtimeContextState: AgentRuntimeContextState,
  workspaceRoot: string,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
) {
  if (!workspaceRoot || !result || typeof result !== 'object' || Array.isArray(result)) return result

  const workspaceMutated = workspaceMutationForResult(toolName, args, result)
  if (workspaceMutated) markWorkspaceDiagnosticsDirty(workspaceRoot)

  const repetitionAdvisory = recordAgentEvidence({
    scope_id: repetitionScope(options, workspaceRoot),
    tool_name: toolName,
    args,
    workspace_mutated: workspaceMutated,
  })

  let snapshot = null
  let diagnosticsError = ''
  try {
    snapshot = await getWorkspaceDiagnosticsSnapshot(workspaceRoot)
  } catch (error) {
    diagnosticsError = error instanceof Error ? error.message : String(error || 'Workspace diagnostics failed')
  }

  const snapshotChanged = Boolean(snapshot && snapshot.refreshed_at !== runtimeContextState.lastDiagnosticsRefresh)
  if (snapshotChanged && snapshot) runtimeContextState.lastDiagnosticsRefresh = snapshot.refreshed_at
  const diagnosticSummary = snapshot
    ? `Workspace diagnostics: ${snapshot.counts.errors} error${snapshot.counts.errors === 1 ? '' : 's'} · ${snapshot.counts.warnings} warning${snapshot.counts.warnings === 1 ? '' : 's'}${snapshot.complete ? '' : ' (scan incomplete)'}.`
    : diagnosticsError
      ? `Workspace diagnostics unavailable: ${diagnosticsError}`
      : ''
  const agentRuntimeUpdate = [diagnosticSummary, repetitionAdvisory].filter(Boolean).join(' ')
  const resultRecord = { ...(result as Record<string, unknown>) }
  delete resultRecord.agentRuntimeUpdate
  delete resultRecord.agentRuntimeContext

  return {
    ...resultRecord,
    ...(agentRuntimeUpdate ? { agentRuntimeUpdate } : {}),
    agentRuntimeContext: {
      ...(repetitionAdvisory ? { repetitionAdvisory } : {}),
      ...(snapshot
        ? {
            workspaceDiagnostics: {
              refreshedAt: snapshot.refreshed_at,
              analyzedFiles: snapshot.analyzed_files,
              diagnosticFiles: snapshot.diagnostic_files,
              counts: snapshot.counts,
              complete: snapshot.complete,
              ...(snapshotChanged ? { report: formatWorkspaceDiagnostics(snapshot) } : {}),
            },
          }
        : diagnosticsError
          ? { workspaceDiagnostics: { unavailable: true, message: diagnosticsError } }
          : {}),
    },
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

function withApprovalExecutionContext(options: LegacyBrokerOptions, context: ApprovalExecutionContext) {
  const onApprovalRequest = options?.onApprovalRequest
  if (typeof onApprovalRequest !== 'function') return options

  return {
    ...options,
    onApprovalRequest: (request: Record<string, unknown>) => {
      const record = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const command = String(record.command || context.command || '').trim()
      const cwd = String(record.cwd || context.cwd || '').trim()
      const tool = String(record.tool || record.requestedTool || context.toolName || '').trim()
      return onApprovalRequest({
        ...record,
        ...(tool ? { tool } : {}),
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
      })
    },
  }
}

async function requestWorkspaceEscapeApproval(options: LegacyBrokerOptions, toolName: string, description: string) {
  if (typeof options?.onApprovalRequest !== 'function') return false
  const response = await options.onApprovalRequest({
    requestType: 'approval',
    reason: `${toolName} is attempting to access outside the open project workspace.`,
    requestedAction: description,
    requestedTool: toolName,
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
  const workspaceRoot = String(options?.settings?.agent_working_dir || '').trim()
  const approvalState = options?.approvalState || {}
  const approvalContext: ApprovalExecutionContext = {
    toolName: '',
    command: '',
    cwd: workspaceRoot,
  }
  const runtimeContextState: AgentRuntimeContextState = { lastDiagnosticsRefresh: 0 }
  const contextualOptions = withApprovalExecutionContext(options, approvalContext)
  const legacy = createLegacyModuleBroker(contextualOptions)
  const workspaceAutonomousLegacy = createLegacyModuleBroker({
    ...contextualOptions,
    settings: {
      ...(contextualOptions?.settings || {}),
      agent_require_explicit_approval: false,
    },
    approvalState: {
      ...approvalState,
      granted: true,
      allowAllPackagesForSession: true,
      allowAllSitesForSession: true,
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
      approvalContext.toolName = toolName
      approvalContext.command = String(args.command || '').trim()
      approvalContext.cwd = String(args.cwd || workspaceRoot || '').trim()

      if (toolName === 'approval.request' && automaticMode) {
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
          approved: false,
          decision: 'autonomous',
          instruction:
            'Do not ask the user to approve routine project work in Automatic mode. Attempt the intended tool action directly. The runtime safety policy will surface a specific approval only if the real action crosses the workspace boundary or another privileged safety boundary.',
        })
      }

      if (toolName === 'user.ask' && automaticMode) {
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
          answered: false,
          decision: 'autonomous',
          answer: '',
          instruction:
            'Automatic mode does not interrupt the user for implementation preferences. Choose the best reasonable option yourself and continue.',
        })
      }

      if (
        toolName === 'screen.capabilities' &&
        automaticMode &&
        options?.settings?.permissions_screen_capture !== true
      ) {
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
          available: false,
          denied: true,
          instruction: 'Screen access is not enabled. Continue without asking the user for screen permission.',
        })
      }

      if (!editorNativeTools.has(toolName)) {
        let broker = legacy

        if (workspaceRoot && workspaceFileTools.has(toolName)) {
          const targetPath = String(args.path || '.')
          if (!isWorkspacePath(targetPath, workspaceRoot)) {
            const approved = await requestWorkspaceEscapeApproval(
              contextualOptions,
              toolName,
              `${toolName} ${targetPath}`,
            )
            if (!approved) {
              return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
                error: 'Workspace boundary access was denied. Continue using files inside the open project.',
                denied: true,
              })
            }
            if (automaticMode) broker = workspaceAutonomousLegacy
          } else if (automaticMode) {
            broker = workspaceAutonomousLegacy
          }
        }

        if (toolName === 'terminal.exec') {
          if (isHardBlockedTerminalCommand(args.command)) {
            throw new Error('Command blocked by safety policy and cannot be approved.')
          }

          if (workspaceRoot && terminalCommandEscapesWorkspace(args.command, workspaceRoot, args.cwd)) {
            const approved = await requestWorkspaceEscapeApproval(
              contextualOptions,
              toolName,
              String(args.command || 'terminal command'),
            )
            if (!approved) {
              return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
                error: 'Workspace boundary command was denied. Continue with a project-scoped alternative.',
                denied: true,
              })
            }
            if (automaticMode) broker = workspaceAutonomousLegacy
          } else if (automaticMode && workspaceRoot) {
            broker = workspaceAutonomousLegacy
          }
        }

        const result = await broker.execute(toolName, args)
        updateMutationEpoch(state, toolName, args, result)
        const candidateResult = attachVerificationCandidate(state, toolName, args, result)
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, candidateResult)
      }

      assertEditorNativeAccess(toolName, options)

      if (toolName === 'verification.require') {
        if (!state) throw new Error('No verification state is active for this project run.')
        const result = declareVerificationRequirements(
          state,
          args.kinds || args.requirements,
          String(args.mode || 'replace').toLowerCase(),
        )
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, result)
      }

      if (toolName === 'verification.record') {
        if (!state) throw new Error('No verification state is active for this project run.')
        const result = recordVerificationEvidence(state, args.kind || args.requirement, args.candidateId || args.candidate_id)
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, result)
      }

      if (toolName === 'browser.inspect') {
        const url = String(args.url || '').trim()
        if (!url) throw new Error('browser.inspect requires a local loopback URL.')
        const result = await inspectBrowserRuntime(url, {
          settle_ms: Number(args.settleMs || args.settle_ms) || undefined,
          timeout_ms: Number(args.timeoutMs || args.timeout_ms) || undefined,
          max_text_chars: Number(args.maxTextChars || args.max_text_chars) || undefined,
        })
        const candidateResult = attachVerificationCandidate(state, toolName, args, result)
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, candidateResult)
      }

      const path = assertSafePath(String(args.path || ''), {
        operation: 'read',
        settings: options?.settings,
      })
      const result = await analyzeWorkspaceFile(path, {
        language: String(args.language || '').trim() || undefined,
        max_diagnostics: Number(args.maxDiagnostics || args.max_diagnostics) || undefined,
      })
      const candidateResult = attachVerificationCandidate(state, toolName, args, result)
      return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, candidateResult)
    },
    verificationState() {
      const state = verificationState(options)
      return state ? evaluateVerificationGate(state) : null
    },
  }
}