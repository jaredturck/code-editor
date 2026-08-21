/**
 * Skill Reward System
 *
 * Tracks whether triggered skills were followed correctly each session.
 * Persists totals through the encrypted renderer-state store under 'iris_skill_rewards'.
 */

import { readStorageJson, writeStorageJson } from '@/platform/localStorageStore';

const STORAGE_KEY = 'iris_skill_rewards';
const HEATMAP_STORAGE_KEY = 'iris_tool_heatmap_v1';
const MAX_SESSION_HISTORY = 200;

export const MISS_RATE_COMPILE_THRESHOLD = 0.4;
export const MISS_RATE_DEMOTE_THRESHOLD = 0.7;
export const ALIGN_RATE_PROMOTE_THRESHOLD = 0.8;

export interface RewardTotals {
  triggered: number;
  aligned: number;
  missed: number;
  neutral: number;
  sessions: number;
}

export interface SkillFamilyCount {
  triggered: number;
  aligned: number;
  missed: number;
}

export interface DelegationMetrics {
  delegationsPosted: number;
  delegationsSatisfied: number;
  escalations: number;
  escalationRate: number;
}

export interface SkillRewardDetail {
  id: string;
  result: 'aligned' | 'missed';
  toolHit?: boolean;
  kwHit?: boolean;
}

export interface SkillRewardScore {
  triggered: number;
  aligned: number;
  missed: number;
  neutral: number;
  sessionScore: number;
  details: SkillRewardDetail[];
  modelFamily: string;
}

export interface RewardSession {
  ts: number;
  label: string;
  triggered: number;
  aligned: number;
  missed: number;
  neutral: number;
  score: number;
  modelFamily: string;
}

export interface RewardStore {
  totals: RewardTotals;
  sessions: RewardSession[];
  familyScores: Record<string, Record<string, SkillFamilyCount>>;
  delegationMetrics: DelegationMetrics;
  mutationFlags: unknown[];
}

export interface RewardRecordResult {
  totals: RewardTotals;
  sessions: RewardSession[];
  familyScores: Record<string, Record<string, SkillFamilyCount>>;
  delegationMetrics: DelegationMetrics;
}

export interface RewardDebriefStore {
  sessions?: Array<Partial<RewardSession>>;
  familyScores?: Record<string, Record<string, Partial<SkillFamilyCount>>>;
}

export interface ScoreSessionInput {
  triggeredSkillIds?: string[];
  toolsUsed?: string[];
  finalReply?: string;
  modelFamily?: string;
}

export interface PieData {
  aligned: number;
  missed: number;
  neutral: number;
  total: number;
  onCoursePercent: number;
}

export interface MutationThresholdResult {
  recompile: string[];
  demote: string[];
  promote: string[];
}

export type ToolHeatmap = Record<string, Record<string, number>>;

interface SkillAlignmentRule {
  tools: string[];
  keywords: string[];
}

const SKILL_ALIGNMENT: Record<string, SkillAlignmentRule> = {
  'python-conventions': {
    tools: [],
    keywords: ['python', 'def ', 'import ', 'dataclass', 'pathlib', 'async def', 'type hint'],
  },
  'cpp-conventions': {
    tools: [],
    keywords: ['c++', '#include', 'std::', 'unique_ptr', 'const ', 'template', 'namespace'],
  },
  'js-conventions': {
    tools: [],
    keywords: ['const ', 'async ', 'await ', 'import ', '=>', 'typescript', '.ts', '.js', 'react'],
  },
  'csharp-conventions': {
    tools: [],
    keywords: ['c#', 'using ', 'Task<', 'async ', 'record ', 'var ', '.cs', 'dotnet'],
  },
  'ui-conventions': {
    tools: [],
    keywords: [
      'aria-',
      'accessibility',
      'wcag',
      'tailwind',
      'css',
      'component',
      'responsive',
      'button',
      'form',
    ],
  },
  'ai-code-utilization': {
    tools: ['files.read', 'files.find'],
    keywords: ['const ', 'function ', 'class ', 'def '],
  },
  'regex-finder-fast-path': {
    tools: ['files.find', 'search.ripgrep'],
    keywords: [],
  },
  'web-search-strategy': { tools: ['search.web'], keywords: [] },
  'file-io-patterns': {
    tools: ['files.read', 'files.write', 'files.find', 'files.list'],
    keywords: [],
  },
  'tool-efficiency': { tools: [], keywords: [] },
  'local-search-mastery': {
    tools: ['files.find', 'files.list', 'search.ripgrep'],
    keywords: [],
  },
  'orchestrator-delegation': {
    tools: ['agent.delegate', 'agent.recall', 'agent.verify'],
    keywords: [],
  },
};

