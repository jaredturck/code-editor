import { useEffect, useMemo, useRef, useState } from 'react'
import { get_language_for_file, get_language_option } from '../data/languages'
import { clone_editor_settings, default_editor_settings } from '../editor/editorSettings'
import type {
  ActivitySection,
  BottomPanelTab,
  BrowserEditorDocument,
  EditorDiagnostic,
  EditorDocument,
  EditorSettings,
  IndentStyle,
  MediaEditorDocument,
  TerminalSession,
  TextEditorDocument,
  TopMenu,
} from '../types/editor'

const browser_home_page = 'https://duckduckgo.com/'

function normalize_editor_path(file_path: string) {
  const normalized_path = file_path.replace(/\\/g, '/').replace(/\/$/, '')
  return window.editor_api.platform === 'win32' ? normalized_path.toLowerCase() : normalized_path
}

function editor_path_is_same_or_child(parent_path: string, target_path: string) {
  const normalized_parent = normalize_editor_path(parent_path)
  const normalized_target = normalize_editor_path(target_path)

  return normalized_target === normalized_parent || normalized_target.startsWith(`${normalized_parent}/`)
}

function remap_editor_path(old_path: string, new_path: string, target_path: string) {
  return editor_path_is_same_or_child(old_path, target_path)
    ? `${new_path}${target_path.slice(old_path.length)}`
    : target_path
}

function get_editor_path_name(file_path: string) {
  return file_path.split(/[\\/]/).filter(Boolean).pop() ?? file_path
}

const initial_terminals: TerminalSession[] = [
  {
    id: 1,
    name: 'Terminal 1',
    parent_id: null,
    weight: 1,
    status: 'starting',
    exit_code: null,
    cwd: null,
  },
]

function get_next_terminal_id(terminals: TerminalSession[]) {
  const terminal_ids = new Set(terminals.map((terminal) => terminal.id))
  let next_terminal_id = 1

  while (terminal_ids.has(next_terminal_id)) {
    next_terminal_id += 1
  }

  return next_terminal_id
}

function get_next_document_id(documents: EditorDocument[]) {
  const document_ids = new Set(documents.map((document) => document.id))
  let next_document_id = 1

  while (document_ids.has(next_document_id)) {
    next_document_id += 1
  }

  return next_document_id
}

function get_next_untitled_number(documents: EditorDocument[]) {
  const untitled_numbers = new Set(
    documents
      .filter((document): document is TextEditorDocument => document.kind === 'text')
      .map((document) => /^Untitled-(\d+)(?:\..+)?$/.exec(document.name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1])),
  )
  let next_untitled_number = 1

  while (untitled_numbers.has(next_untitled_number)) {
    next_untitled_number += 1
  }

  return next_untitled_number
}

function provider_is_enabled(language: string, settings: EditorSettings) {
  const normalized = language.toLowerCase()
  const diagnostics = settings.diagnostics

  if (normalized === 'python') {
    return diagnostics.enable_python
  }

  if (normalized === 'javascript' || normalized === 'jsx') {
    return diagnostics.enable_javascript
  }

  if (normalized === 'typescript' || normalized === 'tsx') {
    return diagnostics.enable_typescript
  }

  if (normalized === 'css' || normalized === 'scss' || normalized === 'less') {
    return diagnostics.enable_css
  }

  if (normalized === 'html') {
    return diagnostics.enable_html
  }

  if (normalized === 'json' || normalized === 'json5' || normalized === 'jsonc') {
    return diagnostics.enable_json
  }

  if (normalized === 'yaml') {
    return diagnostics.enable_yaml
  }

  if (normalized === 'markdown') {
    return diagnostics.enable_markdown
  }

  return false
}

