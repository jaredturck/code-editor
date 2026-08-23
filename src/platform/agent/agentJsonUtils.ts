/**
 * agentJsonUtils.js
 * Pure JSON extraction and text-trimming helpers used by the agent runtime.
 * No external imports — safe to import from anywhere.
 */

const _MAX_TOOL_PREVIEW_CHARS = 1600
const _MAX_PROMPT_MESSAGE_CHARS = 500

// ── Text trimming ─────────────────────────────────────────────────────────────

export function toPreview(value: unknown, maxChars: number = _MAX_TOOL_PREVIEW_CHARS): string {
  const _text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!_text) return ''
  return _text.length > maxChars ? `${_text.slice(0, maxChars)}\n...[truncated]` : _text
}

// Trims message content to the size accepted by the agent tool and policy layer.
export function trimMessageContent(content: unknown): string {
  const _text = String(content || '').trim()
  if (_text.length <= _MAX_PROMPT_MESSAGE_CHARS) return _text
  return `${_text.slice(0, _MAX_PROMPT_MESSAGE_CHARS)}...`
}

// ── JSON sanitisation ─────────────────────────────────────────────────────────

export function sanitizeJsonTextForParsing(input: unknown): string {
  return String(input || '')
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes → straight
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes → straight
    .replace(/\u00A0/g, ' ') // non-breaking space → space
    .trim()
}

// Determines whether the try parse JSON candidate for the agent tool and policy layer.
export function tryParseJsonCandidate(candidate: unknown): unknown {
  const _text = sanitizeJsonTextForParsing(candidate)
  if (!_text) return null

  const _attempts = [
    _text,
    _text.replace(/,\s*([}\]])/g, '$1'), // trailing comma fix
  ]

  for (const _attempt of _attempts) {
    try {
      const _parsed = JSON.parse(_attempt)
      if (_parsed && typeof _parsed === 'string') {
        const _nested: unknown = tryParseJsonCandidate(_parsed)
        return _nested || _parsed
      }
      return _parsed
    } catch {
      // try next strategy
    }
  }

  return null
}

// Collects balanced JSON objects into the bounded result consumed by the agent tool and policy
// layer.
export function collectBalancedJsonObjects(text: unknown, maxCandidates: number = 8): string[] {
  const _input = String(text || '')
  const _candidates: string[] = []
  let _depth = 0
  let _start = -1
  let _inString = false
  let _escaped = false

  for (let _i = 0; _i < _input.length; _i += 1) {
    const _char = _input[_i]

    if (_inString) {
      if (_escaped) {
        _escaped = false
        continue
      }
      if (_char === '\\') {
        _escaped = true
        continue
      }
      if (_char === '"') {
        _inString = false
      }
      continue
    }

    if (_char === '"') {
      _inString = true
      continue
    }

    if (_char === '{') {
      if (_depth === 0) _start = _i
      _depth += 1
      continue
    }

    if (_char === '}') {
      if (_depth <= 0) continue
      _depth -= 1
      if (_depth === 0 && _start >= 0) {
        _candidates.push(_input.slice(_start, _i + 1))
        _start = -1
        if (_candidates.length >= maxCandidates) break
      }
    }
  }

  return _candidates.sort((a, b) => b.length - a.length)
}

/**
 * Best-effort extraction of the first complete JSON object from free-form text.
 * Handles fenced code blocks, partial text, and nested stringified JSON.
 */
export function extractJsonObject(rawText: unknown): Record<string, unknown> | null {
  const _text = sanitizeJsonTextForParsing(rawText)
  if (!_text) return null

  const _parsedWhole = tryParseJsonCandidate(_text)
  if (_parsedWhole && typeof _parsedWhole === 'object' && !Array.isArray(_parsedWhole))
    return _parsedWhole as Record<string, unknown>

  const _fenced = _text.match(/```json\s*([\s\S]*?)\s*```/i)
  if (_fenced?.[1]) {
    const _parsedFenced = tryParseJsonCandidate(_fenced[1])
    if (_parsedFenced && typeof _parsedFenced === 'object' && !Array.isArray(_parsedFenced))
      return _parsedFenced as Record<string, unknown>
  }

  const _firstBrace = _text.indexOf('{')
  const _lastBrace = _text.lastIndexOf('}')
  if (_firstBrace >= 0 && _lastBrace > _firstBrace) {
    const _parsedRange = tryParseJsonCandidate(_text.slice(_firstBrace, _lastBrace + 1))
    if (_parsedRange && typeof _parsedRange === 'object' && !Array.isArray(_parsedRange))
      return _parsedRange as Record<string, unknown>
  }

  const _balanced = collectBalancedJsonObjects(_text, 8)
  for (const _candidate of _balanced) {
    const _parsedCandidate = tryParseJsonCandidate(_candidate)
    if (_parsedCandidate && typeof _parsedCandidate === 'object' && !Array.isArray(_parsedCandidate))
      return _parsedCandidate as Record<string, unknown>
  }

  return null
}
