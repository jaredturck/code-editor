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
  },
]

function useEditorState() {
  const [active_activity, set_active_activity] = useState<ActivitySection>('explorer')
  const [bottom_panel_open, set_bottom_panel_open] = useState(true)
  const [bottom_panel_tab, set_bottom_panel_tab] = useState<BottomPanelTab>('terminal')
  const [terminals, set_terminals] = useState<TerminalSession[]>(initial_terminals)
  const [active_terminal_id, set_active_terminal_id] = useState<number | null>(1)
  const [next_terminal_id, set_next_terminal_id] = useState(2)
  const [open_menu, set_open_menu] = useState<TopMenu>(null)
  const [settings_open, set_settings_open] = useState(false)
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
    const new_terminal: TerminalSession = {
      id: next_terminal_id,
      name: `Terminal ${next_terminal_id}`,
      history: [],
      input: '',
    }

    set_terminals((current_terminals) => [...current_terminals, new_terminal])
    set_active_terminal_id(new_terminal.id)
    set_next_terminal_id((current_id) => current_id + 1)
    set_bottom_panel_tab('terminal')
    set_bottom_panel_open(true)
    close_overlays()
  }

  const delete_terminal = (terminal_id: number) => {
    set_terminals((current_terminals) => {
      const terminal_index = current_terminals.findIndex((terminal) => terminal.id === terminal_id)
      const remaining_terminals = current_terminals.filter((terminal) => terminal.id !== terminal_id)

      if (active_terminal_id === terminal_id) {
        const replacement_index = Math.min(terminal_index, remaining_terminals.length - 1)
        set_active_terminal_id(remaining_terminals[replacement_index]?.id ?? null)
      }

      return remaining_terminals
    })
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

  return {
    active_activity,
    active_terminal,
    active_terminal_id,
    bottom_panel_open,
    bottom_panel_tab,
    close_bottom_panel,
    close_overlays,
    create_terminal,
    delete_terminal,
    is_maximized,
    open_menu,
    resolved_theme,
    select_activity,
    select_bottom_panel_tab,
    select_terminal,
    select_theme,
    settings_open,
    submit_terminal_input,
    terminals,
    theme_mode,
    toggle_menu,
    toggle_settings,
    update_terminal_input,
  }
}

export default useEditorState
