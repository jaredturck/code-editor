import logo from '../assets/logo.png'
import type { ThemeMode, TopMenu } from '../types/editor'
import Icon from './Icon'
import { MenuDropdown, MenuItem, MenuSeparator } from './MenuDropdown'
import ai_chat_icon from './images/ai-chat.svg'
import close_icon from './images/close.svg'
import maximize_icon from './images/maximize.svg'
import minimize_icon from './images/minimize.svg'
import restore_icon from './images/restore.svg'

interface TopBarProps {
  aiChatOpen: boolean
  canCopy: boolean
  canCut: boolean
  canRedo: boolean
  canUndo: boolean
  hasActiveTextDocument: boolean
  isMaximized: boolean
  openMenu: TopMenu
  recentFiles: string[]
  themeMode: ThemeMode
  onCopy: () => void
  onCreateFile: () => void
  onCreateTerminal: () => void
  onCreateTextFile: () => void
  onCut: () => void
  onFind: () => void
  onHoverMenu: (menu: Exclude<TopMenu, null>) => void
  onLeaveMenus: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onOpenRecent: (file_path: string) => void
  onPaste: () => void
  onRedo: () => void
  onReplace: () => void
  onSave: () => void
  onSaveAs: () => void
  onSelectTheme: (theme: ThemeMode) => void
  onSplitTerminal: () => void
  onToggleAiChat: () => void
  onToggleMenu: (menu: Exclude<TopMenu, null>) => void
  onUndo: () => void
}

const menu_button_class =
  'window-no-drag h-full px-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
const submenu_class =
  'invisible absolute left-full top-0 z-[230] min-w-64 rounded-md border border-[var(--border)] bg-[var(--menu-bg)] py-1 opacity-0 shadow-2xl transition group-hover:visible group-hover:opacity-100'

function get_recent_file_parts(file_path: string) {
  const path_segments = file_path.split(/[\\/]/)
  const name = path_segments.pop() ?? file_path
  const parent_path = path_segments.join(window.editor_api.platform === 'win32' ? '\\' : '/')

  return { name, parent_path }
}

