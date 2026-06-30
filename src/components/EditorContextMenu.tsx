import { format_shortcut, get_editor_command, get_effective_keybinding } from '../editor/editorCommands'
import type { EditorCommandId, EditorSettings } from '../types/editor'
import type { EditorCommandState } from './CodeEditor'
import { MenuItem, MenuSeparator } from './MenuDropdown'

interface EditorContextMenuProps {
  commandState: EditorCommandState
  settings: EditorSettings
  x: number
  y: number
  onClose: () => void
  onRunCommand: (command_id: EditorCommandId) => void
}

function EditorContextMenu({ commandState, settings, x, y, onClose, onRunCommand }: EditorContextMenuProps) {
  const is_disabled = (command_id: EditorCommandId) => {
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

    if (command_id === 'auto_indent_selection') {
      return !commandState.has_selection
    }

    if (command_id === 'fold') {
      return !settings.editor.code_folding || !commandState.can_fold
    }

    if (command_id === 'unfold') {
      return !settings.editor.code_folding || !commandState.can_unfold
    }

    if (command_id === 'select_next_occurrence' && !settings.editor.multiple_selections) {
      return true
    }

    return false
  }

  const render_item = (command_id: EditorCommandId, label?: string) => {
    const command = get_editor_command(command_id)
    const binding = get_effective_keybinding(settings.keybindings, command_id)

    return (
      <MenuItem
        disabled={is_disabled(command_id)}
        onClick={() => {
          onRunCommand(command_id)
          onClose()
        }}
        trailing={binding.key ? format_shortcut(binding.key) : undefined}
      >
        {label ?? command.label}
      </MenuItem>
    )
  }

  const fold_command = commandState.can_unfold ? 'unfold' : 'fold'

  return (
    <div
      className="absolute z-[260] min-w-56 rounded-lg border border-[var(--border)] bg-[var(--menu-bg)] py-1 shadow-[0_18px_55px_rgba(0,0,0,0.55)]"
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{ left: x, top: y }}
    >
      {render_item('undo')}
      {render_item('redo')}
      <MenuSeparator />
      {render_item('cut')}
      {render_item('copy')}
      {render_item('paste')}
      <MenuSeparator />
      {render_item('select_all')}
      {render_item('select_next_occurrence')}
      <MenuSeparator />
      {render_item('toggle_line_comment')}
      {render_item('auto_indent_selection')}
      <MenuSeparator />
      {render_item(fold_command)}
    </div>
  )
}

export default EditorContextMenu
