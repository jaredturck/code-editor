import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, WebContentsView } from 'electron'
import { open, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyze_document, type DiagnosticInput } from './diagnostics.cjs'
import { file_exists, get_resource_path, open_editor_file, read_attachment, resolve_relative_file } from './files.cjs'
import {
  get_ollama_model_capabilities,
  get_speech_model_status,
  install_speech_model,
  list_ollama_models,
  stream_ollama_chat,
  transcribe_audio,
  type OllamaMessage,
} from './ollama.cjs'
import { read_settings, update_settings, type AppSettings } from './settings.cjs'
import {
  copy_workspace_text,
  create_workspace_entry,
  paste_workspace_entry,
  read_workspace_directory,
  rename_workspace_entry,
  reveal_workspace_entry,
  stop_workspace_watch,
  trash_workspace_entry,
  watch_workspace,
  type WorkspaceClipboardOperation,
  type WorkspaceConflictMode,
  type WorkspaceEntryKind,
} from './workspace.cjs'
import {
  create_terminal,
  kill_all_terminals,
  kill_terminal,
  kill_window_terminals,
  resize_terminal,
  write_terminal,
} from './terminal.cjs'

interface BrowserEntry {
  owner_id: number
  window: BrowserWindow
  view: WebContentsView
  fallback_url: string
}

const browser_entries = new Map<string, BrowserEntry>()
const ai_requests = new Map<string, AbortController>()
const approved_close_windows = new Set<number>()
let browser_session_ready = false
let application_quit_requested = false

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'editor-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

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
  application_quit_requested = true
  const windows = BrowserWindow.getAllWindows()

  if (windows.length === 0) {
    app.quit()
    return
  }

  for (const window of windows) {
    window.close()
  }
})

ipcMain.on('app:close-response', (event, allow_close: boolean) => {
  const main_window = get_event_window(event.sender)

  if (!main_window || !allow_close) {
    if (!allow_close) {
      application_quit_requested = false
    }
    return
  }

  approved_close_windows.add(main_window.id)

  if (application_quit_requested) {
    app.quit()
  } else {
    main_window.close()
  }
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

ipcMain.on('edit:command', (event, command: 'copy' | 'cut' | 'paste') => {
  const web_contents = get_event_window(event.sender)?.webContents

  if (!web_contents) {
    return
  }

  web_contents[command]()
})

ipcMain.handle('settings:get', () => read_settings())

ipcMain.handle('settings:update', (_event, settings: Partial<AppSettings>) => update_settings(settings))

ipcMain.handle('file:open', async (_event, file_path: string) => {
  try {
    return await open_editor_file(file_path)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {
        status: 'missing' as const,
        message: `${basename(file_path)} no longer exists.`,
      }
    }

    return {
      status: 'error' as const,
      message: `Unable to open ${basename(file_path)}.`,
    }
  }
})

ipcMain.handle('file:resolve-relative', async (_event, base_file_path: string, relative_path: string) => {
  return resolve_relative_file(base_file_path, relative_path)
})

ipcMain.handle('file:read-attachment', async (_event, file_path: string) => {
  return read_attachment(file_path)
})

ipcMain.on('file:open-external', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) {
    void shell.openExternal(url)
  }
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
      file_type_name: string
      file_extensions: string[]
    },
  ) => {
    const main_window = get_event_window(event.sender)
    let file_path = options.file_path

    if (options.save_as || !file_path) {
      const file_filters: Electron.FileFilter[] = []

      if (options.file_extensions.length > 0) {
        file_filters.push({
          name: options.file_type_name,
          extensions: options.file_extensions,
        })
      }

      file_filters.push({ name: 'All files', extensions: ['*'] })

      const dialog_options: Electron.SaveDialogOptions = {
        defaultPath: file_path ?? options.suggested_name,
        filters: file_filters,
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

ipcMain.handle('workspace:read-directory', async (_event, root_path: string, directory_path: string) => {
  return read_workspace_directory(root_path, directory_path)
})

ipcMain.handle(
  'workspace:create-entry',
  async (_event, root_path: string, parent_path: string, name: string, kind: WorkspaceEntryKind) => {
    return create_workspace_entry(root_path, parent_path, name, kind)
  },
)

ipcMain.handle('workspace:rename-entry', async (_event, root_path: string, source_path: string, name: string) => {
  return rename_workspace_entry(root_path, source_path, name)
})

ipcMain.handle(
  'workspace:paste-entry',
  async (
    _event,
    root_path: string,
    source_path: string,
    target_directory: string,
    operation: WorkspaceClipboardOperation,
    conflict_mode: WorkspaceConflictMode,
  ) => {
    return paste_workspace_entry(root_path, source_path, target_directory, operation, conflict_mode)
  },
)

ipcMain.handle('workspace:trash-entry', async (_event, root_path: string, target_path: string) => {
  return trash_workspace_entry(root_path, target_path)
})

ipcMain.on('workspace:reveal-entry', (_event, root_path: string, target_path: string) => {
  reveal_workspace_entry(root_path, target_path)
})

ipcMain.on('workspace:copy-text', (_event, value: string) => {
  copy_workspace_text(value)
})

ipcMain.handle('workspace:watch', (event, root_path: string) => {
  return watch_workspace(event.sender, root_path)
})

ipcMain.on('workspace:unwatch', (event) => {
  stop_workspace_watch(event.sender.id)
})

ipcMain.handle('diagnostics:analyze', async (_event, input: DiagnosticInput) => {
  return analyze_document(input)
})

ipcMain.handle('terminal:create', (event, terminal_id: number, cwd?: string | null) => {
  return create_terminal(event.sender, terminal_id, cwd || undefined)
})

ipcMain.on('terminal:write', (event, terminal_id: number, data: string) => {
  write_terminal(event.sender.id, terminal_id, data)
})

ipcMain.on('terminal:resize', (event, terminal_id: number, cols: number, rows: number) => {
  resize_terminal(event.sender.id, terminal_id, cols, rows)
})

ipcMain.on('terminal:kill', (event, terminal_id: number) => {
  kill_terminal(event.sender.id, terminal_id)
})

ipcMain.handle('ai:list-models', async (_event, base_url: string) => {
  return list_ollama_models(base_url)
})

ipcMain.handle('ai:model-capabilities', async (_event, base_url: string, model: string) => {
  return get_ollama_model_capabilities(base_url, model)
})

ipcMain.on(
  'ai:chat-start',
  (
    event,
    request: {
      request_id: string
      base_url: string
      model: string
      messages: OllamaMessage[]
    },
  ) => {
    const controller = new AbortController()
    ai_requests.set(request.request_id, controller)

    void stream_ollama_chat(
      request.base_url,
      request.model,
      request.messages,
      controller.signal,
      (content, thinking) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:chat-chunk', {
            request_id: request.request_id,
            content,
            thinking,
          })
        }
      },
    )
      .then(() => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:chat-complete', {
            request_id: request.request_id,
          })
        }
      })
      .catch((error: unknown) => {
        if (!event.sender.isDestroyed()) {
          const message = error instanceof Error ? error.message : 'Ollama request failed.'
          event.sender.send('ai:chat-error', {
            request_id: request.request_id,
            message,
          })
        }
      })
      .finally(() => {
        ai_requests.delete(request.request_id)
      })
  },
)

