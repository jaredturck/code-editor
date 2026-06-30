import ActivityBar from './components/ActivityBar'
import EditorPanel from './components/EditorPanel'
import ExplorerPanel from './components/ExplorerPanel'
import TerminalPanel from './components/TerminalPanel'
import TopBar from './components/TopBar'
import useEditorState from './hooks/useEditorState'

function App() {
  const editor = useEditorState()
  const overlay_open = editor.open_menu !== null || editor.settings_open
  const window_shape_class = editor.is_maximized
    ? 'h-screen w-screen rounded-none border-0'
    : 'm-px h-[calc(100vh-2px)] w-[calc(100vw-2px)] rounded-lg border border-[var(--window-border)]'
  const editor_grid_class = editor.bottom_panel_open
    ? 'grid-rows-[minmax(0,1fr)_240px]'
    : 'grid-rows-[minmax(0,1fr)]'

  return (
    <div className={`theme-${editor.resolved_theme} ${window_shape_class} relative flex min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--text)] shadow-2xl`}>
      {overlay_open && (
        <button
          aria-label="Close open menu"
          className="absolute inset-0 z-30 cursor-default"
          onClick={editor.close_overlays}
          type="button"
        />
      )}

      <TopBar
        isMaximized={editor.is_maximized}
        onCloseMenu={editor.close_overlays}
        onCreateTerminal={editor.create_terminal}
        onSelectTheme={editor.select_theme}
        onToggleMenu={editor.toggle_menu}
        openMenu={editor.open_menu}
        themeMode={editor.theme_mode}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[48px_260px_minmax(0,1fr)]">
        <ActivityBar
          activeSection={editor.active_activity}
          onSelectSection={editor.select_activity}
          onToggleSettings={editor.toggle_settings}
          settingsOpen={editor.settings_open}
        />

        <ExplorerPanel activeSection={editor.active_activity} />

        <main className={`grid min-h-0 ${editor_grid_class}`}>
          <EditorPanel />

          {editor.bottom_panel_open && (
            <TerminalPanel
              activeTab={editor.bottom_panel_tab}
              activeTerminal={editor.active_terminal}
              activeTerminalId={editor.active_terminal_id}
              onClosePanel={editor.close_bottom_panel}
              onCreateTerminal={editor.create_terminal}
              onDeleteTerminal={editor.delete_terminal}
              onSelectTab={editor.select_bottom_panel_tab}
              onSelectTerminal={editor.select_terminal}
              onSubmitTerminalInput={editor.submit_terminal_input}
              onUpdateTerminalInput={editor.update_terminal_input}
              terminals={editor.terminals}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
