export const ORB_SIZES = {
  small: 56,
  medium: 72,
  large: 140,
} as const;

export type OrbSizeName = keyof typeof ORB_SIZES;

export interface AccentPreset {
  label: string;
  main: string;
  soft: string;
  rgb: string;
  secondary: string;
  orbHot: string;
  orbWarm: string;
  orbBright: string;
}

// Solid hint/accent colours. These are theme-neutral building blocks; each theme below points at
// one of these as its default so the hint colour matches the palette out of the box. Users can still
// override the hint from Appearance settings.
export const ORB_ACCENT_PRESETS = {
  blue: {
    label: 'Blue',
    main: '#6C9EFF',
    soft: '#8DB4FF',
    rgb: '108,158,255',
    secondary: '#22D3EE',
    orbHot: '#6C9EFF',
    orbWarm: '#A855F7',
    orbBright: '#DCE8FF',
  },
  purple: {
    label: 'Purple',
    main: '#A855F7',
    soft: '#C084FC',
    rgb: '168,85,247',
    secondary: '#6C9EFF',
    orbHot: '#A855F7',
    orbWarm: '#6C9EFF',
    orbBright: '#F0E5FF',
  },
  cyan: {
    label: 'Cyan',
    main: '#22D3EE',
    soft: '#67E8F9',
    rgb: '34,211,238',
    secondary: '#6C9EFF',
    orbHot: '#22D3EE',
    orbWarm: '#3B82F6',
    orbBright: '#E2FBFF',
  },
  green: {
    label: 'Green',
    main: '#34D399',
    soft: '#6EE7B7',
    rgb: '52,211,153',
    secondary: '#22D3EE',
    orbHot: '#34D399',
    orbWarm: '#22D3EE',
    orbBright: '#E5FFF5',
  },
  rose: {
    label: 'Rose',
    main: '#F472B6',
    soft: '#F9A8D4',
    rgb: '244,114,182',
    secondary: '#A855F7',
    orbHot: '#F472B6',
    orbWarm: '#A855F7',
    orbBright: '#FFF0F7',
  },
  amber: {
    label: 'Amber',
    main: '#F59E0B',
    soft: '#FBBF24',
    rgb: '245,158,11',
    secondary: '#FB7185',
    orbHot: '#FF8A1F',
    orbWarm: '#FBBF24',
    orbBright: '#FFF4D6',
  },
  clay: {
    label: 'Clay',
    main: '#C96442',
    soft: '#D98368',
    rgb: '201,100,66',
    secondary: '#D9A066',
    orbHot: '#C96442',
    orbWarm: '#D9A066',
    orbBright: '#F2D9CC',
  },
  red: {
    label: 'Red',
    main: '#EF4444',
    soft: '#F87171',
    rgb: '239,68,68',
    secondary: '#FB923C',
    orbHot: '#EF4444',
    orbWarm: '#FB7185',
    orbBright: '#FFE4E4',
  },
  orange: {
    label: 'Orange',
    main: '#FB923C',
    soft: '#FDBA74',
    rgb: '251,146,60',
    secondary: '#F59E0B',
    orbHot: '#FB923C',
    orbWarm: '#FBBF24',
    orbBright: '#FFEAD6',
  },
  yellow: {
    label: 'Yellow',
    main: '#FACC15',
    soft: '#FDE047',
    rgb: '250,204,21',
    secondary: '#FB923C',
    orbHot: '#FACC15',
    orbWarm: '#FB923C',
    orbBright: '#FFF8D6',
  },
  lime: {
    label: 'Lime',
    main: '#A6E22E',
    soft: '#C6F25E',
    rgb: '166,226,46',
    secondary: '#34D399',
    orbHot: '#A6E22E',
    orbWarm: '#84CC16',
    orbBright: '#ECFFCC',
  },
  emerald: {
    label: 'Emerald',
    main: '#10B981',
    soft: '#34D399',
    rgb: '16,185,129',
    secondary: '#22D3EE',
    orbHot: '#10B981',
    orbWarm: '#34D399',
    orbBright: '#D6FFEF',
  },
  teal: {
    label: 'Teal',
    main: '#2DD4BF',
    soft: '#5EEAD4',
    rgb: '45,212,191',
    secondary: '#22D3EE',
    orbHot: '#2DD4BF',
    orbWarm: '#14B8A6',
    orbBright: '#D6FFF8',
  },
  sky: {
    label: 'Sky',
    main: '#38BDF8',
    soft: '#7DD3FC',
    rgb: '56,189,248',
    secondary: '#6C9EFF',
    orbHot: '#38BDF8',
    orbWarm: '#22D3EE',
    orbBright: '#DCF3FF',
  },
  indigo: {
    label: 'Indigo',
    main: '#6366F1',
    soft: '#818CF8',
    rgb: '99,102,241',
    secondary: '#A855F7',
    orbHot: '#6366F1',
    orbWarm: '#818CF8',
    orbBright: '#E5E7FF',
  },
  violet: {
    label: 'Violet',
    main: '#8B5CF6',
    soft: '#A78BFA',
    rgb: '139,92,246',
    secondary: '#6C9EFF',
    orbHot: '#8B5CF6',
    orbWarm: '#A78BFA',
    orbBright: '#EFE5FF',
  },
  fuchsia: {
    label: 'Fuchsia',
    main: '#D946EF',
    soft: '#E879F9',
    rgb: '217,70,239',
    secondary: '#F472B6',
    orbHot: '#D946EF',
    orbWarm: '#C084FC',
    orbBright: '#FBE5FF',
  },
  magenta: {
    label: 'Magenta',
    main: '#EC4899',
    soft: '#F472B6',
    rgb: '236,72,153',
    secondary: '#A855F7',
    orbHot: '#EC4899',
    orbWarm: '#F472B6',
    orbBright: '#FFE5F2',
  },
  slate: {
    label: 'Slate',
    main: '#94A3B8',
    soft: '#CBD5E1',
    rgb: '148,163,184',
    secondary: '#64748B',
    orbHot: '#94A3B8',
    orbWarm: '#64748B',
    orbBright: '#EAF0F7',
  },
} as const satisfies Record<string, AccentPreset>;

