import { useEffect, useMemo, useState } from 'react'
import type {
  ActivitySection,
  BottomPanelTab,
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

function useEditorState() {
  const [active_activity, set_active_activity] = useState<ActivitySection>('explorer')
  const [bottom_panel_open, set_bottom_panel_open] = useState(true)
  const [bottom_panel_tab, set_bottom_panel_tab] = useState<BottomPanelTab>('terminal')
  const [terminals, set_terminals] = useState<TerminalSession[]>(initial_terminals)
  const [active_terminal_id, set_active_terminal_id] = useState<number | null>(1)
  const [open_menu, set_open_menu] = useState<TopMenu>(null)
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
    set_settings_open(false)
  }

  const toggle_menu = (menu: Exclude<TopMenu, null>) => {
    set_open_menu((current_menu) => current_menu === menu ? null : menu)
    set_settings_open(false)
  }

  const toggle_settings = () => {
    set_settings_open((current_value) => !current_value)
    set_open_menu(null)
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
    set_terminals((current_terminals) => current_terminals.map((terminal) => {
      if (terminal.id !== terminal_id) {
        return terminal
      }

      return {
        ...terminal,
        input,
      }
    }))
  }

  const submit_terminal_input = (terminal_id: number) => {
    set_terminals((current_terminals) => current_terminals.map((terminal) => {
      if (terminal.id !== terminal_id) {
        return terminal
      }

      const history = terminal.input.length > 0
        ? [...terminal.history, terminal.input]
        : terminal.history

      return {
        ...terminal,
        history,
        input: '',
      }
    }))
  }

  const select_theme = (theme: ThemeMode) => {
    set_theme_mode(theme)
    set_open_menu(null)
  }

  const open_file_dialog = async () => {
    set_open_menu(null)
    await window.editor_api.dialog.open_file()
  }

  const open_folder_dialog = async () => {
    set_open_menu(null)
    await window.editor_api.dialog.open_folder()
  }

  return {
    active_activity,
    active_terminal_id,
    ai_chat_open,
    bottom_panel_open,
    bottom_panel_tab,
    close_bottom_panel,
    close_overlays,
    create_terminal,
    delete_terminal,
    is_maximized,
    open_file_dialog,
    open_folder_dialog,
    open_menu,
    resolved_theme,
    select_activity,
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
    update_terminal_input,
    visible_terminals,
  }
}

export default useEditorState
