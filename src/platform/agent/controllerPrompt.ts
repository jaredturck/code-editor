/**
 * Compact controller prompt and per-turn state for the agent loop.
 * Runtime policy, tool schemas, constrained decoding, and acceptance gates own mechanics;
 * the model receives only the semantics it needs to choose useful work.
 */

import { UNTRUSTED_CONTENT_SYSTEM_RULES } from '@/platform/security'

type ControllerTier = 'lean' | 'structured'
type ControllerRole = 'orchestrator' | 'executor' | 'scout' | 'consultant' | 'overwatcher'

interface ControllerPromptOptions {
  tier?: ControllerTier
  orchestration?: boolean
  debriefLine?: string
  tags?: readonly string[]
  role?: ControllerRole
  meshEnabled?: boolean
  planning?: boolean
}

const TAG_FRAGMENTS: Readonly<Record<string, string>> = {
  vision: 'Use visual input when it matters to the task.',
}

const ROLE_FRAGMENTS: Readonly<Record<ControllerRole, string>> = {
  orchestrator: 'Own the task.',
  executor: 'Complete the delegated task. Do not delegate it again.',
  scout: 'Gather the requested evidence.',
  consultant: 'Answer the focused question.',
  overwatcher: 'Give brief steering without executing the task.',
}

interface ControllerContentBlock extends Record<string, unknown> {
  type: string
}

export function buildControllerSystemPrompt({
  tier = 'lean',
  orchestration = false,
  debriefLine = '',
  tags = [],
  role,
  meshEnabled = false,
  planning = false,
}: ControllerPromptOptions = {}) {
  const sections = [
    'You are IRIS. Complete the user’s task with the available tools.',
    'Use the evidence you have. Read only what you need. Once a problem is understood, change it instead of re-observing it. Verify relevant changes and finish when the task is complete.',
  ]

  const tagLines = Array.from(new Set((Array.isArray(tags) ? tags : []).map(String)))
    .map((tag) => TAG_FRAGMENTS[tag])
    .filter(Boolean)
  if (tagLines.length) sections.push(tagLines.join('\n'))
  if (role && ROLE_FRAGMENTS[role]) sections.push(ROLE_FRAGMENTS[role])

  sections.push(UNTRUSTED_CONTENT_SYSTEM_RULES)

  if (orchestration) sections.push('Delegate only when a self-contained subtask materially reduces the work.')
  if (meshEnabled) sections.push('Consult a peer only for a real reasoning or knowledge gap.')
  if (planning) sections.push('Follow the approved plan and integrate verified results.')
  if (tier === 'structured') sections.push('Return the controller decision object.')

  let prompt = sections.join('\n\n')
  if (debriefLine) prompt += `\n\n${debriefLine}`
  return prompt
}

function _fmtTodos(todos: unknown) {
  if (!Array.isArray(todos) || !todos.length) return ''
  return todos
    .slice(0, 8)
    .map((t) => `- [${String(t?.status || 'pending')}] ${String(t?.text || '').slice(0, 100)}`)
    .join('\n')
}

function _fmtRecentSteps(steps: unknown) {
  if (!Array.isArray(steps) || !steps.length) return ''
  return steps
    .slice(-3)
    .map((s) => {
      const status = s?.ok ? 'ok' : `error: ${String(s?.error || '').slice(0, 90)}`
      const summary = String(s?.summary || '').replace(/\s+/g, ' ').trim().slice(0, 110)
      return `- ${String(s?.tool || '?')}: ${status}${summary ? ` — ${summary}` : ''}`
    })
    .join('\n')
}

function _fmtActiveSkills(skills: any) {
  const active: any[] = Array.isArray(skills?.active_skills) ? skills.active_skills : []
  if (!active.length) return ''
  return active
    .slice(0, 4)
    .map((skill) => `- ${String(skill.title || skill.id)}: ${String(skill.summary || '').slice(0, 120)}`)
    .join('\n')
}

export function buildControllerStateHeader(
  payload: any,
  screenContext?: string | null,
): string | ControllerContentBlock[] {
  const recall = payload?.relevant_memory || {}
  const todos = _fmtTodos(payload?.todos)
  const recentSteps = _fmtRecentSteps(payload?.previous_steps)
  const parts = [`# Task\n${String(payload?.user_request || '').trim() || '(use the conversation context)'}`]

  if (todos) parts.push(`## Todos\n${todos}`)
  if (recentSteps) parts.push(`## Recent actions\n${recentSteps}`)

  const activeSkills = _fmtActiveSkills(payload?.skills)
  if (activeSkills) parts.push(`## Active skills\n${activeSkills}`)

  const recallNotes = Array.isArray(recall.notes) ? recall.notes : []
  if (recallNotes.length) {
    const note = recallNotes[0]
    parts.push(
      `## Relevant memory\n- ${String(note.title || 'note')}: ${String(note.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 160)}`,
    )
  }

  const text = parts.join('\n\n')
  if (screenContext) {
    return [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: screenContext } },
    ]
  }
  return text
}