export type OrbAccentName = keyof typeof ORB_ACCENT_PRESETS;

// Each theme carries a default accent key so its hint colour coordinates with the palette.
export const ORB_THEME_PRESETS = {
  dark: { label: 'Dark', accent: 'blue' },
  light: { label: 'Light', accent: 'blue' },
  slate: { label: 'Slate', accent: 'amber' },
  rose: { label: 'Rose', accent: 'rose' },
  ocean: { label: 'Ocean', accent: 'cyan' },
  ember: { label: 'Ember', accent: 'clay' },
  dracula: { label: 'Dracula', accent: 'purple' },
  oneDark: { label: 'One Dark', accent: 'blue' },
  monokai: { label: 'Monokai', accent: 'green' },
  nord: { label: 'Nord', accent: 'cyan' },
  tokyoNight: { label: 'Tokyo Night', accent: 'blue' },
  nightOwl: { label: 'Night Owl', accent: 'blue' },
  solarizedDark: { label: 'Solarized', accent: 'cyan' },
  githubDark: { label: 'GitHub', accent: 'blue' },
} as const satisfies Record<string, { label: string; accent: OrbAccentName }>;

export type OrbThemeName = keyof typeof ORB_THEME_PRESETS;

export function normalizeOrbSize(value: unknown): OrbSizeName {
  return value === 'small' || value === 'large' ? value : 'medium';
}

export function normalizeOrbTheme(value: unknown): OrbThemeName {
  // Legacy alias: the warm-grey theme was renamed 'claude' → 'ember'. Preserve old saved selections.
  if (value === 'claude') return 'ember';
  return typeof value === 'string' && value in ORB_THEME_PRESETS ? (value as OrbThemeName) : 'dark';
}

export function normalizeOrbAccent(value: unknown): OrbAccentName {
  return typeof value === 'string' && value in ORB_ACCENT_PRESETS
    ? (value as OrbAccentName)
    : 'blue';
}

// Resolves the effective accent name. An explicit preset wins; anything else (the 'auto' sentinel,
// undefined, or a stale value) falls back to the selected theme's default so hints follow the theme.
export function resolveAccentName(theme: unknown, accent: unknown): OrbAccentName {
  if (typeof accent === 'string' && accent in ORB_ACCENT_PRESETS) return accent as OrbAccentName;
  return ORB_THEME_PRESETS[normalizeOrbTheme(theme)].accent;
}

export function orbSizePixels(value: unknown): number {
  return ORB_SIZES[normalizeOrbSize(value)];
}

export function accentPreset(value: unknown): AccentPreset {
  return ORB_ACCENT_PRESETS[normalizeOrbAccent(value)];
}

// Theme-aware accent resolution (use this where the active theme is known so 'auto' follows it).
export function resolveAccentPreset(theme: unknown, accent: unknown): AccentPreset {
  return ORB_ACCENT_PRESETS[resolveAccentName(theme, accent)];
}
