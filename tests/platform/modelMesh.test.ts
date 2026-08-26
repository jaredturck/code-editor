/**
 * Tagged model mesh (Workstream D): ability-tag derivation + topic mapping, read-only peer
 * discovery over the configured roster, and the conductor's budget/depth/cycle ledger.
 * These are the security-relevant invariants — discovery never calls a model, and every
 * consult gate fails closed when the mesh is off.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { deriveModelTags, topicToTags, buildAgentRoster, findPeers } from '@/platform/agent/modelTags'
import {
  createMeshConductor,
  isMeshEnabled,
  peerReviewMode,
  isPeerReviewEnabled,
  isOverwatchEnabled,
} from '@/platform/agent/meshConductor'
import {
  runPeerReview,
  runOverwatch,
  resolveOverwatcher,
  hasOverwatcher,
  parseTeamworkPlanParts,
  renderTeamworkPlanMarkdown,
  runTeamworkPlanning,
} from '@/platform/agent/meshClient'
import { clearKey, setKey } from '@/platform/keyStore'

const MESH_ON = {
  agent_multi_enabled: true,
  agent_peer_consult_enabled: true,
  agent_models: [
    {
      role: 'orchestrator',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      keyId: '1',
      primary: true,
    },
    {
      role: 'executor',
      provider: 'opencode',
      model: 'deepseek-v4',
      keyId: '1',
      primary: true,
    },
    {
      role: 'scout',
      provider: 'local',
      model: 'gemma3',
      keyId: '1',
      primary: true,
    },
  ],
  agent_consult_max: 2,
  agent_consult_depth: 1,
}

beforeEach(() => {
  clearKey('anthropic')
  clearKey('opencode')
  clearKey('openai')
  setKey('anthropic', 'test-anthropic-key')
  setKey('opencode', 'test-opencode-key')
  setKey('openai', 'test-openai-key')
})

describe('modelTags', () => {
  it('derives ability tags from the capability spine', () => {
    const opus = deriveModelTags('anthropic', 'claude-opus-4-8')
    expect(opus).toContain('long-context')
    expect(opus).toContain('tool-accurate')
    expect(opus).toContain('general')

    const local = deriveModelTags('local', 'gemma3')
    expect(local).toContain('local')
    expect(local).toContain('cheap')

    const coder = deriveModelTags('opencode', 'deepseek-v4')
    expect(coder).toContain('code')
    expect(coder).toContain('reasoning')
  })

  it('maps a free-text topic to likely tags', () => {
    expect(topicToTags('help me refactor this code')).toContain('code')
    expect(topicToTags('reason about the architecture')).toContain('reasoning')
    expect(topicToTags('')).toEqual([])
  })

  it('builds the configured roster with per-role tiers', () => {
    const roster = buildAgentRoster(MESH_ON)
    expect(roster.map((m) => m.role).sort()).toEqual(['executor', 'orchestrator', 'scout'])
    const scout = roster.find((m) => m.role === 'scout')
    expect(scout?.tier).toBe(1)
  })

  it('finds the best peer for a topic without a model call', () => {
    const matches = findPeers(MESH_ON, {
      topic: 'write some code',
      exclude: ['orchestrator'],
    })
    expect(matches[0]?.role).toBe('executor') // deepseek-v4 carries the code tag
    expect(matches.some((m) => m.role === 'orchestrator')).toBe(false) // excluded
  })

  it('loads multiple models into a role (extra models become discoverable peers)', () => {
    const roster = buildAgentRoster({
      ...MESH_ON,
      agent_models: [
        ...MESH_ON.agent_models,
        {
          role: 'executor',
          provider: 'opencode',
          model: 'codestral',
          keyId: '1',
          primary: false,
        },
      ],
    })
    const executors = roster.filter((m) => m.role === 'executor')
    expect(executors).toHaveLength(2)
    expect(executors[0].primary).toBe(true)
    expect(executors[0].id).toBe('executor')
    expect(executors[1].primary).toBe(false)
    expect(executors[1].id).toBe('executor#2') // stable id for the extra model
    expect(executors[1].model).toBe('codestral')
  })

  it('keeps the same model on different keys as distinct concurrent members', () => {
    const roster = buildAgentRoster({
      agent_multi_enabled: true,
      agent_peer_consult_enabled: true,
      // Canonical flat shape: one model, two keys, all orchestrators.
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          keyId: '1',
          primary: true,
        },
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          keyId: '2',
        },
      ],
    })
    const orchestrators = roster.filter((m) => m.role === 'orchestrator')
    expect(orchestrators).toHaveLength(2) // the old provider+model de-dup collapsed these to one
    expect(orchestrators.map((m) => m.keyId).sort()).toEqual(['1', '2'])
    expect(orchestrators.map((m) => m.id).sort()).toEqual(['orchestrator', 'orchestrator#2'])
  })

  it('lets a maintainer suppress an auto-derived tag for a role', () => {
    const base = buildAgentRoster(MESH_ON).find((m) => m.role === 'scout')
    expect(base?.tags).toContain('local') // gemma3 derives 'local'
    const suppressed = buildAgentRoster({
      ...MESH_ON,
      agent_models: MESH_ON.agent_models.map((entry) =>
        entry.role === 'scout' ? { ...entry, disabledTags: ['local'] } : entry,
      ),
    }).find((m) => m.role === 'scout')
    expect(suppressed?.tags).not.toContain('local') // maintainer removed it
    expect(suppressed?.tags).toContain('cheap') // other derived tags remain
  })

  it('merges custom per-role tags and finds a peer by a custom specialty tag', () => {
    const settings = {
      ...MESH_ON,
      agent_models: MESH_ON.agent_models.map((entry) =>
        entry.role === 'scout' ? { ...entry, tags: ['rust', 'sql'] } : entry,
      ),
    }
    const scout = buildAgentRoster(settings).find((m) => m.role === 'scout')
    expect(scout?.tags).toContain('rust')
    // A model can pull the scout by the custom "rust" tag even though it's not an AbilityTag.
    const matches = findPeers(settings, {
      tags: ['rust'],
      exclude: ['orchestrator'],
    })
    expect(matches[0]?.role).toBe('scout')
  })

  it('keeps the same provider/model distinct when it is assigned to different roles', () => {
    const roster = buildAgentRoster({
      agent_multi_enabled: true,
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          keyId: '1',
          primary: true,
        },
        {
          role: 'executor',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          keyId: '1',
          primary: true,
        },
      ],
    })
    expect(roster.map((member) => member.role).sort()).toEqual(['executor', 'orchestrator'])
  })
})

describe('meshConductor', () => {
  it('rides on the bridge: on once multi-agent is enabled, unless explicitly opted out', () => {
    // Bridge on + consult left at default → enabled (no longer a silent trap).
    expect(isMeshEnabled({ agent_multi_enabled: true })).toBe(true)
    // Explicit opt-out still disables it.
    expect(
      isMeshEnabled({
        agent_multi_enabled: true,
        agent_peer_consult_enabled: false,
      }),
    ).toBe(false)
    // The bridge itself is required.
    expect(isMeshEnabled({ agent_peer_consult_enabled: true })).toBe(false)
    expect(isMeshEnabled(MESH_ON)).toBe(true)
  })

  it('fails closed when the mesh is off', () => {
    const c = createMeshConductor({}, 'orchestrator')
    expect(c.canConsult('executor').ok).toBe(false)
    expect(c.canConsult('executor').reason).toBe('disabled')
  })

  it('keeps generous consultation, depth, and per-peer safety limits', () => {
    const c = createMeshConductor(
      {
        ...MESH_ON,
        agent_consult_max: 8,
        agent_consult_depth: 4,
        agent_consult_peer_repeat_max: 3,
      },
      'orchestrator',
    )

    for (let i = 0; i < 3; i += 1) {
      expect(c.canConsult('executor', 2).ok).toBe(true)
      c.recordConsult('executor')
    }
    expect(c.canConsult('executor', 2).reason).toBe('peer_repeat_exhausted')
    expect(c.canConsult('scout', 5).reason).toBe('depth_exceeded')

    for (let i = 0; i < 5; i += 1) {
      expect(c.canConsult(`peer-${i}`, 2).ok).toBe(true)
      c.recordConsult(`peer-${i}`)
    }
    expect(c.consultsUsed).toBe(8)
    expect(c.canConsult('another-peer', 2).reason).toBe('budget_exhausted')
  })

  it('blocks only self-consultation', () => {
    const c = createMeshConductor(MESH_ON, 'orchestrator')
    expect(c.canConsult('orchestrator').reason).toBe('cycle') // self
    expect(c.isVisited('orchestrator')).toBe(true)
    expect(c.canConsult('executor').ok).toBe(true) // any other peer is fine
  })

  it('resolves the peer-review mode and gates the review tool', () => {
    expect(peerReviewMode({ agent_peer_review: 'always' })).toBe('off') // bridge off → off
    expect(
      peerReviewMode({
        agent_multi_enabled: true,
        agent_peer_review: 'always',
      }),
    ).toBe('always')
    expect(
      peerReviewMode({
        agent_multi_enabled: true,
        agent_peer_review: 'suggested',
      }),
    ).toBe('suggested')
    expect(
      isPeerReviewEnabled({
        agent_multi_enabled: true,
        agent_peer_review: 'off',
      }),
    ).toBe(false)
    expect(isPeerReviewEnabled({ ...MESH_ON, agent_peer_review: 'suggested' })).toBe(true)
  })
})

describe('overwatcher', () => {
  const OW = {
    ...MESH_ON,
    agent_models: [
      ...MESH_ON.agent_models,
      {
        role: 'overwatcher',
        provider: 'openai',
        model: 'o3',
        keyId: '1',
        primary: true,
      },
    ],
  }

  it('resolves a configured overwatcher and gates the tool/feature', () => {
    expect(hasOverwatcher(MESH_ON as never)).toBe(false) // none configured
    expect(hasOverwatcher(OW as never)).toBe(true)
    expect(resolveOverwatcher(OW as never)?.role).toBe('overwatcher')
    expect(resolveOverwatcher(OW as never)?.tier).toBe(1) // advisor → read-only by default
    expect(isOverwatchEnabled(OW)).toBe(true)
    expect(isOverwatchEnabled(MESH_ON)).toBe(false)
    expect(
      isOverwatchEnabled({
        agent_models: [
          {
            role: 'overwatcher',
            provider: 'openai',
            model: 'o3',
            keyId: '1',
            primary: true,
          },
        ],
      }),
    ).toBe(false) // bridge off
  })

  it('reports unavailable when no overwatcher is configured (no model call)', async () => {
    const r = await runOverwatch({ task: 'do a hard thing' }, MESH_ON as never)
    expect(r.available).toBe(false)
    expect(r.reason).toBe('no_overwatcher')
  })

  it('still resolves an Overwatcher that shares the orchestrator model (no cross-role erasure)', () => {
    // The old global provider+model de-dup dropped an Overwatcher bound to the same model as the
    // orchestrator; role-scoped de-dup keeps it, so isOverwatchEnabled/resolveOverwatcher see it.
    const sameModel = {
      agent_multi_enabled: true,
      agent_peer_consult_enabled: true,
      agent_models: [
        {
          role: 'orchestrator',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          keyId: '1',
          primary: true,
        },
        {
          role: 'overwatcher',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          keyId: '1',
          primary: true,
        },
      ],
    }
    expect(isOverwatchEnabled(sameModel)).toBe(true)
    expect(resolveOverwatcher(sameModel as never)?.role).toBe('overwatcher')
  })
})

describe('planTeamwork (early-return gate)', () => {
  it('needs at least two bound agents (no model call otherwise)', async () => {
    const { planTeamwork } = await import('@/platform/agent/meshClient')
    const solo = {
      agent_multi_enabled: true,
      ai_provider: 'anthropic',
      ai_model: 'claude-opus-4-8',
    }
    const plan = await planTeamwork('build a thing', solo as never)
    expect(plan.ok).toBe(false)
    expect(plan.reason).toBe('insufficient_agents')
  })
})
