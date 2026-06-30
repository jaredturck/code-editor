function ActivityBar() {
  return (
    <aside aria-label="Activity bar" className="border-r border-zinc-800 bg-zinc-900">
      <button
        aria-label="File explorer"
        className="relative flex h-12 w-full items-center justify-center text-lg"
        title="File explorer"
        type="button"
      >
        <span className="absolute left-0 h-8 w-0.5 bg-sky-500" />
        <span aria-hidden="true">📁</span>
      </button>
    </aside>
  )
}

export default ActivityBar
