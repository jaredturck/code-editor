import ActivityBar from './components/ActivityBar'
import AIChatPanel from './components/AIChatPanel'
import EditorPanel from './components/EditorPanel'
import ExplorerPanel from './components/ExplorerPanel'
import SettingsModal from './components/SettingsModal'
import TerminalPanel from './components/TerminalPanel'
import TopBar from './components/TopBar'
import useEditorState from './hooks/useEditorState'
import usePanelSizes from './hooks/usePanelSizes'

function App() {
  const editor = useEditorState()
  const panels = usePanelSizes(editor.ai_chat_open)
  const window_shape_class = editor.is_maximized
    ? 'h-screen w-screen rounded-none border-0'
    : 'm-px h-[calc(100vh-2px)] w-[calc(100vw-2px)] rounded-lg border border-[var(--window-border)]'
  const editor_grid_style = editor.bottom_panel_open
    ? { gridTemplateRows: `minmax(0, 1fr) ${panels.bottom_panel_height}px` }
    : { gridTemplateRows: 'minmax(0, 1fr)' }

  return (
    <div
      className={`theme-${editor.resolved_theme} ${window_shape_class} relative flex min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--text)] shadow-2xl`}
    >
      {editor.open_menu !== null && (
        <button
          aria-label="Close open menu"
          className="absolute inset-0 z-[150] cursor-default"
          onClick={editor.close_overlays}
          type="button"
        />
      )}

      <TopBar
        aiChatOpen={editor.ai_chat_open}
        isMaximized={editor.is_maximized}
        onCloseMenu={editor.close_overlays}
        onCreateTerminal={editor.create_terminal}
        onHoverMenu={editor.hover_menu}
        onLeaveMenus={editor.leave_menus}
        onOpenFile={editor.open_file_dialog}
        onOpenFolder={editor.open_folder_dialog}
        onSelectTheme={editor.select_theme}
        onSplitTerminal={editor.split_terminal}
        onToggleAiChat={editor.toggle_ai_chat}
        onToggleMenu={editor.toggle_menu}
        openMenu={editor.open_menu}
        themeMode={editor.theme_mode}
      />

      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: editor.ai_chat_open
            ? `48px ${panels.sidebar_width}px minmax(0, 1fr) ${panels.ai_chat_width}px`
            : `48px ${panels.sidebar_width}px minmax(0, 1fr)`,
        }}
      >
        <ActivityBar
          activeSection={editor.active_activity}
          onSelectSection={editor.select_activity}
          onToggleSettings={editor.toggle_settings}
          settingsOpen={editor.settings_open}
        />

        <ExplorerPanel
          activeSection={editor.active_activity}
          onResize={panels.start_sidebar_resize}
        />

        <main className="grid min-h-0" style={editor_grid_style}>
          <EditorPanel />

          {editor.bottom_panel_open && (
            <TerminalPanel
              activeTab={editor.bottom_panel_tab}
              activeTerminalId={editor.active_terminal_id}
              onClosePanel={editor.close_bottom_panel}
              onCreateTerminal={editor.create_terminal}
              onDeleteTerminal={editor.delete_terminal}
              onResizePanel={panels.start_bottom_panel_resize}
              onResizeTerminalList={panels.start_terminal_list_resize}
              onSelectTab={editor.select_bottom_panel_tab}
              onSelectTerminal={editor.select_terminal}
              onSubmitTerminalInput={editor.submit_terminal_input}
              onUpdateTerminalInput={editor.update_terminal_input}
              terminalListWidth={panels.terminal_list_width}
              terminals={editor.terminals}
              visibleTerminals={editor.visible_terminals}
            />
          )}
        </main>

        {editor.ai_chat_open && (
          <AIChatPanel
            onClose={editor.toggle_ai_chat}
            onResize={panels.start_ai_chat_resize}
            width={panels.ai_chat_width}
          />
        )}
      </div>

      {editor.settings_open && (
        <SettingsModal onClose={editor.close_overlays} />
      )}
    </div>
  )
}

export default App
