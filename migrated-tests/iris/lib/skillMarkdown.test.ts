/**
 * Guards the SKILL.md editor round-trip: serializeSkillToMarkdown → parseSkillMarkdown must
 * preserve every structural field, so editing a skill as raw Markdown in the Skills panel
 * can never silently corrupt or drop a built-in's metadata (triggers, modelVariants, guard…).
 */
import { describe, expect, it } from 'vitest';
import { serializeSkillToMarkdown, parseSkillMarkdown } from '@/platform/skillMarkdown';

describe('skillMarkdown', () => {
  it('round-trips a skill through SKILL.md without losing structural fields', () => {
    const skill = {
      id: 'orbit-demo',
      title: 'Demo Skill',
      summary: 'When to use the demo.',
      type: 'procedure',
      priority: 7,
      enabled: true,
      guard: false,
      triggers: ['demo', 'example'],
      examples: ['do X', 'do Y'],
      dependencies: ['orbit-safety-rails'],
      modelVariants: { simple: 'short recipe' },
      instructions: '# Demo\n\nFull instructions here.',
    };

    const md = serializeSkillToMarkdown(skill);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('# Demo');

    const parsed = parseSkillMarkdown(md, 'fallback');
    expect(parsed.id).toBe('orbit-demo');
    expect(parsed.title).toBe('Demo Skill');
    expect(parsed.summary).toBe('When to use the demo.');
    expect(parsed.type).toBe('procedure');
    expect(Number(parsed.priority)).toBe(7);
    expect(parsed.enabled).toBe(true);
    expect(parsed.triggers).toEqual(['demo', 'example']);
    expect(parsed.examples).toEqual(['do X', 'do Y']);
    expect(parsed.dependencies).toEqual(['orbit-safety-rails']);
    expect(parsed.modelVariants).toEqual({ simple: 'short recipe' });
    expect(parsed.instructions).toBe('# Demo\n\nFull instructions here.');
  });

  it('preserves a guard flag through the round-trip', () => {
    const md = serializeSkillToMarkdown({ id: 'g', instructions: 'x', guard: true });
    expect(md).toContain('guard: true');
    expect(parseSkillMarkdown(md).guard).toBe(true);
  });

  it('treats content without frontmatter as the instructions body', () => {
    const parsed = parseSkillMarkdown('just some prose', 'my-id');
    expect(parsed.id).toBe('my-id');
    expect(parsed.instructions).toBe('just some prose');
  });
});
