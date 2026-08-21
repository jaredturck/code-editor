/**
 * Owns the state, persistence, and bridge interactions for the skills panel.
 *
 * Skills are edited as their FULL SKILL.md (YAML-ish frontmatter + Markdown body) — the
 * canonical on-disk format — instead of a cluttered field-by-field form. The hook
 * (de)serializes between SKILL.md text and the structured skill the /skills/upsert route
 * accepts (validateSkillInput preserves every field; the bridge re-writes the canonical
 * SKILL.md on save), so the round-trip is lossless and the user edits the real document.
 */

import { useCallback, useEffect, useState } from 'react';
import { useOrbSettings } from '@/platform-context/AgentSettingsContext';
import {
  listSkillProfiles,
  listSkillDefinitions,
  upsertSkillDefinition,
  deleteSkillDefinition,
} from '@/platform/desktopBridge';
import type { BridgeSkillDefinition } from '@/platform/desktopBridge';
import { resolveActiveSkillProfile } from '@/platform/skillProfiles';
import {
  serializeSkillToMarkdown,
  parseSkillMarkdown,
  blankSkillMarkdown,
} from '@/platform/skillMarkdown';

/**
 * Owns the active skill profile, selected definition, the SKILL.md editor buffer,
 * persistence, and refresh behavior used by the Skills panel.
 */
export function useSkillsPanel() {
  const { settings } = useOrbSettings();
  const defaultProfile = resolveActiveSkillProfile(settings);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfile] = useState(defaultProfile);
  const [skills, setSkills] = useState<BridgeSkillDefinition[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const refreshProfiles = useCallback(async () => {
    try {
      const result = await listSkillProfiles();
      const list = Array.isArray(result?.profiles) ? result.profiles : [];
      setProfiles((previous) =>
        Array.from(new Set([...list, defaultProfile, ...previous]))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b)),
      );
    } catch {
      // Keep existing profiles.
    }
  }, [defaultProfile]);

  const refreshSkills = useCallback(
    async (profileName: string) => {
      setLoading(true);
      try {
        const result = await listSkillDefinitions(profileName);
        const loaded = Array.isArray(result?.skills) ? result.skills : [];
        setSkills(loaded);
        const keep = loaded.find((skill) => String(skill.id) === String(selectedId));
        const next = keep || loaded[0];
        if (next) {
          setSelectedId(String(next.id));
          setMarkdown(serializeSkillToMarkdown(next));
          setHasDraft(true);
        } else {
          setSelectedId('');
          setMarkdown('');
          setHasDraft(false);
        }
      } catch (error) {
        setSkills([]);
        setSelectedId('');
        setMarkdown('');
        setHasDraft(false);
        setStatus(
          (error as { message?: string } | null | undefined)?.message || 'Failed to load skills.',
        );
      } finally {
        setLoading(false);
      }
    },
    [selectedId],
  );

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    refreshSkills(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Selects a skill and loads its SKILL.md into the editor buffer.
  const selectSkill = (skill: BridgeSkillDefinition) => {
    setSelectedId(String(skill.id));
    setMarkdown(serializeSkillToMarkdown(skill));
    setHasDraft(true);
    setStatus('');
  };

  // Opens a blank SKILL.md template for a new skill.
  const createSkill = () => {
    const id = `skill-${Date.now().toString(36).slice(-6)}`;
    setSelectedId('');
    setMarkdown(blankSkillMarkdown(id));
    setHasDraft(true);
    setStatus('New skill — edit the SKILL.md and Save.');
  };

  // Parses the SKILL.md buffer back to a structured skill and upserts it.
  const saveSkill = async () => {
    if (!hasDraft) return;
    const parsed = parseSkillMarkdown(markdown, selectedId || 'skill');
    if (!parsed?.id || !String(parsed.instructions || '').trim()) {
      setStatus('Need frontmatter with an id/name and a Markdown body before saving.');
      return;
    }
    setSaving(true);
    try {
      const result = await upsertSkillDefinition(profile, parsed as BridgeSkillDefinition);
      const savedId = result?.skill?.id || String(parsed.id);
      setStatus(`Saved: ${savedId}`);
      setSelectedId(String(savedId));
      await refreshProfiles();
      await refreshSkills(result?.profile || profile);
    } catch (error) {
      setStatus(
        (error as { message?: string } | null | undefined)?.message || 'Failed to save skill.',
      );
    } finally {
      setSaving(false);
    }
  };

  // Removes a skill and clears the editor buffer.
  const removeSkill = async (id: string) => {
    if (!id) return;
    setSaving(true);
    try {
      await deleteSkillDefinition(profile, id);
      setStatus(`Deleted: ${id}`);
      setSelectedId('');
      setMarkdown('');
      setHasDraft(false);
      await refreshSkills(profile);
    } catch (error) {
      setStatus(
        (error as { message?: string } | null | undefined)?.message || 'Failed to delete skill.',
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    profiles,
    profile,
    setProfile,
    skills,
    selectedId,
    markdown,
    setMarkdown,
    hasDraft,
    loading,
    saving,
    status,
    refreshSkills,
    selectSkill,
    createSkill,
    saveSkill,
    removeSkill,
  };
}
