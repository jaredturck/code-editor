/**
 * evalRunner.js
 * Offline eval harness (W4). Runs the fixed task suite through an agent session
 * and aggregates the per-run metrics (from buildRunSummary.usage) into the §7
 * efficiency report: tokens/task, cache-hit, native adoption, steps/task,
 * wall-clock, tool reliability, and task success rate.
 *
 * Dependency-injected: the caller passes `runSession` (normally
 * agentRuntime.runAgentSession) and the live `settings`, so this module stays
 * pure and testable and the runtime/provider wiring lives at the call site, where
 * configured credentials and the encrypted desktop bridge are available.
 */
import { EVAL_TASKS, type EvalRunSummary, type EvalSession, type EvalTask } from '@/platform/eval/evalTasks'

export interface EvalResult {
  id: string
  title: string
  ok: boolean
  summary?: EvalRunSummary | null
  error?: string
  durationMs: number
}

export interface EvalReport {
  taskCount: number
  completed: number
  failedToRun: number
  successRate: number
  avgDurationMs: number
  avgPromptTokens: number
  avgCompletionTokens: number
  avgCacheHitRatio: number
  avgNativeAdoption: number
  avgSteps: number
  totalToolFailures: number
  totalInvalidArgErrors: number
  totalRedundantCalls: number
  perTask: Array<{
    id: string
    ok: boolean
    error: string | null
    durationMs: number
    steps: unknown
  }>
  generatedAt: number
}

export interface EvalSessionArguments {
  userInput: string
  conversation: Array<Record<string, unknown>>
  settings: Record<string, unknown>
  abortSignal?: AbortSignal
}

export interface RunEvalSuiteOptions {
  runSession: (args: EvalSessionArguments) => Promise<EvalSession>
  settings: Record<string, unknown>
  tasks?: EvalTask[]
  onProgress?: (id: string, ok: boolean, index: number, total: number) => void
  abortSignal?: AbortSignal
}

function _num(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

// Runs one evaluation check and converts thrown failures into a failed check result.
function _safeCheck(check: EvalTask['check'], session: EvalSession): boolean {
  if (typeof check !== 'function') return true
  try {
    return Boolean(check(session))
  } catch {
    return false
  }
}

/** Average a numeric field across result.summary.usage (skips missing). */
function _avg(values: number[]): number {
  const nums = values.filter((value) => Number.isFinite(value))
  if (!nums.length) return 0
  return nums.reduce((total, value) => total + value, 0) / nums.length
}

/**
 * Aggregate per-task results into a report.
 */
export function aggregateReport(results: EvalResult[]): EvalReport {
  const tasks = Array.isArray(results) ? results : []
  const completed = tasks.filter((result) => !result.error)
  const passed = tasks.filter((result) => result.ok)

  const usages = completed.map((result) => result.summary?.usage || {})
  const summaries = completed.map((result) => result.summary || {})

  return {
    taskCount: tasks.length,
    completed: completed.length,
    failedToRun: tasks.length - completed.length,
    successRate: tasks.length ? Math.round((passed.length / tasks.length) * 100) / 100 : 0,
    avgDurationMs: Math.round(_avg(tasks.map((result) => _num(result.durationMs)))),
    avgPromptTokens: Math.round(_avg(usages.map((usage) => _num(usage.promptTokens ?? usage.lastPromptTokens)))),
    avgCompletionTokens: Math.round(_avg(usages.map((usage) => _num(usage.completionTokens)))),
    avgCacheHitRatio: Math.round(_avg(usages.map((usage) => _num(usage.cacheHitRatio))) * 100) / 100,
    avgNativeAdoption: Math.round(_avg(usages.map((usage) => _num(usage.nativeToolAdoption))) * 100) / 100,
    avgSteps: Math.round(_avg(summaries.map((summary) => _num(summary.stepsAttempted))) * 10) / 10,
    totalToolFailures: summaries.reduce((total, summary) => total + _num(summary.toolFailures), 0),
    totalInvalidArgErrors: summaries.reduce((total, summary) => total + _num(summary.invalidArgErrors), 0),
    totalRedundantCalls: summaries.reduce((total, summary) => total + _num(summary.redundantToolCalls), 0),
    perTask: tasks.map((result) => ({
      id: result.id,
      ok: result.ok,
      error: result.error || null,
      durationMs: result.durationMs,
      steps: result.summary?.stepsAttempted,
    })),
    generatedAt: Date.now(),
  }
}

/**
 * Run the eval suite. Returns the aggregated report.
 */
export async function runEvalSuite({
  runSession,
  settings,
  tasks = EVAL_TASKS,
  onProgress,
  abortSignal,
}: RunEvalSuiteOptions): Promise<EvalReport> {
  if (typeof runSession !== 'function') throw new Error('runEvalSuite requires a runSession function')
  const list = Array.isArray(tasks) ? tasks : []
  const results: EvalResult[] = []

  for (let i = 0; i < list.length; i += 1) {
    if (abortSignal?.aborted) break
    const task = list[i]
    const started = Date.now()
    try {
      const session = await runSession({
        userInput: task.prompt,
        conversation: [],
        settings,
        abortSignal,
      })
      const ok = _safeCheck(task.check, session)
      results.push({
        id: task.id,
        title: task.title,
        ok,
        summary: session?.summary || null,
        durationMs: Date.now() - started,
      })
      onProgress?.(task.id, ok, i + 1, list.length)
    } catch (error) {
      results.push({
        id: task.id,
        title: task.title,
        ok: false,
        error: (error as { message?: string } | null)?.message || 'run failed',
        durationMs: Date.now() - started,
      })
      onProgress?.(task.id, false, i + 1, list.length)
    }
  }

  return aggregateReport(results)
}