function emptyTotals(): RewardTotals {
  return { triggered: 0, aligned: 0, missed: 0, neutral: 0, sessions: 0 };
}

function emptyFamilyScores(): Record<string, Record<string, SkillFamilyCount>> {
  return {};
}

function emptyDelegationMetrics(): DelegationMetrics {
  return {
    delegationsPosted: 0,
    delegationsSatisfied: 0,
    escalations: 0,
    escalationRate: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTotals(value: unknown): RewardTotals {
  const source = isRecord(value) ? value : {};
  return {
    triggered: Number(source.triggered || 0),
    aligned: Number(source.aligned || 0),
    missed: Number(source.missed || 0),
    neutral: Number(source.neutral || 0),
    sessions: Number(source.sessions || 0),
  };
}

function normalizeDelegationMetrics(value: unknown): DelegationMetrics {
  const source = isRecord(value) ? value : {};
  return {
    delegationsPosted: Number(source.delegationsPosted || 0),
    delegationsSatisfied: Number(source.delegationsSatisfied || 0),
    escalations: Number(source.escalations || 0),
    escalationRate: Number(source.escalationRate || 0),
  };
}

function normalizeFamilyScores(value: unknown): Record<string, Record<string, SkillFamilyCount>> {
  if (!isRecord(value)) return {};
  const families: Record<string, Record<string, SkillFamilyCount>> = {};

  for (const [family, rawSkills] of Object.entries(value)) {
    if (!isRecord(rawSkills)) continue;
    const skills: Record<string, SkillFamilyCount> = {};
    for (const [skillId, rawCounts] of Object.entries(rawSkills)) {
      if (!isRecord(rawCounts)) continue;
      skills[skillId] = {
        triggered: Number(rawCounts.triggered || 0),
        aligned: Number(rawCounts.aligned || 0),
        missed: Number(rawCounts.missed || 0),
      };
    }
    families[family] = skills;
  }

  return families;
}

function normalizeSessions(value: unknown): RewardSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      ts: Number(entry.ts || 0),
      label: String(entry.label || ''),
      triggered: Number(entry.triggered || 0),
      aligned: Number(entry.aligned || 0),
      missed: Number(entry.missed || 0),
      neutral: Number(entry.neutral || 0),
      score: Number(entry.score || 0),
      modelFamily: String(entry.modelFamily || ''),
    }))
    .slice(0, MAX_SESSION_HISTORY);
}

function readStore(): unknown {
  return readStorageJson<unknown>(STORAGE_KEY, null);
}

function writeStore(data: unknown): void {
  writeStorageJson(STORAGE_KEY, data);
}

function readHeatmap(): ToolHeatmap {
  const raw = readStorageJson<unknown>(HEATMAP_STORAGE_KEY, {});
  if (!isRecord(raw)) return {};
  const heatmap: ToolHeatmap = {};

  for (const [family, rawTools] of Object.entries(raw)) {
    if (!isRecord(rawTools)) continue;
    heatmap[family] = {};
    for (const [tool, count] of Object.entries(rawTools)) {
      heatmap[family][tool] = Number(count || 0);
    }
  }

  return heatmap;
}

function writeHeatmap(data: ToolHeatmap): void {
  writeStorageJson(HEATMAP_STORAGE_KEY, data);
}

