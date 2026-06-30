import { useEffect, useMemo, useRef, useState } from 'react'
import { language_options } from '../data/languages'
import { editor_commands, format_shortcut, get_effective_keybinding } from '../editor/editorCommands'
import { apply_editor_preset, clone_editor_settings, default_editor_settings } from '../editor/editorSettings'
import { syntax_color_scheme_options } from '../editor/syntaxThemes'
import type { DiagnosticsSettings, EditorCommandId, EditorSettings } from '../types/editor'

interface SettingsModalProps {
  settings: EditorSettings
  onChange: (settings: EditorSettings) => void
  onClose: () => void
}

type SettingsTab = 'general' | 'editor' | 'appearance' | 'suggestions' | 'diagnostics' | 'ai' | 'shortcuts'

interface SearchItem {
  id: string
  tab: SettingsTab
  label: string
  description: string
}

const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'editor', label: 'Editor', icon: '⌨' },
  { id: 'appearance', label: 'Appearance', icon: '◐' },
  { id: 'suggestions', label: 'Suggestions', icon: '✦' },
  { id: 'diagnostics', label: 'Diagnostics', icon: '!' },
  { id: 'ai', label: 'AI & Ollama', icon: '◇' },
  { id: 'shortcuts', label: 'Shortcuts', icon: '⌘' },
]

const search_items: SearchItem[] = [
  {
    id: 'theme',
    tab: 'general',
    label: 'Theme',
    description: 'Choose light, dark, or system appearance.',
  },
  {
    id: 'preset',
    tab: 'general',
    label: 'Editor feature preset',
    description: 'Apply a minimal, balanced, or full editor setup.',
  },
  {
    id: 'default-language',
    tab: 'general',
    label: 'Default language',
    description: 'Language used by New Text File.',
  },
  {
    id: 'recent-files',
    tab: 'general',
    label: 'Remember recent files',
    description: 'Keep up to five recent file paths.',
  },
  {
    id: 'confirm-close',
    tab: 'general',
    label: 'Confirm unsaved documents',
    description: 'Prompt before closing dirty files or the application.',
  },
  {
    id: 'indentation',
    tab: 'editor',
    label: 'Indentation',
    description: 'Choose tabs or spaces and indentation size.',
  },
  {
    id: 'auto-indent',
    tab: 'editor',
    label: 'Automatic indentation',
    description: 'Indent code according to language syntax.',
  },
  {
    id: 'close-brackets',
    tab: 'editor',
    label: 'Close brackets and quotes',
    description: 'Insert matching brackets and quotes.',
  },
  {
    id: 'bracket-matching',
    tab: 'editor',
    label: 'Bracket matching',
    description: 'Highlight matching bracket pairs.',
  },
  {
    id: 'multiple-selections',
    tab: 'editor',
    label: 'Multiple selections',
    description: 'Allow multiple cursors and rectangular selection.',
  },
  {
    id: 'code-folding',
    tab: 'editor',
    label: 'Code folding',
    description: 'Collapse syntax-aware code regions.',
  },
  {
    id: 'fold-gutter',
    tab: 'editor',
    label: 'Folding controls',
    description: 'Show folding arrows in the gutter.',
  },
  {
    id: 'word-wrap',
    tab: 'editor',
    label: 'Word wrap',
    description: 'Wrap long lines to the editor width.',
  },
  {
    id: 'syntax-color-scheme',
    tab: 'appearance',
    label: 'Syntax color scheme',
    description: 'Choose a semantic color palette for every supported language.',
  },
  {
    id: 'line-numbers',
    tab: 'appearance',
    label: 'Line numbers',
    description: 'Show line numbers in the editor gutter.',
  },
  {
    id: 'active-line',
    tab: 'appearance',
    label: 'Highlight active line',
    description: 'Highlight the line containing the cursor.',
  },
  {
    id: 'selection-matches',
    tab: 'appearance',
    label: 'Highlight matching selections',
    description: 'Highlight text matching the current selection.',
  },
  {
    id: 'whitespace',
    tab: 'appearance',
    label: 'Render whitespace',
    description: 'Display spaces and tabs.',
  },
  {
    id: 'trailing-whitespace',
    tab: 'appearance',
    label: 'Highlight trailing whitespace',
    description: 'Mark whitespace at line endings.',
  },
  {
    id: 'special-characters',
    tab: 'appearance',
    label: 'Special characters',
    description: 'Reveal confusing or control characters.',
  },
  {
    id: 'scroll-past-end',
    tab: 'appearance',
    label: 'Scroll past end',
    description: 'Allow the final line to scroll upward.',
  },
  {
    id: 'suggestion-mode',
    tab: 'suggestions',
    label: 'Suggestion mode',
    description: 'Disable suggestions, show manually, or show while typing.',
  },
  {
    id: 'suggestion-enter',
    tab: 'suggestions',
    label: 'Accept with Enter',
    description: 'Use Enter to accept the selected completion.',
  },
  {
    id: 'suggestion-details',
    tab: 'suggestions',
    label: 'Completion details',
    description: 'Show extra information in completion rows.',
  },
  {
    id: 'suggestion-icons',
    tab: 'suggestions',
    label: 'Completion type badges',
    description: 'Show completion type icons.',
  },
  {
    id: 'suggestion-delay',
    tab: 'suggestions',
    label: 'Suggestion delay',
    description: 'Delay automatic completion popups.',
  },
  {
    id: 'diagnostic-mode',
    tab: 'diagnostics',
    label: 'Diagnostics mode',
    description: 'Run diagnostics while typing, on save, or not at all.',
  },
  {
    id: 'diagnostic-delay',
    tab: 'diagnostics',
    label: 'Diagnostics delay',
    description: 'Wait after editing before analyzing the document.',
  },
  {
    id: 'diagnostic-display',
    tab: 'diagnostics',
    label: 'Diagnostic display',
    description: 'Control squiggles, gutter markers, and hover messages.',
  },
  {
    id: 'enable_python',
    tab: 'diagnostics',
    label: 'Language providers',
    description: 'Enable Ruff, ESLint, TypeScript, and other analyzers.',
  },
  {
    id: 'ollama-url',
    tab: 'ai',
    label: 'Ollama address',
    description: 'Address of the local Ollama server.',
  },
  {
    id: 'ollama-model',
    tab: 'ai',
    label: 'Selected model',
    description: 'Remember the selected local model.',
  },
  {
    id: 'speech-model',
    tab: 'ai',
    label: 'Speech model',
    description: 'Ollama model used for voice transcription.',
  },
  {
    id: 'keyboard-shortcuts',
    tab: 'shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Change, remove, disable, or reset editor commands.',
  },
]

