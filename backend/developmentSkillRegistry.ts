/** Registers progressive software-development procedures without modifying the inherited catalog. */
import { BUILTIN_SKILLS } from './builtinSkills.js'
import { DEVELOPMENT_SKILLS } from './developmentSkills.js'

const knownSkillIds = new Set(BUILTIN_SKILLS.map((skill) => String(skill.id || '')))
for (const skill of DEVELOPMENT_SKILLS) {
  if (!knownSkillIds.has(skill.id)) {
    BUILTIN_SKILLS.push(skill)
    knownSkillIds.add(skill.id)
  }
}
