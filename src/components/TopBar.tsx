import logo from '../assets/logo.png'
import { format_shortcut, get_editor_command, get_effective_keybinding } from '../editor/editorCommands'
import type { EditorCommandId, EditorSettings, TopMenu } from '../types/editor'
import type { EditorCommandState } from './CodeEditor'
import Icon from './Icon'
import { MenuDropdown, MenuItem, MenuSeparator } from './MenuDropdown'
import ai_chat_icon from './images/ai-chat.svg'
import close_icon from './images/close.svg'
import maximize_icon from './images/maximize.svg'
import minimize_icon from './images/minimize.svg'
import restore_icon from './images/restore.svg'

interface TopBarProps {
  aiChatOpen: boolean
  commandState: EditorCommandState
  hasActiveTextDocument: boolean
  isMaximized: boolean
  openMenu: TopMenu
  recentFiles: string[]
  settings: EditorSettings
  onCreateFile: () => void
  onCreateTerminal: () => void
  onCreateTextFile: () => void
  onHoverMenu: (menu: Exclude<TopMenu, null>) => void
  onLeaveMenus: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onOpenRecent: (file_path: string) => void
  onRunEditorCommand: (command_id: EditorCommandId) => void
  onSave: () => void
  onSaveAs: () => void
  onSplitTerminal: () => void
  onToggleAiChat: () => void
  onToggleMenu: (menu: Exclude<TopMenu, null>) => void
  onUpdateSettings: (settings: EditorSettings) => void
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
  commandState,
  hasActiveTextDocument,
  isMaximized,
  openMenu,
  recentFiles,
  settings,
  onCreateFile,
  onCreateTerminal,
  onCreateTextFile,
  onHoverMenu,
  onLeaveMenus,
  onOpenFile,
  onOpenFolder,
  onOpenRecent,
  onRunEditorCommand,
  onSave,
  onSaveAs,
  onSplitTerminal,
  onToggleAiChat,
  onToggleMenu,
  onUpdateSettings,
}: TopBarProps) {
  const command_is_disabled = (command_id: EditorCommandId) => {
    if (!hasActiveTextDocument) {
      return true
    }

    const binding = get_effective_keybinding(settings.keybindings, command_id)

    if (!binding.enabled) {
      return true
    }

    if (command_id === 'undo') {
      return !commandState.can_undo
    }

    if (command_id === 'redo') {
      return !commandState.can_redo
    }

    if (command_id === 'cut' || command_id === 'copy') {
      return !commandState.has_selection
    }

    if (
      (command_id === 'select_next_occurrence' ||
        command_id === 'add_cursor_above' ||
        command_id === 'add_cursor_below') &&
      !settings.editor.multiple_selections
    ) {
      return true
    }

    if (
      (command_id === 'fold' || command_id === 'unfold' || command_id === 'fold_all' || command_id === 'unfold_all') &&
      !settings.editor.code_folding
    ) {
      return true
    }

    return false
  }

  const render_command = (command_id: EditorCommandId) => {
    const command = get_editor_command(command_id)
    const binding = get_effective_keybinding(settings.keybindings, command_id)

    return (
      <MenuItem
        disabled={command_is_disabled(command_id)}
        onClick={() => onRunEditorCommand(command_id)}
        trailing={binding.key ? format_shortcut(binding.key) : undefined}
      >
        {command.label}
      </MenuItem>
    )
  }

  const update_editor_setting = (key: keyof EditorSettings['editor'], value: boolean) => {
    onUpdateSettings({
      ...settings,
      editor_preset: 'custom',
      editor: { ...settings.editor, [key]: value },
    })
  }

  const update_appearance_setting = (key: keyof EditorSettings['appearance'], value: boolean | string) => {
    onUpdateSettings({
      ...settings,
      editor_preset: 'custom',
      appearance: { ...settings.appearance, [key]: value },
    })
  }

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
            <MenuDropdown className="left-0 min-w-60">
              {render_command('undo')}
              {render_command('redo')}
              <MenuSeparator />
              {render_command('cut')}
              {render_command('copy')}
              {render_command('paste')}
              <MenuSeparator />
              {render_command('select_all')}
              {render_command('select_next_occurrence')}
              <MenuSeparator />
              {render_command('toggle_line_comment')}
              <MenuSeparator />
              {render_command('find')}
              {render_command('replace')}
            </MenuDropdown>
          )}
        </div>

        <div className="relative h-full" onMouseEnter={() => onHoverMenu('go')} onMouseLeave={onLeaveMenus}>
          <button
            className={`${menu_button_class} ${openMenu === 'go' ? 'bg-[var(--hover)] text-[var(--text)]' : ''}`}
            onClick={() => onToggleMenu('go')}
            type="button"
          >
            Go
          </button>

          {openMenu === 'go' && (
            <MenuDropdown className="left-0 min-w-60">
              {render_command('go_to_line')}
              {render_command('go_to_matching_bracket')}
              <MenuSeparator />
              {render_command('next_match')}
              {render_command('previous_match')}
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
            <MenuDropdown className="left-0 min-w-56">
              <MenuItem
                onClick={() => update_editor_setting('word_wrap', !settings.editor.word_wrap)}
                trailing={settings.editor.word_wrap ? '✓' : undefined}
              >
                Word Wrap
              </MenuItem>
              <MenuItem
                onClick={() =>
                  update_appearance_setting(
                    'render_whitespace',
                    settings.appearance.render_whitespace === 'all' ? 'off' : 'all',
                  )
                }
                trailing={settings.appearance.render_whitespace === 'all' ? '✓' : undefined}
              >
                Render Whitespace
              </MenuItem>
              <MenuItem
                onClick={() => update_appearance_setting('scroll_past_end', !settings.appearance.scroll_past_end)}
                trailing={settings.appearance.scroll_past_end ? '✓' : undefined}
              >
                Scroll Past End
              </MenuItem>
              <MenuSeparator />
              <div className="group relative">
                <button
                  className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--hover)]"
                  type="button"
                >
                  <span>Appearance</span>
                  <span className="text-[var(--muted)]">›</span>
                </button>

                <div className={submenu_class}>
                  <MenuItem
                    onClick={() => onUpdateSettings({ ...settings, theme_mode: 'light' })}
                    trailing={settings.theme_mode === 'light' ? '✓' : undefined}
                  >
                    Light
                  </MenuItem>
                  <MenuItem
                    onClick={() => onUpdateSettings({ ...settings, theme_mode: 'dark' })}
                    trailing={settings.theme_mode === 'dark' ? '✓' : undefined}
                  >
                    Dark
                  </MenuItem>
                  <MenuItem
                    onClick={() => onUpdateSettings({ ...settings, theme_mode: 'system' })}
                    trailing={settings.theme_mode === 'system' ? '✓' : undefined}
                  >
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
