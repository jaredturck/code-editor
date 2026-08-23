/**
 * Sanitizes data before it reaches logs or external navigation. It removes terminal control
 * characters, redacts common credential forms, and accepts only credential-free HTTP or
 * HTTPS URLs for opening outside the application.
 */

const REDACTED_VALUE = '[REDACTED]'
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

const ANSI_OSC_PATTERN = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g
const ANSI_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g
const ANSI_SINGLE_PATTERN = /\u001B[@-_]/g
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\u007F-\u009F]/g

const SENSITIVE_FIELD_PATTERN =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x[-_]?api[-_]?key|x[-_]?goog[-_]?api[-_]?key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|auth[-_]?token|id[-_]?token|session[-_]?token|bearer|token|credentials?|password|passphrase|secret|client[-_]?secret|private[-_]?key|prompt|system[-_]?prompt|user[-_]?prompt|messages?|request[-_]?body|response[-_]?body|file[-_]?content|contents?)$/i

const PREFIXED_SENSITIVE_PATTERNS = [
  /(\b(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|password|passphrase|client[-_]?secret|cookie|set-cookie)\b\s*[:=]\s*)([^\r\n]+)/gi,
  /(\bBearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
  /([?&](?:api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|key|password|secret)=)([^&#\s]+)/gi,
]

const WHOLE_SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
]

// Removes unsupported or unsafe terminal control characters from the supplied value.
function stripTerminalControlCharacters(value: unknown): string {
  return String(value ?? '')
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_SINGLE_PATTERN, '')
    .replace(UNSAFE_CONTROL_PATTERN, '')
}

// Redacts sensitive sensitive text before it can reach logs or user-visible output.
function redactSensitiveText(value: unknown): string {
  let text = stripTerminalControlCharacters(value)
  for (const pattern of PREFIXED_SENSITIVE_PATTERNS) {
    text = text.replace(pattern, (_match, prefix: string | undefined) => `${prefix || ''}${REDACTED_VALUE}`)
  }
  for (const pattern of WHOLE_SECRET_PATTERNS) {
    text = text.replace(pattern, REDACTED_VALUE)
  }
  return text
}

// Redacts sensitive value before it can reach logs or user-visible output.
function redactValue(value: unknown, fieldName: string, seen: WeakSet<object>, depth: number): unknown {
  if (SENSITIVE_FIELD_PATTERN.test(fieldName)) return REDACTED_VALUE
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactSensitiveText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return String(value)
  if (depth >= 6) return '[TRUNCATED]'

  if (value instanceof Error) {
    return {
      name: redactSensitiveText(value.name),
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined,
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactValue(item, '', seen, depth + 1))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactValue(item, key, seen, depth + 1)
    }
    seen.delete(value)
    return result
  }

  return redactSensitiveText(value)
}

// Recursively sanitizes structured log data while handling errors, arrays, circular references, and
// depth limits.
function redactSensitiveData(value: unknown): unknown {
  return redactValue(value, '', new WeakSet<object>(), 0)
}

// Accepts only credential-free HTTP or HTTPS URLs for navigation outside the application.
function getSafeExternalUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null
    if (parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

export = {
  getSafeExternalUrl,
  redactSensitiveData,
  redactSensitiveText,
  stripTerminalControlCharacters,
}
