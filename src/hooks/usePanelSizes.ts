import { useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

const activity_bar_width = 48
const minimum_editor_width = 320
const minimum_editor_height = 180
const top_bar_height = 36

const sidebar_min_width = 180
const sidebar_max_width = 520
const bottom_panel_min_height = 120
const bottom_panel_max_height = 620
const terminal_list_min_width = 140
const terminal_list_max_width = 360
const ai_chat_min_width = 240
const ai_chat_max_width = 560

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function start_resize(
  event: ReactPointerEvent<HTMLElement>,
  current_value: number,
  axis: 'x' | 'y',
  direction: 1 | -1,
  minimum: number,
  get_maximum: () => number,
  update_value: (value: number) => void,
) {
  event.preventDefault()

  const start_coordinate = axis === 'x' ? event.clientX : event.clientY
  const previous_cursor = document.documentElement.style.cursor
  const previous_user_select = document.body.style.userSelect
  const resize_cursor = axis === 'x' ? 'col-resize' : 'row-resize'

  document.documentElement.style.cursor = resize_cursor
  document.body.style.userSelect = 'none'

  const resize_panel = (move_event: PointerEvent) => {
    const current_coordinate =
      axis === 'x' ? move_event.clientX : move_event.clientY
    const distance = (current_coordinate - start_coordinate) * direction
    const next_value = clamp(current_value + distance, minimum, get_maximum())

    update_value(next_value)
  }

  const stop_resize = () => {
    document.documentElement.style.cursor = previous_cursor
    document.body.style.userSelect = previous_user_select
    window.removeEventListener('pointermove', resize_panel)
    window.removeEventListener('pointerup', stop_resize)
    window.removeEventListener('pointercancel', stop_resize)
    window.removeEventListener('blur', stop_resize)
  }

  window.addEventListener('pointermove', resize_panel)
  window.addEventListener('pointerup', stop_resize)
  window.addEventListener('pointercancel', stop_resize)
  window.addEventListener('blur', stop_resize)
}

function usePanelSizes(ai_chat_open: boolean) {
  const [sidebar_width, set_sidebar_width] = useState(260)
  const [bottom_panel_height, set_bottom_panel_height] = useState(240)
  const [terminal_list_width, set_terminal_list_width] = useState(176)
  const [ai_chat_width, set_ai_chat_width] = useState(320)

  const get_sidebar_maximum = () => {
    const reserved_ai_width = ai_chat_open ? ai_chat_width : 0
    const available_width =
      window.innerWidth -
      activity_bar_width -
      reserved_ai_width -
      minimum_editor_width

    return Math.max(
      sidebar_min_width,
      Math.min(sidebar_max_width, available_width),
    )
  }

  const get_bottom_panel_maximum = () => {
    const available_height =
      window.innerHeight - top_bar_height - minimum_editor_height

    return Math.max(
      bottom_panel_min_height,
      Math.min(bottom_panel_max_height, available_height),
    )
  }

  const get_terminal_list_maximum = () => {
    return Math.max(
      terminal_list_min_width,
      Math.min(terminal_list_max_width, Math.floor(window.innerWidth * 0.4)),
    )
  }

  const get_ai_chat_maximum = () => {
    const available_width =
      window.innerWidth -
      activity_bar_width -
      sidebar_width -
      minimum_editor_width

    return Math.max(
      ai_chat_min_width,
      Math.min(ai_chat_max_width, available_width),
    )
  }

  useEffect(() => {
    const clamp_panel_sizes = () => {
      set_sidebar_width((current_width) =>
        clamp(current_width, sidebar_min_width, get_sidebar_maximum()),
      )
      set_bottom_panel_height((current_height) =>
        clamp(
          current_height,
          bottom_panel_min_height,
          get_bottom_panel_maximum(),
        ),
      )
      set_terminal_list_width((current_width) =>
        clamp(
          current_width,
          terminal_list_min_width,
          get_terminal_list_maximum(),
        ),
      )
      set_ai_chat_width((current_width) =>
        clamp(current_width, ai_chat_min_width, get_ai_chat_maximum()),
      )
    }

    clamp_panel_sizes()
    window.addEventListener('resize', clamp_panel_sizes)

    return () => {
      window.removeEventListener('resize', clamp_panel_sizes)
    }
  }, [ai_chat_open, ai_chat_width, sidebar_width])

  const start_sidebar_resize = (event: ReactPointerEvent<HTMLElement>) => {
    start_resize(
      event,
      sidebar_width,
      'x',
      1,
      sidebar_min_width,
      get_sidebar_maximum,
      set_sidebar_width,
    )
  }

  const start_bottom_panel_resize = (event: ReactPointerEvent<HTMLElement>) => {
    start_resize(
      event,
      bottom_panel_height,
      'y',
      -1,
      bottom_panel_min_height,
      get_bottom_panel_maximum,
      set_bottom_panel_height,
    )
  }

  const start_terminal_list_resize = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    start_resize(
      event,
      terminal_list_width,
      'x',
      -1,
      terminal_list_min_width,
      get_terminal_list_maximum,
      set_terminal_list_width,
    )
  }

  const start_ai_chat_resize = (event: ReactPointerEvent<HTMLElement>) => {
    start_resize(
      event,
      ai_chat_width,
      'x',
      -1,
      ai_chat_min_width,
      get_ai_chat_maximum,
      set_ai_chat_width,
    )
  }

  return {
    ai_chat_width,
    bottom_panel_height,
    sidebar_width,
    start_ai_chat_resize,
    start_bottom_panel_resize,
    start_sidebar_resize,
    start_terminal_list_resize,
    terminal_list_width,
  }
}

export default usePanelSizes
