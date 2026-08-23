/** Curated Ollama recommendations shown separately from installed local models. */

export interface RecommendedLocalModel {
  id: string
  label: string
  description: string
  size: string
  capabilities: string[]
}

export const RECOMMENDED_LOCAL_MODELS: RecommendedLocalModel[] = [
  {
    id: 'qwen3.6:27b',
    label: 'Qwen 3.6 27B',
    description: 'Balanced agentic coding, tools, thinking, and vision.',
    size: '17 GB',
    capabilities: ['coding', 'tools', 'thinking', 'vision'],
  },
  {
    id: 'qwen3.5:9b',
    label: 'Qwen 3.5 9B',
    description: 'Fast general-purpose local agent with a large context window.',
    size: '6.6 GB',
    capabilities: ['general', 'tools', 'vision'],
  },
  {
    id: 'qwen3-coder:30b',
    label: 'Qwen3-Coder 30B',
    description: 'Coding-focused model for repository-scale agent work.',
    size: '19 GB',
    capabilities: ['coding', 'tools', 'long-context'],
  },
  {
    id: 'qwen3-coder-next',
    label: 'Qwen3-Coder-Next',
    description: 'Coding-focused model optimized for local agent workflows.',
    size: 'varies',
    capabilities: ['coding', 'tools'],
  },
]

export interface LocalHardwareProfile {
  memTotal?: number
  gpuMemoryTotalMb?: number
}

/** Chooses IRIS's required local worker model from coarse hardware capacity. */
export function chooseAutomaticLocalModel(hardware: LocalHardwareProfile | null | undefined): string {
  const gpuMemoryGb = Number(hardware?.gpuMemoryTotalMb || 0) / 1024

  if (gpuMemoryGb >= 28) return 'qwen3.6:27b'
  return 'qwen3.5:9b'
}
