/**
 * Applies independent burst and concurrency limits to terminal, launcher, web, and
 * automation work. The limiter protects the desktop from accidental request floods while
 * allowing ordinary short bursts to proceed immediately.
 */

export type LimitedOperation = 'terminal' | 'launcher' | 'web' | 'automation'

export interface OperationLimitConfig {
  capacity: number
  leakPerSecond: number
  maxConcurrent: number
}

export interface OperationPermit {
  allowed: true
  release: () => void
}

export interface OperationRejection {
  allowed: false
  code: 'rate_limited' | 'concurrency_limited'
  retryAfterMs: number
  message: string
}

export type OperationLimitResult = OperationPermit | OperationRejection

export class LeakyBucketLimiter {
  private level = 0
  private active = 0
  private updatedAt = Date.now()

  constructor(private readonly config: OperationLimitConfig) {}

  // Acquires acquire under the limits owned by bridge-side policy enforcement.
  acquire(cost = 1, now = Date.now()): OperationLimitResult {
    this.leak(now)

    if (this.active >= this.config.maxConcurrent) {
      return {
        allowed: false,
        code: 'concurrency_limited',
        retryAfterMs: 500,
        message: 'Too many operations are already active',
      }
    }

    if (this.level + cost > this.config.capacity) {
      const overflow = this.level + cost - this.config.capacity
      return {
        allowed: false,
        code: 'rate_limited',
        retryAfterMs: Math.max(50, Math.ceil((overflow / this.config.leakPerSecond) * 1000)),
        message: 'Too many operations were requested in a short period',
      }
    }

    this.level += cost
    this.active += 1
    let released = false

    return {
      allowed: true,
      // Releases release so later operations are not incorrectly blocked.
      release: () => {
        if (released) return
        released = true
        this.active = Math.max(0, this.active - 1)
      },
    }
  }

  // Returns the current token and active-operation state of the limiter.
  snapshot(now = Date.now()): { level: number; active: number } {
    this.leak(now)
    return { level: this.level, active: this.active }
  }

  // Advances the limiter according to elapsed time before another operation is admitted.
  private leak(now: number): void {
    const elapsedSeconds = Math.max(0, now - this.updatedAt) / 1000
    this.level = Math.max(0, this.level - elapsedSeconds * this.config.leakPerSecond)
    this.updatedAt = now
  }
}

export const OPERATION_LIMITS: Record<LimitedOperation, OperationLimitConfig> = Object.freeze({
  terminal: { capacity: 16, leakPerSecond: 4, maxConcurrent: 8 },
  launcher: { capacity: 10, leakPerSecond: 1.5, maxConcurrent: 24 },
  web: { capacity: 40, leakPerSecond: 10, maxConcurrent: 16 },
  automation: { capacity: 24, leakPerSecond: 8, maxConcurrent: 3 },
})

const operationLimiters = new Map<LimitedOperation, LeakyBucketLimiter>(
  Object.entries(OPERATION_LIMITS).map(([name, config]) => [name as LimitedOperation, new LeakyBucketLimiter(config)]),
)

// Acquires operation under the limits owned by bridge-side policy enforcement.
export function acquireOperation(operation: LimitedOperation, cost = 1): OperationLimitResult {
  return operationLimiters.get(operation)!.acquire(cost)
}

// Builds the stable retry response returned when an operation limiter rejects a start.
export function operationLimitPayload(rejection: OperationRejection): {
  error: string
  code: string
  retryAfterMs: number
} {
  return {
    error: rejection.message,
    code: rejection.code,
    retryAfterMs: rejection.retryAfterMs,
  }
}
