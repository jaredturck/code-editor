import { callAIWithMeta } from '@/platform/aiService'
import type { AIMessage, AISettings } from '@/platform/providers/types'

const PLANNING_OUTPUT_MAX_CHARS = 6000

export const FORCED_PLANNING_STAGES = Object.freeze([
  {
    id: 'ideas',
    label: 'Exploring ideas',
    prompt: 'Explore interesting ways to approach this project. Be creative and generate a wide range of ideas.',
  },
  {
    id: 'expand',
    label: 'Developing ideas',
    prompt:
      'Develop these ideas further. Explore them in more depth and discover additional ideas that follow from them.',
  },
  {
    id: 'direction',
    label: 'Choosing direction',
    prompt:
      'Decide how you want to approach the project. Choose and develop the direction you think will produce the best result.',
  },
  {
    id: 'plan',
    label: 'Planning implementation',
    prompt: 'Create a thorough implementation plan for the direction you chose.',
  },
])

export interface ForcedPlanningArtifact {
  id: string
  label: string
  content: string
}

export interface ForcedPlanningResult {
  artifacts: ForcedPlanningArtifact[]
  context: string
  timeline: Array<Record<string, unknown>>
}

interface ForcedPlanningInput {
  request: string
  conversation?: AIMessage[]
  settings: Record<string, unknown>
  signal?: AbortSignal | null
  onEvent?: (event: Record<string, unknown>) => void
}

function planningConversation(conversation: AIMessage[] | undefined, request: string) {
  const recent = (Array.isArray(conversation) ? conversation : [])
    .filter((message) => ['user', 'assistant'].includes(String(message.role || '')))
    .slice(-12)
    .map((message) => ({ role: String(message.role || ''), content: message.content }))
  return [
    { role: 'system', content: 'Plan the software project before implementation.' },
    ...recent,
    { role: 'user', content: String(request || '').trim() },
  ] as AIMessage[]
}

function planningContext(artifacts: ForcedPlanningArtifact[]) {
  return [
    '[PROJECT PLANNING]',
    ...artifacts.map((artifact) => `## ${artifact.label}\n${artifact.content}`),
    '[END PROJECT PLANNING]',
  ].join('\n\n')
}

export async function runForcedPlanning(input: ForcedPlanningInput): Promise<ForcedPlanningResult> {
  const request = String(input.request || '').trim()
  if (!request) throw new Error('Forced planning requires a project request.')

  const thread = planningConversation(input.conversation, request)
  const artifacts: ForcedPlanningArtifact[] = []
  const timeline: Array<Record<string, unknown>> = []

  for (const stage of FORCED_PLANNING_STAGES) {
    thread.push({ role: 'user', content: stage.prompt })
    const response = await callAIWithMeta(thread, input.settings as AISettings, { signal: input.signal || undefined })
    const content = String(response?.text || '')
      .trim()
      .slice(0, PLANNING_OUTPUT_MAX_CHARS)
    if (!content) throw new Error(`Planning stage "${stage.label}" returned an empty response.`)

    const artifact = { id: stage.id, label: stage.label, content }
    const event = {
      type: 'planning',
      stage: stage.id,
      name: stage.label,
      label: stage.label,
      summary: content,
      at: Date.now(),
    }
    artifacts.push(artifact)
    timeline.push(event)
    input.onEvent?.(event)
    thread.push({ role: 'assistant', content })
  }

  return {
    artifacts,
    context: planningContext(artifacts),
    timeline,
  }
}
