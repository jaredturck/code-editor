import { app, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is_trusted_renderer_navigation } from './navigationSecurity.cjs'

declare module 'electron' {
  interface NavigationHistory {
    canGoBack(): boolean
    canGoForward(): boolean
    goBack(): void
    goForward(): void
  }
}

function install_navigation_history_compat(web_contents: Electron.WebContents) {
  const navigation_history = web_contents.navigationHistory

  if (typeof navigation_history.canGoBack !== 'function') {
    navigation_history.canGoBack = () => web_contents.canGoBack()
  }
  if (typeof navigation_history.canGoForward !== 'function') {
    navigation_history.canGoForward = () => web_contents.canGoForward()
  }
  if (typeof navigation_history.goBack !== 'function') {
    navigation_history.goBack = () => web_contents.goBack()
  }
  if (typeof navigation_history.goForward !== 'function') {
    navigation_history.goForward = () => web_contents.goForward()
  }
}

function is_web_url(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function trusted_renderer_url() {
  return app.isPackaged ? pathToFileURL(join(__dirname, '../dist/index.html')).toString() : 'http://localhost:5173'
}

export function secure_privileged_renderer_navigation(window: BrowserWindow) {
  const trusted_url = trusted_renderer_url()
  const guard_navigation = (event: Electron.Event, url: string) => {
    if (is_trusted_renderer_navigation(url, trusted_url)) return
    event.preventDefault()
    if (is_web_url(url)) void shell.openExternal(url)
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (is_web_url(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', guard_navigation)
  window.webContents.on('will-redirect', guard_navigation)
}

app.on('web-contents-created', (_event, web_contents) => {
  install_navigation_history_compat(web_contents)
})

app.on('browser-window-created', (_event, window) => {
  const trusted_url = trusted_renderer_url()
  const arm_guard = (...args: any[]) => {
    const detail = args[1]
    const url =
      typeof detail === 'string' ? detail : detail && typeof detail === 'object' ? String(detail.url || '') : ''
    if (!is_trusted_renderer_navigation(url, trusted_url)) return
    window.webContents.removeListener('did-start-navigation', arm_guard)
    secure_privileged_renderer_navigation(window)
  }
  window.webContents.on('did-start-navigation', arm_guard)
})
