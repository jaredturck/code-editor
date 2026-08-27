import { resolveAgentIdentity } from '@/platform/agent/agentIdentity'
import { deriveCodeNavigationEvidence, type CodeNavigationEvidence } from '@/platform/agent/codeNavigation'
import {
  loadProjectLedger,
  mutateProjectLedger,
  type ProjectAgentRole,
  type ProjectAgentTaskState,
  type ProjectLedger,
  type ProjectWorkItem,
} from '@/platform/agent/projectLedger'
import {
  checkpointWorkerWorkspace,
  createWorkerWorkspace,
  integrateWorkerCommit,
  projectGitAvailable,
  removeWorkerWorkspace,
  type ProjectWorkerWorkspace,
} from '@/platform/agent/projectWorkspaceManager'
import { resolveActiveSkillProfile } from '@/platform/skillProfiles'
import { buildSTP, type STPTask, type STPTaskType } from '@/platform/stpBuilder'
import { executeSTP } from '@/platform/subAgentRuntime'

export interface ProjectDispatchOptions {
  maxParallel?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ProjectDispatchResult {
  dispatched: number
  completed: number
  failed: number
  ledger: ProjectLedger
  taskIds: string[]
}

interface PreparedWork {
  item: ProjectWorkItem
  task: STPTask
  workspace: ProjectWorkerWorkspace | null
  cwd: string
  navigation: CodeNavigationEvidence
}

function roleForRuntime(role: ProjectAgentRole) {
  if (role === 'planner') return 'orchestrator'
  if (role === 'evaluator') return 'overwatcher'
  return role
}

function stpType(role: ProjectAgentRole): STPTaskType {
  if (role === 'scout') return 'discover'
  if (role === 'evaluator') return 'verify'
  return 'execute'
}

function toolsForRole(role: ProjectAgentRole) {
  if (role === 'scout') return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'search.web', 'web.fetch']
  if (role === 'evaluator') return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'terminal.exec', 'diagnostics.check', 'browser.inspect']
  if (role === 'planner' || role === 'orchestrator') return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'terminal.exec', 'diagnostics.check']
  return ['files.list', 'files.find', 'files.read', 'search.ripgrep', 'files.write', 'files.edit', 'files.patch', 'terminal.exec', 'diagnostics.check', 'browser.inspect']
}

function dependenciesComplete(item: ProjectWorkItem, ledger: ProjectLedger) {
  if (!item.dependsOn.length) return true
  const byId = new Map(ledger.workItems.map((candidate) => [candidate.id, candidate]))
  return item.dependsOn.every((dependency) => byId.get(dependency)?.status === 'done')
}

function requirementContext(item: ProjectWorkItem, ledger: ProjectLedger) {
  const ids = new Set(item.requirementIds)
  return ledger.requirements
    .filter((requirement) => ids.has(requirement.id))
    .map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      status: requirement.status,
      acceptanceCriteria: requirement.acceptanceCriteria,
      evidence: requirement.evidence.slice(-5),
    }))
}

function resultText(result: any) {
  if (!result) return ''
  if (typeof result.output === 'string') return result.output
  if (typeof result.summary === 'string') return result.summary
  if (typeof result.result === 'string') return result.result
  if (result.output && typeof result.output === 'object') return JSON.stringify(result.output)
  return JSON.stringify(result)
}

function taskSucceeded(result: any) {
  return Boolean(result) && ['done', 'success', 'completed'].includes(String(result.status || '').toLowerCase())
}

function availableWork(ledger: ProjectLedger, maxParallel: number) {
  return ledger.workItems
    .filter((item) => ['pending', 'ready'].includes(item.status))
    .filter((item) => dependenciesComplete(item, ledger))
    .sort((left, right) => {
      const roleRank = (role: ProjectAgentRole) => role === 'scout' ? 0 : role === 'executor' ? 1 : role === 'orchestrator' ? 2 : role === 'evaluator' ? 3 : 4
      return roleRank(left.role) - roleRank(right.role) || left.createdAt - right.createdAt
    })
    .slice(0, Math.max(1, maxParallel))
}

function roleSkillProfile(settings: Record<string, any>, runtimeRole: string) {
  if (settings.skills_enabled === false) return []
  const identity = resolveAgentIdentity(runtimeRole, settings)
  const profile = resolveActiveSkillProfile({
    ...settings,
    ai_provider: identity.provider || settings.ai_provider,
    ai_model: identity.model || settings.ai_model,
  })
  return profile ? [profile] : []
}