ipcMain.on('ai:chat-cancel', (_event, request_id: string) => {
  ai_requests.get(request_id)?.abort()
  ai_requests.delete(request_id)
})

ipcMain.handle('ai:speech-status', async (_event, base_url: string, speech_model: string) => {
  try {
    return await get_speech_model_status(base_url, speech_model)
  } catch {
    return { ollama_available: false, installed: false }
  }
})

ipcMain.handle('ai:install-speech-model', async (_event, base_url: string, speech_model: string) => {
  return install_speech_model(base_url, speech_model)
})

ipcMain.handle('ai:transcribe', async (_event, base_url: string, speech_model: string, audio: Uint8Array) => {
  return transcribe_audio(base_url, speech_model, audio)
})

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
  main_window.on('close', (event) => {
    if (approved_close_windows.has(main_window.id)) {
      approved_close_windows.delete(main_window.id)
      return
    }

    event.preventDefault()
    main_window.webContents.send('app:close-request')
  })
  main_window.on('closed', () => {
    destroy_window_browsers(owner_id)
    kill_window_terminals(owner_id)
    stop_workspace_watch(owner_id)
  })

  if (app.isPackaged) {
    main_window.loadFile(join(__dirname, '../dist/index.html'))
  } else {
    main_window.loadURL('http://localhost:5173')
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  protocol.handle('editor-file', (request) => {
    const resource_path = get_resource_path(request.url)

    if (!resource_path) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(resource_path).toString(), {
      headers: request.headers,
    })
  })
  session.defaultSession.setPermissionCheckHandler((web_contents, permission) => {
    return permission === 'media' && web_contents !== null && BrowserWindow.fromWebContents(web_contents) !== null
  })
  session.defaultSession.setPermissionRequestHandler((web_contents, permission, callback) => {
    callback(permission === 'media' && BrowserWindow.fromWebContents(web_contents) !== null)
  })
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

app.on('before-quit', () => {
  application_quit_requested = true
})

app.on('will-quit', () => {
  kill_all_terminals()

  for (const controller of ai_requests.values()) {
    controller.abort()
  }

  ai_requests.clear()
})
