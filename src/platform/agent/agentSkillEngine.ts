/**
 * agentSkillEngine.ts
 * Skill loading, scoring, selection, and reflex injection.
 * Extracted from agentRuntime.js for readability; imported back by that module.
 */

import { listSkillDefinitions } from '@/platform/desktopBridge';
import { resolveActiveSkillProfile } from '@/platform/skillProfiles';
import type { BridgeSkillDefinition } from '@/platform/desktopBridge';
import type { SkillProfileSettings } from '@/platform/skillProfiles';

export interface SkillModelVariants extends Record<string, unknown> {
  simple?: string;
}

export interface SkillReflexTrigger extends Record<string, unknown> {
  tool?: string;
  condition?: string;
}

export interface NormalizedSkill {
  id: string;
  title: string;
  summary: string;
  triggers: string[];
  instructions: string;
  examples: string[];
  enabled: boolean;
  priority: number;
  type: string;
  agentTarget: string[];
  modelVariants: SkillModelVariants;
  dependencies: string[];
  reflexTrigger: SkillReflexTrigger | null;
}

export interface SkillCard {
  id: string;
  title: string;
  summary: string;
  triggers: string[];
  priority: number;
  score: number;
  type: string;
}

export interface ActiveSkill {
  id: string;
  title: string;
  summary: string;
  triggers: string[];
  priority: number;
  instructions: string;
  examples: string[];
  type: string;
  tokenCost: number;
}

export interface LoadableSkill extends Omit<ActiveSkill, 'tokenCost'> {}

export interface SkillSelectionResult {
  tokenBudget: number;
  maxActive: number;
  tokensUsed: number;
  cards: SkillCard[];
  active: ActiveSkill[];
  loadablePool: Record<string, LoadableSkill>;
}

export interface SkillConversationMessage extends Record<string, unknown> {
  content?: unknown;
}

export interface SkillSettings extends SkillProfileSettings, Record<string, unknown> {
  ai_model?: unknown;
  skills_enabled?: boolean;
  skills_token_budget?: unknown;
  skills_max_active?: unknown;
  skills_min_relevance_score?: unknown;
}

export interface SkillSelectionOptions {
  userInput: unknown;
  conversation: SkillConversationMessage[];
  settings: SkillSettings;
  role?: string;
  offloadedIds?: Set<unknown> | unknown[] | null;
  toolset?: string;
}

export interface SkillContext {
  enabled: boolean;
  profile: string;
  available: number;
  tokenBudget: number;
  maxActive: number;
  tokensUsed: number;
  cards: SkillCard[];
  active: ActiveSkill[];
  loadablePool?: Record<string, LoadableSkill>;
  loadError: string;
  role?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ── Defaults (mirrored from agentRuntime constants) ───────────────────────────

const _DEFAULT_SKILLS_TOKEN_BUDGET = 2200;
const _DEFAULT_SKILLS_MAX_ACTIVE = 4;
const _DEFAULT_SKILLS_MIN_RELEVANCE = 3;
// Card-menu sizing is tier-aware (Phase C). Cards are cheap (id + description), so
// capable LEAN models see the WHOLE relevant set and judge task-fit from the
// descriptions themselves. Structured models get a bounded but broad enough menu
// to discover lifecycle support after inspecting a project.
const _MAX_LEAN_CARD_COUNT = 24;
const _STRUCTURED_CARD_COUNT = 10;

// Some inherited built-ins predate reflex metadata even though their behavior belongs
// in the reflex system. Keep this compatibility map small and semantic: it connects an
// existing reusable skill to an existing generic runtime event, not to a domain error.
const _LEGACY_REFLEX_TRIGGERS: Readonly<Record<string, SkillReflexTrigger>> = {
  'orbit-self-correction': { tool: '*', condition: 'error' },
};

// ── Token estimation (approx 4 chars per token) ───────────────────────────────

function _estimateTokens(text: unknown): number {
  return Math.ceil(String(text || '').length / 4);
}

// ── Keyword extraction ────────────────────────────────────────────────────────

export function extractKeywords(text: unknown): Set<string> {
  const _stopwords = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'into',
    'your',
    'you',
    'are',
    'was',
    'were',
    'have',
    'has',
    'had',
    'about',
    'then',
    'than',
    'them',
    'they',
    'their',
    'will',
    'would',
    'should',
    'could',
    'what',
    'when',
    'where',
    'which',
    'while',
    'how',
    'why',
    'can',
    'not',
    'use',
    'using',
    'please',
    'need',
    'make',
    'build',
    'help',
    'show',
    'tell',
    'give',
    'also',
    'just',
    'only',
  ]);

  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !_stopwords.has(t))
      .slice(0, 200),
  );
}