const input_class =
  'h-9 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-xs text-[var(--text)] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/25'

function Toggle({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      aria-checked={checked}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-sky-500/35 ${
        checked ? 'border-sky-400/60 bg-sky-500' : 'border-[var(--input-border)] bg-[var(--surface-3)]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:brightness-110'}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

function SettingRow({
  children,
  description,
  highlighted,
  id,
  label,
}: {
  children: React.ReactNode
  description: string
  highlighted: boolean
  id: string
  label: string
}) {
  return (
    <div
      className={`settings-row flex min-h-16 items-center gap-5 rounded-xl border px-4 py-3 transition ${
        highlighted
          ? 'border-sky-400 bg-sky-500/10 shadow-[0_0_0_3px_rgba(56,189,248,0.12),0_0_32px_rgba(56,189,248,0.15)]'
          : 'border-transparent hover:border-[var(--border)] hover:bg-black/[0.035]'
      }`}
      data-setting-id={id}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[var(--text)]">{label}</div>
        <div className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{title}</h3>
      <div className="rounded-2xl border border-[var(--border)] bg-black/[0.04] p-1">{children}</div>
    </section>
  )
}

function keyboard_event_to_shortcut(event: React.KeyboardEvent) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
    return null
  }

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  parts.push(key)
  return parts.join('-')
}

