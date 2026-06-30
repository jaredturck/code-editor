import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
} from '@codemirror/autocomplete'
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  indentSelection,
  indentWithTab,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  redo,
  redoDepth,
  selectAll,
  toggleBlockComment,
  toggleComment,
  undo,
  undoDepth,
} from '@codemirror/commands'
import {
  bracketMatching,
  codeFolding,
  foldAll,
  foldCode,
  foldGutter,
  foldKeymap,
  foldable,
  foldedRanges,
  indentOnInput,
  indentUnit,
  syntaxTree,
  unfoldAll,
  unfoldCode,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import {
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, Prec, Transaction, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  type KeyBinding,
} from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  editor_commands,
  get_effective_keybinding,
  get_effective_keybinding_keys,
  get_managed_shortcut_keys,
} from '../editor/editorCommands'
import { editor_search_extension, open_editor_search } from '../editor/editorSearch'
import { create_syntax_highlighting } from '../editor/syntaxThemes'
import {
  editor_command_states_equal,
  get_diagnostics_signature,
  type EditorCommandSnapshot,
} from '../editor/editorPerformance'
import type { EditorCommandId, EditorDiagnostic, EditorSettings, TextEditorDocument, ThemeMode } from '../types/editor'
import EditorContextMenu from './EditorContextMenu'

export type EditorCommandState = EditorCommandSnapshot

export interface CodeEditorHandle {
  focus: () => void
  reveal_diagnostic: (diagnostic: EditorDiagnostic) => void
  run_command: (command_id: EditorCommandId) => boolean
}

interface CodeEditorProps {
  activeDocument: TextEditorDocument
  diagnostics: EditorDiagnostic[]
  documents: TextEditorDocument[]
  settings: EditorSettings
  theme: Exclude<ThemeMode, 'system'>
  onChange: (document_id: number, content: string) => void
  onCommandStateChange: (state: EditorCommandState) => void
  onFocus: (document_id: number) => void
  onParserDiagnostics: (document_id: number, diagnostics: EditorDiagnostic[]) => void
}

interface ContextMenuState {
  x: number
  y: number
}

const managed_shortcut_keys = get_managed_shortcut_keys()

function create_editor_theme(theme: Exclude<ThemeMode, 'system'>) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text)',
        fontSize: '13px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
        lineHeight: '1.6',
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '8px 0',
        caretColor: 'var(--text)',
      },
      '.cm-line': {
        padding: '0 12px',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--muted)',
        border: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '42px',
        padding: '0 10px 0 8px',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--terminal-active)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--terminal-active)',
        color: 'var(--text)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selected)',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--text)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, #d6ad28 34%, transparent)',
        outline: '1px solid color-mix(in srgb, #d6ad28 65%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, #38bdf8 42%, transparent)',
        outline: '1px solid #38bdf8',
      },
      '.cm-highlightSpace': {
        backgroundImage:
          'radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--muted) 65%, transparent) 0 1px, transparent 1.2px)',
      },
      '.cm-highlightTab': {
        backgroundImage:
          'linear-gradient(90deg, transparent 20%, color-mix(in srgb, var(--muted) 50%, transparent) 20% 25%, transparent 25%)',
      },
      '.cm-trailingSpace': {
        backgroundColor: 'color-mix(in srgb, #f59e0b 22%, transparent)',
      },
      '.cm-tooltip-autocomplete': {
        border: '1px solid var(--border)',
        backgroundColor: 'var(--menu-bg)',
        color: 'var(--text)',
        boxShadow: '0 16px 45px rgba(0, 0, 0, 0.45)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--selected)',
        color: 'var(--text)',
      },
      '.cm-foldPlaceholder': {
        borderColor: 'var(--border)',
        backgroundColor: 'var(--surface-2)',
        color: 'var(--muted)',
      },
    },
    {
      dark: theme === 'dark',
    },
  )
}