export function readRewardStore(): RewardStore {
  const stored = readStore();
  const source = isRecord(stored) ? stored : {};
  return {
    totals: normalizeTotals(source.totals),
    sessions: normalizeSessions(source.sessions),
    familyScores: normalizeFamilyScores(source.familyScores),
    delegationMetrics: normalizeDelegationMetrics(source.delegationMetrics),
    mutationFlags: Array.isArray(source.mutationFlags) ? source.mutationFlags : [],
  };
}

export function scoreSession({
  triggeredSkillIds = [],
  toolsUsed = [],
  finalReply = '',
  modelFamily = '',
}: ScoreSessionInput = {}): SkillRewardScore {
  const replyLower = String(finalReply).toLowerCase();
  const toolSet = new Set(toolsUsed);

  if (triggeredSkillIds.length === 0) {
    return {
      triggered: 0,
      aligned: 0,
      missed: 0,
      neutral: 1,
      sessionScore: 0.5,
      details: [],
      modelFamily,
    };
  }

  const details: SkillRewardDetail[] = triggeredSkillIds.map((id) => {
    const alignment = SKILL_ALIGNMENT[id];
    if (!alignment) return { id, result: 'aligned' };

    const toolHit =
      alignment.tools.length === 0 || alignment.tools.some((tool) => toolSet.has(tool));
    const kwHit =
      alignment.keywords.length === 0 ||
      alignment.keywords.some((keyword) => replyLower.includes(keyword));
    const result = toolHit && kwHit ? 'aligned' : 'missed';
    return { id, result, toolHit, kwHit };
  });

  const aligned = details.filter((detail) => detail.result === 'aligned').length;
  const missed = details.filter((detail) => detail.result === 'missed').length;
  const sessionScore = triggeredSkillIds.length > 0 ? aligned / triggeredSkillIds.length : 0.5;

  return {
    triggered: triggeredSkillIds.length,
    aligned,
    missed,
    neutral: 0,
    sessionScore,
    details,
    modelFamily,
  };
}

export function recordToolHeatmap(modelFamily: string, toolsUsed: string[]): void {
  if (!modelFamily || !Array.isArray(toolsUsed) || !toolsUsed.length) return;

  const heatmap = readHeatmap();
  if (!heatmap[modelFamily]) heatmap[modelFamily] = {};

  for (const tool of toolsUsed) {
    const normalizedTool = String(tool || '').trim();
    if (!normalizedTool) continue;
    heatmap[modelFamily][normalizedTool] = (heatmap[modelFamily][normalizedTool] || 0) + 1;
  }

  writeHeatmap(heatmap);
}

export function getToolHeatmap(modelFamily: string): Record<string, number>;
export function getToolHeatmap(): ToolHeatmap;
export function getToolHeatmap(modelFamily?: string): Record<string, number> | ToolHeatmap {
  const heatmap = readHeatmap();
  return modelFamily ? heatmap[modelFamily] || {} : heatmap;
}

export function checkMutationThresholds(modelFamily: string): MutationThresholdResult {
  const store = readRewardStore();
  const familyScores = store.familyScores[modelFamily] || {};
  const recompile: string[] = [];
  const demote: string[] = [];
  const promote: string[] = [];

  for (const [skillId, counts] of Object.entries(familyScores)) {
    const total = Number(counts.triggered || 0);
    if (total < 3) continue;

    const missRate = Number(counts.missed || 0) / total;
    const alignRate = Number(counts.aligned || 0) / total;

    if (missRate >= MISS_RATE_DEMOTE_THRESHOLD) demote.push(skillId);
    else if (missRate >= MISS_RATE_COMPILE_THRESHOLD) recompile.push(skillId);

    if (alignRate >= ALIGN_RATE_PROMOTE_THRESHOLD) promote.push(skillId);
  }

  return { recompile, demote, promote };
}

