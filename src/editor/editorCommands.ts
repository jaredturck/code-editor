import type { EditorCommandId, EditorKeybindingOverrides } from '../types/editor'

export interface EditorCommandDefinition {
  id: EditorCommandId
  label: string
  category: string
  default_key: string | null
  default_aliases?: string[]
  menu: 'edit' | 'go' | null
  context_menu: boolean
  disableable: boolean
}

export const editor_commands: EditorCommandDefinition[] = [
  {
    id: 'undo',
    label: 'Undo',
    category: 'Editing',
    default_key: 'Mod-z',
    menu: 'edit',
    context_menu: true,
    disableable: false,
  },
  {
    id: 'redo',
    label: 'Redo',
    category: 'Editing',
    default_key: 'Mod-y',
    default_aliases: ['Mod-Shift-z', 'Ctrl-Shift-z'],
    menu: 'edit',
    context_menu: true,
    disableable: false,
  },
  {
    id: 'cut',
    label: 'Cut',
    category: 'Clipboard',
    default_key: 'Mod-x',
    menu: 'edit',
    context_menu: true,
    disableable: false,
  },
  {
    id: 'copy',
    label: 'Copy',
    category: 'Clipboard',
    default_key: 'Mod-c',
    menu: 'edit',
    context_menu: true,
    disableable: false,
  },
  {
    id: 'paste',
    label: 'Paste',
    category: 'Clipboard',
    default_key: 'Mod-v',
    menu: 'edit',
    context_menu: true,
    disableable: false,
  },
  {
    id: 'select_all',
    label: 'Select All',
    category: 'Selection',
    default_key: 'Mod-a',
    menu: 'edit',
    context_menu: true,
    disableable: false,
  },
  {
    id: 'select_next_occurrence',
    label: 'Select Next Occurrence',
    category: 'Selection',
    default_key: 'Mod-d',
    menu: 'edit',
    context_menu: true,
    disableable: true,
  },
  {
    id: 'move_line_up',
    label: 'Move Line Up',
    category: 'Lines',
    default_key: 'Alt-ArrowUp',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'move_line_down',
    label: 'Move Line Down',
    category: 'Lines',
    default_key: 'Alt-ArrowDown',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'copy_line_up',
    label: 'Copy Line Up',
    category: 'Lines',
    default_key: 'Shift-Alt-ArrowUp',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'copy_line_down',
    label: 'Copy Line Down',
    category: 'Lines',
    default_key: 'Shift-Alt-ArrowDown',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'delete_line',
    label: 'Delete Line',
    category: 'Lines',
    default_key: 'Shift-Mod-k',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'insert_line_above',
    label: 'Insert Line Above',
    category: 'Lines',
    default_key: 'Shift-Mod-Enter',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'insert_line_below',
    label: 'Insert Line Below',
    category: 'Lines',
    default_key: 'Mod-Enter',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'indent',
    label: 'Indent Line',
    category: 'Formatting',
    default_key: 'Mod-]',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'outdent',
    label: 'Outdent Line',
    category: 'Formatting',
    default_key: 'Mod-[',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'auto_indent_selection',
    label: 'Auto-Indent Selection',
    category: 'Formatting',
    default_key: 'Mod-Alt-\\',
    menu: null,
    context_menu: true,
    disableable: true,
  },
  {
    id: 'toggle_line_comment',
    label: 'Toggle Line Comment',
    category: 'Comments',
    default_key: 'Mod-/',
    menu: 'edit',
    context_menu: true,
    disableable: true,
  },
  {
    id: 'toggle_block_comment',
    label: 'Toggle Block Comment',
    category: 'Comments',
    default_key: 'Alt-A',
    default_aliases: ['Shift-Alt-a'],
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'add_cursor_above',
    label: 'Add Cursor Above',
    category: 'Selection',
    default_key: 'Mod-Alt-ArrowUp',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'add_cursor_below',
    label: 'Add Cursor Below',
    category: 'Selection',
    default_key: 'Mod-Alt-ArrowDown',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'go_to_line',
    label: 'Go to Line',
    category: 'Navigation',
    default_key: 'Mod-Alt-g',
    menu: 'go',
    context_menu: false,
    disableable: true,
  },
  {
    id: 'go_to_matching_bracket',
    label: 'Go to Matching Bracket',
    category: 'Navigation',
    default_key: 'Shift-Mod-\\',
    menu: 'go',
    context_menu: false,
    disableable: true,
  },
  {
    id: 'next_match',
    label: 'Next Match',
    category: 'Search',
    default_key: 'F3',
    default_aliases: ['Mod-g'],
    menu: 'go',
    context_menu: false,
    disableable: true,
  },
  {
    id: 'previous_match',
    label: 'Previous Match',
    category: 'Search',
    default_key: 'Shift-F3',
    default_aliases: ['Shift-Mod-g'],
    menu: 'go',
    context_menu: false,
    disableable: true,
  },
  {
    id: 'fold',
    label: 'Fold',
    category: 'Folding',
    default_key: 'Ctrl-Shift-[',
    menu: null,
    context_menu: true,
    disableable: true,
  },
  {
    id: 'unfold',
    label: 'Unfold',
    category: 'Folding',
    default_key: 'Ctrl-Shift-]',
    menu: null,
    context_menu: true,
    disableable: true,
  },
  {
    id: 'fold_all',
    label: 'Fold All',
    category: 'Folding',
    default_key: 'Ctrl-Alt-[',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'unfold_all',
    label: 'Unfold All',
    category: 'Folding',
    default_key: 'Ctrl-Alt-]',
    menu: null,
    context_menu: false,
    disableable: true,
  },
  {
    id: 'find',
    label: 'Find',
    category: 'Search',
    default_key: 'Mod-f',
    menu: 'edit',
    context_menu: false,
    disableable: false,
  },
  {
    id: 'replace',
    label: 'Replace',
    category: 'Search',
    default_key: 'Mod-h',
    menu: 'edit',
    context_menu: false,
    disableable: false,
  },
  {
    id: 'trigger_suggestions',
    label: 'Trigger Suggestions',
    category: 'Suggestions',
    default_key: 'Ctrl-Space',
    menu: null,
    context_menu: false,
    disableable: true,
  },
]

