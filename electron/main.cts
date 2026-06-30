import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'

function create_window() {
  const main_window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

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
