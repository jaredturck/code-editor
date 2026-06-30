import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, WebContentsView } from 'electron'
import { access, open, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

interface BrowserEntry {
  owner_id: number
  window: BrowserWindow
  view: WebContentsView
  fallback_url: string
}

const browser_entries = new Map<string, BrowserEntry>()
let browser_session_ready = false

type ThemeMode = 'light' | 'dark' | 'system'
type EditorFeaturePreset = 'minimal' | 'balanced' | 'full' | 'custom'
type SuggestionMode = 'off' | 'manual' | 'typing'
type RenderWhitespaceMode = 'off' | 'all'
type IndentStyle = 'spaces' | 'tabs'

interface AppSettings {
  theme_mode: ThemeMode
  recent_files: string[]
  restore_recent_files: boolean
  confirm_unsaved_close: boolean
  default_language: string
  editor_preset: EditorFeaturePreset
  editor: {
    default_indent_style: IndentStyle
    default_indent_size: number
    auto_indent: boolean
    close_brackets: boolean
    bracket_matching: boolean
    multiple_selections: boolean
    code_folding: boolean
    fold_gutter: boolean
    word_wrap: boolean
  }
  appearance: {
    line_numbers: boolean
    highlight_active_line: boolean
    highlight_selection_matches: boolean
    render_whitespace: RenderWhitespaceMode
    highlight_trailing_whitespace: boolean
    show_special_characters: boolean
    scroll_past_end: boolean
  }
  suggestions: {
    mode: SuggestionMode
    accept_on_enter: boolean
    show_details: boolean
    show_type_icons: boolean
    delay: number
  }
  keybindings: Record<string, { enabled: boolean; key: string | null }>
}

const default_settings: AppSettings = {
  theme_mode: 'dark',
  recent_files: [],
  restore_recent_files: true,
  confirm_unsaved_close: true,
  default_language: 'Plain Text',
  editor_preset: 'balanced',
  editor: {
    default_indent_style: 'spaces',
    default_indent_size: 4,
    auto_indent: true,
    close_brackets: true,
    bracket_matching: true,
    multiple_selections: true,
    code_folding: true,
    fold_gutter: true,
    word_wrap: false,
  },
  appearance: {
    line_numbers: true,
    highlight_active_line: true,
    highlight_selection_matches: true,
    render_whitespace: 'off',
    highlight_trailing_whitespace: false,
    show_special_characters: true,
    scroll_past_end: false,
  },
  suggestions: {
    mode: 'typing',
    accept_on_enter: true,
    show_details: true,
    show_type_icons: true,
    delay: 100,
  },
  keybindings: {},
}
let settings_cache: AppSettings | null = null
let settings_write_queue = Promise.resolve()

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boolean_setting(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitize_settings(value: unknown): AppSettings {
  if (!is_record(value)) {
    return structuredClone(default_settings)
  }

  const editor = is_record(value.editor) ? value.editor : {}
  const appearance = is_record(value.appearance) ? value.appearance : {}
  const suggestions = is_record(value.suggestions) ? value.suggestions : {}
  const raw_keybindings = is_record(value.keybindings) ? value.keybindings : {}
  const keybindings: AppSettings['keybindings'] = {}

  for (const [command_id, raw_binding] of Object.entries(raw_keybindings)) {
    if (!is_record(raw_binding)) {
      continue
    }

    const key =
      typeof raw_binding.key === 'string' &&
      raw_binding.key.length > 0 &&
      raw_binding.key.length <= 64 &&
      !Array.from(raw_binding.key).some((character) => character.charCodeAt(0) < 32)
        ? raw_binding.key
        : null
    keybindings[command_id] = {
      enabled: boolean_setting(raw_binding.enabled, true),
      key,
    }
  }

  const theme_mode =
    value.theme_mode === 'light' || value.theme_mode === 'dark' || value.theme_mode === 'system'
      ? value.theme_mode
      : default_settings.theme_mode
  const recent_files = Array.isArray(value.recent_files)
    ? value.recent_files.filter((file_path): file_path is string => typeof file_path === 'string').slice(0, 5)
    : []
  const restore_recent_files = boolean_setting(value.restore_recent_files, default_settings.restore_recent_files)
  const editor_preset =
    value.editor_preset === 'minimal' ||
    value.editor_preset === 'balanced' ||
    value.editor_preset === 'full' ||
    value.editor_preset === 'custom'
      ? value.editor_preset
      : default_settings.editor_preset
  const default_indent_style =
    editor.default_indent_style === 'tabs' || editor.default_indent_style === 'spaces'
      ? editor.default_indent_style
      : default_settings.editor.default_indent_style
  const default_indent_size =
    typeof editor.default_indent_size === 'number' && [2, 4, 8].includes(editor.default_indent_size)
      ? editor.default_indent_size
      : default_settings.editor.default_indent_size
  const render_whitespace =
    appearance.render_whitespace === 'all' || appearance.render_whitespace === 'off'
      ? appearance.render_whitespace
      : default_settings.appearance.render_whitespace
  const suggestion_mode =
    suggestions.mode === 'off' || suggestions.mode === 'manual' || suggestions.mode === 'typing'
      ? suggestions.mode
      : default_settings.suggestions.mode
  const suggestion_delay =
    typeof suggestions.delay === 'number' && suggestions.delay >= 0 && suggestions.delay <= 2000
      ? Math.round(suggestions.delay)
      : default_settings.suggestions.delay

  return {
    theme_mode,
    recent_files: restore_recent_files ? recent_files : [],
    restore_recent_files,
    confirm_unsaved_close: boolean_setting(value.confirm_unsaved_close, default_settings.confirm_unsaved_close),
    default_language:
      typeof value.default_language === 'string' ? value.default_language : default_settings.default_language,
    editor_preset,
    editor: {
      default_indent_style,
      default_indent_size,
      auto_indent: boolean_setting(editor.auto_indent, default_settings.editor.auto_indent),
      close_brackets: boolean_setting(editor.close_brackets, default_settings.editor.close_brackets),
      bracket_matching: boolean_setting(editor.bracket_matching, default_settings.editor.bracket_matching),
      multiple_selections: boolean_setting(editor.multiple_selections, default_settings.editor.multiple_selections),
      code_folding: boolean_setting(editor.code_folding, default_settings.editor.code_folding),
      fold_gutter: boolean_setting(editor.fold_gutter, default_settings.editor.fold_gutter),
      word_wrap: boolean_setting(editor.word_wrap, default_settings.editor.word_wrap),
    },
    appearance: {
      line_numbers: boolean_setting(appearance.line_numbers, default_settings.appearance.line_numbers),
      highlight_active_line: boolean_setting(
        appearance.highlight_active_line,
        default_settings.appearance.highlight_active_line,
      ),
      highlight_selection_matches: boolean_setting(
        appearance.highlight_selection_matches,
        default_settings.appearance.highlight_selection_matches,
      ),
      render_whitespace,
      highlight_trailing_whitespace: boolean_setting(
        appearance.highlight_trailing_whitespace,
        default_settings.appearance.highlight_trailing_whitespace,
      ),
      show_special_characters: boolean_setting(
        appearance.show_special_characters,
        default_settings.appearance.show_special_characters,
      ),
      scroll_past_end: boolean_setting(appearance.scroll_past_end, default_settings.appearance.scroll_past_end),
    },
    suggestions: {
      mode: suggestion_mode,
      accept_on_enter: boolean_setting(suggestions.accept_on_enter, default_settings.suggestions.accept_on_enter),
      show_details: boolean_setting(suggestions.show_details, default_settings.suggestions.show_details),
      show_type_icons: boolean_setting(suggestions.show_type_icons, default_settings.suggestions.show_type_icons),
      delay: suggestion_delay,
    },
    keybindings,
  }
}

async function read_settings() {
  if (settings_cache) {
    return settings_cache
  }

  try {
    const settings_text = await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8')
    settings_cache = sanitize_settings(JSON.parse(settings_text))
  } catch {
    settings_cache = structuredClone(default_settings)
  }

  return settings_cache
}

async function update_settings(next_settings: Partial<AppSettings>) {
  const current_settings = await read_settings()
  const settings = sanitize_settings({ ...current_settings, ...next_settings })

  settings_cache = settings
  settings_write_queue = settings_write_queue
    .catch(() => undefined)
    .then(() => writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2), 'utf8'))

  try {
    await settings_write_queue
  } catch {
    return settings
  }

  return settings
}

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

ipcMain.on('edit:command', (event, command: 'copy' | 'cut' | 'paste') => {
  const web_contents = get_event_window(event.sender)?.webContents

  if (!web_contents) {
    return
  }

  web_contents[command]()
})

ipcMain.handle('settings:get', () => read_settings())

ipcMain.handle('settings:update', (_event, settings: Partial<AppSettings>) => update_settings(settings))

ipcMain.handle('file:read-text', async (_event, file_path: string) => {
  try {
    const content = await readFile(file_path, 'utf8')

    if (content.includes('\0')) {
      return {
        status: 'unsupported' as const,
        message: `${basename(file_path)} does not appear to be a text file.`,
      }
    }

    return {
      status: 'opened' as const,
      file_path,
      name: basename(file_path),
      content,
    }
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
