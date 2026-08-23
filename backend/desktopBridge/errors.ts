/**
 * Converts arbitrary route and service failures into the bridge's stable error shape.
 * Centralizing this translation keeps HTTP responses predictable without requiring every
 * feature route to understand each underlying error type.
 */

export interface BridgeErrorShape {
  message?: unknown
  statusCode?: unknown
}

export interface NormalizedBridgeError {
  message: string
  statusCode: number
}

// Converts bridge error into the canonical representation expected by later code.
export function normalizeBridgeError(error: unknown): NormalizedBridgeError {
  const candidate = error as BridgeErrorShape | null | undefined
  return {
    message: typeof candidate?.message === 'string' ? candidate.message : 'Unexpected local bridge error',
    statusCode: Number.isInteger(candidate?.statusCode) ? Number(candidate?.statusCode) : 500,
  }
}
