import { useMemo, useState } from 'react'
import { language_options } from '../data/languages'
import {
  editor_commands,
  format_shortcut,
  get_effective_keybinding,
  keyboard_event_to_shortcut,
  normalize_shortcut_for_platform,
} from '../editor/editorCommands'
import { apply_editor_preset, clone_editor_settings, default_editor_settings } from '../editor/editorSettings'
import type {
  EditorCommandId,
  EditorFeaturePreset,
  EditorSettings,
  RenderWhitespaceMode,
  SuggestionMode,
  ThemeMode,
} from '../types/editor'

interface SettingsModalProps {
  settings: EditorSettings
  onApply: (settings: EditorSettings) => void
  onClose: () => void
}

type SettingsTab = 'general' | 'editor' | 'appearance' | 'suggestions' | 'shortcuts'

const settings_tabs: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'editor', label: 'Editor', icon: '⌨' },
  { id: 'appearance', label: 'Appearance', icon: '◐' },
  { id: 'suggestions', label: 'Suggestions', icon: '✦' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: '⌘' },
]

const search_items: { tab: SettingsTab; label: string; description: string }[] = [
  {
    tab: 'general',
    label: 'Theme',
    description: 'Choose the light, dark, or system appearance.',
  },
  {
    tab: 'general',
    label: 'Default language',
    description: 'Choose the language used by New Text File.',
  },
  {
    tab: 'general',
    label: 'Recent files',
    description: 'Remember recently opened files between launches.',
  },
  {
    tab: 'general',
    label: 'Unsaved documents',
    description: 'Confirm before closing documents with changes.',
  },
  {
    tab: 'general',
    label: 'Editor feature preset',
    description: 'Apply a minimal, balanced, or full editor setup.',
  },
  {
    tab: 'editor',
    label: 'Indentation',
    description: 'Choose tabs or spaces and the default indentation size.',
  },
  {
    tab: 'editor',
    label: 'Auto indent',
    description: 'Re-indent code while typing language-specific structures.',
  },
  {
    tab: 'editor',
    label: 'Bracket closing',
    description: 'Automatically insert closing brackets and quotes.',
  },
  {
    tab: 'editor',
    label: 'Bracket matching',
    description: 'Highlight the matching bracket near the cursor.',
  },
  {
    tab: 'editor',
    label: 'Multiple selections',
    description: 'Allow multiple cursors and rectangular selections.',
  },
  {
    tab: 'editor',
    label: 'Code folding',
    description: 'Enable folding commands and folded ranges.',
  },
  {
    tab: 'editor',
    label: 'Folding controls',
    description: 'Show folding arrows in the editor gutter.',
  },
  {
    tab: 'editor',
    label: 'Word wrap',
    description: 'Wrap long lines to the width of the editor.',
  },
  {
    tab: 'appearance',
    label: 'Line numbers',
    description: 'Show line numbers in the editor gutter.',
  },
  {
    tab: 'appearance',
    label: 'Active line',
    description: 'Highlight the line containing the cursor.',
  },
  {
    tab: 'appearance',
    label: 'Matching selections',
    description: 'Highlight text matching the current selection.',
  },
  {
    tab: 'appearance',
    label: 'Whitespace',
    description: 'Render spaces and tabs with visible markers.',
  },
  {
    tab: 'appearance',
    label: 'Trailing whitespace',
    description: 'Highlight whitespace at the end of lines.',
  },
  {
    tab: 'appearance',
    label: 'Special characters',
    description: 'Mark control and otherwise confusing characters.',
  },
  {
    tab: 'appearance',
    label: 'Scroll past end',
    description: 'Allow the final line to scroll above the bottom edge.',
  },
  {
    tab: 'suggestions',
    label: 'Suggestion mode',
    description: 'Show completions while typing, manually, or not at all.',
  },
  {
    tab: 'suggestions',
    label: 'Accept with Enter',
    description: 'Use Enter to accept the selected suggestion.',
  },
  {
    tab: 'suggestions',
    label: 'Completion details',
    description: 'Show secondary detail text in suggestion rows.',
  },
  {
    tab: 'suggestions',
    label: 'Completion type badges',
    description: 'Show type icons beside suggestions.',
  },
  {
    tab: 'suggestions',
    label: 'Suggestion delay',
    description: 'Choose how long typing waits before opening suggestions.',
  },
  {
    tab: 'shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Change, remove, reset, or disable editor commands.',
  },
]

