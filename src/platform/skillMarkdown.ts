/**
 * Client-side SKILL.md (de)serialization — a faithful port of the bridge's canonical
 * serializeSkillToMarkdown / parseSkillMarkdown (server/desktopBridge/services/
 * bridgeServiceRuntime). Pure string functions (no fs / no bridge), so the Skills editor
 * can show the FULL SKILL.md for free-form editing and parse it back to the structured
 * skill the existing /skills/upsert route accepts (validateSkillInput preserves every
 * field, and the bridge re-writes the canonical SKILL.md on disk on save).
 *
 * Format = YAML-ish frontmatter (--- … ---) + Markdown body (the instructions). Complex
 * fields (lists/objects) are emitted as compact JSON and decoded on parse, so the
 * edit → save → reload round-trip is lossless.
 */

type SkillMarkdownRecord = Record<string, unknown>

export interface ParsedSkillMarkdown extends SkillMarkdownRecord {
  id: unknown
  title: unknown
  instructions: string
  summary?: unknown
  enabled?: boolean
  guard?: boolean
}

export function stripYamlScalar(value: unknown): string {
  let v = String(value || '').trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  return v
}

const COMPLEX_KEYS = new Set([
  'triggers',
  'examples',
  'dependencies',
  'agenttarget',
  'roles',
  'modelvariants',
  'reflextrigger',
  'provenance',
])

// Parses a SKILL.md string into the structured skill shape the upsert route accepts.
export function parseSkillMarkdown(content: unknown, fallbackId = 'skill'): ParsedSkillMarkdown {
  const text = String(content || '').replace(/^﻿/, '')
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)

  if (!match) {
    return { id: fallbackId, title: fallbackId, instructions: text.trim() }
  }

  const [, fmBlock, body] = match
  const meta: SkillMarkdownRecord = {}
  let currentListKey: string | null = null

  for (const line of fmBlock.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue

    const listItem = line.match(/^\s*-\s+(.*)$/)
    if (listItem && currentListKey) {
      const current = meta[currentListKey]
      if (!Array.isArray(current)) meta[currentListKey] = []
      ;(meta[currentListKey] as unknown[]).push(stripYamlScalar(listItem[1]))
      continue
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue

    const key = kv[1].trim()
    const rawValue = kv[2].trim()

    if (rawValue === '') {
      meta[key] = []
      currentListKey = key
      continue
    }

    const looksJson =
      (rawValue.startsWith('[') && rawValue.endsWith(']')) || (rawValue.startsWith('{') && rawValue.endsWith('}'))
    if (COMPLEX_KEYS.has(key.toLowerCase()) && looksJson) {
      try {
        meta[key] = JSON.parse(rawValue) as unknown
        currentListKey = null
        continue
      } catch {
        /* fall through to list/scalar */
      }
    }

    const inlineList = rawValue.match(/^\[(.*)\]$/)
    if (inlineList) {
      meta[key] = inlineList[1]
        .split(',')
        .map((value) => stripYamlScalar(value))
        .filter(Boolean)
    } else {
      meta[key] = stripYamlScalar(rawValue)
    }
    currentListKey = null
  }

  const name = String(meta.name || fallbackId).trim() || fallbackId
  return {
    id: meta.id || name,
    title: meta.title || name,
    summary: meta.description || meta.summary || '',
    instructions: String(body || '').trim(),
    triggers: meta.triggers,
    examples: meta.examples,
    priority: meta.priority,
    enabled: meta.enabled === undefined ? true : meta.enabled !== 'false' && meta.enabled !== false,
    type: meta.type,
    agentTarget: meta.agentTarget ?? meta.role ?? meta.roles,
    guard: meta.guard === true || meta.guard === 'true',
    dependencies: meta.dependencies,
    modelVariants: meta.modelVariants,
    reflexTrigger: meta.reflexTrigger,
    provenance: meta.provenance,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

// Serializes a structured skill into the canonical SKILL.md string for editing.
export function serializeSkillToMarkdown(skill: unknown): string {
  const s: SkillMarkdownRecord =
    skill && typeof skill === 'object' && !Array.isArray(skill) ? (skill as SkillMarkdownRecord) : {}
  const fm: string[] = []
  const scalar = (key: string, value: unknown): void => {
    if (value !== undefined && value !== null && value !== '') fm.push(`${key}: ${String(value)}`)
  }
  const jsonArr = (key: string, value: unknown): void => {
    if (Array.isArray(value) && value.length) fm.push(`${key}: ${JSON.stringify(value)}`)
  }
  const jsonObj = (key: string, value: unknown): void => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      fm.push(`${key}: ${JSON.stringify(value)}`)
    }
  }

  scalar('name', s.id)
  scalar('id', s.id)
  scalar('title', s.title)
  scalar('description', s.summary)
  scalar('type', s.type || 'standard')
  scalar('priority', Number.isFinite(Number(s.priority)) ? Number(s.priority) : 0)
  fm.push(`enabled: ${s.enabled !== false}`)
  if (s.guard === true) fm.push('guard: true')
  jsonArr('triggers', s.triggers)
  jsonArr('agentTarget', s.agentTarget)
  jsonArr('dependencies', s.dependencies)
  jsonArr('examples', s.examples)
  jsonObj('modelVariants', s.modelVariants)
  jsonObj('reflexTrigger', s.reflexTrigger)
  jsonObj('provenance', s.provenance)
  scalar('createdAt', s.createdAt)
  scalar('updatedAt', s.updatedAt)

  const body = String(s.instructions || '').trim()
  return `---\n${fm.join('\n')}\n---\n\n${body}\n`
}

// A blank SKILL.md template for the "New skill" action.
//
// The body follows IRIS's uniform skill standard so every authored skill reads the same way and
// stays discoverable: a one-line principle, then When to use / Method / Example / Tools & scripts /
// Pitfalls. The `orbit-skill-authoring` built-in skill documents the standard in full. Keep it
// terse — the `description` (a single WHEN sentence) is the discovery card the model matches the
// task against before it loads the body, so that line carries the most weight.
export function blankSkillMarkdown(id = 'new-skill'): string {
  return serializeSkillToMarkdown({
    id,
    title: 'New Skill',
    summary:
      'One sharp sentence naming WHEN this skill applies — the situation/keywords that should make the model reach for it (this single line is the discovery card).',
    type: 'standard',
    priority: 0,
    enabled: true,
    triggers: ['keyword-or-phrase', 'another-trigger'],
    examples: ['Concrete situation → the action this skill prescribes.'],
    instructions: `# New Skill

One sentence stating the principle and the failure it prevents — the *why*, so the method makes sense.

## When to use
- The specific situations that should trigger this skill (mirror the description).
- When NOT to use it, if there's an easy way to over-apply it.

## Method
1. The first concrete step — name the exact tool or command, not a vague intention.
2. The next step. Keep steps ordered, specific, and verifiable.
3. How you know it worked (the check), and what to do if it didn't.

## Example
A short, concrete walkthrough: the situation, the tool calls, and the outcome. One good example beats three abstract rules.

## Tools & scripts
- \`tool.name\` — when and why this skill reaches for it.
- \`terminal.script <name>\` — any built-in helper this skill leans on (omit this section if the skill needs none).

## Pitfalls
- The mistake people (and models) make here, and the nuance that avoids it.`,
  })
}
