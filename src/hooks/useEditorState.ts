import { useEffect, useMemo, useState } from 'react'
import type {
  ActivitySection,
  BottomPanelTab,
  EditorDocument,
  TerminalSession,
  ThemeMode,
  TopMenu,
} from '../types/editor'

const initial_terminals: TerminalSession[] = [
  {
    id: 1,
    name: 'Terminal 1',
    history: [],
    input: '',
    parent_id: null,
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
      .map((document) => /^Untitled-(\d+)$/.exec(document.name))
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
  const [bottom_panel_open, set_bottom_panel_open] = useState(true)
  const [bottom_panel_tab, set_bottom_panel_tab] = useState<BottomPanelTab>('terminal')
  const [terminals, set_terminals] = useState<TerminalSession[]>(initial_terminals)
  const [active_terminal_id, set_active_terminal_id] = useState<number | null>(1)
  const [open_menu, set_open_menu] = useState<TopMenu>(null)
  const [menu_pinned, set_menu_pinned] = useState(false)
  const [settings_open, set_settings_open] = useState(false)
  const [ai_chat_open, set_ai_chat_open] = useState(false)
  const [theme_mode, set_theme_mode] = useState<ThemeMode>('dark')
  const [system_is_dark, set_system_is_dark] = useState(true)
  const [is_maximized, set_is_maximized] = useState(false)

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

  useEffect(() => {
    const close_with_escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        set_open_menu(null)
        set_menu_pinned(false)
        set_settings_open(false)
      }
    }

    window.addEventListener('keydown', close_with_escape)

    return () => {
      window.removeEventListener('keydown', close_with_escape)
    }
  }, [])

  const resolved_theme = useMemo(() => {
    if (theme_mode === 'system') {
      return system_is_dark ? 'dark' : 'light'
    }

    return theme_mode
  }, [system_is_dark, theme_mode])

  const active_terminal = useMemo(() => {
    return terminals.find((terminal) => terminal.id === active_terminal_id) ?? null
  }, [active_terminal_id, terminals])

  const visible_terminals = useMemo(() => {
    if (!active_terminal) {
      return []
    }

    const root_id = active_terminal.parent_id ?? active_terminal.id

    const root_terminal = terminals.find((terminal) => terminal.id === root_id)
    const child_terminals = terminals
      .filter((terminal) => terminal.parent_id === root_id)
      .sort((first_terminal, second_terminal) => first_terminal.id - second_terminal.id)

    return root_terminal ? [root_terminal, ...child_terminals] : child_terminals
  }, [active_terminal, terminals])

  const close_overlays = () => {
    set_open_menu(null)
    set_menu_pinned(false)
    set_settings_open(false)
  }

  const hover_menu = (menu: Exclude<TopMenu, null>) => {
    set_open_menu(menu)
    set_settings_open(false)
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
  }

  const toggle_settings = () => {
    set_settings_open((current_value) => !current_value)
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

  const create_text_file = () => {
    const document_id = get_next_document_id(documents)
    const untitled_number = get_next_untitled_number(documents)
    const new_document: EditorDocument = {
      id: document_id,
      name: `Untitled-${untitled_number}`,
      content: '',
      saved_content: '',
      file_path: null,
      language: 'text',
      dirty: false,
    }

    set_documents([...documents, new_document])
    set_active_document_id(new_document.id)
    close_overlays()
  }

  const select_document = (document_id: number) => {
    set_active_document_id(document_id)
  }

  const close_document = (document_id: number) => {
    const document_index = documents.findIndex((document) => document.id === document_id)
    const remaining_documents = documents.filter((document) => document.id !== document_id)

    if (active_document_id === document_id) {
      const replacement_index = Math.min(document_index, remaining_documents.length - 1)
      set_active_document_id(remaining_documents[replacement_index]?.id ?? null)
    }

    set_documents(remaining_documents)
  }

  const update_document = (document_id: number, content: string) => {
    set_documents((current_documents) =>
      current_documents.map((document) => {
        if (document.id !== document_id) {
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

  const save_document = async (save_as = false) => {
    const active_document = documents.find((document) => document.id === active_document_id)

    close_overlays()

    if (!active_document) {
      return
    }

    const saved_content = active_document.content
    const saved_file = await window.editor_api.file.save_text({
      content: saved_content,
      file_path: active_document.file_path,
      save_as,
      suggested_name: active_document.file_path ? active_document.name : `${active_document.name}.txt`,
    })

    if (!saved_file) {
      return
    }

    set_documents((current_documents) =>
      current_documents.map((document) => {
        if (document.id !== active_document.id) {
          return document
        }

        return {
          ...document,
          name: saved_file.name,
          file_path: saved_file.file_path,
          saved_content,
          dirty: document.content !== saved_content,
        }
      }),
    )
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
  }, [active_document_id, documents])

  const create_terminal = () => {
    const terminal_id = get_next_terminal_id(terminals)
    const new_terminal: TerminalSession = {
      id: terminal_id,
      name: `Terminal ${terminal_id}`,
      history: [],
      input: '',
      parent_id: null,
    }

    set_terminals([...terminals, new_terminal])
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
    const new_terminal: TerminalSession = {
      id: terminal_id,
      name: `Terminal ${terminal_id}`,
      history: [],
      input: '',
      parent_id: root_id,
    }

    set_terminals([...terminals, new_terminal])
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

    const terminal_index = terminals.findIndex((item) => item.id === terminal_id)
    const child_terminals = terminals.filter((item) => item.parent_id === terminal_id)
    let remaining_terminals = terminals.filter((item) => item.id !== terminal_id)
    let replacement_id: number | null = active_terminal_id

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
        replacement_id = terminal.parent_id
      } else {
        const replacement_index = Math.min(terminal_index, remaining_terminals.length - 1)
        replacement_id = remaining_terminals[replacement_index]?.id ?? null
      }
    }

    set_terminals(remaining_terminals)
    set_active_terminal_id(replacement_id)
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

  const select_theme = (theme: ThemeMode) => {
    set_theme_mode(theme)
    set_open_menu(null)
    set_menu_pinned(false)
  }

  const open_file_dialog = async () => {
    set_open_menu(null)
    set_menu_pinned(false)
    await window.editor_api.dialog.open_file()
  }

  const open_folder_dialog = async () => {
    set_open_menu(null)
    set_menu_pinned(false)
    await window.editor_api.dialog.open_folder()
  }

  return {
    active_activity,
    active_document_id,
    active_terminal_id,
    ai_chat_open,
    bottom_panel_open,
    bottom_panel_tab,
    close_bottom_panel,
    close_document,
    close_overlays,
    create_terminal,
    create_text_file,
    delete_terminal,
    documents,
    hover_menu,
    is_maximized,
    leave_menus,
    open_file_dialog,
    open_folder_dialog,
    open_menu,
    resolved_theme,
    save_document,
    select_activity,
    select_document,
    select_bottom_panel_tab,
    select_terminal,
    select_theme,
    settings_open,
    split_terminal,
    submit_terminal_input,
    terminals,
    theme_mode,
    toggle_ai_chat,
    toggle_menu,
    toggle_settings,
    update_document,
    update_terminal_input,
    visible_terminals,
  }
}

export default useEditorState
