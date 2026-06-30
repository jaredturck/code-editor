import { MenuDropdown, MenuItem, MenuSeparator } from './MenuDropdown'
import type { ThemeMode, TopMenu } from '../types/editor'

interface TopBarProps {
  isMaximized: boolean
  openMenu: TopMenu
  themeMode: ThemeMode
  onCloseMenu: () => void
  onCreateTerminal: () => void
  onSelectTheme: (theme: ThemeMode) => void
  onToggleMenu: (menu: Exclude<TopMenu, null>) => void
}

const menu_button_class = 'window-no-drag h-full px-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'

function TopBar({ isMaximized, openMenu, themeMode, onCloseMenu, onCreateTerminal, onSelectTheme, onToggleMenu }: TopBarProps) {
  return (
    <header className="window-drag-region relative z-40 flex h-9 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface-1)] text-xs">
      <div className="window-no-drag flex h-full items-center pl-2">
        <span aria-label="Code editor logo" className="mr-2" role="img">
          💻
        </span>

        <div className="relative h-full">
          <button className={menu_button_class} onClick={() => onToggleMenu('file')} type="button">
            File
          </button>

          {openMenu === 'file' && (
            <MenuDropdown className="left-0">
              <MenuItem onClick={onCloseMenu}>New Text File</MenuItem>
              <MenuItem onClick={onCloseMenu}>New File</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={onCloseMenu}>Open File</MenuItem>
              <MenuItem onClick={onCloseMenu}>Open Folder</MenuItem>
              <div className="group relative">
                <button className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)]" type="button">
                  <span>Open Recent</span>
                  <span className="text-[var(--muted)]">›</span>
                </button>

                <div className="invisible absolute left-full top-0 min-w-44 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] py-2 opacity-0 shadow-2xl transition group-hover:visible group-hover:opacity-100">
                  <div className="px-3 text-xs text-[var(--muted)]">No recent items</div>
                </div>
              </div>
              <MenuSeparator />
              <MenuItem onClick={onCloseMenu}>Save</MenuItem>
              <MenuItem onClick={onCloseMenu}>Save As</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => window.editor_api.window.close()}>Close Window</MenuItem>
              <MenuItem onClick={() => window.editor_api.app.exit()}>Exit</MenuItem>
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full">
          <button className={menu_button_class} onClick={() => onToggleMenu('edit')} type="button">
            Edit
          </button>

          {openMenu === 'edit' && (
            <MenuDropdown className="left-0">
              <MenuItem onClick={onCloseMenu}>Undo</MenuItem>
              <MenuItem onClick={onCloseMenu}>Redo</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={onCloseMenu}>Cut</MenuItem>
              <MenuItem onClick={onCloseMenu}>Copy</MenuItem>
              <MenuItem onClick={onCloseMenu}>Paste</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={onCloseMenu}>Find</MenuItem>
              <MenuItem onClick={onCloseMenu}>Replace</MenuItem>
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full">
          <button className={menu_button_class} onClick={() => onToggleMenu('view')} type="button">
            View
          </button>

          {openMenu === 'view' && (
            <MenuDropdown className="left-0">
              <div className="group relative">
                <button className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)]" type="button">
                  <span>Appearance</span>
                  <span className="text-[var(--muted)]">›</span>
                </button>

                <div className="invisible absolute left-full top-0 min-w-36 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] py-1 opacity-0 shadow-2xl transition group-hover:visible group-hover:opacity-100">
                  <MenuItem onClick={() => onSelectTheme('light')} trailing={themeMode === 'light' ? '✓' : undefined}>Light</MenuItem>
                  <MenuItem onClick={() => onSelectTheme('dark')} trailing={themeMode === 'dark' ? '✓' : undefined}>Dark</MenuItem>
                  <MenuItem onClick={() => onSelectTheme('system')} trailing={themeMode === 'system' ? '✓' : undefined}>System</MenuItem>
                </div>
              </div>
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full">
          <button className={menu_button_class} onClick={() => onToggleMenu('terminal')} type="button">
            Terminal
          </button>

          {openMenu === 'terminal' && (
            <MenuDropdown className="left-0">
              <MenuItem onClick={onCreateTerminal}>New Terminal</MenuItem>
              <MenuItem onClick={onCloseMenu}>Split Terminal</MenuItem>
            </MenuDropdown>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[var(--muted)]">
        code-editor
      </div>

      <div className="window-no-drag ml-auto flex h-full items-stretch">
        <button
          aria-label="Minimize window"
          className="flex w-11 items-center justify-center text-base text-[var(--text)] hover:bg-[var(--hover)]"
          onClick={() => window.editor_api.window.minimize()}
          title="Minimize"
          type="button"
        >
          −
        </button>

        <button
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          className="flex w-11 items-center justify-center text-sm text-[var(--text)] hover:bg-[var(--hover)]"
          onClick={() => window.editor_api.window.toggle_maximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          type="button"
        >
          {isMaximized ? '❐' : '□'}
        </button>

        <button
          aria-label="Close window"
          className="flex w-11 items-center justify-center text-lg text-[var(--text)] hover:bg-red-600 hover:text-white"
          onClick={() => window.editor_api.window.close()}
          title="Close"
          type="button"
        >
          ×
        </button>
      </div>
    </header>
  )
}

export default TopBar
