import logo from '../assets/logo.png'

function EditorPanel() {
  return (
    <section aria-label="Editor panel" className="relative min-h-0 overflow-hidden bg-[var(--editor-bg)]">
      <div className="flex h-full items-center justify-center">
        <img
          alt="Code editor"
          className="app-logo h-auto w-[clamp(280px,34vw,520px)] max-h-[62%] max-w-[72%] select-none object-contain opacity-[0.08]"
          draggable={false}
          src={logo}
        />
      </div>
    </section>
  )
}

export default EditorPanel