function SettingsModal({ settings, onChange, onClose }: SettingsModalProps) {
  const [active_tab, set_active_tab] = useState<SettingsTab>('general')
  const [search_query, set_search_query] = useState('')
  const [highlighted_setting, set_highlighted_setting] = useState<string | null>(null)
  const [shortcut_filter, set_shortcut_filter] = useState('')
  const [recording_command, set_recording_command] = useState<EditorCommandId | null>(null)
  const highlight_timer_ref = useRef<number | null>(null)

  const update = (next: EditorSettings) => onChange(clone_editor_settings(next))
  const custom = (next: EditorSettings) => update({ ...next, editor_preset: 'custom' })

  const search_results = useMemo(() => {
    const normalized = search_query.trim().toLowerCase()
    if (!normalized) return []
    return search_items.filter((item) =>
      `${item.label} ${item.description} ${item.tab}`.toLowerCase().includes(normalized),
    )
  }, [search_query])

  const open_search_result = (result: SearchItem) => {
    set_active_tab(result.tab)
    set_search_query('')
    set_highlighted_setting(result.id)

    if (highlight_timer_ref.current !== null) {
      window.clearTimeout(highlight_timer_ref.current)
    }

    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-setting-id="${result.id}"]`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row?.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true })
    })
    highlight_timer_ref.current = window.setTimeout(() => set_highlighted_setting(null), 2200)
  }

  useEffect(() => {
    return () => {
      if (highlight_timer_ref.current !== null) window.clearTimeout(highlight_timer_ref.current)
    }
  }, [])

  const reset_active_tab = () => {
    const next = clone_editor_settings(settings)

    if (active_tab === 'general') {
      next.theme_mode = default_editor_settings.theme_mode
      next.default_language = default_editor_settings.default_language
      next.restore_recent_files = default_editor_settings.restore_recent_files
      next.confirm_unsaved_close = default_editor_settings.confirm_unsaved_close
      next.editor_preset = default_editor_settings.editor_preset
    } else if (active_tab === 'editor') {
      next.editor = { ...default_editor_settings.editor }
      next.editor_preset = 'custom'
    } else if (active_tab === 'appearance') {
      next.appearance = { ...default_editor_settings.appearance }
      next.editor_preset = 'custom'
    } else if (active_tab === 'suggestions') {
      next.suggestions = { ...default_editor_settings.suggestions }
      next.editor_preset = 'custom'
    } else if (active_tab === 'diagnostics') {
      next.diagnostics = { ...default_editor_settings.diagnostics }
    } else if (active_tab === 'ai') {
      next.ai = { ...default_editor_settings.ai }
    } else {
      next.keybindings = {}
    }

    update(next)
  }

  const row = (id: string, label: string, description: string, control: React.ReactNode) => (
    <SettingRow description={description} highlighted={highlighted_setting === id} id={id} label={label}>
      {control}
    </SettingRow>
  )

  const toggle_editor = (key: keyof EditorSettings['editor']) => {
    custom({
      ...settings,
      editor: { ...settings.editor, [key]: !settings.editor[key] },
    })
  }

  const toggle_appearance = (key: keyof EditorSettings['appearance']) => {
    custom({
      ...settings,
      appearance: { ...settings.appearance, [key]: !settings.appearance[key] },
    })
  }

  const toggle_diagnostic = (key: keyof DiagnosticsSettings) => {
    update({
      ...settings,
      diagnostics: {
        ...settings.diagnostics,
        [key]: !settings.diagnostics[key],
      },
    })
  }

  const render_general = () => (
    <>
      <Section title="Application">
        {row(
          'theme',
          'Theme',
          'Choose the application color theme.',
          <select
            className={input_class}
            onChange={(event) =>
              update({
                ...settings,
                theme_mode: event.target.value as EditorSettings['theme_mode'],
              })
            }
            value={settings.theme_mode}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>,
        )}
        {row(
          'preset',
          'Editor feature preset',
          'Apply a useful collection of editor behaviors.',
          <select
            className={input_class}
            onChange={(event) => {
              const preset = event.target.value as EditorSettings['editor_preset']
              update(
                preset === 'custom' ? { ...settings, editor_preset: 'custom' } : apply_editor_preset(settings, preset),
              )
            }}
            value={settings.editor_preset}
          >
            <option value="minimal">Minimal</option>
            <option value="balanced">Balanced</option>
            <option value="full">Full</option>
            <option value="custom">Custom</option>
          </select>,
        )}
        {row(
          'default-language',
          'Default language',
          'Language used by New Text File.',
          <select
            className={`${input_class} max-w-56`}
            onChange={(event) => update({ ...settings, default_language: event.target.value })}
            value={settings.default_language}
          >
            {language_options.map((language) => (
              <option key={language.name} value={language.name}>
                {language.name}
              </option>
            ))}
          </select>,
        )}
      </Section>
      <Section title="Files">
        {row(
          'recent-files',
          'Remember recent files',
          'Persist the five most recently used files.',
          <Toggle
            checked={settings.restore_recent_files}
            onChange={(value) =>
              update({
                ...settings,
                restore_recent_files: value,
                recent_files: value ? settings.recent_files : [],
              })
            }
          />,
        )}
        {row(
          'confirm-close',
          'Confirm unsaved documents',
          'Ask before closing dirty files or exiting.',
          <Toggle
            checked={settings.confirm_unsaved_close}
            onChange={(value) => update({ ...settings, confirm_unsaved_close: value })}
          />,
        )}
      </Section>
    </>
  )

  const render_editor = () => (
    <>
      <Section title="Indentation">
        {row(
          'indentation',
          'Default indentation',
          'Used when creating or opening a new document.',
          <div className="flex gap-2">
            <select
              className={input_class}
              onChange={(event) =>
                custom({
                  ...settings,
                  editor: {
                    ...settings.editor,
                    default_indent_style: event.target.value as 'spaces' | 'tabs',
                  },
                })
              }
              value={settings.editor.default_indent_style}
            >
              <option value="spaces">Spaces</option>
              <option value="tabs">Tabs</option>
            </select>
            <select
              className={input_class}
              onChange={(event) =>
                custom({
                  ...settings,
                  editor: {
                    ...settings.editor,
                    default_indent_size: Number(event.target.value),
                  },
                })
              }
              value={settings.editor.default_indent_size}
            >
              {[2, 4, 8].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>,
        )}
        {row(
          'auto-indent',
          'Automatic indentation',
          'Use language-aware indentation while editing.',
          <Toggle checked={settings.editor.auto_indent} onChange={() => toggle_editor('auto_indent')} />,
        )}
      </Section>
      <Section title="Editing">
        {row(
          'close-brackets',
          'Close brackets and quotes',
          'Automatically insert matching closing characters.',
          <Toggle checked={settings.editor.close_brackets} onChange={() => toggle_editor('close_brackets')} />,
        )}
        {row(
          'bracket-matching',
          'Bracket matching',
          'Highlight the bracket matching the cursor position.',
          <Toggle checked={settings.editor.bracket_matching} onChange={() => toggle_editor('bracket_matching')} />,
        )}
        {row(
          'multiple-selections',
          'Multiple selections',
          'Enable multiple cursors and rectangular selections.',
          <Toggle
            checked={settings.editor.multiple_selections}
            onChange={() => toggle_editor('multiple_selections')}
          />,
        )}
        {row(
          'word-wrap',
          'Word wrap',
          'Wrap long lines to the available editor width.',
          <Toggle checked={settings.editor.word_wrap} onChange={() => toggle_editor('word_wrap')} />,
        )}
      </Section>
      <Section title="Folding">
        {row(
          'code-folding',
          'Code folding',
          'Allow syntax-aware regions to collapse.',
          <Toggle checked={settings.editor.code_folding} onChange={() => toggle_editor('code_folding')} />,
        )}
        {row(
          'fold-gutter',
          'Show folding controls',
          'Display folding arrows beside line numbers.',
          <Toggle
            checked={settings.editor.fold_gutter}
            disabled={!settings.editor.code_folding}
            onChange={() => toggle_editor('fold_gutter')}
          />,
        )}
      </Section>
    </>
  )

  const render_appearance = () => (
    <>
      <Section title="Syntax colors">
        {row(
          'syntax-color-scheme',
          'Syntax color scheme',
          'Apply one semantic color palette across every supported language.',
          <select
            className={input_class}
            onChange={(event) =>
              update({
                ...settings,
                appearance: {
                  ...settings.appearance,
                  syntax_color_scheme: event.target.value as EditorSettings['appearance']['syntax_color_scheme'],
                },
              })
            }
            value={settings.appearance.syntax_color_scheme}
          >
            {syntax_color_scheme_options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>,
        )}
      </Section>
      <Section title="Editor chrome">
        {row(
          'line-numbers',
          'Line numbers',
          'Show line numbers in the gutter.',
          <Toggle checked={settings.appearance.line_numbers} onChange={() => toggle_appearance('line_numbers')} />,
        )}
        {row(
          'active-line',
          'Highlight active line',
          'Subtly highlight the line containing the cursor.',
          <Toggle
            checked={settings.appearance.highlight_active_line}
            onChange={() => toggle_appearance('highlight_active_line')}
          />,
        )}
        {row(
          'selection-matches',
          'Highlight matching selections',
          'Highlight text matching the selected text.',
          <Toggle
            checked={settings.appearance.highlight_selection_matches}
            onChange={() => toggle_appearance('highlight_selection_matches')}
          />,
        )}
        {row(
          'whitespace',
          'Render whitespace',
          'Display spaces and tab characters.',
          <select
            className={input_class}
            onChange={(event) =>
              custom({
                ...settings,
                appearance: {
                  ...settings.appearance,
                  render_whitespace: event.target.value as 'off' | 'all',
                },
              })
            }
            value={settings.appearance.render_whitespace}
          >
            <option value="off">Off</option>
            <option value="all">All</option>
          </select>,
        )}
        {row(
          'trailing-whitespace',
          'Highlight trailing whitespace',
          'Mark whitespace at the end of lines.',
          <Toggle
            checked={settings.appearance.highlight_trailing_whitespace}
            onChange={() => toggle_appearance('highlight_trailing_whitespace')}
          />,
        )}
        {row(
          'special-characters',
          'Show special characters',
          'Reveal confusing control and special characters.',
          <Toggle
            checked={settings.appearance.show_special_characters}
            onChange={() => toggle_appearance('show_special_characters')}
          />,
        )}
        {row(
          'scroll-past-end',
          'Scroll past end',
          'Allow the final line to scroll toward the top.',
          <Toggle
            checked={settings.appearance.scroll_past_end}
            onChange={() => toggle_appearance('scroll_past_end')}
          />,
        )}
      </Section>
    </>
  )

  const render_suggestions = () => (
    <Section title="Autocomplete">
      {row(
        'suggestion-mode',
        'Suggestions',
        'Choose when CodeMirror shows completion suggestions.',
        <select
          className={input_class}
          onChange={(event) =>
            custom({
              ...settings,
              suggestions: {
                ...settings.suggestions,
                mode: event.target.value as EditorSettings['suggestions']['mode'],
              },
            })
          }
          value={settings.suggestions.mode}
        >
          <option value="off">Off</option>
          <option value="manual">Manual</option>
          <option value="typing">While typing</option>
        </select>,
      )}
      {row(
        'suggestion-enter',
        'Accept with Enter',
        'Allow Enter to accept the selected suggestion.',
        <Toggle
          checked={settings.suggestions.accept_on_enter}
          onChange={(value) =>
            custom({
              ...settings,
              suggestions: { ...settings.suggestions, accept_on_enter: value },
            })
          }
        />,
      )}
      {row(
        'suggestion-details',
        'Show completion details',
        'Display descriptive information beside suggestions.',
        <Toggle
          checked={settings.suggestions.show_details}
          onChange={(value) =>
            custom({
              ...settings,
              suggestions: { ...settings.suggestions, show_details: value },
            })
          }
        />,
      )}
      {row(
        'suggestion-icons',
        'Show type badges',
        'Display completion type icons in the popup.',
        <Toggle
          checked={settings.suggestions.show_type_icons}
          onChange={(value) =>
            custom({
              ...settings,
              suggestions: { ...settings.suggestions, show_type_icons: value },
            })
          }
        />,
      )}
      {row(
        'suggestion-delay',
        'Automatic suggestion delay',
        'Wait before opening suggestions while typing.',
        <input
          className={`${input_class} w-24`}
          max={2000}
          min={0}
          onChange={(event) =>
            custom({
              ...settings,
              suggestions: {
                ...settings.suggestions,
                delay: Number(event.target.value),
              },
            })
          }
          step={50}
          type="number"
          value={settings.suggestions.delay}
        />,
      )}
    </Section>
  )

  const render_diagnostics = () => (
    <>
      <Section title="Behavior">
        {row(
          'diagnostic-mode',
          'Diagnostics mode',
          'Analyze on save, after a pause while typing, or not at all.',
          <select
            className={input_class}
            onChange={(event) =>
              update({
                ...settings,
                diagnostics: {
                  ...settings.diagnostics,
                  mode: event.target.value as EditorSettings['diagnostics']['mode'],
                },
              })
            }
            value={settings.diagnostics.mode}
          >
            <option value="off">Off</option>
            <option value="save">On save</option>
            <option value="typing">While typing</option>
          </select>,
        )}
        {row(
          'diagnostic-delay',
          'Analysis delay',
          'Milliseconds to wait after the latest edit.',
          <input
            className={`${input_class} w-28`}
            disabled={settings.diagnostics.mode !== 'typing'}
            max={10000}
            min={500}
            onChange={(event) =>
              update({
                ...settings,
                diagnostics: {
                  ...settings.diagnostics,
                  delay: Number(event.target.value),
                },
              })
            }
            step={250}
            type="number"
            value={settings.diagnostics.delay}
          />,
        )}
      </Section>
      <Section title="Display">
        {row(
          'diagnostic-display',
          'Squiggly underlines',
          'Draw error and warning ranges inside the editor.',
          <Toggle checked={settings.diagnostics.show_squiggles} onChange={() => toggle_diagnostic('show_squiggles')} />,
        )}
        {row(
          'diagnostic-gutter',
          'Gutter markers',
          'Show problem markers beside line numbers.',
          <Toggle checked={settings.diagnostics.show_gutter} onChange={() => toggle_diagnostic('show_gutter')} />,
        )}
        {row(
          'diagnostic-hover',
          'Hover messages',
          'Show diagnostic details when hovering a marked range.',
          <Toggle checked={settings.diagnostics.show_hover} onChange={() => toggle_diagnostic('show_hover')} />,
        )}
        {row(
          'diagnostic-auto-reveal',
          'Reveal Problems on errors',
          'Open the Problems panel when a new error appears.',
          <Toggle
            checked={settings.diagnostics.auto_reveal_problems}
            onChange={() => toggle_diagnostic('auto_reveal_problems')}
          />,
        )}
      </Section>
      <Section title="Language providers">
        {(
          [
            ['enable_python', 'Python · Ruff WASM'],
            ['enable_javascript', 'JavaScript / JSX · ESLint'],
            ['enable_typescript', 'TypeScript / TSX · compiler API'],
            ['enable_css', 'CSS / SCSS / Less · Stylelint'],
            ['enable_html', 'HTML · HTML Validate'],
            ['enable_json', 'JSON / JSONC'],
            ['enable_yaml', 'YAML'],
            ['enable_markdown', 'Markdownlint'],
            ['enable_parser_fallback', 'Other languages · CodeMirror parser'],
          ] as Array<[keyof DiagnosticsSettings, string]>
        ).map(([key, label]) =>
          row(
            key,
            label,
            key === 'enable_parser_fallback'
              ? 'Basic syntax diagnostics for other CodeMirror languages.'
              : 'Analyze unsaved in-memory source without an external executable.',
            <Toggle checked={Boolean(settings.diagnostics[key])} onChange={() => toggle_diagnostic(key)} />,
          ),
        )}
      </Section>
    </>
  )

  const render_ai = () => (
    <Section title="Local Ollama">
      {row(
        'ollama-url',
        'Ollama address',
        'Usually the local Ollama service address.',
        <input
          className={`${input_class} w-64`}
          onBlur={(event) =>
            update({
              ...settings,
              ai: {
                ...settings.ai,
                ollama_url: event.target.value.trim() || default_editor_settings.ai.ollama_url,
              },
            })
          }
          onChange={(event) =>
            update({
              ...settings,
              ai: { ...settings.ai, ollama_url: event.target.value },
            })
          }
          value={settings.ai.ollama_url}
        />,
      )}
      {row(
        'ollama-model',
        'Selected model',
        'The AI panel fills this from models installed in Ollama.',
        <input
          className={`${input_class} w-64`}
          onChange={(event) =>
            update({
              ...settings,
              ai: { ...settings.ai, selected_model: event.target.value },
            })
          }
          placeholder="Select in AI Chat"
          value={settings.ai.selected_model}
        />,
      )}
      {row(
        'speech-model',
        'Speech transcription model',
        'Model installed through Ollama when voice input is enabled.',
        <input
          className={`${input_class} w-72`}
          onChange={(event) =>
            update({
              ...settings,
              ai: { ...settings.ai, speech_model: event.target.value },
            })
          }
          value={settings.ai.speech_model}
        />,
      )}
    </Section>
  )

  const shortcut_conflicts = useMemo(() => {
    const map = new Map<string, number>()
    for (const command of editor_commands) {
      const binding = get_effective_keybinding(settings.keybindings, command.id)
      if (binding.enabled && binding.key) map.set(binding.key, (map.get(binding.key) ?? 0) + 1)
    }
    return map
  }, [settings.keybindings])

  const update_keybinding = (command_id: EditorCommandId, enabled: boolean, key: string | null) => {
    update({
      ...settings,
      keybindings: { ...settings.keybindings, [command_id]: { enabled, key } },
    })
  }

  const filtered_commands = editor_commands.filter((command) =>
    `${command.label} ${command.category}`.toLowerCase().includes(shortcut_filter.toLowerCase()),
  )

  const render_shortcuts = () => (
    <div
      data-setting-id="keyboard-shortcuts"
      className={highlighted_setting === 'keyboard-shortcuts' ? 'rounded-xl ring-2 ring-sky-500/50' : ''}
    >
      <input
        className={`${input_class} mb-3 w-full`}
        onChange={(event) => set_shortcut_filter(event.target.value)}
        placeholder="Filter commands…"
        value={shortcut_filter}
      />
      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        {filtered_commands.map((command) => {
          const binding = get_effective_keybinding(settings.keybindings, command.id)
          const conflict = Boolean(binding.key && (shortcut_conflicts.get(binding.key) ?? 0) > 1)
          const recording = recording_command === command.id
          return (
            <div
              className="grid grid-cols-[36px_minmax(0,1fr)_150px_36px] items-center gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
              key={command.id}
            >
              <Toggle
                checked={binding.enabled}
                disabled={!command.disableable}
                onChange={(enabled) => update_keybinding(command.id, enabled, binding.key)}
              />
              <div className="min-w-0">
                <div className="truncate text-xs text-[var(--text)]">{command.label}</div>
                <div className="text-[9px] text-[var(--muted)]">
                  {command.category}
                  {conflict ? ' · Conflict' : ''}
                </div>
              </div>
              <button
                autoFocus={recording}
                className={`${input_class} truncate ${conflict ? 'border-amber-500 text-amber-300' : ''}`}
                onBlur={() => set_recording_command((current) => (current === command.id ? null : current))}
                onClick={() => set_recording_command(command.id)}
                onKeyDown={(event) => {
                  if (!recording) return
                  event.preventDefault()
                  event.stopPropagation()
                  if (event.key === 'Escape') {
                    set_recording_command(null)
                    return
                  }
                  if (event.key === 'Backspace' || event.key === 'Delete') {
                    update_keybinding(command.id, binding.enabled, null)
                    set_recording_command(null)
                    return
                  }
                  const shortcut = keyboard_event_to_shortcut(event)
                  if (shortcut) {
                    update_keybinding(command.id, binding.enabled, shortcut)
                    set_recording_command(null)
                  }
                }}
                type="button"
              >
                {recording ? 'Press keys…' : format_shortcut(binding.key)}
              </button>
              <button
                aria-label={`Reset ${command.label}`}
                className="h-8 rounded text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
                onClick={() => {
                  const next = { ...settings.keybindings }
                  delete next[command.id]
                  update({ ...settings, keybindings: next })
                }}
                title="Reset"
                type="button"
              >
                ↺
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )

  const render_tab = () => {
    if (active_tab === 'general') return render_general()
    if (active_tab === 'editor') return render_editor()
    if (active_tab === 'appearance') return render_appearance()
    if (active_tab === 'suggestions') return render_suggestions()
    if (active_tab === 'diagnostics') return render_diagnostics()
    if (active_tab === 'ai') return render_ai()
    return render_shortcuts()
  }

  return (
    <div
      aria-label="Settings dialog backdrop"
      className="absolute inset-0 z-[300] flex items-center justify-center bg-black/55 px-5 py-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="flex h-[min(780px,calc(100vh-48px))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--modal-start)] to-[var(--modal-end)] shadow-[0_28px_100px_rgba(0,0,0,0.62)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex h-16 shrink-0 items-center gap-5 border-b border-[var(--border)] px-6">
          <div className="min-w-36">
            <h2 className="text-lg font-semibold text-[var(--text)]" id="settings-title">
              Settings
            </h2>
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">Changes apply immediately</p>
          </div>
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">⌕</span>
            <input
              aria-label="Search settings"
              className={`${input_class} w-full pl-8 pr-8`}
              onChange={(event) => set_search_query(event.target.value)}
              placeholder="Search settings and commands…"
              value={search_query}
            />
            {search_query && (
              <button
                aria-label="Clear search"
                className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 rounded text-[var(--muted)] hover:bg-[var(--hover)]"
                onClick={() => set_search_query('')}
                type="button"
              >
                ×
              </button>
            )}
          </div>
          <button
            aria-label="Close settings"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-[var(--muted)] hover:bg-white/10 hover:text-[var(--text)]"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="w-52 shrink-0 border-r border-[var(--border)] bg-black/[0.05] p-3"
          >
            {tabs.map((tab) => (
              <button
                aria-current={active_tab === tab.id ? 'page' : undefined}
                className={`mb-1 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-xs transition ${active_tab === tab.id ? 'bg-sky-500/12 text-sky-300 shadow-[inset_3px_0_0_#38bdf8]' : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'}`}
                key={tab.id}
                onClick={() => {
                  set_active_tab(tab.id)
                  set_search_query('')
                }}
                type="button"
              >
                <span className="w-4 text-center text-sm">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
            {search_query ? (
              <div>
                <div className="mb-4 text-xs text-[var(--muted)]">
                  {search_results.length} results for “{search_query}”
                </div>
                <div className="space-y-2">
                  {search_results.map((result) => (
                    <button
                      className="block w-full rounded-xl border border-[var(--border)] bg-black/[0.06] p-4 text-left hover:border-sky-500/50 hover:bg-sky-500/5"
                      key={result.id}
                      onClick={() => open_search_result(result)}
                      type="button"
                    >
                      <div className="flex justify-between gap-4">
                        <span className="text-xs font-medium text-[var(--text)]">{result.label}</span>
                        <span className="text-[9px] uppercase tracking-wider text-sky-400">{result.tab}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">{result.description}</p>
                    </button>
                  ))}
                  {search_results.length === 0 && (
                    <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-14 text-center text-xs text-[var(--muted)]">
                      No settings match that search.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              render_tab()
            )}
          </main>
        </div>
        <footer className="flex h-14 shrink-0 items-center justify-between border-t border-[var(--border)] px-6">
          <button
            className="rounded-md px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={reset_active_tab}
            type="button"
          >
            Reset current tab
          </button>
          <span className="text-[10px] text-[var(--muted)]">Settings are saved automatically</span>
        </footer>
      </section>
    </div>
  )
}

export { Toggle }
export default SettingsModal
