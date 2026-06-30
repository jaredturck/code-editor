import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('editor_api', {
  platform: process.platform,
  app: {
    exit: () => ipcRenderer.send('app:exit'),
  },
  dialog: {
    open_file: () => ipcRenderer.invoke('dialog:open-file'),
    open_folder: () => ipcRenderer.invoke('dialog:open-folder'),
  },
  file: {
    save_text: (options: {
      content: string
      file_path: string | null
      save_as: boolean
      suggested_name: string
    }) => ipcRenderer.invoke('file:save-text', options),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggle_maximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    is_maximized: () => ipcRenderer.invoke('window:is-maximized'),
    on_maximized_change: (callback: (is_maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, is_maximized: boolean) => {
        callback(is_maximized)
      }

      ipcRenderer.on('window:maximized-change', listener)

      return () => {
        ipcRenderer.removeListener('window:maximized-change', listener)
      }
    },
  },
})
