import { useEffect, useRef, useState } from 'react'
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
import WorkspaceConflictModal from './components/WorkspaceConflictModal'
import useAIChat from './hooks/useAIChat'
import useEditorState from './hooks/useEditorState'
import usePanelSizes from './hooks/usePanelSizes'
import useWorkspace from './hooks/useWorkspace'
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
  const active_file_path =
    editor.active_document?.kind === 'text' || editor.active_document?.kind === 'media'
      ? editor.active_document.file_path
      : null
  const workspace = useWorkspace({
    active_file_path,
    onOpenFile: (file_path) => void editor.open_file_path(file_path),
    onPathMoved: editor.remap_document_paths,
    onPathDeleted: editor.mark_document_paths_deleted,
    onNotice: editor.show_notice,
  })
  const chat = useAIChat(editor.settings, editor.apply_settings, editor.active_text_document)
  const panels = usePanelSizes(editor.ai_chat_open)
  const editor_ref = useRef<CodeEditorHandle>(null)
  const [editor_command_state, set_editor_command_state] = useState(initial_editor_command_state)
  useEffect(() => {
    document.title = workspace.root_name ? `code-editor — ${workspace.root_name}` : 'code-editor'
  }, [workspace.root_name])
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
        onCreateTerminal={() => editor.create_terminal(workspace.root_path)}
        onCreateTextFile={() => editor.create_text_file()}
        onHoverMenu={editor.hover_menu}
        onLeaveMenus={editor.leave_menus}
        onOpenFile={() => void editor.open_file_dialog()}
        onOpenFolder={() => {
          editor.select_activity('explorer')
          void workspace.open_folder_dialog()
        }}
        onOpenRecent={(file_path) => void editor.open_recent_file(file_path)}
        onRunEditorCommand={run_editor_command}
        onSave={() => void editor.save_document()}
        onSaveAs={() => void editor.save_document(true)}
        onSplitTerminal={() => editor.split_terminal(workspace.root_path)}
        onToggleAiChat={editor.toggle_ai_chat}
        onToggleMenu={editor.toggle_menu}
        onUpdateSettings={editor.apply_settings}
        openMenu={editor.open_menu}
        recentFiles={editor.recent_files}
        settings={editor.settings}
        workspaceName={workspace.root_name}
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

        <ExplorerPanel
          activeFilePath={active_file_path}
          activeSection={editor.active_activity}
          clipboard={workspace.clipboard}
          expandedPaths={workspace.expanded_paths}
          nodes={workspace.nodes}
          onCloseWorkspace={workspace.close_workspace}
          onCollapseAll={workspace.collapse_all}
          onCopyPath={workspace.copy_path}
          onCreateEntry={workspace.create_entry}
          onDeleteEntry={workspace.delete_entry}
          onDropEntry={(source_path, target_path, operation) =>
            void workspace.drop_entry(source_path, target_path, operation)
          }
          onOpenFile={(file_path) => void editor.open_file_path(file_path)}
          onOpenFolder={() => {
            editor.select_activity('explorer')
            void workspace.open_folder_dialog()
          }}
          onPaste={(target_path) => void workspace.paste_into(target_path)}
          onRefresh={() => void workspace.refresh()}
          onRenameEntry={workspace.rename_entry}
          onResize={panels.start_sidebar_resize}
          onRevealEntry={workspace.reveal_entry}
          onSelectPath={workspace.select_path}
          onSetClipboard={workspace.set_file_clipboard}
          onToggleFolder={(folder_path) => void workspace.toggle_folder(folder_path)}
          rootName={workspace.root_name}
          rootPath={workspace.root_path}
          selectedPath={workspace.selected_path}
        />

        <main className="grid min-h-0" style={editor_grid_style}>
          <EditorPanel
            activeDocumentId={editor.active_document_id}
            browserVisible={!editor.overlay_open && workspace.pending_conflict === null}
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
            onCreateTerminal={() => editor.create_terminal(workspace.root_path)}
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

      {workspace.pending_conflict && (
        <WorkspaceConflictModal
          destinationPath={workspace.pending_conflict.destination_path}
          onCancel={() => void workspace.resolve_conflict('cancel')}
          onKeepBoth={() => void workspace.resolve_conflict('keep_both')}
          onReplace={() => void workspace.resolve_conflict('replace')}
        />
      )}

      {editor.notice && <NoticeToast message={editor.notice} onClose={editor.dismiss_notice} />}
    </div>
  )
}

export default App
