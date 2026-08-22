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
import { withEditorNativeToolScope } from '@/platform/agent/editorNativeToolScope'
import { evaluateToolAccess } from '@/platform/agent/runtime/capabilityPolicy'
import { assertAllowedTool, assertSafePath } from '@/platform/agent/runtime/safetyPolicy'
import { inspectBrowserRuntime } from '@/platform/browserInspectionBridge'
import { analyzeWorkspaceFile } from '@/platform/workspaceDiagnosticsBridge'
import { createModuleBroker as createLegacyModuleBroker } from '@/platform/agent/runtime/toolBrokerLegacy'

export function createModuleBroker(options: Record<string, any>) {
  const legacy = createLegacyModuleBroker(options)

  return {
    ...legacy,
    async execute(toolName: string, args: Record<string, unknown> = {}) {
      if (toolName !== 'browser.inspect' && toolName !== 'diagnostics.check') {
        return legacy.execute(toolName, args)
      }

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

      if (toolName === 'browser.inspect') {
        const url = String(args.url || '').trim()
        if (!url) throw new Error('browser.inspect requires a local loopback URL.')
        return inspectBrowserRuntime(url, {
          settle_ms: Number(args.settleMs || args.settle_ms) || undefined,
          timeout_ms: Number(args.timeoutMs || args.timeout_ms) || undefined,
          max_text_chars: Number(args.maxTextChars || args.max_text_chars) || undefined,
        })
      }

      const path = assertSafePath(String(args.path || ''), {
        operation: 'read',
        settings: options?.settings,
      })
      return analyzeWorkspaceFile(path, {
        language: String(args.language || '').trim() || undefined,
        max_diagnostics: Number(args.maxDiagnostics || args.max_diagnostics) || undefined,
      })
    },
  }
}
