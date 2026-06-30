import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, WebContentsView } from 'electron'
import { access, open, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

interface BrowserEntry {
  owner_id: number
  window: BrowserWindow
  view: WebContentsView
  fallback_url: string
}

const browser_entries = new Map<string, BrowserEntry>()
let browser_session_ready = false

function get_event_window(sender: Electron.WebContents) {
  return BrowserWindow.fromWebContents(sender)
}

function get_browser_key(owner_id: number, browser_id: number) {
  return `${owner_id}:${browser_id}`
}

function get_browser_entry(sender: Electron.WebContents, browser_id: number) {
  return browser_entries.get(get_browser_key(sender.id, browser_id)) ?? null
}

function send_maximized_state(main_window: BrowserWindow) {
  const is_maximized = main_window.isMaximized() || main_window.isFullScreen()
  main_window.webContents.send('window:maximized-change', is_maximized)
}

function is_web_url(value: string) {
  return value.startsWith('http://') || value.startsWith('https://')
}

function normalize_browser_url(value: string) {
  const trimmed_value = value.trim()

  if (!trimmed_value) {
    return 'https://duckduckgo.com/'
  }

  if (/^https?:\/\//i.test(trimmed_value)) {
    return trimmed_value
  }

  if (!trimmed_value.includes(' ') && (trimmed_value.includes('.') || trimmed_value.startsWith('localhost'))) {
    return `https://${trimmed_value}`
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed_value)}`
}

function get_browser_state(browser_id: number, entry: BrowserEntry) {
  const web_contents = entry.view.webContents

  return {
    id: browser_id,
    title: web_contents.getTitle() || 'Browser',
    url: web_contents.getURL() || entry.fallback_url,
    can_go_back: web_contents.navigationHistory.canGoBack(),
    can_go_forward: web_contents.navigationHistory.canGoForward(),
    loading: web_contents.isLoading(),
  }
}

function send_browser_state(browser_id: number, entry: BrowserEntry) {
  if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) {
    return
  }

  entry.window.webContents.send('browser:state-change', get_browser_state(browser_id, entry))
}

function configure_browser_session() {
  const browser_session = session.fromPartition('browser')

  if (!browser_session_ready) {
    browser_session.setPermissionRequestHandler((_web_contents, _permission, callback) => {
      callback(false)
    })
    browser_session.setPermissionCheckHandler(() => false)
    browser_session_ready = true
  }

  return browser_session
}

function create_browser_entry(main_window: BrowserWindow, owner_id: number, browser_id: number, initial_url: string) {
  const browser_url = normalize_browser_url(initial_url)
  const browser_view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: configure_browser_session(),
    },
  })
  const entry: BrowserEntry = {
    owner_id,
    window: main_window,
    view: browser_view,
    fallback_url: browser_url,
  }
  const browser_key = get_browser_key(owner_id, browser_id)

  browser_entries.set(browser_key, entry)
  main_window.contentView.addChildView(browser_view)
  browser_view.setVisible(false)
  browser_view.setBackgroundColor('#111113')

  browser_view.webContents.setWindowOpenHandler(({ url }) => {
    if (is_web_url(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  browser_view.webContents.on('will-navigate', (event, url) => {
    if (is_web_url(url)) {
      return
    }

    event.preventDefault()

    if (url) {
      void shell.openExternal(url)
    }
  })

  browser_view.webContents.on('did-navigate', () => send_browser_state(browser_id, entry))
  browser_view.webContents.on('did-navigate-in-page', () => send_browser_state(browser_id, entry))
  browser_view.webContents.on('page-title-updated', () => send_browser_state(browser_id, entry))
  browser_view.webContents.on('did-start-loading', () => send_browser_state(browser_id, entry))
  browser_view.webContents.on('did-stop-loading', () => send_browser_state(browser_id, entry))
  browser_view.webContents.on('did-fail-load', () => send_browser_state(browser_id, entry))

  void browser_view.webContents.loadURL(browser_url).catch(() => {
    send_browser_state(browser_id, entry)
  })

  return entry
}

function destroy_browser_entry(owner_id: number, browser_id: number) {
  const browser_key = get_browser_key(owner_id, browser_id)
  const entry = browser_entries.get(browser_key)

  if (!entry) {
    return
  }

  entry.window.contentView.removeChildView(entry.view)

  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close()
  }

  browser_entries.delete(browser_key)
}

function destroy_window_browsers(owner_id: number) {
  for (const [browser_key, entry] of browser_entries) {
    if (entry.owner_id !== owner_id) {
      continue
    }

    entry.window.contentView.removeChildView(entry.view)

    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close()
    }

    browser_entries.delete(browser_key)
  }
}

async function file_exists(file_path: string) {
  return access(file_path)
    .then(() => true)
    .catch(() => false)
}

async function write_existing_text(file_path: string, content: string) {
  let file_handle: Awaited<ReturnType<typeof open>> | null = null

  try {
    file_handle = await open(file_path, 'r+')
    await file_handle.truncate(0)
    await file_handle.writeFile(content, 'utf8')
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  } finally {
    await file_handle?.close()
  }
}

ipcMain.on('window:minimize', (event) => {
  get_event_window(event.sender)?.minimize()
})

ipcMain.on('window:toggle-maximize', (event) => {
  const main_window = get_event_window(event.sender)

  if (!main_window) {
    return
  }

  if (main_window.isMaximized()) {
    main_window.unmaximize()
  } else {
    main_window.maximize()
  }
})

ipcMain.on('window:close', (event) => {
  get_event_window(event.sender)?.close()
})

ipcMain.on('app:exit', () => {
  app.quit()
})

ipcMain.handle('window:is-maximized', (event) => {
  const main_window = get_event_window(event.sender)

  return main_window?.isMaximized() || main_window?.isFullScreen() || false
})

ipcMain.handle('dialog:open-file', async (event) => {
  const main_window = get_event_window(event.sender)
  const options: Electron.OpenDialogOptions = { properties: ['openFile'] }
  const result = main_window ? await dialog.showOpenDialog(main_window, options) : await dialog.showOpenDialog(options)

  return result.canceled ? null : (result.filePaths[0] ?? null)
})

ipcMain.handle('dialog:open-folder', async (event) => {
  const main_window = get_event_window(event.sender)
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
  const result = main_window ? await dialog.showOpenDialog(main_window, options) : await dialog.showOpenDialog(options)

  return result.canceled ? null : (result.filePaths[0] ?? null)
})

ipcMain.handle('file:check-paths', async (_event, file_paths: string[]) => {
  const path_entries = await Promise.all(
    file_paths.map(async (file_path) => {
      return [file_path, await file_exists(file_path)] as const
    }),
  )

  return Object.fromEntries(path_entries)
})

ipcMain.handle(
  'file:save-text',
  async (
    event,
    options: {
      content: string
      file_path: string | null
      save_as: boolean
      suggested_name: string
    },
  ) => {
    const main_window = get_event_window(event.sender)
    let file_path = options.file_path

    if (options.save_as || !file_path) {
      const dialog_options: Electron.SaveDialogOptions = {
        defaultPath: file_path ?? options.suggested_name,
        filters: [
          { name: 'Text files', extensions: ['txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const result = main_window
        ? await dialog.showSaveDialog(main_window, dialog_options)
        : await dialog.showSaveDialog(dialog_options)

      if (result.canceled || !result.filePath) {
        return null
      }

      file_path = result.filePath
      await writeFile(file_path, options.content, 'utf8')
    } else {
      const saved_existing_file = await write_existing_text(file_path, options.content)

      if (!saved_existing_file) {
        return { status: 'missing' as const }
      }
    }

    return {
      status: 'saved' as const,
      file_path,
      name: basename(file_path),
    }
  },
)

ipcMain.handle('browser:create', (event, browser_id: number, initial_url: string) => {
  const main_window = get_event_window(event.sender)

  if (!main_window) {
    throw new Error('Browser window is unavailable')
  }

  const existing_entry = get_browser_entry(event.sender, browser_id)
  const entry = existing_entry ?? create_browser_entry(main_window, event.sender.id, browser_id, initial_url)

  return get_browser_state(browser_id, entry)
})

ipcMain.on('browser:destroy', (event, browser_id: number) => {
  destroy_browser_entry(event.sender.id, browser_id)
})

ipcMain.on('browser:set-bounds', (event, browser_id: number, bounds: Electron.Rectangle) => {
  const entry = get_browser_entry(event.sender, browser_id)

  if (!entry) {
    return
  }

  entry.view.setBounds({
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  })
})

ipcMain.on('browser:set-visible', (event, browser_id: number, visible: boolean) => {
  get_browser_entry(event.sender, browser_id)?.view.setVisible(visible)
})

ipcMain.on('browser:navigate', (event, browser_id: number, value: string) => {
  const entry = get_browser_entry(event.sender, browser_id)

  if (!entry) {
    return
  }

  const browser_url = normalize_browser_url(value)
  entry.fallback_url = browser_url
  void entry.view.webContents.loadURL(browser_url)
})

ipcMain.on('browser:go-back', (event, browser_id: number) => {
  const entry = get_browser_entry(event.sender, browser_id)

  if (entry?.view.webContents.navigationHistory.canGoBack()) {
    entry.view.webContents.navigationHistory.goBack()
  }
})

ipcMain.on('browser:go-forward', (event, browser_id: number) => {
  const entry = get_browser_entry(event.sender, browser_id)

  if (entry?.view.webContents.navigationHistory.canGoForward()) {
    entry.view.webContents.navigationHistory.goForward()
  }
})

ipcMain.on('browser:reload', (event, browser_id: number) => {
  get_browser_entry(event.sender, browser_id)?.view.webContents.reload()
})

function create_window() {
  const main_window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#020617',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const owner_id = main_window.webContents.id

  main_window.on('maximize', () => send_maximized_state(main_window))
  main_window.on('unmaximize', () => send_maximized_state(main_window))
  main_window.on('enter-full-screen', () => send_maximized_state(main_window))
  main_window.on('leave-full-screen', () => send_maximized_state(main_window))
  main_window.on('focus', () => main_window.webContents.send('window:focus'))
  main_window.on('closed', () => destroy_window_browsers(owner_id))

  if (app.isPackaged) {
    main_window.loadFile(join(__dirname, '../dist/index.html'))
  } else {
    main_window.loadURL('http://localhost:5173')
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  create_window()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      create_window()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
