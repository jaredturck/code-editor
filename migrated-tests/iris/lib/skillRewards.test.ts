/**
 * Exercises the observable skill rewards contract, with regression cases for “returns an
 * empty reward store by default” and “scores sessions without triggered skills as neutral”.
 * The suite documents caller-visible behavior so implementation refactors cannot silently
 * weaken those guarantees.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  ALIGN_RATE_PROMOTE_THRESHOLD,
  MISS_RATE_COMPILE_THRESHOLD,
  MISS_RATE_DEMOTE_THRESHOLD,
  buildSessionDebrief,
  checkMutationThresholds,
  computePieData,
  getToolHeatmap,
  readRewardStore,
  recordDelegationMetrics,
  recordReward,
  recordToolHeatmap,
  resetRewards,
  scoreSession,
} from '@/platform/skillRewards'
import { writeStorageJson } from '@/platform/localStorageStore'

describe('skillRewards', () => {
  it('returns an empty reward store by default', () => {
    expect(readRewardStore()).toEqual({
      totals: { triggered: 0, aligned: 0, missed: 0, neutral: 0, sessions: 0 },
      sessions: [],
      familyScores: {},
      delegationMetrics: {
        delegationsPosted: 0,
        delegationsSatisfied: 0,
        escalations: 0,
        escalationRate: 0,
      },
      mutationFlags: [],
    })
  })

  it('scores sessions without triggered skills as neutral', () => {
    expect(scoreSession({})).toMatchObject({
      triggered: 0,
      aligned: 0,
      missed: 0,
      neutral: 1,
      sessionScore: 0.5,
    })
  })

  it('scores tool-aligned skills as aligned', () => {
    const result = scoreSession({
      triggeredSkillIds: ['web-search-strategy', 'file-io-patterns'],
      toolsUsed: ['search.web', 'files.read'],
      finalReply: 'Completed',
      modelFamily: 'gpt4o',
    })
    expect(result).toMatchObject({
      triggered: 2,
      aligned: 2,
      missed: 0,
      sessionScore: 1,
    })
  })

  it('scores missing tool or keyword alignment as missed', () => {
    const result = scoreSession({
      triggeredSkillIds: ['web-search-strategy', 'python-conventions'],
      toolsUsed: [],
      finalReply: 'No relevant implementation details',
    })
    expect(result).toMatchObject({
      triggered: 2,
      aligned: 0,
      missed: 2,
      sessionScore: 0,
    })
  })

  it('treats unknown skill ids as aligned for backward compatibility', () => {
    const result = scoreSession({ triggeredSkillIds: ['custom-skill'] })
    expect(result.details[0]).toEqual({
      id: 'custom-skill',
      result: 'aligned',
    })
  })

  it('records and reads tool heatmaps', () => {
    recordToolHeatmap('gpt4o', ['files.read', 'files.read', 'search.web', ''])
    expect(getToolHeatmap('gpt4o')).toEqual({
      'files.read': 2,
      'search.web': 1,
    })
    expect(getToolHeatmap()).toEqual({
      gpt4o: { 'files.read': 2, 'search.web': 1 },
    })
  })

  it('ignores invalid heatmap input', () => {
    recordToolHeatmap('', ['files.read'])
    recordToolHeatmap('gpt4o', [])
    expect(getToolHeatmap()).toEqual({})
  })

  it('records reward totals, history, and family scores', () => {
    const score = scoreSession({
      triggeredSkillIds: ['web-search-strategy'],
      toolsUsed: ['search.web'],
      finalReply: 'Found sources',
      modelFamily: 'gpt4o',
    })
    const stored = recordReward(score, 'A'.repeat(100))

    expect(stored.totals).toMatchObject({
      triggered: 1,
      aligned: 1,
      missed: 0,
      sessions: 1,
    })
    expect(stored.sessions[0].label).toHaveLength(60)
    expect(stored.familyScores.gpt4o['web-search-strategy']).toEqual({
      triggered: 1,
      aligned: 1,
      missed: 0,
    })
  })

  it('caps reward history at 200 entries', () => {
    const score = scoreSession({})
    for (let index = 0; index < 205; index += 1) {
      recordReward(score, `Session ${index}`)
    }
    expect(readRewardStore().sessions).toHaveLength(200)
  })

  it('records cumulative delegation metrics and escalation rate', () => {
    recordDelegationMetrics({
      delegationsPosted: 3,
      delegationsSatisfied: 2,
      escalations: 1,
    })
    recordDelegationMetrics({
      delegationsPosted: 1,
      delegationsSatisfied: 1,
      escalations: 1,
    })
    expect(readRewardStore().delegationMetrics).toEqual({
      delegationsPosted: 4,
      delegationsSatisfied: 3,
      escalations: 2,
      escalationRate: 0.5,
    })
  })

  it('classifies mutation thresholds', () => {
    writeStorageJson('iris_skill_rewards', {
      familyScores: {
        gpt4o: {
          compile: { triggered: 10, aligned: 5, missed: 5 },
          demote: { triggered: 10, aligned: 2, missed: 8 },
          promote: { triggered: 10, aligned: 9, missed: 1 },
          insufficient: { triggered: 2, aligned: 0, missed: 2 },
        },
      },
    })
    expect(checkMutationThresholds('gpt4o')).toEqual({
      recompile: ['compile'],
      demote: ['demote'],
      promote: ['promote'],
    })
  })

  it('computes pie data and weighted on-course percentage', () => {
    expect(computePieData({ aligned: 3, missed: 1, neutral: 2 })).toEqual({
      aligned: 3,
      missed: 1,
      neutral: 2,
      total: 6,
      onCoursePercent: 67,
    })
  })

  it('uses a neutral placeholder for empty pie data', () => {
    expect(computePieData()).toEqual({
      aligned: 0,
      missed: 0,
      neutral: 1,
      onCoursePercent: 50,
      total: 1,
    })
  })

  it('builds a debrief for repeatedly missed skills', () => {
    const debrief = buildSessionDebrief(
      {
        sessions: [{ score: 0.2 }, { score: 0.4 }, { score: 0.6 }],
        familyScores: {
          gpt4o: {
            'weak-skill': { triggered: 5, aligned: 2, missed: 3 },
          },
        },
      },
      'gpt4o',
    )
    expect(debrief).toContain('recent alignment 40%')
    expect(debrief).toContain('weak-skill')
  })

  it('returns no debrief when there are no relevant misses', () => {
    expect(buildSessionDebrief({ sessions: [] }, 'gpt4o')).toBeNull()
    expect(buildSessionDebrief({ sessions: [{ score: 1 }], familyScores: { gpt4o: {} } }, 'gpt4o')).toBeNull()
  })

  it('resets all reward and heatmap data', () => {
    recordReward(scoreSession({}), 'session')
    recordToolHeatmap('gpt4o', ['files.read'])
    resetRewards()
    expect(readRewardStore().sessions).toEqual([])
    expect(getToolHeatmap()).toEqual({})
  })

  it('exports the documented thresholds', () => {
    expect(MISS_RATE_COMPILE_THRESHOLD).toBe(0.4)
    expect(MISS_RATE_DEMOTE_THRESHOLD).toBe(0.7)
    expect(ALIGN_RATE_PROMOTE_THRESHOLD).toBe(0.8)
  })
})
