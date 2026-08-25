import type { AccentColor, ThemeMode } from '../types/editor'

export interface ApplicationThemeOption {
  id: ThemeMode
  label: string
  colors: [string, string, string, string]
  default_accent: Exclude<AccentColor, 'auto'>
  light: boolean
}

export interface AccentColorOption {
  id: Exclude<AccentColor, 'auto'>
  label: string
  main: string
  soft: string
  rgb: string
  secondary: string
}

export const accent_color_options: AccentColorOption[] = [
  { id: 'blue', label: 'Blue', main: '#6C9EFF', soft: '#8DB4FF', rgb: '108, 158, 255', secondary: '#22D3EE' },
  { id: 'purple', label: 'Purple', main: '#A855F7', soft: '#C084FC', rgb: '168, 85, 247', secondary: '#6C9EFF' },
  { id: 'cyan', label: 'Cyan', main: '#22D3EE', soft: '#67E8F9', rgb: '34, 211, 238', secondary: '#6C9EFF' },
  { id: 'green', label: 'Green', main: '#34D399', soft: '#6EE7B7', rgb: '52, 211, 153', secondary: '#22D3EE' },
  { id: 'rose', label: 'Rose', main: '#F472B6', soft: '#F9A8D4', rgb: '244, 114, 182', secondary: '#A855F7' },
  { id: 'amber', label: 'Amber', main: '#F59E0B', soft: '#FBBF24', rgb: '245, 158, 11', secondary: '#FB7185' },
  { id: 'clay', label: 'Clay', main: '#C96442', soft: '#D98368', rgb: '201, 100, 66', secondary: '#D9A066' },
  { id: 'red', label: 'Red', main: '#EF4444', soft: '#F87171', rgb: '239, 68, 68', secondary: '#FB923C' },
  { id: 'orange', label: 'Orange', main: '#FB923C', soft: '#FDBA74', rgb: '251, 146, 60', secondary: '#F59E0B' },
  { id: 'yellow', label: 'Yellow', main: '#FACC15', soft: '#FDE047', rgb: '250, 204, 21', secondary: '#FB923C' },
  { id: 'lime', label: 'Lime', main: '#A6E22E', soft: '#C6F25E', rgb: '166, 226, 46', secondary: '#34D399' },
  { id: 'emerald', label: 'Emerald', main: '#10B981', soft: '#34D399', rgb: '16, 185, 129', secondary: '#22D3EE' },
  { id: 'teal', label: 'Teal', main: '#2DD4BF', soft: '#5EEAD4', rgb: '45, 212, 191', secondary: '#22D3EE' },
  { id: 'sky', label: 'Sky', main: '#38BDF8', soft: '#7DD3FC', rgb: '56, 189, 248', secondary: '#6C9EFF' },
  { id: 'indigo', label: 'Indigo', main: '#6366F1', soft: '#818CF8', rgb: '99, 102, 241', secondary: '#A855F7' },
  { id: 'violet', label: 'Violet', main: '#8B5CF6', soft: '#A78BFA', rgb: '139, 92, 246', secondary: '#6C9EFF' },
  { id: 'fuchsia', label: 'Fuchsia', main: '#D946EF', soft: '#E879F9', rgb: '217, 70, 239', secondary: '#F472B6' },
  { id: 'magenta', label: 'Magenta', main: '#EC4899', soft: '#F472B6', rgb: '236, 72, 153', secondary: '#A855F7' },
  { id: 'slate', label: 'Slate', main: '#94A3B8', soft: '#CBD5E1', rgb: '148, 163, 184', secondary: '#64748B' },
]

export const application_theme_options: ApplicationThemeOption[] = [
  {
    id: 'system',
    label: 'System',
    colors: ['#111113', '#f4f4f5', '#38BDF8', '#d4d4d8'],
    default_accent: 'sky',
    light: false,
  },
  {
    id: 'dark',
    label: 'Editor Dark',
    colors: ['#111113', '#18181b', '#38BDF8', '#d4d4d8'],
    default_accent: 'sky',
    light: false,
  },
  {
    id: 'light',
    label: 'Editor Light',
    colors: ['#f4f4f5', '#ffffff', '#38BDF8', '#27272a'],
    default_accent: 'sky',
    light: true,
  },
  {
    id: 'iris-dark',
    label: 'IRIS Dark',
    colors: ['#070817', '#0D0D1A', '#6C9EFF', '#F2F7FF'],
    default_accent: 'blue',
    light: false,
  },
  {
    id: 'iris-light',
    label: 'IRIS Light',
    colors: ['#DCE4EF', '#E6ECF5', '#6C9EFF', '#0F172A'],
    default_accent: 'blue',
    light: true,
  },
  {
    id: 'slate',
    label: 'Slate',
    colors: ['#1F1F1D', '#2A2A27', '#F59E0B', '#FFFAF1'],
    default_accent: 'amber',
    light: false,
  },
  {
    id: 'rose',
    label: 'Rose',
    colors: ['#EAD6E1', '#F7E8F0', '#F472B6', '#301426'],
    default_accent: 'rose',
    light: true,
  },
  {
    id: 'ocean',
    label: 'Ocean',
    colors: ['#091725', '#112A44', '#22D3EE', '#F0F9FF'],
    default_accent: 'cyan',
    light: false,
  },
  {
    id: 'ember',
    label: 'Ember',
    colors: ['#1F1E1D', '#33322F', '#C96442', '#FFFFFF'],
    default_accent: 'clay',
    light: false,
  },
  {
    id: 'dracula',
    label: 'Dracula',
    colors: ['#282A36', '#3C3F52', '#A855F7', '#FFFFFF'],
    default_accent: 'purple',
    light: false,
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    colors: ['#282C34', '#3A3F4B', '#6C9EFF', '#E6E6E6'],
    default_accent: 'blue',
    light: false,
  },
  {
    id: 'monokai',
    label: 'Monokai',
    colors: ['#272822', '#3A3B33', '#34D399', '#FFFFFF'],
    default_accent: 'green',
    light: false,
  },
  {
    id: 'nord',
    label: 'Nord',
    colors: ['#2E3440', '#434C5E', '#22D3EE', '#ECEFF4'],
    default_accent: 'cyan',
    light: false,
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    colors: ['#1A1B26', '#2A2E42', '#6C9EFF', '#C0CAF5'],
    default_accent: 'blue',
    light: false,
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    colors: ['#011627', '#122D44', '#6C9EFF', '#FFFFFF'],
    default_accent: 'blue',
    light: false,
  },
  {
    id: 'solarized-dark',
    label: 'Solarized',
    colors: ['#002B36', '#0E4350', '#22D3EE', '#FDF6E3'],
    default_accent: 'cyan',
    light: false,
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    colors: ['#0D1117', '#21262D', '#6C9EFF', '#F0F6FC'],
    default_accent: 'blue',
    light: false,
  },
]

export function application_theme_is_light(theme: ThemeMode) {
  if (theme === 'system') return false
  return application_theme_options.find((option) => option.id === theme)?.light ?? false
}