// ── Skill normalisation ───────────────────────────────────────────────────────

// Skills can target one or more agent roles. A skill with no agentTarget (or a
// universal value) is shared by every role.
const _UNIVERSAL_TARGETS = new Set(['', 'all', 'any', 'both', 'shared', 'global', '*']);

// Converts agent target into the canonical representation expected by later code.
function _normalizeAgentTarget(raw: Record<string, unknown>): string[] {
  const value = raw.agentTarget ?? raw.agent_target ?? raw.role ?? raw.roles;
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        String(v || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
  }
  const single = String(value || '')
    .trim()
    .toLowerCase();
  if (!single) return [];
  // Allow comma-separated lists in a single string.
  return single
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Converts a built-in or persisted skill definition into the complete shape expected by
 * scoring and prompt selection. Defaults and bounded text fields are applied here so the
 * rest of the skill engine can compare one consistent representation.
 */

export function normalizeSkill(raw: unknown, index: number): NormalizedSkill {
  const source = isRecord(raw) ? raw : {};
  const _id = String(source.id || `skill-${index + 1}`).trim() || `skill-${index + 1}`;
  const _title =
    String(source.title || _id)
      .trim()
      .slice(0, 120) || _id;
  const _summary = String(source.summary || '')
    .trim()
    .slice(0, 500);
  const _triggers = Array.isArray(source.triggers)
    ? source.triggers
        .map((t) =>
          String(t || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const _instructions = String(source.instructions || '')
    .trim()
    .slice(0, 24000);
  const _examples = Array.isArray(source.examples)
    ? source.examples
        .map((e) => String(e || '').trim())
        .filter(Boolean)
        .slice(0, 16)
    : [];
  const _legacyReflexTrigger = _LEGACY_REFLEX_TRIGGERS[_id] || null;
  const _reflexTrigger = isRecord(source.reflexTrigger)
    ? (source.reflexTrigger as SkillReflexTrigger)
    : _legacyReflexTrigger;
  const _sourceType =
    String(source.type || 'standard')
      .trim()
      .toLowerCase() || 'standard';

  return {
    id: _id,
    title: _title,
    summary: _summary,
    triggers: _triggers,
    instructions: _instructions,
    examples: _examples,
    enabled: source.enabled !== false,
    priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 0,
    // Preserved structural fields — previously dropped, which silently disabled
    // guard injection, role targeting, model variants, dependency chaining,
    // and reflex skills.
    type: _legacyReflexTrigger ? 'reflex' : _sourceType,
    agentTarget: _normalizeAgentTarget(source),
    modelVariants: isRecord(source.modelVariants)
      ? (source.modelVariants as SkillModelVariants)
      : {},
    dependencies: Array.isArray(source.dependencies)
      ? source.dependencies
          .map((d) => String(d || '').trim())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    reflexTrigger: _reflexTrigger,
  };
}

/**
 * Does a skill apply to the given role? Universal skills apply to all roles;
 * targeted skills apply only to their listed roles.
 */
export function skillMatchesRole(skill: unknown, role: unknown): boolean {
  const source = isRecord(skill) ? skill : {};
  const targets = Array.isArray(source.agentTarget) ? source.agentTarget.map(String) : [];
  if (!targets.length || targets.some((t) => _UNIVERSAL_TARGETS.has(t))) return true;
  if (!role) return true;
  return targets.includes(String(role).toLowerCase());
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function scoreSkill(
  skill: NormalizedSkill,
  queryText: string,
  keywordSet: ReadonlySet<string>,
  recentText = '',
): number {
  if (!skill.enabled) return Number.NEGATIVE_INFINITY;

  const _haystack = [
    skill.title,
    skill.summary,
    skill.instructions.slice(0, 800),
    skill.triggers.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  let _score = Number(skill.priority || 0) * 2;
  let _hitCount = 0;

  skill.triggers.forEach((trigger) => {
    const _tl = trigger.toLowerCase();
    if (keywordSet.has(_tl)) {
      _score += 14;
      _hitCount += 1;
      return;
    }
    if (queryText.includes(_tl)) {
      _score += 10;
      _hitCount += 1;
      return;
    }
    const _words = _tl.split(/\s+/).filter((w) => w.length >= 3);
    if (_words.length > 1 && _words.every((w) => queryText.includes(w))) {
      _score += 7;
      _hitCount += 1;
      return;
    }
    for (const kw of keywordSet) {
      if (kw.startsWith(_tl) || _tl.startsWith(kw)) {
        _score += 4;
        break;
      }
    }
  });

  // Keyword coverage — % of query keywords found in haystack
  let _hits = 0;
  for (const kw of keywordSet) {
    if (_haystack.includes(kw)) _hits += 1;
  }
  const _coverage = keywordSet.size > 0 ? _hits / keywordSet.size : 0;
  _score += Math.round(_coverage * 6);

  // Recency boost
  if (recentText && skill.triggers.some((t) => recentText.includes(t.toLowerCase()))) {
    _score += 3;
  }

  // Hit density bonus
  if (_hitCount >= 3) _score += 4;
  else if (_hitCount >= 2) _score += 2;

  return _score;
}

// ── Selection ─────────────────────────────────────────────────────────────────

export function selectSkillsForPrompt(
  allSkills: unknown,
  {
    userInput,
    conversation,
    settings,
    role = '',
    offloadedIds = null,
    toolset = 'structured',
  }: SkillSelectionOptions,
): SkillSelectionResult {
  const _tokenBudget = Math.max(
    200,
    Math.min(16000, Number(settings?.skills_token_budget || _DEFAULT_SKILLS_TOKEN_BUDGET)),
  );
  const _maxActive = Math.max(
    1,
    Math.min(16, Number(settings?.skills_max_active || _DEFAULT_SKILLS_MAX_ACTIVE)),
  );
  const _minRelevance = Math.max(
    -20,
    Math.min(40, Number(settings?.skills_min_relevance_score ?? _DEFAULT_SKILLS_MIN_RELEVANCE)),
  );

  // Clean lookup: only consider skills that (a) target the current role (or are
  // universal) and (b) have not been offloaded for this session. This prevents
  // executor/scout skills from polluting the orchestrator's context and lets an
  // agent shed skills it has decided it no longer needs.
  const _offloaded =
    offloadedIds instanceof Set
      ? offloadedIds
      : new Set(Array.isArray(offloadedIds) ? offloadedIds : []);
  const skills = (Array.isArray(allSkills) ? (allSkills as NormalizedSkill[]) : []).filter(
    (s) => skillMatchesRole(s, role) && !_offloaded.has(String(s.id)),
  );

  // The structured controller benefits from each skill's compact recipe regardless
  // of model brand. Capability/toolset determines prompt shape; hard-coded family
  // names do not. Lean/native models keep the full body available on demand.
  const _resolveInstructions = (skill: NormalizedSkill): string =>
    toolset !== 'lean' && skill.modelVariants?.simple
      ? skill.modelVariants.simple
      : skill.instructions || '';

  const _recentText = String(userInput || conversation.slice(-1)[0]?.content || '').toLowerCase();
  const _queryText = [
    String(userInput || ''),
    ...conversation.slice(-6).map((m) => String(m?.content || '')),
  ]
    .join(' ')
    .toLowerCase();
  const _keywordSet = extractKeywords(_queryText);

  const _ranked = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, _queryText, _keywordSet, _recentText) }))
    .filter((e) => Number.isFinite(e.score))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.skill.priority - a.skill.priority ||
        a.skill.title.localeCompare(b.skill.title),
    );

  // The card menu the model browses to decide what to skills.load. Guards are
  // always-on (active), so they're never carded. Lean models get the whole
  // relevant set; structured models get a bounded menu plus their pre-injected recipes.
  const _nonGuardRanked = _ranked.filter((e) => e.skill.type !== 'guard');
  const _cardLimit =
    toolset === 'lean'
      ? Math.min(_nonGuardRanked.length, _MAX_LEAN_CARD_COUNT)
      : _STRUCTURED_CARD_COUNT;
  const _carded = _nonGuardRanked.slice(0, _cardLimit);

  const _cards = _carded.map((e) => ({
    id: e.skill.id,
    title: e.skill.title,
    summary: e.skill.summary,
    triggers: e.skill.triggers,
    priority: e.skill.priority,
    score: Math.round(e.score),
    type: e.skill.type || 'standard',
  }));

  // Loadable pool — full instructions for every carded skill, kept in memory (NOT
  // serialized into the prompt). Lets skills.load pull a skill's body on demand
  // (progressive disclosure: discovery via cards → activation via skills.load).
  const _loadablePool: Record<string, LoadableSkill> = {};
  for (const e of _carded) {
    _loadablePool[String(e.skill.id)] = {
      id: e.skill.id,
      title: e.skill.title,
      summary: e.skill.summary,
      triggers: e.skill.triggers,
      priority: e.skill.priority,
      instructions: _resolveInstructions(e.skill),
      examples: e.skill.examples || [],
      type: e.skill.type || 'standard',
    };
  }

  const _active: ActiveSkill[] = [];
  let _tokensUsed = 0;
  let _activeProcedureCount = 0;

  // Guard skills are mandatory rails, not optional procedures. They consume tokens
  // but no longer consume the configurable procedure slots.
  for (const skill of skills.filter((s) => s.type === 'guard' && s.enabled !== false).slice(0, 3)) {
    const _instr = _resolveInstructions(skill);
    const _packed = [skill.title, skill.summary, _instr, ...(skill.examples || [])].join('\n');
    const _cost = _estimateTokens(_packed);
    if (_tokensUsed + _cost <= _tokenBudget) {
      _active.push({
        id: skill.id,
        title: skill.title,
        summary: skill.summary,
        triggers: skill.triggers,
        priority: skill.priority,
        instructions: _instr,
        examples: skill.examples || [],
        type: 'guard',
        tokenCost: _cost,
      });
      _tokensUsed += _cost;
    }
  }

  // Ranked skills — pre-injected only for the structured tier. _maxActive now
  // represents procedure capacity; guards are tracked separately above.
  for (const entry of toolset === 'lean' ? [] : _ranked) {
    if (_activeProcedureCount >= _maxActive) break;
    if (_active.find((a) => a.id === entry.skill.id)) continue;
    if (entry.skill.type === 'reflex' || entry.skill.type === 'guard') continue;

    const _isStrong = Number(entry.skill.priority || 0) >= 8;
    const _isRelevant = Number(entry.score) >= _minRelevance;
    if (!_isRelevant && !_isStrong) continue;

    const skill = entry.skill;
    const _instr = _resolveInstructions(skill);

    // Chain dependencies while reserving room for the selected skill itself.
    for (const depId of Array.isArray(skill.dependencies) ? skill.dependencies : []) {
      const _dep = skills.find((s) => s.id === depId);
      if (!_dep || _active.find((a) => a.id === depId)) continue;
      if (_dep.type !== 'guard' && _activeProcedureCount >= _maxActive - 1) break;
      const _depInstr = _resolveInstructions(_dep);
      const _depPacked = [_dep.title, _dep.summary, _depInstr, ...(_dep.examples || [])].join('\n');
      const _depCost = _estimateTokens(_depPacked);
      if (_tokensUsed + _depCost <= _tokenBudget) {
        _active.push({
          id: _dep.id,
          title: _dep.title,
          summary: _dep.summary,
          triggers: _dep.triggers,
          priority: _dep.priority,
          instructions: _depInstr,
          examples: _dep.examples || [],
          type: _dep.type || 'standard',
          tokenCost: _depCost,
        });
        _tokensUsed += _depCost;
        if (_dep.type !== 'guard') _activeProcedureCount += 1;
      }
    }

    const _packed = [skill.title, skill.summary, _instr, ...(skill.examples || [])].join('\n');
    const _cost = _estimateTokens(_packed);
    if (_active.length > 0 && _tokensUsed + _cost > _tokenBudget) continue;

    _active.push({
      id: skill.id,
      title: skill.title,
      summary: skill.summary,
      triggers: skill.triggers,
      priority: skill.priority,
      instructions: _instr,
      examples: skill.examples || [],
      type: skill.type || 'standard',
      tokenCost: _cost,
    });
    _tokensUsed += _cost;
    _activeProcedureCount += 1;
  }

  return {
    tokenBudget: _tokenBudget,
    maxActive: _maxActive,
    tokensUsed: _tokensUsed,
    cards: _cards,
    active: _active,
    loadablePool: _loadablePool,
  };
}