function useEditorState() {
  const [active_activity, set_active_activity] = useState<ActivitySection>('explorer')
  const [documents, set_documents] = useState<EditorDocument[]>([])
  const [active_document_id, set_active_document_id] = useState<number | null>(null)
  const [pending_close_document_id, set_pending_close_document_id] = useState<number | null>(null)
  const [shutdown_queue, set_shutdown_queue] = useState<number[]>([])
  const [shutdown_in_progress, set_shutdown_in_progress] = useState(false)
  const [bottom_panel_open, set_bottom_panel_open] = useState(true)
  const [bottom_panel_tab, set_bottom_panel_tab] = useState<BottomPanelTab>('terminal')
  const [terminals, set_terminals] = useState<TerminalSession[]>(initial_terminals)
  const [active_terminal_id, set_active_terminal_id] = useState<number | null>(1)
  const [diagnostics, set_diagnostics] = useState<EditorDiagnostic[]>([])
  const [open_menu, set_open_menu] = useState<TopMenu>(null)
  const [menu_pinned, set_menu_pinned] = useState(false)
  const [settings_open, set_settings_open] = useState(false)
  const [new_file_modal_open, set_new_file_modal_open] = useState(false)
  const [indent_picker_open, set_indent_picker_open] = useState(false)
  const [language_picker_open, set_language_picker_open] = useState(false)
  const [ai_chat_open, set_ai_chat_open] = useState(false)
  const [settings, set_settings] = useState<EditorSettings>(() => clone_editor_settings(default_editor_settings))
  const [notice, set_notice] = useState<string | null>(null)
  const [system_is_dark, set_system_is_dark] = useState(true)
  const [is_maximized, set_is_maximized] = useState(false)
  const documents_ref = useRef(documents)
  const active_document_id_ref = useRef(active_document_id)
  const settings_ref = useRef(settings)
  const shutdown_queue_ref = useRef(shutdown_queue)
  const shutdown_in_progress_ref = useRef(shutdown_in_progress)
  const diagnostic_versions_ref = useRef(new Map<number, number>())
  const opening_paths_ref = useRef(new Set<string>())

  documents_ref.current = documents
  active_document_id_ref.current = active_document_id
  settings_ref.current = settings
  shutdown_queue_ref.current = shutdown_queue
  shutdown_in_progress_ref.current = shutdown_in_progress

  useEffect(() => {
    void window.editor_api.settings.get().then((loaded_settings) => {
      const normalized_settings = clone_editor_settings(loaded_settings)

      if (!normalized_settings.restore_recent_files) {
        normalized_settings.recent_files = []
      }

      settings_ref.current = normalized_settings
      set_settings(normalized_settings)
    })
  }, [])

  useEffect(() => {
    if (!notice) {
      return
    }

    const timeout_id = window.setTimeout(() => set_notice(null), 5000)

    return () => window.clearTimeout(timeout_id)
  }, [notice])

  useEffect(() => {
    const media_query = window.matchMedia('(prefers-color-scheme: dark)')
    const update_system_theme = (event: MediaQueryListEvent) => set_system_is_dark(event.matches)

    set_system_is_dark(media_query.matches)
    media_query.addEventListener('change', update_system_theme)

    return () => media_query.removeEventListener('change', update_system_theme)
  }, [])

  useEffect(() => {
    window.editor_api.window.is_maximized().then(set_is_maximized)
    return window.editor_api.window.on_maximized_change(set_is_maximized)
  }, [])

  const validate_saved_documents = async () => {
    const file_documents = documents_ref.current.filter(
      (
        document,
      ): document is (TextEditorDocument | MediaEditorDocument) & {
        file_path: string
      } => (document.kind === 'text' || document.kind === 'media') && document.file_path !== null,
    )
    const file_paths = file_documents.map((document) => document.file_path)

    if (file_paths.length === 0) {
      return
    }

    const path_status = await window.editor_api.file.check_paths(file_paths)

    set_documents((current_documents) =>
      current_documents.map((document) => {
        if ((document.kind !== 'text' && document.kind !== 'media') || !document.file_path) {
          return document
        }

        return { ...document, deleted: !path_status[document.file_path!] }
      }),
    )
  }

  useEffect(() => {
    return window.editor_api.window.on_focus(() => void validate_saved_documents())
  }, [])

  const validate_document_path = async (document_id: number) => {
    const document = documents_ref.current.find(
      (item): item is TextEditorDocument | MediaEditorDocument =>
        (item.kind === 'text' || item.kind === 'media') && item.id === document_id,
    )

    if (!document?.file_path) {
      return
    }

    const path_status = await window.editor_api.file.check_paths([document.file_path])

    set_documents((current_documents) =>
      current_documents.map((current_document) => {
        if (
          (current_document.kind !== 'text' && current_document.kind !== 'media') ||
          current_document.id !== document_id
        ) {
          return current_document
        }

        return {
          ...current_document,
          deleted: !path_status[document.file_path!],
        }
      }),
    )
  }

  useEffect(() => {
    return window.editor_api.browser.on_state_change((browser_state) => {
      set_documents((current_documents) =>
        current_documents.map((document) => {
          if (document.kind !== 'browser' || document.id !== browser_state.id) {
            return document
          }

          return {
            ...document,
            name: browser_state.title || 'Browser',
            url: browser_state.url,
            can_go_back: browser_state.can_go_back,
            can_go_forward: browser_state.can_go_forward,
            loading: browser_state.loading,
          }
        }),
      )
    })
  }, [])

  const cancel_close_document = () => {
    set_pending_close_document_id(null)

    if (shutdown_in_progress_ref.current) {
      set_shutdown_queue([])
      set_shutdown_in_progress(false)
      window.editor_api.app.confirm_close(false)
    }
  }

  useEffect(() => {
    const close_with_escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      set_open_menu(null)
      set_menu_pinned(false)
      set_settings_open(false)
      set_new_file_modal_open(false)
      set_indent_picker_open(false)
      set_language_picker_open(false)

      if (pending_close_document_id !== null) {
        cancel_close_document()
      }
    }

    window.addEventListener('keydown', close_with_escape)
    return () => window.removeEventListener('keydown', close_with_escape)
  }, [pending_close_document_id])

  const resolved_theme = useMemo(() => {
    if (settings.theme_mode === 'system') {
      return system_is_dark ? 'dark' : 'light'
    }

    return settings.theme_mode
  }, [settings.theme_mode, system_is_dark])

  const active_document = useMemo(
    () => documents.find((document) => document.id === active_document_id) ?? null,
    [active_document_id, documents],
  )
  const active_text_document = active_document?.kind === 'text' ? active_document : null
  const active_browser_document = active_document?.kind === 'browser' ? active_document : null
  const active_terminal = useMemo(
    () => terminals.find((terminal) => terminal.id === active_terminal_id) ?? null,
    [active_terminal_id, terminals],
  )
  const visible_terminals = useMemo(() => {
    if (!active_terminal) {
      return []
    }

    const root_id = active_terminal.parent_id ?? active_terminal.id
    const root_terminal = terminals.find((terminal) => terminal.id === root_id)
    const child_terminals = terminals.filter((terminal) => terminal.parent_id === root_id)

    return root_terminal ? [root_terminal, ...child_terminals] : child_terminals
  }, [active_terminal, terminals])

  const close_overlays = () => {
    set_open_menu(null)
    set_menu_pinned(false)
    set_settings_open(false)
    set_new_file_modal_open(false)
    set_indent_picker_open(false)
    set_language_picker_open(false)
  }

  const hover_menu = (menu: Exclude<TopMenu, null>) => {
    set_open_menu(menu)
    set_settings_open(false)
    set_new_file_modal_open(false)
    set_indent_picker_open(false)
    set_language_picker_open(false)
  }

  const leave_menus = () => {
    if (!menu_pinned) {
      set_open_menu(null)
    }
  }

  const toggle_menu = (menu: Exclude<TopMenu, null>) => {
    if (menu_pinned && open_menu === menu) {
      set_open_menu(null)
      set_menu_pinned(false)
      return
    }

    set_open_menu(menu)
    set_menu_pinned(true)
    set_settings_open(false)
    set_new_file_modal_open(false)
    set_indent_picker_open(false)
    set_language_picker_open(false)
  }

  const toggle_settings = () => {
    set_settings_open((current_value) => !current_value)
    set_new_file_modal_open(false)
    set_open_menu(null)
    set_menu_pinned(false)
    set_indent_picker_open(false)
    set_language_picker_open(false)
  }

  const toggle_indent_picker = () => {
    set_indent_picker_open((current_value) => !current_value)
    set_language_picker_open(false)
    set_settings_open(false)
    set_new_file_modal_open(false)
    set_open_menu(null)
    set_menu_pinned(false)
  }

  const toggle_language_picker = () => {
    set_language_picker_open((current_value) => !current_value)
    set_indent_picker_open(false)
    set_settings_open(false)
    set_new_file_modal_open(false)
    set_open_menu(null)
    set_menu_pinned(false)
  }

  const toggle_ai_chat = () => {
    set_ai_chat_open((current_value) => !current_value)
    close_overlays()
  }

  const select_activity = (section: ActivitySection) => {
    set_active_activity(section)
    close_overlays()
  }

  const select_bottom_panel_tab = (tab: BottomPanelTab) => {
    set_bottom_panel_tab(tab)
    set_bottom_panel_open(true)
  }

  const select_terminal = (terminal_id: number) => set_active_terminal_id(terminal_id)
  const close_bottom_panel = () => set_bottom_panel_open(false)
  const dismiss_notice = () => set_notice(null)

  const apply_settings = (next_settings: EditorSettings) => {
    const normalized_settings = clone_editor_settings(next_settings)

    if (!normalized_settings.restore_recent_files) {
      normalized_settings.recent_files = []
    }

    settings_ref.current = normalized_settings
    set_settings(normalized_settings)
    void window.editor_api.settings.update(normalized_settings).then((saved_settings) => {
      settings_ref.current = saved_settings
      set_settings(saved_settings)
    })
  }

  const update_recent_files = (file_paths: string[]) => {
    if (!settings_ref.current.restore_recent_files) {
      return
    }

    const next_recent_files = [...new Set(file_paths)].slice(0, 5)
    const next_settings = {
      ...settings_ref.current,
      recent_files: next_recent_files,
    }

    settings_ref.current = next_settings
    set_settings(next_settings)
    void window.editor_api.settings.update({ recent_files: next_recent_files })
  }

  const add_recent_file = (file_path: string) => {
    update_recent_files([
      file_path,
      ...settings_ref.current.recent_files.filter((recent_file) => recent_file !== file_path),
    ])
  }

  const remove_recent_file = (file_path: string) => {
    update_recent_files(settings_ref.current.recent_files.filter((recent_file) => recent_file !== file_path))
  }

  const open_new_file_modal = () => {
    set_open_menu(null)
    set_menu_pinned(false)
    set_settings_open(false)
    set_indent_picker_open(false)
    set_language_picker_open(false)
    set_new_file_modal_open(true)
  }

  const create_text_file = (language = settings_ref.current.default_language) => {
    const current_documents = documents_ref.current
    const document_id = get_next_document_id(current_documents)
    const untitled_number = get_next_untitled_number(current_documents)
    const language_option = get_language_option(language)
    const selected_language = language_option.name
    const extension = selected_language === 'Plain Text' ? null : language_option.preferred_extension
    const new_document: TextEditorDocument = {
      kind: 'text',
      id: document_id,
      name: `Untitled-${untitled_number}${extension ? `.${extension}` : ''}`,
      content: '',
      saved_content: '',
      file_path: null,
      language: selected_language,
      indent_style: settings_ref.current.editor.default_indent_style,
      indent_size: settings_ref.current.editor.default_indent_size,
      dirty: false,
      deleted: false,
      markdown_view: 'source',
    }

    set_documents([...current_documents, new_document])
    set_active_document_id(new_document.id)
    close_overlays()
  }

  const open_browser = async () => {
    const existing_browser = documents_ref.current.find(
      (document): document is BrowserEditorDocument => document.kind === 'browser',
    )

    close_overlays()

    if (existing_browser) {
      set_active_document_id(existing_browser.id)
      return
    }

    const browser_id = get_next_document_id(documents_ref.current)
    const browser_document: BrowserEditorDocument = {
      kind: 'browser',
      id: browser_id,
      name: 'Browser',
      url: browser_home_page,
      can_go_back: false,
      can_go_forward: false,
      loading: true,
    }

    set_documents([...documents_ref.current, browser_document])
    set_active_document_id(browser_id)

    const browser_state = await window.editor_api.browser.create(browser_id, browser_home_page)

    set_documents((current_documents) =>
      current_documents.map((document) =>
        document.kind === 'browser' && document.id === browser_id
          ? {
              ...document,
              name: browser_state.title || 'Browser',
              url: browser_state.url,
              can_go_back: browser_state.can_go_back,
              can_go_forward: browser_state.can_go_forward,
              loading: browser_state.loading,
            }
          : document,
      ),
    )
  }

  const select_document = (document_id: number) => {
    set_active_document_id(document_id)
    close_overlays()
  }

  const close_document_immediately = (document_id: number) => {
    const current_documents = documents_ref.current
    const document_index = current_documents.findIndex((document) => document.id === document_id)
    const closing_document = current_documents[document_index]
    const remaining_documents = current_documents.filter((document) => document.id !== document_id)

    if (!closing_document) {
      return
    }

    if (closing_document.kind === 'browser') {
      window.editor_api.browser.destroy(closing_document.id)
    }

    set_diagnostics((current) => current.filter((diagnostic) => diagnostic.document_id !== document_id))
    diagnostic_versions_ref.current.delete(document_id)

    if (active_document_id_ref.current === document_id) {
      const replacement_index = Math.min(document_index, remaining_documents.length - 1)
      set_active_document_id(remaining_documents[replacement_index]?.id ?? null)
    }

    set_documents(remaining_documents)
  }

  const close_document = (document_id: number) => {
    const document = documents_ref.current.find((item) => item.id === document_id)

    if (!document) {
      return
    }

    if (document.kind === 'text' && document.dirty && settings_ref.current.confirm_unsaved_close) {
      set_pending_close_document_id(document_id)
      close_overlays()
      return
    }

    close_document_immediately(document_id)
  }

  const update_document = (document_id: number, content: string) => {
    set_documents((current_documents) =>
      current_documents.map((document) =>
        document.kind === 'text' && document.id === document_id
          ? { ...document, content, dirty: content !== document.saved_content }
          : document,
      ),
    )
  }

  const update_document_indentation = (document_id: number, indent_style: IndentStyle, indent_size: number) => {
    set_documents((current_documents) =>
      current_documents.map((document) =>
        document.kind === 'text' && document.id === document_id ? { ...document, indent_style, indent_size } : document,
      ),
    )
    set_indent_picker_open(false)
  }

  const update_document_language = (document_id: number, language: string) => {
    set_documents((current_documents) =>
      current_documents.map((document) =>
        document.kind === 'text' && document.id === document_id ? { ...document, language } : document,
      ),
    )
    set_language_picker_open(false)
  }

  const toggle_markdown_view = (document_id: number, markdown_view: TextEditorDocument['markdown_view']) => {
    set_documents((current_documents) =>
      current_documents.map((document) =>
        document.kind === 'text' && document.id === document_id ? { ...document, markdown_view } : document,
      ),
    )
  }

  const mark_document_deleted = (document_id: number) => {
    set_documents((current_documents) =>
      current_documents.map((document) =>
        (document.kind === 'text' || document.kind === 'media') && document.id === document_id
          ? { ...document, deleted: true }
          : document,
      ),
    )
  }

  const replace_provider_diagnostics = (document_id: number, next: EditorDiagnostic[]) => {
    set_diagnostics((current) => [
      ...current.filter(
        (diagnostic) => diagnostic.document_id !== document_id || diagnostic.source === 'CodeMirror Parser',
      ),
      ...next,
    ])
  }

  const update_parser_diagnostics = (document_id: number, next: EditorDiagnostic[]) => {
    set_diagnostics((current) => [
      ...current.filter(
        (diagnostic) => diagnostic.document_id !== document_id || diagnostic.source !== 'CodeMirror Parser',
      ),
      ...next,
    ])
  }

  const analyze_document = async (document_id: number) => {
    const document = documents_ref.current.find(
      (item): item is TextEditorDocument => item.kind === 'text' && item.id === document_id,
    )
    const current_settings = settings_ref.current

    if (
      !document ||
      current_settings.diagnostics.mode === 'off' ||
      !provider_is_enabled(document.language, current_settings)
    ) {
      replace_provider_diagnostics(document_id, [])
      return
    }

    const version = (diagnostic_versions_ref.current.get(document_id) ?? 0) + 1
    const content = document.content
    diagnostic_versions_ref.current.set(document_id, version)

    try {
      const raw_diagnostics = await window.editor_api.diagnostics.analyze({
        language: document.language,
        content,
        file_path: document.file_path,
      })

      if (
        diagnostic_versions_ref.current.get(document_id) !== version ||
        documents_ref.current.find(
          (item): item is TextEditorDocument => item.id === document_id && item.kind === 'text',
        )?.content !== content
      ) {
        return
      }

      const next = raw_diagnostics.map((diagnostic, index) => ({
        ...diagnostic,
        id: `${document_id}:${version}:${index}:${diagnostic.source}`,
        document_id,
        file_path: document.file_path,
      }))

      replace_provider_diagnostics(document_id, next)

      if (
        current_settings.diagnostics.auto_reveal_problems &&
        next.some((diagnostic) => diagnostic.severity === 'error')
      ) {
        set_bottom_panel_tab('problems')
        set_bottom_panel_open(true)
      }
    } catch (error) {
      replace_provider_diagnostics(document_id, [])
      const message = error instanceof Error ? error.message : 'Diagnostics failed.'
      set_notice(`${document.language} diagnostics: ${message}`)
    }
  }

  const diagnostic_document_signature = documents
    .filter((document): document is TextEditorDocument => document.kind === 'text')
    .map((document) => `${document.id}:${document.language}`)
    .join('|')

  useEffect(() => {
    if (settings.diagnostics.mode === 'off') {
      set_diagnostics([])
      return
    }

    const enabled_document_ids = new Set(
      documents_ref.current
        .filter((document): document is TextEditorDocument => document.kind === 'text')
        .filter((document) => provider_is_enabled(document.language, settings_ref.current))
        .map((document) => document.id),
    )

    set_diagnostics((current) =>
      current.filter((diagnostic) =>
        diagnostic.source === 'CodeMirror Parser'
          ? settings_ref.current.diagnostics.enable_parser_fallback
          : enabled_document_ids.has(diagnostic.document_id),
      ),
    )
  }, [
    diagnostic_document_signature,
    settings.diagnostics.enable_css,
    settings.diagnostics.enable_html,
    settings.diagnostics.enable_javascript,
    settings.diagnostics.enable_json,
    settings.diagnostics.enable_markdown,
    settings.diagnostics.enable_parser_fallback,
    settings.diagnostics.enable_python,
    settings.diagnostics.enable_typescript,
    settings.diagnostics.enable_yaml,
    settings.diagnostics.mode,
  ])

  useEffect(() => {
    if (settings.diagnostics.mode === 'off') {
      set_diagnostics([])
      return
    }

    if (!active_text_document || settings.diagnostics.mode !== 'typing') {
      return
    }

    const timeout_id = window.setTimeout(
      () => void analyze_document(active_text_document.id),
      Math.max(500, settings.diagnostics.delay),
    )

    return () => window.clearTimeout(timeout_id)
  }, [
    active_text_document?.content,
    active_text_document?.file_path,
    active_text_document?.id,
    active_text_document?.language,
    settings.diagnostics,
  ])

  const save_document = async (save_as = false, document_id = active_document_id_ref.current) => {
    const document = documents_ref.current.find((item) => item.id === document_id)

    close_overlays()

    if (!document || document.kind !== 'text') {
      return false
    }

    let force_save_as = save_as || document.deleted || !document.file_path

    if (document.file_path && !force_save_as) {
      const path_status = await window.editor_api.file.check_paths([document.file_path])

      if (!path_status[document.file_path]) {
        mark_document_deleted(document.id)
        force_save_as = true
      }
    }

    const saved_content = document.content
    const language_option = get_language_option(document.language)
    const preferred_extension = language_option.preferred_extension ?? 'txt'
    const suggested_name =
      document.file_path || document.name.includes('.') ? document.name : `${document.name}.${preferred_extension}`
    const save_options = {
      content: saved_content,
      file_path: document.file_path,
      save_as: force_save_as,
      suggested_name,
      file_type_name: `${language_option.name} files`,
      file_extensions: language_option.extensions,
    }
    let saved_file

    try {
      saved_file = await window.editor_api.file.save_text(save_options)

      if (saved_file?.status === 'missing') {
        mark_document_deleted(document.id)
        saved_file = await window.editor_api.file.save_text({
          ...save_options,
          save_as: true,
          suggested_name: document.name,
        })
      }
    } catch {
      set_notice(`Unable to save ${document.name}.`)
      return false
    }

    if (!saved_file || saved_file.status !== 'saved') {
      return false
    }

    set_documents((current_documents) =>
      current_documents.map((current_document) =>
        current_document.kind === 'text' && current_document.id === document.id
          ? {
              ...current_document,
              name: saved_file.name,
              file_path: saved_file.file_path,
              saved_content,
              dirty: current_document.content !== saved_content,
              deleted: false,
            }
          : current_document,
      ),
    )
    add_recent_file(saved_file.file_path)

    if (settings_ref.current.diagnostics.mode !== 'off') {
      window.setTimeout(() => void analyze_document(document.id), 0)
    }

    return true
  }

  const advance_shutdown = (resolved_document_id: number) => {
    const remaining = shutdown_queue_ref.current.filter((id) => id !== resolved_document_id)
    set_shutdown_queue(remaining)

    if (remaining.length > 0) {
      set_pending_close_document_id(remaining[0])
      set_active_document_id(remaining[0])
      return
    }

    set_pending_close_document_id(null)
    set_shutdown_in_progress(false)
    window.editor_api.app.confirm_close(true)
  }

  const confirm_close_save = async () => {
    if (pending_close_document_id === null) {
      return
    }

    const document_id = pending_close_document_id
    const saved = await save_document(false, document_id)

    if (!saved) {
      return
    }

    if (shutdown_in_progress_ref.current) {
      advance_shutdown(document_id)
      return
    }

    set_pending_close_document_id(null)
    close_document_immediately(document_id)
  }

  const confirm_close_discard = () => {
    if (pending_close_document_id === null) {
      return
    }

    const document_id = pending_close_document_id

    if (shutdown_in_progress_ref.current) {
      advance_shutdown(document_id)
      return
    }

    set_pending_close_document_id(null)
    close_document_immediately(document_id)
  }

  useEffect(() => {
    return window.editor_api.app.on_close_request(() => {
      if (shutdown_in_progress_ref.current) {
        return
      }

      const dirty_documents = documents_ref.current.filter(
        (document): document is TextEditorDocument => document.kind === 'text' && document.dirty,
      )

      if (!settings_ref.current.confirm_unsaved_close || dirty_documents.length === 0) {
        window.editor_api.app.confirm_close(true)
        return
      }

      const queue = dirty_documents.map((document) => document.id)
      set_shutdown_queue(queue)
      set_shutdown_in_progress(true)
      set_pending_close_document_id(queue[0])
      set_active_document_id(queue[0])
      close_overlays()
    })
  }, [])

  useEffect(() => {
    const save_with_shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
        return
      }

      event.preventDefault()
      void save_document(event.shiftKey)
    }

    window.addEventListener('keydown', save_with_shortcut, true)
    return () => window.removeEventListener('keydown', save_with_shortcut, true)
  })

  const create_terminal = (cwd: string | null = null) => {
    const terminal_id = get_next_terminal_id(terminals)
    const new_terminal: TerminalSession = {
      id: terminal_id,
      name: `Terminal ${terminal_id}`,
      parent_id: null,
      weight: 1,
      status: 'starting',
      exit_code: null,
      cwd,
    }

    set_terminals([...terminals, new_terminal])
    set_active_terminal_id(new_terminal.id)
    set_bottom_panel_tab('terminal')
    set_bottom_panel_open(true)
    close_overlays()
  }

  const split_terminal = (cwd: string | null = null) => {
    if (!active_terminal) {
      create_terminal(cwd)
      return
    }

    const terminal_id = get_next_terminal_id(terminals)
    const root_id = active_terminal.parent_id ?? active_terminal.id
    const split_weight = active_terminal.weight / 2
    const new_terminal: TerminalSession = {
      id: terminal_id,
      name: `Terminal ${terminal_id}`,
      parent_id: root_id,
      weight: split_weight,
      status: 'starting',
      exit_code: null,
      cwd,
    }

    set_terminals((current_terminals) => {
      const updated_terminals = current_terminals.map((terminal) =>
        terminal.id === active_terminal.id ? { ...terminal, weight: split_weight } : terminal,
      )
      const active_index = updated_terminals.findIndex((terminal) => terminal.id === active_terminal.id)
      updated_terminals.splice(active_index + 1, 0, new_terminal)
      return updated_terminals
    })
    set_active_terminal_id(new_terminal.id)
    set_bottom_panel_tab('terminal')
    set_bottom_panel_open(true)
    close_overlays()
  }

  const delete_terminal = (terminal_id: number) => {
    const terminal = terminals.find((item) => item.id === terminal_id)

    if (!terminal) {
      return
    }

    window.editor_api.terminal.kill(terminal_id)
    const root_id = terminal.parent_id ?? terminal.id
    const group_members = terminals.filter((item) => item.id === root_id || item.parent_id === root_id)
    const root_terminal = group_members.find((item) => item.id === root_id)
    const group = root_terminal
      ? [root_terminal, ...group_members.filter((item) => item.id !== root_id)]
      : group_members
    const group_index = group.findIndex((item) => item.id === terminal_id)
    const nearest_terminal = group[group_index - 1] ?? group[group_index + 1] ?? null
    const terminal_index = terminals.findIndex((item) => item.id === terminal_id)
    const child_terminals = terminals.filter((item) => item.parent_id === terminal_id)
    let remaining_terminals = terminals.filter((item) => item.id !== terminal_id)
    let replacement_id: number | null = active_terminal_id

    if (nearest_terminal) {
      remaining_terminals = remaining_terminals.map((item) =>
        item.id === nearest_terminal.id ? { ...item, weight: item.weight + terminal.weight } : item,
      )
    }

    if (terminal.parent_id === null && child_terminals.length > 0) {
      const promoted_terminal = child_terminals[0]
      remaining_terminals = remaining_terminals.map((item) => {
        if (item.id === promoted_terminal.id) {
          return { ...item, parent_id: null }
        }

        return item.parent_id === terminal_id ? { ...item, parent_id: promoted_terminal.id } : item
      })

      if (active_terminal_id === terminal_id) {
        replacement_id = promoted_terminal.id
      }
    } else if (active_terminal_id === terminal_id) {
      if (terminal.parent_id !== null) {
        replacement_id = nearest_terminal?.id ?? terminal.parent_id
      } else {
        const replacement_index = Math.min(terminal_index, remaining_terminals.length - 1)
        replacement_id = remaining_terminals[replacement_index]?.id ?? null
      }
    }

    set_terminals(remaining_terminals)
    set_active_terminal_id(replacement_id)
  }

  const update_terminal_status = (
    terminal_id: number,
    status: TerminalSession['status'],
    exit_code: number | null = null,
  ) => {
    set_terminals((current_terminals) =>
      current_terminals.map((terminal) =>
        terminal.id === terminal_id ? { ...terminal, status, exit_code } : terminal,
      ),
    )
  }

  const resize_terminal_panes = (
    left_terminal_id: number,
    right_terminal_id: number,
    left_weight: number,
    right_weight: number,
  ) => {
    set_terminals((current_terminals) =>
      current_terminals.map((terminal) => {
        if (terminal.id === left_terminal_id) {
          return { ...terminal, weight: left_weight }
        }

        return terminal.id === right_terminal_id ? { ...terminal, weight: right_weight } : terminal
      }),
    )
  }

  const show_notice = (message: string) => set_notice(message)

  const remap_document_paths = (old_path: string, new_path: string, is_directory: boolean) => {
    const affected_media: Array<{ id: number; file_path: string }> = []
    const next_documents = documents_ref.current.map((document) => {
      if ((document.kind !== 'text' && document.kind !== 'media') || !document.file_path) {
        return document
      }

      const path_matches = is_directory
        ? editor_path_is_same_or_child(old_path, document.file_path)
        : normalize_editor_path(document.file_path) === normalize_editor_path(old_path)

      if (!path_matches) {
        return document
      }

      const file_path = remap_editor_path(old_path, new_path, document.file_path)

      if (document.kind === 'text') {
        return {
          ...document,
          name: get_editor_path_name(file_path),
          file_path,
          language: get_language_for_file(file_path),
          deleted: false,
        }
      }

      affected_media.push({ id: document.id, file_path })
      return {
        ...document,
        name: get_editor_path_name(file_path),
        file_path,
        deleted: false,
      }
    })

    documents_ref.current = next_documents
    set_documents(next_documents)
    set_diagnostics((current_diagnostics) =>
      current_diagnostics.map((diagnostic) => {
        if (!diagnostic.file_path) {
          return diagnostic
        }

        const path_matches = is_directory
          ? editor_path_is_same_or_child(old_path, diagnostic.file_path)
          : normalize_editor_path(diagnostic.file_path) === normalize_editor_path(old_path)

        return path_matches
          ? { ...diagnostic, file_path: remap_editor_path(old_path, new_path, diagnostic.file_path) }
          : diagnostic
      }),
    )

    const next_recent_files = settings_ref.current.recent_files.map((recent_file) =>
      is_directory
        ? remap_editor_path(old_path, new_path, recent_file)
        : normalize_editor_path(recent_file) === normalize_editor_path(old_path)
          ? new_path
          : recent_file,
    )
    update_recent_files(next_recent_files)

    for (const media of affected_media) {
      void window.editor_api.file.open(media.file_path).then((opened_file) => {
        if (opened_file.status !== 'opened' || opened_file.kind === 'text') {
          return
        }

        set_documents((current_documents) =>
          current_documents.map((document) =>
            document.kind === 'media' && document.id === media.id
              ? { ...document, url: opened_file.resource_url ?? document.url, mime_type: opened_file.mime_type }
              : document,
          ),
        )
      })
    }
  }

  const mark_document_paths_deleted = (target_path: string, is_directory: boolean) => {
    const next_documents = documents_ref.current.map((document) => {
      if ((document.kind !== 'text' && document.kind !== 'media') || !document.file_path) {
        return document
      }

      const path_matches = is_directory
        ? editor_path_is_same_or_child(target_path, document.file_path)
        : normalize_editor_path(document.file_path) === normalize_editor_path(target_path)

      return path_matches ? { ...document, deleted: true } : document
    })

    documents_ref.current = next_documents
    set_documents(next_documents)
  }

  const open_file_path = async (file_path: string) => {
    close_overlays()
    const normalized_file_path = normalize_editor_path(file_path)
    const existing_document = documents_ref.current.find(
      (document) =>
        (document.kind === 'text' || document.kind === 'media') &&
        normalize_editor_path(document.file_path ?? '') === normalized_file_path,
    )

    if (existing_document) {
      set_active_document_id(existing_document.id)
      add_recent_file(file_path)
      return
    }

    if (opening_paths_ref.current.has(normalized_file_path)) {
      return
    }

    opening_paths_ref.current.add(normalized_file_path)

    try {
      const opened_file = await window.editor_api.file.open(file_path)

      if (opened_file.status !== 'opened') {
        if (opened_file.status === 'missing') {
          remove_recent_file(file_path)
        }

        set_notice(opened_file.message)
        return
      }

      const current_documents = documents_ref.current
      const duplicate_document = current_documents.find(
        (document) =>
          (document.kind === 'text' || document.kind === 'media') &&
          normalize_editor_path(document.file_path ?? '') === normalize_editor_path(opened_file.file_path),
      )

      if (duplicate_document) {
        set_active_document_id(duplicate_document.id)
        add_recent_file(opened_file.file_path)
        return
      }

      const document_id = get_next_document_id(current_documents)
      let new_document: EditorDocument

      if (opened_file.kind === 'text') {
        new_document = {
          kind: 'text',
          id: document_id,
          name: opened_file.name,
          content: opened_file.content ?? '',
          saved_content: opened_file.content ?? '',
          file_path: opened_file.file_path,
          language: get_language_for_file(opened_file.file_path),
          indent_style: settings_ref.current.editor.default_indent_style,
          indent_size: settings_ref.current.editor.default_indent_size,
          dirty: false,
          deleted: false,
          markdown_view: 'source',
        }
      } else {
        new_document = {
          kind: 'media',
          id: document_id,
          name: opened_file.name,
          file_path: opened_file.file_path,
          media_type: opened_file.kind,
          mime_type: opened_file.mime_type,
          url: opened_file.resource_url ?? '',
          size: opened_file.size,
          deleted: false,
        }
      }

      const next_documents = [...current_documents, new_document]
      documents_ref.current = next_documents
      set_documents(next_documents)
      set_active_document_id(new_document.id)
      add_recent_file(opened_file.file_path)
    } finally {
      opening_paths_ref.current.delete(normalized_file_path)
    }
  }

  const open_file_dialog = async () => {
    set_open_menu(null)
    set_menu_pinned(false)
    const file_path = await window.editor_api.dialog.open_file()

    if (file_path) {
      await open_file_path(file_path)
    }
  }

  const open_recent_file = async (file_path: string) => {
    set_open_menu(null)
    set_menu_pinned(false)
    await open_file_path(file_path)
  }

  const open_diagnostic = (diagnostic: EditorDiagnostic) => {
    set_active_document_id(diagnostic.document_id)
    set_bottom_panel_tab('problems')
    set_bottom_panel_open(true)
    const document = documents_ref.current.find((item) => item.id === diagnostic.document_id)

    if (document?.kind === 'text' && document.markdown_view === 'preview') {
      toggle_markdown_view(document.id, 'source')
    }
  }

  const pending_close_document =
    documents.find((document) => document.id === pending_close_document_id && document.kind === 'text') ?? null
  const overlay_open =
    open_menu !== null ||
    settings_open ||
    new_file_modal_open ||
    indent_picker_open ||
    language_picker_open ||
    pending_close_document !== null

  return {
    active_activity,
    active_browser_document,
    active_document,
    active_document_id,
    active_terminal_id,
    active_text_document,
    ai_chat_open,
    apply_settings,
    bottom_panel_open,
    bottom_panel_tab,
    cancel_close_document,
    close_bottom_panel,
    close_document,
    close_overlays,
    confirm_close_discard,
    confirm_close_save,
    create_terminal,
    create_text_file,
    delete_terminal,
    diagnostics,
    dismiss_notice,
    documents,
    hover_menu,
    indent_picker_open,
    is_maximized,
    language_picker_open,
    leave_menus,
    new_file_modal_open,
    notice,
    open_browser,
    open_diagnostic,
    open_file_dialog,
    open_file_path,
    open_menu,
    open_new_file_modal,
    open_recent_file,
    overlay_open,
    pending_close_document,
    recent_files: settings.recent_files,
    remap_document_paths,
    resize_terminal_panes,
    resolved_theme,
    save_document,
    show_notice,
    select_activity,
    select_bottom_panel_tab,
    select_document,
    select_terminal,
    settings,
    settings_open,
    split_terminal,
    terminals,
    theme_mode: settings.theme_mode,
    toggle_ai_chat,
    toggle_indent_picker,
    toggle_language_picker,
    toggle_markdown_view,
    toggle_menu,
    toggle_settings,
    mark_document_paths_deleted,
    update_document,
    update_document_indentation,
    update_document_language,
    update_parser_diagnostics,
    update_terminal_status,
    validate_document_path,
    visible_terminals,
  }
}

export default useEditorState