function create_indentation_extensions(document: TextEditorDocument) {
  const indentation = document.indent_style === 'tabs' ? '\t' : ' '.repeat(document.indent_size)

  return [EditorState.tabSize.of(document.indent_size), indentUnit.of(indentation), keymap.of([indentWithTab])]
}

function keymap_binding_is_managed(binding: KeyBinding) {
  return [binding.key, binding.mac, binding.win, binding.linux].some(
    (key_value) => key_value !== undefined && managed_shortcut_keys.has(key_value),
  )
}

function filter_managed_bindings(bindings: readonly KeyBinding[]) {
  return bindings.filter((binding) => !keymap_binding_is_managed(binding))
}

function insert_line_above(view: EditorView) {
  const state = view.state
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head)
    const indentation = /^\s*/.exec(line.text)?.[0] ?? ''

    return {
      changes: { from: line.from, insert: `${indentation}${state.lineBreak}` },
      range: EditorSelection.cursor(line.from + indentation.length),
    }
  })

  view.dispatch({ ...changes, scrollIntoView: true, userEvent: 'input' })
  return true
}

function get_command_state(state: EditorState): EditorCommandState {
  const selection = state.selection.main
  const line = state.doc.lineAt(selection.head)
  const folded_ranges = foldedRanges(state)
  let can_unfold = false

  folded_ranges.between(line.from, Math.min(state.doc.length, line.to + 1), () => {
    can_unfold = true
  })

  return {
    can_undo: undoDepth(state) > 0,
    can_redo: redoDepth(state) > 0,
    can_fold: foldable(state, line.from, line.to) !== null,
    can_unfold,
    has_selection: state.selection.ranges.some((range) => !range.empty),
    selection_count: state.selection.ranges.length,
    line: line.number,
    column: selection.head - line.from + 1,
  }
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    activeDocument,
    diagnostics,
    documents,
    settings,
    theme,
    onChange,
    onCommandStateChange,
    onFocus,
    onParserDiagnostics,
  },
  ref,
) {
  const host_ref = useRef<HTMLDivElement>(null)
  const container_ref = useRef<HTMLDivElement>(null)
  const editor_view_ref = useRef<EditorView | null>(null)
  const active_document_id_ref = useRef<number | null>(null)
  const state_cache_ref = useRef(new Map<number, EditorState>())
  const theme_compartment_ref = useRef(new Compartment())
  const syntax_compartment_ref = useRef(new Compartment())
  const language_compartment_ref = useRef(new Compartment())
  const indentation_compartment_ref = useRef(new Compartment())
  const settings_compartment_ref = useRef(new Compartment())
  const parser_timer_ref = useRef<number | null>(null)
  const last_command_state_ref = useRef<EditorCommandState | null>(null)
  const last_diagnostics_signature_ref = useRef<string | null>(null)
  const synchronized_content_ref = useRef(new Map<number, string>())
  const on_parser_diagnostics_ref = useRef(onParserDiagnostics)
  const language_request_ref = useRef(0)
  const on_change_ref = useRef(onChange)
  const on_command_state_change_ref = useRef(onCommandStateChange)
  const on_focus_ref = useRef(onFocus)
  const settings_ref = useRef(settings)
  const theme_ref = useRef(theme)
  const [context_menu, set_context_menu] = useState<ContextMenuState | null>(null)
  const [context_command_state, set_context_command_state] = useState<EditorCommandState>(() => ({
    can_undo: false,
    can_redo: false,
    can_fold: false,
    can_unfold: false,
    has_selection: false,
    selection_count: 1,
    line: 1,
    column: 1,
  }))

  on_change_ref.current = onChange
  on_command_state_change_ref.current = onCommandStateChange
  on_focus_ref.current = onFocus
  settings_ref.current = settings
  on_parser_diagnostics_ref.current = onParserDiagnostics
  theme_ref.current = theme

  const notify_command_state = (state: EditorState) => {
    const command_state = get_command_state(state)

    if (editor_command_states_equal(last_command_state_ref.current, command_state)) {
      return
    }

    last_command_state_ref.current = command_state
    on_command_state_change_ref.current(command_state)
  }

  const command_is_available = (command_id: EditorCommandId, state: EditorState) => {
    const binding = get_effective_keybinding(settings_ref.current.keybindings, command_id)

    if (!binding.enabled) {
      return false
    }

    if (
      (command_id === 'add_cursor_above' ||
        command_id === 'add_cursor_below' ||
        command_id === 'select_next_occurrence') &&
      !settings_ref.current.editor.multiple_selections
    ) {
      return false
    }

    if (
      (command_id === 'fold' || command_id === 'unfold' || command_id === 'fold_all' || command_id === 'unfold_all') &&
      !settings_ref.current.editor.code_folding
    ) {
      return false
    }

    if (command_id === 'trigger_suggestions' && settings_ref.current.suggestions.mode === 'off') {
      return false
    }

    if (command_id === 'undo') {
      return undoDepth(state) > 0
    }

    if (command_id === 'redo') {
      return redoDepth(state) > 0
    }

    return true
  }

  const run_editor_command = (command_id: EditorCommandId, target_view = editor_view_ref.current) => {
    if (!target_view || !command_is_available(command_id, target_view.state)) {
      return false
    }

    target_view.focus()
    set_context_menu(null)

    if (command_id === 'cut' || command_id === 'copy' || command_id === 'paste') {
      requestAnimationFrame(() => window.editor_api.edit[command_id]())
      return true
    }

    if (command_id === 'find') {
      return open_editor_search(target_view, false)
    }

    if (command_id === 'replace') {
      return open_editor_search(target_view, true)
    }

    const commands: Partial<Record<EditorCommandId, (view: EditorView) => boolean>> = {
      undo,
      redo,
      select_all: selectAll,
      select_next_occurrence: selectNextOccurrence,
      move_line_up: moveLineUp,
      move_line_down: moveLineDown,
      copy_line_up: copyLineUp,
      copy_line_down: copyLineDown,
      delete_line: deleteLine,
      insert_line_above,
      insert_line_below: insertBlankLine,
      indent: indentMore,
      outdent: indentLess,
      auto_indent_selection: indentSelection,
      toggle_line_comment: toggleComment,
      toggle_block_comment: toggleBlockComment,
      add_cursor_above: addCursorAbove,
      add_cursor_below: addCursorBelow,
      go_to_line: gotoLine,
      go_to_matching_bracket: cursorMatchingBracket,
      next_match: findNext,
      previous_match: findPrevious,
      fold: foldCode,
      unfold: unfoldCode,
      fold_all: foldAll,
      unfold_all: unfoldAll,
      trigger_suggestions: startCompletion,
    }

    const command = commands[command_id]

    return command ? command(target_view) : false
  }

  const create_settings_extensions = (current_settings: EditorSettings): Extension => {
    const extensions: Extension[] = []

    if (current_settings.appearance.line_numbers) {
      extensions.push(lineNumbers())
    }

    if (current_settings.appearance.highlight_active_line && current_settings.appearance.line_numbers) {
      extensions.push(highlightActiveLineGutter())
    }

    if (current_settings.appearance.show_special_characters) {
      extensions.push(highlightSpecialChars())
    }

    extensions.push(EditorState.allowMultipleSelections.of(current_settings.editor.multiple_selections))

    if (current_settings.editor.auto_indent) {
      extensions.push(indentOnInput())
    }

    if (current_settings.editor.code_folding) {
      extensions.push(current_settings.editor.fold_gutter ? foldGutter() : codeFolding())
    }

    if (current_settings.editor.bracket_matching) {
      extensions.push(bracketMatching())
    }

    if (current_settings.editor.close_brackets) {
      extensions.push(closeBrackets())
    }

    if (current_settings.suggestions.mode !== 'off') {
      extensions.push(
        autocompletion({
          activateOnTyping: current_settings.suggestions.mode === 'typing',
          activateOnTypingDelay: current_settings.suggestions.delay,
          defaultKeymap: false,
          icons: current_settings.suggestions.show_type_icons,
        }),
      )

      if (!current_settings.suggestions.show_details) {
        extensions.push(EditorView.theme({ '.cm-completionDetail': { display: 'none' } }))
      }
    }

    if (current_settings.editor.multiple_selections) {
      extensions.push(rectangularSelection(), crosshairCursor())
    }

    if (current_settings.appearance.highlight_active_line) {
      extensions.push(highlightActiveLine())
    }

    if (current_settings.appearance.highlight_selection_matches) {
      extensions.push(highlightSelectionMatches())
    }

    if (current_settings.appearance.render_whitespace === 'all') {
      extensions.push(highlightWhitespace())
    }

    if (current_settings.appearance.highlight_trailing_whitespace) {
      extensions.push(highlightTrailingWhitespace())
    }

    if (current_settings.appearance.scroll_past_end) {
      extensions.push(scrollPastEnd())
    }

    if (current_settings.editor.word_wrap) {
      extensions.push(EditorView.lineWrapping)
    }

    if (current_settings.diagnostics.show_gutter) {
      extensions.push(lintGutter())
    }

    if (!current_settings.diagnostics.show_squiggles) {
      extensions.push(
        EditorView.theme({
          '.cm-lintRange': { backgroundImage: 'none !important' },
        }),
      )
    }

    if (!current_settings.diagnostics.show_hover) {
      extensions.push(
        EditorView.theme({
          '.cm-tooltip-lint': { display: 'none !important' },
        }),
      )
    }

    const custom_keybindings: KeyBinding[] = editor_commands.flatMap((command) =>
      get_effective_keybinding_keys(current_settings.keybindings, command.id).map((key) => ({
        key,
        preventDefault: true,
        run: (view: EditorView) => run_editor_command(command.id, view),
      })),
    )
    const completion_bindings =
      current_settings.suggestions.mode === 'off'
        ? []
        : filter_managed_bindings(completionKeymap).filter(
            (binding) => current_settings.suggestions.accept_on_enter || binding.run !== acceptCompletion,
          )
    const base_keybindings = [
      ...(current_settings.editor.close_brackets ? closeBracketsKeymap : []),
      ...filter_managed_bindings(defaultKeymap),
      ...filter_managed_bindings(searchKeymap),
      ...filter_managed_bindings(historyKeymap),
      ...(current_settings.editor.code_folding ? filter_managed_bindings(foldKeymap) : []),
      ...completion_bindings,
      ...lintKeymap,
    ]

    extensions.push(Prec.high(keymap.of(custom_keybindings)), keymap.of(base_keybindings))

    return extensions
  }

  const provider_languages = new Set([
    'python',
    'javascript',
    'jsx',
    'typescript',
    'tsx',
    'css',
    'scss',
    'less',
    'html',
    'json',
    'json5',
    'jsonc',
    'yaml',
    'markdown',
  ])

  const collect_parser_diagnostics = (view: EditorView, document: TextEditorDocument) => {
    if (
      settings_ref.current.diagnostics.mode === 'off' ||
      !settings_ref.current.diagnostics.enable_parser_fallback ||
      provider_languages.has(document.language.toLowerCase())
    ) {
      on_parser_diagnostics_ref.current(document.id, [])
      return
    }

    const found: EditorDiagnostic[] = []
    const cursor = syntaxTree(view.state).cursor()
    let index = 0

    do {
      if (!cursor.type.isError) {
        continue
      }

      const from = Math.max(0, Math.min(view.state.doc.length, cursor.from))
      const to = Math.max(from, Math.min(view.state.doc.length, cursor.to))
      const start_line = view.state.doc.lineAt(from)
      const end_line = view.state.doc.lineAt(to)
      found.push({
        id: `${document.id}:parser:${index}`,
        document_id: document.id,
        file_path: document.file_path,
        source: 'CodeMirror Parser',
        code: null,
        severity: 'error',
        message: 'Syntax error',
        line: start_line.number,
        column: from - start_line.from + 1,
        end_line: end_line.number,
        end_column: to - end_line.from + 1,
      })
      index += 1
    } while (cursor.next())

    on_parser_diagnostics_ref.current(document.id, found)
  }

  const schedule_parser_diagnostics = (view: EditorView, document: TextEditorDocument) => {
    if (parser_timer_ref.current !== null) {
      window.clearTimeout(parser_timer_ref.current)
    }

    parser_timer_ref.current = window.setTimeout(
      () => collect_parser_diagnostics(view, document),
      Math.max(500, settings_ref.current.diagnostics.delay),
    )
  }

  const create_editor_state = (document: TextEditorDocument) => {
    return EditorState.create({
      doc: document.content,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        syntax_compartment_ref.current.of(
          create_syntax_highlighting(settings_ref.current.appearance.syntax_color_scheme, theme_ref.current),
        ),
        editor_search_extension,
        theme_compartment_ref.current.of(create_editor_theme(theme_ref.current)),
        language_compartment_ref.current.of([]),
        indentation_compartment_ref.current.of(create_indentation_extensions(document)),
        settings_compartment_ref.current.of(create_settings_extensions(settings_ref.current)),
        EditorView.updateListener.of((update) => {
          state_cache_ref.current.set(document.id, update.state)
          notify_command_state(update.state)

          if (update.docChanged) {
            const content = update.state.doc.toString()

            synchronized_content_ref.current.set(document.id, content)
            on_change_ref.current(document.id, content)
            schedule_parser_diagnostics(update.view, document)
          }
        }),
        EditorView.domEventHandlers({
          focus: () => {
            on_focus_ref.current(document.id)
            return false
          },
          contextmenu: (event, view) => {
            event.preventDefault()
            const host = host_ref.current

            if (!host) {
              return true
            }

            const position = view.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            })

            if (position !== null) {
              const selection_contains_position = view.state.selection.ranges.some(
                (range) => position >= range.from && position <= range.to,
              )

              if (!selection_contains_position) {
                view.dispatch({
                  selection: EditorSelection.cursor(position),
                })
              }
            }

            const bounds = host.getBoundingClientRect()
            const menu_width = 230
            const menu_height = 335
            const x = Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - menu_width - 4))
            const y = Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - menu_height - 4))

            set_context_command_state(get_command_state(view.state))
            set_context_menu({ x, y })
            return true
          },
          scroll: () => {
            set_context_menu(null)
            return false
          },
        }),
      ],
    })
  }

  const apply_diagnostics = (view: EditorView, editor_diagnostics: EditorDiagnostic[]) => {
    const signature = get_diagnostics_signature(activeDocument.id, editor_diagnostics)

    if (last_diagnostics_signature_ref.current === signature) {
      return
    }

    const code_mirror_diagnostics: Diagnostic[] = editor_diagnostics.map((diagnostic) => {
      const start_line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, diagnostic.line)))
      const end_line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, diagnostic.end_line)))
      const from = Math.min(start_line.to, start_line.from + Math.max(0, diagnostic.column - 1))
      const requested_to = end_line.from + Math.max(0, diagnostic.end_column - 1)
      const maximum_to = Math.min(view.state.doc.length, end_line.to)
      const to = maximum_to === 0 ? 0 : Math.min(maximum_to, Math.max(from + 1, requested_to))

      return {
        from,
        to,
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: diagnostic.code ? `${diagnostic.source} · ${diagnostic.code}` : diagnostic.source,
      }
    })

    view.dispatch(setDiagnostics(view.state, code_mirror_diagnostics))
    last_diagnostics_signature_ref.current = signature
    state_cache_ref.current.set(activeDocument.id, view.state)
  }

  useImperativeHandle(ref, () => ({
    focus: () => editor_view_ref.current?.focus(),
    reveal_diagnostic: (diagnostic) => {
      const view = editor_view_ref.current

      if (!view || active_document_id_ref.current !== diagnostic.document_id) {
        return
      }

      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, diagnostic.line)))
      const position = Math.min(line.to, line.from + Math.max(0, diagnostic.column - 1))
      view.dispatch({
        selection: EditorSelection.cursor(position),
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      })
      view.focus()
    },
    run_command: (command_id) => run_editor_command(command_id),
  }))

  useEffect(() => {
    if (!container_ref.current) {
      return
    }

    const initial_state = create_editor_state(activeDocument)
    const editor_view = new EditorView({
      parent: container_ref.current,
      state: initial_state,
    })

    editor_view_ref.current = editor_view
    active_document_id_ref.current = activeDocument.id
    state_cache_ref.current.set(activeDocument.id, initial_state)
    synchronized_content_ref.current.set(activeDocument.id, activeDocument.content)
    notify_command_state(initial_state)
    editor_view.focus()

    return () => {
      if (parser_timer_ref.current !== null) {
        window.clearTimeout(parser_timer_ref.current)
      }
      editor_view.destroy()
      editor_view_ref.current = null
      active_document_id_ref.current = null
    }
  }, [])

  useEffect(() => {
    const close_context_menu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') {
        return
      }

      set_context_menu(null)
    }

    window.addEventListener('mousedown', close_context_menu)
    window.addEventListener('keydown', close_context_menu)

    return () => {
      window.removeEventListener('mousedown', close_context_menu)
      window.removeEventListener('keydown', close_context_menu)
    }
  }, [])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view || active_document_id_ref.current === activeDocument.id) {
      return
    }

    if (active_document_id_ref.current !== null) {
      state_cache_ref.current.set(active_document_id_ref.current, editor_view.state)
    }

    const next_state = state_cache_ref.current.get(activeDocument.id) ?? create_editor_state(activeDocument)

    state_cache_ref.current.set(activeDocument.id, next_state)
    synchronized_content_ref.current.set(activeDocument.id, next_state.doc.toString())
    active_document_id_ref.current = activeDocument.id
    editor_view.setState(next_state)
    editor_view.dispatch({
      effects: [
        theme_compartment_ref.current.reconfigure(create_editor_theme(theme_ref.current)),
        syntax_compartment_ref.current.reconfigure(
          create_syntax_highlighting(settings_ref.current.appearance.syntax_color_scheme, theme_ref.current),
        ),
        indentation_compartment_ref.current.reconfigure(create_indentation_extensions(activeDocument)),
        settings_compartment_ref.current.reconfigure(create_settings_extensions(settings_ref.current)),
      ],
    })
    state_cache_ref.current.set(activeDocument.id, editor_view.state)
    notify_command_state(editor_view.state)
    set_context_menu(null)
    editor_view.focus()
  }, [activeDocument.id])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view) {
      return
    }

    editor_view.dispatch({
      effects: [
        theme_compartment_ref.current.reconfigure(create_editor_theme(theme)),
        syntax_compartment_ref.current.reconfigure(
          create_syntax_highlighting(settings_ref.current.appearance.syntax_color_scheme, theme),
        ),
      ],
    })

    if (active_document_id_ref.current !== null) {
      state_cache_ref.current.set(active_document_id_ref.current, editor_view.state)
    }
  }, [theme])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view) {
      return
    }

    editor_view.dispatch({
      effects: [
        settings_compartment_ref.current.reconfigure(create_settings_extensions(settings)),
        syntax_compartment_ref.current.reconfigure(
          create_syntax_highlighting(settings.appearance.syntax_color_scheme, theme_ref.current),
        ),
      ],
    })

    if (active_document_id_ref.current !== null) {
      state_cache_ref.current.set(active_document_id_ref.current, editor_view.state)
    }

    notify_command_state(editor_view.state)
    schedule_parser_diagnostics(editor_view, activeDocument)
  }, [activeDocument.id, activeDocument.language, settings])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view || active_document_id_ref.current !== activeDocument.id) {
      return
    }

    apply_diagnostics(editor_view, diagnostics)
  }, [activeDocument.id, diagnostics])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view || active_document_id_ref.current !== activeDocument.id) {
      return
    }

    editor_view.dispatch({
      effects: indentation_compartment_ref.current.reconfigure(create_indentation_extensions(activeDocument)),
    })
    state_cache_ref.current.set(activeDocument.id, editor_view.state)
  }, [activeDocument.id, activeDocument.indent_size, activeDocument.indent_style])

  useEffect(() => {
    const editor_view = editor_view_ref.current
    const request_id = language_request_ref.current + 1

    language_request_ref.current = request_id

    if (!editor_view || active_document_id_ref.current !== activeDocument.id) {
      return
    }

    if (activeDocument.language === 'Plain Text') {
      editor_view.dispatch({
        effects: language_compartment_ref.current.reconfigure([]),
      })
      state_cache_ref.current.set(activeDocument.id, editor_view.state)
      on_parser_diagnostics_ref.current(activeDocument.id, [])
      return
    }

    const language_description = languages.find((language) => language.name === activeDocument.language)

    if (!language_description) {
      return
    }

    void language_description.load().then((language_support) => {
      const current_editor = editor_view_ref.current

      if (
        request_id !== language_request_ref.current ||
        !current_editor ||
        active_document_id_ref.current !== activeDocument.id
      ) {
        return
      }

      current_editor.dispatch({
        effects: language_compartment_ref.current.reconfigure(language_support),
      })
      state_cache_ref.current.set(activeDocument.id, current_editor.state)
      notify_command_state(current_editor.state)
      schedule_parser_diagnostics(current_editor, activeDocument)
    })
  }, [activeDocument.id, activeDocument.language])

  useEffect(() => {
    const active_ids = new Set(documents.map((document) => document.id))

    for (const document_id of state_cache_ref.current.keys()) {
      if (!active_ids.has(document_id)) {
        state_cache_ref.current.delete(document_id)
        synchronized_content_ref.current.delete(document_id)
      }
    }
  }, [documents])

  useEffect(() => {
    const editor_view = editor_view_ref.current

    if (!editor_view || active_document_id_ref.current !== activeDocument.id) {
      return
    }

    if (synchronized_content_ref.current.get(activeDocument.id) === activeDocument.content) {
      return
    }

    const current_content = editor_view.state.doc.toString()

    if (current_content === activeDocument.content) {
      synchronized_content_ref.current.set(activeDocument.id, activeDocument.content)
      return
    }

    editor_view.dispatch({
      changes: {
        from: 0,
        to: editor_view.state.doc.length,
        insert: activeDocument.content,
      },
      annotations: Transaction.addToHistory.of(false),
    })
    synchronized_content_ref.current.set(activeDocument.id, activeDocument.content)
  }, [activeDocument.content, activeDocument.id])

  return (
    <div className="code-editor-host relative min-h-0 flex-1" ref={host_ref}>
      <div className="h-full min-w-0" ref={container_ref} />
      {context_menu && (
        <EditorContextMenu
          commandState={context_command_state}
          onClose={() => set_context_menu(null)}
          onRunCommand={(command_id) => run_editor_command(command_id)}
          settings={settings}
          x={context_menu.x}
          y={context_menu.y}
        />
      )}
    </div>
  )
})

export default CodeEditor
