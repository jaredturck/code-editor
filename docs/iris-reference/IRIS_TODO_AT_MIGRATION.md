# TODO

## Skills — schema-level linked tools/scripts (deferred from the Skills & Prompting slice)

The Skills & Prompting slice shipped the **convention-level** version: a uniform SKILL.md
standard (blank template + the `orbit-skill-authoring` built-in guide skill) with a
`## Tools & scripts` body section where a skill names the tools / `terminal.script` helpers it
relies on.

**Deferred — the schema-level version (owner wants to revisit):** add real structured frontmatter
fields so a skill formally _declares_ its linked capabilities instead of describing them in prose:

- `tools: string[]` — canonical tool names this skill depends on.
- `scripts: string[]` — built-in `terminal.script` helpers (or bundled runnable snippets) the skill ships with.

Plumbing this through touches the most files:

- `src/lib/skillMarkdown.ts` — (de)serialize the new fields (add to `COMPLEX_KEYS`, emit/parse).
- `server/desktopBridge/services/bridgeServiceRuntime.ts` — canonical serialize/parse + `validateSkillInput`.
- `src/lib/agent/agentSkillEngine.ts` — `normalizeSkill` + render the linked tools/scripts into the
  loaded skill body (and optionally bias tool selection toward a loaded skill's declared tools).
- Skills editor UI (settings) — surface/edit the fields.
- Anthropic's bundled-scripts model is the reference; keep it the most faithful version.
