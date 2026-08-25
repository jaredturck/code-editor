/** Shared Chat data structures that are still consumed by the Code Editor UI/runtime. */

export type UnknownRecord = Record<string, any>

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | string
  content: string
  meta?: UnknownRecord
  _injected?: boolean
}

export interface ApprovalOption {
  id: string
  label: string
  description: string
  recommended: boolean
}

export interface ApprovalRequest extends UnknownRecord {
  id: string
  requestType?: string
  reason?: string
  options?: ApprovalOption[]
  question?: string
  questionOptions?: string[]
  allowOther?: boolean
  recommendedDecision?: string
  permissionKeys?: string[]
  persistentPermission?: boolean
  createdAt?: number
  expiresAt?: number
}

export interface ApprovalResolution extends UnknownRecord {
  approved: boolean
  decision: string
  answer?: string
  stopped?: boolean
}

export type ApprovalResolver = (resolution: ApprovalResolution) => void
