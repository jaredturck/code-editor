/**
 * Small policy/extension facade in front of the inherited tool broker.
 *
 * New editor-native tools belong here when they can be expressed without reopening the
 * legacy dispatcher. Existing behavior remains in toolBrokerLegacy and is re-exported for
 * compatibility while project execution moves to objective runtime policy.
 */
export * from '@/platform/agent/runtime/toolBrokerLegacy'

import '@/platform/agent/browserToolExtension'
import '@/platform/agent/diagnosticsToolExtension'
import { withEditorNativeToolScope } from '@/platform/agent/editorNativeToolScope'
import {
  addVerificationCandidate,
  evaluateVerificationGate,
  markVerificationMutation,
  type VerificationState,
} from '@/platform/agent/verificationEvidence'
import {
  recordAgentEvidence,
  repeatedAgentEvidenceBlock,
  terminalCommandLikelyMutatesSource,
} from '@/platform/agent/repetitionAdvisory'
import {
  formatWorkspaceDiagnostics,
  getWorkspaceDiagnosticsSnapshot,
  markWorkspaceDiagnosticsDirty,
} from '@/platform/agent/workspaceDiagnosticsState'
import { evaluateToolAccess } from '@/platform/agent/runtime/capabilityPolicy'
import { assertAllowedTool, assertSafePath } from '@/platform/agent/runtime/safetyPolicy'
import { inspectBrowserRuntime } from '@/platform/browserInspectionBridge'
import { generateProjectImage } from '@/platform/imageGenerationBridge'
import { analyzeWorkspaceFile } from '@/platform/workspaceDiagnosticsBridge'
import { createModuleBroker as createLegacyModuleBroker } from '@/platform/agent/runtime/toolBrokerLegacy'
import {
  isHardBlockedTerminalCommand,
  isWorkspacePath,
  terminalCommandEscapesWorkspace,
} from '@/platform/agent/runtime/readOnlyTerminalPolicy'

const editorNativeTools = new Set(['browser.inspect', 'diagnostics.check', 'image.generate'])

const workspaceFileTools = new Set([
  'files.list',
  'files.find',
  'files.read',
  'files.write',
  'files.edit',
  'files.patch',
])

const workspaceMutationFileTools = new Set(['files.write', 'files.edit', 'files.patch'])

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
  if (toolName === 'files.write') return result.saved === true || result.dirty === true
  if (toolName === 'files.edit') return result.applied === true
  if (toolName === 'files.patch') return args.dryRun !== true && result.applied !== false
  if (toolName === 'image.generate') return result.saved === true
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
  if (workspaceMutationForResult(toolName, args, result)) markVerificationMutation(state)
}

function repetitionScope(options: LegacyBrokerOptions, workspaceRoot: string) {
  const session = options?.settings?.chat_session
  const chatId =
    session && typeof session === 'object' && !Array.isArray(session)
      ? String((session as Record<string, unknown>).id || '').trim()
      : ''
  return `${workspaceRoot}::${chatId || 'workspace'}`
}

function assertNoRepeatedEvidence(
  options: LegacyBrokerOptions,
  workspaceRoot: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  if (!workspaceRoot) return
  const block = repeatedAgentEvidenceBlock({
    scope_id: repetitionScope(options, workspaceRoot),
    tool_name: toolName,
    args,
  })
  if (block) throw new Error(block)
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
  if (workspaceMutated && toolName !== 'image.generate') {
    const mutationPath = workspaceMutationFileTools.has(toolName)
      ? String((result as Record<string, unknown>).path || '')
      : ''
    markWorkspaceDiagnosticsDirty(workspaceRoot, mutationPath)
  }

  const repetitionAdvisory = recordAgentEvidence({
    scope_id: repetitionScope(options, workspaceRoot),
    tool_name: toolName,
    args,
    workspace_mutated: workspaceMutated,
  })

  const shouldRefreshDiagnostics = (workspaceMutated && toolName !== 'image.generate') || toolName === 'diagnostics.check'
  let snapshot = null
  let diagnosticsError = ''
  if (shouldRefreshDiagnostics) {
    try {
      snapshot = await getWorkspaceDiagnosticsSnapshot(workspaceRoot)
    } catch (error) {
      diagnosticsError = error instanceof Error ? error.message : String(error || 'Workspace diagnostics failed')
    }
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
    ...(repetitionAdvisory || snapshot || diagnosticsError
      ? {
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
      : {}),
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
  if (!access.available) throw new Error(access.reason || `Tool is not available in this runtime: ${toolName}`)
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

      assertNoRepeatedEvidence(options, workspaceRoot, toolName, args)

      if (toolName === 'approval.request' && automaticMode) {
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
          approved: false,
          decision: 'autonomous',
          instruction: 'Routine project work does not require approval in Automatic mode.',
        })
      }

      if (toolName === 'user.ask' && automaticMode) {
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
          answered: false,
          decision: 'autonomous',
          answer: '',
          instruction: 'Choose a reasonable implementation option from the current evidence.',
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
          instruction: 'Screen access is not enabled. Continue without it.',
        })
      }

      if (!editorNativeTools.has(toolName)) {
        let broker = legacy

        if (workspaceRoot && workspaceFileTools.has(toolName)) {
          const targetPath = String(args.path || '.')
          if (!isWorkspacePath(targetPath, workspaceRoot)) {
            return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
              error: 'Workspace boundary access is blocked. Continue using files inside the open project.',
              denied: true,
            })
          }
          if (automaticMode) broker = workspaceAutonomousLegacy
        }

        if (toolName === 'terminal.exec') {
          if (isHardBlockedTerminalCommand(args.command)) {
            throw new Error('Command blocked by safety policy and cannot be approved.')
          }

          if (workspaceRoot && terminalCommandEscapesWorkspace(args.command, workspaceRoot, args.cwd)) {
            return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, {
              error: 'Workspace boundary command is blocked. Continue with a project-scoped alternative.',
              denied: true,
            })
          }
          if (automaticMode && workspaceRoot) broker = workspaceAutonomousLegacy
        }

        const result = await broker.execute(toolName, args)
        updateMutationEpoch(state, toolName, args, result)
        const candidateResult = attachVerificationCandidate(state, toolName, args, result)
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, candidateResult)
      }

      assertEditorNativeAccess(toolName, options)

      if (toolName === 'image.generate') {
        const path = assertSafePath(String(args.path || ''), {
          operation: 'write',
          settings: options?.settings,
        })
        const prompt = String(args.prompt || '').trim()
        const format = ['square', 'landscape', 'portrait'].includes(String(args.format || ''))
          ? String(args.format) as 'square' | 'landscape' | 'portrait'
          : 'landscape'
        const result = await generateProjectImage(prompt, path, format, workspaceRoot)
        updateMutationEpoch(state, toolName, args, result)
        const record = result && typeof result === 'object' && !Array.isArray(result)
          ? result as Record<string, unknown>
          : {}
        const normalizedResult = {
          ...record,
          path: String(record.relativePath || record.path || path),
        }
        return attachAgentRuntimeContext(options, runtimeContextState, workspaceRoot, toolName, args, normalizedResult)
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
