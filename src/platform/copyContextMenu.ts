import { Terminal } from '@xterm/xterm'

interface CopyMenuWindow extends Window {
  __codeEditorCopyMenuInstalled?: boolean
  __codeEditorTerminalCopyMenuInstalled?: boolean
}

let active_menu: HTMLDivElement | null = null

function selected_text(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart
    const end = target.selectionEnd
    if (start !== null && end !== null && end > start) return target.value.slice(start, end)
  }

  return window.getSelection()?.toString() || ''
}

function close_copy_menu() {
  active_menu?.remove()
  active_menu = null
}

function show_copy_menu(value: string, x: number, y: number) {
  close_copy_menu()

  const theme_root = document.querySelector<HTMLElement>('[class*="theme-"]') || document.body
  const overlay = document.createElement('div')
  const menu = document.createElement('div')
  const button = document.createElement('button')

  overlay.style.position = 'fixed'
  overlay.style.inset = '0'
  overlay.style.zIndex = '400'

  menu.style.position = 'fixed'
  menu.style.minWidth = '120px'
  menu.style.padding = '4px'
  menu.style.border = '1px solid var(--border)'
  menu.style.borderRadius = '6px'
  menu.style.background = 'var(--surface-2)'
  menu.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.35)'

  button.type = 'button'
  button.textContent = 'Copy'
  button.style.display = 'flex'
  button.style.width = '100%'
  button.style.height = '28px'
  button.style.alignItems = 'center'
  button.style.padding = '0 8px'
  button.style.border = '0'
  button.style.borderRadius = '4px'
  button.style.background = 'transparent'
  button.style.color = 'var(--text)'
  button.style.font = 'inherit'
  button.style.fontSize = '12px'
  button.style.cursor = 'default'
  button.style.textAlign = 'left'

  button.addEventListener('mouseenter', () => {
    button.style.background = 'var(--hover)'
  })
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent'
  })
  button.addEventListener('click', () => {
    window.editor_api.workspace.copy_text(value)
    close_copy_menu()
  })
  menu.addEventListener('mousedown', (event) => event.stopPropagation())
  overlay.addEventListener('mousedown', close_copy_menu)
  overlay.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    close_copy_menu()
  })

  menu.append(button)
  overlay.append(menu)
  theme_root.append(overlay)
  active_menu = overlay

  const bounds = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
}

function install_terminal_copy_menu(runtime_window: CopyMenuWindow) {
  if (runtime_window.__codeEditorTerminalCopyMenuInstalled) return
  runtime_window.__codeEditorTerminalCopyMenuInstalled = true

  const open = Terminal.prototype.open
  Terminal.prototype.open = function (parent: HTMLElement) {
    open.call(this, parent)
    parent.addEventListener('contextmenu', (event) => {
      const value = this.getSelection()
      if (!value.trim()) return

      event.preventDefault()
      event.stopPropagation()
      show_copy_menu(value, event.clientX, event.clientY)
    })
  }
}

export function install_copy_context_menu() {
  const runtime_window = window as CopyMenuWindow
  install_terminal_copy_menu(runtime_window)
  if (runtime_window.__codeEditorCopyMenuInstalled) return
  runtime_window.__codeEditorCopyMenuInstalled = true

  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return
    const value = selected_text(event.target)
    if (!value.trim()) return

    event.preventDefault()
    show_copy_menu(value, event.clientX, event.clientY)
  })
  window.addEventListener('blur', close_copy_menu)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close_copy_menu()
  })
}
