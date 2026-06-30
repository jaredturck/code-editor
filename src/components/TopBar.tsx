const menu_items = [
  'File',
  'Edit',
  'Selection',
  'View',
  'Go',
  'Run',
  'Terminal',
  'Help',
]

function TopBar() {
  return (
    <header className="relative flex h-9 shrink-0 items-center border-b border-zinc-800 bg-zinc-900 px-3 text-xs">
      <div className="flex items-center gap-4">
        <span aria-label="Code editor logo" role="img">
          💻
        </span>

        <nav aria-label="Application menu">
          <ul className="flex items-center gap-4">
            {menu_items.map((menu_item) => (
              <li key={menu_item}>
                <button className="text-zinc-400 hover:text-zinc-100" type="button">
                  {menu_item}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-zinc-400">
        code-editor
      </div>
    </header>
  )
}

export default TopBar
