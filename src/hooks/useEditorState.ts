import { useEffect, useMemo, useRef, useState } from 'react'
import { get_language_for_file, get_language_option } from '../data/languages'
import { clone_editor_settings, default_editor_settings } from '../editor/editorSettings'
import type {
  ActivitySection,
  BottomPanelTab,
  BrowserEditorDocument,
  EditorDocument,
  EditorSettings,
  IndentStyle,
  TerminalSession,
  TextEditorDocument,
  TopMenu,
} from '../types/editor'

const browser_home_page = 'https://duckduckgo.com/'

const initial_terminals: TerminalSession[] = [
  {
    id: 1,
    name: 'Terminal 1',
    history: [],
    input: '',
    parent_id: null,
    weight: 1,
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

function useEditorState() {
  const [active_activity, set_active_activity] = useState<ActivitySection>('explorer')
  const [documents, set_documents] = useState<EditorDocument[]>([])
  const [active_document_id, set_active_document_id] = useState<number | null>(null)
  const [pending_close_document_id, set_pending_close_document_id] = useState<number | null>(null)
  const [bottom_panel_open, set_bottom_panel_open] = useState(true)
  const [bottom_panel_tab, set_bottom_panel_tab] = useState<BottomPanelTab>('terminal')
  const [terminals, set_terminals] = useState<TerminalSession[]>(initial_terminals)
  const [active_terminal_id, set_active_terminal_id] = useState<number | null>(1)
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

  documents_ref.current = documents
  active_document_id_ref.current = active_document_id
  settings_ref.current = settings

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

    set_system_is_dark(media_query.matches)

    const update_system_theme = (event: MediaQueryListEvent) => {
      set_system_is_dark(event.matches)
    }

    media_query.addEventListener('change', update_system_theme)

    return () => {
      media_query.removeEventListener('change', update_system_theme)
    }
  }, [])

  useEffect(() => {
    window.editor_api.window.is_maximized().then(set_is_maximized)

    return window.editor_api.window.on_maximized_change(set_is_maximized)
  }, [])

  const validate_saved_documents = async () => {
    const saved_documents = documents_ref.current.filter(
      (document): document is TextEditorDocument & { file_path: string } =>
        document.kind === 'text' && document.file_path !== null,
    )
    const file_paths = saved_documents.map((document) => document.file_path)

    if (file_paths.length === 0) {
      return
    }

    const path_status = await window.editor_api.file.check_paths(file_paths)

    set_documents((current_documents) =>
      current_documents.map((document) => {
        if (document.kind !== 'text' || !document.file_path || path_status[document.file_path] === undefined) {
          return document
        }

        return {
          ...document,
          deleted: !path_status[document.file_path],
        }
      }),
    )
  }

  useEffect(() => {
    return window.editor_api.window.on_focus(() => {
      void validate_saved_documents()
    })
  }, [])

  const validate_document_path = async (document_id: number) => {
    const document = documents_ref.current.find(
      (item): item is TextEditorDocument => item.kind === 'text' && item.id === document_id,
    )

    if (!document?.file_path) {
      return
    }

    const path_status = await window.editor_api.file.check_paths([document.file_path])

    set_documents((current_documents) =>
      current_documents.map((current_document) => {
        if (current_document.kind !== 'text' || current_document.id !== document_id) {
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
      set_pending_close_document_id(null)
    }

    window.addEventListener('keydown', close_with_escape)

    return () => {
      window.removeEventListener('keydown', close_with_escape)
    }
  }, [])

  const resolved_theme = useMemo(() => {
    if (settings.theme_mode === 'system') {
      return system_is_dark ? 'dark' : 'light'
    }

    return settings.theme_mode
  }, [settings.theme_mode, system_is_dark])

  const active_document = useMemo(() => {
    return documents.find((document) => document.id === active_document_id) ?? null
  }, [active_document_id, documents])

  const active_text_document = active_document?.kind === 'text' ? active_document : null
  const active_browser_document = active_document?.kind === 'browser' ? active_document : null

  const active_terminal = useMemo(() => {
    return terminals.find((terminal) => terminal.id === active_terminal_id) ?? null
  }, [active_terminal_id, terminals])

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

  const select_terminal = (terminal_id: number) => {
    set_active_terminal_id(terminal_id)
  }

  const close_bottom_panel = () => {
    set_bottom_panel_open(false)
  }

  const dismiss_notice = () => {
    set_notice(null)
  }

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
      current_documents.map((document) => {
        if (document.kind !== 'browser' || document.id !== browser_id) {
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
      current_documents.map((document) => {
        if (document.kind !== 'text' || document.id !== document_id) {
          return document
        }

        return {
          ...document,
          content,
          dirty: content !== document.saved_content,
        }
      }),
    )
  }

  const update_document_indentation = (document_id: number, indent_style: IndentStyle, indent_size: number) => {
    set_documents((current_documents) =>
      current_documents.map((document) => {
        if (document.kind !== 'text' || document.id !== document_id) {
          return document
        }

        return {
          ...document,
          indent_style,
          indent_size,
        }
      }),
    )
    set_indent_picker_open(false)
  }

  const update_document_language = (document_id: number, language: string) => {
    set_documents((current_documents) =>
      current_documents.map((document) => {
        if (document.kind !== 'text' || document.id !== document_id) {
          return document
        }

        return {
          ...document,
          language,
        }
      }),
    )
    set_language_picker_open(false)
  }

  const mark_document_deleted = (document_id: number) => {
    set_documents((current_documents) =>
      current_documents.map((document) => {
        if (document.kind !== 'text' || document.id !== document_id) {
          return document
        }

        return {
          ...document,
          deleted: true,
        }
      }),
    )
  }

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
      current_documents.map((current_document) => {
        if (current_document.kind !== 'text' || current_document.id !== document.id) {
          return current_document
        }

        return {
          ...current_document,
          name: saved_file.name,
          file_path: saved_file.file_path,
          saved_content,
          dirty: current_document.content !== saved_content,
          deleted: false,
        }
      }),
    )
    add_recent_file(saved_file.file_path)

    return true
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

    set_pending_close_document_id(null)
    close_document_immediately(document_id)
  }

  const confirm_close_discard = () => {
    if (pending_close_document_id === null) {
      return
    }

    const document_id = pending_close_document_id
    set_pending_close_document_id(null)
    close_document_immediately(document_id)
  }

  const cancel_close_document = () => {
    set_pending_close_document_id(null)
  }

  useEffect(() => {
    const save_with_shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
        return
      }

      event.preventDefault()
      void save_document(event.shiftKey)
    }

    window.addEventListener('keydown', save_with_shortcut, true)

    return () => {
      window.removeEventListener('keydown', save_with_shortcut, true)
    }
  })

  const create_terminal = () => {
    const current_terminals = terminals
    const terminal_id = get_next_terminal_id(current_terminals)
    const new_terminal: TerminalSession = {
      id: terminal_id,
      name: `Terminal ${terminal_id}`,
      history: [],
      input: '',
      parent_id: null,
      weight: 1,
    }

    set_terminals([...current_terminals, new_terminal])
    set_active_terminal_id(new_terminal.id)
    set_bottom_panel_tab('terminal')
    set_bottom_panel_open(true)
    close_overlays()
  }

  const split_terminal = () => {
    if (!active_terminal) {
      create_terminal()
      return
    }

    const terminal_id = get_next_terminal_id(terminals)
    const root_id = active_terminal.parent_id ?? active_terminal.id
    const split_weight = active_terminal.weight / 2
    const new_terminal: TerminalSession = {
      id: terminal_id,
      name: `Terminal ${terminal_id}`,
      history: [],
      input: '',
      parent_id: root_id,
      weight: split_weight,
    }

    set_terminals((current_terminals) => {
      const updated_terminals = current_terminals.map((terminal) => {
        if (terminal.id !== active_terminal.id) {
          return terminal
        }

        return {
          ...terminal,
          weight: split_weight,
        }
      })
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
      remaining_terminals = remaining_terminals.map((item) => {
        if (item.id !== nearest_terminal.id) {
          return item
        }

        return {
          ...item,
          weight: item.weight + terminal.weight,
        }
      })
    }

    if (terminal.parent_id === null && child_terminals.length > 0) {
      const promoted_terminal = child_terminals[0]

      remaining_terminals = remaining_terminals.map((item) => {
        if (item.id === promoted_terminal.id) {
          return {
            ...item,
            parent_id: null,
          }
        }

        if (item.parent_id === terminal_id) {
          return {
            ...item,
            parent_id: promoted_terminal.id,
          }
        }

        return item
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

        if (terminal.id === right_terminal_id) {
          return { ...terminal, weight: right_weight }
        }

        return terminal
      }),
    )
  }

  const update_terminal_input = (terminal_id: number, input: string) => {
    set_terminals((current_terminals) =>
      current_terminals.map((terminal) => {
        if (terminal.id !== terminal_id) {
          return terminal
        }

        return {
          ...terminal,
          input,
        }
      }),
    )
  }

  const submit_terminal_input = (terminal_id: number) => {
    set_terminals((current_terminals) =>
      current_terminals.map((terminal) => {
        if (terminal.id !== terminal_id) {
          return terminal
        }

        const history = terminal.input.length > 0 ? [...terminal.history, terminal.input] : terminal.history

        return {
          ...terminal,
          history,
          input: '',
        }
      }),
    )
  }

  const open_file_path = async (file_path: string) => {
    close_overlays()

    const existing_document = documents_ref.current.find(
      (document): document is TextEditorDocument => document.kind === 'text' && document.file_path === file_path,
    )

    if (existing_document) {
      set_active_document_id(existing_document.id)
      add_recent_file(file_path)
      return
    }

    const opened_file = await window.editor_api.file.read_text(file_path)

    if (opened_file.status !== 'opened') {
      if (opened_file.status === 'missing') {
        remove_recent_file(file_path)
      }

      set_notice(opened_file.message)
      return
    }

    const current_documents = documents_ref.current
    const document_id = get_next_document_id(current_documents)
    const new_document: TextEditorDocument = {
      kind: 'text',
      id: document_id,
      name: opened_file.name,
      content: opened_file.content,
      saved_content: opened_file.content,
      file_path: opened_file.file_path,
      language: get_language_for_file(opened_file.file_path),
      indent_style: settings_ref.current.editor.default_indent_style,
      indent_size: settings_ref.current.editor.default_indent_size,
      dirty: false,
      deleted: false,
    }

    set_documents([...current_documents, new_document])
    set_active_document_id(new_document.id)
    add_recent_file(opened_file.file_path)
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

  const open_folder_dialog = async () => {
    set_open_menu(null)
    set_menu_pinned(false)
    await window.editor_api.dialog.open_folder()
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
    apply_settings,
    active_browser_document,
    active_document,
    active_document_id,
    active_terminal_id,
    active_text_document,
    ai_chat_open,
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
    open_file_dialog,
    open_folder_dialog,
    open_new_file_modal,
    open_recent_file,
    open_menu,
    overlay_open,
    pending_close_document,
    recent_files: settings.recent_files,
    resize_terminal_panes,
    resolved_theme,
    save_document,
    select_activity,
    select_document,
    select_bottom_panel_tab,
    select_terminal,
    settings,
    settings_open,
    split_terminal,
    submit_terminal_input,
    terminals,
    theme_mode: settings.theme_mode,
    toggle_ai_chat,
    toggle_indent_picker,
    toggle_language_picker,
    toggle_menu,
    toggle_settings,
    update_document,
    validate_document_path,
    update_document_indentation,
    update_document_language,
    update_terminal_input,
    visible_terminals,
  }
}

export default useEditorState
