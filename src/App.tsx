import { useEffect, useRef, useState } from 'react'
import { projectRunController } from './chat/projectRunController'
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
import { readStorageText, removeStorageKey, writeStorageText } from './platform/localStorageStore'
import type { EditorCommandId, EditorDiagnostic } from './types/editor'

const last_workspace_storage_key = 'editor:last-workspace'

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
  useEffect(() => {
    projectRunController.set_workspace_root(workspace.root_path)
  }, [workspace.root_path])
  const terminal_workspace_root = workspace.root_path || readStorageText(last_workspace_storage_key).trim() || null
  const agent_follow_suspended_ref = useRef(false)
  const workspace_open_ref = useRef(workspace.open_workspace)
  workspace_open_ref.current = workspace.open_workspace
  const chat = useAIChat(editor.settings, editor.active_text_document, workspace.root_path, {
    diagnostics: editor.diagnostics,
    file_host: {
      get_snapshot: (file_path) => {
        const normalize_path = (value: string) => {
          const normalized = value.replace(/\\/g, '/')
          return window.editor_api.platform === 'win32' ? normalized.toLowerCase() : normalized
        }
        const target = normalize_path(file_path)
        const document = editor.documents.find(
          (item) => item.kind === 'text' && item.file_path && normalize_path(item.file_path) === target,
        )
        if (!document || document.kind !== 'text' || !document.file_path) return null
        return { file_path: document.file_path, content: document.content, dirty: document.dirty }
      },
      apply_content: (file_path, content, saved) => {
        const normalize_path = (value: string) => {
          const normalized = value.replace(/\\/g, '/')
          return window.editor_api.platform === 'win32' ? normalized.toLowerCase() : normalized
        }
        const target = normalize_path(file_path)
        const document = editor.documents.find(
          (item) => item.kind === 'text' && item.file_path && normalize_path(item.file_path) === target,
        )

        if (saved) void workspace.refresh()

        if (!document || document.kind !== 'text') {
          if (saved && !agent_follow_suspended_ref.current) void editor.open_file_path(file_path)
          return
        }
        if (saved) {
          document.saved_content = content
          document.deleted = false
        }
        editor.update_document(document.id, content)
        if (!agent_follow_suspended_ref.current && editor.active_document_id !== document.id) {
          editor.select_document(document.id)
        }
      },
    },
  })
  const panels = usePanelSizes(editor.ai_chat_open)
  const editor_ref = useRef<CodeEditorHandle>(null)
  const restore_workspace_started_ref = useRef(false)
  const [editor_command_state, set_editor_command_state] = useState(initial_editor_command_state)

  useEffect(() => {
    if (chat.generating) agent_follow_suspended_ref.current = false
  }, [chat.generating])

  const mark_manual_editor_focus = () => {
    if (chat.generating) agent_follow_suspended_ref.current = true
  }
  useEffect(() => {
    document.title = workspace.root_name ? `code-editor — ${workspace.root_name}` : 'code-editor'
  }, [workspace.root_name])
  useEffect(() => {
    if (restore_workspace_started_ref.current) return
    restore_workspace_started_ref.current = true

    const saved_workspace = readStorageText(last_workspace_storage_key).trim()
    if (!saved_workspace) return

    void window.editor_api.file
      .check_paths([saved_workspace])
      .then((path_status) => {
        if (!path_status[saved_workspace]) {
          removeStorageKey(last_workspace_storage_key)
          return
        }
        void workspace_open_ref.current(saved_workspace)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (workspace.root_path) {
      writeStorageText(last_workspace_storage_key, workspace.root_path)
    }
  }, [workspace.root_path])

  const window_shape_class = editor.is_maximized
    ? 'h-screen w-screen rounded-none border-0'
    : 'm-px h-[calc(100vh-2px)] w-[calc(100vw-2px)] rounded-lg border border-[var(--window-border)]'
  const code_editor_theme = ['light', 'iris-light', 'rose'].includes(editor.resolved_theme) ? 'light' : 'dark'
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
      className={`theme-${editor.resolved_theme} accent-${editor.settings.accent_color} ${window_shape_class} relative flex min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--text)] shadow-2xl`}
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
        onOpenFile={() => {
          mark_manual_editor_focus()
          void editor.open_file_dialog()
        }}
        onOpenFolder={() => {
          editor.select_activity('explorer')
          void workspace.open_folder_dialog()
        }}
        onOpenRecent={(file_path) => {
          mark_manual_editor_focus()
          void editor.open_recent_file(file_path)
        }}
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
          onCollapseAll={workspace.collapse_all}
          onCopyPath={workspace.copy_path}
          onCreateEntry={workspace.create_entry}
          onDeleteEntries={workspace.delete_entries}
          onDropEntry={(source_path, target_path, operation) =>
            void workspace.drop_entry(source_path, target_path, operation)
          }
          onOpenFile={(file_path) => {
            mark_manual_editor_focus()
            void editor.open_file_path(file_path)
          }}
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
          onSelectPaths={workspace.select_paths}
          onSelectSubtree={workspace.select_subtree}
          onSetClipboard={workspace.set_file_clipboard}
          onTogglePathSelection={workspace.toggle_path_selection}
          onToggleFolder={(folder_path) => void workspace.toggle_folder(folder_path)}
          rootName={workspace.root_name}
          rootPath={workspace.root_path}
          selectedPath={workspace.selected_path}
          selectedPaths={workspace.selected_paths}
        />

        <main className="grid min-h-0" style={editor_grid_style}>
          <EditorPanel
            activeDocumentId={editor.active_document_id}
            browserVisible={!editor.overlay_open && workspace.pending_conflict === null}
            diagnostics={editor.diagnostics}
            documents={editor.documents}
            editorRef={editor_ref}
            onCloseDocument={editor.close_document}
            onCloseDocuments={editor.close_documents}
            onEditorCommandStateChange={set_editor_command_state}
            onFocusDocument={editor.validate_document_path}
            onOpenFilePath={(file_path) => {
              mark_manual_editor_focus()
              void editor.open_file_path(file_path)
            }}
            onOpenContainingFolder={workspace.reveal_entry}
            onParserDiagnostics={editor.update_parser_diagnostics}
            onSelectDocument={(document_id) => {
              mark_manual_editor_focus()
              editor.select_document(document_id)
            }}
            onRevealInExplorer={(file_path) => {
              editor.select_activity('explorer')
              void workspace.reveal_path(file_path)
            }}
            onToggleMarkdownView={editor.toggle_markdown_view}
            onUpdateDocument={editor.update_document}
            settings={editor.settings}
            theme={code_editor_theme}
            workspaceRoot={workspace.root_path}
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
            workspaceRoot={terminal_workspace_root}
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