const command_map = new Map(editor_commands.map((command) => [command.id, command]))

export function get_editor_command(command_id: EditorCommandId) {
  return command_map.get(command_id)!
}

export function get_effective_keybinding(keybindings: EditorKeybindingOverrides, command_id: EditorCommandId) {
  const command = get_editor_command(command_id)
  const override = keybindings[command_id]

  return override ?? { enabled: true, key: command.default_key }
}

export function get_effective_keybinding_keys(keybindings: EditorKeybindingOverrides, command_id: EditorCommandId) {
  const command = get_editor_command(command_id)
  const override = keybindings[command_id]

  if (override) {
    return override.enabled && override.key ? [override.key] : []
  }

  return [...new Set([command.default_key, ...(command.default_aliases ?? [])].filter((key): key is string => !!key))]
}

export function get_managed_shortcut_keys() {
  return new Set(
    editor_commands.flatMap((command) => [command.default_key, ...(command.default_aliases ?? [])]).filter(Boolean),
  )
}

export function format_shortcut(key: string | null, platform = window.editor_api.platform) {
  if (!key) {
    return 'Unassigned'
  }

  const labels: Record<string, string> = {
    Mod: platform === 'darwin' ? 'Cmd' : 'Ctrl',
    Ctrl: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Meta: platform === 'darwin' ? 'Cmd' : 'Meta',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Enter',
    Space: 'Space',
  }

  return key
    .split('-')
    .map((part) => labels[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join('+')
}

export function normalize_shortcut_for_platform(key: string | null, platform = window.editor_api.platform) {
  if (!key) {
    return null
  }

  return key.replaceAll('Mod', platform === 'darwin' ? 'Meta' : 'Ctrl').toLowerCase()
}

export function keyboard_event_to_shortcut(event: KeyboardEvent | React.KeyboardEvent) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
    return null
  }

  const platform = window.editor_api.platform
  const modifiers: string[] = []

  if ((platform === 'darwin' && event.metaKey) || (platform !== 'darwin' && event.ctrlKey)) {
    modifiers.push('Mod')
  } else {
    if (event.ctrlKey) {
      modifiers.push('Ctrl')
    }

    if (event.metaKey) {
      modifiers.push('Meta')
    }
  }

  if (event.altKey) {
    modifiers.push('Alt')
  }

  if (event.shiftKey) {
    modifiers.push('Shift')
  }

  const code_keys: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Slash: '/',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Semicolon: ';',
    Quote: "'",
  }
  let key = code_keys[event.code] ?? event.key

  if (key === ' ') {
    key = 'Space'
  } else if (key.length === 1 && /[A-Z]/.test(key)) {
    key = key.toLowerCase()
  }

  return [...modifiers, key].join('-')
}