// ── Reflex injection (called post-tool-result) ────────────────────────────────

function _toolResultFailed(result: unknown): boolean {
  if (result instanceof Error) return true;
  if (!isRecord(result)) return false;
  const status = String(result.status || result.state || '').trim().toLowerCase();
  return (
    result.ok === false ||
    Boolean(result.error) ||
    ['error', 'failed', 'failure'].includes(status)
  );
}

/**
 * Safely evaluate a reflex condition. Symbolic success/failure conditions cover
 * generic tool outcomes; numeric conditions retain the inherited result.path form.
 */
function _evaluateReflexCondition(condition: unknown, result: unknown): boolean {
  const raw = String(condition || '').trim();
  const symbolic = raw.toLowerCase();
  if (['error', 'failed', 'failure'].includes(symbolic)) return _toolResultFailed(result);
  if (['ok', 'success', 'succeeded'].includes(symbolic)) return !_toolResultFailed(result);

  const match = raw.match(
    /^result\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(===|!==|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/,
  );
  if (!match) return false;

  const [, path, op, rawNum] = match;
  const target = Number(rawNum);

  let value: unknown = result;
  for (const key of path.split('.')) {
    if (value == null || typeof value !== 'object') return false;
    value = (value as Record<string, unknown>)[key];
  }

  const left = Number(value);
  if (!Number.isFinite(left)) return op === '!==';

  switch (op) {
    case '===':
      return left === target;
    case '!==':
      return left !== target;
    case '>=':
      return left >= target;
    case '<=':
      return left <= target;
    case '>':
      return left > target;
    case '<':
      return left < target;
    default:
      return false;
  }
}

// Checks reflex skills against the policy owned by the agent tool and policy layer.
export function checkReflexSkills(
  toolName: unknown,
  toolResult: unknown,
  allSkills: unknown,
): NormalizedSkill[] {
  const source = Array.isArray(allSkills)
    ? allSkills
    : isRecord(allSkills) && Array.isArray(allSkills.skills)
      ? allSkills.skills
      : [];
  if (!source.length) return [];
  const normalized = source.map((skill, index) => normalizeSkill(skill, index));
  const requestedTool = String(toolName || '').trim();
  return normalized.filter((skill) => {
    if (skill.type !== 'reflex') return false;
    const triggerTool = String(skill.reflexTrigger?.tool || '').trim();
    if (!triggerTool || (triggerTool !== '*' && triggerTool !== requestedTool)) return false;
    const _condition = String(skill.reflexTrigger?.condition || '');
    if (!_condition) return true;
    return _evaluateReflexCondition(_condition, toolResult);
  });
}

// ── Context loader ────────────────────────────────────────────────────────────

export async function loadSkillContext({
  settings,
  userInput,
  conversation,
  role = '',
  offloadedIds = null,
  toolset = 'structured',
}: SkillSelectionOptions): Promise<SkillContext> {
  if (settings?.skills_enabled === false) {
    return {
      enabled: false,
      profile: resolveActiveSkillProfile(settings),
      cards: [],
      active: [],
      available: 0,
      tokenBudget: Number(settings?.skills_token_budget || _DEFAULT_SKILLS_TOKEN_BUDGET),
      maxActive: Number(settings?.skills_max_active || _DEFAULT_SKILLS_MAX_ACTIVE),
      tokensUsed: 0,
      loadError: '',
      role,
    };
  }

  const _profile = resolveActiveSkillProfile(settings);

  try {
    const _result = await listSkillDefinitions(_profile);
    const _normalizedSkills = Array.isArray(_result?.skills)
      ? _result.skills.map((s: BridgeSkillDefinition, i: number) => normalizeSkill(s, i))
      : [];
    // Count only role-relevant skills as "available" so the diagnostic line is honest.
    const _roleRelevant = _normalizedSkills.filter((s) => skillMatchesRole(s, role));
    const _selected = selectSkillsForPrompt(_normalizedSkills, {
      userInput,
      conversation,
      settings,
      role,
      offloadedIds,
      toolset,
    });

    return {
      enabled: true,
      profile: _result?.profile || _profile,
      available: _roleRelevant.length,
      role,
      loadError: '',
      ..._selected,
    };
  } catch (err: unknown) {
    return {
      enabled: true,
      profile: _profile,
      cards: [],
      active: [],
      available: 0,
      tokenBudget: Number(settings?.skills_token_budget || _DEFAULT_SKILLS_TOKEN_BUDGET),
      maxActive: Number(settings?.skills_max_active || _DEFAULT_SKILLS_MAX_ACTIVE),
      tokensUsed: 0,
      loadError: errorMessage(err, 'Failed to load skills'),
      role,
    };
  }
}
