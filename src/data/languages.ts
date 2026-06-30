import { languages } from '@codemirror/language-data'

export interface LanguageOption {
  name: string
  search: string
  extensions: string[]
  preferred_extension: string | null
}

export interface FeaturedLanguage {
  name: string
  badge: string
  accent: string
}

const preferred_extensions: Record<string, string> = {
  'C++': 'cpp',
  CSS: 'css',
  HTML: 'html',
  Java: 'java',
  JavaScript: 'js',
  JSON: 'json',
  Python: 'py',
  TypeScript: 'ts',
}

export const language_options: LanguageOption[] = [
  {
    name: 'Plain Text',
    search: 'plain text txt',
    extensions: ['txt'],
    preferred_extension: 'txt',
  },
  ...languages.map((language) => ({
    name: language.name,
    search: [language.name, ...language.alias, ...language.extensions].join(' ').toLowerCase(),
    extensions: [...language.extensions],
    preferred_extension: preferred_extensions[language.name] ?? language.extensions[0] ?? null,
  })),
]

export const featured_languages: FeaturedLanguage[] = [
  { name: 'Python', badge: 'Py', accent: '#4b8bbe' },
  { name: 'JavaScript', badge: 'JS', accent: '#d6ad28' },
  { name: 'TypeScript', badge: 'TS', accent: '#3178c6' },
  { name: 'C++', badge: 'C++', accent: '#7764c4' },
  { name: 'Java', badge: 'J', accent: '#d66b3d' },
  { name: 'HTML', badge: 'HTML', accent: '#d85d43' },
  { name: 'CSS', badge: 'CSS', accent: '#3c91c7' },
  { name: 'JSON', badge: '{ }', accent: '#739657' },
]

export function get_language_option(language_name: string) {
  return language_options.find((language) => language.name === language_name) ?? language_options[0]
}

export function get_language_for_file(file_path: string) {
  const file_name = file_path.split(/[\\/]/).pop() ?? file_path
  const lower_name = file_name.toLowerCase()
  const matching_language = languages.find((language) => {
    if (language.filename) {
      language.filename.lastIndex = 0

      if (language.filename.test(file_name)) {
        return true
      }
    }

    return language.extensions.some((extension) => lower_name.endsWith(`.${extension.toLowerCase()}`))
  })

  return matching_language?.name ?? 'Plain Text'
}
