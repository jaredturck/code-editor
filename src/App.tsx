import { useRef, useState } from 'react'
import ActivityBar from './components/ActivityBar'
import AIChatPanel from './components/AIChatPanel'
import type { CodeEditorHandle, EditorCommandState } from './components/CodeEditor'
import EditorPanel from './components/EditorPanel'
import ExplorerPanel from './components/ExplorerPanel'
import IndentationPicker from './components/IndentationPicker'
import LanguagePicker from './components/LanguagePicker'
import NewFileModal from './components/NewFileModal'
import NoticeToast from './components/NoticeToast'
import SaveChangesModal from './components/SaveChangesModal'
import SettingsModal from './components/SettingsModal'
import StatusBar from './components/StatusBar'
import TerminalPanel from './components/TerminalPanel'
import TopBar from './components/TopBar'
import useAIChat from './hooks/useAIChat'
import useEditorState from './hooks/useEditorState'
import usePanelSizes from './hooks/usePanelSizes'
import type { EditorCommandId, EditorDiagnostic } from './types/editor'

const initial_editor_command_state: EditorCommandState = {
  can_undo: false,
  can_redo: false,
  can_fold: false,
  can_unfold: false,
  has_selection: false,
  selection_count: 1,
  line: 1,
  column: 1,
}

function App() {
  const editor = useEditorState()
  const chat = useAIChat(editor.settings, editor.apply_settings, editor.active_text_document)
  const panels = usePanelSizes(editor.ai_chat_open)
  const editor_ref = useRef<CodeEditorHandle>(null)
  const [editor_command_state, set_editor_command_state] = useState(initial_editor_command_state)
  const window_shape_class = editor.is_maximized
    ? 'h-screen w-screen rounded-none border-0'
    : 'm-px h-[calc(100vh-2px)] w-[calc(100vw-2px)] rounded-lg border border-[var(--window-border)]'
  const editor_grid_style = {
    gridTemplateRows: `minmax(0, 1fr) ${editor.bottom_panel_open ? panels.bottom_panel_height : 0}px`,
  }

  const run_editor_command = (command_id: EditorCommandId) => {
    editor.close_overlays()
    requestAnimationFrame(() => editor_ref.current?.run_command(command_id))
  }

  const open_diagnostic = (diagnostic: EditorDiagnostic) => {
    editor.open_diagnostic(diagnostic)
    window.setTimeout(() => editor_ref.current?.reveal_diagnostic(diagnostic), 40)
  }

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
        commandState={editor_command_state}
        hasActiveTextDocument={editor.active_text_document !== null}
        isMaximized={editor.is_maximized}
        onCreateFile={editor.open_new_file_modal}
        onCreateTerminal={editor.create_terminal}
        onCreateTextFile={() => editor.create_text_file()}
        onHoverMenu={editor.hover_menu}
        onLeaveMenus={editor.leave_menus}
        onOpenFile={() => void editor.open_file_dialog()}
        onOpenFolder={() => void editor.open_folder_dialog()}
        onOpenRecent={(file_path) => void editor.open_recent_file(file_path)}
        onRunEditorCommand={run_editor_command}
        onSave={() => void editor.save_document()}
        onSaveAs={() => void editor.save_document(true)}
        onSplitTerminal={editor.split_terminal}
        onToggleAiChat={editor.toggle_ai_chat}
        onToggleMenu={editor.toggle_menu}
        onUpdateSettings={editor.apply_settings}
        openMenu={editor.open_menu}
        recentFiles={editor.recent_files}
        settings={editor.settings}
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
          onOpenBrowser={() => void editor.open_browser()}
          onSelectSection={editor.select_activity}
          onToggleSettings={editor.toggle_settings}
          settingsOpen={editor.settings_open}
        />

        <ExplorerPanel activeSection={editor.active_activity} onResize={panels.start_sidebar_resize} />

        <main className="grid min-h-0" style={editor_grid_style}>
          <EditorPanel
            activeDocumentId={editor.active_document_id}
            browserVisible={!editor.overlay_open}
            diagnostics={editor.diagnostics}
            documents={editor.documents}
            editorRef={editor_ref}
            onCloseDocument={editor.close_document}
            onEditorCommandStateChange={set_editor_command_state}
            onFocusDocument={editor.validate_document_path}
            onOpenFilePath={(file_path) => void editor.open_file_path(file_path)}
            onParserDiagnostics={editor.update_parser_diagnostics}
            onSelectDocument={editor.select_document}
            onToggleMarkdownView={editor.toggle_markdown_view}
            onUpdateDocument={editor.update_document}
            settings={editor.settings}
            theme={editor.resolved_theme}
          />

          <TerminalPanel
            activeTab={editor.bottom_panel_tab}
            activeTerminalId={editor.active_terminal_id}
            diagnostics={editor.diagnostics}
            onClosePanel={editor.close_bottom_panel}
            onCreateTerminal={editor.create_terminal}
            onDeleteTerminal={editor.delete_terminal}
            onOpenDiagnostic={open_diagnostic}
            onResizePanel={panels.start_bottom_panel_resize}
            onResizeTerminalList={panels.start_terminal_list_resize}
            onResizeTerminalPanes={editor.resize_terminal_panes}
            onSelectTab={editor.select_bottom_panel_tab}
            onSelectTerminal={editor.select_terminal}
            onTerminalStatusChange={editor.update_terminal_status}
            terminalListWidth={panels.terminal_list_width}
            terminals={editor.terminals}
            visible={editor.bottom_panel_open}
          />
        </main>

        {editor.ai_chat_open && (
          <AIChatPanel
            chat={chat}
            onClose={editor.toggle_ai_chat}
            onResize={panels.start_ai_chat_resize}
            width={panels.ai_chat_width}
          />
        )}
      </div>

      <StatusBar
        activeDocument={editor.active_text_document}
        commandState={editor_command_state}
        onToggleIndentation={editor.toggle_indent_picker}
        onToggleLanguage={editor.toggle_language_picker}
      />

      {editor.indent_picker_open && editor.active_text_document && (
        <IndentationPicker
          document={editor.active_text_document}
          onClose={editor.close_overlays}
          onSelect={editor.update_document_indentation}
        />
      )}

      {editor.language_picker_open && editor.active_text_document && (
        <LanguagePicker
          activeLanguage={editor.active_text_document.language}
          onClose={editor.close_overlays}
          onSelect={(language) => editor.update_document_language(editor.active_text_document!.id, language)}
        />
      )}

      {editor.new_file_modal_open && (
        <NewFileModal onClose={editor.close_overlays} onCreate={editor.create_text_file} />
      )}

      {editor.settings_open && (
        <SettingsModal onChange={editor.apply_settings} onClose={editor.close_overlays} settings={editor.settings} />
      )}

      {editor.pending_close_document && editor.pending_close_document.kind === 'text' && (
        <SaveChangesModal
          document={editor.pending_close_document}
          onCancel={editor.cancel_close_document}
          onDiscard={editor.confirm_close_discard}
          onSave={() => void editor.confirm_close_save()}
        />
      )}

      {editor.notice && <NoticeToast message={editor.notice} onClose={editor.dismiss_notice} />}
    </div>
  )
}

export default App
