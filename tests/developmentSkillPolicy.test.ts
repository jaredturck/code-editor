import { describe, expect, it } from 'vitest'

import '../backend/developmentSkillRegistry'
import { BUILTIN_SKILLS } from '../backend/builtinSkills'
import { DEVELOPMENT_SKILLS } from '../backend/developmentSkills'

function skill(id: string) {
  return DEVELOPMENT_SKILLS.find((entry) => entry.id === id)!
}

describe('model-driven development skills', () => {
  it('registers the development procedures in the shared built-in skill catalog', () => {
    const ids = new Set(BUILTIN_SKILLS.map((entry) => entry.id))
    expect(ids.has('orbit-development-environment')).toBe(true)
    expect(ids.has('orbit-browser-application-verification')).toBe(true)
    expect(ids.has('orbit-software-development-lifecycle')).toBe(true)
  })

  it('keeps browser verification advisory for actual browser targets rather than JavaScript or TypeScript policy', () => {
    const browser = skill('orbit-browser-application-verification')
    const text = `${browser.summary}\n${browser.instructions}\n${browser.examples.join('\n')}`.toLowerCase()

    expect(text).toContain('javascript or typescript alone does not imply browser verification')
    expect(text).toContain('typescript node cli change')
    expect(text).toContain('browser verification is irrelevant')
    expect(text).toContain('decide from the actual project and change')
  })

  it('encourages isolated Python environments without replacing an existing project environment manager', () => {
    const environment = skill('orbit-development-environment')
    const text = `${environment.instructions}\n${environment.examples.join('\n')}`

    expect(text).toContain('If the project already uses uv, Poetry, Pipenv, Conda')
    expect(text).toContain('strongly prefer a project-local .venv')
    expect(text).toContain('Never depend on global/system pip')
    expect(text).toContain('do not create a competing .venv/pip setup')
  })
})
