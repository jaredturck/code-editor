import { accent_color_options, application_theme_options } from '../../editor/applicationThemes'
import type { AccentColor, EditorSettings, ThemeMode } from '../../types/editor'

interface ApplicationThemeSettingsProps {
  settings: EditorSettings
  onChange: (settings: EditorSettings) => void
}

function ApplicationThemeSettings({ settings, onChange }: ApplicationThemeSettingsProps) {
  const select_theme = (theme_mode: ThemeMode) => onChange({ ...settings, theme_mode })
  const select_accent = (accent_color: AccentColor) => onChange({ ...settings, accent_color })

  return (
    <>
      <section className="mb-6" data-setting-id="theme">
        <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Application theme
        </h3>
        <div className="rounded-2xl border border-[var(--border)] bg-black/[0.04] p-3">
          <p className="mb-3 text-[10px] leading-4 text-[var(--muted)]">
            Choose the palette used by windows, panels, menus and editor chrome.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {application_theme_options.map((option) => {
              const active = settings.theme_mode === option.id
              return (
                <button
                  aria-pressed={active}
                  className={`min-w-0 rounded-xl border p-2 text-left transition hover:bg-[var(--hover)] ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--selected)]'
                      : 'border-[var(--border)] bg-black/[0.025]'
                  }`}
                  key={option.id}
                  onClick={() => select_theme(option.id)}
                  type="button"
                >
                  <span className="flex h-7 overflow-hidden rounded-md border border-black/10">
                    {option.colors.map((color, index) => (
                      <span className="min-w-0 flex-1" key={`${option.id}-${index}`} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--text)]">
                    <span className="truncate">{option.label}</span>
                    {active && <span className="ml-auto text-[var(--accent)]">✓</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <section className="mb-6" data-setting-id="accent-color">
        <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Accent colour
        </h3>
        <div className="rounded-2xl border border-[var(--border)] bg-black/[0.04] p-3">
          <p className="mb-3 text-[10px] leading-4 text-[var(--muted)]">
            Auto uses the coordinated accent for the selected theme. Choose a colour to override it.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button
              aria-label="Automatic accent"
              aria-pressed={settings.accent_color === 'auto'}
              className="group flex w-11 flex-col items-center gap-1 text-[9px] text-[var(--muted)]"
              onClick={() => select_accent('auto')}
              title="Auto"
              type="button"
            >
              <span
                className={`grid h-8 w-8 place-items-center rounded-full border text-[9px] font-semibold transition group-hover:scale-105 ${
                  settings.accent_color === 'auto'
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_0_0_2px_var(--surface-2),0_0_0_4px_var(--accent)]'
                    : 'border-[var(--input-border)] bg-[var(--surface-3)] text-[var(--text)]'
                }`}
              >
                A
              </span>
              <span>Auto</span>
            </button>
            {accent_color_options.map((option) => {
              const active = settings.accent_color === option.id
              return (
                <button
                  aria-label={`${option.label} accent`}
                  aria-pressed={active}
                  className="group flex w-11 flex-col items-center gap-1 text-[9px] text-[var(--muted)]"
                  key={option.id}
                  onClick={() => select_accent(option.id)}
                  title={option.label}
                  type="button"
                >
                  <span
                    className="grid h-8 w-8 place-items-center rounded-full border border-white/10 transition group-hover:scale-105"
                    style={{
                      background: option.main,
                      boxShadow: active ? `0 0 0 2px var(--surface-2), 0 0 0 4px ${option.main}` : undefined,
                    }}
                  >
                    {active && <span className="text-xs font-semibold text-white">✓</span>}
                  </span>
                  <span className="max-w-full truncate">{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </>
  )
}

export default ApplicationThemeSettings
