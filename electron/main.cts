import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join } from 'node:path'

function get_event_window(sender: Electron.WebContents) {
  return BrowserWindow.fromWebContents(sender)
}

function send_maximized_state(main_window: BrowserWindow) {
  const is_maximized = main_window.isMaximized() || main_window.isFullScreen()
  main_window.webContents.send('window:maximized-change', is_maximized)
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

  main_window.on('maximize', () => send_maximized_state(main_window))
  main_window.on('unmaximize', () => send_maximized_state(main_window))
  main_window.on('enter-full-screen', () => send_maximized_state(main_window))
  main_window.on('leave-full-screen', () => send_maximized_state(main_window))

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