export function recordDelegationMetrics(metrics: Partial<DelegationMetrics>): void {
  const store = readRewardStore();
  const delegationMetrics = store.delegationMetrics;

  delegationMetrics.delegationsPosted += Number(metrics.delegationsPosted || 0);
  delegationMetrics.delegationsSatisfied += Number(metrics.delegationsSatisfied || 0);
  delegationMetrics.escalations += Number(metrics.escalations || 0);

  const total = delegationMetrics.delegationsPosted;
  delegationMetrics.escalationRate =
    total > 0 ? Math.round((delegationMetrics.escalations / total) * 100) / 100 : 0;

  const stored = readStore();
  const next = isRecord(stored) ? { ...stored } : {};
  next.delegationMetrics = delegationMetrics;
  writeStore(next);
}

export function recordReward(result: SkillRewardScore, label = ''): RewardRecordResult {
  const store = readRewardStore();

  const entry: RewardSession = {
    ts: Date.now(),
    label: String(label).slice(0, 60),
    triggered: result.triggered,
    aligned: result.aligned,
    missed: result.missed,
    neutral: result.neutral,
    score: result.sessionScore,
    modelFamily: String(result.modelFamily || ''),
  };

  const sessions = [entry, ...store.sessions].slice(0, MAX_SESSION_HISTORY);

  const totals = { ...store.totals };
  totals.triggered += result.triggered;
  totals.aligned += result.aligned;
  totals.missed += result.missed;
  totals.neutral += result.neutral;
  totals.sessions += 1;

  const familyScores = { ...store.familyScores };
  const family = String(result.modelFamily || '').trim();
  if (family) {
    if (!familyScores[family]) familyScores[family] = {};
    const familyCounts = familyScores[family];

    for (const detail of result.details || []) {
      const skillId = String(detail.id || '');
      if (!skillId) continue;
      if (!familyCounts[skillId]) familyCounts[skillId] = { triggered: 0, aligned: 0, missed: 0 };
      familyCounts[skillId].triggered += 1;
      if (detail.result === 'aligned') familyCounts[skillId].aligned += 1;
      else familyCounts[skillId].missed += 1;
    }
  }

  writeStore({
    totals,
    sessions,
    familyScores,
    delegationMetrics: store.delegationMetrics,
    mutationFlags: store.mutationFlags,
  });
  return {
    totals,
    sessions,
    familyScores,
    delegationMetrics: store.delegationMetrics,
  };
}

export function computePieData(totals?: Partial<RewardTotals>): PieData {
  const source = totals || emptyTotals();
  const aligned = Number(source.aligned || 0);
  const missed = Number(source.missed || 0);
  const neutral = Number(source.neutral || 0);
  const total = aligned + missed + neutral;
  if (total === 0) return { aligned: 0, missed: 0, neutral: 1, onCoursePercent: 50, total: 1 };
  return {
    aligned,
    missed,
    neutral,
    total,
    onCoursePercent: Math.round(((aligned + neutral * 0.5) / total) * 100),
  };
}

export function buildSessionDebrief(
  rewardStore: RewardDebriefStore,
  modelFamily: string,
): string | null {
  const recent = (rewardStore.sessions || []).slice(0, 3);
  if (!recent.length) return null;

  const avgScore =
    recent.reduce((sum, session) => sum + Number(session.score || 0), 0) / recent.length;

  const familyCounts = rewardStore.familyScores?.[modelFamily] || {};
  const topMissed = Object.entries(familyCounts)
    .filter(([, counts]) => {
      const total = Number(counts.triggered || 0);
      return total >= 2 && Number(counts.missed || 0) / total >= MISS_RATE_COMPILE_THRESHOLD;
    })
    .sort(
      ([, a], [, b]) =>
        Number(b.missed || 0) / Number(b.triggered || 1) -
        Number(a.missed || 0) / Number(a.triggered || 1),
    )
    .slice(0, 3)
    .map(([id]) => id);

  if (!topMissed.length) return null;

  return (
    `Session context: recent alignment ${Math.round(avgScore * 100)}%. ` +
    `Skills to prioritize: ${topMissed.join(', ')}.`
  );
}

export function resetRewards(): void {
  writeStore({
    totals: emptyTotals(),
    sessions: [],
    familyScores: emptyFamilyScores(),
    delegationMetrics: emptyDelegationMetrics(),
    mutationFlags: [],
  });
  writeHeatmap({});
}