function TopBar({
  aiChatOpen,
  canCopy,
  canCut,
  canRedo,
  canUndo,
  hasActiveTextDocument,
  isMaximized,
  openMenu,
  recentFiles,
  themeMode,
  onCopy,
  onCreateFile,
  onCreateTerminal,
  onCreateTextFile,
  onCut,
  onFind,
  onHoverMenu,
  onLeaveMenus,
  onOpenFile,
  onOpenFolder,
  onOpenRecent,
  onPaste,
  onRedo,
  onReplace,
  onSave,
  onSaveAs,
  onSelectTheme,
  onSplitTerminal,
  onToggleAiChat,
  onToggleMenu,
  onUndo,
}: TopBarProps) {
  return (
    <header className="window-drag-region relative z-[200] flex h-9 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface-1)] text-xs">
      <div className="window-no-drag flex h-full items-center pl-2">
        <img alt="Code editor logo" className="app-logo mr-2 h-4 w-4 object-contain" draggable={false} src={logo} />

        <div className="relative h-full" onMouseEnter={() => onHoverMenu('file')} onMouseLeave={onLeaveMenus}>
          <button
            className={`${menu_button_class} ${openMenu === 'file' ? 'bg-[var(--hover)] text-[var(--text)]' : ''}`}
            onClick={() => onToggleMenu('file')}
            type="button"
          >
            File
          </button>

          {openMenu === 'file' && (
            <MenuDropdown className="left-0">
              <MenuItem onClick={onCreateTextFile}>New Text File</MenuItem>
              <MenuItem onClick={onCreateFile}>New File</MenuItem>
              <MenuSeparator />
              <MenuItem onClick={onOpenFile}>Open File</MenuItem>
              <MenuItem onClick={onOpenFolder}>Open Folder</MenuItem>
              <div className="group relative">
                <button
                  className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)]"
                  type="button"
                >
                  <span>Open Recent</span>
                  <span className="text-[var(--muted)]">›</span>
                </button>

                <div className={submenu_class}>
                  {recentFiles.length === 0 ? (
                    <div className="px-3 py-1 text-xs text-[var(--muted)]">No recent items</div>
                  ) : (
                    recentFiles.map((file_path) => {
                      const file = get_recent_file_parts(file_path)

                      return (
                        <button
                          className="block w-full px-3 py-2 text-left hover:bg-[var(--hover)]"
                          key={file_path}
                          onClick={() => onOpenRecent(file_path)}
                          title={file_path}
                          type="button"
                        >
                          <span className="block truncate text-xs text-[var(--text)]">{file.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                            {file.parent_path || file_path}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
              <MenuSeparator />
              <MenuItem disabled={!hasActiveTextDocument} onClick={onSave} trailing="Ctrl+S">
                Save
              </MenuItem>
              <MenuItem disabled={!hasActiveTextDocument} onClick={onSaveAs} trailing="Ctrl+Shift+S">
                Save As
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => window.editor_api.window.close()}>Close Window</MenuItem>
              <MenuItem onClick={() => window.editor_api.app.exit()}>Exit</MenuItem>
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full" onMouseEnter={() => onHoverMenu('edit')} onMouseLeave={onLeaveMenus}>
          <button
            className={`${menu_button_class} ${openMenu === 'edit' ? 'bg-[var(--hover)] text-[var(--text)]' : ''}`}
            onClick={() => onToggleMenu('edit')}
            type="button"
          >
            Edit
          </button>

          {openMenu === 'edit' && (
            <MenuDropdown className="left-0">
              <MenuItem disabled={!hasActiveTextDocument || !canUndo} onClick={onUndo} trailing="Ctrl+Z">
                Undo
              </MenuItem>
              <MenuItem disabled={!hasActiveTextDocument || !canRedo} onClick={onRedo} trailing="Ctrl+Shift+Z">
                Redo
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={!hasActiveTextDocument || !canCut} onClick={onCut} trailing="Ctrl+X">
                Cut
              </MenuItem>
              <MenuItem disabled={!hasActiveTextDocument || !canCopy} onClick={onCopy} trailing="Ctrl+C">
                Copy
              </MenuItem>
              <MenuItem disabled={!hasActiveTextDocument} onClick={onPaste} trailing="Ctrl+V">
                Paste
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={!hasActiveTextDocument} onClick={onFind} trailing="Ctrl+F">
                Find
              </MenuItem>
              <MenuItem disabled={!hasActiveTextDocument} onClick={onReplace} trailing="Ctrl+H">
                Replace
              </MenuItem>
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full" onMouseEnter={() => onHoverMenu('view')} onMouseLeave={onLeaveMenus}>
          <button
            className={`${menu_button_class} ${openMenu === 'view' ? 'bg-[var(--hover)] text-[var(--text)]' : ''}`}
            onClick={() => onToggleMenu('view')}
            type="button"
          >
            View
          </button>

          {openMenu === 'view' && (
            <MenuDropdown className="left-0">
              <div className="group relative">
                <button
                  className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)]"
                  type="button"
                >
                  <span>Appearance</span>
                  <span className="text-[var(--muted)]">›</span>
                </button>

                <div className={submenu_class}>
                  <MenuItem onClick={() => onSelectTheme('light')} trailing={themeMode === 'light' ? '✓' : undefined}>
                    Light
                  </MenuItem>
                  <MenuItem onClick={() => onSelectTheme('dark')} trailing={themeMode === 'dark' ? '✓' : undefined}>
                    Dark
                  </MenuItem>
                  <MenuItem onClick={() => onSelectTheme('system')} trailing={themeMode === 'system' ? '✓' : undefined}>
                    System
                  </MenuItem>
                </div>
              </div>
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full" onMouseEnter={() => onHoverMenu('terminal')} onMouseLeave={onLeaveMenus}>
          <button
            className={`${menu_button_class} ${openMenu === 'terminal' ? 'bg-[var(--hover)] text-[var(--text)]' : ''}`}
            onClick={() => onToggleMenu('terminal')}
            type="button"
          >
            Terminal
          </button>

          {openMenu === 'terminal' && (
            <MenuDropdown className="left-0">
              <MenuItem onClick={onCreateTerminal}>New Terminal</MenuItem>
              <MenuItem onClick={onSplitTerminal}>Split Terminal</MenuItem>
            </MenuDropdown>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs text-[var(--muted)]">
        code-editor
      </div>

      <div className="window-no-drag ml-auto flex h-full items-stretch">
        <button
          aria-label={aiChatOpen ? 'Hide AI chat' : 'Show AI chat'}
          aria-pressed={aiChatOpen}
          className={`group flex w-10 items-center justify-center hover:bg-[var(--hover)] ${aiChatOpen ? 'bg-[var(--selected)]' : ''}`}
          onClick={onToggleAiChat}
          title={aiChatOpen ? 'Hide AI chat' : 'Show AI chat'}
          type="button"
        >
          <Icon
            className={`h-4 w-4 transition-opacity group-hover:opacity-100 ${aiChatOpen ? 'opacity-100' : 'opacity-65'}`}
            src={ai_chat_icon}
          />
        </button>

        <button
          aria-label="Minimize window"
          className="group flex w-11 items-center justify-center hover:bg-[var(--hover)]"
          onClick={() => window.editor_api.window.minimize()}
          title="Minimize"
          type="button"
        >
          <Icon className="h-3.5 w-3.5 opacity-80 transition-opacity group-hover:opacity-100" src={minimize_icon} />
        </button>

        <button
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          className="group flex w-11 items-center justify-center hover:bg-[var(--hover)]"
          onClick={() => window.editor_api.window.toggle_maximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          type="button"
        >
          <Icon
            className="h-3.5 w-3.5 opacity-80 transition-opacity group-hover:opacity-100"
            src={isMaximized ? restore_icon : maximize_icon}
          />
        </button>

        <button
          aria-label="Close window"
          className="window-close-button group flex w-11 items-center justify-center hover:bg-red-600"
          onClick={() => window.editor_api.window.close()}
          title="Close"
          type="button"
        >
          <Icon className="h-3.5 w-3.5 opacity-80 transition-opacity group-hover:opacity-100" src={close_icon} />
        </button>
      </div>
    </header>
  )
}

export default TopBar