function buildTask(
  item: ProjectWorkItem,
  ledger: ProjectLedger,
  settings: Record<string, any>,
  cwd: string,
  navigation: CodeNavigationEvidence,
): STPTask {
  const runtimeRole = roleForRuntime(item.role)
  const identity = resolveAgentIdentity(runtimeRole, settings)
  const readOnly = item.role === 'scout' || item.role === 'evaluator'
  return buildSTP({
    type: stpType(item.role),
    goal: item.description || item.title,
    scope: ledger.architectureSummary || ledger.goal,
    constraints: [
      `Work item: ${item.id}`,
      `Project generation: ${ledger.generation}`,
      `Assigned workspace: ${cwd}`,
      readOnly ? 'Do not mutate project files.' : 'Make the requested implementation changes in the assigned workspace.',
      'Do not redo work already recorded as complete.',
      'Return concrete evidence, changed files, failures, and remaining blockers.',
    ],
    tools: {
      available: toolsForRole(item.role),
      preferred: item.role === 'scout' ? ['search.ripgrep', 'files.read'] : ['files.read', 'files.edit', 'terminal.exec'],
    },
    skills: {
      load: roleSkillProfile(settings, runtimeRole),
      variant: item.role === 'scout' || item.role === 'evaluator' ? 'simple' : 'default',
    },
    budget: {
      maxSteps: item.role === 'scout' ? 24 : 48,
      maxTokens: item.role === 'scout' ? 16000 : 40000,
      timeoutMs: item.role === 'scout' ? 20 * 60_000 : 60 * 60_000,
      maxOutputChars: 16000,
    },
    context: {
      projectId: ledger.projectId,
      workItemId: item.id,
      generation: ledger.generation,
      strategyGeneration: ledger.strategyGeneration,
      requirements: requirementContext(item, ledger),
      recentDecisions: ledger.decisions.slice(-12),
      failedApproaches: ledger.failedApproaches.filter((failed) => failed.workItemId === item.id).slice(-6),
      currentStrategy: ledger.currentStrategy,
      workspaceRoot: cwd,
      isolatedWorkspace: item.role === 'executor' && cwd !== String(settings.agent_working_dir || ''),
      codeNavigation: navigation,
    },
    priority: 'normal',
    toAgent: runtimeRole,
    agentIdentity: identity,
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary'],
    },
  })
}

async function prepareWork(
  item: ProjectWorkItem,
  ledger: ProjectLedger,
  settings: Record<string, any>,
  gitAvailable: boolean,
): Promise<PreparedWork> {
  const mainRoot = String(settings.agent_working_dir || '').trim()
  let workspace: ProjectWorkerWorkspace | null = null
  let cwd = mainRoot

  if (item.role === 'executor' && gitAvailable && mainRoot) {
    try {
      workspace = await createWorkerWorkspace(mainRoot, `${ledger.projectId}-${item.id}`)
      cwd = workspace.root
    } catch {
      workspace = null
      cwd = mainRoot
    }
  }

  let navigation: CodeNavigationEvidence = { symbols: [], definitions: [], references: [] }
  try {
    navigation = await deriveCodeNavigationEvidence(cwd, `${item.title}\n${item.description}`)
  } catch {
    // Structural hints are opportunistic and never block task dispatch.
  }

  const preparedItem = { ...item, workspaceId: cwd }
  return {
    item: preparedItem,
    task: buildTask(preparedItem, ledger, settings, cwd, navigation),
    workspace,
    cwd,
    navigation,
  }
}

async function runPreparedWork(prepared: PreparedWork, settings: Record<string, any>, signal?: AbortSignal) {
  const taskSettings = {
    ...settings,
    agent_working_dir: prepared.cwd,
    agent_bounded_automatic: false,
    agent_project_run_mode: 'automatic',
  }
  const result = await executeSTP(prepared.task, taskSettings, () => {}, signal)
  let integrationError = ''
  let checkpoint = ''

  if (prepared.workspace && taskSucceeded(result)) {
    try {
      checkpoint = await checkpointWorkerWorkspace(
        prepared.workspace,
        `IRIS ${prepared.item.role} checkpoint: ${prepared.item.title || prepared.item.id}`,
      )
      if (checkpoint) await integrateWorkerCommit(String(settings.agent_working_dir || ''), checkpoint)
    } catch (error) {
      integrationError = error instanceof Error ? error.message : String(error || 'Worker integration failed')
    }
  }

  if (prepared.workspace) {
    try {
      await removeWorkerWorkspace(String(settings.agent_working_dir || ''), prepared.workspace, true)
    } catch {
      // Cleanup is best-effort in Phase A; stale worktrees can be pruned later.
    }
  }

  return { result, checkpoint, integrationError }
}