const section_class = 'rounded-xl border border-[var(--border)] bg-black/[0.06] p-4'
const input_class =
  'h-9 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-xs text-[var(--text)] outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20'

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className={section_class}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        {description && <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{description}</p>}
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[var(--text)]">{title}</div>
        <div className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={`relative h-6 w-11 rounded-full border transition ${
        checked ? 'border-sky-500 bg-sky-500/80' : 'border-[var(--input-border)] bg-[var(--input-bg)]'
      }`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function SelectControl({
  value,
  onChange,
  children,
  label,
}: {
  value: string | number
  onChange: (value: string) => void
  children: React.ReactNode
  label: string
}) {
  return (
    <select
      aria-label={label}
      className={`${input_class} min-w-36`}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {children}
    </select>
  )
}

function SettingsModal({ settings, onApply, onClose }: SettingsModalProps) {
  const [active_tab, set_active_tab] = useState<SettingsTab>('general')
  const [draft, set_draft] = useState(() => clone_editor_settings(settings))
  const [search_query, set_search_query] = useState('')
  const [shortcut_filter, set_shortcut_filter] = useState('')
  const [shortcut_view, set_shortcut_view] = useState<'all' | 'modified' | 'conflicts' | 'unassigned'>('all')
  const [recording_command, set_recording_command] = useState<EditorCommandId | null>(null)

  const search_results = useMemo(() => {
    const query = search_query.trim().toLowerCase()

    if (!query) {
      return []
    }

    const setting_results = search_items.filter((item) =>
      `${item.label} ${item.description} ${item.tab}`.toLowerCase().includes(query),
    )
    const command_results = editor_commands
      .filter((command) => `${command.label} ${command.category}`.toLowerCase().includes(query))
      .map((command) => ({
        tab: 'shortcuts' as const,
        label: command.label,
        description: `${command.category} command · ${format_shortcut(get_effective_keybinding(draft.keybindings, command.id).key)}`,
      }))

    return [...setting_results, ...command_results].slice(0, 30)
  }, [draft.keybindings, search_query])

  const shortcut_conflicts = useMemo(() => {
    const grouped = new Map<string, EditorCommandId[]>()

    for (const command of editor_commands) {
      const binding = get_effective_keybinding(draft.keybindings, command.id)
      const normalized_key = binding.enabled ? normalize_shortcut_for_platform(binding.key) : null

      if (!normalized_key) {
        continue
      }

      grouped.set(normalized_key, [...(grouped.get(normalized_key) ?? []), command.id])
    }

    return new Set(
      [...grouped.values()].filter((command_ids) => command_ids.length > 1).flatMap((command_ids) => command_ids),
    )
  }, [draft.keybindings])

  const filtered_commands = useMemo(() => {
    const query = shortcut_filter.trim().toLowerCase()

    return editor_commands.filter((command) => {
      const binding = get_effective_keybinding(draft.keybindings, command.id)
      const modified = draft.keybindings[command.id] !== undefined
      const conflict = shortcut_conflicts.has(command.id)
      const matches_view =
        shortcut_view === 'all' ||
        (shortcut_view === 'modified' && modified) ||
        (shortcut_view === 'conflicts' && conflict) ||
        (shortcut_view === 'unassigned' && !binding.key)

      return matches_view && `${command.label} ${command.category}`.toLowerCase().includes(query)
    })
  }, [draft.keybindings, shortcut_conflicts, shortcut_filter, shortcut_view])

  const update_general = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
    set_draft((current) => ({ ...current, [key]: value }))
  }

  const update_editor = (key: keyof EditorSettings['editor'], value: boolean | number | string) => {
    set_draft((current) => ({
      ...current,
      editor_preset: 'custom',
      editor: { ...current.editor, [key]: value },
    }))
  }

  const update_appearance = (key: keyof EditorSettings['appearance'], value: boolean | string) => {
    set_draft((current) => ({
      ...current,
      editor_preset: 'custom',
      appearance: { ...current.appearance, [key]: value },
    }))
  }

  const update_suggestions = (key: keyof EditorSettings['suggestions'], value: boolean | number | string) => {
    set_draft((current) => ({
      ...current,
      editor_preset: 'custom',
      suggestions: { ...current.suggestions, [key]: value },
    }))
  }

  const update_keybinding = (command_id: EditorCommandId, enabled: boolean, key: string | null) => {
    set_draft((current) => ({
      ...current,
      keybindings: {
        ...current.keybindings,
        [command_id]: { enabled, key },
      },
    }))
  }

  const reset_keybinding = (command_id: EditorCommandId) => {
    set_draft((current) => {
      const keybindings = { ...current.keybindings }

      delete keybindings[command_id]

      return { ...current, keybindings }
    })
  }

  const reset_active_tab = () => {
    set_draft((current) => {
      if (active_tab === 'general') {
        const reset_settings = apply_editor_preset(current, 'balanced')

        return {
          ...reset_settings,
          theme_mode: default_editor_settings.theme_mode,
          restore_recent_files: default_editor_settings.restore_recent_files,
          confirm_unsaved_close: default_editor_settings.confirm_unsaved_close,
          default_language: default_editor_settings.default_language,
        }
      }

      if (active_tab === 'editor') {
        return {
          ...current,
          editor_preset: 'custom',
          editor: { ...default_editor_settings.editor },
        }
      }

      if (active_tab === 'appearance') {
        return {
          ...current,
          editor_preset: 'custom',
          appearance: { ...default_editor_settings.appearance },
        }
      }

      if (active_tab === 'suggestions') {
        return {
          ...current,
          editor_preset: 'custom',
          suggestions: { ...default_editor_settings.suggestions },
        }
      }

      return { ...current, keybindings: {} }
    })
  }

  const render_general = () => (
    <div className="space-y-4">
      <SettingsSection title="Application" description="Preferences that apply across the whole editor.">
        <SettingRow title="Theme" description="Follow the system appearance or choose a fixed light or dark theme.">
          <SelectControl
            label="Theme"
            onChange={(value) => update_general('theme_mode', value as ThemeMode)}
            value={draft.theme_mode}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </SelectControl>
        </SettingRow>
        <SettingRow
          title="Default language"
          description="Language used when creating a new text file from the File menu."
        >
          <SelectControl
            label="Default language"
            onChange={(value) => update_general('default_language', value)}
            value={draft.default_language}
          >
            {language_options.map((language) => (
              <option key={language.name} value={language.name}>
                {language.name}
              </option>
            ))}
          </SelectControl>
        </SettingRow>
        <SettingRow
          title="Remember recent files"
          description="Keep the five most recent files available after restarting the app."
        >
          <Toggle
            checked={draft.restore_recent_files}
            label="Remember recent files"
            onChange={(checked) => update_general('restore_recent_files', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Confirm unsaved documents"
          description="Ask before closing a text document that contains unsaved changes."
        >
          <Toggle
            checked={draft.confirm_unsaved_close}
            label="Confirm unsaved documents"
            onChange={(checked) => update_general('confirm_unsaved_close', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Editor feature preset"
        description="Presets adjust the editor, appearance, and suggestions tabs together. Changing an individual option switches to Custom."
      >
        <SettingRow
          title="Preset"
          description="Balanced preserves the editor's current defaults and is recommended for most users."
        >
          <SelectControl
            label="Editor feature preset"
            onChange={(value) => {
              if (value === 'custom') {
                update_general('editor_preset', 'custom')
              } else {
                set_draft((current) => apply_editor_preset(current, value as Exclude<EditorFeaturePreset, 'custom'>))
              }
            }}
            value={draft.editor_preset}
          >
            <option value="minimal">Minimal</option>
            <option value="balanced">Balanced</option>
            <option value="full">Full</option>
            <option value="custom">Custom</option>
          </SelectControl>
        </SettingRow>
      </SettingsSection>
    </div>
  )

  const render_editor = () => (
    <div className="space-y-4">
      <SettingsSection title="Indentation" description="Defaults used by newly created and newly opened files.">
        <SettingRow title="Indent using" description="Choose whether indentation inserts spaces or tab characters.">
          <SelectControl
            label="Indent using"
            onChange={(value) => update_editor('default_indent_style', value)}
            value={draft.editor.default_indent_style}
          >
            <option value="spaces">Spaces</option>
            <option value="tabs">Tabs</option>
          </SelectControl>
        </SettingRow>
        <SettingRow title="Indentation size" description="Number of columns represented by one indentation level.">
          <SelectControl
            label="Indentation size"
            onChange={(value) => update_editor('default_indent_size', Number(value))}
            value={draft.editor.default_indent_size}
          >
            {[2, 4, 8].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </SelectControl>
        </SettingRow>
        <SettingRow
          title="Automatic indentation"
          description="Use the active language rules to re-indent code while typing."
        >
          <Toggle
            checked={draft.editor.auto_indent}
            label="Automatic indentation"
            onChange={(checked) => update_editor('auto_indent', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Editing" description="Control automatic editing assistance supplied by CodeMirror.">
        <SettingRow
          title="Auto-close brackets and quotes"
          description="Insert matching closing characters while typing."
        >
          <Toggle
            checked={draft.editor.close_brackets}
            label="Auto-close brackets and quotes"
            onChange={(checked) => update_editor('close_brackets', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Highlight matching brackets"
          description="Highlight the matching bracket when the cursor is beside one."
        >
          <Toggle
            checked={draft.editor.bracket_matching}
            label="Highlight matching brackets"
            onChange={(checked) => update_editor('bracket_matching', checked)}
          />
        </SettingRow>
        <SettingRow title="Multiple selections" description="Allow multiple cursors and rectangular selections.">
          <Toggle
            checked={draft.editor.multiple_selections}
            label="Multiple selections"
            onChange={(checked) => update_editor('multiple_selections', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Layout" description="Control folding and long-line behaviour.">
        <SettingRow title="Code folding" description="Enable syntax-aware folding commands and folded ranges.">
          <Toggle
            checked={draft.editor.code_folding}
            label="Code folding"
            onChange={(checked) => update_editor('code_folding', checked)}
          />
        </SettingRow>
        <SettingRow title="Show folding controls" description="Display fold and unfold arrows beside foldable lines.">
          <Toggle
            checked={draft.editor.fold_gutter}
            label="Show folding controls"
            onChange={(checked) => update_editor('fold_gutter', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Word wrap"
          description="Wrap long lines to the width of the editor instead of scrolling horizontally."
        >
          <Toggle
            checked={draft.editor.word_wrap}
            label="Word wrap"
            onChange={(checked) => update_editor('word_wrap', checked)}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )

  const render_appearance = () => (
    <div className="space-y-4">
      <SettingsSection title="Editor chrome" description="Choose which visual indicators appear around the code.">
        <SettingRow title="Line numbers" description="Show line numbers in the editor gutter.">
          <Toggle
            checked={draft.appearance.line_numbers}
            label="Line numbers"
            onChange={(checked) => update_appearance('line_numbers', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Highlight active line"
          description="Use a subtle background on the line containing the cursor."
        >
          <Toggle
            checked={draft.appearance.highlight_active_line}
            label="Highlight active line"
            onChange={(checked) => update_appearance('highlight_active_line', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Highlight matching selections"
          description="Highlight occurrences that match the selected text."
        >
          <Toggle
            checked={draft.appearance.highlight_selection_matches}
            label="Highlight matching selections"
            onChange={(checked) => update_appearance('highlight_selection_matches', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Whitespace"
        description="Whitespace indicators are useful while cleaning up indentation and pasted code."
      >
        <SettingRow title="Render whitespace" description="Show spaces as dots and tabs as arrows.">
          <SelectControl
            label="Render whitespace"
            onChange={(value) => update_appearance('render_whitespace', value as RenderWhitespaceMode)}
            value={draft.appearance.render_whitespace}
          >
            <option value="off">Off</option>
            <option value="all">All</option>
          </SelectControl>
        </SettingRow>
        <SettingRow title="Highlight trailing whitespace" description="Mark spaces and tabs at the end of lines.">
          <Toggle
            checked={draft.appearance.highlight_trailing_whitespace}
            label="Highlight trailing whitespace"
            onChange={(checked) => update_appearance('highlight_trailing_whitespace', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Show special characters"
          description="Mark control characters and other easily confused characters."
        >
          <Toggle
            checked={draft.appearance.show_special_characters}
            label="Show special characters"
            onChange={(checked) => update_appearance('show_special_characters', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Scrolling">
        <SettingRow title="Scroll past end" description="Allow the last line to scroll above the bottom of the editor.">
          <Toggle
            checked={draft.appearance.scroll_past_end}
            label="Scroll past end"
            onChange={(checked) => update_appearance('scroll_past_end', checked)}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )

  const render_suggestions = () => (
    <div className="space-y-4">
      <SettingsSection
        title="Autocomplete"
        description="These controls configure CodeMirror's existing completion popup. They do not add project indexing or language-server suggestions."
      >
        <SettingRow
          title="Suggestions"
          description="Open automatically while typing, only when requested, or disable completions."
        >
          <SelectControl
            label="Suggestions"
            onChange={(value) => update_suggestions('mode', value as SuggestionMode)}
            value={draft.suggestions.mode}
          >
            <option value="off">Off</option>
            <option value="manual">Manual</option>
            <option value="typing">While typing</option>
          </SelectControl>
        </SettingRow>
        <SettingRow title="Accept with Enter" description="Use Enter to accept the currently selected suggestion.">
          <Toggle
            checked={draft.suggestions.accept_on_enter}
            label="Accept suggestions with Enter"
            onChange={(checked) => update_suggestions('accept_on_enter', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Show completion details"
          description="Display secondary detail text supplied by completion sources."
        >
          <Toggle
            checked={draft.suggestions.show_details}
            label="Show completion details"
            onChange={(checked) => update_suggestions('show_details', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Show type badges"
          description="Display CodeMirror's completion type icons beside suggestions."
        >
          <Toggle
            checked={draft.suggestions.show_type_icons}
            label="Show completion type badges"
            onChange={(checked) => update_suggestions('show_type_icons', checked)}
          />
        </SettingRow>
        <SettingRow
          title="Suggestion delay"
          description="Delay after typing before CodeMirror asks completion sources for results."
        >
          <SelectControl
            label="Suggestion delay"
            onChange={(value) => update_suggestions('delay', Number(value))}
            value={draft.suggestions.delay}
          >
            <option value="0">Immediate</option>
            <option value="100">100 ms</option>
            <option value="200">200 ms</option>
            <option value="350">350 ms</option>
            <option value="500">500 ms</option>
          </SelectControl>
        </SettingRow>
      </SettingsSection>
    </div>
  )

  const render_shortcuts = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex gap-2">
        <input
          className={`${input_class} min-w-0 flex-1`}
          onChange={(event) => set_shortcut_filter(event.target.value)}
          placeholder="Filter commands…"
          value={shortcut_filter}
        />
        <select
          aria-label="Shortcut filter"
          className={`${input_class} w-32`}
          onChange={(event) => set_shortcut_view(event.target.value as typeof shortcut_view)}
          value={shortcut_view}
        >
          <option value="all">All</option>
          <option value="modified">Modified</option>
          <option value="conflicts">Conflicts</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-black/[0.06]">
        <div className="grid grid-cols-[32px_minmax(190px,1fr)_120px_48px] gap-3 border-b border-[var(--border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          <span />
          <span>Command</span>
          <span>Shortcut</span>
          <span />
        </div>
        <div className="max-h-[430px] overflow-y-auto">
          {filtered_commands.map((command) => {
            const binding = get_effective_keybinding(draft.keybindings, command.id)
            const conflict = shortcut_conflicts.has(command.id)
            const modified = draft.keybindings[command.id] !== undefined
            const recording = recording_command === command.id

            return (
              <div
                className="grid min-h-14 grid-cols-[32px_minmax(190px,1fr)_120px_48px] items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
                key={command.id}
              >
                <input
                  aria-label={`Enable ${command.label}`}
                  checked={binding.enabled}
                  className="h-3.5 w-3.5 accent-sky-500"
                  disabled={!command.disableable}
                  onChange={(event) => update_keybinding(command.id, event.target.checked, binding.key)}
                  type="checkbox"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[var(--text)]">
                    <span className="truncate">{command.label}</span>
                    {modified && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] text-sky-400">Modified</span>
                    )}
                    {conflict && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-400">Conflict</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">{command.category}</div>
                </div>
                <button
                  autoFocus={recording}
                  className={`h-8 rounded-md border px-2 text-[10px] outline-none ${
                    recording
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25'
                      : conflict
                        ? 'border-amber-500/60 bg-amber-500/5 text-amber-300'
                        : 'border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text)] hover:bg-[var(--hover)]'
                  }`}
                  onBlur={() => set_recording_command((current) => (current === command.id ? null : current))}
                  onClick={() => set_recording_command(command.id)}
                  onKeyDown={(event) => {
                    if (!recording) {
                      return
                    }

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
                  title="Click, then press a shortcut. Backspace removes the binding."
                  type="button"
                >
                  {recording ? 'Press keys…' : format_shortcut(binding.key)}
                </button>
                <button
                  aria-label={`Reset ${command.label}`}
                  className="h-8 rounded-md text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-25"
                  disabled={!modified}
                  onClick={() => reset_keybinding(command.id)}
                  title="Reset shortcut"
                  type="button"
                >
                  ↺
                </button>
              </div>
            )
          })}
          {filtered_commands.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-[var(--muted)]">No commands match this filter.</div>
          )}
        </div>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">
        Click a shortcut and press a new key combination. Backspace removes the binding. An unassigned command remains
        available from menus; disabling an optional command removes it from menus and shortcuts.
      </p>
    </div>
  )

  const render_tab = () => {
    if (active_tab === 'general') {
      return render_general()
    }

    if (active_tab === 'editor') {
      return render_editor()
    }

    if (active_tab === 'appearance') {
      return render_appearance()
    }

    if (active_tab === 'suggestions') {
      return render_suggestions()
    }

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
        className="flex h-[min(760px,calc(100vh-48px))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--modal-start)] to-[var(--modal-end)] shadow-[0_28px_100px_rgba(0,0,0,0.62)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex h-16 shrink-0 items-center gap-5 border-b border-[var(--border)] px-6">
          <div className="min-w-36">
            <h2 className="text-lg font-semibold text-[var(--text)]" id="settings-title">
              Settings
            </h2>
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">Configure the editor without losing open state</p>
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
                aria-label="Clear settings search"
                className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
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
            title="Close settings"
            type="button"
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav
            className="w-52 shrink-0 border-r border-[var(--border)] bg-black/[0.05] p-3"
            aria-label="Settings sections"
          >
            {settings_tabs.map((tab) => (
              <button
                aria-current={active_tab === tab.id ? 'page' : undefined}
                className={`mb-1 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-xs transition ${
                  active_tab === tab.id
                    ? 'bg-sky-500/12 text-sky-300 shadow-[inset_3px_0_0_#38bdf8]'
                    : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
                }`}
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
                  {search_results.length} {search_results.length === 1 ? 'result' : 'results'} for “{search_query}”
                </div>
                <div className="space-y-2">
                  {search_results.map((result, index) => (
                    <button
                      className="block w-full rounded-xl border border-[var(--border)] bg-black/[0.06] p-4 text-left hover:border-sky-500/50 hover:bg-sky-500/5"
                      key={`${result.tab}-${result.label}-${index}`}
                      onClick={() => {
                        set_active_tab(result.tab)
                        set_search_query('')
                        if (result.tab === 'shortcuts') {
                          set_shortcut_filter(result.label)
                        }
                      }}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-xs font-medium text-[var(--text)]">{result.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-sky-400">{result.tab}</span>
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

        <footer className="flex h-16 shrink-0 items-center justify-between border-t border-[var(--border)] px-6">
          <button
            className="rounded-md px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={reset_active_tab}
            type="button"
          >
            Reset current tab
          </button>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-[var(--input-border)] px-4 py-2 text-xs text-[var(--text)] hover:bg-[var(--hover)]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-sky-500 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-sky-500/15 hover:bg-sky-400"
              onClick={() => {
                onApply(draft)
                onClose()
              }}
              type="button"
            >
              Apply
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default SettingsModal
