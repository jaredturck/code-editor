import { app, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  is_privileged_editor_preload,
  is_trusted_renderer_navigation,
} from './navigationSecurity.cjs'

function is_web_url(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function trusted_renderer_url() {
  return app.isPackaged
    ? pathToFileURL(join(__dirname, '../dist/index.html')).toString()
    : 'http://localhost:5173'
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

app.on('browser-window-created', (_event, window) => {
  const preload = window.webContents.getLastWebPreferences().preload
  if (!is_privileged_editor_preload(preload)) return
  secure_privileged_renderer_navigation(window)
})
