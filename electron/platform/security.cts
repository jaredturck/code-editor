/**
 * Sanitizes data before it reaches logs or external navigation. It removes terminal control
 * characters, redacts common credential forms, and accepts only credential-free HTTP or
 * HTTPS URLs for opening outside the application.
 */

const REDACTED_VALUE = '[REDACTED]'
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const ESCAPE_CODE = 0x1b
const BELL_CODE = 0x07
const CSI_CODE = 0x9b

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

function consumeCsiSequence(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code >= 0x30 && code <= 0x3f) {
      index += 1
      continue
    }
    break
  }
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code >= 0x20 && code <= 0x2f) {
      index += 1
      continue
    }
    break
  }
  if (index < text.length) {
    const code = text.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) return index + 1
  }
  return start
}

function consumeAnsiSequence(text: string, start: number): number {
  const code = text.charCodeAt(start)
  if (code === CSI_CODE) {
    const end = consumeCsiSequence(text, start + 1)
    return end > start + 1 ? end : start + 1
  }
  if (code !== ESCAPE_CODE || start + 1 >= text.length) return start

  const nextCode = text.charCodeAt(start + 1)
  if (nextCode === 0x5d) {
    let index = start + 2
    while (index < text.length) {
      const current = text.charCodeAt(index)
      if (current === BELL_CODE) return index + 1
      if (current === ESCAPE_CODE && text.charCodeAt(index + 1) === 0x5c) return index + 2
      index += 1
    }
  }
  if (nextCode === 0x5b) {
    const end = consumeCsiSequence(text, start + 2)
    if (end > start + 2) return end
  }
  if (nextCode >= 0x40 && nextCode <= 0x5f) return start + 2
  return start
}

function isUnsafeControlCode(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  )
}

// Removes unsupported or unsafe terminal control characters from the supplied value.
function stripTerminalControlCharacters(value: unknown): string {
  const text = String(value ?? '')
  let output = ''
  let index = 0

  while (index < text.length) {
    const sequenceEnd = consumeAnsiSequence(text, index)
    if (sequenceEnd > index) {
      index = sequenceEnd
      continue
    }

    const code = text.charCodeAt(index)
    if (!isUnsafeControlCode(code)) output += text[index]
    index += 1
  }

  return output
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
