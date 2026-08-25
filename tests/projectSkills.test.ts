import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge_state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  globals: [] as Array<Record<string, unknown>>,
  tree: null as Record<string, unknown> | null,
}))

vi.mock('../src/platform/desktopBridgeBase', () => ({
  listSkillDefinitions: async () => ({ profile: 'default', skills: bridge_state.globals }),
}))

import { loadSkillContext } from '../src/platform/agent/agentSkillEngine'
import { listSkillDefinitions, setEditorFileAuthority } from '../src/platform/desktopBridge'
import {
  loadProjectSkillDefinitions,
  mergeProjectSkillDefinitions,
  type ProjectSkillIO,
} from '../src/platform/projectSkillLoader'

const project_skill = `---
id: secure-review
title: Project Security Review
description: Review security-sensitive code and trust boundaries.
triggers: ["security", "review", "trust boundary"]
priority: 9
enabled: true
---

Inspect the project-specific trust boundary before changing security-sensitive code.`

function project_io(): ProjectSkillIO {
  return {
    listDirectory: async () => {
      if (!bridge_state.tree) throw new Error('skills directory does not exist')
      return { rootPath: '/workspace/.iris/skills', tree: bridge_state.tree as never }
    },
    readTextFile: async (path: string) => {
      const content = bridge_state.files.get(path)
      if (content === undefined) throw new Error(`${path} does not exist`)
      return { content }
    },
  }
}

function editor_authority() {
  return {
    execute: async (tool_name: string, args: Record<string, unknown> = {}) => {
      if (tool_name === 'files.list') {
        if (String(args.path || '') === '')
          return {
            rootPath: '/workspace',
            tree: { name: 'workspace', path: '/workspace', type: 'directory', children: [] },
          }
        return project_io().listDirectory(String(args.path || ''), Number(args.depth) || 3)
      }
      if (tool_name === 'files.read') {
        const result = await project_io().readTextFile(String(args.path || ''))
        return { path: String(args.path || ''), content: result.content, isBinary: false }
      }
      throw new Error(`unexpected tool ${tool_name}`)
    },
  }
}

describe('project skill loading', () => {
  beforeEach(() => {
    setEditorFileAuthority(null)
    bridge_state.files.clear()
    bridge_state.globals = []
    bridge_state.tree = {
      name: 'skills',
      path: '/workspace/.iris/skills',
      type: 'directory',
      children: [
        {
          name: 'secure-review.md',
          path: '/workspace/.iris/skills/secure-review.md',
          type: 'file',
        },
      ],
    }
    bridge_state.files.set('/workspace/.iris/skills/secure-review.md', project_skill)
  })

  it('uses non-throwing optional probes when project skills are absent', async () => {
    bridge_state.tree = null
    const readTextFile = vi.fn(async (_path: string, options?: Record<string, unknown>) => ({
      content: '',
      missing: options?.optional === true,
    }))
    const listDirectory = vi.fn(async (_path: string, _depth?: number, options?: Record<string, unknown>) => ({
      rootPath: '/workspace/.iris/skills',
      tree: { name: 'skills', path: '/workspace/.iris/skills', type: 'directory' as const, children: [] },
      missing: options?.optional === true,
    }))

    await expect(loadProjectSkillDefinitions('/workspace', { listDirectory, readTextFile })).resolves.toEqual([])
    expect(readTextFile).toHaveBeenCalledWith(
      '/workspace/.iris/skills.json',
      expect.objectContaining({ optional: true }),
    )
    expect(listDirectory).toHaveBeenCalledWith('/workspace/.iris/skills', 3, { optional: true })
  })

  it('loads bounded project skills and applies project settings', async () => {
    bridge_state.files.set(
      '/workspace/.iris/skills.json',
      JSON.stringify({ skills: { 'secure-review': { priority: 17 } } }),
    )

    const skills = await loadProjectSkillDefinitions('/workspace', project_io())
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      id: 'secure-review',
      title: 'Project Security Review',
      priority: 17,
      enabled: true,
    })
    expect(skills[0].provenance).toMatchObject({
      source: 'project',
      workspaceRoot: '/workspace',
      path: '/workspace/.iris/skills/secure-review.md',
    })
  })

  it('merges project definitions over global skills through the active editor workspace', async () => {
    bridge_state.globals = [
      {
        id: 'secure-review',
        title: 'Global Security Review',
        summary: 'Global instructions',
        instructions: 'Global body',
        enabled: true,
      },
    ]
    setEditorFileAuthority(editor_authority())

    const result = await listSkillDefinitions('default')
    expect(result.skills).toHaveLength(1)
    expect(result.skills?.[0].title).toBe('Project Security Review')
  })

  it('keeps merged project skills progressively loadable for capable autonomous agents', async () => {
    bridge_state.globals = [
      {
        id: 'general-code',
        title: 'General Code',
        summary: 'General coding guidance',
        triggers: ['code'],
        instructions: 'Use the normal coding workflow.',
        enabled: true,
      },
    ]
    setEditorFileAuthority(editor_authority())

    const context = await loadSkillContext({
      settings: {
        skills_enabled: true,
        skills_profile: 'default',
        skills_token_budget: 2200,
        skills_max_active: 4,
      },
      userInput: 'Review the security trust boundary in this project',
      conversation: [],
      role: 'orchestrator',
      toolset: 'lean',
    })

    expect(context.loadError).toBe('')
    expect(context.cards.some((card) => card.id === 'secure-review')).toBe(true)
    expect(context.active.some((skill) => skill.id === 'secure-review')).toBe(false)
    expect(context.loadablePool?.['secure-review']?.instructions).toContain('project-specific trust boundary')
  })

  it('fails closed for project skills when the project settings file is malformed', async () => {
    bridge_state.files.set('/workspace/.iris/skills.json', '{broken json')
    await expect(loadProjectSkillDefinitions('/workspace', project_io())).resolves.toEqual([])
  })

  it('lets project definitions override global definitions deterministically', async () => {
    const project_skills = await loadProjectSkillDefinitions('/workspace', project_io())
    const merged = mergeProjectSkillDefinitions(
      [{ id: 'secure-review', title: 'Global Security Review', enabled: true }],
      project_skills,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('Project Security Review')
  })
})
