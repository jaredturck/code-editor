import { useState, type CSSProperties } from 'react'
import { featured_languages } from '../data/languages'
import LanguageSelector from './LanguageSelector'

interface NewFileModalProps {
  onClose: () => void
  onCreate: (language: string) => void
}

function NewFileModal({ onClose, onCreate }: NewFileModalProps) {
  const [show_all_languages, set_show_all_languages] = useState(false)

  return (
    <div
      aria-label="New file dialog backdrop"
      className="absolute inset-0 z-[305] flex items-center justify-center bg-black/50 px-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="new-file-title"
        aria-modal="true"
        className="flex max-h-[min(78vh,700px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--modal-start)] to-[var(--modal-end)] shadow-[0_28px_100px_rgba(0,0,0,0.65)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        {!show_all_languages ? (
          <>
            <div className="relative px-7 pb-3 pt-7">
              <button
                aria-label="Close new file dialog"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-lg text-[var(--muted)] hover:bg-white/10 hover:text-[var(--text)]"
                onClick={onClose}
                title="Close"
                type="button"
              >
                ×
              </button>

              <h2 className="pr-10 text-xl font-semibold text-[var(--text)]" id="new-file-title">
                Create a new file
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Choose a language and start with the right editor mode and file extension.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 overflow-auto px-7 py-4 sm:grid-cols-3 md:grid-cols-4">
              {featured_languages.map((language) => (
                <button
                  className="language-card group flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-4 text-[var(--text)] shadow-sm transition hover:-translate-y-0.5 hover:border-[color:var(--language-accent)] hover:bg-white/[0.055] hover:shadow-[0_12px_35px_color-mix(in_srgb,var(--language-accent)_18%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--language-accent)]"
                  key={language.name}
                  onClick={() => onCreate(language.name)}
                  style={{ '--language-accent': language.accent } as CSSProperties}
                  type="button"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-[color:color-mix(in_srgb,var(--language-accent)_72%,#1b1b1e)] text-sm font-semibold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_24px_color-mix(in_srgb,var(--language-accent)_25%,transparent)] transition group-hover:scale-105">
                    {language.badge}
                  </span>
                  <span className="text-sm font-medium">{language.name}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-black/5 px-7 py-5">
              <button
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"
                onClick={() => onCreate('Plain Text')}
                type="button"
              >
                Create plain text
              </button>
              <button
                className="rounded-lg bg-sky-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-sky-950/20 hover:bg-sky-500"
                onClick={() => set_show_all_languages(true)}
                type="button"
              >
                Browse all languages…
              </button>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative px-7 pb-3 pt-7">
              <button
                aria-label="Close new file dialog"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-lg text-[var(--muted)] hover:bg-white/10 hover:text-[var(--text)]"
                onClick={onClose}
                title="Close"
                type="button"
              >
                ×
              </button>
              <h2 className="pr-10 text-xl font-semibold text-[var(--text)]">Choose another language</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">Search the complete set of CodeMirror language modes.</p>
            </div>

            <div className="min-h-0 flex-1 px-5 pb-5">
              <div className="flex h-[min(58vh,480px)] min-h-72 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--menu-bg)]">
                <LanguageSelector
                  onBack={() => set_show_all_languages(false)}
                  onClose={onClose}
                  onSelect={onCreate}
                  placeholder="Search languages"
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default NewFileModal
