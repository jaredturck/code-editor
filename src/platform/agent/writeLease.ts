export interface AgentWriteLease {
  path: string
  owner_id: string
  task_id: string
  acquired_at: number
  updated_at: number
  expires_at: number
}

export interface AcquireWriteLeaseOptions {
  ttl_ms?: number
  now?: number
}

const DEFAULT_WRITE_LEASE_TTL_MS = 5 * 60 * 1000
const MAX_WRITE_LEASE_TTL_MS = 30 * 60 * 1000
const write_leases = new Map<string, AgentWriteLease>()

function normalize_lease_path(file_path: string) {
  return String(file_path || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function normalized_ttl(value: unknown) {
  const requested = Number(value)
  if (!Number.isFinite(requested)) return DEFAULT_WRITE_LEASE_TTL_MS
  return Math.max(5_000, Math.min(MAX_WRITE_LEASE_TTL_MS, Math.round(requested)))
}

function prune_expired_write_leases(now = Date.now()) {
  for (const [path, lease] of write_leases) {
    if (lease.expires_at <= now) write_leases.delete(path)
  }
}

export function acquireAgentWriteLease(
  file_path: string,
  owner_id: string,
  task_id: string,
  options: AcquireWriteLeaseOptions = {},
): AgentWriteLease {
  const path = normalize_lease_path(file_path)
  const owner = String(owner_id || '').trim()
  const task = String(task_id || '').trim()
  if (!path) throw new Error('A file path is required to acquire a write lease.')
  if (!owner) throw new Error('An agent owner id is required to acquire a write lease.')
  if (!task) throw new Error('A task id is required to acquire a write lease.')

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  prune_expired_write_leases(now)
  const current = write_leases.get(path)

  if (current && (current.owner_id !== owner || current.task_id !== task)) {
    throw new Error(
      `Write lease conflict for ${file_path}: owned by ${current.owner_id} (task ${current.task_id}). Wait for that task to finish or coordinate a handoff before editing this file.`,
    )
  }

  const ttl_ms = normalized_ttl(options.ttl_ms)
  const next: AgentWriteLease = current
    ? {
        ...current,
        updated_at: now,
        expires_at: now + ttl_ms,
      }
    : {
        path,
        owner_id: owner,
        task_id: task,
        acquired_at: now,
        updated_at: now,
        expires_at: now + ttl_ms,
      }

  write_leases.set(path, next)
  return { ...next }
}

export function releaseAgentWriteLease(file_path: string, owner_id: string, task_id: string) {
  const path = normalize_lease_path(file_path)
  const current = write_leases.get(path)
  if (!current) return false
  if (current.owner_id !== String(owner_id || '').trim()) return false
  if (current.task_id !== String(task_id || '').trim()) return false
  write_leases.delete(path)
  return true
}

export function releaseTaskWriteLeases(task_id: string) {
  const task = String(task_id || '').trim()
  if (!task) return 0
  let released = 0
  for (const [path, lease] of write_leases) {
    if (lease.task_id !== task) continue
    write_leases.delete(path)
    released += 1
  }
  return released
}

export function releaseOwnerWriteLeases(owner_id: string) {
  const owner = String(owner_id || '').trim()
  if (!owner) return 0
  let released = 0
  for (const [path, lease] of write_leases) {
    if (lease.owner_id !== owner) continue
    write_leases.delete(path)
    released += 1
  }
  return released
}

export function listAgentWriteLeases(now = Date.now()) {
  prune_expired_write_leases(now)
  return [...write_leases.values()].map((lease) => ({ ...lease }))
}

export function clearAgentWriteLeases() {
  write_leases.clear()
}