export async function dispatchReadyProjectWork(
  chatId: string,
  settings: Record<string, any>,
  options: ProjectDispatchOptions = {},
): Promise<ProjectDispatchResult> {
  const initial = loadProjectLedger(chatId)
  if (!initial) throw new Error('Project orchestration requires an initialized ledger.')
  if (options.signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError')

  const items = availableWork(initial, options.maxParallel ?? 4)
  if (!items.length) return { dispatched: 0, completed: 0, failed: 0, ledger: initial, taskIds: [] }

  const mainRoot = String(settings.agent_working_dir || '').trim()
  const gitAvailable = Boolean(mainRoot && (await projectGitAvailable(mainRoot)))
  const prepared = await Promise.all(items.map((item) => prepareWork(item, initial, settings, gitAvailable)))
  const tasks = prepared.map((entry) => entry.task)
  const taskIds = tasks.map((task) => task.taskId)
  const preparedByWork = new Map(prepared.map((entry) => [entry.item.id, entry]))

  let ledger = mutateProjectLedger(chatId, initial.goal, (draft) => {
    const timestamp = Date.now()
    draft.workItems = draft.workItems.map((item) => {
      const entry = preparedByWork.get(item.id)
      if (!entry) return item
      return {
        ...item,
        status: 'running',
        taskId: entry.task.taskId,
        workspaceId: entry.cwd,
        attempts: item.attempts + 1,
        updatedAt: timestamp,
      }
    })
    const nextStates: ProjectAgentTaskState[] = prepared.map((entry) => {
      const runtimeRole = roleForRuntime(entry.item.role)
      const identity = resolveAgentIdentity(runtimeRole, settings)
      return {
        id: entry.task.taskId,
        role: entry.item.role,
        model: identity.model,
        provider: identity.provider,
        status: 'running',
        workItemId: entry.item.id,
        workspaceId: entry.cwd,
        outputPath: '',
        attempts: entry.item.attempts + 1,
        error: '',
        updatedAt: timestamp,
      }
    })
    draft.agentTasks = [...draft.agentTasks.filter((state) => !taskIds.includes(state.id)), ...nextStates].slice(-500)
  })

  const executions = await Promise.allSettled(prepared.map((entry) => runPreparedWork(entry, settings, options.signal)))
  let completed = 0
  let failed = 0

  ledger = mutateProjectLedger(chatId, ledger.goal, (draft) => {
    const timestamp = Date.now()
    const executionByTask = new Map(prepared.map((entry, index) => [entry.task.taskId, executions[index]]))

    draft.workItems = draft.workItems.map((item) => {
      if (!item.taskId || !taskIds.includes(item.taskId)) return item
      const settled = executionByTask.get(item.taskId)
      const execution = settled?.status === 'fulfilled' ? settled.value : null
      const result = execution?.result
      const integrationError = execution?.integrationError || ''
      const ok = taskSucceeded(result) && !integrationError
      if (ok) completed += 1
      else failed += 1
      return {
        ...item,
        status: ok ? 'done' : 'failed',
        resultSummary: resultText(result).slice(0, 5000),
        blockers: ok
          ? []
          : [
              integrationError ||
                (settled?.status === 'rejected'
                  ? String(settled.reason instanceof Error ? settled.reason.message : settled.reason)
                  : String((result as any)?.error || 'Delegated task failed.')),
            ].slice(0, 20),
        updatedAt: timestamp,
      }
    })

    draft.agentTasks = draft.agentTasks.map((state) => {
      if (!taskIds.includes(state.id)) return state
      const settled = executionByTask.get(state.id)
      const execution = settled?.status === 'fulfilled' ? settled.value : null
      const result = execution?.result
      const ok = taskSucceeded(result) && !execution?.integrationError
      return {
        ...state,
        status: ok ? 'done' : 'failed',
        outputPath: String((result as any)?.outputPath || ''),
        error: ok
          ? ''
          : String(
              execution?.integrationError ||
                (settled?.status === 'rejected'
                  ? settled.reason instanceof Error
                    ? settled.reason.message
                    : settled.reason
                  : (result as any)?.error || 'Delegated task failed.'),
            ).slice(0, 2000),
        updatedAt: timestamp,
      }
    })

    if (completed > 0) {
      draft.generation += 1
      draft.lastProgressAt = timestamp
      draft.lastProgressSummary = `${completed} isolated project task${completed === 1 ? '' : 's'} completed and integrated.`
    }
  })

  return { dispatched: tasks.length, completed, failed, ledger, taskIds }
}
