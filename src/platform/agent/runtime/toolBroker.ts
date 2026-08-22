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
import { isReadOnlyWorkspaceCommand } from '@/platform/agent/runtime/readOnlyTerminalPolicy'

const editorNativeTools = new Set([
  'browser.inspect',
  'diagnostics.check',
  'verification.require',
  'verification.record',
])

function verificationState(options: Record<string, any>) {
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
  const candidate = addVerificationCandidate(
    state,
    toolName,
    args,
    result as Record<string, unknown>,
  )
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

function assertEditorNativeAccess(toolName: string, options: Record<string, any>) {
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

export function createModuleBroker(options: Record<string, any>) {
  const legacy = createLegacyModuleBroker(options)
  const readOnlyTerminalLegacy = createLegacyModuleBroker({
    ...options,
    approvalState: {
      ...(options?.approvalState || {}),
      granted: true,
    },
  })

  return {
    ...legacy,
    async execute(toolName: string, args: Record<string, unknown> = {}) {
      const state = verificationState(options)

      if (!editorNativeTools.has(toolName)) {
        const broker = toolName === 'terminal.exec' && isReadOnlyWorkspaceCommand(args.command)
          ? readOnlyTerminalLegacy
          : legacy
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
        return recordVerificationEvidence(
          state,
          args.kind || args.requirement,
          args.candidateId || args.candidate_id,
        )
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
      return state ? evaluateVerificationGate(state) : null
    },
  }
}
