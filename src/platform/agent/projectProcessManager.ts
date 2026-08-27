import {
  getDevEnvironmentStatus,
  launchLocalCommand,
  startDevEnvironment,
  stopDevEnvironment,
} from '@/platform/desktopBridge'
import { loadProjectLedger, mutateProjectLedger, type ProjectManagedProcess } from '@/platform/agent/projectLedger'

function normalizeProcess(source: Partial<ProjectManagedProcess>): ProjectManagedProcess {
  return {
    id: String(source.id || `process-${Date.now().toString(36)}`),
    kind: source.kind || 'other',
    command: String(source.command || ''),
    cwd: String(source.cwd || ''),
    pid: Number.isFinite(Number(source.pid)) ? Number(source.pid) : null,
    port: Number.isFinite(Number(source.port)) ? Number(source.port) : null,
    status: source.status || 'unknown',
    logPath: String(source.logPath || ''),
    ownerWorkItemId: String(source.ownerWorkItemId || ''),
    updatedAt: Date.now(),
  }
}

function bridgeProcessData(result: any) {
  const source = result && typeof result === 'object' ? result : {}
  return {
    pid: Number.isFinite(Number(source.pid || source.process?.pid)) ? Number(source.pid || source.process?.pid) : null,
    port: Number.isFinite(Number(source.port || source.process?.port)) ? Number(source.port || source.process?.port) : null,
    status: String(source.status || source.process?.status || 'running') as ProjectManagedProcess['status'],
    command: String(source.command || source.process?.command || ''),
    logPath: String(source.logPath || source.log_path || source.process?.logPath || ''),
  }
}

export function listManagedProjectProcesses(chatId: string) {
  return loadProjectLedger(chatId)?.processes || []
}

export function upsertManagedProjectProcess(chatId: string, goal: string, process: Partial<ProjectManagedProcess>) {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    const normalized = normalizeProcess(process)
    const index = ledger.processes.findIndex((candidate) => candidate.id === normalized.id)
    if (index >= 0) ledger.processes[index] = { ...ledger.processes[index], ...normalized, updatedAt: Date.now() }
    else ledger.processes.push(normalized)
    ledger.processes = ledger.processes.slice(-100)
  })
}

export async function startManagedDevServer(
  chatId: string,
  goal: string,
  cwd: string,
  ownerWorkItemId = '',
) {
  const result = await startDevEnvironment(cwd)
  const data = bridgeProcessData(result)
  const process = normalizeProcess({
    id: 'dev-server',
    kind: 'dev-server',
    cwd,
    command: data.command,
    pid: data.pid,
    port: data.port,
    status: data.status === 'failed' ? 'failed' : 'running',
    logPath: data.logPath,
    ownerWorkItemId,
  })
  upsertManagedProjectProcess(chatId, goal, process)
  return { process, result }
}

export async function refreshManagedDevServer(chatId: string, goal: string, cwd: string) {
  const result = await getDevEnvironmentStatus(cwd)
  const data = bridgeProcessData(result)
  const existing = listManagedProjectProcesses(chatId).find((process) => process.id === 'dev-server')
  const process = normalizeProcess({
    ...(existing || {}),
    id: 'dev-server',
    kind: 'dev-server',
    cwd,
    command: data.command || existing?.command || '',
    pid: data.pid,
    port: data.port,
    status: data.status || 'unknown',
    logPath: data.logPath || existing?.logPath || '',
  })
  upsertManagedProjectProcess(chatId, goal, process)
  return { process, result }
}

export async function stopManagedDevServer(chatId: string, goal: string) {
  const result = await stopDevEnvironment()
  const existing = listManagedProjectProcesses(chatId).find((process) => process.id === 'dev-server')
  if (existing) upsertManagedProjectProcess(chatId, goal, { ...existing, status: 'stopped', pid: null, updatedAt: Date.now() })
  return result
}

export async function launchManagedProjectProcess(
  chatId: string,
  goal: string,
  input: {
    id?: string
    kind?: ProjectManagedProcess['kind']
    command: string
    cwd: string
    ownerWorkItemId?: string
  },
) {
  const result = await launchLocalCommand({ command: input.command, category: 'command', cwd: input.cwd })
  const data = bridgeProcessData(result)
  const process = normalizeProcess({
    id: input.id || `process-${Date.now().toString(36)}`,
    kind: input.kind || 'other',
    command: input.command,
    cwd: input.cwd,
    pid: data.pid,
    port: data.port,
    status: data.status === 'failed' ? 'failed' : 'running',
    logPath: data.logPath,
    ownerWorkItemId: input.ownerWorkItemId || '',
  })
  upsertManagedProjectProcess(chatId, goal, process)
  return { process, result }
}

export function markManagedProcessStopped(chatId: string, goal: string, processId: string) {
  return mutateProjectLedger(chatId, goal, (ledger) => {
    ledger.processes = ledger.processes.map((process) =>
      process.id === processId ? { ...process, status: 'stopped', pid: null, updatedAt: Date.now() } : process,
    )
  })
}
