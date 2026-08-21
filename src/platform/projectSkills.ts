import type { BridgeFileNode, BridgeSkillDefinition } from './desktopBridgeBase'
import { listDirectory, readTextFile } from './desktopBridge'
import { parseSkillMarkdown } from './skillMarkdown'

const PROJECT_SKILL_DIRECTORY = '.iris/skills'
const PROJECT_SKILL_SETTINGS = '.iris/skills.json'
const MAX_PROJECT_SKILLS = 32
const MAX_PROJECT_SKILL_CHARS = 40000

interface ProjectSkillOverride {
  enabled?: boolean
  priority?: number
}

interface ProjectSkillSettings {
  enabled: boolean
  skills: Record<string, ProjectSkillOverride>
}

function workspace_path(root_path: string, relative_path: string) {
  const separator = root_path.includes('\\') ? '\\' : '/'
  return `${root_path.replace(/[\\/]+$/, '')}${separator}${relative_path.replace(/[\\/]+/g, separator)}`
}

function project_skill_files(node: BridgeFileNode, output: string[] = []) {
  if (output.length >= MAX_PROJECT_SKILLS) return output
  if (node.type === 'file' && /\.md$/i.test(node.name)) {
    output.push(node.path)
    return output
  }

  for (const child of node.children || []) {
    project_skill_files(child, output)
    if (output.length >= MAX_PROJECT_SKILLS) break
  }
  return output
}

function normalize_project_skill_settings(value: unknown): ProjectSkillSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { enabled: true, skills: {} }
  }

  const source = value as Record<string, unknown>
  const raw_skills = source.skills && typeof source.skills === 'object' && !Array.isArray(source.skills)
    ? source.skills as Record<string, unknown>
    : {}
  const skills: Record<string, ProjectSkillOverride> = {}

  for (const [id, raw_override] of Object.entries(raw_skills).slice(0, MAX_PROJECT_SKILLS)) {
    if (!raw_override || typeof raw_override !== 'object' || Array.isArray(raw_override)) continue
    const override = raw_override as Record<string, unknown>
    skills[id] = {
      ...(typeof override.enabled === 'boolean' ? { enabled: override.enabled } : {}),
      ...(Number.isFinite(Number(override.priority)) ? { priority: Number(override.priority) } : {}),
    }
  }

  return {
    enabled: source.enabled !== false,
    skills,
  }
}

async function read_project_skill_settings(workspace_root: string) {
  try {
    const result = await readTextFile(workspace_path(workspace_root, PROJECT_SKILL_SETTINGS), {
      startLine: 1,
      lineCount: 400,
    })
    const content = String(result.content || '').slice(0, 20000)
    return normalize_project_skill_settings(JSON.parse(content))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    if (/does not exist|not found|enoent/i.test(message)) {
      return { enabled: true, skills: {} } satisfies ProjectSkillSettings
    }
    return { enabled: false, skills: {} } satisfies ProjectSkillSettings
  }
}

export function mergeProjectSkillDefinitions(
  global_skills: BridgeSkillDefinition[],
  project_skills: BridgeSkillDefinition[],
) {
  const by_id = new Map<string, BridgeSkillDefinition>()

  for (const skill of global_skills) {
    const id = String(skill?.id || '').trim()
    if (id) by_id.set(id, skill)
  }
  for (const skill of project_skills) {
    const id = String(skill?.id || '').trim()
    if (id) by_id.set(id, skill)
  }

  return Array.from(by_id.values())
}

export async function loadProjectSkillDefinitions(workspace_root: string) {
  const root = String(workspace_root || '').trim()
  if (!root) return [] as BridgeSkillDefinition[]

  const settings = await read_project_skill_settings(root)
  if (!settings.enabled) return [] as BridgeSkillDefinition[]

  let tree: BridgeFileNode
  try {
    const listing = await listDirectory(workspace_path(root, PROJECT_SKILL_DIRECTORY), 3)
    tree = listing.tree
  } catch {
    return [] as BridgeSkillDefinition[]
  }

  const paths = project_skill_files(tree).slice(0, MAX_PROJECT_SKILLS)
  const definitions: BridgeSkillDefinition[] = []

  for (const skill_path of paths) {
    try {
      const result = await readTextFile(skill_path, { startLine: 1, lineCount: 1200 })
      const filename = skill_path.split(/[\\/]/).pop() || 'project-skill.md'
      const fallback_id = filename.replace(/\.md$/i, '') || 'project-skill'
      const parsed = parseSkillMarkdown(
        String(result.content || '').slice(0, MAX_PROJECT_SKILL_CHARS),
        fallback_id,
      ) as BridgeSkillDefinition
      const id = String(parsed.id || fallback_id).trim() || fallback_id
      const override = settings.skills[id] || {}
      const provenance = parsed.provenance && typeof parsed.provenance === 'object'
        ? parsed.provenance as Record<string, unknown>
        : {}

      definitions.push({
        ...parsed,
        id,
        enabled: override.enabled ?? (parsed.enabled !== false),
        priority: override.priority ?? parsed.priority,
        provenance: {
          ...provenance,
          source: 'project',
          path: skill_path,
          workspaceRoot: root,
        },
      })
    } catch {
      // One malformed or concurrently removed project skill must not disable the rest.
    }
  }

  return definitions
}

export { MAX_PROJECT_SKILLS, PROJECT_SKILL_DIRECTORY, PROJECT_SKILL_SETTINGS }
